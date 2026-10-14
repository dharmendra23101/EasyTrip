/**
 * The ISR contracts of the two statically generated pages (`TD-018`, invariant 4 of 7 —
 * `verify-5-13` / `IMP-040`).
 *
 * **Why this is not a five-minute test.** The parked invariant reads "`index.jsx` keeps
 * `getStaticProps` with `revalidate: 300` and a 30s error retry", and the obvious way to prove a
 * revalidation interval is to wait for it. That is the wrong boundary. `revalidate` is not
 * behaviour this repository implements — it is a *value handed to Next.js*, and Next's own test
 * suite is what proves the framework honours it. What this repository owns, and what can therefore
 * regress here, is the returned object: whether the interval is declared at all, and what the
 * failure branch decides.
 *
 * So these tests call `getStaticProps` directly, as a function, with the data layer mocked. That
 * is fully deterministic, runs in milliseconds, and fails for every regression the invariant names
 * — because each of those regressions is a change to this return value.
 *
 * Waiting 300 seconds would additionally have proved nothing extra: a test that observes one
 * regeneration cannot distinguish `revalidate: 300` from `revalidate: 299`, and a test that never
 * observes one cannot tell "ISR removed" from "not due yet".
 */

// The data layer is the boundary. Every test drives it directly.
jest.mock('../src/services/placesApi', () => ({
  fetchPlaces: jest.fn(),
  fetchPlaceById: jest.fn(),
  fetchPlaceImages: jest.fn(),
  fetchPlaceReviews: jest.fn()
}));

// `places/[id].jsx` reaches `AuthContext` through its component tree, which initialises the
// Firebase *client* SDK at module scope. Mocked for the same reason `AuthContext.test.jsx` mocks
// it: it is a third-party boundary, and none of it participates in a static render.
jest.mock('../src/config/firebase', () => ({ auth: {}, default: {} }));
jest.mock('firebase/auth', () => ({
  onIdTokenChanged: jest.fn(() => () => {}),
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  updateProfile: jest.fn(),
  signInWithPopup: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  getRedirectResult: jest.fn(() => Promise.resolve(null))
}));
jest.mock('../src/services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ isAdmin: false })) }
}));

import { getStaticProps as homeStaticProps } from '../src/pages/index';
import {
  getStaticProps as placeStaticProps,
  getStaticPaths as placeStaticPaths
} from '../src/pages/places/[id]';
import {
  fetchPlaces,
  fetchPlaceById,
  fetchPlaceImages,
  fetchPlaceReviews
} from '../src/services/placesApi';

/** An API error as `placesApi` raises it — the `status` field is what the 404 branch reads. */
const apiError = (message, status) => Object.assign(new Error(message), { status });

const PLACE = {
  id: 7,
  name: 'Hampi',
  location: 'Ballari',
  image_url: 'https://res.cloudinary.com/demo/hampi.jpg',
  tags: ['Heritage'],
  best_time: 'October to February'
};

beforeEach(() => {
  jest.clearAllMocks();
  // Silence the deliberate `console.error` in the failure branches; a test asserting the fallback
  // should not print a stack trace that reads like a broken suite.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('landing page — getStaticProps (index.jsx)', () => {
  test('declares a revalidation interval, so the page is not frozen at build time', async () => {
    fetchPlaces.mockResolvedValue({ data: [PLACE], pagination: { hasMore: false } });

    const result = await homeStaticProps();

    // The regression: `revalidate` dropped, or the page converted to plain static generation. The
    // build still succeeds, the page still renders, and every place added or edited afterwards is
    // invisible on the landing page until someone happens to redeploy.
    expect(result.revalidate).toBe(300);
  });

  test('asks for four top-rated places, not the catalogue', async () => {
    fetchPlaces.mockResolvedValue({ data: [PLACE], pagination: { hasMore: false } });

    await homeStaticProps();

    // The regression this reverses is a real one from this project's history: the carousel used to
    // download every place and every column, sort in the browser, keep four and discard the rest
    // (`IMP-040`). Dropping either argument silently restores it — and because ISR means the cost
    // lands on the build rather than a visitor, nobody would notice from the page's own timings.
    expect(fetchPlaces).toHaveBeenCalledWith({ sort: 'rating', limit: 4 });
  });

  test('fills the display defaults the carousel renders unconditionally', async () => {
    fetchPlaces.mockResolvedValue({
      data: [{ id: 1, name: 'Unclassified', tags: null, best_time: null }],
      pagination: { hasMore: false }
    });

    const { props } = await homeStaticProps();

    // The hero renders tag chips and a "best time" line with no empty-state of their own, so a
    // place stored without either would render a bare label and an empty chip row.
    expect(props.places[0].tags).toEqual(['Destination']);
    expect(props.places[0].best_time).toBe('Year round');
  });

  test('a failing API yields a renderable page instead of failing the build', async () => {
    fetchPlaces.mockRejectedValue(apiError('socket hang up', 502));

    const { props } = await homeStaticProps();

    // The regression: the try/catch removed during a refactor. `getStaticProps` throwing fails the
    // production build outright — so a thirty-second API blip during a deploy takes the deploy
    // down, and during revalidation it leaves the last good copy in place with no visible signal.
    expect(props.places).toEqual([]);
    expect(props.loadError).toMatch(/failed to load/i);
  });

  test('retries sooner after a failure than it does after a success', async () => {
    fetchPlaces.mockRejectedValue(apiError('socket hang up', 502));

    const failed = await homeStaticProps();
    fetchPlaces.mockResolvedValue({ data: [PLACE], pagination: { hasMore: false } });
    const succeeded = await homeStaticProps();

    expect(failed.revalidate).toBe(30);
    // The relationship is the point, not the two numbers. A page that fell into its error state
    // must climb out faster than the normal freshness interval; making the error retry equal to
    // (or longer than) the success interval means a momentary outage pins "Failed to load
    // destinations" onto the landing page for the full period.
    expect(failed.revalidate).toBeLessThan(succeeded.revalidate);
  });
});

