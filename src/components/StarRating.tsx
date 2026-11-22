import { Star } from 'lucide-react';

export function StarRatingDisplay({
  rating,
  size = 14,
}: {
  rating: number;
  size?: number;
}) {
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.round(rating);
        return (
          <Star
            key={star}
            size={size}
            className={
              filled
                ? 'fill-amber-500 text-amber-500'
                : 'fill-transparent text-slate-300'
            }
          />
        );
      })}
    </div>
  );
}

export function StarRatingInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= value;
        return (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            className="p-1.5 rounded-md hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            aria-checked={value === star}
            role="radio"
          >
            <Star
              size={20}
              className={
                active
                  ? 'fill-amber-500 text-amber-500'
                  : 'fill-transparent text-slate-300'
              }
            />
          </button>
        );
      })}
      <span className="ml-2 text-xs font-mono-num text-slate-600">
        {value}/5
      </span>
    </div>
  );
}
