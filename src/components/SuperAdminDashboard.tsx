import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  savePlatformSettingsAdmin,
  setBusinessStatusAdmin,
  setUserStatusAdmin,
  subscribeAllBusinessesAdmin,
  subscribeAllUsersAdmin,
  subscribePlatformSettings,
} from '../services/firestoreService.ts';
import type {
  BusinessRecord,
  PlatformSettingsInput,
  PlatformSettingsRecord,
  UserProfileRecord,
} from '../shared/validation.ts';

type AdminTab = 'businesses' | 'users' | 'settings';

export function SuperAdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<AdminTab>('businesses');
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [users, setUsers] = useState<UserProfileRecord[]>([]);
  const [settings, setSettings] = useState<PlatformSettingsRecord | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminNotice, setAdminNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [settingsForm, setSettingsForm] = useState<PlatformSettingsInput>({
    platformName: 'ReviewGuard AI',
    allowNewBusinessRegistration: true,
    maxBusinessesPerOwner: 10,
    aiAnalysisEnabled: true,
    maintenanceMode: false,
  });

  useEffect(() => {
    const unsubBiz = subscribeAllBusinessesAdmin(setBusinesses, (err) => setAdminError(err.message));
    const unsubUsers = subscribeAllUsersAdmin(setUsers, (err) => setAdminError(err.message));
    const unsubSettings = subscribePlatformSettings(
      (s) => {
        setSettings(s);
        setSettingsForm({
          platformName: s.platformName,
          allowNewBusinessRegistration: s.allowNewBusinessRegistration,
          maxBusinessesPerOwner: s.maxBusinessesPerOwner,
          aiAnalysisEnabled: s.aiAnalysisEnabled,
          maintenanceMode: s.maintenanceMode,
        });
      },
      (err) => setAdminError(err.message)
    );

    return () => {
      unsubBiz();
      unsubUsers();
      unsubSettings();
    };
  }, []);

  if (!user) return null;

  const activeBizCount = businesses.filter((b) => b.status === 'active').length;
  const suspendedBizCount = businesses.filter((b) => b.status === 'suspended').length;
  const ownerCount = users.filter((u) => u.role === 'BUSINESS_OWNER').length;
  const managerCount = users.filter((u) => u.role === 'BUSINESS_MANAGER').length;

  const q = searchQuery.trim().toLowerCase();
  const filteredBusinesses = businesses.filter(
    (b) =>
      !q ||
      b.name.toLowerCase().includes(q) ||
      b.city.toLowerCase().includes(q) ||
      b.category.toLowerCase().includes(q)
  );
  const filteredUsers = users.filter(
    (u) =>
      !q ||
      u.email.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
  );

  async function handleToggleBusinessStatus(b: BusinessRecord) {
    setAdminError('');
    setAdminNotice('');
    setBusyId(b.id);
    const nextStatus = b.status === 'active' ? 'suspended' : 'active';
    try {
      await setBusinessStatusAdmin(b.id, nextStatus);
      setAdminNotice(`Business "${b.name}" is now ${nextStatus}.`);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to update business status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleUserStatus(target: UserProfileRecord) {
    if (target.uid === user?.uid) return;
    setAdminError('');
    setAdminNotice('');
    setBusyId(target.uid);
    const nextStatus = target.status === 'active' ? 'suspended' : 'active';
    try {
      await setUserStatusAdmin(target.uid, nextStatus);
      setAdminNotice(`User "${target.email}" is now ${nextStatus}.`);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to update user status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setAdminError('');
    setAdminNotice('');
    setBusyId('settings');
    try {
      await savePlatformSettingsAdmin(user.uid, settingsForm);
      setAdminNotice('Platform settings saved.');
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to save platform settings.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col shrink-0">
        <div className="h-16 px-5 border-b border-slate-800 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white">
            <ShieldCheck size={16} />
          </div>
          <span className="font-display text-base font-semibold tracking-tight text-white">
            {settings?.platformName || 'ReviewGuard AI'}
          </span>
        </div>

        <div className="px-5 py-3 border-b border-slate-800">
          <p className="text-xs font-medium text-teal-400">Super Admin Console</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{user.email}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <button
            type="button"
            onClick={() => setTab('businesses')}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === 'businesses'
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Building2 size={16} />
              <span>Businesses</span>
            </span>
            <span className="font-mono-num text-xs text-slate-400">{businesses.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('users')}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === 'users'
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Users size={16} />
              <span>Users</span>
            </span>
            <span className="font-mono-num text-xs text-slate-400">{users.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === 'settings'
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
            }`}
          >
            <Settings size={16} />
            <span>Platform Settings</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Platform Administration</span>
            <span className="text-slate-300" aria-hidden="true">/</span>
            <span className="font-display font-semibold text-slate-900 capitalize">{tab}</span>
          </div>
          <span className="text-xs font-mono-num text-slate-500">Role: SUPER_ADMIN</span>
        </header>

        <main className="flex-1 p-6 max-w-[1320px] w-full mx-auto space-y-6">
          {/* Platform-wide Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Registered Businesses</p>
              <p className="mt-2 font-mono-num text-3xl font-semibold text-slate-900">
                {businesses.length}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 font-mono-num">
                {activeBizCount} active · {suspendedBizCount} suspended
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Registered Users</p>
              <p className="mt-2 font-mono-num text-3xl font-semibold text-slate-900">
                {users.length}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 font-mono-num">
                {ownerCount} owners · {managerCount} managers
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">AI Processing</p>
              <p
                className={`mt-2 font-display text-2xl font-semibold ${
                  settingsForm.aiAnalysisEnabled ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {settingsForm.aiAnalysisEnabled ? 'Enabled' : 'Disabled'}
              </p>
              <p className="mt-1.5 text-xs text-slate-500">Gemini 4 Hydrogen pipeline</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">New Registrations</p>
              <p
                className={`mt-2 font-display text-2xl font-semibold ${
                  settingsForm.allowNewBusinessRegistration ? 'text-teal-700' : 'text-amber-700'
                }`}
              >
                {settingsForm.allowNewBusinessRegistration ? 'Open' : 'Paused'}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 font-mono-num">
                Max {settingsForm.maxBusinessesPerOwner} per owner
              </p>
            </div>
          </div>

          {adminError && (
            <div className="p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {adminError}
            </div>
          )}

          {adminNotice && (
            <div className="p-3.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
              <CheckCircle2 size={14} />
              <span>{adminNotice}</span>
            </div>
          )}

          {/* Businesses Tab */}
          {tab === 'businesses' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Registered Business Workspaces
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter businesses..."
                    className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="py-3 px-4">Business</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">City</th>
                      <th className="py-3 px-4">Owner ID</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBusinesses.map((biz) => (
                      <tr key={biz.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-medium text-slate-900">{biz.name}</td>
                        <td className="py-3 px-4 text-slate-600">{biz.category}</td>
                        <td className="py-3 px-4 text-slate-600">{biz.city}</td>
                        <td className="py-3 px-4 font-mono-num text-xs text-slate-500">
                          {biz.ownerId.slice(0, 12)}...
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-xs font-medium ${
                              biz.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {biz.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            disabled={busyId === biz.id}
                            onClick={() => handleToggleBusinessStatus(biz)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                              biz.status === 'active'
                                ? 'text-red-700 border-red-200 hover:bg-red-50'
                                : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                            }`}
                          >
                            {biz.status === 'active' ? 'Suspend' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Users Tab */}
          {tab === 'users' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Platform Users & Roles
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter users..."
                    className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="py-3 px-4">Name</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((u) => (
                      <tr key={u.uid} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-medium text-slate-900">{u.displayName}</td>
                        <td className="py-3 px-4 text-slate-600">{u.email}</td>
                        <td className="py-3 px-4 font-mono-num text-xs text-slate-700">{u.role}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-xs font-medium ${
                              u.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {u.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {u.uid === user.uid || u.role === 'SUPER_ADMIN' ? (
                            <span className="text-xs text-slate-400">Protected</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId === u.uid}
                              onClick={() => handleToggleUserStatus(u)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                                u.status === 'active'
                                  ? 'text-red-700 border-red-200 hover:bg-red-50'
                                  : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                              }`}
                            >
                              {u.status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Platform Settings Tab */}
          {tab === 'settings' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
              <h2 className="font-display text-lg font-semibold text-slate-900 border-b border-slate-200 pb-4">
                Global Platform Settings
              </h2>

              <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="plat-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Platform Display Name
                  </label>
                  <input
                    id="plat-name"
                    type="text"
                    required
                    maxLength={100}
                    value={settingsForm.platformName}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, platformName: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="plat-max-biz" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Max Businesses Per Owner
                  </label>
                  <input
                    id="plat-max-biz"
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={settingsForm.maxBusinessesPerOwner}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        maxBusinessesPerOwner: Number(e.target.value) || 1,
                      }))
                    }
                    className="w-40 px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>

                <label className="flex items-center gap-3 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.allowNewBusinessRegistration}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        allowNewBusinessRegistration: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <span className="text-sm text-slate-700">Allow new business workspace creation</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.aiAnalysisEnabled}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        aiAnalysisEnabled: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <span className="text-sm text-slate-700">Enable Gemini AI analysis & drafting globally</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.maintenanceMode}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        maintenanceMode: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <span className="text-sm text-slate-700">Maintenance mode banner</span>
                </label>

                <div className="pt-3 border-t border-slate-200 flex justify-end">
                  <button
                    type="submit"
                    disabled={busyId === 'settings'}
                    className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {busyId === 'settings' ? 'Saving...' : 'Save Platform Settings'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
