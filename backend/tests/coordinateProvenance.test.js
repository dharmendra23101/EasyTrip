const request = require('supertest');

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const {
  normalizeCoordinateSource,
  sameCoordinate,
  resolveCoordinateSource
} = require('../src/controllers/helpers/coordinateSource');

/**
 * `places.coordinates_source` — the column that decides whether a place page credits
 * OpenStreetMap (`IMP-127`, `ADR-039`).
 *
 * ODbL section 4.3 requires attribution for geocoding **output**, and the obligation attaches to
 * the coordinates rather than to the row. That makes the interesting property a temporal one, and
 * it is the reason this file exists rather than three assertions bolted onto `updatePlace.test.js`:
 *
 *   **an attribution must survive edits that do not move the pin, and must not survive edits that
 *   do.**
 *
 * Both halves fail silently in production. Attribution that disappears on an unrelated save is a
 * licence breach nobody sees; attribution that persists onto hand-typed coordinates is a claim
 * about provenance that is simply false — the `IMP-027` defect class, reached by trying to comply.
 *
 * The database is doing real work here too. `places_coordinates_source_needs_coordinates` makes a
 * provenance with no coordinates unrepresentable, so the last two tests assert against SQL rather
 * than against the handler that is supposed to prevent it.
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };

// Hampi: the one seeded place carrying `coordinates_source = 'nominatim'`.
const ATTRIBUTED = 1;
// Gokarna: real coordinates, no provenance. The control case.
const UNATTRIBUTED = 3;

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
});
afterAll(async () => {
  await closeDb();
});

const sourceOf = async (id) =>
  (await pool.query('SELECT coordinates_source FROM places WHERE id = $1', [id])).rows[0]
    ?.coordinates_source ?? null;

describe('resolveCoordinateSource (pure)', () => {
  it('keeps the stored claim when the pin has not moved', () => {
    expect(
      resolveCoordinateSource({
        requested: undefined,
        hasCoordinates: true,
        coordinatesChanged: false,
        current: 'nominatim'
      })
    ).toBe('nominatim');
  });

  it('drops the stored claim when the pin moves and nothing re-declares it', () => {
    expect(
      resolveCoordinateSource({
        requested: undefined,
        hasCoordinates: true,
        coordinatesChanged: true,
        current: 'nominatim'
      })
    ).toBeNull();
  });

  it('refuses a provenance for coordinates that are being cleared', () => {
    expect(
      resolveCoordinateSource({
        requested: 'nominatim',
        hasCoordinates: false,
        coordinatesChanged: true,
        current: 'nominatim'
      })
    ).toBeNull();
  });

  it('accepts only the geocoders on the allowlist', () => {
    expect(normalizeCoordinateSource('nominatim')).toBe('nominatim');
    expect(normalizeCoordinateSource('  nominatim  ')).toBe('nominatim');
    expect(normalizeCoordinateSource('google')).toBeNull();
    expect(normalizeCoordinateSource('')).toBeNull();
    expect(normalizeCoordinateSource(null)).toBeNull();
    expect(normalizeCoordinateSource(42)).toBeNull();
  });

  it('compares coordinates numerically, because DECIMAL arrives as a string', () => {
    // The failure this prevents: `'15.33500000' !== 15.335` reports an unchanged pin as moved, and
    // every save on the place page silently strips its attribution.
    expect(sameCoordinate('15.33500000', 15.335)).toBe(true);
    expect(sameCoordinate(15.335, 15.336)).toBe(false);
    expect(sameCoordinate(null, null)).toBe(true);
    expect(sameCoordinate(null, 15.335)).toBe(false);
    expect(sameCoordinate(0, null)).toBe(false);
    // 0 is a real coordinate, not an absent one.
    expect(sameCoordinate(0, 0)).toBe(true);
  });
});

describe('POST /api/admin/places — recording provenance', () => {
  it('stores the geocoder that produced the coordinates', async () => {
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .field('name', 'Aihole')
      .field('location', 'Aihole')
      .field('latitude', '16.0197')
      .field('longitude', '75.8817')
      .field('coordinates_source', 'nominatim');

    expect(res.status).toBe(201);
    expect(res.body.coordinates_source).toBe('nominatim');
    expect(await sourceOf(res.body.id)).toBe('nominatim');
  });

  it('records nothing when the admin typed the coordinates', async () => {
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .field('name', 'Pattadakal')
      .field('location', 'Pattadakal')
      .field('latitude', '15.9487')
      .field('longitude', '75.8166');

    expect(res.status).toBe(201);
    expect(res.body.coordinates_source).toBeNull();
  });

  it('rejects a geocoder that is not on the allowlist', async () => {
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .field('name', 'Somewhere')
      .field('location', 'Somewhere')
      .field('latitude', '15.0')
      .field('longitude', '75.0')
      .field('coordinates_source', 'google');

    // Rejected rather than dropped: this field decides whether a legal notice renders, so a typo
    // must be loud. A silent null would remove an attribution and look like a successful save.
    expect(res.status).toBe(400);
  });

  it('refuses to attribute coordinates that were never sent', async () => {
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .field('name', 'Nowhere')
      .field('location', 'Nowhere')
      .field('coordinates_source', 'nominatim');

    expect(res.status).toBe(201);
    expect(res.body.coordinates_source).toBeNull();
  });
});

describe('PUT /api/admin/places/:id — keeping provenance honest', () => {
  it('survives an edit that does not touch the coordinates', async () => {
    const res = await request(app)
      .put(`/api/admin/places/${ATTRIBUTED}`)
      .set(asAdmin)
      .field('description', 'Edited without moving the pin.');

    expect(res.status).toBe(200);
    expect(await sourceOf(ATTRIBUTED)).toBe('nominatim');
  });

  it('survives an edit that re-posts the same coordinates', async () => {
    // The edit form posts every field on every save. Keying on "was latitude in the body?" instead
    // of "did the value change?" would revoke attribution on every description edit.
    const res = await request(app)
      .put(`/api/admin/places/${ATTRIBUTED}`)
      .set(asAdmin)
      .field('description', 'Same pin, resent.')
      .field('latitude', '15.335')
      .field('longitude', '76.46');

    expect(res.status).toBe(200);
    expect(await sourceOf(ATTRIBUTED)).toBe('nominatim');
  });

  it('is revoked when the pin is moved by hand', async () => {
    const res = await request(app)
      .put(`/api/admin/places/${ATTRIBUTED}`)
      .set(asAdmin)
      .field('latitude', '15.4')
      .field('longitude', '76.46');

    expect(res.status).toBe(200);
    expect(await sourceOf(ATTRIBUTED)).toBeNull();
  });

  it('is revoked when the coordinates are cleared', async () => {
    const res = await request(app)
      .put(`/api/admin/places/${ATTRIBUTED}`)
      .set(asAdmin)
      .field('latitude', '')
      .field('longitude', '');

    expect(res.status).toBe(200);
    expect(await sourceOf(ATTRIBUTED)).toBeNull();
  });

  it('can be re-declared by a lookup that moves the pin', async () => {
    const res = await request(app)
      .put(`/api/admin/places/${UNATTRIBUTED}`)
      .set(asAdmin)
      .field('latitude', '14.5479')
      .field('longitude', '74.3188')
      .field('coordinates_source', 'nominatim');

    expect(res.status).toBe(200);
    expect(await sourceOf(UNATTRIBUTED)).toBe('nominatim');
  });

  it('does not invent one for a place that never had it', async () => {
    const res = await request(app)
      .put(`/api/admin/places/${UNATTRIBUTED}`)
      .set(asAdmin)
      .field('description', 'Untouched pin, no claim.');

    expect(res.status).toBe(200);
    expect(await sourceOf(UNATTRIBUTED)).toBeNull();
  });
});

describe('GET /api/places/:id — the notice has something to read', () => {
  it('exposes the provenance on the public detail payload', async () => {
    const attributed = await request(app).get(`/api/places/${ATTRIBUTED}`);
    expect(attributed.status).toBe(200);
    expect(attributed.body.coordinates_source).toBe('nominatim');

    const plain = await request(app).get(`/api/places/${UNATTRIBUTED}`);
    expect(plain.status).toBe(200);
    expect(plain.body.coordinates_source).toBeNull();
  });

  it('still does not leak the curating admin', async () => {
    // The new column joins a projection that deliberately omits `created_by`/`updated_by`
    // (`IMP-094` found those in `__NEXT_DATA__`). Adding a field to that SELECT is exactly when
    // the omission gets undone by accident.
    const res = await request(app).get(`/api/places/${ATTRIBUTED}`);
    expect(res.body).not.toHaveProperty('created_by');
    expect(res.body).not.toHaveProperty('updated_by');
  });
});

describe('the database refuses what the controller is supposed to prevent', () => {
  it('rejects a provenance with no coordinates', async () => {
    await expect(
      pool.query('UPDATE places SET latitude = NULL WHERE id = $1', [ATTRIBUTED])
    ).rejects.toThrow(/places_coordinates_source_needs_coordinates/);
  });

  it('rejects a geocoder nobody vetted', async () => {
    await expect(
      pool.query('UPDATE places SET coordinates_source = $1 WHERE id = $2', ['acme', ATTRIBUTED])
    ).rejects.toThrow(/places_coordinates_source_known/);
  });
});
