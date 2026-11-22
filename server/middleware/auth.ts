import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  canApproveBusinessReplies,
  isValidFirestoreId,
  type AccountStatus,
  type BusinessMemberRecord,
  type BusinessRecord,
  type UserRole,
} from '../../src/shared/validation.ts';
import { defaultTenantDataStore, type TenantDataStore } from '../services/firestoreRest.ts';

export interface VerifiedTokenIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

export interface AuthenticatedUser extends VerifiedTokenIdentity {
  role: UserRole;
  status: AccountStatus;
  idToken: string;
}

export interface TenantContext {
  business: BusinessRecord;
  membership: BusinessMemberRecord | null;
  isOwner: boolean;
  canApproveReplies: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
  tenantContext?: TenantContext;
}

export type TokenVerifier = (idToken: string) => Promise<VerifiedTokenIdentity>;

function loadFirebaseProjectId(): string | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    if (!parsed.projectId || parsed.projectId === 'remixed-project-id') {
      return null;
    }
    return parsed.projectId;
  } catch {
    return null;
  }
}

function getFirebaseAdminAuth() {
  const projectId = loadFirebaseProjectId();
  if (!projectId) {
    throw new Error('Firebase projectId is not configured in firebase-applet-config.json.');
  }
  const app = getApps().length ? getApp() : initializeApp({ projectId });
  return getAuth(app);
}

export const defaultTokenVerifier: TokenVerifier = async (idToken: string) => {
  const auth = getFirebaseAdminAuth();
  const decoded = await auth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email ?? '',
    emailVerified: Boolean(decoded.email_verified),
    displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
  };
};

export function createAuthMiddleware(
  verifier: TokenVerifier = defaultTokenVerifier,
  store: TenantDataStore = defaultTenantDataStore
) {
  return async function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token || token.length > 8192) {
      res.status(401).json({ error: 'Invalid authentication token format.' });
      return;
    }

    try {
      const identity = await verifier(token);
      if (!identity.emailVerified) {
        res.status(403).json({
          error: 'Email verification required before accessing workspace actions.',
        });
        return;
      }

      // Resolve authoritative role from trusted Firestore records, never from browser headers/body
      const isAdminDoc = await store.isAdmin(identity.uid, token);
      const userProfile = await store.getUserProfile(identity.uid, token);

      if (userProfile?.status === 'suspended' && !isAdminDoc) {
        res.status(403).json({
          error: 'Your account has been suspended by a platform administrator.',
        });
        return;
      }

      const role: UserRole = isAdminDoc
        ? 'SUPER_ADMIN'
        : userProfile?.role === 'BUSINESS_MANAGER'
          ? 'BUSINESS_MANAGER'
          : 'BUSINESS_OWNER';

      req.authUser = {
        ...identity,
        role,
        status: userProfile?.status ?? 'active',
        idToken: token,
      };
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token verification failed';
      res.status(401).json({ error: `Invalid or expired authentication token: ${message}` });
    }
  };
}

export function requireRole(...allowedRoles: UserRole[]) {
  return function enforceRole(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Forbidden: requires role ${allowedRoles.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

export function createTenantMembershipMiddleware(
  store: TenantDataStore = defaultTenantDataStore,
  options: { requireOwner?: boolean; requireApprovalPermission?: boolean } = {}
) {
  return async function requireBusinessMembership(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawBusinessId =
      body.businessId ?? req.params?.businessId ?? req.query?.businessId;

    if (!isValidFirestoreId(rawBusinessId)) {
      res.status(400).json({ error: 'Valid businessId is required for tenant verification.' });
      return;
    }

    try {
      const business = await store.getBusiness(rawBusinessId, req.authUser.idToken);
      if (!business) {
        res.status(403).json({
          error: 'Forbidden: business workspace not found or access denied.',
        });
        return;
      }

      if (business.status === 'suspended') {
        res.status(403).json({
          error: 'This business workspace is currently suspended by a platform administrator.',
        });
        return;
      }

      const isOwner = business.ownerId === req.authUser.uid;
      const membership = isOwner
        ? null
        : await store.getBusinessMembership(rawBusinessId, req.authUser.uid, req.authUser.idToken);

      const hasMembership = isOwner || (membership !== null && membership.status === 'active');

      if (!hasMembership) {
        res.status(403).json({
          error: 'Forbidden: you are not an active member of this business workspace.',
        });
        return;
      }

      if (options.requireOwner && !isOwner) {
        res.status(403).json({
          error: 'Forbidden: only the Business Owner can perform this operation.',
        });
        return;
      }

      const canApproveReplies = canApproveBusinessReplies(
        req.authUser.uid,
        business.ownerId,
        membership
      );

      if (options.requireApprovalPermission && !canApproveReplies) {
        res.status(403).json({
          error: 'Forbidden: explicit owner permission is required to approve or publish replies.',
        });
        return;
      }

      req.tenantContext = {
        business,
        membership,
        isOwner,
        canApproveReplies,
      };
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tenant membership verification failed.';
      res.status(500).json({ error: message });
    }
  };
}
