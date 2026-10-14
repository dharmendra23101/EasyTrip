const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * The traveller's stated preferences (`FV-020` stage a).
 *
 * **The interesting behaviour is all about absence**, which is this project's recurring theme and
 * the reason `021_travel_preferences.sql` gives every scalar a NULL default:
 *
 *   1. **Not said is not a default.** Somebody who has never opened the form has not told us they
 *      want a mid-range, balanced, solo trip. `ADR-051`'s rule — an absence is not a zero — applied
 *      to a preference rather than to a score.
 *   2. **A preference must be removable.** `[]` and `null` are real answers, and the validator uses
 *      three different `optional()` variants across this one object to keep them distinguishable
 *      from "field not sent". Getting that wrong means a preference somebody can set and never
 *      unset.
 *   3. **A partial save must not erase the rest.** An older client that knows only `name` must be
 *      able to save a name without silently wiping preferences it has never heard of.
 */

const USER = { uid: 'seed-user-uid' };
const asUser = { Authorization: authHeader(USER) };

const getProfile = () => request(app).get('/api/auth/profile').set(asUser);
const save = (body) =>
  request(app)
    .put('/api/auth/profile')
    .set(asUser)
    .send({ name: 'Tom Traveller', ...body });

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

describe('a profile nobody has filled in says nothing, rather than guessing', () => {
  test('every preference starts unset, and the arrays start empty', async () => {
    const res = await getProfile();

    expect(res.status).toBe(200);
    expect(res.body.budget_band).toBeNull();
    expect(res.body.travel_pace).toBeNull();
    expect(res.body.party_type).toBeNull();
    expect(res.body.interests).toEqual([]);
    expect(res.body.dietary_needs).toEqual([]);
  });
});

describe('preferences round-trip', () => {
  test('what was saved is what comes back', async () => {
    const saved = await save({
      interests: ['beach', 'historical'],
      budget_band: 'mid',
      travel_pace: 'relaxed',
      party_type: 'family',
      dietary_needs: ['vegetarian']
    });

    expect(saved.status).toBe(200);

    const res = await getProfile();
    expect(res.body.interests).toEqual(['beach', 'historical']);
    expect(res.body.budget_band).toBe('mid');
    expect(res.body.travel_pace).toBe('relaxed');
    expect(res.body.party_type).toBe('family');
    expect(res.body.dietary_needs).toEqual(['vegetarian']);
  });

  test('interests use the same theme ids places are tagged with', async () => {
    // A parallel vocabulary would be two lists that drift and never join, which is the whole reason
    // `check:themes` exists.
    await save({ interests: ['beach', 'mountain', 'nature'] });

    const res = await getProfile();
    expect(res.body.interests).toEqual(['beach', 'mountain', 'nature']);
  });
});

describe('a preference can be removed, which is the half that usually breaks', () => {
  test('an empty array clears a list', async () => {
    await save({ dietary_needs: ['vegan'] });

    await save({ dietary_needs: [] });

    expect((await getProfile()).body.dietary_needs).toEqual([]);
  });

  test('an empty string clears a scalar', async () => {
    // A `<select>` with no choice made submits `''`. If that were rejected, the form could set a
    // preference and never unset one.
    await save({ budget_band: 'premium' });

    await save({ budget_band: '' });

    expect((await getProfile()).body.budget_band).toBeNull();
  });

  test('null clears a scalar too', async () => {
    await save({ travel_pace: 'packed' });

    await save({ travel_pace: null });

    expect((await getProfile()).body.travel_pace).toBeNull();
  });
});

describe('a partial save leaves the rest alone', () => {
  test('saving only a name does not erase preferences', async () => {
    // The failure this guards: an older client, or any form that does not know about `FV-020`,
    // saving a display name and silently wiping somebody's dietary needs.
    await save({
      interests: ['beach'],
      budget_band: 'budget',
      dietary_needs: ['halal']
    });

    await request(app).put('/api/auth/profile').set(asUser).send({ name: 'Renamed' });

    const res = await getProfile();
    expect(res.body.name).toBe('Renamed');
    expect(res.body.interests).toEqual(['beach']);
    expect(res.body.budget_band).toBe('budget');
    expect(res.body.dietary_needs).toEqual(['halal']);
  });

  test('the access needs from FV-029 are untouched by a preference save', async () => {
    await request(app)
      .put('/api/auth/profile')
      .set(asUser)
      .send({ name: 'Tom Traveller', requires_step_free: true });

    await save({ budget_band: 'mid' });

    const res = await getProfile();
    expect(res.body.requires_step_free).toBe(true);
    expect(res.body.budget_band).toBe('mid');
  });
});

describe('the vocabularies are closed', () => {
  test('a budget band outside the list is refused', async () => {
    const res = await save({ budget_band: 'lavish' });

    expect(res.status).toBe(400);
  });

  test('a pace outside the list is refused', async () => {
    expect((await save({ travel_pace: 'frantic' })).status).toBe(400);
  });

  test('a party type outside the list is refused', async () => {
    expect((await save({ party_type: 'entourage' })).status).toBe(400);
  });

  test('interests that are not a list are refused', async () => {
    expect((await save({ interests: 'beach' })).status).toBe(400);
  });

  test('an absurdly long list is refused', async () => {
    expect((await save({ interests: Array(20).fill('beach') })).status).toBe(400);
  });
});

describe('preferences are private, like the access needs beside them', () => {
  test('they require a token', async () => {
    expect((await request(app).get('/api/auth/profile')).status).toBe(401);
  });

  test('they are not on any public place or trip payload', async () => {
    // The property that lets somebody share an itinerary without disclosing that they keep halal.
    await save({ dietary_needs: ['halal'], budget_band: 'budget' });

    const places = await request(app).get('/api/places');
    const body = JSON.stringify(places.body);

    expect(body).not.toMatch(/halal/i);
    expect(body).not.toMatch(/budget_band/i);
  });
});
