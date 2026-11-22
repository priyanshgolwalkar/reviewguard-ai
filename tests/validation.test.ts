import { describe, expect, it } from 'vitest';
import {
  computeDashboardAnalytics,
  filterReviews,
  generateSafeId,
  isValidFirestoreId,
  validateBusinessInput,
  validateReviewInput,
  type ReviewRecord,
} from '../src/shared/validation.ts';

describe('validation & analytics', () => {
  it('validates and sanitizes valid business profiles', () => {
    const res = validateBusinessInput({
      name: '  Harbor Hearth Bistro  ',
      category: 'Restaurant & Cafe',
      city: 'Seattle',
      address: '412 Western Ave',
      description: 'Wood-fired coastal kitchen.\u0000',
    });

    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.data.name).toBe('Harbor Hearth Bistro');
      expect(res.data.description).toBe('Wood-fired coastal kitchen.');
    }
  });

  it('rejects incomplete business profiles', () => {
    const res = validateBusinessInput({
      name: 'A',
      category: '',
      city: 'S',
      address: '',
      description: '',
    });

    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.errors.name).toBeDefined();
      expect(res.errors.category).toBeDefined();
      expect(res.errors.city).toBeDefined();
      expect(res.errors.address).toBeDefined();
      expect(res.errors.description).toBeDefined();
    }
  });

  it('validates review inputs and clamps boundaries', () => {
    const valid = validateReviewInput({
      authorName: 'Jordan Lee',
      rating: 4,
      text: 'Great service and warm coffee.',
      reviewDate: '2026-11-18',
      source: 'google',
    });
    expect(valid.valid).toBe(true);

    const badRating = validateReviewInput({
      authorName: 'Jordan Lee',
      rating: 7,
      text: 'Invalid rating.',
      reviewDate: '2026-11-18',
      source: 'manual',
    });
    expect(badRating.valid).toBe(false);
  });

  it('generates and validates safe Firestore IDs', () => {
    const bizId = generateSafeId('biz');
    expect(isValidFirestoreId(bizId)).toBe(true);
    expect(isValidFirestoreId('bad/id/slash')).toBe(false);
    expect(isValidFirestoreId('')).toBe(false);
  });

  it('filters reviews accurately across critical and sentiment categories', () => {
    const testReviews: ReviewRecord[] = [
      {
        id: 'r-crit-neg',
        ownerId: 'u1',
        businessId: 'b1',
        authorName: 'Dan',
        rating: 1,
        text: 'Food poisoning and rude cashier.',
        reviewDate: '2026-11-20',
        source: 'google',
        sentiment: 'negative',
        sentimentScore: -0.9,
        categories: ['Hygiene'],
        isCritical: true,
        criticalReason: 'Food poisoning report',
        aiSummary: 'Reported illness',
        aiDraftResponse: 'Sorry',
        responseTone: 'apologetic',
        responseStatus: 'unanswered',
        publishedResponse: '',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        id: 'r-crit-pos',
        ownerId: 'u1',
        businessId: 'b1',
        authorName: 'VIP Guest',
        rating: 5,
        text: 'Presidential suite had a medical emergency, staff saved the day!',
        reviewDate: '2026-11-20',
        source: 'google',
        sentiment: 'positive',
        sentimentScore: 0.95,
        categories: ['Service'],
        isCritical: true,
        criticalReason: 'Medical incident requiring management follow-up',
        aiSummary: 'Critical incident handled well',
        aiDraftResponse: 'Glad everyone is safe',
        responseTone: 'warm',
        responseStatus: 'published',
        publishedResponse: 'Glad everyone is safe',
        createdAtMs: 2,
        updatedAtMs: 2,
      },
      {
        id: 'r-norm-neut',
        ownerId: 'u1',
        businessId: 'b1',
        authorName: 'Alex',
        rating: 3,
        text: 'Average experience overall.',
        reviewDate: '2026-11-20',
        source: 'yelp',
        sentiment: 'neutral',
        sentimentScore: 0,
        categories: ['General'],
        isCritical: false,
        criticalReason: '',
        aiSummary: 'Average',
        aiDraftResponse: '',
        responseTone: 'professional',
        responseStatus: 'unanswered',
        publishedResponse: '',
        createdAtMs: 3,
        updatedAtMs: 3,
      },
      {
        id: 'r-pending',
        ownerId: 'u1',
        businessId: 'b1',
        authorName: 'Pending User',
        rating: 2,
        text: 'Waiting for AI processing.',
        reviewDate: '2026-11-20',
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
        createdAtMs: 4,
        updatedAtMs: 4,
      },
    ];

    // 1. Critical tab must show only isCritical === true reviews
    const critical = filterReviews(testReviews, 'critical');
    expect(critical.map((r) => r.id)).toEqual(['r-crit-neg', 'r-crit-pos']);

    // 2. Negative tab must show sentiment === 'negative' (including critical ones)
    const negative = filterReviews(testReviews, 'negative');
    expect(negative.map((r) => r.id)).toEqual(['r-crit-neg']);

    // 3. Positive tab must show sentiment === 'positive' (including critical ones)
    const positive = filterReviews(testReviews, 'positive');
    expect(positive.map((r) => r.id)).toEqual(['r-crit-pos']);

    // 4. Neutral tab must show sentiment === 'neutral'
    const neutral = filterReviews(testReviews, 'neutral');
    expect(neutral.map((r) => r.id)).toEqual(['r-norm-neut']);

    // 5. Pending reviews must NOT appear in positive, neutral, or negative
    expect(positive.some((r) => r.sentiment === 'pending')).toBe(false);
    expect(negative.some((r) => r.sentiment === 'pending')).toBe(false);
    expect(neutral.some((r) => r.sentiment === 'pending')).toBe(false);

    // 6. All tab must show all reviews
    expect(filterReviews(testReviews, 'all')).toHaveLength(4);

    // 8. Dashboard Analytics & Sentiment Distribution Verification
    const stats = computeDashboardAnalytics(testReviews);
    expect(stats.totalReviews).toBe(4);
    expect(stats.averageRating).toBe(2.75); // (1 + 5 + 3 + 2) / 4 = 11 / 4 = 2.75
    expect(stats.sentimentCounts.positive).toBe(1);
    expect(stats.sentimentCounts.neutral).toBe(1);
    expect(stats.sentimentCounts.negative).toBe(1);
    expect(stats.sentimentCounts.pending).toBe(1);
    expect(stats.criticalReviews.map((r) => r.id)).toContain('r-crit-neg');
    expect(stats.criticalReviews.map((r) => r.id)).toContain('r-crit-pos');
    expect(stats.responseRate).toBe(25); // 1 published out of 4 total = 25%
  });

  it('computes accurate dashboard analytics and complaint categories', () => {
    const sampleReviews: ReviewRecord[] = [
      {
        id: 'r1',
        ownerId: 'u1',
        businessId: 'b1',
        authorName: 'Alice',
        rating: 5,
        text: 'Amazing food',
        reviewDate: '2026-11-18',
        source: 'google',
        sentiment: 'positive',
        sentimentScore: 0.9,
        categories: ['Food Quality'],
        isCritical: false,
        criticalReason: '',
        aiSummary: 'Loved the food.',
        aiDraftResponse: 'Thank you!',
        responseTone: 'warm',
        responseStatus: 'published',
        publishedResponse: 'Thank you!',
        createdAtMs: 1000,
        updatedAtMs: 1000,
      },
      {
        id: 'r2',
        ownerId: 'u1',
        businessId: 'b1',
        authorName: 'Bob',
        rating: 1,
        text: 'Long wait time and cold soup.',
        reviewDate: '2026-11-19',
        source: 'yelp',
        sentiment: 'negative',
        sentimentScore: -0.85,
        categories: ['Wait Time', 'Food Quality'],
        isCritical: true,
        criticalReason: '1-star complaint about wait time.',
        aiSummary: 'Long wait and cold food.',
        aiDraftResponse: '',
        responseTone: 'apologetic',
        responseStatus: 'unanswered',
        publishedResponse: '',
        createdAtMs: 2000,
        updatedAtMs: 2000,
      },
    ];

    const analytics = computeDashboardAnalytics(sampleReviews);
    expect(analytics.totalReviews).toBe(2);
    expect(analytics.averageRating).toBe(3);
    expect(analytics.responseRate).toBe(50);
    expect(analytics.sentimentCounts.positive).toBe(1);
    expect(analytics.sentimentCounts.negative).toBe(1);
    expect(analytics.criticalReviews).toHaveLength(1);
    expect(analytics.criticalReviews[0].id).toBe('r2');
    expect(analytics.recentReviews[0].id).toBe('r2');
    expect(analytics.complaintCategories[0]).toEqual({
      category: 'Food Quality',
      count: 2,
      negativeCount: 1,
    });
    expect(analytics.complaintCategories[1]).toEqual({
      category: 'Wait Time',
      count: 1,
      negativeCount: 1,
    });
  });
});
