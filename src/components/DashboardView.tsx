import {
  AlertTriangle,
  ArrowRight,
  MessageSquarePlus,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  computeDashboardAnalytics,
  type BusinessRecord,
  type ReviewRecord,
} from '../shared/validation.ts';
import { StarRatingDisplay } from './StarRating.tsx';

interface DashboardViewProps {
  business: BusinessRecord;
  reviews: ReviewRecord[];
  loading: boolean;
  onAddReview: () => void;
  onImportCsv: () => void;
  onOpenReview: (reviewId: string) => void;
  onNavigateReviews: (filter?: 'all' | 'critical' | 'unanswered') => void;
  onAnalyzePending: () => void;
  analyzingBatch: boolean;
}

export function DashboardView({
  business,
  reviews,
  loading,
  onAddReview,
  onImportCsv,
  onOpenReview,
  onNavigateReviews,
  onAnalyzePending,
  analyzingBatch,
}: DashboardViewProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-2xl mx-auto mt-6">
        <h2 className="font-display text-xl font-semibold text-slate-900">
          No reviews recorded for {business.name} yet
        </h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
          Add customer reviews manually or upload a CSV export to unlock Gemini sentiment scoring, critical issue alerts, complaint categorization, and AI-drafted replies.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onAddReview}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquarePlus size={16} />
            <span>Add First Review</span>
          </button>
          <button
            type="button"
            onClick={onImportCsv}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload size={16} />
            <span>Import Reviews CSV</span>
          </button>
        </div>
      </div>
    );
  }

  const analytics = computeDashboardAnalytics(reviews);
  const { sentimentCounts, ratingDistribution } = analytics;
  const total = analytics.totalReviews;

  const pct = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

  return (
    <div className="space-y-6">
      {/* Pending AI notification bar if unanalyzed reviews exist */}
      {sentimentCounts.pending > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-slate-700">
            <span className="font-mono-num font-semibold text-slate-900">{sentimentCounts.pending}</span>{' '}
            {sentimentCounts.pending === 1 ? 'review has' : 'reviews have'} not been analyzed by Gemini AI yet.
          </div>
          <button
            type="button"
            disabled={analyzingBatch}
            onClick={onAnalyzePending}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Sparkles size={14} />
            <span>{analyzingBatch ? 'Analyzing...' : 'Analyze Pending Reviews'}</span>
          </button>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Reviews</p>
          <p className="mt-2 font-mono-num text-3xl font-semibold text-slate-900">
            {analytics.totalReviews}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Across {business.city} location
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Average Rating</p>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="font-mono-num text-3xl font-semibold text-slate-900">
              {analytics.averageRating.toFixed(2)}
            </span>
            <StarRatingDisplay rating={analytics.averageRating} size={15} />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            5-point customer scale
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Response Coverage</p>
          <p className="mt-2 font-mono-num text-3xl font-semibold text-slate-900">
            {analytics.responseRate}%
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Published owner replies
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Critical Review Alerts</p>
          <p
            className={`mt-2 font-mono-num text-3xl font-semibold ${
              analytics.criticalReviews.length > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {analytics.criticalReviews.length}
          </p>
          <button
            type="button"
            onClick={() => onNavigateReviews('critical')}
            className="mt-1.5 text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
          >
            <span>Inspect critical queue</span>
            <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Analytics Row: Sentiment Distribution + Rating Breakdown & Complaint Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sentiment Distribution & Rating Scale */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Sentiment Distribution
              </h3>
              <span className="text-xs font-mono-num text-slate-500">{total} total</span>
            </div>

            {/* Segmented proportion bar */}
            <div className="mt-4 h-3 w-full rounded-md overflow-hidden bg-slate-100 flex">
              {sentimentCounts.positive > 0 && (
                <div
                  className="bg-emerald-600 h-full"
                  style={{ width: `${(sentimentCounts.positive / total) * 100}%` }}
                  title={`Positive: ${sentimentCounts.positive}`}
                />
              )}
              {sentimentCounts.neutral > 0 && (
                <div
                  className="bg-amber-500 h-full"
                  style={{ width: `${(sentimentCounts.neutral / total) * 100}%` }}
                  title={`Neutral: ${sentimentCounts.neutral}`}
                />
              )}
              {sentimentCounts.negative > 0 && (
                <div
                  className="bg-red-600 h-full"
                  style={{ width: `${(sentimentCounts.negative / total) * 100}%` }}
                  title={`Negative: ${sentimentCounts.negative}`}
                />
              )}
              {sentimentCounts.pending > 0 && (
                <div
                  className="bg-slate-300 h-full"
                  style={{ width: `${(sentimentCounts.pending / total) * 100}%` }}
                  title={`Pending AI: ${sentimentCounts.pending}`}
                />
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
              <div>
                <p className="text-xs text-slate-500">Positive</p>
                <p className="mt-1 font-mono-num text-lg font-semibold text-emerald-700">
                  {sentimentCounts.positive}{' '}
                  <span className="text-xs font-normal text-slate-500">({pct(sentimentCounts.positive)}%)</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Neutral</p>
                <p className="mt-1 font-mono-num text-lg font-semibold text-amber-700">
                  {sentimentCounts.neutral}{' '}
                  <span className="text-xs font-normal text-slate-500">({pct(sentimentCounts.neutral)}%)</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Negative</p>
                <p className="mt-1 font-mono-num text-lg font-semibold text-red-700">
                  {sentimentCounts.negative}{' '}
                  <span className="text-xs font-normal text-slate-500">({pct(sentimentCounts.negative)}%)</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Pending AI</p>
                <p className="mt-1 font-mono-num text-lg font-semibold text-slate-700">
                  {sentimentCounts.pending}{' '}
                  <span className="text-xs font-normal text-slate-500">({pct(sentimentCounts.pending)}%)</span>
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h4 className="text-xs font-medium text-slate-500 mb-3">Star Rating Breakdown</h4>
            <div className="space-y-2.5">
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const count = ratingDistribution[star];
                const share = pct(count);
                return (
                  <div key={star} className="flex items-center gap-3 text-xs">
                    <span className="w-12 font-mono-num text-slate-700 shrink-0">{star} star</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        className={`h-full ${star >= 4 ? 'bg-teal-700' : star === 3 ? 'bg-amber-500' : 'bg-red-600'}`}
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className="w-16 text-right font-mono-num text-slate-600 shrink-0">
                      {count} ({share}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Common Complaint Categories */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Top Feedback & Complaint Topics
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Categories extracted by Gemini Sentiment Agent across analyzed reviews.
          </p>

          {analytics.complaintCategories.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <p className="text-sm text-slate-600">No topic categories extracted yet.</p>
              <p className="mt-1 text-xs text-slate-500">
                Run AI analysis on reviews to surface recurring complaint themes.
              </p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {analytics.complaintCategories.map((cat) => (
                <div key={cat.category} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{cat.category}</p>
                    <p className="text-xs text-slate-500 font-mono-num">
                      {cat.count} total mention{cat.count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`text-xs font-mono-num font-medium ${
                        cat.negativeCount > 0 ? 'text-red-700' : 'text-slate-600'
                      }`}
                    >
                      {cat.negativeCount} critical/neg
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Critical Review Alerts + Recent Reviews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Critical Review Alerts */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600" />
              <h3 className="font-display text-base font-semibold text-slate-900">
                Critical Review Alerts
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateReviews('critical')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
            >
              View all
            </button>
          </div>

          {analytics.criticalReviews.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              No critical reviews flagged right now. Great job maintaining service quality.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {analytics.criticalReviews.slice(0, 5).map((rev) => (
                <div key={rev.id} className="py-3.5 first:pt-1 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-medium text-slate-900">{rev.authorName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">{rev.reviewDate}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num text-red-700 font-medium">{rev.rating}/5</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700 line-clamp-2">{rev.text}</p>
                      {rev.criticalReason && (
                        <p className="mt-1 text-xs text-red-700">{rev.criticalReason}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenReview(rev.id)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      {rev.responseStatus === 'published' ? 'View' : 'Respond'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Reviews */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Recent Reviews
            </h3>
            <button
              type="button"
              onClick={() => onNavigateReviews('all')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
            >
              Manage all
            </button>
          </div>

          <div className="mt-4 divide-y divide-slate-100">
            {analytics.recentReviews.slice(0, 5).map((rev) => (
              <div key={rev.id} className="py-3.5 first:pt-1 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-900">{rev.authorName}</span>
                      <span aria-hidden="true">·</span>
                      <StarRatingDisplay rating={rev.rating} size={12} />
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">{rev.reviewDate}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700 line-clamp-2">{rev.text}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
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
                        Sentiment: {rev.sentiment}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Status: {rev.responseStatus}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenReview(rev.id)}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    Inspect
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
