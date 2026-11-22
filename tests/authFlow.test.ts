import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const queries: Array<{ path: string; field: string; value: unknown }> = [];

  return {
    docs,
    queries,
    reset() {
      docs.clear();
      queries.length = 0;
    },
    doc: (_db: unknown, ...segments: string[]) => ({
      path: segments.join('/'),
      id: segments[segments.length - 1],
    }),
    collection: (_db: unknown, ...segments: string[]) => ({
      path: segments.join('/'),
    }),
    query: (col: { path: string }, cond: { field: string; value: unknown }) => ({
      path: col.path,
      field: cond.field,
      value: cond.value,
    }),
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    serverTimestamp: () => ({ toMillis: () => 1700000000000 }),
    getDoc: vi.fn(async (ref: { path: string }) => {
      const data = docs.get(ref.path);
      return {
        exists: () => data !== undefined,
        id: ref.path.split('/').pop() ?? '',
        data: () => data,
      };
    }),
    getDocs: vi.fn(async (q: { path: string; field: string; value: unknown }) => {
      queries.push(q);
      const matched: Array<{ id: string; data: () => Record<string, unknown> }> = [];
      for (const [docPath, data] of docs.entries()) {
        if (docPath.startsWith(`${q.path}/`) && data[q.field] === q.value) {
          matched.push({
            id: docPath.split('/').pop() ?? '',
            data: () => data,
          });
        }
      }
      return { docs: matched };
    }),
    setDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      docs.set(ref.path, { ...data });
    }),
    updateDoc: vi.fn(async (ref: { path: string }, patch: Record<string, unknown>) => {
      const existing = docs.get(ref.path) ?? {};
      docs.set(ref.path, { ...existing, ...patch });
    }),
    deleteDoc: vi.fn(async (ref: { path: string }) => {
      docs.delete(ref.path);
    }),
    writeBatch: vi.fn(() => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          ops.push(() => docs.set(ref.path, { ...data }));
        },
        update: (ref: { path: string }, patch: Record<string, unknown>) => {
          ops.push(() => {
            const existing = docs.get(ref.path) ?? {};
            docs.set(ref.path, { ...existing, ...patch });
          });
        },
        commit: async () => {
          for (const op of ops) op();
        },
      };
    }),
    onSnapshot: vi.fn(() => () => {}),
    Timestamp: class MockTimestamp {
      private ms: number;
      constructor(ms: number) {
        this.ms = ms;
      }
      toMillis() {
        return this.ms;
      }
    },
  };
});

vi.mock('firebase/firestore', () => firestoreMocks);

vi.mock('../src/lib/firebase.ts', () => ({
  db: {},
  auth: { currentUser: null },
  OperationType: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
  },
  handleFirestoreError: (err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  },
}));

import {
  acceptBusinessInvite,
  ensureUserProfileAndMigrate,
  migrateLegacyBusinessIfNeeded,
} from '../src/services/firestoreService.ts';

