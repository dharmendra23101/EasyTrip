const request = require('supertest');

// `mock`-prefixed so Jest's hoisted factory may close over them (see imageUpload.test.js).
const mockUploadImage = jest.fn();
const mockDestroyImage = jest.fn(async () => true);
jest.mock('../src/config/cloudinary', () => {
  const actual = jest.requireActual('../src/config/cloudinary');
  return {
    ...actual,
    uploadImage: (...args) => mockUploadImage(...args),
    destroyImage: (...args) => mockDestroyImage(...args),
    destroyPlaceAssets: jest.fn(async () => 0)
  };
});

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * `PUT /api/admin/places/:id` — the admin edit path.
 *
 * **Why this needed a file of its own.** `placeController.js` sat at 58.11% lines, and lines
 * 231–329 — essentially the whole of `updatePlace` — were the single largest uncovered block in the
 * backend. `places.test.js` touches this route once, to assert an anonymous request gets 401; the
 * handler itself had never run to completion.
 *
 * Three properties here are easy to break and expensive when broken:
 *
 * 1. **Partial update.** Every field falls back to the stored value, but *not uniformly*: `name` and
 *    `location` use `||` while `description`, `district`, `state`, `locality` and `pin_code` use
 *    `!== undefined`. So an empty description **clears** the field and an empty name **does not**.
 *    That asymmetry is deliberate — a place must always have a name — and it is invisible unless
 *    stated.
 * 2. **Orphan cleanup.** Replacing the primary image destroys the previous asset, but only *after*
 *    the new upload succeeds and only when the public_id differs. The comment records what it fixed:
 *    "editing a place's photo N times left N-1 assets paid for and unreachable."
 * 3. **A failed upload must not fail the update.** The catch keeps the existing image and lets the
 *    rest of the edit through, so a Cloudinary outage degrades to "photo unchanged" rather than
 *    "cannot edit places".
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

const PLACE = 2;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1)
]);

const OLD_IMAGE = 'https://res.cloudinary.com/demo/image/upload/v1/easytrip/places/2/old.jpg';
const NEW_IMAGE = 'https://res.cloudinary.com/demo/image/upload/v1/easytrip/places/2/new.jpg';

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockUploadImage.mockReset();
  mockUploadImage.mockResolvedValue({ url: NEW_IMAGE, public_id: 'easytrip/places/2/new' });
  mockDestroyImage.mockReset();
  mockDestroyImage.mockResolvedValue(true);
  await pool.query('UPDATE places SET primary_image_url = $1 WHERE id = $2', [OLD_IMAGE, PLACE]);
});
afterAll(async () => {
  await closeDb();
});

const placeRow = async (id = PLACE) =>
  (
    await pool.query(
      'SELECT name, description, location, district, state, pin_code, latitude, longitude, primary_image_url, themes, tags, updated_by FROM places WHERE id = $1',
      [id]
    )
  ).rows[0];

/** A multipart edit, because the route runs through multer whether or not a file is attached. */
const edit = (fields, { file, headers = asAdmin, id = PLACE } = {}) => {
  let req = request(app).put(`/api/admin/places/${id}`).set(headers);
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  if (file) req = req.attach('image', PNG, { filename: 'new.png', contentType: 'image/png' });
  return req;
};

describe('who may edit a place', () => {
  test('a signed-in non-admin is refused and nothing changes', async () => {
    const before = await placeRow();
    const res = await edit({ name: 'Hijacked' }, { headers: asUser });

    expect(res.status).toBe(403);
    expect((await placeRow()).name).toBe(before.name);
  });

  test('an unknown place is a 404', async () => {
    expect((await edit({ name: 'Ghost' }, { id: 999999 })).status).toBe(404);
  });
});

