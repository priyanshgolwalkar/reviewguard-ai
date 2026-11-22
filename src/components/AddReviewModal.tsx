import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  REVIEW_LIMITS,
  REVIEW_SOURCES,
  validateReviewInput,
  type BusinessRecord,
  type ReviewSource,
} from '../shared/validation.ts';
import { analyzeReviewOnServer } from '../services/apiService.ts';
import { createReview } from '../services/firestoreService.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { StarRatingInput } from './StarRating.tsx';

interface AddReviewModalProps {
  business: BusinessRecord;
  onClose: () => void;
  onCreated: (reviewId: string) => void;
}

export function AddReviewModal({ business, onClose, onCreated }: AddReviewModalProps) {
  const { user, getIdToken } = useAuth();
  const [authorName, setAuthorName] = useState('');
  const [rating, setRating] = useState(5);
  const [reviewDate, setReviewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<ReviewSource>('manual');
  const [text, setText] = useState('');
  const [runAiImmediately, setRunAiImmediately] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setFieldErrors({});
    setSubmitError('');

    const validated = validateReviewInput({
      authorName,
      rating,
      text,
      reviewDate,
      source,
    });
    if (!validated.valid) {
      setFieldErrors(validated.errors);
      return;
    }

    setSubmitting(true);
    try {
      let aiAnalysis;
      if (runAiImmediately) {
        const token = await getIdToken();
        aiAnalysis = await analyzeReviewOnServer(
          {
            businessId: business.id,
            business: {
              name: business.name,
              category: business.category,
              city: business.city,
              address: business.address,
              description: business.description,
            },
            review: validated.data,
            generateDraft: true,
          },
          token
        );
      }

      const reviewId = await createReview(business.ownerId, business.id, validated.data, {
        aiAnalysis,
      });
      onCreated(reviewId);
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not save review. Please check your input and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-review-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 id="add-review-title" className="font-display text-lg font-semibold text-slate-900">
              Add Customer Review
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{business.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {submitError && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {submitError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Star Rating
            </label>
            <StarRatingInput value={rating} onChange={setRating} />
            {fieldErrors.rating && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.rating}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rev-author" className="block text-xs font-medium text-slate-700 mb-1.5">
                Reviewer Name
              </label>
              <input
                id="rev-author"
                type="text"
                required
                maxLength={REVIEW_LIMITS.authorNameMax}
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Jordan Taylor"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
              />
              {fieldErrors.authorName && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.authorName}</p>
              )}
            </div>

            <div>
              <label htmlFor="rev-date" className="block text-xs font-medium text-slate-700 mb-1.5">
                Review Date
              </label>
              <input
                id="rev-date"
                type="date"
                required
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
              />
              {fieldErrors.reviewDate && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.reviewDate}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="rev-source" className="block text-xs font-medium text-slate-700 mb-1.5">
              Review Source
            </label>
            <select
              id="rev-source"
              value={source}
              onChange={(e) => setSource(e.target.value as ReviewSource)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
            >
              {REVIEW_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="rev-text" className="block text-xs font-medium text-slate-700">
                Review Content
              </label>
              <span className="text-xs font-mono-num text-slate-400">
                {text.length}/{REVIEW_LIMITS.textMax}
              </span>
            </div>
            <textarea
              id="rev-text"
              required
              rows={4}
              maxLength={REVIEW_LIMITS.textMax}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste or enter the customer's feedback..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
            />
            {fieldErrors.text && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.text}</p>
            )}
          </div>

          <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={runAiImmediately}
              onChange={(e) => setRunAiImmediately(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
            />
            <span className="text-xs text-slate-600 leading-relaxed">
              Run Gemini Sentiment & Response Drafting Agents immediately before saving to Firestore
            </span>
          </label>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting
                ? runAiImmediately
                  ? 'Analyzing & Saving...'
                  : 'Saving...'
                : 'Save Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
