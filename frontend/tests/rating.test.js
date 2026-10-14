import {
  getAverageRating,
  formatAverageRating,
  getRatingCount,
  hasRating,
  getStarCount
} from '../src/utils/rating';

/**
 * Rating resolution (IMP-073, locking in the fix for BUG M-2).
 *
 * The bug this guards: `rating_sum / rating_count` was recomputed at nine call sites, and the
 * **empty case had three different answers** — `null` on cards, the string `'New'` on the home
 * page, and `0` on the detail page. `0` is the actively harmful one: a place nobody has reviewed
 * renders as a zero-star rating, i.e. as a place everyone disliked.
 *
 * So the assertion that matters most here is not arithmetic. It is that "no ratings" and "rated
 * zero" stay different facts all the way through the module.
 */

const UNRATED = { rating_sum: 0, rating_count: 0 };
const RATED = { average_rating: '4.5', rating_sum: 9, rating_count: 2 };

describe('unrated is null, never 0 (BUG M-2)', () => {
  test('getAverageRating returns null, and null is not 0', () => {
    expect(getAverageRating(UNRATED)).toBeNull();
    // Explicit, because `0` would satisfy a lazy `toBeFalsy()` and reintroduce the bug.
    expect(getAverageRating(UNRATED)).not.toBe(0);
  });

  test('a missing or malformed place is also null, not 0', () => {
    expect(getAverageRating(null)).toBeNull();
    expect(getAverageRating(undefined)).toBeNull();
    expect(getAverageRating({})).toBeNull();
  });

  test('hasRating is false for unrated', () => {
    expect(hasRating(UNRATED)).toBe(false);
    expect(hasRating(RATED)).toBe(true);
  });

  test('getStarCount is 0 for unrated — the star display has no other option', () => {
    // The distinction is preserved upstream in getAverageRating; a star count genuinely has to be
    // a number. This asserts the collapse happens HERE and nowhere earlier.
    expect(getStarCount(UNRATED)).toBe(0);
    expect(getAverageRating(UNRATED)).toBeNull();
  });
});

describe('the caller chooses what "no ratings" looks like', () => {
  // Three call sites wanted three different empty renderings and each was right for its context.
  // Making it a parameter is what stopped them disagreeing by accident.
  test('default empty is null', () => {
    expect(formatAverageRating(UNRATED)).toBeNull();
  });

  test("the home carousel's 'New' and a card's blank both work", () => {
    expect(formatAverageRating(UNRATED, 'New')).toBe('New');
    expect(formatAverageRating(UNRATED, '')).toBe('');
  });

  test('the empty value is not applied to a rated place', () => {
    expect(formatAverageRating(RATED, 'New')).toBe('4.5');
  });
});

describe('average_rating is authoritative, and arrives as a string', () => {
  test('the pg NUMERIC string is parsed, not used raw', () => {
    // `pg` serialises NUMERIC as text to avoid float precision loss. Returning the string would
    // make `.toFixed` throw and `>=` comparisons compare lexically.
    const parsed = getAverageRating({ average_rating: '4.5' });
    expect(typeof parsed).toBe('number');
    expect(parsed).toBe(4.5);
  });

  test('it wins over rating_sum/rating_count when both are present', () => {
    // If these ever disagree, the server's SQL ROUND() is the one that matches what was indexed
    // and sorted on. Recomputing client-side is what produced two roundings that could differ.
    expect(getAverageRating({ average_rating: '4.5', rating_sum: 100, rating_count: 2 })).toBe(4.5);
  });

  test('a non-finite average_rating falls through rather than poisoning the result', () => {
    expect(getAverageRating({ average_rating: 'nonsense', rating_sum: 9, rating_count: 2 })).toBe(
      4.5
    );
  });
});

describe('the fallback for payloads without the computed column', () => {
  test('computes from sum and count', () => {
    expect(getAverageRating({ rating_sum: 9, rating_count: 2 })).toBe(4.5);
  });

  test('rounds to one decimal, matching the SQL contract', () => {
    expect(getAverageRating({ rating_sum: 10, rating_count: 3 })).toBe(3.3);
  });

  test('a zero or negative count is unrated, not a division', () => {
    expect(getAverageRating({ rating_sum: 5, rating_count: 0 })).toBeNull();
    expect(getAverageRating({ rating_sum: 5, rating_count: -1 })).toBeNull();
  });
});

describe('getRatingCount is always a number', () => {
  test('returns the count when present', () => {
    expect(getRatingCount(RATED)).toBe(2);
  });

  test('returns 0 rather than NaN or undefined for junk', () => {
    // Callers render this directly ("(2 reviews)"), so NaN would reach the screen.
    expect(getRatingCount(null)).toBe(0);
    expect(getRatingCount({})).toBe(0);
    expect(getRatingCount({ rating_count: 'x' })).toBe(0);
  });
});