describe('place detail — getStaticProps (places/[id].jsx)', () => {
  beforeEach(() => {
    fetchPlaceById.mockResolvedValue(PLACE);
    fetchPlaceImages.mockResolvedValue([]);
    fetchPlaceReviews.mockResolvedValue([]);
  });

  test('declares a revalidation interval', async () => {
    const result = await placeStaticProps({ params: { id: '7' } });

    expect(result.revalidate).toBe(300);
    expect(result.props.initialPlace).toEqual(PLACE);
  });

  test('an unreachable gallery or review list does not sink the page', async () => {
    fetchPlaceImages.mockRejectedValue(apiError('timeout', 504));
    fetchPlaceReviews.mockRejectedValue(apiError('timeout', 504));

    const { props } = await placeStaticProps({ params: { id: '7' } });

    // `Promise.allSettled`, not `Promise.all`. Swapping them is a one-word change that looks
    // tidier and turns a degraded gallery into a page that cannot be generated at all.
    expect(props.initialPlace).toEqual(PLACE);
    expect(props.initialReviews).toEqual([]);
  });

  test('a missing place returns notFound WITH a revalidation interval', async () => {
    fetchPlaceById.mockRejectedValue(apiError('Place not found', 404));

    const result = await placeStaticProps({ params: { id: '9999' } });

    expect(result.notFound).toBe(true);
    // This is the subtle one. `getStaticPaths` uses `fallback: 'blocking'`, so any id not present
    // at build time reaches this branch — including a place created five minutes ago. A bare
    // `{ notFound: true }` is cached permanently, so that place would 404 forever, for everyone,
    // until a redeploy. The interval is what makes the 404 provisional.
    expect(result.revalidate).toBe(300);
  });

  test('an outage is rethrown rather than cached as a 404', async () => {
    fetchPlaceById.mockRejectedValue(apiError('Internal Server Error', 500));

    await expect(placeStaticProps({ params: { id: '7' } })).rejects.toThrow(
      'Internal Server Error'
    );

    // Broadening the 404 check to `catch (any) → notFound` is the tempting simplification, and it
    // is how an API outage becomes a permanent, indexed 404 on every place in the catalogue.
    // Throwing keeps the last good copy being served.
  });
});

describe('place detail — getStaticPaths', () => {
  test('unknown ids are generated on demand, not rejected', async () => {
    fetchPlaces.mockResolvedValue({ data: [{ id: 7 }], pagination: { hasMore: false } });

    const result = await placeStaticPaths();

    expect(result.paths).toEqual([{ params: { id: '7' } }]);
    // `fallback: false` would 404 every place that did not exist at build time — which, on a site
    // whose whole purpose is admins adding places, means every new place is invisible until the
    // next deploy.
    expect(result.fallback).toBe('blocking');
  });

  test('a failing API yields an empty path list rather than failing the build', async () => {
    fetchPlaces.mockRejectedValue(apiError('socket hang up', 502));

    const result = await placeStaticPaths();

    // Nothing is pre-rendered, but `fallback: 'blocking'` means every place still resolves on
    // first request. The build survives; the site is merely cold.
    expect(result.paths).toEqual([]);
    expect(result.fallback).toBe('blocking');
  });
});
