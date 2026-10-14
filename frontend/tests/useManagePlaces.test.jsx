import { renderHook, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import { useManagePlaces } from '../src/hooks/useManagePlaces';
import { fetchPlaces } from '../src/services/placesApi';

/**
 * The admin list's page walk (`TD-018`, invariant 6 of 7 — `verify-5-13` / `IMP-038`).
 *
 * **Where the truncation actually happens.** The invariant was originally filed as "the 100-row
 * page walk", and I first scoped it as an end-to-end test needing 100+ seeded places. That was the
 * wrong layer. The server's half is already pinned by `backend/tests/places.test.js`: a limit above
 * 100 is *rejected*, 100 is accepted, and `hasMore` flips correctly across an offset boundary.
 * Nothing about the truncation risk lives there.
 *
 * The risk lives in this hook. `managePlaces` filters and searches in the browser, so it wants the
 * whole catalogue while the endpoint will only ever hand over 100 rows at a time — so the hook
 * loops. If that loop is ever "simplified" to a single request, the admin page shows the first 100
 * places and **says nothing at all**. No error, no empty state, no console warning. Places 101 and
 * beyond simply cease to exist as far as the only UI for editing and deleting them is concerned.
 * That is the regression, and it is invisible to every layer above and below this one.
 *
 * **Why a mocked API is the right instrument here, and not a shortcut.** The usual objection to
 * mocking an API is that the test then asserts against a contract the test itself invented. That
 * objection does not apply: the pagination contract this mock replays — `{ data, pagination }`,
 * `hasMore` true until the last page — is independently proven against a real Postgres in
 * `backend/tests/places.test.js`. The mock is a stand-in for a shape another suite pins, which
 * lets this suite drive catalogue sizes (250 rows, 5,000 rows) that would be absurd to seed and
 * impossible to seed safely into the E2E suite's shared database.
 */

jest.mock('../src/services/placesApi', () => ({ fetchPlaces: jest.fn() }));
jest.mock('../src/services/placeService', () => ({ deletePlace: jest.fn() }));
jest.mock('react-toastify', () => ({
  toast: { warn: jest.fn(), error: jest.fn(), success: jest.fn() }
}));

/** The hook only loads for a resolved, signed-in admin — anything else leaves the effect idle. */
const ADMIN = {
  currentUser: { uid: 'admin-1' },
  isAdmin: true,
  loading: false,
  getIdToken: async () => 'token'
};

const catalogue = (size) =>
  Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    name: `Place ${i + 1}`,
    location: `Location ${i % 4}`
  }));

/**
 * Serve `rows` the way the real endpoint does: honour `limit`/`offset`, and report `hasMore`
 * against the true total.
 */
const servePaginated = (rows) => {
  fetchPlaces.mockImplementation(async ({ limit, offset }) => {
    const slice = rows.slice(offset, offset + limit);
    return { data: slice, pagination: { hasMore: offset + slice.length < rows.length } };
  });
};

