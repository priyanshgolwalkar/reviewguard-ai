import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import {
  generateSafeId,
  isValidFirestoreId,
  REVIEW_LIMITS,
  sanitizeText,
  validateBusinessInput,
  validateInviteInput,
  validatePlatformSettingsInput,
  validateReviewInput,
  type AccountStatus,
  type AiAnalysisResult,
  type BusinessInput,
  type BusinessInviteRecord,
  type BusinessMemberRecord,
  type BusinessRecord,
  type PlatformSettingsInput,
  type PlatformSettingsRecord,
  type ResponseStatus,
  type ResponseTone,
  type ReviewInput,
  type ReviewRecord,
  type UserProfileRecord,
  type UserRole,
} from '../shared/validation.ts';

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) {
    return val.toMillis();
  }
  if (
    val &&
    typeof val === 'object' &&
    'toMillis' in val &&
    typeof (val as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function mapBusinessDoc(id: string, data: Record<string, unknown>): BusinessRecord {
  return {
    id,
    ownerId: String(data.ownerId ?? ''),
    name: String(data.name ?? ''),
    category: String(data.category ?? ''),
    city: String(data.city ?? ''),
    address: String(data.address ?? ''),
    description: String(data.description ?? ''),
    status: data.status === 'suspended' ? 'suspended' : 'active',
    createdAtMs: timestampToMs(data.createdAt),
    updatedAtMs: timestampToMs(data.updatedAt),
  };
}

function mapUserProfileDoc(id: string, data: Record<string, unknown>): UserProfileRecord {
  const role: UserRole =
    data.role === 'SUPER_ADMIN' || data.role === 'BUSINESS_MANAGER' || data.role === 'BUSINESS_OWNER'
      ? data.role
      : 'BUSINESS_OWNER';
  return {
    uid: String(data.uid ?? id),
    email: String(data.email ?? ''),
    displayName: String(data.displayName ?? 'User'),
    role,
    status: data.status === 'suspended' ? 'suspended' : 'active',
    createdAtMs: timestampToMs(data.createdAt),
    updatedAtMs: timestampToMs(data.updatedAt),
  };
}

function mapMemberDoc(id: string, data: Record<string, unknown>): BusinessMemberRecord {
  return {
    id,
    businessId: String(data.businessId ?? ''),
    businessName: String(data.businessName ?? ''),
    ownerId: String(data.ownerId ?? ''),
    userId: String(data.userId ?? ''),
    email: String(data.email ?? ''),
    displayName: String(data.displayName ?? ''),
    role: data.role === 'BUSINESS_OWNER' ? 'BUSINESS_OWNER' : 'BUSINESS_MANAGER',
    canApproveReplies: Boolean(data.canApproveReplies),
    status: data.status === 'revoked' ? 'revoked' : 'active',
    invitedBy: String(data.invitedBy ?? ''),
    inviteId: String(data.inviteId ?? 'owner'),
    createdAtMs: timestampToMs(data.createdAt),
    updatedAtMs: timestampToMs(data.updatedAt),
  };
}

function mapInviteDoc(id: string, data: Record<string, unknown>): BusinessInviteRecord {
  const status =
    data.status === 'accepted' || data.status === 'revoked' ? data.status : 'pending';
  return {
    id,
    businessId: String(data.businessId ?? ''),
    businessName: String(data.businessName ?? ''),
    ownerId: String(data.ownerId ?? ''),
    email: String(data.email ?? ''),
    role: 'BUSINESS_MANAGER',
    canApproveReplies: Boolean(data.canApproveReplies),
    status,
    invitedBy: String(data.invitedBy ?? ''),
    createdAtMs: timestampToMs(data.createdAt),
    updatedAtMs: timestampToMs(data.updatedAt),
  };
}

/**
 * Safely ensures a user profile exists and migrates legacy user docs (missing role/status)
 * to BUSINESS_OWNER without breaking or deleting existing data.
 */
export async function ensureUserProfileAndMigrate(
  uid: string,
  email: string,
  displayName: string
): Promise<UserProfileRecord> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Invalid user ID.');
  }
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const [userSnap, adminSnap] = await Promise.all([
      getDoc(ref),
      getDoc(doc(db, 'admins', uid)).catch(() => null),
    ]);

    const cleanEmail = sanitizeText(email, 254).toLowerCase() || 'owner@reviewguard.local';
    const cleanName = sanitizeText(displayName, 100) || 'Business User';
    const isAdmin = Boolean(adminSnap?.exists());

    if (!userSnap.exists()) {
      let initialRole: UserRole = 'BUSINESS_OWNER';
      if (isAdmin) {
        initialRole = 'SUPER_ADMIN';
      } else {
        // Check if user has pending manager invites and no owned businesses
        const invitesSnap = await getDocs(
          query(collection(db, 'business_invites'), where('email', '==', cleanEmail))
        ).catch(() => null);
        const hasPendingInvite = Boolean(
          invitesSnap?.docs.some((d) => d.data().status === 'pending')
        );
        if (hasPendingInvite) {
          initialRole = 'BUSINESS_MANAGER';
        }
      }

      await setDoc(ref, {
        uid,
        email: cleanEmail,
        displayName: cleanName,
        role: initialRole,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const createdSnap = await getDoc(ref);
      return mapUserProfileDoc(uid, createdSnap.data() ?? {});
    }

    const existingData = userSnap.data();
    // Safe migration for legacy /users/{uid} docs missing role or status; never overwrite an existing role
    if (!existingData.role || !existingData.status) {
      const preservedRole: UserRole =
        existingData.role === 'SUPER_ADMIN' ||
        existingData.role === 'BUSINESS_MANAGER' ||
        existingData.role === 'BUSINESS_OWNER'
          ? existingData.role
          : isAdmin
            ? 'SUPER_ADMIN'
            : 'BUSINESS_OWNER';

      const updatePayload: Record<string, unknown> = {
        email: existingData.email || cleanEmail,
        displayName: existingData.displayName || cleanName,
        status: existingData.status === 'suspended' ? 'suspended' : 'active',
        updatedAt: serverTimestamp(),
      };
      if (!existingData.role) {
        updatePayload.role = preservedRole;
      }

      await updateDoc(ref, updatePayload);
      const migrated = await getDoc(ref);
      return mapUserProfileDoc(uid, migrated.data() ?? {});
    }

    return mapUserProfileDoc(uid, existingData);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Safely migrates legacy businesses missing status or owner membership records.
 */
export async function migrateLegacyBusinessIfNeeded(
  business: BusinessRecord,
  ownerEmail: string,
  ownerDisplayName: string
): Promise<void> {
  const membershipId = `${business.id}__${business.ownerId}`;
  const memberRef = doc(db, 'business_members', membershipId);
  try {
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      await setDoc(memberRef, {
        businessId: business.id,
        businessName: business.name,
        ownerId: business.ownerId,
        userId: business.ownerId,
        email: sanitizeText(ownerEmail, 254).toLowerCase() || 'owner@reviewguard.local',
        displayName: sanitizeText(ownerDisplayName, 100) || 'Business Owner',
        role: 'BUSINESS_OWNER',
        canApproveReplies: true,
        status: 'active',
        invitedBy: business.ownerId,
        inviteId: 'owner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn('Non-fatal legacy business membership migration warning:', err);
  }
}

export function subscribeOwnedBusinesses(
  ownerId: string,
  onData: (businesses: BusinessRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'businesses';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .filter((d) => !(d.metadata.hasPendingWrites && !d.data().createdAt))
        .map((d) => mapBusinessDoc(d.id, d.data()));
      items.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeAssignedMemberships(
  userId: string,
  onData: (memberships: BusinessMemberRecord[], businesses: BusinessRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'business_members';
  const q = query(collection(db, path), where('userId', '==', userId));
  return onSnapshot(
    q,
    async (snapshot) => {
      try {
        const memberships = snapshot.docs
          .filter((d) => !(d.metadata.hasPendingWrites && !d.data().createdAt))
          .map((d) => mapMemberDoc(d.id, d.data()))
          .filter((m) => m.status === 'active');

        const bizResults = await Promise.all(
          memberships.map(async (m) => {
            try {
              const snap = await getDoc(doc(db, 'businesses', m.businessId));
              return snap.exists() ? mapBusinessDoc(snap.id, snap.data()) : null;
            } catch {
              return null;
            }
          })
        );
        const businesses = bizResults.filter((b): b is BusinessRecord => b !== null);
        businesses.sort((a, b) => a.createdAtMs - b.createdAtMs);
        onData(memberships, businesses);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function createBusiness(
  ownerId: string,
  ownerEmail: string,
  ownerDisplayName: string,
  input: BusinessInput
): Promise<string> {
  if (!isValidFirestoreId(ownerId)) {
    throw new Error('Invalid owner ID.');
  }
  const validated = validateBusinessInput(input);
  if (!validated.valid) {
    throw new Error(Object.values(validated.errors)[0] || 'Invalid business profile.');
  }

  const businessId = generateSafeId('biz');
  const membershipId = `${businessId}__${ownerId}`;
  const path = `businesses/${businessId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'businesses', businessId), {
      ownerId,
      ...validated.data,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'business_members', membershipId), {
      businessId,
      businessName: validated.data.name,
      ownerId,
      userId: ownerId,
      email: sanitizeText(ownerEmail, 254).toLowerCase() || 'owner@reviewguard.local',
      displayName: sanitizeText(ownerDisplayName, 100) || 'Business Owner',
      role: 'BUSINESS_OWNER',
      canApproveReplies: true,
      status: 'active',
      invitedBy: ownerId,
      inviteId: 'owner',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return businessId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateBusiness(
  businessId: string,
  input: BusinessInput,
  currentStatus: AccountStatus = 'active'
): Promise<void> {
  if (!isValidFirestoreId(businessId)) {
    throw new Error('Invalid business ID.');
  }
  const validated = validateBusinessInput(input);
  if (!validated.valid) {
    throw new Error(Object.values(validated.errors)[0] || 'Invalid business profile.');
  }
  const path = `businesses/${businessId}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId), {
      ...validated.data,
      status: currentStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeBusinessStaff(
  businessId: string,
  ownerId: string,
  onData: (members: BusinessMemberRecord[], invites: BusinessInviteRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  let latestMembers: BusinessMemberRecord[] = [];
  let latestInvites: BusinessInviteRecord[] = [];

  const membersQ = query(
    collection(db, 'business_members'),
    where('ownerId', '==', ownerId)
  );
  const invitesQ = query(
    collection(db, 'business_invites'),
    where('ownerId', '==', ownerId)
  );

  const unsubMembers = onSnapshot(
    membersQ,
    (snap) => {
      latestMembers = snap.docs
        .map((d) => mapMemberDoc(d.id, d.data()))
        .filter((m) => m.businessId === businessId && m.role === 'BUSINESS_MANAGER');
      onData(latestMembers, latestInvites);
    },
    (err) => onError(err instanceof Error ? err : new Error(String(err)))
  );

  const unsubInvites = onSnapshot(
    invitesQ,
    (snap) => {
      latestInvites = snap.docs
        .map((d) => mapInviteDoc(d.id, d.data()))
        .filter((inv) => inv.businessId === businessId && inv.status === 'pending');
      onData(latestMembers, latestInvites);
    },
    (err) => onError(err instanceof Error ? err : new Error(String(err)))
  );

  return () => {
    unsubMembers();
    unsubInvites();
  };
}

export function subscribeMyPendingInvites(
  email: string,
  onData: (invites: BusinessInviteRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const cleanEmail = email.trim().toLowerCase();
  const q = query(collection(db, 'business_invites'), where('email', '==', cleanEmail));
  return onSnapshot(
    q,
    (snap) => {
      const pending = snap.docs
        .map((d) => mapInviteDoc(d.id, d.data()))
        .filter((inv) => inv.status === 'pending');
      onData(pending);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'business_invites');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function inviteBusinessManager(
  business: BusinessRecord,
  ownerId: string,
  emailRaw: string,
  canApproveReplies: boolean
): Promise<string> {
  const validated = validateInviteInput({ email: emailRaw, canApproveReplies });
  if (!validated.valid) {
    throw new Error(validated.error);
  }
  const inviteId = generateSafeId('inv');
  const path = `business_invites/${inviteId}`;
  try {
    await setDoc(doc(db, 'business_invites', inviteId), {
      businessId: business.id,
      businessName: business.name,
      ownerId,
      email: validated.data.email,
      role: 'BUSINESS_MANAGER',
      canApproveReplies: validated.data.canApproveReplies,
      status: 'pending',
      invitedBy: ownerId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return inviteId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function acceptBusinessInvite(
  invite: BusinessInviteRecord,
  userId: string,
  displayName: string
): Promise<void> {
  if (!isValidFirestoreId(userId) || !isValidFirestoreId(invite.businessId)) {
    throw new Error('Invalid membership identifiers.');
  }
  const membershipId = `${invite.businessId}__${userId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'business_invites', invite.id), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'business_members', membershipId), {
      businessId: invite.businessId,
      businessName: invite.businessName,
      ownerId: invite.ownerId,
      userId,
      email: invite.email,
      displayName: sanitizeText(displayName, 100) || invite.email.split('@')[0] || 'Manager',
      role: 'BUSINESS_MANAGER',
      canApproveReplies: invite.canApproveReplies,
      status: 'active',
      invitedBy: invite.invitedBy,
      inviteId: invite.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `business_members/${membershipId}`);
  }
}

export async function updateManagerPermission(
  membershipId: string,
  canApproveReplies: boolean
): Promise<void> {
  const path = `business_members/${membershipId}`;
  try {
    await updateDoc(doc(db, 'business_members', membershipId), {
      canApproveReplies,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeManagerMembership(membershipId: string): Promise<void> {
  const path = `business_members/${membershipId}`;
  try {
    await deleteDoc(doc(db, 'business_members', membershipId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function revokeBusinessInvite(inviteId: string): Promise<void> {
  const path = `business_invites/${inviteId}`;
  try {
    await deleteDoc(doc(db, 'business_invites', inviteId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeBusinessReviews(
  businessId: string,
  onData: (reviews: ReviewRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `businesses/${businessId}/reviews`;
  const q = query(
    collection(db, 'businesses', businessId, 'reviews'),
    where('businessId', '==', businessId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ReviewRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ''),
          businessId: String(data.businessId ?? businessId),
          authorName: String(data.authorName ?? 'Anonymous'),
          rating: Number(data.rating ?? 5),
          text: String(data.text ?? ''),
          reviewDate: String(data.reviewDate ?? ''),
          source: (data.source as ReviewRecord['source']) ?? 'manual',
          sentiment: (data.sentiment as ReviewRecord['sentiment']) ?? 'pending',
          sentimentScore: Number(data.sentimentScore ?? 0),
          categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
          isCritical: Boolean(data.isCritical),
          criticalReason: String(data.criticalReason ?? ''),
          aiSummary: String(data.aiSummary ?? ''),
          aiDraftResponse: String(data.aiDraftResponse ?? ''),
          responseTone: (data.responseTone as ResponseTone) ?? 'professional',
          responseStatus: (data.responseStatus as ResponseStatus) ?? 'unanswered',
          publishedResponse: String(data.publishedResponse ?? ''),
          createdAtMs: timestampToMs(data.createdAt),
          updatedAtMs: timestampToMs(data.updatedAt),
        };
      });
      items.sort((a, b) => {
        const dateDiff = b.reviewDate.localeCompare(a.reviewDate);
        return dateDiff !== 0 ? dateDiff : b.createdAtMs - a.createdAtMs;
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export interface CreateReviewOptions {
  aiAnalysis?: AiAnalysisResult & {
    aiDraftResponse?: string;
    responseTone?: ResponseTone;
  };
}

function buildReviewDocumentPayload(
  businessOwnerId: string,
  businessId: string,
  validated: ReviewInput,
  options?: CreateReviewOptions
) {
  const ai = options?.aiAnalysis;
  const draft = sanitizeText(ai?.aiDraftResponse ?? '', REVIEW_LIMITS.aiDraftResponseMax);
  const responseStatus: ResponseStatus = draft ? 'drafted' : 'unanswered';
  const categories = (ai?.categories ?? [])
    .map((c) => sanitizeText(c, REVIEW_LIMITS.categoryItemMax))
    .filter(Boolean)
    .slice(0, REVIEW_LIMITS.categoriesMax);

  return {
    ownerId: businessOwnerId,
    businessId,
    authorName: validated.authorName,
    rating: validated.rating,
    text: validated.text,
    reviewDate: validated.reviewDate,
    source: validated.source,
    sentiment: ai?.sentiment ?? 'pending',
    sentimentScore: typeof ai?.sentimentScore === 'number' ? ai.sentimentScore : 0,
    categories,
    isCritical: ai ? ai.isCritical : validated.rating <= 2,
    criticalReason: sanitizeText(
      ai?.criticalReason ?? (validated.rating <= 2 ? 'Low star rating flagged for owner review.' : ''),
      REVIEW_LIMITS.criticalReasonMax
    ),
    aiSummary: sanitizeText(ai?.aiSummary ?? '', REVIEW_LIMITS.aiSummaryMax),
    aiDraftResponse: draft,
    responseTone: ai?.responseTone ?? (validated.rating <= 2 ? 'apologetic' : 'professional'),
    responseStatus,
    publishedResponse: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function createReview(
  businessOwnerId: string,
  businessId: string,
  input: ReviewInput,
  options?: CreateReviewOptions
): Promise<string> {
  if (!isValidFirestoreId(businessOwnerId) || !isValidFirestoreId(businessId)) {
    throw new Error('Invalid owner or business ID.');
  }
  const validated = validateReviewInput(input);
  if (!validated.valid) {
    throw new Error(Object.values(validated.errors)[0] || 'Invalid review input.');
  }

  const reviewId = generateSafeId('rev');
  const path = `businesses/${businessId}/reviews/${reviewId}`;
  try {
    await setDoc(
      doc(db, 'businesses', businessId, 'reviews', reviewId),
      buildReviewDocumentPayload(businessOwnerId, businessId, validated.data, options)
    );
    return reviewId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createReviewsBatch(
  businessOwnerId: string,
  businessId: string,
  inputs: ReviewInput[]
): Promise<string[]> {
  if (!isValidFirestoreId(businessOwnerId) || !isValidFirestoreId(businessId)) {
    throw new Error('Invalid owner or business ID.');
  }
  const createdIds: string[] = [];
  const CHUNK_SIZE = 200;

  for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
    const slice = inputs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const raw of slice) {
      const validated = validateReviewInput(raw);
      if (!validated.valid) continue;
      const reviewId = generateSafeId('rev');
      createdIds.push(reviewId);
      const ref = doc(db, 'businesses', businessId, 'reviews', reviewId);
      batch.set(ref, buildReviewDocumentPayload(businessOwnerId, businessId, validated.data));
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/reviews`);
    }
  }
  return createdIds;
}

export async function saveReviewAiAnalysis(
  businessId: string,
  reviewId: string,
  analysis: AiAnalysisResult & { aiDraftResponse?: string; responseTone?: ResponseTone },
  currentStatus: ResponseStatus
): Promise<void> {
  if (!isValidFirestoreId(businessId) || !isValidFirestoreId(reviewId)) {
    throw new Error('Invalid review or business ID.');
  }
  if (currentStatus === 'published') {
    throw new Error('Published reviews are locked and cannot be overwritten.');
  }
  const path = `businesses/${businessId}/reviews/${reviewId}`;
  const draft = sanitizeText(analysis.aiDraftResponse ?? '', REVIEW_LIMITS.aiDraftResponseMax);
  const nextStatus: ResponseStatus = draft ? 'drafted' : 'unanswered';
  const categories = analysis.categories
    .map((c) => sanitizeText(c, REVIEW_LIMITS.categoryItemMax))
    .filter(Boolean)
    .slice(0, REVIEW_LIMITS.categoriesMax);

  try {
    await updateDoc(doc(db, 'businesses', businessId, 'reviews', reviewId), {
      sentiment: analysis.sentiment,
      sentimentScore: analysis.sentimentScore,
      categories,
      isCritical: Boolean(analysis.isCritical),
      criticalReason: sanitizeText(analysis.criticalReason, REVIEW_LIMITS.criticalReasonMax),
      aiSummary: sanitizeText(analysis.aiSummary, REVIEW_LIMITS.aiSummaryMax),
      aiDraftResponse: draft,
      responseTone: analysis.responseTone ?? 'professional',
      responseStatus: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function saveReviewResponseDraft(
  businessId: string,
  reviewId: string,
  draftText: string,
  tone: ResponseTone,
  nextStatus: 'drafted' | 'published' | 'rejected'
): Promise<void> {
  if (!isValidFirestoreId(businessId) || !isValidFirestoreId(reviewId)) {
    throw new Error('Invalid review or business ID.');
  }
  const cleanDraft = sanitizeText(draftText, REVIEW_LIMITS.aiDraftResponseMax);
  if (nextStatus !== 'rejected' && !cleanDraft) {
    throw new Error('Response text cannot be empty.');
  }
  const path = `businesses/${businessId}/reviews/${reviewId}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId, 'reviews', reviewId), {
      aiDraftResponse: nextStatus === 'rejected' ? '' : cleanDraft,
      responseTone: tone,
      responseStatus: nextStatus,
      publishedResponse: nextStatus === 'published' ? cleanDraft : '',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteReview(
  businessId: string,
  reviewId: string
): Promise<void> {
  if (!isValidFirestoreId(businessId) || !isValidFirestoreId(reviewId)) {
    throw new Error('Invalid review or business ID.');
  }
  const path = `businesses/${businessId}/reviews/${reviewId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'reviews', reviewId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/* ---------------- SUPER ADMIN PLATFORM QUERIES & ACTIONS ---------------- */

export function subscribeAllBusinessesAdmin(
  onData: (businesses: BusinessRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'businesses'),
    (snap) => {
      const list = snap.docs.map((d) => mapBusinessDoc(d.id, d.data()));
      list.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'businesses');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeAllUsersAdmin(
  onData: (users: UserProfileRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'users'),
    (snap) => {
      const list = snap.docs.map((d) => mapUserProfileDoc(d.id, d.data()));
      list.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'users');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribePlatformSettings(
  onData: (settings: PlatformSettingsRecord) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const ref = doc(db, 'platform_settings', 'global');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData({
          id: 'global',
          platformName: 'ReviewGuard AI',
          allowNewBusinessRegistration: true,
          maxBusinessesPerOwner: 10,
          aiAnalysisEnabled: true,
          maintenanceMode: false,
          updatedBy: '',
          updatedAtMs: Date.now(),
        });
        return;
      }
      const d = snap.data();
      onData({
        id: 'global',
        platformName: String(d.platformName ?? 'ReviewGuard AI'),
        allowNewBusinessRegistration: d.allowNewBusinessRegistration !== false,
        maxBusinessesPerOwner: Number(d.maxBusinessesPerOwner ?? 10),
        aiAnalysisEnabled: d.aiAnalysisEnabled !== false,
        maintenanceMode: Boolean(d.maintenanceMode),
        updatedBy: String(d.updatedBy ?? ''),
        updatedAtMs: timestampToMs(d.updatedAt),
      });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, 'platform_settings/global');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function setBusinessStatusAdmin(
  businessId: string,
  status: AccountStatus
): Promise<void> {
  const path = `businesses/${businessId}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function setUserStatusAdmin(
  userId: string,
  status: AccountStatus
): Promise<void> {
  const path = `users/${userId}`;
  try {
    await updateDoc(doc(db, 'users', userId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function savePlatformSettingsAdmin(
  adminUid: string,
  input: PlatformSettingsInput
): Promise<void> {
  const validated = validatePlatformSettingsInput(input);
  if (!validated.valid) {
    throw new Error(validated.error);
  }
  const path = 'platform_settings/global';
  try {
    await setDoc(doc(db, 'platform_settings', 'global'), {
      ...validated.data,
      updatedBy: adminUid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}
