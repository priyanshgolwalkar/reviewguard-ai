import React, { useState } from 'react';
import {
  BUSINESS_CATEGORIES,
  BUSINESS_LIMITS,
  validateBusinessInput,
  type BusinessInput,
} from '../shared/validation.ts';

interface BusinessFormProps {
  initialValues?: BusinessInput;
  submitLabel: string;
  onSubmit: (values: BusinessInput) => Promise<void>;
  onCancel?: () => void;
}

export function BusinessForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
}: BusinessFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [category, setCategory] = useState(initialValues?.category ?? BUSINESS_CATEGORIES[0]);
  const [city, setCity] = useState(initialValues?.city ?? '');
  const [address, setAddress] = useState(initialValues?.address ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setSubmitError('');

    const validation = validateBusinessInput({ name, category, city, address, description });
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      return;
    }

    setSaving(true);
    try {
      await onSubmit(validation.data);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save business profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {submitError && (
        <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {submitError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="biz-name" className="block text-xs font-medium text-slate-700 mb-1.5">
            Business Name
          </label>
          <input
            id="biz-name"
            type="text"
            required
            maxLength={BUSINESS_LIMITS.nameMax}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Harbor Hearth Bistro"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
          />
          {fieldErrors.name && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
          )}
        </div>

        <div>
          <label htmlFor="biz-category" className="block text-xs font-medium text-slate-700 mb-1.5">
            Business Category
          </label>
          <select
            id="biz-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
          >
            {BUSINESS_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
            {!(BUSINESS_CATEGORIES as readonly string[]).includes(category) && category && (
              <option value={category}>{category}</option>
            )}
          </select>
          {fieldErrors.category && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.category}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="biz-city" className="block text-xs font-medium text-slate-700 mb-1.5">
            City
          </label>
          <input
            id="biz-city"
            type="text"
            required
            maxLength={BUSINESS_LIMITS.cityMax}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Seattle"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
          />
          {fieldErrors.city && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.city}</p>
          )}
        </div>

        <div>
          <label htmlFor="biz-address" className="block text-xs font-medium text-slate-700 mb-1.5">
            Street Address
          </label>
          <input
            id="biz-address"
            type="text"
            required
            maxLength={BUSINESS_LIMITS.addressMax}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="412 Western Ave, Suite 100"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
          />
          {fieldErrors.address && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.address}</p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="biz-description" className="block text-xs font-medium text-slate-700">
            Business Description & Brand Voice Context
          </label>
          <span className="text-xs font-mono-num text-slate-400">
            {description.length}/{BUSINESS_LIMITS.descriptionMax}
          </span>
        </div>
        <textarea
          id="biz-description"
          required
          rows={3}
          maxLength={BUSINESS_LIMITS.descriptionMax}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Neighborhood wood-fired kitchen known for seasonal Pacific Northwest dishes and attentive hospitality."
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
        />
        {fieldErrors.description && (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
        )}
      </div>

      <div className="pt-2 flex items-center justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {saving ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
