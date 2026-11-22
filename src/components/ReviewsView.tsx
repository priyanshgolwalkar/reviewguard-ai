import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Search,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  analyzeReviewOnServer,
  authorizeReplyApprovalOnServer,
  generateDraftResponseOnServer,
} from '../services/apiService.ts';
import {
  deleteReview,
  saveReviewAiAnalysis,
  saveReviewResponseDraft,
} from '../services/firestoreService.ts';
import {
  filterReviews,
  RESPONSE_TONES,
  REVIEW_LIMITS,
  type BusinessRecord,
  type ResponseTone,
  type ReviewRecord,
} from '../shared/validation.ts';
import { StarRatingDisplay } from './StarRating.tsx';

export type ReviewFilterMode = 'all' | 'critical' | 'positive' | 'neutral' | 'negative' | 'unanswered';

interface ReviewsViewProps {
  business: BusinessRecord;
  reviews: ReviewRecord[];
  isOwner: boolean;
  canApproveReplies: boolean;
  selectedReviewId: string | null;
  filter: ReviewFilterMode;
  onFilterChange: (next: ReviewFilterMode) => void;
  onSelectReview: (reviewId: string | null) => void;
  onAddReview: () => void;
  onAnalyzePending: () => void;
  analyzingBatch: boolean;
}

