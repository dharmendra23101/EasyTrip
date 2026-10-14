import { renderHook, act, waitFor } from '@testing-library/react';
import { useWishlist, LIKES_STORAGE_KEY } from '../src/hooks/useWishlist';
import wishlistService from '../src/services/wishlistService';

/**
 * The unified wishlist hook (`IMP-108`, `ADR-030`).
 *
 * **What this suite is really guarding.** `useWishlist` has two storage backends behind one
 * interface, and the interesting failures are all at the seam between them:
 *
 * 1. **The signed-out contract must not drift.** `TD-018`'s browser tests assert on the literal key
 *    `easytrip_liked_places` and on an array of numbers. That contract used to live inside
 *    `useHomeCarousel`; moving it is exactly the kind of change that renames a key by accident, and
 *    the failure mode is silent — new likes save, nothing reads them back.
 * 2. **The restore-before-write ordering.** The bug this hook inherited destroyed every liked place
 *    on every page load, because the write effect closed over the initial `[]` and ran before the
 *    read effect had applied anything. It is a *four-line* regression to reintroduce.
 * 3. **The one-shot import.** Signing in must not silently empty a visitor's hearts.
 *
 * The service is mocked, not the HTTP layer: its contract — what the endpoints accept and return —
 * is proven against a real Postgres in `backend/tests/savedPlaces.test.js`, and re-asserting it
 * here would be this suite inventing the shape it then checks.
 */

jest.mock('../src/services/wishlistService', () => ({
  __esModule: true,
  default: {
    getWishlist: jest.fn(),
    addToWishlist: jest.fn(),
    removeFromWishlist: jest.fn()
  }
}));

const mockAuth = { currentUser: null, loading: false, getIdToken: jest.fn(async () => 'token') };
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockAuth
}));

const signedOut = () => {
  mockAuth.currentUser = null;
};
const signedIn = (uid = 'user-1') => {
  mockAuth.currentUser = { uid };
};

const stored = () => JSON.parse(window.localStorage.getItem(LIKES_STORAGE_KEY) ?? 'null');

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  signedOut();
  wishlistService.getWishlist.mockResolvedValue({ places: [], placeIds: [] });
  wishlistService.addToWishlist.mockResolvedValue({ saved: true, created: true });
  wishlistService.removeFromWishlist.mockResolvedValue({ saved: false, removed: true });
});

describe('signed out — localStorage, under the key TD-018 asserts on', () => {
  test('a toggle writes an array of numbers under the expected key', async () => {
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.toggle(7);
    });

    expect(stored()).toEqual([7]);
    expect(typeof stored()[0]).toBe('number');
    expect(result.current.isSaved(7)).toBe(true);
  });

  test('a stored list is restored on mount', async () => {
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([1, 2, 3, 4]));

    const { result } = renderHook(() => useWishlist());

    await waitFor(() => expect(result.current.savedIds).toEqual([1, 2, 3, 4]));
    expect(result.current.isSaved(3)).toBe(true);
  });

  test('the stored value is NOT clobbered by the write effect firing first', async () => {
    // The regression: the write effect closes over the initial `[]` and runs before the restore
    // has been applied, so mounting destroys the data. This is the assertion that would have
    // caught it, at the layer where the bug lives.
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([1, 2, 3, 4]));

    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(stored()).toEqual([1, 2, 3, 4]);
  });

  test('unliking writes the empty list rather than leaving the key stale', async () => {
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([5]));
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.savedIds).toEqual([5]));

    await act(async () => {
      await result.current.toggle(5);
    });

    expect(stored()).toEqual([]);
  });

  test('a corrupted stored value is ignored rather than thrown on', async () => {
    // `savedIds.includes(id)` misbehaves silently on an object, so the shape guard matters as much
    // as the try/catch around the parse.
    window.localStorage.setItem(LIKES_STORAGE_KEY, '{"not":"an array"}');

    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.savedIds).toEqual([]);
  });

  test('the server is never called for a signed-out visitor', async () => {
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.toggle(9);
    });

    expect(wishlistService.getWishlist).not.toHaveBeenCalled();
    expect(wishlistService.addToWishlist).not.toHaveBeenCalled();
  });
});

