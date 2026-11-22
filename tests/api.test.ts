import type { GenerateContentResponse } from '@google/genai';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GenAiClientLike } from '../server/agents/geminiClient.ts';
import { createApp } from '../server/app.ts';

import type { TenantDataStore } from '../server/services/firestoreRest.ts';
import type {
  BusinessMemberRecord,
  BusinessRecord,
  PlatformSettingsRecord,
  UserProfileRecord,
} from '../src/shared/validation.ts';

const mockGemini: GenAiClientLike = {
  models: {
    generateContent: async (params) => {
      const contents = String(params.contents ?? '');
      if (contents.includes('Requested Response Tone:')) {
        return {
          text: JSON.stringify({
            draftResponse: 'Thank you for your feedback! We appreciate you visiting Harbor Hearth.',
            actionItems: ['Review shift notes'],
          }),
        } as unknown as GenerateContentResponse;
      }
      return {
        text: JSON.stringify({
          sentiment: 'positive',
          sentimentScore: 0.88,
          categories: ['Atmosphere'],
          isCritical: false,
          criticalReason: '',
          aiSummary: 'Customer praised the atmosphere.',
          draftResponse: 'Thank you for your feedback! We appreciate you visiting Harbor Hearth.',
          actionItems: ['Share feedback with team'],
        }),
      } as unknown as GenerateContentResponse;
    },
  },
};

function createTestTenantStore(): TenantDataStore {
  const users = new Map<string, UserProfileRecord>([
    [
      'user_123',
      {
        uid: 'user_123',
        email: 'owner@test.local',
        displayName: 'Test Owner',
        role: 'BUSINESS_OWNER',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
  ]);

  const businesses = new Map<string, BusinessRecord>([
    [
      'biz_123',
      {
        id: 'biz_123',
        ownerId: 'user_123',
        name: 'Harbor Hearth',
        category: 'Restaurant & Cafe',
        city: 'Seattle',
        address: '412 Western Ave',
        description: 'Wood-fired kitchen.',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
  ]);

  const memberships = new Map<string, BusinessMemberRecord>();
  const admins = new Set<string>();
  const settings: PlatformSettingsRecord = {
    id: 'global',
    platformName: 'ReviewGuard AI',
    allowNewBusinessRegistration: true,
    maxBusinessesPerOwner: 10,
    aiAnalysisEnabled: true,
    maintenanceMode: false,
    updatedBy: 'system',
    updatedAtMs: 1000,
  };

  return {
    async isAdmin(uid) {
      return admins.has(uid);
    },
    async getUserProfile(uid) {
      return users.get(uid) ?? null;
    },
    async createAdminAndPromoteUser(uid, email, displayName) {
      admins.add(uid);
      users.set(uid, {
        uid,
        email,
        displayName,
        role: 'SUPER_ADMIN',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: Date.now(),
      });
    },
    async getBusiness(businessId) {
      return businesses.get(businessId) ?? null;
    },
    async getBusinessMembership(businessId, uid) {
      return memberships.get(`${businessId}__${uid}`) ?? null;
    },
    async getPlatformSettings() {
      return settings;
    },
  };
}

describe('Express API routes & auth enforcement', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const app = createApp({
      tokenVerifier: async (token) => {
        if (token === 'valid-token') {
          return { uid: 'user_123', email: 'owner@test.local', emailVerified: true };
        }
        if (token === 'unverified-token') {
          return { uid: 'user_999', email: 'unverified@test.local', emailVerified: false };
        }
        throw new Error('Invalid token');
      },
      geminiClient: mockGemini,
      tenantStore: createTestTenantStore(),
    });

    await new Promise<void>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        closeServer = () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          });
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (closeServer) await closeServer();
  });

  it('responds to /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/ai/analyze-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: 'biz_123' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unverified email accounts with 403', async () => {
    const res = await fetch(`${baseUrl}/api/ai/analyze-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer unverified-token',
      },
      body: JSON.stringify({ businessId: 'biz_123' }),
    });
    expect(res.status).toBe(403);
  });

  it('parses multipart CSV files in memory for authenticated tenant members', async () => {
    const form = new FormData();
    const csvBlob = new Blob(
      ['author,rating,date,text\nAlex,5,2026-11-18,"Great ambiance and fast service."'],
      { type: 'text/csv' }
    );
    form.append('businessId', 'biz_123');
    form.append('file', csvBlob, 'reviews.csv');

    const res = await fetch(`${baseUrl}/api/reviews/parse-csv?businessId=biz_123`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
      body: form,
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { validRows: Array<{ authorName: string; rating: number }> };
    expect(data.validRows).toHaveLength(1);
    expect(data.validRows[0].authorName).toBe('Alex');
    expect(data.validRows[0].rating).toBe(5);
  });

  it('validates payloads and runs AI analysis pipeline on /api/ai/analyze-review', async () => {
    const badRes = await fetch(`${baseUrl}/api/ai/analyze-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ businessId: 'biz_123', business: {}, review: {} }),
    });
    expect(badRes.status).toBe(400);

    const okRes = await fetch(`${baseUrl}/api/ai/analyze-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        businessId: 'biz_123',
        business: {
          name: 'Harbor Hearth',
          category: 'Restaurant & Cafe',
          city: 'Seattle',
          address: '412 Western Ave',
          description: 'Wood-fired kitchen.',
        },
        review: {
          authorName: 'Taylor',
          rating: 5,
          text: 'Loved the cozy atmosphere.',
          reviewDate: '2026-11-18',
          source: 'manual',
        },
      }),
    });

    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as { sentiment: string; aiDraftResponse: string };
    expect(body.sentiment).toBe('positive');
    expect(body.aiDraftResponse).toContain('Thank you');
  });
});
