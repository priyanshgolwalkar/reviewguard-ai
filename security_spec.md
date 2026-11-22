# ReviewGuard AI Multi-Tenant RBAC Security Specification

## 1. Roles & Trust Boundaries
1. **SUPER_ADMIN**: Verified exclusively via `/admins/{uid}` (or initial runtime-bootstrapped admin email during bootstrap). Cannot be self-assigned during registration. Can view all businesses and users, activate/suspend businesses or users, and update `/platform_settings/*`.
2. **BUSINESS_OWNER**: Owns one or more `/businesses/{businessId}` workspaces (`business.ownerId == uid`). Can edit business profiles, invite/remove `BUSINESS_MANAGER` staff, grant/revoke `canApproveReplies`, and approve/edit/reject/publish AI replies.
3. **BUSINESS_MANAGER**: Bound to assigned businesses via `/business_members/{businessId}__{uid}` with `status == 'active'`. Can view assigned business reviews/analytics and run AI sentiment/drafting, but cannot modify business ownership, invite staff, change platform settings, or approve/publish/reject replies unless `canApproveReplies == true`.

## 2. Data & Tenant Invariants
1. **No Self-Escalation**: Standard users cannot write to `/admins/*` or set `role: 'SUPER_ADMIN'` in `/users/{uid}`. Legacy `/users/{uid}` docs without a `role` field may only migrate once to `role: 'BUSINESS_OWNER'`.
2. **Tenant Boundary Enforcement**: Cross-tenant reads/writes to `/businesses/{otherBiz}` or `/businesses/{otherBiz}/reviews/{id}` are rejected by both Firestore rules and Express API middleware.
3. **Suspended Tenant Guard**: Suspended businesses (`status == 'suspended'`) block new review creation, review edits, and response publishing for non-admin actors.
4. **Synchronous Revocation**: Deleting or revoking `/business_members/{businessId}__{uid}` immediately revokes access to the parent business and its reviews.
5. **Reply Approval Gate**: Transitions to `responseStatus: 'published'` or `'rejected'` require `isBusinessOwner(businessId)` OR `canManagerApproveReplies(businessId)`.
6. **Review Analysis Writes**: Reviews are stored at `/businesses/{businessId}/reviews/{reviewId}`. Analysis updates require a verified, active user; an active business; and either the business owner's active `BUSINESS_OWNER` membership or an active `BUSINESS_MANAGER` membership whose user, business, and owner IDs match the parent tenant. Analysis may change sentiment, score, categories, critical/urgency details, summary, and an unapproved reply draft, but cannot change ownership, tenant, review ID, or role fields. In the current review schema, `aiSummary` is the summary, `isCritical`/`criticalReason` represent urgency, and `sentiment: 'pending'` indicates that analysis is still pending.

## 3. Extended Adversarial Payloads
1. **Self-Assigned Super Admin**: User A attempts to create `/admins/{userA}` or set `/users/{userA}.role = 'SUPER_ADMIN'`. -> `PERMISSION_DENIED` / `403`.
2. **Role Tampering on Update**: `BUSINESS_MANAGER` updates `/users/{uid}` to `role: 'BUSINESS_OWNER'`. -> `PERMISSION_DENIED`.
3. **Forged Business Membership**: User B attempts to create `/business_members/{bizA}__{userB}` without a valid pending `/business_invites/{inviteId}` addressed to User B's verified email. -> `PERMISSION_DENIED`.
4. **Unauthorized Reply Approval**: `BUSINESS_MANAGER` with `canApproveReplies: false` attempts to set `responseStatus: 'published'` or `'rejected'`. -> `PERMISSION_DENIED` / `403`.
5. **Cross-Tenant Review Access**: Manager of Business A attempts to read or analyze reviews of Business B. -> `PERMISSION_DENIED` / `403`.
6. **Manager Escalation**: `BUSINESS_MANAGER` attempts to update `/businesses/{bizA}` ownerId or invite staff to `/business_invites`. -> `PERMISSION_DENIED`.
7. **Non-Admin Platform Mutation**: `BUSINESS_OWNER` attempts to suspend Business B or write `/platform_settings/global`. -> `PERMISSION_DENIED` / `403`.
8. **Suspended Business Write**: Owner/Manager attempts to add a review to a `suspended` business. -> `PERMISSION_DENIED` / `403`.