const loadAsAdmin = async () => {
  const view = renderHook(() => useManagePlaces(ADMIN));
  await waitFor(() => expect(view.result.current.loadingPlaces).toBe(false));
  return view.result;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('walking past the first page', () => {
  test('a 250-place catalogue arrives complete, not truncated at 100', async () => {
    servePaginated(catalogue(250));

    const result = await loadAsAdmin();

    // The assertion that matters: 250, not 100. A single-request implementation passes every
    // other test in this file's neighbourhood and fails this one.
    expect(result.current.places).toHaveLength(250);
    expect(result.current.places[0].id).toBe(1);
    expect(result.current.places[249].id).toBe(250);
  });

  test('requests full pages and advances the offset by what it actually received', async () => {
    servePaginated(catalogue(250));

    await loadAsAdmin();

    expect(fetchPlaces).toHaveBeenCalledTimes(3);
    expect(fetchPlaces).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(fetchPlaces).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
    expect(fetchPlaces).toHaveBeenNthCalledWith(3, { limit: 100, offset: 200 });
  });

  test('a short page advances the offset by what arrived, not by the page size', async () => {
    // Defensive, and deliberately so: today's endpoint always fills a page when `hasMore` is true,
    // so this describes a contract change rather than current behaviour. It is cheap to hold, and
    // the failure it prevents is the worst kind — `offset += PAGE_SIZE` after a 60-row page skips
    // rows 60–99 permanently, producing a list that is wrong in the middle rather than short at
    // the end, which no amount of scrolling reveals.
    fetchPlaces
      .mockResolvedValueOnce({ data: catalogue(60), pagination: { hasMore: true } })
      .mockResolvedValueOnce({ data: catalogue(20), pagination: { hasMore: false } });

    await loadAsAdmin();

    expect(fetchPlaces).toHaveBeenNthCalledWith(2, { limit: 100, offset: 60 });
  });

  test('the location filter is built from the whole catalogue, not the first page', async () => {
    servePaginated(catalogue(250));

    const result = await loadAsAdmin();

    // A quieter face of the same bug. Even if someone noticed the missing rows in the table, a
    // truncated walk also silently removes options from the filter dropdown — so an admin
    // searching for a place by its location is told it does not exist.
    expect(result.current.locations).toEqual([
      'Location 0',
      'Location 1',
      'Location 2',
      'Location 3'
    ]);
  });
});

describe('knowing when to stop', () => {
  test('a catalogue smaller than one page costs exactly one request', async () => {
    servePaginated(catalogue(40));

    const result = await loadAsAdmin();

    expect(result.current.places).toHaveLength(40);
    expect(fetchPlaces).toHaveBeenCalledTimes(1);
  });

  test('exactly one full page does not provoke a second request', async () => {
    servePaginated(catalogue(100));

    const result = await loadAsAdmin();

    // The boundary a `while (rows.length === PAGE_SIZE)` loop gets wrong: it would ask again,
    // receive nothing, and depend on the empty-page guard below to terminate. Reading `hasMore`
    // means the server decides, and it already knows the answer.
    expect(result.current.places).toHaveLength(100);
    expect(fetchPlaces).toHaveBeenCalledTimes(1);
  });

  test('an empty page ends the walk even if the server still claims there is more', async () => {
    fetchPlaces
      .mockResolvedValueOnce({ data: catalogue(100), pagination: { hasMore: true } })
      .mockResolvedValue({ data: [], pagination: { hasMore: true } });

    const result = await loadAsAdmin();

    // Defence against the server, not against this hook: a `hasMore` that is wrong on the last
    // page would otherwise be an unbounded request loop against the API from an open admin tab.
    expect(result.current.places).toHaveLength(100);
    expect(fetchPlaces).toHaveBeenCalledTimes(2);
  });
});

describe('the runaway guard reports itself', () => {
  test('a server that never terminates stops at the cap AND says so', async () => {
    // 5,000 rows is past `PAGE_CAP * PAGE_SIZE`, so the walk is cut short with rows still unread.
    servePaginated(catalogue(6000));

    const result = await loadAsAdmin();

    expect(fetchPlaces).toHaveBeenCalledTimes(50);
    expect(result.current.places).toHaveLength(5000);
    // The whole point of the guard. Stopping early is acceptable — stopping early *quietly* is the
    // thing this invariant exists to prevent, because the admin's only signal would be a list that
    // looks complete.
    expect(toast.warn).toHaveBeenCalledWith('Showing the first 5000 places.');
  });

  test('a normal load says nothing', async () => {
    servePaginated(catalogue(250));

    await loadAsAdmin();

    // Guard on the guard: without this, an implementation that warned unconditionally would pass
    // the test above while crying wolf on every page load.
    expect(toast.warn).not.toHaveBeenCalled();
  });
});

describe('failure', () => {
  test('a failed load surfaces an error instead of a permanent spinner', async () => {
    fetchPlaces.mockRejectedValue(
      Object.assign(new Error('Could not reach the server.'), {
        status: 503
      })
    );

    const result = await loadAsAdmin();

    expect(result.current.loadingPlaces).toBe(false);
    expect(result.current.loadError).toBe('Could not reach the server.');
    expect(toast.error).toHaveBeenCalled();
  });

  test('a failure partway through the walk does not present a partial list as complete', async () => {
    fetchPlaces
      .mockResolvedValueOnce({ data: catalogue(100), pagination: { hasMore: true } })
      .mockRejectedValue(Object.assign(new Error('Gateway timeout'), { status: 504 }));

    const result = await loadAsAdmin();

    // The failure arrives after 100 rows are already in hand. Showing them would be the most
    // dangerous outcome of all: a list that is both incomplete and unmarked. The error state wins.
    expect(result.current.places).toEqual([]);
    expect(result.current.loadError).toBe('Gateway timeout');
  });
});
