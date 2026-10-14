/**
 * How the ratings are actually distributed (`FV-022`).
 *
 * **The dashboard already fetched this and threw the shape away.** `AdminStats` reduces the same
 * five buckets to one number — their sum — and renders that as "Reviews". `analyticsModel`'s own
 * header says why that is a loss:
 *
 *   > An average alone hides the shape: 3.0 is a catalogue of threes or a catalogue of ones and
 *   > fives, and those are different products.
 *
 * Computing a distribution on every dashboard load and rendering only its total is the read-side
 * version of `ADR-022`'s complaint about writers with no readers. This is the reader.
 *
 * Every bucket is drawn even at zero — the model guarantees all five are present — because a chart
 * that shows only the non-empty buckets hides the very thing it is for. A catalogue with no 1-stars
 * should show an empty 1-star row, not four rows.
 */

export const RatingDistribution = ({ ratings }) => {
  const buckets = [5, 4, 3, 2, 1];
  const counts = buckets.map((rating) => ({ rating, count: ratings?.[rating] ?? 0 }));
  const total = counts.reduce((sum, bucket) => sum + bucket.count, 0);
  const peak = Math.max(1, ...counts.map((bucket) => bucket.count));

  if (total === 0) {
    // Not an empty bar chart. "No ratings yet" and "every rating is zero" look identical drawn and
    // are different facts — the `BUG M-2` rule the average already follows.
    return <p className="py-4 text-sm text-gray-600">No reviews have been left yet.</p>;
  }

  return (
    <div>
      <ul className="space-y-2">
        {counts.map(({ rating, count }) => (
          <li key={rating} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-sm text-gray-700">
              {rating} star{rating === 1 ? '' : 's'}
            </span>
            {/*
              A real meter, not a coloured div: `role="meter"` with its bounds is what makes the
              proportion available to a screen reader, and the visible number beside it is what
              makes it available to everyone else. Neither alone is enough.
            */}
            <span
              role="meter"
              aria-valuenow={count}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label={`${count} of ${total} reviews rated ${rating} out of 5`}
              className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100"
            >
              <span
                className="block h-full rounded-full bg-primary-500"
                style={{ width: `${(count / peak) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-600">
              {count} ({total === 0 ? 0 : Math.round((count / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        {total} review{total === 1 ? '' : 's'} in total.
      </p>
    </div>
  );
};

export default RatingDistribution;
