import type { GenerateContentResponse } from '@google/genai';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GenAiClientLike } from '../server/agents/geminiClient.ts';
import { createApp } from '../server/app.ts';
import type { TenantDataStore } from '../server/services/firestoreRest.ts';
import {
  canApproveBusinessReplies,
  canManageBusinessStaff,
  getDashboardRouteForRole,
  type BusinessMemberRecord,
  type BusinessRecord,
  type PlatformSettingsRecord,
  type UserProfileRecord,
} from '../src/shared/validation.ts';

const mockGemini: GenAiClientLike = {
  models: {
    generateContent: async (params) => {
      const contents = String(params.contents ?? '');
      if (contents.includes('Requested Response Tone:')) {
        return {
          text: JSON.stringify({
            draftResponse: 'Thank you for your visit. We appreciate your thoughtful feedback.',
            actionItems: ['Share feedback with team'],
          }),
        } as unknown as GenerateContentResponse;
      }
      return {
        text: JSON.stringify({
          sentiment: 'positive',
          sentimentScore: 0.9,
          categories: ['Service'],
          isCritical: false,
          criticalReason: '',
          aiSummary: 'Positive customer experience.',
          draftResponse: 'Thank you for your visit. We appreciate your thoughtful feedback.',
          actionItems: ['Share feedback with team'],
        }),
      } as unknown as GenerateContentResponse;
    },
  },
};

