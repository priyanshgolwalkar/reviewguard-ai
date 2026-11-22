import { useState } from 'react';
import { Building2, CheckCircle2, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { createBusiness, updateBusiness } from '../services/firestoreService.ts';
import type { BusinessInput, BusinessRecord } from '../shared/validation.ts';
import { BusinessForm } from './BusinessForm.tsx';

interface BusinessProfileViewProps {
  business: BusinessRecord;
  isOwner: boolean;
  onCreatedBusiness: (newBusinessId: string) => void;
}

export function BusinessProfileView({
  business,
  isOwner,
  onCreatedBusiness,
}: BusinessProfileViewProps) {
  const { user } = useAuth();
  const [creatingNew, setCreatingNew] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');

  async function handleUpdate(values: BusinessInput) {
    setSavedNotice('');
    await updateBusiness(business.id, values, business.status);
    setSavedNotice('Business profile updated in Firestore.');
  }

  async function handleCreate(values: BusinessInput) {
    if (!user) return;
    const newId = await createBusiness(
      user.uid,
      user.email ?? 'owner@reviewguard.local',
      user.displayName ?? 'Business Owner',
      values
    );
    setCreatingNew(false);
    onCreatedBusiness(newId);
  }

  if (!isOwner) {
    return (
      <div className="max-w-3xl bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-200 pb-4">
          <Building2 size={18} className="text-teal-700" />
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              {business.name}
            </h2>
            <p className="text-xs text-slate-500">
              Assigned Business Manager view · Profile editing is restricted to the Business Owner.
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm pt-2">
          <div>
            <dt className="text-xs font-medium text-slate-500">Category</dt>
            <dd className="mt-1 text-slate-900">{business.category}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Location</dt>
            <dd className="mt-1 text-slate-900">{business.city} · {business.address}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-slate-500">Brand Description</dt>
            <dd className="mt-1 text-slate-700 leading-relaxed">{business.description}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2.5">
            <Building2 size={18} className="text-teal-700" />
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Business Profile Settings
              </h2>
              <p className="text-xs text-slate-500">
                Used by Gemini AI agents to tailor tone, location context, and brand voice.
              </p>
            </div>
          </div>

          {!creatingNew && business.status === 'active' && (
            <button
              type="button"
              onClick={() => setCreatingNew(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus size={14} />
              <span>Add Another Business</span>
            </button>
          )}
        </div>

        {savedNotice && (
          <div className="mt-4 p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
            <CheckCircle2 size={14} />
            <span>{savedNotice}</span>
          </div>
        )}

        <div className="mt-5">
          {business.status === 'suspended' ? (
            <p className="text-sm text-red-700">
              This business workspace is currently suspended by a platform administrator and cannot be edited.
            </p>
          ) : (
            <BusinessForm
              key={business.id}
              initialValues={{
                name: business.name,
                category: business.category,
                city: business.city,
                address: business.address,
                description: business.description,
              }}
              submitLabel="Save Business Profile"
              onSubmit={handleUpdate}
            />
          )}
        </div>
      </div>

      {creatingNew && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="border-b border-slate-200 pb-4 mb-5">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Create Additional Business Location
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Each business maintains an isolated tenant boundary, team, and analytics dashboard.
            </p>
          </div>
          <BusinessForm
            submitLabel="Create Business"
            onSubmit={handleCreate}
            onCancel={() => setCreatingNew(false)}
          />
        </div>
      )}
    </div>
  );
}
