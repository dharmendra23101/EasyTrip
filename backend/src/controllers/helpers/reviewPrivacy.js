const crypto = require('crypto');

/**
 * Review author privacy (IMP-021).
 *
 * A review row carries the author's real uid. Sending that to the browser would let anyone
 * correlate a person's reviews across the whole site, so the public shape carries a **digest**
 * that is stable within one place and useless outside it.
 *
 * The display name is NOT anonymised — it is passed through as the author wrote it. The only
 * substitution is for a blank name or one that looks like an email address, both of which become
 * "Traveler"; an email in a public byline would leak a contact address, a real name is what the
 * author chose to sign with.
 *
 * `is_own` is computed server-side against the verified caller, because the digest is
 * deliberately not reversible — the client cannot work out which review is its own.
 */

const publicAuthorId = (placeId, userId) => {
  return crypto
    .createHash('sha256')
    .update(`${placeId}:${userId || ''}`)
    .digest('hex')
    .slice(0, 16);
};

// Legacy rows stored the account email in user_name; never render one publicly.
const publicAuthorName = (userName) => {
  const name = (userName || '').trim();
  return !name || name.includes('@') ? 'Traveler' : name;
};

// `viewerUid` is the uid of the caller, when there is one (soft auth on the public GET,
// the verified author on POST). Ownership has to be resolved here: the client cannot
// compare against `user_id` any more, because that field is now the opaque digest.

const toPublicReview = (row, viewerUid) => {
  const authorId = publicAuthorId(row.place_id, row.user_id);
  const authorName = publicAuthorName(row.user_name);

  return {
    id: row.id,
    place_id: row.place_id,
    author_id: authorId,
    author_name: authorName,
    rating: row.rating,
    comment: row.comment,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_own: Boolean(viewerUid) && row.user_id === viewerUid,
    // Aliases the current UI still reads; they carry the opaque values, never the raw uid.
    user_id: authorId,
    user_name: authorName
  };
};

// ---------------------------------------------------------------------------
// Place lists (IMP-038)
// ---------------------------------------------------------------------------
//
// `/api/places` and `/api/places/search` are the same read behind two names — the second one is
// the first one with filters bound. They share this handler so pagination, sorting, projection
// and the image fallback cannot behave differently depending on which URL the caller picked.
//
// Response contract, on both routes:
//
//   { data: [...], pagination: { total, limit, offset, hasMore, sort } }
//
// This replaced a bare array. Every consumer in this repo was migrated in the same change; the
// envelope is not optional and there is no legacy shape to fall back to, because a list endpoint
// that sometimes reports a total and sometimes does not is worse than either alternative.

// Query arrays arrive either repeated (`?tags=a&tags=b`) or JSON-encoded, depending on the caller.

module.exports = { publicAuthorId, publicAuthorName, toPublicReview };