describe('signed in — the server is the source of truth', () => {
  test('the wishlist is loaded from the server, not from localStorage', async () => {
    signedIn();
    wishlistService.getWishlist.mockResolvedValue({
      places: [{ id: 11, name: 'Hampi' }],
      placeIds: [11]
    });

    const { result } = renderHook(() => useWishlist());

    await waitFor(() => expect(result.current.savedIds).toEqual([11]));
    expect(result.current.places).toEqual([{ id: 11, name: 'Hampi' }]);
  });

  test('saving calls the server and never passes a user id', async () => {
    // The client cannot name an owner. This asserts the shape of the call, so a future refactor
    // that "helpfully" threads a uid through has to break a test to do it.
    signedIn();
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.toggle(4);
    });

    expect(wishlistService.addToWishlist).toHaveBeenCalledWith(4, 'token');
    expect(wishlistService.addToWishlist).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  test('removing calls the server', async () => {
    signedIn();
    wishlistService.getWishlist.mockResolvedValue({ places: [{ id: 4 }], placeIds: [4] });
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.savedIds).toEqual([4]));

    await act(async () => {
      await result.current.toggle(4);
    });

    expect(wishlistService.removeFromWishlist).toHaveBeenCalledWith(4, 'token');
    expect(result.current.isSaved(4)).toBe(false);
  });

  test('a failed save rolls back rather than lying about the state', async () => {
    signedIn();
    wishlistService.addToWishlist.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.toggle(6);
    });

    // Optimism is only safe if it reverses. A heart left filled after a failed write is a promise
    // the server did not make.
    expect(result.current.isSaved(6)).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  test('a failed load surfaces an error instead of an empty wishlist', async () => {
    signedIn();
    wishlistService.getWishlist.mockRejectedValue(new Error('down'));

    const { result } = renderHook(() => useWishlist());

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // Empty-because-it-failed must not be indistinguishable from empty-because-there-is-nothing;
    // that conflation is what `IMP-031` (truthful error states) exists to prevent.
    expect(result.current.savedIds).toEqual([]);
    expect(result.current.ready).toBe(true);
  });
});

describe('signing in imports what was saved before', () => {
  test('pending local likes are posted once and the key is cleared', async () => {
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([2, 3]));
    signedIn();
    wishlistService.getWishlist.mockResolvedValue({ places: [], placeIds: [2, 3] });

    const { result } = renderHook(() => useWishlist());

    await waitFor(() => expect(result.current.savedIds).toEqual([2, 3]));
    expect(wishlistService.addToWishlist).toHaveBeenCalledWith(2, 'token');
    expect(wishlistService.addToWishlist).toHaveBeenCalledWith(3, 'token');
    // Cleared, or the next load imports them again — harmless because saving is idempotent, but it
    // would mean re-uploading the same list on every page view forever.
    expect(window.localStorage.getItem(LIKES_STORAGE_KEY)).toBeNull();
  });

  test('a failed import keeps the key so the next load retries', async () => {
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([2]));
    signedIn();
    wishlistService.addToWishlist.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    // Clearing before the write lands is how the data disappears with nothing to report it.
    expect(stored()).toEqual([2]);
  });

  test('nothing is imported when there is nothing stored', async () => {
    signedIn();

    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(wishlistService.addToWishlist).not.toHaveBeenCalled();
  });

  test('a signed-in user does not write their wishlist back to localStorage', async () => {
    // The server is the truth once signed in. Mirroring it locally would resurrect the divergence
    // this hook exists to remove, and would leave one user's list on a shared device.
    signedIn();
    wishlistService.getWishlist.mockResolvedValue({ places: [], placeIds: [8] });

    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.savedIds).toEqual([8]));

    await act(async () => {
      await result.current.toggle(9);
    });

    expect(window.localStorage.getItem(LIKES_STORAGE_KEY)).toBeNull();
  });
});

