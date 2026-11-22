import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Menu,
  MessageSquarePlus,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { AddReviewModal } from './components/AddReviewModal.tsx';
import { AuthView } from './components/AuthView.tsx';
import { BusinessForm } from './components/BusinessForm.tsx';
import { BusinessProfileView } from './components/BusinessProfileView.tsx';
import { CsvImportModal } from './components/CsvImportModal.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ReviewsView, type ReviewFilterMode } from './components/ReviewsView.tsx';
import { SuperAdminDashboard } from './components/SuperAdminDashboard.tsx';
import { TeamManagementView } from './components/TeamManagementView.tsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { analyzeBatchOnServer } from './services/apiService.ts';
import {
  acceptBusinessInvite,
  createBusiness,
  migrateLegacyBusinessIfNeeded,
  saveReviewAiAnalysis,
  subscribeAssignedMemberships,
  subscribeBusinessReviews,
  subscribeMyPendingInvites,
  subscribeOwnedBusinesses,
} from './services/firestoreService.ts';
import {
  canApproveBusinessReplies,
  getDashboardRouteForRole,
  type BusinessInput,
  type BusinessInviteRecord,
  type BusinessMemberRecord,
  type BusinessRecord,
  type ReviewRecord,
} from './shared/validation.ts';

type NavSection = 'dashboard' | 'reviews' | 'team' | 'business';