function createStatefulMockStore() {
  const admins = new Set<string>(['uid_admin']);
  const users = new Map<string, UserProfileRecord>([
    [
      'uid_admin',
      {
        uid: 'uid_admin',
        email: 'admin@reviewguard.test',
        displayName: 'Platform Admin',
        role: 'SUPER_ADMIN',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'uid_owner_a',
      {
        uid: 'uid_owner_a',
        email: 'ownera@test.local',
        displayName: 'Owner A',
        role: 'BUSINESS_OWNER',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'uid_owner_b',
      {
        uid: 'uid_owner_b',
        email: 'ownerb@test.local',
        displayName: 'Owner B',
        role: 'BUSINESS_OWNER',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'uid_mgr_draft',
      {
        uid: 'uid_mgr_draft',
        email: 'mgrdraft@test.local',
        displayName: 'Draft Manager',
        role: 'BUSINESS_MANAGER',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'uid_mgr_approve',
      {
        uid: 'uid_mgr_approve',
        email: 'mgrapprove@test.local',
        displayName: 'Approver Manager',
        role: 'BUSINESS_MANAGER',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'uid_mgr_revoked',
      {
        uid: 'uid_mgr_revoked',
        email: 'mgrrevoked@test.local',
        displayName: 'Revoked Manager',
        role: 'BUSINESS_MANAGER',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'uid_suspended_user',
      {
        uid: 'uid_suspended_user',
        email: 'suspended@test.local',
        displayName: 'Suspended User',
        role: 'BUSINESS_OWNER',
        status: 'suspended',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
  ]);

  const businesses = new Map<string, BusinessRecord>([
    [
      'biz_a',
      {
        id: 'biz_a',
        ownerId: 'uid_owner_a',
        name: 'Alpha Bistro',
        category: 'Restaurant & Cafe',
        city: 'Seattle',
        address: '100 Pike St',
        description: 'Bistro A',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'biz_b',
      {
        id: 'biz_b',
        ownerId: 'uid_owner_b',
        name: 'Beta Hotel',
        category: 'Hospitality & Hotel',
        city: 'Portland',
        address: '200 Oak St',
        description: 'Hotel B',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'biz_suspended',
      {
        id: 'biz_suspended',
        ownerId: 'uid_owner_a',
        name: 'Suspended Cafe',
        category: 'Restaurant & Cafe',
        city: 'Tacoma',
        address: '300 Bay St',
        description: 'Suspended workspace',
        status: 'suspended',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
  ]);

  const memberships = new Map<string, BusinessMemberRecord>([
    [
      'biz_a__uid_mgr_draft',
      {
        id: 'biz_a__uid_mgr_draft',
        businessId: 'biz_a',
        businessName: 'Alpha Bistro',
        ownerId: 'uid_owner_a',
        userId: 'uid_mgr_draft',
        email: 'mgrdraft@test.local',
        displayName: 'Draft Manager',
        role: 'BUSINESS_MANAGER',
        canApproveReplies: false,
        status: 'active',
        invitedBy: 'uid_owner_a',
        inviteId: 'inv_1',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'biz_a__uid_mgr_approve',
      {
        id: 'biz_a__uid_mgr_approve',
        businessId: 'biz_a',
        businessName: 'Alpha Bistro',
        ownerId: 'uid_owner_a',
        userId: 'uid_mgr_approve',
        email: 'mgrapprove@test.local',
        displayName: 'Approver Manager',
        role: 'BUSINESS_MANAGER',
        canApproveReplies: true,
        status: 'active',
        invitedBy: 'uid_owner_a',
        inviteId: 'inv_2',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
    [
      'biz_a__uid_mgr_revoked',
      {
        id: 'biz_a__uid_mgr_revoked',
        businessId: 'biz_a',
        businessName: 'Alpha Bistro',
        ownerId: 'uid_owner_a',
        userId: 'uid_mgr_revoked',
        email: 'mgrrevoked@test.local',
        displayName: 'Revoked Manager',
        role: 'BUSINESS_MANAGER',
        canApproveReplies: true,
        status: 'revoked',
        invitedBy: 'uid_owner_a',
        inviteId: 'inv_3',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
    ],
  ]);

  const settings: PlatformSettingsRecord = {
    id: 'global',
    platformName: 'ReviewGuard AI',
    allowNewBusinessRegistration: true,
    maxBusinessesPerOwner: 10,
    aiAnalysisEnabled: true,
    maintenanceMode: false,
    updatedBy: 'uid_admin',
    updatedAtMs: 1000,
  };

  const store: TenantDataStore = {
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

  return { store, admins, users, businesses, memberships };
}

const SAMPLE_BUSINESS_PAYLOAD = {
  name: 'Alpha Bistro',
  category: 'Restaurant & Cafe',
  city: 'Seattle',
  address: '100 Pike St',
  description: 'Wood-fired dining.',
};

const SAMPLE_REVIEW_PAYLOAD = {
  authorName: 'Jordan',
  rating: 5,
  text: 'Excellent food and warm service.',
  reviewDate: '2026-11-18',
  source: 'manual',
};

describe('Multi-Tenant RBAC & Security Verification', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;
  const mockState = createStatefulMockStore();

  beforeAll(async () => {
    const app = createApp({
      tokenVerifier: async (token) => {
        switch (token) {
          case 'token-admin':
            return { uid: 'uid_admin', email: 'admin@reviewguard.test', emailVerified: true };
          case 'token-bootstrap-candidate':
            return {
              uid: 'uid_new_admin',
              email: 'bootstrap@reviewguard.test',
              emailVerified: true,
              displayName: 'Provisioned Admin',
            };
          case 'token-owner-a':
            return { uid: 'uid_owner_a', email: 'ownera@test.local', emailVerified: true };
          case 'token-owner-b':
            return { uid: 'uid_owner_b', email: 'ownerb@test.local', emailVerified: true };
          case 'token-mgr-draft':
            return { uid: 'uid_mgr_draft', email: 'mgrdraft@test.local', emailVerified: true };
          case 'token-mgr-approve':
            return { uid: 'uid_mgr_approve', email: 'mgrapprove@test.local', emailVerified: true };
          case 'token-mgr-revoked':
            return { uid: 'uid_mgr_revoked', email: 'mgrrevoked@test.local', emailVerified: true };
          case 'token-suspended':
            return { uid: 'uid_suspended_user', email: 'suspended@test.local', emailVerified: true };
          case 'token-legacy-owner':
            return { uid: 'uid_legacy_no_doc', email: 'legacy@test.local', emailVerified: true };
          default:
            throw new Error('Invalid token');
        }
      },
      geminiClient: mockGemini,
      tenantStore: mockState.store,
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

  beforeEach(() => {
    delete process.env.SUPER_ADMIN_EMAIL;
    delete process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  });

  describe('1. Role Login, Authoritative Resolution & Redirects', () => {
    it('maps each role to its dedicated dashboard route', () => {
      expect(getDashboardRouteForRole('SUPER_ADMIN')).toBe('/admin');
      expect(getDashboardRouteForRole('BUSINESS_OWNER')).toBe('/owner');
      expect(getDashboardRouteForRole('BUSINESS_MANAGER')).toBe('/manager');
    });

    it('resolves SUPER_ADMIN, BUSINESS_OWNER, and BUSINESS_MANAGER from trusted server/Firestore state', async () => {
      const adminRes = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Authorization: 'Bearer token-admin' },
      });
      expect(adminRes.status).toBe(200);
      expect(await adminRes.json()).toMatchObject({
        uid: 'uid_admin',
        role: 'SUPER_ADMIN',
        status: 'active',
      });

      const ownerRes = await fetch(`${baseUrl}/api/auth/session`, {
        headers: {
          Authorization: 'Bearer token-owner-a',
          'x-role': 'SUPER_ADMIN', // Attempted client-side privilege escalation
        },
      });
      expect(ownerRes.status).toBe(200);
      expect(await ownerRes.json()).toMatchObject({
        uid: 'uid_owner_a',
        role: 'BUSINESS_OWNER',
      });

      const mgrRes = await fetch(`${baseUrl}/api/auth/session`, {
        headers: {
          Authorization: 'Bearer token-mgr-draft',
          'x-role': 'BUSINESS_OWNER',
        },
      });
      expect(mgrRes.status).toBe(200);
      expect(await mgrRes.json()).toMatchObject({
        uid: 'uid_mgr_draft',
        role: 'BUSINESS_MANAGER',
      });
    });

    it('defaults legacy users without a users/{uid} document safely to BUSINESS_OWNER', async () => {
      const legacyRes = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Authorization: 'Bearer token-legacy-owner' },
      });
      expect(legacyRes.status).toBe(200);
      expect(await legacyRes.json()).toMatchObject({
        uid: 'uid_legacy_no_doc',
        role: 'BUSINESS_OWNER',
        status: 'active',
      });
    });

    it('blocks suspended users during session/auth resolution', async () => {
      const res = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Authorization: 'Bearer token-suspended' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('2. Unauthorized Role Access', () => {
    it('blocks BUSINESS_OWNER and BUSINESS_MANAGER from admin-only endpoints', async () => {
      const ownerVerify = await fetch(`${baseUrl}/api/admin/verify`, {
        headers: { Authorization: 'Bearer token-owner-a' },
      });
      expect(ownerVerify.status).toBe(403);

      const mgrVerify = await fetch(`${baseUrl}/api/admin/verify`, {
        headers: { Authorization: 'Bearer token-mgr-approve' },
      });
      expect(mgrVerify.status).toBe(403);
    });

    it('blocks SUPER_ADMIN from executing tenant-only AI routes when not a business role', async () => {
      const res = await fetch(`${baseUrl}/api/ai/analyze-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-admin',
        },
        body: JSON.stringify({
          businessId: 'biz_a',
          business: SAMPLE_BUSINESS_PAYLOAD,
          review: SAMPLE_REVIEW_PAYLOAD,
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('3. Business Membership Checks', () => {
    it('allows active assigned BUSINESS_MANAGER to run AI analysis and draft replies for assigned business', async () => {
      const res = await fetch(`${baseUrl}/api/ai/analyze-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-mgr-draft',
        },
        body: JSON.stringify({
          businessId: 'biz_a',
          business: SAMPLE_BUSINESS_PAYLOAD,
          review: SAMPLE_REVIEW_PAYLOAD,
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { sentiment: string; aiDraftResponse: string };
      expect(data.sentiment).toBe('positive');
      expect(data.aiDraftResponse).toBeTruthy();
    });

    it('rejects revoked manager memberships with 403', async () => {
      const res = await fetch(`${baseUrl}/api/ai/analyze-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-mgr-revoked',
        },
        body: JSON.stringify({
          businessId: 'biz_a',
          business: SAMPLE_BUSINESS_PAYLOAD,
          review: SAMPLE_REVIEW_PAYLOAD,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects tenant operations against suspended businesses with 403', async () => {
      const res = await fetch(`${baseUrl}/api/ai/analyze-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-owner-a',
        },
        body: JSON.stringify({
          businessId: 'biz_suspended',
          business: SAMPLE_BUSINESS_PAYLOAD,
          review: SAMPLE_REVIEW_PAYLOAD,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('enforces staff management privilege strictly for Business Owner', () => {
      expect(canManageBusinessStaff('uid_owner_a', 'uid_owner_a')).toBe(true);
      expect(canManageBusinessStaff('uid_mgr_approve', 'uid_owner_a')).toBe(false);
    });
  });

  describe('4. Cross-Tenant Data Isolation', () => {
    it('blocks Owner A and Manager A from running AI analysis on Business B', async () => {
      const ownerCrossRes = await fetch(`${baseUrl}/api/ai/analyze-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-owner-a',
        },
        body: JSON.stringify({
          businessId: 'biz_b',
          business: SAMPLE_BUSINESS_PAYLOAD,
          review: SAMPLE_REVIEW_PAYLOAD,
        }),
      });
      expect(ownerCrossRes.status).toBe(403);

      const mgrCrossRes = await fetch(`${baseUrl}/api/ai/generate-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-mgr-approve',
        },
        body: JSON.stringify({
          businessId: 'biz_b',
          business: SAMPLE_BUSINESS_PAYLOAD,
          review: SAMPLE_REVIEW_PAYLOAD,
        }),
      });
      expect(mgrCrossRes.status).toBe(403);
    });

    it('blocks cross-tenant CSV parsing and reply approval attempts', async () => {
      const form = new FormData();
      form.append(
        'file',
        new Blob(['author,rating,date,text\nPat,4,2026-11-18,"Nice stay."'], { type: 'text/csv' }),
        'reviews.csv'
      );
      form.append('businessId', 'biz_b');

      const csvCrossRes = await fetch(`${baseUrl}/api/reviews/parse-csv?businessId=biz_b`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token-owner-a' },
        body: form,
      });
      expect(csvCrossRes.status).toBe(403);

      const approvalCrossRes = await fetch(`${baseUrl}/api/reviews/authorize-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-owner-a',
        },
        body: JSON.stringify({ businessId: 'biz_b' }),
      });
      expect(approvalCrossRes.status).toBe(403);
    });
  });

  describe('5. Admin-Only Operations & Secure Super Admin Provisioning', () => {
    it('allows verified existing SUPER_ADMIN on /api/admin/verify', async () => {
      const res = await fetch(`${baseUrl}/api/admin/verify`, {
        headers: { Authorization: 'Bearer token-admin' },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        authorized: true,
        role: 'SUPER_ADMIN',
        uid: 'uid_admin',
      });
    });

    it('prevents self-assignment of SUPER_ADMIN by non-bootstrap users', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'bootstrap@reviewguard.test';
      process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = 'top-secret-bootstrap-key';

      const ownerAttempt = await fetch(`${baseUrl}/api/admin/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-owner-a',
        },
        body: JSON.stringify({ bootstrapSecret: 'top-secret-bootstrap-key' }),
      });
      expect(ownerAttempt.status).toBe(403);
      expect(mockState.admins.has('uid_owner_a')).toBe(false);
    });

    it('rejects designated bootstrap email when secret does not match', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'bootstrap@reviewguard.test';
      process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = 'top-secret-bootstrap-key';

      const badSecretRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-bootstrap-candidate',
        },
        body: JSON.stringify({ bootstrapSecret: 'wrong-secret' }),
      });
      expect(badSecretRes.status).toBe(403);
      expect(mockState.admins.has('uid_new_admin')).toBe(false);
    });

    it('provisions initial SUPER_ADMIN only when server email & secret match', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'bootstrap@reviewguard.test';
      process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = 'top-secret-bootstrap-key';

      const okRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-bootstrap-candidate',
        },
        body: JSON.stringify({ bootstrapSecret: 'top-secret-bootstrap-key' }),
      });
      expect(okRes.status).toBe(200);
      expect(await okRes.json()).toMatchObject({
        role: 'SUPER_ADMIN',
        alreadyProvisioned: false,
      });
      expect(mockState.admins.has('uid_new_admin')).toBe(true);
      expect(mockState.users.get('uid_new_admin')?.role).toBe('SUPER_ADMIN');
    });
  });

  describe('6. Reply Approval Permissions', () => {
    it('evaluates owner and manager approval permissions accurately', () => {
      expect(canApproveBusinessReplies('uid_owner_a', 'uid_owner_a', null)).toBe(true);
      expect(
        canApproveBusinessReplies('uid_mgr_approve', 'uid_owner_a', {
          role: 'BUSINESS_MANAGER',
          status: 'active',
          canApproveReplies: true,
        })
      ).toBe(true);
      expect(
        canApproveBusinessReplies('uid_mgr_draft', 'uid_owner_a', {
          role: 'BUSINESS_MANAGER',
          status: 'active',
          canApproveReplies: false,
        })
      ).toBe(false);
      expect(
        canApproveBusinessReplies('uid_mgr_revoked', 'uid_owner_a', {
          role: 'BUSINESS_MANAGER',
          status: 'revoked',
          canApproveReplies: true,
        })
      ).toBe(false);
    });

    it('authorizes reply approval for Owner and permitted Manager, and blocks unpermitted Manager with 403', async () => {
      const ownerApproval = await fetch(`${baseUrl}/api/reviews/authorize-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-owner-a',
        },
        body: JSON.stringify({ businessId: 'biz_a' }),
      });
      expect(ownerApproval.status).toBe(200);
      expect(await ownerApproval.json()).toMatchObject({
        authorized: true,
        isOwner: true,
        canApproveReplies: true,
      });

      const mgrPermittedApproval = await fetch(`${baseUrl}/api/reviews/authorize-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-mgr-approve',
        },
        body: JSON.stringify({ businessId: 'biz_a' }),
      });
      expect(mgrPermittedApproval.status).toBe(200);
      expect(await mgrPermittedApproval.json()).toMatchObject({
        authorized: true,
        isOwner: false,
        canApproveReplies: true,
      });

      const mgrDeniedApproval = await fetch(`${baseUrl}/api/reviews/authorize-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-mgr-draft',
        },
        body: JSON.stringify({ businessId: 'biz_a' }),
      });
      expect(mgrDeniedApproval.status).toBe(403);
    });
  });
});