/**
 * The hook must never write back a value it only read (`BUG-054`, Sprint 8.32).
 *
 * Found in the E2E suite rather than here: the persistence journey seeded four likes on a page that
 * had already loaded, reloaded it, and got `[]` back. The seed was not lost by the read — it was
 * overwritten by the **first page's own write**, which fires after the load that triggered it and
 * carries the empty state the restore had just found.
 *
 * That echo is invisible in every single-actor test, because writing back what you read changes
 * nothing you can observe. It is only a defect when somebody else touches the key in the window
 * between the restore and the echo — another tab, or a fixture — and then it silently wins.
 */
describe('a page load does not write over what it did not change', () => {
  test('restoring stored likes writes nothing back', async () => {
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    const write = jest.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.savedIds).toEqual([1, 2, 3]);
    // The restore reads the key and leaves it alone. Counting `setItem` calls rather than checking
    // the value is the point: the echo wrote the *correct* value, so only the call is observable.
    expect(write.mock.calls.filter(([key]) => key === LIKES_STORAGE_KEY)).toHaveLength(0);

    write.mockRestore();
  });

  test('a first visit does not create the key just to say it is empty', async () => {
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    // Absent, not `"[]"`. A key that exists is a claim that something was stored.
    expect(window.localStorage.getItem(LIKES_STORAGE_KEY)).toBeNull();
    expect(result.current.savedIds).toEqual([]);
  });

  test('a value written by somebody else after the restore survives', async () => {
    // The E2E failure, reproduced at this tier: the hook mounts on an empty key, and the fixture
    // lands while the write effect is still pending. Before the fix, `[]` arrived afterwards.
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([7, 8]));
    await act(async () => {
      await Promise.resolve();
    });

    expect(stored()).toEqual([7, 8]);
  });

  test('the guard consults what the restore found, not the key as it stands now', async () => {
    // **This is the assertion that distinguishes the fix from the near-miss.** The first attempt at
    // it read the key again inside the write effect — `skip when the key is absent` — which looks
    // equivalent and is not: by then something else has created the key, the guard sees it present,
    // and `[]` goes straight over the top. A mutation reintroducing that phrasing survived every
    // other test in this file, because none of them let the two values disagree.
    //
    // Here they disagree by construction: the key reports itself absent to the restore and present
    // to anything that looks afterwards. That is the browser race with the timing removed.
    const realGetItem = Storage.prototype.getItem;
    let reads = 0;
    const read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key !== LIKES_STORAGE_KEY) return realGetItem.call(this, key);
      reads += 1;
      return reads === 1 ? null : JSON.stringify([7, 8]);
    });
    const write = jest.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.savedIds).toEqual([]);
    expect(write.mock.calls.filter(([key]) => key === LIKES_STORAGE_KEY)).toHaveLength(0);

    read.mockRestore();
    write.mockRestore();
  });

  test('liking, unliking and liking again all persist', async () => {
    // The round trip, because "write only what changed" needs the hook to keep track of what it
    // last wrote — not just of what it first read. If it only remembers the restore, coming back to
    // a value it restored looks like "nothing changed" and the write is skipped, so the third state
    // here would silently keep the second one's storage.
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([1]));
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.toggle(1);
    });
    expect(stored()).toEqual([]);

    await act(async () => {
      await result.current.toggle(1);
    });
    expect(stored()).toEqual([1]);
  });

  test('but unliking the last place still persists the empty list', async () => {
    // The guard is "nothing to save and nowhere it was saved", not "nothing to save" — otherwise
    // removing your only like would look saved and come back on the next load.
    window.localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([4]));
    const { result } = renderHook(() => useWishlist());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.toggle(4);
    });

    expect(result.current.savedIds).toEqual([]);
    expect(stored()).toEqual([]);
  });
});
