import { useState, useEffect, useCallback, useRef } from 'react';

import { useAuth } from '../context/AuthContext';
import wishlistService from '../services/wishlistService';

/**
 * The one wishlist (`IMP-108`, `ADR-030`).
 *
 * **What this replaces.** A heart meant two different things on two pages. `useHomeCarousel` kept
 * `likedPlaces` in `localStorage`, so a like survived a reload and nothing else; `places/[id].jsx`
 * kept `isFavorite` in `useState(false)`, so a like survived until the next render and the icon
 * reset to empty on every visit. Neither reached a server, so neither followed the user to another
 * device, and the two never agreed with each other: liking a place on the home carousel left its
 * own detail page showing an empty heart.
 *
 * ---------------------------------------------------------------------------
 * Two backends, one interface
 * ---------------------------------------------------------------------------
 * **Signed in** → the server, which is the only durable answer.
 * **Signed out** → `localStorage`, exactly as before, under exactly the same key and shape.
 *
 * The signed-out path is kept rather than replaced with a sign-in prompt for two reasons. It is
 * better product behaviour — a visitor can mark things before deciding to register, which is the
 * point at which registering becomes worth it — and `TD-018`'s browser tests guard that storage
 * contract precisely because renaming the key would silently destroy every visitor's likes. A
 * prompt would delete a real feature to simplify a hook.
 *
 * ---------------------------------------------------------------------------
 * The one-shot import
 * ---------------------------------------------------------------------------
 * When a visitor with local likes signs in, those likes are posted to the server once and the key
 * is cleared. Without it, signing in silently empties the heart on every place they marked while
 * signed out — the data is still in `localStorage`, but nothing reads it any more, which is the
 * worst kind of loss because nothing anywhere reports it.
 *
 * It is safe to retry: saving is idempotent server-side, so an import interrupted halfway leaves
 * the key in place and the next load finishes it.
 */

/**
 * Where signed-out likes live. **Unchanged from `useHomeCarousel`** — this is the key `TD-018`'s
 * browser tests assert on, and renaming it is the regression they exist to catch.
 */
export const LIKES_STORAGE_KEY = 'easytrip_liked_places';

/** Parse a stored value, tolerating anything that is not the shape we wrote. */
const parseStoredIds = (raw) => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    // The UI does `savedIds.includes(id)`, which misbehaves silently rather than throwing if a
    // corrupted value is an object. Guard the shape, not just the parse.
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'number') : [];
  } catch {
    return [];
  }
};

/**
 * Read and parse in one go.
 *
 * Split from the parse so the restore can do **one** read: it needs both the raw string, to record
 * what it started from, and the ids. Reading twice for one restore is two chances to see different
 * values, which is the class of bug this whole area of the hook is about.
 */
const readStoredIds = () =>
  typeof window === 'undefined'
    ? []
    : parseStoredIds(window.localStorage.getItem(LIKES_STORAGE_KEY));