describe('a partial edit leaves untouched fields alone', () => {
  test('sending only a name changes only the name', async () => {
    const before = await placeRow();

    const res = await edit({ name: 'Renamed Coorg' });

    expect(res.status).toBe(200);
    const after = await placeRow();
    expect(after.name).toBe('Renamed Coorg');
    expect(after.location).toBe(before.location);
    expect(after.description).toBe(before.description);
    expect(after.primary_image_url).toBe(before.primary_image_url);
  });

  test('an empty description clears it, because absence and emptiness differ', async () => {
    // `description !== undefined ? description : current` — sending '' is a deliberate clear.
    const res = await edit({ name: 'Coorg', description: '' });

    expect(res.status).toBe(200);
    expect((await placeRow()).description).toBe('');
  });

  test('an empty name does NOT clear it — a place must always have one', async () => {
    // `name || currentPlace.name`. The asymmetry with description above is the point: this one is
    // load-bearing, and a uniform `!== undefined` refactor would quietly allow nameless places.
    const before = await placeRow();

    const res = await edit({ name: '', location: 'Karnataka' });

    // The route validator may reject first; either way the stored name must survive.
    expect((await placeRow()).name).toBe(before.name);
    expect([200, 400]).toContain(res.status);
  });

  test('the editing admin is recorded', async () => {
    // Starts from a *different* value on purpose. The seed writes `updated_by = 'seed-admin-uid'`
    // to every place, so asserting that value after an edit by that same admin passes whether or
    // not the column was ever written — which is exactly how the first version of this test
    // survived a mutation that removed `updated_by` from the model's allowlist entirely.
    await pool.query("UPDATE places SET updated_by = 'someone-else' WHERE id = $1", [PLACE]);

    await edit({ name: 'Audited' });

    expect((await placeRow()).updated_by).toBe('seed-admin-uid');
  });

  test('json fields fall back to the stored value when not sent', async () => {
    const before = await placeRow();
    await edit({ name: 'Coorg' });
    expect((await placeRow()).themes).toEqual(before.themes);
  });

  test('json fields are replaced when sent', async () => {
    // `mountain`, not `hill`: themes are a closed vocabulary and the write path now enforces it.
    // The value was always incidental here — this test is about JSON fields being replaced.
    await edit({ name: 'Coorg', themes: JSON.stringify(['mountain', 'nature']) });
    expect((await placeRow()).themes).toEqual(['mountain', 'nature']);
  });
});

describe('replacing the primary image', () => {
  test('the new URL is stored', async () => {
    const res = await edit({ name: 'Coorg' }, { file: true });

    expect(res.status).toBe(200);
    expect((await placeRow()).primary_image_url).toBe(NEW_IMAGE);
  });

  test('the previous asset is destroyed, so edits do not accumulate orphans', async () => {
    // The recorded defect: every upload gets a fresh timestamped public_id, so a replacement never
    // overwrites its predecessor. Without this cleanup, editing a photo N times leaves N-1 assets
    // paid for and unreachable.
    await edit({ name: 'Coorg' }, { file: true });

    expect(mockDestroyImage).toHaveBeenCalledWith('easytrip/places/2/old');
  });

  test('cleanup happens only after the upload succeeds', async () => {
    // Ordering is the property: destroying first and then failing to upload would leave the place
    // pointing at an asset that no longer exists.
    mockUploadImage.mockRejectedValue(new Error('cloudinary is down'));

    const res = await edit({ name: 'Coorg' }, { file: true });

    expect(res.status).toBe(200);
    expect(mockDestroyImage).not.toHaveBeenCalled();
    expect((await placeRow()).primary_image_url).toBe(OLD_IMAGE);
  });

  test('a failed upload still applies the rest of the edit', async () => {
    // A third-party outage must degrade to "photo unchanged", not "cannot edit places".
    mockUploadImage.mockRejectedValue(new Error('cloudinary is down'));

    await edit({ name: 'Renamed Anyway' }, { file: true });

    const after = await placeRow();
    expect(after.name).toBe('Renamed Anyway');
    expect(after.primary_image_url).toBe(OLD_IMAGE);
  });

  test('an unchanged public_id is not destroyed', async () => {
    // `previousPublicId !== result.public_id` — if a future change made ids stable rather than
    // timestamped, deleting the "previous" asset would delete the one just uploaded.
    mockUploadImage.mockResolvedValue({ url: OLD_IMAGE, public_id: 'easytrip/places/2/old' });

    await edit({ name: 'Coorg' }, { file: true });

    expect(mockDestroyImage).not.toHaveBeenCalled();
  });

  test('a place with no previous image uploads without attempting cleanup', async () => {
    await pool.query('UPDATE places SET primary_image_url = NULL WHERE id = $1', [PLACE]);

    const res = await edit({ name: 'Coorg' }, { file: true });

    expect(res.status).toBe(200);
    expect((await placeRow()).primary_image_url).toBe(NEW_IMAGE);
    expect(mockDestroyImage).not.toHaveBeenCalled();
  });

  test('an edit with no file leaves the image and calls neither Cloudinary function', async () => {
    await edit({ name: 'Coorg' });

    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(mockDestroyImage).not.toHaveBeenCalled();
    expect((await placeRow()).primary_image_url).toBe(OLD_IMAGE);
  });
});

