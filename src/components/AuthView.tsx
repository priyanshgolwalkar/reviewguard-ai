import React, { useState } from 'react';
import {
  KeyRound,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';

function mapAuthError(err: unknown): string {
  if (!(err instanceof Error)) return 'Authentication failed. Please try again.';
  const msg = err.message;
  if (msg.includes('auth/operation-not-allowed')) {
    return 'Email/Password sign-in is not enabled in Firebase Authentication console for this project. Enable it under Authentication > Sign-in method, or use Google Sign-In.';
  }
  if (
    msg.includes('auth/invalid-credential') ||
    msg.includes('auth/wrong-password') ||
    msg.includes('auth/user-not-found')
  ) {
    return 'Incorrect email or password. If you previously signed in with Google, use "Continue with Google" above, or click "Forgot password?" to reset or set a password.';
  }
  if (msg.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (msg.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists. Switch to Sign In, use Continue with Google, or click Forgot password?.';
  }
  if (msg.includes('auth/weak-password')) {
    return 'Password should be at least 6 characters long.';
  }
  if (msg.includes('auth/popup-closed-by-user') || msg.includes('auth/cancelled-popup-request')) {
    return 'Google sign-in window was closed before completing. Please try again.';
  }
  if (msg.includes('auth/popup-blocked')) {
    return 'Popup was blocked by your browser. Allow popups for this site or sign in with Email/Password.';
  }
  if (msg.includes('auth/unauthorized-domain')) {
    return 'This domain is not authorized in Firebase Authentication Settings > Authorized domains.';
  }
  if (msg.includes('auth/too-many-requests')) {
    return 'Too many attempts. Please wait a few minutes before trying again or reset your password.';
  }
  if (msg.includes('auth/network-request-failed')) {
    return 'Network error communicating with Firebase Authentication. Check your connection and try again.';
  }
  return msg;
}

export function AuthView() {
  const {
    user,
    userRole,
    roleLoaded,
    roleError,
    portalMode,
    setPortalMode,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    resendVerification,
    refreshUser,
    refreshSessionRole,
    provisionAdminSession,
    logout,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function switchPortal(next: 'business' | 'admin') {
    setPortalMode(next);
    setMode('signin');
    setError('');
    setNotice('');
    if (typeof window !== 'undefined') {
      const targetPath = next === 'admin' ? '/admin' : '/';
      window.history.replaceState(null, '', targetPath);
    }
  }

  // Email Verification Gate
  if (user && !user.emailVerified) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-3 text-teal-700">
            <MailCheck size={24} />
            <h1 className="text-xl font-semibold text-slate-900">Verify your email address</h1>
          </div>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            We sent a verification link to <span className="font-medium text-slate-900">{user.email}</span>.
            Verify your email before accessing multi-tenant ReviewGuard AI workspaces.
          </p>

          {error && (
            <div className="mt-4 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}
          {notice && (
            <div className="mt-4 p-3 text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg">
              {notice}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setError('');
                setNotice('');
                setLoading(true);
                try {
                  const verified = await refreshUser();
                  if (!verified) {
                    setNotice('Email is still unverified. Click the link in your inbox, then check again.');
                  }
                } catch (err) {
                  setError(mapAuthError(err));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} />
              <span>{loading ? 'Checking...' : 'I have verified my email'}</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setError('');
                setNotice('');
                setLoading(true);
                try {
                  await resendVerification();
                  setNotice('Verification email resent. Check your inbox and spam folder.');
                } catch (err) {
                  setError(mapAuthError(err));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
            >
              Resend verification email
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              <LogOut size={14} />
              <span>Sign out and use another account</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Signed-in user visiting Admin Login portal who is not yet SUPER_ADMIN
  if (user && user.emailVerified && roleLoaded && portalMode === 'admin' && userRole !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-2.5 text-slate-900">
            <ShieldAlert size={22} className="text-amber-600" />
            <h1 className="font-display text-lg font-semibold">Platform Admin Verification</h1>
          </div>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">
            Signed in as <span className="font-medium text-slate-900">{user.email}</span> (current role:{' '}
            <span className="font-mono-num font-medium">{userRole ?? 'unassigned'}</span>).
          </p>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            Super Admin access cannot be self-assigned publicly. If this account is the server-provisioned initial administrator, verify below.
          </p>

          {(error || roleError) && (
            <div className="mt-4 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg leading-relaxed">
              {error || roleError}
            </div>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="admin-secret" className="block text-xs font-medium text-slate-700 mb-1">
                Bootstrap Secret (if configured on server)
              </label>
              <input
                id="admin-secret"
                type="password"
                value={bootstrapSecret}
                onChange={(e) => setBootstrapSecret(e.target.value)}
                placeholder="Optional server-side bootstrap secret"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
              />
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setError('');
                setLoading(true);
                try {
                  await provisionAdminSession(bootstrapSecret || undefined);
                } catch (err) {
                  setError(mapAuthError(err));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <KeyRound size={15} />
              <span>{loading ? 'Verifying...' : 'Verify Admin Access'}</span>
            </button>

            <div className="pt-2 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => switchPortal('business')}
                className="font-medium text-teal-700 hover:text-teal-800"
              >
                Go to Business Dashboard
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="font-medium text-slate-500 hover:text-slate-800"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed-in verified user whose Business role resolution encountered an error
  if (user && user.emailVerified && roleLoaded && portalMode === 'business' && !userRole) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-2.5 text-slate-900">
            <ShieldAlert size={22} className="text-red-600" />
            <h1 className="font-display text-lg font-semibold">Workspace Session Error</h1>
          </div>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">
            Signed in as <span className="font-medium text-slate-900">{user.email}</span>, but we could not verify your workspace role.
          </p>

          {(error || roleError) && (
            <div className="mt-4 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg leading-relaxed">
              {error || roleError}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setError('');
                setLoading(true);
                try {
                  await refreshSessionRole();
                } catch (err) {
                  setError(mapAuthError(err));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={15} />
              <span>{loading ? 'Retrying...' : 'Retry Workspace Verification'}</span>
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      if (mode === 'reset') {
        await sendPasswordReset(email);
        setNotice(
          `If an Email/Password account exists for ${email.trim()}, a password reset link has been sent. If you previously signed up with Google, use "Continue with Google" instead.`
        );
      } else if (portalMode === 'admin' || mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        if (!displayName.trim()) {
          setError('Please enter your full name.');
          setLoading(false);
          return;
        }
        await signUpWithEmail(email, password, displayName);
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  const isAdminPortal = portalMode === 'admin';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Narrative Panel */}
      <div className="lg:w-[46%] bg-slate-900 text-slate-100 p-8 lg:p-14 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white">
              <ShieldCheck size={18} />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              ReviewGuard AI
            </span>
          </div>

          <h1 className="mt-12 font-display text-3xl lg:text-4xl font-semibold tracking-tight text-white leading-tight [text-wrap:balance]">
            {isAdminPortal
              ? 'Platform governance across every business tenant.'
              : 'Turn customer feedback into clear operational intelligence.'}
          </h1>
          <p className="mt-4 text-sm lg:text-base text-slate-300 leading-relaxed max-w-md">
            {isAdminPortal
              ? 'Restricted administrative console for monitoring registered tenants, account status, and platform-wide AI controls.'
              : 'Centralize reviews across every business location, collaborate with assigned managers, and draft brand-grounded replies powered by Gemini AI.'}
          </p>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-medium text-white">Multi-Tenant Role Isolation</p>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Owners manage staff and reply approvals; managers access strictly assigned business workspaces.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-white">Server-Verified Permissions</p>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Roles and tenant memberships are enforced in Firestore security rules and Express API middleware.
            </p>
          </div>
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        {/* Entry Point Switcher: Business Login vs Admin Login */}
        <div className="w-full max-w-md mb-4 flex items-center justify-between gap-2 bg-slate-200/70 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => switchPortal('business')}
            className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              !isAdminPortal
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Business Login
          </button>
          <button
            type="button"
            onClick={() => switchPortal('admin')}
            className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              isAdminPortal
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Admin Login
          </button>
        </div>

        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {mode === 'reset'
                  ? 'Reset Your Password'
                  : isAdminPortal
                    ? 'Platform Admin Sign In'
                    : mode === 'signin'
                      ? 'Business Workspace Sign In'
                      : 'Create Business Account'}
              </h2>
              {isAdminPortal && mode !== 'reset' && (
                <p className="mt-0.5 text-xs text-slate-500">
                  No public registration · Server-provisioned admins only
                </p>
              )}
            </div>

            {!isAdminPortal && mode !== 'reset' && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError('');
                    setNotice('');
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'signin'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setError('');
                    setNotice('');
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign Up
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg leading-relaxed">
              {error}
            </div>
          )}

          {notice && (
            <div className="mt-4 p-3 text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg leading-relaxed">
              {notice}
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={handleGoogle}
            className="mt-6 w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400">or continue with email</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isAdminPortal && mode === 'signup' && (
              <div>
                <label htmlFor="auth-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Full Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  maxLength={100}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                Work Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isAdminPortal ? 'admin@platform.com' : 'owner@business.com'}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setError('');
                        setNotice('');
                      }}
                      className="text-xs font-medium text-teal-700 hover:text-teal-800"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
                isAdminPortal
                  ? 'bg-slate-900 hover:bg-slate-800'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              {loading
                ? 'Processing...'
                : mode === 'reset'
                  ? 'Send Password Reset Email'
                  : isAdminPortal
                    ? 'Sign In to Admin Console'
                    : mode === 'signin'
                      ? 'Sign In'
                      : 'Create Account'}
            </button>

            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError('');
                  setNotice('');
                }}
                className="w-full text-center text-xs font-medium text-slate-600 hover:text-slate-900 pt-1"
              >
                Back to Sign In
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