export function ReviewsView({
  business,
  reviews,
  isOwner,
  canApproveReplies,
  selectedReviewId,
  filter,
  onFilterChange,
  onSelectReview,
  onAddReview,
  onAnalyzePending,
  analyzingBatch,
}: ReviewsViewProps) {
  const { getIdToken } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [draftText, setDraftText] = useState('');
  const [tone, setTone] = useState<ResponseTone>('professional');
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [aiWorking, setAiWorking] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackSuccess, setFeedbackSuccess] = useState('');

  const isSuspended = business.status === 'suspended';

  const filteredReviews = useMemo(() => {
    return filterReviews(reviews, filter, searchQuery);
  }, [reviews, filter, searchQuery]);

  const activeReview = useMemo(() => {
    if (filteredReviews.length === 0) return null;
    if (selectedReviewId) {
      const found = filteredReviews.find((r) => r.id === selectedReviewId);
      if (found) return found;
    }
    return filteredReviews[0];
  }, [filteredReviews, selectedReviewId]);

  useEffect(() => {
    if (activeReview) {
      setDraftText(
        activeReview.responseStatus === 'published'
          ? activeReview.publishedResponse || activeReview.aiDraftResponse
          : activeReview.aiDraftResponse
      );
      setTone(activeReview.responseTone || 'professional');
      setActionItems([]);
      setConfirmDeleteId(null);
      setFeedbackError('');
      setFeedbackSuccess('');
    }
  }, [
    activeReview?.id,
    activeReview?.aiDraftResponse,
    activeReview?.publishedResponse,
    activeReview?.responseStatus,
    activeReview?.responseTone,
  ]);

  async function handleRunFullAi(review: ReviewRecord) {
    if (isSuspended) return;
    setFeedbackError('');
    setFeedbackSuccess('');
    setAiWorking(true);
    try {
      const token = await getIdToken();
      const res = await analyzeReviewOnServer(
        {
          businessId: business.id,
          business: {
            name: business.name,
            category: business.category,
            city: business.city,
            address: business.address,
            description: business.description,
          },
          review: {
            authorName: review.authorName,
            rating: review.rating,
            text: review.text,
            reviewDate: review.reviewDate,
            source: review.source,
          },
          tone,
          generateDraft: review.responseStatus !== 'published',
        },
        token
      );
      await saveReviewAiAnalysis(business.id, review.id, res, review.responseStatus);
      setActionItems(res.actionItems);
      if (review.responseStatus !== 'published') {
        setDraftText(res.aiDraftResponse);
        setTone(res.responseTone);
      }
      setFeedbackSuccess('Sentiment analysis and draft saved to Firestore.');
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      setAiWorking(false);
    }
  }

  async function handleRegenerateDraft(review: ReviewRecord) {
    if (review.responseStatus === 'published' || isSuspended) return;
    setFeedbackError('');
    setFeedbackSuccess('');
    setAiWorking(true);
    try {
      const token = await getIdToken();
      const res = await generateDraftResponseOnServer(
        {
          businessId: business.id,
          business: {
            name: business.name,
            category: business.category,
            city: business.city,
            address: business.address,
            description: business.description,
          },
          review: {
            authorName: review.authorName,
            rating: review.rating,
            text: review.text,
            reviewDate: review.reviewDate,
            source: review.source,
            sentiment: review.sentiment,
            categories: review.categories,
          },
          tone,
        },
        token
      );
      setDraftText(res.aiDraftResponse);
      setActionItems(res.actionItems);
      await saveReviewResponseDraft(business.id, review.id, res.aiDraftResponse, tone, 'drafted');
      setFeedbackSuccess(`Generated ${tone} draft response.`);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Draft generation failed.');
    } finally {
      setAiWorking(false);
    }
  }

  async function handleSaveResponse(
    review: ReviewRecord,
    nextStatus: 'drafted' | 'published' | 'rejected'
  ) {
    if (isSuspended) return;
    setFeedbackError('');
    setFeedbackSuccess('');
    setSavingDraft(true);
    try {
      if (nextStatus === 'published' || nextStatus === 'rejected') {
        const token = await getIdToken();
        await authorizeReplyApprovalOnServer(business.id, token);
      }
      await saveReviewResponseDraft(business.id, review.id, draftText, tone, nextStatus);
      if (nextStatus === 'rejected') {
        setDraftText('');
        setFeedbackSuccess('AI draft rejected and cleared.');
      } else if (nextStatus === 'published') {
        setFeedbackSuccess('Response approved, published, and locked.');
      } else {
        setFeedbackSuccess('Draft saved for owner review.');
      }
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Could not update response.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleDelete(reviewId: string) {
    if (!isOwner || isSuspended) return;
    setFeedbackError('');
    try {
      await deleteReview(business.id, reviewId);
      setConfirmDeleteId(null);
      if (selectedReviewId === reviewId) {
        onSelectReview(null);
      }
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to delete review.');
    }
  }

  const pendingCount = reviews.filter((r) => r.sentiment === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Toolbar: Segmented Filters + Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'critical', label: 'Critical' },
              { id: 'negative', label: 'Negative' },
              { id: 'neutral', label: 'Neutral' },
              { id: 'positive', label: 'Positive' },
              { id: 'unanswered', label: 'Needs Reply' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onFilterChange(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reviewer, text, topic..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
            />
          </div>

          {pendingCount > 0 && !isSuspended && (
            <button
              type="button"
              disabled={analyzingBatch}
              onClick={onAnalyzePending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles size={14} />
              <span>{analyzingBatch ? 'Analyzing...' : `Analyze ${pendingCount} Pending`}</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {filteredReviews.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-900">No matching reviews found</p>
          <p className="mt-1 text-xs text-slate-500">
            {reviews.length === 0
              ? 'Add a review manually or import a CSV file to get started.'
              : 'Try clearing your search query or switching to the All filter.'}
          </p>
          {reviews.length === 0 && !isSuspended && (
            <button
              type="button"
              onClick={onAddReview}
              className="mt-4 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors"
            >
              Add Review
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Review List */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[72vh] overflow-y-auto">
            {filteredReviews.map((rev) => {
              const isSelected = activeReview?.id === rev.id;
              return (
                <button
                  key={rev.id}
                  type="button"
                  onClick={() => onSelectReview(rev.id)}
                  className={`w-full text-left p-4 transition-colors block ${
                    isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {rev.authorName}
                    </span>
                    <span className="text-xs font-mono-num text-slate-500 shrink-0">
                      {rev.reviewDate}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                    <StarRatingDisplay rating={rev.rating} size={12} />
                    <span aria-hidden="true">·</span>
                    <span>{rev.source}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        rev.sentiment === 'positive'
                          ? 'text-emerald-700 font-medium'
                          : rev.sentiment === 'negative'
                            ? 'text-red-700 font-medium'
                            : rev.sentiment === 'neutral'
                              ? 'text-amber-700 font-medium'
                              : 'text-slate-500'
                      }
                    >
                      {rev.sentiment}
                    </span>
                    {(rev.isCritical || rev.rating <= 2) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-red-700 font-medium">Critical</span>
                      </>
                    )}
                  </div>

                  <p className="mt-2 text-sm text-slate-700 line-clamp-2">{rev.text}</p>

                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate">
                      {rev.categories.length > 0 ? rev.categories.join(' · ') : 'Uncategorized'}
                    </span>
                    <span className="shrink-0 ml-2 font-medium text-slate-600">
                      {rev.responseStatus}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Review Inspector & AI Response Studio */}
          {activeReview && (
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="font-display text-lg font-semibold text-slate-900">
                      {activeReview.authorName}
                    </h3>
                    {(activeReview.isCritical || activeReview.rating <= 2) && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                        <AlertTriangle size={13} />
                        Critical Alert
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <StarRatingDisplay rating={activeReview.rating} size={13} />
                    <span className="font-mono-num">{activeReview.rating}/5</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">{activeReview.reviewDate}</span>
                    <span aria-hidden="true">·</span>
                    <span>Source: {activeReview.source}</span>
                  </div>
                </div>

                {isOwner && !isSuspended && (
                  <div className="flex items-center gap-2">
                    {confirmDeleteId === activeReview.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(activeReview.id)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(activeReview.id)}
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                        aria-label="Delete review"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Customer Review Body */}
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">Customer Feedback</p>
                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {activeReview.text}
                </p>
              </div>

              {/* AI Sentiment & Topics Strip */}
              <div className="border-t border-b border-slate-200 py-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-slate-500">
                      Sentiment:{' '}
                      <strong
                        className={
                          activeReview.sentiment === 'positive'
                            ? 'text-emerald-700'
                            : activeReview.sentiment === 'negative'
                              ? 'text-red-700'
                              : activeReview.sentiment === 'neutral'
                                ? 'text-amber-700'
                                : 'text-slate-700'
                        }
                      >
                        {activeReview.sentiment}
                      </strong>
                    </span>
                    <span aria-hidden="true" className="text-slate-300">|</span>
                    <span className="font-mono-num text-slate-600">
                      Score: {activeReview.sentimentScore.toFixed(2)}
                    </span>
                    {activeReview.categories.length > 0 && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">|</span>
                        <span className="text-slate-700">
                          Topics: {activeReview.categories.join(', ')}
                        </span>
                      </>
                    )}
                  </div>

                  {!isSuspended && activeReview.responseStatus !== 'published' && (
                    <button
                      type="button"
                      disabled={aiWorking}
                      onClick={() => handleRunFullAi(activeReview)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Sparkles size={13} />
                      <span>
                        {aiWorking
                          ? 'Running AI Agents...'
                          : activeReview.sentiment === 'pending'
                            ? 'Analyze with Gemini AI'
                            : 'Re-run AI Analysis'}
                      </span>
                    </button>
                  )}
                </div>

                {activeReview.aiSummary && (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-medium text-slate-800">AI Summary:</span> {activeReview.aiSummary}
                  </p>
                )}

                {activeReview.criticalReason && (
                  <p className="text-xs text-red-700 leading-relaxed">
                    <span className="font-medium">Alert Reason:</span> {activeReview.criticalReason}
                  </p>
                )}

                {actionItems.length > 0 && (
                  <div className="pt-1">
                    <p className="text-xs font-medium text-slate-800">Suggested Internal Action Items:</p>
                    <ul className="mt-1 list-disc list-inside text-xs text-slate-600 space-y-0.5">
                      {actionItems.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Response Drafting & Approval Studio */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-display text-sm font-semibold text-slate-900">
                      Owner Response
                    </h4>
                    <p className="text-xs text-slate-500">
                      Status:{' '}
                      <span className="font-medium text-slate-700">
                        {activeReview.responseStatus === 'published'
                          ? 'Published (locked)'
                          : activeReview.responseStatus === 'rejected'
                            ? 'Draft Rejected'
                            : activeReview.responseStatus === 'drafted'
                              ? 'Draft ready for approval'
                              : 'Unanswered'}
                      </span>
                    </p>
                  </div>

                  {activeReview.responseStatus !== 'published' && !isSuspended && (
                    <div className="flex items-center gap-2">
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value as ResponseTone)}
                        aria-label="Response tone"
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-700"
                      >
                        {RESPONSE_TONES.map((t) => (
                          <option key={t} value={t}>
                            Tone: {t.charAt(0).toUpperCase() + t.slice(1)}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={aiWorking}
                        onClick={() => handleRegenerateDraft(activeReview)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Sparkles size={13} />
                        <span>{aiWorking ? 'Drafting...' : 'Generate AI Reply'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {!canApproveReplies && activeReview.responseStatus !== 'published' && (
                  <div className="p-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                    <Lock size={14} className="shrink-0" />
                    <span>
                      Draft-only access: You can generate and save drafts, while reply approval and publishing requires explicit owner permission.
                    </span>
                  </div>
                )}

                {feedbackError && (
                  <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                    {feedbackError}
                  </div>
                )}

                {feedbackSuccess && (
                  <div className="p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                    <CheckCircle2 size={14} />
                    <span>{feedbackSuccess}</span>
                  </div>
                )}

                <textarea
                  rows={5}
                  maxLength={REVIEW_LIMITS.aiDraftResponseMax}
                  disabled={activeReview.responseStatus === 'published' || isSuspended}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Write a reply or click Generate AI Reply to draft a response with Gemini..."
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 disabled:bg-slate-50 disabled:text-slate-600"
                />

                {activeReview.responseStatus !== 'published' && !isSuspended && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <span className="text-xs font-mono-num text-slate-400">
                      {draftText.length}/{REVIEW_LIMITS.aiDraftResponseMax}
                    </span>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={savingDraft || !draftText.trim()}
                        onClick={() => handleSaveResponse(activeReview, 'drafted')}
                        className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        Save Draft
                      </button>

                      {canApproveReplies && (
                        <>
                          {activeReview.aiDraftResponse && (
                            <button
                              type="button"
                              disabled={savingDraft}
                              onClick={() => handleSaveResponse(activeReview, 'rejected')}
                              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              <XCircle size={13} />
                              <span>Reject Draft</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={savingDraft || !draftText.trim()}
                            onClick={() => handleSaveResponse(activeReview, 'published')}
                            className="px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            {savingDraft ? 'Saving...' : 'Approve & Publish'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
