/**
 * `destroyImage` and `destroyPlaceAssets` — the cleanup calls that must never fail a request.
 *
 * **The contract is unusual and it is deliberate.** Both functions swallow every error and return
 * a value instead. `cloudinary.js` states why: *"the database row is the source of truth, and an
 * orphaned remote asset is a storage cost, not a correctness problem. Failing a user's delete
 * because a third-party cleanup call failed would trade a cheap problem for an expensive one."*
 *
 * That makes "never throws" a **load-bearing property**, not an implementation detail — and one
 * that is invisible in normal operation, because Cloudinary is usually up. Remove a `try/catch` and
 * nothing changes until the day the third party has an outage, at which point deleting a place
 * starts returning 500 and the row survives. The failure arrives late, during someone else's
 * incident, on a path nobody was watching.
 *
 * **Why the SDK is stubbed here rather than the module.** Every other suite mocks
 * `../src/config/cloudinary` wholesale, which is correct for testing *callers* — and is exactly why
 * these two functions sat at 0%. To test them, the mock has to move one layer down, to the
 * `cloudinary` package itself, so the module's own logic runs for real: the `'not found'` mapping,
 * the 404 tolerance on folder deletion, the prefix construction.
 */

const mockDestroy = jest.fn();
const mockDeleteResourcesByPrefix = jest.fn();
const mockDeleteFolder = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      destroy: (...args) => mockDestroy(...args),
      upload: jest.fn()
    },
    api: {
      delete_resources_by_prefix: (...args) => mockDeleteResourcesByPrefix(...args),
      delete_folder: (...args) => mockDeleteFolder(...args)
    }
  }
}));

const { destroyImage, destroyPlaceAssets } = require('../src/config/cloudinary');

beforeEach(() => {
  mockDestroy.mockReset();
  mockDeleteResourcesByPrefix.mockReset();
  mockDeleteFolder.mockReset();
});

describe('destroyImage', () => {
  test("Cloudinary's 'ok' means the asset is gone", async () => {
    mockDestroy.mockResolvedValue({ result: 'ok' });
    await expect(destroyImage('easytrip/places/1/a')).resolves.toBe(true);
    expect(mockDestroy).toHaveBeenCalledWith('easytrip/places/1/a', { invalidate: true });
  });

  test("'not found' also means the asset is gone", async () => {
    // The goal is the *state* "this asset does not exist", not the event "I deleted something".
    // Treating an already-absent asset as a failure would make retries permanently red.
    mockDestroy.mockResolvedValue({ result: 'not found' });
    await expect(destroyImage('easytrip/places/1/a')).resolves.toBe(true);
  });

  test('any other result is reported as not-removed rather than assumed fine', async () => {
    mockDestroy.mockResolvedValue({ result: 'rate limited' });
    await expect(destroyImage('easytrip/places/1/a')).resolves.toBe(false);
  });

  test('a falsy public_id short-circuits without calling Cloudinary', async () => {
    // `publicIdFromUrl` returns null for an unrecognisable URL, and that null lands here. Calling
    // destroy with it would ask Cloudinary to delete something unspecified.
    for (const id of [null, undefined, '']) {
      await expect(destroyImage(id)).resolves.toBe(false);
    }
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  test('a thrown SDK error becomes false, never a rejection', async () => {
    // The load-bearing property. The caller has already deleted the database row.
    mockDestroy.mockRejectedValue(new Error('cloudinary is down'));
    await expect(destroyImage('easytrip/places/1/a')).resolves.toBe(false);
  });

  test('a malformed response does not throw on property access', async () => {
    mockDestroy.mockResolvedValue(undefined);
    await expect(destroyImage('easytrip/places/1/a')).resolves.toBe(false);
  });
});

describe('destroyPlaceAssets', () => {
  test('deletes by the place folder prefix and reports how many went', async () => {
    mockDeleteResourcesByPrefix.mockResolvedValue({
      deleted: { 'a/b': 'deleted', 'a/c': 'deleted' }
    });
    mockDeleteFolder.mockResolvedValue({});

    await expect(destroyPlaceAssets(9)).resolves.toBe(2);
    expect(mockDeleteResourcesByPrefix).toHaveBeenCalledWith('easytrip/places/9/');
  });

  test('the prefix carries a trailing slash, so place 1 does not match place 10', async () => {
    // Called out in the function's own comment, and the kind of thing that deletes a different
    // place's gallery exactly once and is then very hard to explain.
    mockDeleteResourcesByPrefix.mockResolvedValue({ deleted: {} });
    mockDeleteFolder.mockResolvedValue({});

    await destroyPlaceAssets(1);
    const prefix = mockDeleteResourcesByPrefix.mock.calls[0][0];
    expect(prefix).toBe('easytrip/places/1/');
    expect(prefix.endsWith('/')).toBe(true);
  });

  test('a 404 from folder deletion is not an error — the place may have had no uploads', async () => {
    mockDeleteResourcesByPrefix.mockResolvedValue({ deleted: { 'a/b': 'deleted' } });
    mockDeleteFolder.mockRejectedValue({ http_code: 404 });

    await expect(destroyPlaceAssets(9)).resolves.toBe(1);
  });

  test('a non-404 folder failure still leaves the asset deletion counted', async () => {
    // The assets are already gone; an untidy leftover folder must not turn that into a failure.
    mockDeleteResourcesByPrefix.mockResolvedValue({ deleted: { 'a/b': 'deleted' } });
    mockDeleteFolder.mockRejectedValue({ http_code: 500 });

    await expect(destroyPlaceAssets(9)).resolves.toBe(1);
  });

  test('a failed prefix delete returns 0 rather than throwing', async () => {
    mockDeleteResourcesByPrefix.mockRejectedValue(new Error('cloudinary is down'));
    await expect(destroyPlaceAssets(9)).resolves.toBe(0);
    // And it must not have gone on to try the folder after the assets failed.
    expect(mockDeleteFolder).not.toHaveBeenCalled();
  });

  test('a response with no deleted map counts zero instead of throwing', async () => {
    mockDeleteResourcesByPrefix.mockResolvedValue({});
    mockDeleteFolder.mockResolvedValue({});
    await expect(destroyPlaceAssets(9)).resolves.toBe(0);
  });
});