describe('Authentication, Registration & Role Preservation Flows', () => {
  beforeEach(() => {
    firestoreMocks.reset();
    vi.clearAllMocks();
  });

  it('assigns BUSINESS_OWNER to a brand new user with no pending manager invites', async () => {
    const profile = await ensureUserProfileAndMigrate(
      'uid_new_owner',
      'NewOwner@Example.com',
      'New Owner'
    );

    expect(profile.role).toBe('BUSINESS_OWNER');
    expect(profile.status).toBe('active');
    expect(profile.email).toBe('newowner@example.com');
    expect(firestoreMocks.docs.get('users/uid_new_owner')?.role).toBe('BUSINESS_OWNER');
  });

  it('assigns BUSINESS_MANAGER when a newly registered user has a pending invite', async () => {
    firestoreMocks.docs.set('business_invites/inv_100', {
      businessId: 'biz_1',
      businessName: 'Harbor Cafe',
      ownerId: 'uid_owner_1',
      email: 'invited.mgr@example.com',
      role: 'BUSINESS_MANAGER',
      canApproveReplies: false,
      status: 'pending',
      invitedBy: 'uid_owner_1',
    });

    const profile = await ensureUserProfileAndMigrate(
      'uid_new_mgr',
      'Invited.Mgr@Example.com',
      'Invited Manager'
    );

    expect(profile.role).toBe('BUSINESS_MANAGER');
    expect(profile.status).toBe('active');

    await acceptBusinessInvite(
      {
        id: 'inv_100',
        businessId: 'biz_1',
        businessName: 'Harbor Cafe',
        ownerId: 'uid_owner_1',
        email: 'invited.mgr@example.com',
        role: 'BUSINESS_MANAGER',
        canApproveReplies: false,
        status: 'pending',
        invitedBy: 'uid_owner_1',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
      'uid_new_mgr',
      'Invited Manager'
    );

    expect(firestoreMocks.docs.get('business_invites/inv_100')?.status).toBe('accepted');
    expect(firestoreMocks.docs.get('business_members/biz_1__uid_new_mgr')).toMatchObject({
      businessId: 'biz_1',
      userId: 'uid_new_mgr',
      role: 'BUSINESS_MANAGER',
      status: 'active',
      canApproveReplies: false,
    });
  });

  it('never overwrites an existing BUSINESS_OWNER, BUSINESS_MANAGER, or SUPER_ADMIN role on login', async () => {
    firestoreMocks.docs.set('users/uid_existing_mgr', {
      uid: 'uid_existing_mgr',
      email: 'mgr@example.com',
      displayName: 'Existing Manager',
      role: 'BUSINESS_MANAGER',
      status: 'active',
    });

    firestoreMocks.docs.set('users/uid_existing_owner', {
      uid: 'uid_existing_owner',
      email: 'owner@example.com',
      displayName: 'Existing Owner',
      role: 'BUSINESS_OWNER',
      status: 'active',
    });

    firestoreMocks.docs.set('admins/uid_existing_admin', {
      uid: 'uid_existing_admin',
      email: 'admin@example.com',
      provisionedBy: 'system_bootstrap',
    });
    firestoreMocks.docs.set('users/uid_existing_admin', {
      uid: 'uid_existing_admin',
      email: 'admin@example.com',
      displayName: 'Platform Admin',
      role: 'SUPER_ADMIN',
      status: 'active',
    });

    const mgr = await ensureUserProfileAndMigrate('uid_existing_mgr', 'mgr@example.com', 'Updated Name');
    const owner = await ensureUserProfileAndMigrate('uid_existing_owner', 'owner@example.com', 'Owner');
    const admin = await ensureUserProfileAndMigrate('uid_existing_admin', 'admin@example.com', 'Admin');

    expect(mgr.role).toBe('BUSINESS_MANAGER');
    expect(owner.role).toBe('BUSINESS_OWNER');
    expect(admin.role).toBe('SUPER_ADMIN');
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it('preserves an existing role if a legacy user record is only missing status', async () => {
    firestoreMocks.docs.set('users/uid_partial_mgr', {
      uid: 'uid_partial_mgr',
      email: 'partial.mgr@example.com',
      displayName: 'Partial Manager',
      role: 'BUSINESS_MANAGER',
    });

    const migrated = await ensureUserProfileAndMigrate(
      'uid_partial_mgr',
      'partial.mgr@example.com',
      'Partial Manager'
    );

    expect(migrated.role).toBe('BUSINESS_MANAGER');
    expect(migrated.status).toBe('active');
    expect(firestoreMocks.docs.get('users/uid_partial_mgr')?.role).toBe('BUSINESS_MANAGER');
  });

  it('safely backfills legacy business owner membership without altering existing businesses', async () => {
    await migrateLegacyBusinessIfNeeded(
      {
        id: 'biz_legacy',
        ownerId: 'uid_legacy_owner',
        name: 'Legacy Bakery',
        category: 'Restaurant & Cafe',
        city: 'Seattle',
        address: '10 Main St',
        description: 'Sourdough bakery',
        status: 'active',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
      'legacy@example.com',
      'Legacy Owner'
    );

    expect(firestoreMocks.docs.get('business_members/biz_legacy__uid_legacy_owner')).toMatchObject({
      businessId: 'biz_legacy',
      ownerId: 'uid_legacy_owner',
      userId: 'uid_legacy_owner',
      role: 'BUSINESS_OWNER',
      canApproveReplies: true,
      status: 'active',
      inviteId: 'owner',
    });
  });
});
