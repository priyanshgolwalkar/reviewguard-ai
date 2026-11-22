export const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

export const USER_ROLES = ['SUPER_ADMIN', 'BUSINESS_OWNER', 'BUSINESS_MANAGER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const BUSINESS_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  categoryMin: 2,
  categoryMax: 60,
  cityMin: 2,
  cityMax: 80,
  addressMin: 2,
  addressMax: 240,
  descriptionMin: 1,
  descriptionMax: 1200,
} as const;

export const REVIEW_LIMITS = {
  authorNameMin: 1,
  authorNameMax: 100,
  ratingMin: 1,
  ratingMax: 5,
  textMin: 1,
  textMax: 4000,
  reviewDateMin: 4,
  reviewDateMax: 40,
  categoriesMax: 8,
  categoryItemMax: 60,
  criticalReasonMax: 300,
  aiSummaryMax: 500,
  aiDraftResponseMax: 3000,
  publishedResponseMax: 3000,
} as const;

export const REVIEW_SOURCES = ['manual', 'csv', 'google', 'yelp', 'tripadvisor', 'other'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const SENTIMENTS = ['positive', 'neutral', 'negative', 'pending'] as const;
export type ReviewSentiment = (typeof SENTIMENTS)[number];

export const RESPONSE_TONES = ['professional', 'warm', 'concise', 'apologetic'] as const;
export type ResponseTone = (typeof RESPONSE_TONES)[number];

export const RESPONSE_STATUSES = ['unanswered', 'drafted', 'published', 'rejected'] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

export const BUSINESS_CATEGORIES = [
  'Restaurant & Cafe',
  'Hospitality & Hotel',
  'Healthcare & Clinic',
  'Retail & E-Commerce',
  'Salon & Wellness',
  'Home & Auto Services',
  'Professional Services',
  'Fitness & Recreation',
  'Other',
] as const;

export interface UserProfileRecord {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface PlatformSettingsInput {
  platformName: string;
  allowNewBusinessRegistration: boolean;
  maxBusinessesPerOwner: number;
  aiAnalysisEnabled: boolean;
  maintenanceMode: boolean;
}

export interface PlatformSettingsRecord extends PlatformSettingsInput {
  id: string;
  updatedBy: string;
  updatedAtMs: number;
}

export interface BusinessInput {
  name: string;
  category: string;
  city: string;
  address: string;
  description: string;
}

export interface BusinessRecord extends BusinessInput {
  id: string;
  ownerId: string;
  status: AccountStatus;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BusinessMemberRecord {
  id: string;
  businessId: string;
  businessName: string;
  ownerId: string;
  userId: string;
  email: string;
  displayName: string;
  role: 'BUSINESS_OWNER' | 'BUSINESS_MANAGER';
  canApproveReplies: boolean;
  status: 'active' | 'revoked';
  invitedBy: string;
  inviteId: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BusinessInviteRecord {
  id: string;
  businessId: string;
  businessName: string;
  ownerId: string;
  email: string;
  role: 'BUSINESS_MANAGER';
  canApproveReplies: boolean;
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ReviewInput {
  authorName: string;
  rating: number;
  text: string;
  reviewDate: string;
  source: ReviewSource;
}

export interface ReviewRecord extends ReviewInput {
  id: string;
  ownerId: string;
  businessId: string;
  sentiment: ReviewSentiment;
  sentimentScore: number;
  categories: string[];
  isCritical: boolean;
  criticalReason: string;
  aiSummary: string;
  aiDraftResponse: string;
  responseTone: ResponseTone;
  responseStatus: ResponseStatus;
  publishedResponse: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AiAnalysisResult {
  sentiment: Exclude<ReviewSentiment, 'pending'>;
  sentimentScore: number;
  categories: string[];
  isCritical: boolean;
  criticalReason: string;
  aiSummary: string;
}

export interface AiDraftResult {
  aiDraftResponse: string;
  responseTone: ResponseTone;
  actionItems: string[];
}

export interface AgentPipelineResult extends AiAnalysisResult {
  aiDraftResponse: string;
  responseTone: ResponseTone;
  actionItems: string[];
}

export interface ParsedCsvReview {
  rowNumber: number;
  authorName: string;
  rating: number;
  text: string;
  reviewDate: string;
  source: ReviewSource;
}

export interface CsvRowError {
  rowNumber: number;
  message: string;
}

export interface CsvParseResult {
  totalRows: number;
  validRows: ParsedCsvReview[];
  errors: CsvRowError[];
  columnsDetected: string[];
}

export interface CategoryStat {
  category: string;
  count: number;
  negativeCount: number;
}

export interface DashboardAnalytics {
  totalReviews: number;
  averageRating: number;
  responseRate: number;
  sentimentCounts: {
    positive: number;
    neutral: number;
    negative: number;
    pending: number;
  };
  ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
  criticalReviews: ReviewRecord[];
  recentReviews: ReviewRecord[];
  complaintCategories: CategoryStat[];
}

export function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trim();
}

export function isValidFirestoreId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_PATTERN.test(id);
}

export function generateSafeId(prefix = 'id'): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'id';
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${cleanPrefix}_${rand}`.slice(0, 64);
}

export function normalizeReviewDate(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    return new Date().toISOString().slice(0, 10);
  }
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return trimmed;
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

export function normalizeReviewSource(raw: unknown): ReviewSource {
  if (typeof raw !== 'string') return 'other';
  const normalized = raw.trim().toLowerCase();
  if ((REVIEW_SOURCES as readonly string[]).includes(normalized)) {
    return normalized as ReviewSource;
  }
  if (normalized.includes('google')) return 'google';
  if (normalized.includes('yelp')) return 'yelp';
  if (normalized.includes('trip')) return 'tripadvisor';
  if (normalized.includes('csv')) return 'csv';
  if (normalized.includes('manual')) return 'manual';
  return 'other';
}

export function validateBusinessInput(
  raw: Partial<BusinessInput>
): { valid: true; data: BusinessInput } | { valid: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = sanitizeText(raw.name, BUSINESS_LIMITS.nameMax);
  const category = sanitizeText(raw.category, BUSINESS_LIMITS.categoryMax);
  const city = sanitizeText(raw.city, BUSINESS_LIMITS.cityMax);
  const address = sanitizeText(raw.address, BUSINESS_LIMITS.addressMax);
  const description = sanitizeText(raw.description, BUSINESS_LIMITS.descriptionMax);

  if (name.length < BUSINESS_LIMITS.nameMin) {
    errors.name = `Business name must be at least ${BUSINESS_LIMITS.nameMin} characters.`;
  }
  if (category.length < BUSINESS_LIMITS.categoryMin) {
    errors.category = `Category must be at least ${BUSINESS_LIMITS.categoryMin} characters.`;
  }
  if (city.length < BUSINESS_LIMITS.cityMin) {
    errors.city = `City must be at least ${BUSINESS_LIMITS.cityMin} characters.`;
  }
  if (address.length < BUSINESS_LIMITS.addressMin) {
    errors.address = `Address must be at least ${BUSINESS_LIMITS.addressMin} characters.`;
  }
  if (description.length < BUSINESS_LIMITS.descriptionMin) {
    errors.description = 'Business description is required.';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: { name, category, city, address, description },
  };
}

export function validateReviewInput(
  raw: Partial<ReviewInput>
): { valid: true; data: ReviewInput } | { valid: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const authorName = sanitizeText(raw.authorName, REVIEW_LIMITS.authorNameMax);
  const text = sanitizeText(raw.text, REVIEW_LIMITS.textMax);
  const ratingNum = typeof raw.rating === 'number' ? raw.rating : Number(raw.rating);
  const reviewDate = normalizeReviewDate(raw.reviewDate);
  const source = normalizeReviewSource(raw.source ?? 'manual');

  if (authorName.length < REVIEW_LIMITS.authorNameMin) {
    errors.authorName = 'Reviewer name is required.';
  }
  if (!Number.isInteger(ratingNum) || ratingNum < REVIEW_LIMITS.ratingMin || ratingNum > REVIEW_LIMITS.ratingMax) {
    errors.rating = 'Rating must be an integer between 1 and 5.';
  }
  if (text.length < REVIEW_LIMITS.textMin) {
    errors.text = 'Review text is required.';
  }
  if (!reviewDate || reviewDate.length < REVIEW_LIMITS.reviewDateMin || reviewDate.length > REVIEW_LIMITS.reviewDateMax) {
    errors.reviewDate = 'Valid review date (YYYY-MM-DD) is required.';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      authorName,
      rating: ratingNum,
      text,
      reviewDate,
      source,
    },
  };
}

export function validateInviteInput(raw: {
  email?: unknown;
  canApproveReplies?: unknown;
}): { valid: true; data: { email: string; canApproveReplies: boolean } } | { valid: false; error: string } {
  const email = sanitizeText(raw.email, 254).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: 'Please enter a valid staff email address.' };
  }
  return {
    valid: true,
    data: {
      email,
      canApproveReplies: Boolean(raw.canApproveReplies),
    },
  };
}

export function validatePlatformSettingsInput(
  raw: Partial<PlatformSettingsInput>
): { valid: true; data: PlatformSettingsInput } | { valid: false; error: string } {
  const platformName = sanitizeText(raw.platformName, 100);
  if (platformName.length < 2) {
    return { valid: false, error: 'Platform name must be at least 2 characters.' };
  }
  const maxBusinessesPerOwner = Number(raw.maxBusinessesPerOwner);
  if (!Number.isInteger(maxBusinessesPerOwner) || maxBusinessesPerOwner < 1 || maxBusinessesPerOwner > 100) {
    return { valid: false, error: 'Max businesses per owner must be an integer between 1 and 100.' };
  }
  return {
    valid: true,
    data: {
      platformName,
      allowNewBusinessRegistration: Boolean(raw.allowNewBusinessRegistration),
      maxBusinessesPerOwner,
      aiAnalysisEnabled: Boolean(raw.aiAnalysisEnabled),
      maintenanceMode: Boolean(raw.maintenanceMode),
    },
  };
}

export function canApproveBusinessReplies(
  userId: string,
  businessOwnerId: string,
  membership?: Pick<BusinessMemberRecord, 'role' | 'status' | 'canApproveReplies'> | null
): boolean {
  if (!userId) return false;
  if (businessOwnerId === userId) return true;
  if (!membership || membership.status !== 'active') return false;
  if (membership.role === 'BUSINESS_OWNER') return true;
  return Boolean(membership.canApproveReplies);
}

export function canManageBusinessStaff(userId: string, businessOwnerId: string): boolean {
  return Boolean(userId) && userId === businessOwnerId;
}

export function getDashboardRouteForRole(role: UserRole): '/admin' | '/owner' | '/manager' {
  if (role === 'SUPER_ADMIN') return '/admin';
  if (role === 'BUSINESS_MANAGER') return '/manager';
  return '/owner';
}

export function filterReviews(
  reviews: ReviewRecord[],
  filter: 'all' | 'critical' | 'positive' | 'neutral' | 'negative' | 'unanswered',
  searchQuery = ''
): ReviewRecord[] {
  const q = searchQuery.trim().toLowerCase();
  return reviews.filter((rev) => {
    if (filter === 'critical') {
      if (rev.isCritical !== true) return false;
    } else if (filter === 'positive') {
      if (rev.sentiment !== 'positive') return false;
    } else if (filter === 'neutral') {
      if (rev.sentiment !== 'neutral') return false;
    } else if (filter === 'negative') {
      if (rev.sentiment !== 'negative') return false;
    } else if (filter === 'unanswered') {
      if (rev.responseStatus === 'published') return false;
    }

    if (!q) return true;
    return (
      rev.authorName.toLowerCase().includes(q) ||
      rev.text.toLowerCase().includes(q) ||
      rev.categories.some((c) => c.toLowerCase().includes(q))
    );
  });
}

export function computeDashboardAnalytics(reviews: ReviewRecord[]): DashboardAnalytics {
  const sorted = [...reviews].sort((a, b) => {
    const dateDiff = b.reviewDate.localeCompare(a.reviewDate);
    if (dateDiff !== 0) return dateDiff;
    return b.createdAtMs - a.createdAtMs;
  });

  const sentimentCounts = {
    positive: 0,
    neutral: 0,
    negative: 0,
    pending: 0,
  };

  const ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  const categoryMap = new Map<string, { count: number; negativeCount: number }>();
  let ratingSum = 0;
  let respondedCount = 0;
  const criticalReviews: ReviewRecord[] = [];

  for (const r of sorted) {
    ratingSum += r.rating;
    const clampedRating = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    ratingDistribution[clampedRating] += 1;

    if (r.sentiment in sentimentCounts) {
      sentimentCounts[r.sentiment] += 1;
    }

    if (r.responseStatus === 'published') {
      respondedCount += 1;
    }

    if (r.isCritical || r.rating <= 2) {
      criticalReviews.push(r);
    }

    const isNeg = r.sentiment === 'negative' || r.rating <= 2;
    for (const cat of r.categories) {
      const cleanCat = cat.trim();
      if (!cleanCat) continue;
      const existing = categoryMap.get(cleanCat) ?? { count: 0, negativeCount: 0 };
      existing.count += 1;
      if (isNeg) {
        existing.negativeCount += 1;
      }
      categoryMap.set(cleanCat, existing);
    }
  }

  const complaintCategories: CategoryStat[] = Array.from(categoryMap.entries())
    .map(([category, stats]) => ({
      category,
      count: stats.count,
      negativeCount: stats.negativeCount,
    }))
    .filter((item) => item.negativeCount > 0 || item.count > 0)
    .sort((a, b) => {
      if (b.negativeCount !== a.negativeCount) return b.negativeCount - a.negativeCount;
      return b.count - a.count;
    })
    .slice(0, 8);

  const totalReviews = sorted.length;
  const averageRating = totalReviews > 0 ? Number((ratingSum / totalReviews).toFixed(2)) : 0;
  const responseRate = totalReviews > 0 ? Math.round((respondedCount / totalReviews) * 100) : 0;

  return {
    totalReviews,
    averageRating,
    responseRate,
    sentimentCounts,
    ratingDistribution,
    criticalReviews: criticalReviews.slice(0, 10),
    recentReviews: sorted.slice(0, 8),
    complaintCategories,
  };
}