function WorkspaceApp() {
  const {
    user,
    authReady,
    roleLoaded,
    userRole,
    userStatus,
    portalMode,
    refreshSessionRole,
    logout,
    getIdToken,
  } = useAuth();

  const [ownedBusinesses, setOwnedBusinesses] = useState<BusinessRecord[]>([]);
  const [ownedLoaded, setOwnedLoaded] = useState(false);

  const [assignedMemberships, setAssignedMemberships] = useState<BusinessMemberRecord[]>([]);
  const [assignedBusinesses, setAssignedBusinesses] = useState<BusinessRecord[]>([]);
  const [assignedLoaded, setAssignedLoaded] = useState(false);

  const [pendingInvites, setPendingInvites] = useState<BusinessInviteRecord[]>([]);
  const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null);

  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilterMode>('all');
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  const [showAddReview, setShowAddReview] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showCreateBusinessModal, setShowCreateBusinessModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [analyzingBatch, setAnalyzingBatch] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');

  // Merge owned + assigned businesses without duplicates
  const allBusinesses = useMemo(() => {
    const map = new Map<string, BusinessRecord>();
    for (const b of ownedBusinesses) map.set(b.id, b);
    for (const b of assignedBusinesses) {
      if (!map.has(b.id)) map.set(b.id, b);
    }
    return Array.from(map.values());
  }, [ownedBusinesses, assignedBusinesses]);

  // Keep URL aligned with authenticated role's dashboard route
  useEffect(() => {
    if (!authReady || !roleLoaded || !user || !user.emailVerified || !userRole) return;
    if (portalMode === 'admin' && userRole !== 'SUPER_ADMIN') return;
    const expectedRoute = getDashboardRouteForRole(userRole);
    if (typeof window !== 'undefined' && window.location.pathname !== expectedRoute) {
      window.history.replaceState(null, '', expectedRoute);
    }
  }, [authReady, roleLoaded, user?.uid, user?.emailVerified, userRole, portalMode]);

  // Subscribe to owned businesses, assigned memberships, and pending manager invites
  useEffect(() => {
    if (!authReady || !roleLoaded || !user || !user.emailVerified || userRole === 'SUPER_ADMIN') {
      setOwnedBusinesses([]);
      setAssignedBusinesses([]);
      setAssignedMemberships([]);
      setPendingInvites([]);
      setOwnedLoaded(false);
      setAssignedLoaded(false);
      setActiveBusinessId(null);
      return;
    }

    const unsubOwned = subscribeOwnedBusinesses(
      user.uid,
      (list) => {
        setOwnedBusinesses(list);
        setOwnedLoaded(true);
        for (const biz of list) {
          void migrateLegacyBusinessIfNeeded(
            biz,
            user.email ?? 'owner@reviewguard.local',
            user.displayName ?? 'Business Owner'
          );
        }
      },
      (err) => {
        setWorkspaceError(err.message);
        setOwnedLoaded(true);
      }
    );

    const unsubAssigned = subscribeAssignedMemberships(
      user.uid,
      (memberships, businesses) => {
        setAssignedMemberships(memberships);
        setAssignedBusinesses(businesses);
        setAssignedLoaded(true);
      },
      (err) => {
        setWorkspaceError(err.message);
        setAssignedLoaded(true);
      }
    );

    const unsubInvites = user.email
      ? subscribeMyPendingInvites(
          user.email,
          setPendingInvites,
          (err) => console.warn('Invite subscription warning:', err)
        )
      : () => {};

    return () => {
      unsubOwned();
      unsubAssigned();
      unsubInvites();
    };
  }, [authReady, roleLoaded, user?.uid, user?.email, user?.emailVerified, userRole]);

  // Keep activeBusinessId valid as businesses load
  useEffect(() => {
    setActiveBusinessId((prev) => {
      if (prev && allBusinesses.some((b) => b.id === prev)) return prev;
      return allBusinesses[0]?.id ?? null;
    });
  }, [allBusinesses]);

  // Subscribe to reviews for the active business
  useEffect(() => {
    if (!authReady || !roleLoaded || !user || !user.emailVerified || !activeBusinessId || userRole === 'SUPER_ADMIN') {
      setReviews([]);
      setReviewsLoaded(false);
      return;
    }

    setReviewsLoaded(false);
    const unsub = subscribeBusinessReviews(
      activeBusinessId,
      (list) => {
        setReviews(list);
        setReviewsLoaded(true);
      },
      (err) => {
        setWorkspaceError(err.message);
        setReviewsLoaded(true);
      }
    );

    return () => unsub();
  }, [authReady, roleLoaded, user?.uid, user?.emailVerified, activeBusinessId, userRole]);

  if (!authReady || (user && user.emailVerified && !roleLoaded)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-600">Verifying workspace permissions...</p>
      </div>
    );
  }

  // Protected route gate + Role resolution gate + Admin verification gate
  if (!user || !user.emailVerified || !userRole || (portalMode === 'admin' && userRole !== 'SUPER_ADMIN')) {
    return <AuthView />;
  }

  // Suspended user lockout
  if (userStatus === 'suspended' && userRole !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <AlertTriangle size={28} className="mx-auto text-red-600" />
          <h1 className="mt-4 font-display text-xl font-semibold text-slate-900">
            Account Suspended
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Your ReviewGuard AI account has been suspended by a platform administrator. Contact support for assistance.
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-6 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Route 1: SUPER_ADMIN -> Platform Administration Dashboard
  if (userRole === 'SUPER_ADMIN') {
    return <SuperAdminDashboard />;
  }

  const businessesLoaded = ownedLoaded && assignedLoaded;
  const activeBusiness = allBusinesses.find((b) => b.id === activeBusinessId) ?? null;
  const activeMembership = activeBusiness
    ? assignedMemberships.find((m) => m.businessId === activeBusiness.id) ?? null
    : null;
  const isOwnerOfActive = Boolean(activeBusiness && activeBusiness.ownerId === user.uid);
  const canApproveOnActive = activeBusiness
    ? canApproveBusinessReplies(user.uid, activeBusiness.ownerId, activeMembership)
    : false;
  const isSuspendedBusiness = activeBusiness?.status === 'suspended';

  async function handleAcceptInvite(inv: BusinessInviteRecord) {
    if (!user) return;
    setWorkspaceError('');
    setAcceptingInviteId(inv.id);
    try {
      await acceptBusinessInvite(
        inv,
        user.uid,
        user.displayName ?? user.email?.split('@')[0] ?? 'Manager'
      );
      await refreshSessionRole();
      setActiveBusinessId(inv.businessId);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Could not accept invitation.');
    } finally {
      setAcceptingInviteId(null);
    }
  }

  async function handleFirstBusinessCreate(values: BusinessInput) {
    if (!user) return;
    const newId = await createBusiness(
      user.uid,
      user.email ?? 'owner@reviewguard.local',
      user.displayName ?? 'Business Owner',
      values
    );
    setActiveBusinessId(newId);
    setShowCreateBusinessModal(false);
  }

  async function handleAnalyzePending() {
    if (!activeBusiness || isSuspendedBusiness) return;
    const pending = reviews.filter((r) => r.sentiment === 'pending').slice(0, 20);
    if (pending.length === 0) return;

    setWorkspaceError('');
    setAnalyzingBatch(true);
    try {
      const token = await getIdToken();
      const res = await analyzeBatchOnServer(
        {
          businessId: activeBusiness.id,
          business: {
            name: activeBusiness.name,
            category: activeBusiness.category,
            city: activeBusiness.city,
            address: activeBusiness.address,
            description: activeBusiness.description,
          },
          reviews: pending.map((r) => ({
            reviewId: r.id,
            authorName: r.authorName,
            rating: r.rating,
            text: r.text,
            reviewDate: r.reviewDate,
            source: r.source,
          })),
        },
        token
      );

      const results = Array.isArray(res?.results) ? res.results : [];
      let succeededCount = 0;
      let firstFailureMessage = '';

      await Promise.all(
        results.map(async (item) => {
          if (item.ok && item.result) {
            succeededCount += 1;
            const target = pending.find((p) => p.id === item.reviewId);
            await saveReviewAiAnalysis(
              activeBusiness.id,
              item.reviewId,
              item.result,
              target?.responseStatus ?? 'unanswered'
            );
          } else if (!firstFailureMessage && item.error) {
            firstFailureMessage = item.error;
          }
        })
      );

      const failedCount = results.length - succeededCount;
      if (failedCount > 0) {
        setWorkspaceError(
          succeededCount > 0
            ? `Analyzed ${succeededCount} of ${results.length} reviews. ${firstFailureMessage || 'Some reviews could not be analyzed yet.'}`
            : firstFailureMessage || 'AI analysis could not be completed. Please try again shortly.'
        );
      }
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Batch AI analysis encountered an error.'
      );
    } finally {
      setAnalyzingBatch(false);
    }
  }

  if (!businessesLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-600">Loading assigned business workspaces...</p>
      </div>
    );
  }

  // Empty Workspace Onboarding (or Pending Manager Invitations)
  if (allBusinesses.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <div className="w-7 h-7 rounded-lg bg-teal-700 flex items-center justify-center text-white">
              <ShieldCheck size={16} />
            </div>
            <span className="font-display text-base font-semibold text-slate-900">
              ReviewGuard AI
            </span>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl space-y-6">
            {pendingInvites.length > 0 && (
              <div className="bg-white border border-teal-200 rounded-xl p-6">
                <div className="flex items-center gap-2.5 text-teal-800">
                  <MailCheck size={20} />
                  <h2 className="font-display text-lg font-semibold">
                    Pending Business Manager Invitations
                  </h2>
                </div>
                <div className="mt-4 divide-y divide-slate-100">
                  {pendingInvites.map((inv) => (
                    <div key={inv.id} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{inv.businessName}</p>
                        <p className="text-xs text-slate-500">
                          Role: Business Manager · Reply Approval:{' '}
                          {inv.canApproveReplies ? 'Granted' : 'Draft Only'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={acceptingInviteId === inv.id}
                        onClick={() => void handleAcceptInvite(inv)}
                        className="px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {acceptingInviteId === inv.id ? 'Joining...' : 'Accept Invite'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {userRole === 'BUSINESS_MANAGER' ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                <h1 className="font-display text-xl font-semibold text-slate-900">
                  No Active Business Assignments
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  {pendingInvites.length > 0
                    ? 'Accept an invitation above to access your assigned business workspace.'
                    : 'Ask your Business Owner to send an invitation to your email address to access a workspace.'}
                </p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-8">
                <h1 className="font-display text-2xl font-semibold text-slate-900">
                  Set up your first business profile
                </h1>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Provide your business details so ReviewGuard AI can isolate your workspace, invite staff, and tailor Gemini responses to your brand voice.
                </p>
                <div className="mt-6">
                  <BusinessForm
                    submitLabel="Create Business Workspace"
                    onSubmit={handleFirstBusinessCreate}
                  />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  const sectionLabel =
    activeSection === 'dashboard'
      ? 'Overview'
      : activeSection === 'reviews'
        ? 'Reviews & AI Studio'
        : activeSection === 'team'
          ? 'Team & Permissions'
          : 'Business Profile';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-150 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <div className="w-7 h-7 rounded-lg bg-teal-700 flex items-center justify-center text-white">
              <ShieldCheck size={16} />
            </div>
            <span className="font-display text-base font-semibold tracking-tight text-slate-900">
              ReviewGuard AI
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-slate-700"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Business Switcher */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="biz-switcher" className="text-xs font-medium text-slate-500">
              Active Workspace
            </label>
            <span className="text-[11px] font-mono-num text-teal-700">
              {isOwnerOfActive ? 'Owner' : 'Manager'}
            </span>
          </div>
          <select
            id="biz-switcher"
            value={activeBusiness?.id ?? ''}
            onChange={(e) => {
              setActiveBusinessId(e.target.value);
              setSelectedReviewId(null);
              setActiveSection('dashboard');
            }}
            className="w-full px-2.5 py-2 text-sm font-medium border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
          >
            {allBusinesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.city})
              </option>
            ))}
          </select>
          {userRole === 'BUSINESS_OWNER' && (
            <button
              type="button"
              onClick={() => {
                setShowCreateBusinessModal(true);
                setMobileMenuOpen(false);
              }}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
            >
              <Plus size={13} />
              <span>New Business</span>
            </button>
          )}
        </div>

        {/* Primary Nav Links */}
        <nav className="flex-1 p-3 space-y-1">
          <button
            type="button"
            onClick={() => {
              setActiveSection('dashboard');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeSection === 'dashboard'
                ? 'bg-teal-50 text-teal-800'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <LayoutDashboard size={17} />
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSection('reviews');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeSection === 'reviews'
                ? 'bg-teal-50 text-teal-800'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <MessageSquareText size={17} />
              <span>Reviews</span>
            </span>
            <span className="font-mono-num text-xs text-slate-500">{reviews.length}</span>
          </button>

          {isOwnerOfActive && (
            <button
              type="button"
              onClick={() => {
                setActiveSection('team');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSection === 'team'
                  ? 'bg-teal-50 text-teal-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Users size={17} />
              <span>Team & Permissions</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setActiveSection('business');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeSection === 'business'
                ? 'bg-teal-50 text-teal-800'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Building2 size={17} />
            <span>Business Profile</span>
          </button>
        </nav>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-200">
          <p className="text-xs font-medium text-slate-900 truncate">
            {user.displayName || 'Workspace User'}
          </p>
          <p className="text-xs text-slate-500 truncate">{user.email}</p>
          <p className="mt-1 text-[11px] font-mono-num text-slate-400">
            {userRole}
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 truncate max-w-[180px] sm:max-w-xs">
                {activeBusiness?.name}
              </span>
              <span className="text-slate-300" aria-hidden="true">/</span>
              <span className="font-display font-semibold text-slate-900 whitespace-nowrap">
                {sectionLabel}
              </span>
            </div>
          </div>

          {!isSuspendedBusiness && (
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowCsvImport(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Upload size={14} />
                <span className="hidden sm:inline">Import CSV</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddReview(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquarePlus size={14} />
                <span>Add Review</span>
              </button>
            </div>
          )}
        </header>

        <main className="flex-1 p-6 max-w-[1320px] w-full mx-auto space-y-5">
          {pendingInvites.length > 0 && (
            <div className="bg-white border border-teal-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs text-slate-700">
                You have a pending manager invitation for{' '}
                <strong className="text-slate-900">{pendingInvites[0].businessName}</strong>.
              </div>
              <button
                type="button"
                disabled={acceptingInviteId === pendingInvites[0].id}
                onClick={() => void handleAcceptInvite(pendingInvites[0])}
                className="px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50"
              >
                {acceptingInviteId === pendingInvites[0].id ? 'Accepting...' : 'Accept Invitation'}
              </button>
            </div>
          )}

          {isSuspendedBusiness && (
            <div className="p-4 text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5">
              <AlertTriangle size={16} className="shrink-0" />
              <span>
                This business workspace is currently suspended by a platform administrator. Data is read-only until reactivated.
              </span>
            </div>
          )}

          {workspaceError && (
            <div className="p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-4">
              <span>{workspaceError}</span>
              <button
                type="button"
                onClick={() => setWorkspaceError('')}
                className="font-medium underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeBusiness && activeSection === 'dashboard' && (
            <DashboardView
              business={activeBusiness}
              reviews={reviews}
              loading={!reviewsLoaded}
              onAddReview={() => setShowAddReview(true)}
              onImportCsv={() => setShowCsvImport(true)}
              onOpenReview={(reviewId) => {
                setSelectedReviewId(reviewId);
                setReviewFilter('all');
                setActiveSection('reviews');
              }}
              onNavigateReviews={(filter) => {
                setReviewFilter(filter ?? 'all');
                setActiveSection('reviews');
              }}
              onAnalyzePending={handleAnalyzePending}
              analyzingBatch={analyzingBatch}
            />
          )}

          {activeBusiness && activeSection === 'reviews' && (
            <ReviewsView
              business={activeBusiness}
              reviews={reviews}
              isOwner={isOwnerOfActive}
              canApproveReplies={canApproveOnActive}
              selectedReviewId={selectedReviewId}
              filter={reviewFilter}
              onFilterChange={setReviewFilter}
              onSelectReview={setSelectedReviewId}
              onAddReview={() => setShowAddReview(true)}
              onAnalyzePending={handleAnalyzePending}
              analyzingBatch={analyzingBatch}
            />
          )}

          {activeBusiness && activeSection === 'team' && isOwnerOfActive && (
            <TeamManagementView business={activeBusiness} ownerId={user.uid} />
          )}

          {activeBusiness && activeSection === 'business' && (
            <BusinessProfileView
              business={activeBusiness}
              isOwner={isOwnerOfActive}
              onCreatedBusiness={(newId) => {
                setActiveBusinessId(newId);
                setActiveSection('dashboard');
              }}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      {activeBusiness && showAddReview && !isSuspendedBusiness && (
        <AddReviewModal
          business={activeBusiness}
          onClose={() => setShowAddReview(false)}
          onCreated={(revId) => {
            setSelectedReviewId(revId);
          }}
        />
      )}

      {activeBusiness && showCsvImport && !isSuspendedBusiness && (
        <CsvImportModal
          business={activeBusiness}
          onClose={() => setShowCsvImport(false)}
          onImported={() => {
            setActiveSection('reviews');
          }}
        />
      )}

      {showCreateBusinessModal && userRole === 'BUSINESS_OWNER' && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-biz-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-5">
              <h2 id="create-biz-modal-title" className="font-display text-lg font-semibold text-slate-900">
                Add New Business
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateBusinessModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>
            <BusinessForm
              submitLabel="Create Business"
              onSubmit={handleFirstBusinessCreate}
              onCancel={() => setShowCreateBusinessModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <WorkspaceApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
