import { readFileSync } from 'node:fs';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { computeDashboardAnalytics } from '../src/shared/validation.ts';

const PROJECT_ID = 'demo-reviewguard';
const BUSINESS_A = 'business-a';
const BUSINESS_B = 'business-b';
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const MANAGER_A = 'manager-a';

let testEnv: RulesTestEnvironment;

const claims = { email_verified: true };

function reviewDocument(ownerId: string, businessId: string) {
  const timestamp = Timestamp.fromDate(new Date('2025-01-01T00:00:00.000Z'));
  return {
    ownerId,
    businessId,
    authorName: 'Customer',
    rating: 2,
    text: 'The service took too long.',
    reviewDate: '2025-01-01',
    source: 'manual',
    sentiment: 'pending',
    sentimentScore: 0,
    categories: [],
    isCritical: false,
    criticalReason: '',
    aiSummary: '',
    aiDraftResponse: '',
    responseTone: 'professional',
    responseStatus: 'unanswered',
    publishedResponse: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function seedBusiness(
  businessId: string,
  ownerId: string,
  managerId?: string,
  managerCanApproveReplies = false
) {
  const timestamp = Timestamp.fromDate(new Date('2025-01-01T00:00:00.000Z'));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'users', ownerId), {
      uid: ownerId,
      role: 'BUSINESS_OWNER',
      status: 'active',
    });
    await setDoc(doc(firestore, 'businesses', businessId), {
      ownerId,
      status: 'active',
    });
    await setDoc(doc(firestore, 'business_members', `${businessId}__${ownerId}`), {
      businessId,
      userId: ownerId,
      ownerId,
      role: 'BUSINESS_OWNER',
      status: 'active',
      canApproveReplies: true,
      businessName: 'Test Business',
      email: `${ownerId}@example.test`,
      displayName: 'Business Owner',
      invitedBy: ownerId,
      inviteId: 'owner',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await setDoc(
      doc(firestore, 'businesses', businessId, 'reviews', 'review-1'),
      reviewDocument(ownerId, businessId)
    );
    if (managerId) {
      await setDoc(doc(firestore, 'users', managerId), {
        uid: managerId,
        role: 'BUSINESS_MANAGER',
        status: 'active',
      });
      await setDoc(doc(firestore, 'business_members', `${businessId}__${managerId}`), {
        businessId,
        userId: managerId,
        ownerId,
        role: 'BUSINESS_MANAGER',
        status: 'active',
        canApproveReplies: managerCanApproveReplies,
        businessName: 'Test Business',
        email: `${managerId}@example.test`,
        displayName: 'Business Manager',
        invitedBy: ownerId,
        inviteId: 'manager-invite',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  });
}

function analysisPatch() {
  return {
    sentiment: 'negative',
    sentimentScore: -0.75,
    categories: ['Wait Time'],
    isCritical: true,
    criticalReason: 'Significant service delay.',
    aiSummary: 'The customer reports a long wait.',
    aiDraftResponse: 'We are sorry about the delay.',
    responseTone: 'apologetic',
    responseStatus: 'drafted',
    updatedAt: serverTimestamp(),
  };
}

async function updateAnalysis(uid: string, businessId: string) {
  const firestore = testEnv.authenticatedContext(uid, claims).firestore();
  return updateDoc(
    doc(firestore, 'businesses', businessId, 'reviews', 'review-1'),
    analysisPatch()
  );
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBusiness(BUSINESS_A, OWNER_A, MANAGER_A);
  await seedBusiness(BUSINESS_B, OWNER_B);
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore review authorization', () => {
  it('allows an active business owner to save Gemini analysis results', async () => {
    await assertSucceeds(updateAnalysis(OWNER_A, BUSINESS_A));

    const firestore = testEnv.authenticatedContext(OWNER_A, claims).firestore();
    const reviewSnapshot = await getDoc(
      doc(firestore, 'businesses', BUSINESS_A, 'reviews', 'review-1')
    );
    expect(reviewSnapshot.exists()).toBe(true);
    const savedReview = reviewSnapshot.data()!;
    expect(savedReview.sentiment).toBe('negative');
    expect(savedReview.categories).toEqual(['Wait Time']);
    const dashboard = computeDashboardAnalytics([{
      id: reviewSnapshot.id,
      ownerId: savedReview.ownerId,
      businessId: savedReview.businessId,
      authorName: savedReview.authorName,
      rating: savedReview.rating,
      text: savedReview.text,
      reviewDate: savedReview.reviewDate,
      source: savedReview.source,
      sentiment: savedReview.sentiment,
      sentimentScore: savedReview.sentimentScore,
      categories: savedReview.categories,
      isCritical: savedReview.isCritical,
      criticalReason: savedReview.criticalReason,
      aiSummary: savedReview.aiSummary,
      aiDraftResponse: savedReview.aiDraftResponse,
      responseTone: savedReview.responseTone,
      responseStatus: savedReview.responseStatus,
      publishedResponse: savedReview.publishedResponse,
      createdAtMs: 0,
      updatedAtMs: 0,
    }]);

    expect(dashboard.sentimentCounts.negative).toBe(1);
    expect(dashboard.complaintCategories).toContainEqual({
      category: 'Wait Time',
      count: 1,
      negativeCount: 1,
    });
  });

  it('allows an active manager to save analysis without reply-approval permission', async () => {
    await assertSucceeds(updateAnalysis(MANAGER_A, BUSINESS_A));
  });

  it('denies a manager from another business updating the review', async () => {
    await assertFails(updateAnalysis(MANAGER_A, BUSINESS_B));
  });

  it('requires the membership to retain the manager role and tenant owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'business_members', `${BUSINESS_A}__${MANAGER_A}`),
        {
          businessId: BUSINESS_A,
          userId: MANAGER_A,
          ownerId: OWNER_B,
          role: 'BUSINESS_OWNER',
          status: 'active',
          canApproveReplies: true,
        }
      );
    });

    await assertFails(updateAnalysis(MANAGER_A, BUSINESS_A));
  });

  it('denies review updates for a suspended business', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'businesses', BUSINESS_A), {
        ownerId: OWNER_A,
        status: 'suspended',
      });
    });

    await assertFails(updateAnalysis(OWNER_A, BUSINESS_A));
  });

  it('denies review analysis when the authenticated user account is suspended', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', OWNER_A), {
        uid: OWNER_A,
        role: 'BUSINESS_OWNER',
        status: 'suspended',
      });
    });

    await assertFails(updateAnalysis(OWNER_A, BUSINESS_A));
  });

  it('denies review ownership, tenant, ID, and privileged-role field changes', async () => {
    const firestore = testEnv.authenticatedContext(OWNER_A, claims).firestore();
    const reviewRef = doc(firestore, 'businesses', BUSINESS_A, 'reviews', 'review-1');

    await assertFails(updateDoc(reviewRef, { ownerId: 'other-owner', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(reviewRef, { businessId: BUSINESS_B, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(reviewRef, { reviewId: 'other-review', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(reviewRef, { role: 'SUPER_ADMIN', updatedAt: serverTimestamp() }));
  });

  it('requires explicit manager permission to approve a reply', async () => {
    const firestore = testEnv.authenticatedContext(MANAGER_A, claims).firestore();
    const reviewRef = doc(firestore, 'businesses', BUSINESS_A, 'reviews', 'review-1');

    await assertFails(updateDoc(reviewRef, {
      aiDraftResponse: 'A proposed public reply.',
      responseStatus: 'published',
      publishedResponse: 'A proposed public reply.',
      updatedAt: serverTimestamp(),
    }));
  });

  it('allows a manager with reply-approval permission to publish a reply', async () => {
    await seedBusiness(BUSINESS_A, OWNER_A, MANAGER_A, true);
    const firestore = testEnv.authenticatedContext(MANAGER_A, claims).firestore();
    const reviewRef = doc(firestore, 'businesses', BUSINESS_A, 'reviews', 'review-1');

    await assertSucceeds(updateDoc(reviewRef, {
      aiDraftResponse: 'A proposed public reply.',
      responseStatus: 'published',
      publishedResponse: 'A proposed public reply.',
      updatedAt: serverTimestamp(),
    }));
  });
});
