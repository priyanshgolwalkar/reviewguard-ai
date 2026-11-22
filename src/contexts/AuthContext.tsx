import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase.ts';
import { bootstrapSuperAdminOnServer, fetchSessionRole } from '../services/apiService.ts';
import { ensureUserProfileAndMigrate } from '../services/firestoreService.ts';
import type { AccountStatus, UserRole } from '../shared/validation.ts';

export type PortalEntryMode = 'business' | 'admin';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  roleLoaded: boolean;
  userRole: UserRole | null;
  userStatus: AccountStatus;
  roleError: string;
  portalMode: PortalEntryMode;
  setPortalMode: (mode: PortalEntryMode) => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshUser: () => Promise<boolean>;
  refreshSessionRole: () => Promise<void>;
  provisionAdminSession: (bootstrapSecret?: string) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [, setAuthRevision] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userStatus, setUserStatus] = useState<AccountStatus>('active');
  const [roleError, setRoleError] = useState('');
  const [portalMode, setPortalMode] = useState<PortalEntryMode>(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      return 'admin';
    }
    return 'business';
  });

  async function resolveAuthoritativeRole(firebaseUser: User, attemptAdminBootstrap = false, secret?: string) {
    setRoleError('');
    try {
      const token = await firebaseUser.getIdToken(true);
      if (attemptAdminBootstrap) {
        await bootstrapSuperAdminOnServer(token, secret);
      }

      // Migrate legacy /users/{uid} record if needed, never overwriting an existing role
      const profile = await ensureUserProfileAndMigrate(
        firebaseUser.uid,
        firebaseUser.email ?? 'owner@reviewguard.local',
        firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? 'Business User'
      );

      if (profile.status === 'suspended' && profile.role !== 'SUPER_ADMIN') {
        setUserRole(profile.role);
        setUserStatus('suspended');
        return;
      }

      const session = await fetchSessionRole(token);
      setUserRole(session.role);
      setUserStatus(session.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to resolve workspace role.';
      setRoleError(msg);
      setUserRole((prev) => prev ?? null);
    } finally {
      setRoleLoaded(true);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setUserRole(null);
        setUserStatus('active');
        setRoleError('');
        setRoleLoaded(true);
        return;
      }

      if (!nextUser.emailVerified) {
        setUserRole(null);
        setRoleLoaded(true);
        return;
      }

      setRoleLoaded(false);
      await resolveAuthoritativeRole(nextUser, false);
    });
    return () => unsubscribe();
  }, []);

  async function signInWithGoogle() {
    await signInWithPopup(auth, googleProvider);
  }

  async function signInWithEmail(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }

  async function signUpWithEmail(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const cleanName = displayName.trim();
    if (cleanName) {
      await updateProfile(cred.user, { displayName: cleanName });
    }
    if (!cred.user.emailVerified) {
      await sendEmailVerification(cred.user);
    }
    setUser(auth.currentUser);
    setAuthRevision((r) => r + 1);
  }

  async function sendPasswordReset(email: string) {
    await sendPasswordResetEmail(auth, email.trim());
  }

  async function resendVerification() {
    if (!auth.currentUser) throw new Error('Not signed in.');
    await sendEmailVerification(auth.currentUser);
  }

  async function refreshUser(): Promise<boolean> {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const updated = auth.currentUser;
    setUser(updated);
    setAuthRevision((r) => r + 1);
    if (updated?.emailVerified) {
      setRoleLoaded(false);
      await resolveAuthoritativeRole(updated, false);
      return true;
    }
    return false;
  }

  async function refreshSessionRole() {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    setRoleLoaded(false);
    await resolveAuthoritativeRole(auth.currentUser, false);
  }

  async function provisionAdminSession(bootstrapSecret?: string) {
    if (!auth.currentUser || !auth.currentUser.emailVerified) {
      throw new Error('Verified sign-in is required.');
    }
    setRoleLoaded(false);
    await resolveAuthoritativeRole(auth.currentUser, true, bootstrapSecret);
  }

  async function logout() {
    await signOut(auth);
    setUserRole(null);
    setUserStatus('active');
    setRoleError('');
    if (typeof window !== 'undefined') {
      setPortalMode(window.location.pathname.startsWith('/admin') ? 'admin' : 'business');
    }
  }

  async function getIdToken(): Promise<string> {
    if (!auth.currentUser) {
      throw new Error('Authentication required.');
    }
    return auth.currentUser.getIdToken();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        roleLoaded,
        userRole,
        userStatus,
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
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