describe('coordinates', () => {
  test('a sent coordinate is stored as a number', async () => {
    await edit({ name: 'Coorg', latitude: '12.42', longitude: '75.74' });

    const after = await placeRow();
    expect(Number(after.latitude)).toBeCloseTo(12.42, 2);
    expect(Number(after.longitude)).toBeCloseTo(75.74, 2);
  });

  test('an omitted coordinate keeps the stored value', async () => {
    await edit({ name: 'Coorg', latitude: '12.42', longitude: '75.74' });
    await edit({ name: 'Coorg Again' });

    expect(Number((await placeRow()).latitude)).toBeCloseTo(12.42, 2);
  });

  test('an empty coordinate clears it — BUG-048, fixed in Sprint 6.17', async () => {
    // The controller has always computed `null` for a cleared coordinate on purpose, and the
    // validator skips `toFloat()` so a sanitised 0 cannot read as absent. It never reached the
    // column: `placeModel.updatePlace` wrote every field as `COALESCE($n, column)`, so `null`
    // meant *keep* and the clearing branch was unreachable. An admin who pinned a place wrongly
    // could overwrite the coordinates but never remove them.
    //
    // The model now keys on **presence** rather than value, so an absent key means "leave it" and
    // an explicit null means "clear it".
    await edit({ name: 'Coorg', latitude: '12.42', longitude: '75.74' });
    await edit({ name: 'Coorg', latitude: '', longitude: '' });

    const after = await placeRow();
    expect(after.latitude).toBeNull();
    expect(after.longitude).toBeNull();
  });

  test('clearing one coordinate does not disturb anything else', async () => {
    // Presence-keying means the SET clause is now built per request. This is the assertion that
    // catches a version of it that writes the wrong columns.
    const before = await placeRow();
    await edit({ name: 'Coorg', latitude: '12.42', longitude: '75.74' });
    await edit({ name: 'Coorg', latitude: '', longitude: '' });

    const after = await placeRow();
    expect(after.location).toBe(before.location);
    expect(after.primary_image_url).toBe(before.primary_image_url);
    expect(after.name).toBe('Coorg');
  });

  test('the sparse update the create path depends on keeps every other column', async () => {
    // The reason the COALESCE above exists. Directly asserted so that anyone tempted to remove it
    // sees what it protects: a create-with-image writes the URL through this same function with no
    // other field set.
    const before = await placeRow();
    const { updatePlace } = require('../src/models/placeModel');

    await updatePlace(PLACE, { primary_image_url: NEW_IMAGE, updated_by: 'seed-admin-uid' });

    const after = await placeRow();
    expect(after.primary_image_url).toBe(NEW_IMAGE);
    expect(after.name).toBe(before.name);
    expect(after.location).toBe(before.location);
    expect(Number(after.latitude)).toBeCloseTo(Number(before.latitude), 5);
  });

  test('and it no longer wipes updated_by, which it used to (BUG-048, second half)', async () => {
    // `updated_by` was the one column written unconditionally, so a sparse call passed `undefined`
    // — which node-pg sends as NULL. A place created *with* a photo lost its audit attribution the
    // instant it was created; one created without a photo kept it. IMP-002 exists to make these
    // columns mean something.
    await pool.query("UPDATE places SET updated_by = 'seed-admin-uid' WHERE id = $1", [PLACE]);
    const { updatePlace } = require('../src/models/placeModel');

    await updatePlace(PLACE, { primary_image_url: NEW_IMAGE });

    expect((await placeRow()).updated_by).toBe('seed-admin-uid');
  });

  test('a key outside the allowlist is ignored, not turned into a column name', async () => {
    // The SET clause is assembled at runtime, so `UPDATABLE_COLUMNS` is the only thing that ever
    // becomes SQL text. Without it, an unexpected key would be interpolated as an identifier —
    // Postgres would reject "column bogus does not exist" and the update would throw, and a
    // carefully chosen key is how identifier interpolation becomes injection.
    const { updatePlace } = require('../src/models/placeModel');

    await expect(
      updatePlace(PLACE, {
        name: 'Allowlisted',
        bogus_column: 'x',
        [`name = 'injected', description = 'injected'`]: 'y'
      })
    ).resolves.toBeDefined();

    expect((await placeRow()).name).toBe('Allowlisted');
  });

  test('an explicit null still clears a column, so presence is what decides', async () => {
    // The other side of the same rule: absent means keep, present-and-null means clear. Without
    // both assertions the model could satisfy one by ignoring nulls entirely.
    const { updatePlace } = require('../src/models/placeModel');

    await updatePlace(PLACE, { primary_image_url: null, updated_by: 'seed-admin-uid' });

    expect((await placeRow()).primary_image_url).toBeNull();
  });
});
