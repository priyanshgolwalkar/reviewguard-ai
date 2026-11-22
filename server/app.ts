import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
  isValidFirestoreId,
  RESPONSE_TONES,
  validateBusinessInput,
  validateReviewInput,
  type ResponseTone,
  type ReviewInput,
} from '../src/shared/validation.ts';
import type { GenAiClientLike } from './agents/geminiClient.ts';
import { GeminiConfigurationError, GeminiUpstreamError } from './agents/geminiClient.ts';
import { orchestrateBatchAnalysis, orchestrateReviewAnalysis } from './agents/orchestrator.ts';
import { runResponseAgent } from './agents/responseAgent.ts';
import {
  createAuthMiddleware,
  createTenantMembershipMiddleware,
  requireRole,
  type AuthenticatedRequest,
  type TokenVerifier,
} from './middleware/auth.ts';
import {
  provisionInitialSuperAdmin,
  SuperAdminProvisionError,
} from './services/adminProvisioning.ts';
import { parseAndValidateReviewsCsv } from './services/csvParser.ts';
import { defaultTenantDataStore, type TenantDataStore } from './services/firestoreRest.ts';

export interface CreateAppOptions {
  tokenVerifier?: TokenVerifier;
  geminiClient?: GenAiClientLike;
  tenantStore?: TenantDataStore;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB strict in-memory limit
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const isCsvMime =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'text/plain' ||
      file.originalname.toLowerCase().endsWith('.csv');
    if (!isCsvMime) {
      cb(new Error('Only .csv files are accepted.'));
      return;
    }
    cb(null, true);
  },
});

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const store = options.tenantStore ?? defaultTenantDataStore;
  const requireAuth = createAuthMiddleware(options.tokenVerifier, store);
  const requireTenantMember = createTenantMembershipMiddleware(store);
  const requireReplyApprover = createTenantMembershipMiddleware(store, {
    requireApprovalPermission: true,
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'reviewguard-ai-api',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });

  // Authoritative server-resolved session role (never trusts client-supplied role)
  app.get('/api/auth/session', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const u = req.authUser!;
    res.json({
      uid: u.uid,
      email: u.email,
      emailVerified: u.emailVerified,
      role: u.role,
      status: u.status,
    });
  });

  // Secure server-side initial Super Admin provisioning (no public self-assignment)
  app.post('/api/admin/bootstrap', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const u = req.authUser!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const bootstrapSecret =
        typeof body.bootstrapSecret === 'string' ? body.bootstrapSecret : undefined;

      const result = await provisionInitialSuperAdmin({
        uid: u.uid,
        email: u.email,
        emailVerified: u.emailVerified,
        displayName: u.displayName,
        idToken: u.idToken,
        bootstrapSecret,
        store,
      });

      res.json(result);
    } catch (err) {
      if (err instanceof SuperAdminProvisionError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Admin provisioning failed.';
      res.status(500).json({ error: message });
    }
  });

  // Admin-only verification endpoint
  app.get(
    '/api/admin/verify',
    requireAuth,
    requireRole('SUPER_ADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      res.json({
        authorized: true,
        role: req.authUser!.role,
        uid: req.authUser!.uid,
      });
    }
  );

  // Server-side reply approval authorization check
  app.post(
    '/api/reviews/authorize-approval',
    requireAuth,
    requireRole('BUSINESS_OWNER', 'BUSINESS_MANAGER'),
    requireReplyApprover,
    (req: AuthenticatedRequest, res: Response) => {
      res.json({
        authorized: true,
        businessId: req.tenantContext!.business.id,
        isOwner: req.tenantContext!.isOwner,
        canApproveReplies: req.tenantContext!.canApproveReplies,
      });
    }
  );

  // In-memory CSV parsing & validation scoped to verified business tenant
  app.post(
    '/api/reviews/parse-csv',
    requireAuth,
    requireRole('BUSINESS_OWNER', 'BUSINESS_MANAGER'),
    (req: Request, res: Response, next: NextFunction) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const message = err instanceof Error ? err.message : 'File upload failed.';
          res.status(400).json({ error: message });
          return;
        }
        next();
      });
    },
    requireTenantMember,
    (req: Request, res: Response) => {
      try {
        if (!req.file || !req.file.buffer) {
          res.status(400).json({ error: 'No CSV file provided under field name "file".' });
          return;
        }
        const parsed = parseAndValidateReviewsCsv(req.file.buffer);
        req.file.buffer = Buffer.alloc(0);
        res.json(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to parse CSV file.';
        res.status(400).json({ error: message });
      }
    }
  );

  async function ensureAiEnabled(req: AuthenticatedRequest, res: Response): Promise<boolean> {
    try {
      const settings = await store.getPlatformSettings(req.authUser!.idToken);
      if (settings && !settings.aiAnalysisEnabled) {
        res.status(503).json({
          error: 'AI analysis is currently disabled in platform settings.',
        });
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  // Modular AI Agent Pipeline (tenant-verified)
  app.post(
    '/api/ai/analyze-review',
    requireAuth,
    requireRole('BUSINESS_OWNER', 'BUSINESS_MANAGER'),
    requireTenantMember,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!(await ensureAiEnabled(req, res))) return;

        const body = (req.body ?? {}) as Record<string, unknown>;
        const businessValidation = validateBusinessInput((body.business ?? {}) as Record<string, unknown>);
        if (!businessValidation.valid) {
          res.status(400).json({ error: 'Invalid business context.', details: businessValidation.errors });
          return;
        }

        const reviewValidation = validateReviewInput((body.review ?? {}) as Record<string, unknown>);
        if (!reviewValidation.valid) {
          res.status(400).json({ error: 'Invalid review payload.', details: reviewValidation.errors });
          return;
        }

        const tone =
          typeof body.tone === 'string' && (RESPONSE_TONES as readonly string[]).includes(body.tone)
            ? (body.tone as ResponseTone)
            : undefined;
        const generateDraft = body.generateDraft !== false;

        const result = await orchestrateReviewAnalysis(
          {
            review: reviewValidation.data,
            business: businessValidation.data,
            tone,
            generateDraft,
          },
          { client: options.geminiClient }
        );

        res.json(result);
      } catch (err) {
        handleAiRouteError(err, res);
      }
    }
  );

  // On-demand Response Drafting Agent (tenant-verified)
  app.post(
    '/api/ai/generate-response',
    requireAuth,
    requireRole('BUSINESS_OWNER', 'BUSINESS_MANAGER'),
    requireTenantMember,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!(await ensureAiEnabled(req, res))) return;

        const body = (req.body ?? {}) as Record<string, unknown>;
        const businessValidation = validateBusinessInput((body.business ?? {}) as Record<string, unknown>);
        if (!businessValidation.valid) {
          res.status(400).json({ error: 'Invalid business context.', details: businessValidation.errors });
          return;
        }

        const reviewValidation = validateReviewInput((body.review ?? {}) as Record<string, unknown>);
        if (!reviewValidation.valid) {
          res.status(400).json({ error: 'Invalid review payload.', details: reviewValidation.errors });
          return;
        }

        const tone =
          typeof body.tone === 'string' && (RESPONSE_TONES as readonly string[]).includes(body.tone)
            ? (body.tone as ResponseTone)
            : 'professional';

        const reviewObj = (body.review ?? {}) as Record<string, unknown>;
        const sentiment =
          reviewObj.sentiment === 'positive' || reviewObj.sentiment === 'neutral' || reviewObj.sentiment === 'negative'
            ? reviewObj.sentiment
            : undefined;
        const categories = Array.isArray(reviewObj.categories)
          ? reviewObj.categories.filter((c): c is string => typeof c === 'string').slice(0, 8)
          : undefined;

        const result = await runResponseAgent(
          {
            review: {
              ...reviewValidation.data,
              sentiment,
              categories,
            },
            business: businessValidation.data,
            tone,
          },
          options.geminiClient
        );

        res.json(result);
      } catch (err) {
        handleAiRouteError(err, res);
      }
    }
  );

  // Batch AI Analysis (tenant-verified, max 20 per request)
  app.post(
    '/api/ai/analyze-batch',
    requireAuth,
    requireRole('BUSINESS_OWNER', 'BUSINESS_MANAGER'),
    requireTenantMember,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!(await ensureAiEnabled(req, res))) return;

        const body = (req.body ?? {}) as Record<string, unknown>;
        const businessValidation = validateBusinessInput((body.business ?? {}) as Record<string, unknown>);
        if (!businessValidation.valid) {
          res.status(400).json({ error: 'Invalid business context.', details: businessValidation.errors });
          return;
        }

        if (!Array.isArray(body.reviews) || body.reviews.length === 0) {
          res.status(400).json({ error: 'At least one review is required for batch analysis.' });
          return;
        }

        if (body.reviews.length > 20) {
          res.status(400).json({ error: 'Batch analysis supports up to 20 reviews per request.' });
          return;
        }

        const validItems: { reviewId: string; review: ReviewInput }[] = [];

        for (const rawItem of body.reviews) {
          if (!rawItem || typeof rawItem !== 'object') {
            res.status(400).json({ error: 'Each batch item must be an object with reviewId and review fields.' });
            return;
          }
          const item = rawItem as Record<string, unknown>;
          if (!isValidFirestoreId(item.reviewId)) {
            res.status(400).json({ error: 'Invalid reviewId in batch item.' });
            return;
          }
          const rv = validateReviewInput(item);
          if (!rv.valid) {
            res.status(400).json({ error: 'Invalid review item in batch.', details: rv.errors });
            return;
          }
          validItems.push({ reviewId: item.reviewId, review: rv.data });
        }

        const tone =
          typeof body.tone === 'string' && (RESPONSE_TONES as readonly string[]).includes(body.tone)
            ? (body.tone as ResponseTone)
            : undefined;

        const results = await orchestrateBatchAnalysis(
          validItems,
          businessValidation.data,
          tone,
          { client: options.geminiClient }
        );

        res.json({ results });
      } catch (err) {
        handleAiRouteError(err, res);
      }
    }
  );

  return app;
}

function handleAiRouteError(err: unknown, res: Response) {
  if (err instanceof GeminiConfigurationError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof GeminiUpstreamError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'AI processing failed.';
  res.status(500).json({ error: message });
}
