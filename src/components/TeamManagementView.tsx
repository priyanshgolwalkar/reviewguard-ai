import React, { useEffect, useState } from 'react';
import { CheckCircle2, MailPlus, Trash2, UserCheck, Users } from 'lucide-react';
import {
  inviteBusinessManager,
  removeManagerMembership,
  revokeBusinessInvite,
  subscribeBusinessStaff,
  updateManagerPermission,
} from '../services/firestoreService.ts';
import type {
  BusinessInviteRecord,
  BusinessMemberRecord,
  BusinessRecord,
} from '../shared/validation.ts';

interface TeamManagementViewProps {
  business: BusinessRecord;
  ownerId: string;
}

export function TeamManagementView({ business, ownerId }: TeamManagementViewProps) {
  const [members, setMembers] = useState<BusinessMemberRecord[]>([]);
  const [invites, setInvites] = useState<BusinessInviteRecord[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [canApproveReplies, setCanApproveReplies] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const unsub = subscribeBusinessStaff(
      business.id,
      ownerId,
      (nextMembers, nextInvites) => {
        setMembers(nextMembers);
        setInvites(nextInvites);
      },
      (err) => setError(err.message)
    );
    return () => unsub();
  }, [business.id, ownerId]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      await inviteBusinessManager(business, ownerId, inviteEmail, canApproveReplies);
      setNotice(`Invitation sent to ${inviteEmail.trim().toLowerCase()}.`);
      setInviteEmail('');
      setCanApproveReplies(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite staff member.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTogglePermission(member: BusinessMemberRecord) {
    setError('');
    setNotice('');
    try {
      await updateManagerPermission(member.id, !member.canApproveReplies);
      setNotice(
        `Updated reply approval permission for ${member.email} to ${
          !member.canApproveReplies ? 'allowed' : 'draft-only'
        }.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update manager permission.');
    }
  }

  async function handleRemoveMember(member: BusinessMemberRecord) {
    setError('');
    setNotice('');
    try {
      await removeManagerMembership(member.id);
      setNotice(`Removed ${member.email} from ${business.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove staff member.');
    }
  }

  async function handleRevokeInvite(invite: BusinessInviteRecord) {
    setError('');
    setNotice('');
    try {
      await revokeBusinessInvite(invite.id);
      setNotice(`Revoked pending invitation for ${invite.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation.');
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Invite Manager Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2.5 border-b border-slate-200 pb-4">
          <MailPlus size={18} className="text-teal-700" />
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Invite Business Manager
            </h2>
            <p className="text-xs text-slate-500">
              Managers can access only {business.name}, run AI analysis, and generate reply drafts.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </div>
        )}

        {notice && (
          <div className="mt-4 p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
            <CheckCircle2 size={14} />
            <span>{notice}</span>
          </div>
        )}

        <form onSubmit={handleInvite} className="mt-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              required
              maxLength={254}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="manager@company.com"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {submitting ? 'Inviting...' : 'Send Invite'}
            </button>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={canApproveReplies}
              onChange={(e) => setCanApproveReplies(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
            />
            <span className="text-xs text-slate-600 leading-relaxed">
              Grant reply approval permission (allows this manager to approve, reject, and publish AI replies)
            </span>
          </label>
        </form>
      </div>

      {/* Active Staff */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-4">
          <Users size={18} className="text-slate-700" />
          <h3 className="font-display text-base font-semibold text-slate-900">
            Active Business Managers ({members.length})
          </h3>
        </div>

        {members.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No managers assigned to {business.name} yet.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {members.map((member) => (
              <div
                key={member.id}
                className="py-3.5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <UserCheck size={15} className="text-teal-700 shrink-0" />
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {member.displayName}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-600 truncate">{member.email}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 font-mono-num">
                    Role: BUSINESS_MANAGER · Reply Approval:{' '}
                    <span className={member.canApproveReplies ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                      {member.canApproveReplies ? 'Granted' : 'Draft Only'}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleTogglePermission(member)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    {member.canApproveReplies ? 'Revoke Approval' : 'Grant Approval'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member)}
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                    aria-label={`Remove ${member.email}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Invitations */}
      {invites.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-display text-base font-semibold text-slate-900 border-b border-slate-200 pb-4">
            Pending Staff Invitations ({invites.length})
          </h3>
          <div className="mt-4 divide-y divide-slate-100">
            {invites.map((inv) => (
              <div key={inv.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{inv.email}</p>
                  <p className="text-xs text-slate-500 font-mono-num">
                    Pending · Reply Approval: {inv.canApproveReplies ? 'Granted' : 'Draft Only'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeInvite(inv)}
                  className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Revoke Invite
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