export function useWishlist() {
  const { currentUser, loading: authLoading, getIdToken } = useAuth();

  const [savedIds, setSavedIds] = useState([]);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Restore before persisting, enforced — and this flag is not bookkeeping.
   *
   * Both effects run on mount, and the write effect closes over the *initial* `[]`, so without the
   * gate it overwrites the stored value before the restore has been applied. Under
   * `reactStrictMode` React then re-invokes both, the second read sees the `[]` it just wrote, and
   * **every liked place is destroyed on every page load.** That is not hypothetical: it is the bug
   * `useHomeCarousel` carried until the `TD-018` persistence test seeded four likes, reloaded, and
   * got back an empty array.
   */
  const [restored, setRestored] = useState(false);

  // Guards the import against running twice for one sign-in. A ref rather than state because it
  // must not schedule a render, and because the effect that reads it also sets it.
  const importedFor = useRef(null);

  /**
   * The raw string this hook last **read from** or **wrote to** the key — `null` when the restore
   * found no key at all.
   *
   * It exists so the write effect can answer one question the state alone cannot: *did this hook
   * change anything, or is it about to echo back a value it merely read?* Echoing is not harmless.
   * The write lands after the load that triggered it, on a schedule nothing else can observe, so it
   * silently overwrites whatever else touched the key in between — another tab, or a test seeding a
   * fixture. `NOTES` §87 has the trace: a journey seeded four likes on a loaded page and the page's
   * own echo of `[]` arrived afterwards and won.
   *
   * A ref, not state: it must not schedule a render, and the effect that reads it also sets it.
   */
  const persisted = useRef(null);

  const isSignedIn = Boolean(currentUser);

  // ---------------------------------------------------------------------------
  // Signed out: localStorage, read once then written on every change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (authLoading || isSignedIn) return;

    // One read, used twice: the raw string is what the write effect compares against, and the ids
    // are the state. Reading the key a second time here would let the two disagree.
    const raw =
      typeof window === 'undefined' ? null : window.localStorage.getItem(LIKES_STORAGE_KEY);
    persisted.current = raw;
    setSavedIds(parseStoredIds(raw));
    setPlaces([]);
    setRestored(true);
  }, [authLoading, isSignedIn]);

  useEffect(() => {
    if (authLoading || isSignedIn || !restored) return;

    // Never write before the restore has run, or the write races it and wins.
    //
    // **And never write a value this hook did not change.** Every previous version persisted on
    // each render that reached here, including the first one after the restore — where `savedIds`
    // is, by construction, exactly what was just read. That write cannot change what a later read
    // returns, so its only possible effect is to overwrite something else's.
    //
    // Compared against `persisted`, not against the key's current contents. Those are different
    // questions, and the difference is the whole defect: on a first visit the restore finds no key,
    // and a guard phrased as *"skip when the key is absent"* re-reads a key that something else has
    // created in the meantime, finds it present, and writes `[]` straight over it.
    //
    // An empty list is still written whenever the hook is what emptied it — unliking your last
    // place has to persist, and `persisted` is `"[1]"` at that point rather than `null`.
    const next = JSON.stringify(savedIds);
    if (next === persisted.current) return;
    if (savedIds.length === 0 && persisted.current === null) return;

    persisted.current = next;
    window.localStorage.setItem(LIKES_STORAGE_KEY, next);
  }, [savedIds, restored, authLoading, isSignedIn]);

  // ---------------------------------------------------------------------------
  // Signed in: the server, plus a one-shot import of anything saved before sign-in
  // ---------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const result = await wishlistService.getWishlist(token);
      setSavedIds(result.placeIds);
      setPlaces(result.places);
      return result;
    } catch (loadError) {
      setError(loadError);
      return null;
    } finally {
      setLoading(false);
      setRestored(true);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (authLoading || !isSignedIn) return;

    let cancelled = false;

    const load = async () => {
      const pending = importedFor.current === currentUser.uid ? [] : readStoredIds();

      if (pending.length > 0) {
        try {
          const token = await getIdToken();
          // Sequential, not `Promise.all`: this is a rare one-off on a page the user is already
          // looking at, and a burst of parallel writes is what rate limits are for.
          for (const placeId of pending) {
            await wishlistService.addToWishlist(placeId, token);
          }
          // Only after every one landed. Clearing first would lose the remainder if the tab closed
          // mid-import, and the import is idempotent precisely so that retrying is free.
          window.localStorage.removeItem(LIKES_STORAGE_KEY);
        } catch {
          // A failed import is not a failed page. The key stays, so the next load retries; the
          // wishlist below still renders whatever the server already has.
        }
      }

      importedFor.current = currentUser.uid;
      if (!cancelled) await refresh();
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [authLoading, isSignedIn, currentUser?.uid, getIdToken, refresh]);

  // Signing out must not leave the previous user's saved places on screen.
  useEffect(() => {
    if (isSignedIn) return;
    importedFor.current = null;
  }, [isSignedIn]);

  const isSaved = useCallback((placeId) => savedIds.includes(Number(placeId)), [savedIds]);

  /**
   * Toggle, optimistically.
   *
   * Optimism is safe here in the specific sense that matters: both server operations are
   * idempotent, so a retry cannot compound, and a failure rolls back to the state the server still
   * holds rather than to a guess. The heart is also the one control where latency is most obviously
   * wrong — a like that takes 400ms to fill reads as a broken button.
   */
  const toggle = useCallback(
    async (placeId) => {
      const id = Number(placeId);
      if (!Number.isInteger(id) || id < 1) return;

      const wasSaved = savedIds.includes(id);
      const previous = savedIds;

      setSavedIds((current) =>
        wasSaved ? current.filter((saved) => saved !== id) : [id, ...current]
      );
      if (wasSaved) setPlaces((current) => current.filter((place) => place.id !== id));

      if (!isSignedIn) return; // the write effect above persists it

      try {
        setError(null);
        const token = await getIdToken();
        if (wasSaved) {
          await wishlistService.removeFromWishlist(id, token);
        } else {
          await wishlistService.addToWishlist(id, token);
          // Re-read rather than synthesising a card from an id we do not have the place for. The
          // ids are already correct optimistically, so this only fills in the card list.
          await refresh();
        }
      } catch (toggleError) {
        setSavedIds(previous);
        setError(toggleError);
      }
    },
    [savedIds, isSignedIn, getIdToken, refresh]
  );

  return {
    savedIds,
    places,
    isSaved,
    toggle,
    refresh,
    loading,
    error,
    /** True once a real answer has arrived, so a heart never renders "not saved" before it knows. */
    ready: restored && !authLoading,
    isSignedIn
  };
}
