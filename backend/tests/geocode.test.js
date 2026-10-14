const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const geocodingService = require('../src/services/geocodingService');

/**
 * Forward geocoding (`IMP-116`, `ADR-035`).
 *
 * Two things are being tested and they are unusually separate:
 *
 *   - **The endpoint**, which is admin-gated and turns a lookup into a response shape.
 *   - **The service**, whose two most important properties — the identifying `User-Agent` and the
 *     1 req/s pacing — are **not visible in any response.** Nominatim's usage policy blocks callers
 *     that violate either, and the failure arrives days later as an IP ban rather than as a test
 *     failure. So they are asserted against the outgoing request, through the `fetchImpl` seam.
 *
 * **Nothing here reaches the real Nominatim**, and that took two attempts. The endpoint tests
 * originally called through to the live service — the controller invokes `geocodingService.geocode`
 * with the global `fetch`, so `GET /api/admin/geocode?q=Hampi` was a real request to a free public
 * instance on every test run. That is precisely the abuse the usage policy exists to prevent, and
 * it was invisible: the assertions passed either way, because a blocked or slow lookup returns `[]`
 * and `[]` was what most of them expected. The spy below is not a convenience.
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload
});

const NOMINATIM_ROW = {
  lat: '15.3350',
  lon: '76.4600',
  display_name: 'Hampi, Ballari, Karnataka, India',
  address: {
    village: 'Hampi',
    county: 'Ballari',
    state: 'Karnataka',
    postcode: '583239',
    country_code: 'in'
  }
};

beforeAll(async () => {
  await createSchema();
});
/**
 * Every endpoint test replaces the lookup itself.
 *
 * The service is exercised directly, with an injected `fetchImpl`, in the sections below; the
 * endpoint's job is the gate, the query validation and the response shape, and none of that needs a
 * network. Restored in `afterEach` so a service-level test never runs against the spy.
 */
const stubLookup = (results) => jest.spyOn(geocodingService, 'geocode').mockResolvedValue(results);

beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  geocodingService.clearCache();
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(async () => {
  await closeDb();
});

describe('GET /api/admin/geocode — who may ask', () => {
  test('an admin may', async () => {
    stubLookup([]);
    const res = await request(app).get('/api/admin/geocode?q=Hampi').set(asAdmin);
    expect(res.status).toBe(200);
  });

  test('a signed-in non-admin may not, and no lookup happens', async () => {
    // This endpoint spends a shared, rate-limited third-party budget. The population that can do
    // that is the same one that can already create places — and a rejected caller must not have
    // cost us an upstream request on the way to the 403.
    const lookup = stubLookup([]);
    expect((await request(app).get('/api/admin/geocode?q=Hampi').set(asUser)).status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
  });

  test('an anonymous caller may not', async () => {
    const lookup = stubLookup([]);
    expect((await request(app).get('/api/admin/geocode?q=Hampi')).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  test('an over-long query is refused before any upstream call', async () => {
    const lookup = stubLookup([]);
    const res = await request(app)
      .get(`/api/admin/geocode?q=${'x'.repeat(201)}`)
      .set(asAdmin);
    expect(res.status).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('the endpoint classifies the outcome, so no two clients disagree', () => {
  // The `status` field is the whole reason the endpoint exists rather than the client counting
  // `results.length` — three cases, rendered three ways, classified once.

  test('exactly one candidate is "exact", which is what lets the form auto-fill', async () => {
    stubLookup([{ label: 'Hampi', latitude: 15.335, longitude: 76.46 }]);
    const res = await request(app).get('/api/admin/geocode?q=Hampi').set(asAdmin);

    expect(res.body.status).toBe('exact');
    expect(res.body.results).toHaveLength(1);
  });

  test('more than one is "ambiguous", which stops the form auto-filling', async () => {
    stubLookup([
      { label: 'Hampi', latitude: 15.335, longitude: 76.46 },
      { label: 'Hampi Road', latitude: 15.2689, longitude: 76.3909 }
    ]);
    const res = await request(app).get('/api/admin/geocode?q=Hampi').set(asAdmin);

    expect(res.body.status).toBe('ambiguous');
    expect(res.body.results).toHaveLength(2);
  });

  test('none is "no_match"', async () => {
    stubLookup([]);
    const res = await request(app).get('/api/admin/geocode?q=nowhere').set(asAdmin);
    expect(res.body.status).toBe('no_match');
  });

  test('a lookup that throws is a 500, not a silent empty list', async () => {
    // The service is written never to throw. This asserts what happens if that stops being true:
    // an admin sees an error rather than a blank field they might read as "no such place".
    jest.spyOn(geocodingService, 'geocode').mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/admin/geocode?q=Hampi').set(asAdmin);
    expect(res.status).toBe(500);
  });
});

describe('the response shape', () => {
  test('one candidate is reported as exact', async () => {
    const results = await geocodingService.geocode('Hampi', {
      fetchImpl: async () => okResponse([NOMINATIM_ROW])
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      label: 'Hampi, Ballari, Karnataka, India',
      latitude: 15.335,
      longitude: 76.46,
      state: 'Karnataka',
      district: 'Ballari',
      postcode: '583239',
      country_code: 'IN'
    });
  });

  test('a miss is 200 with an empty list, not a 404', async () => {
    // "No match for this text" is a successful answer to the question asked. A 404 means the
    // endpoint does not exist, and pushes every client into treating a normal outcome as an error.
    stubLookup([]);
    const res = await request(app).get('/api/admin/geocode?q=zzzzzznotaplace').set(asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.status).toBe('no_match');
  });

  test('no query at all is an empty result, not an error', async () => {
    // Reaches the real service deliberately — it short-circuits an empty query before any fetch,
    // which is the property being asserted.
    const res = await request(app).get('/api/admin/geocode').set(asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  test('there is no pagination envelope — five candidates is the whole answer', async () => {
    stubLookup([]);
    const res = await request(app).get('/api/admin/geocode?q=nothing').set(asAdmin);
    expect(res.body).not.toHaveProperty('pagination');
    expect(res.body).not.toHaveProperty('data');
  });
});

describe('coordinates are parsed, never coerced', () => {
  test('Nominatim string coordinates become numbers', async () => {
    // `lat`/`lon` arrive as strings. Same trap as BL-007 in the map and IMP-113 in structured data.
    const [result] = await geocodingService.geocode('Hampi', {
      fetchImpl: async () => okResponse([NOMINATIM_ROW])
    });
    expect(typeof result.latitude).toBe('number');
    expect(typeof result.longitude).toBe('number');
  });

  test('a result with no usable coordinate is DROPPED, not filled with zero', async () => {
    // `Number(null)` is 0, which is a real coordinate in the Gulf of Guinea — a pin an admin would
    // save without noticing, on a public map.
    const results = await geocodingService.geocode('Hampi', {
      fetchImpl: async () =>
        okResponse([
          { lat: null, lon: null, display_name: 'Broken' },
          { lat: 'not-a-number', lon: '76.46', display_name: 'Also broken' },
          NOMINATIM_ROW
        ])
    });
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Hampi, Ballari, Karnataka, India');
  });

  test('an out-of-range coordinate is dropped', async () => {
    const results = await geocodingService.geocode('Hampi', {
      fetchImpl: async () => okResponse([{ lat: '999', lon: '76.46', display_name: 'Impossible' }])
    });
    expect(results).toEqual([]);
  });

  test('a genuine zero coordinate is kept', async () => {
    // The equator is a real latitude; rejecting `0` as missing is the mirror-image bug.
    const results = await geocodingService.geocode('Null Island', {
      fetchImpl: async () => okResponse([{ lat: '0', lon: '0', display_name: 'Null Island' }])
    });
    expect(results[0]).toMatchObject({ latitude: 0, longitude: 0 });
  });
});

describe('the outgoing request — what the response cannot show', () => {
  test('it identifies itself, because an anonymous caller is blocked by policy', async () => {
    // Nominatim's usage policy REQUIRES an identifying User-Agent and treats a generic one as
    // abuse. Nothing in any response reveals whether we sent it; the punishment is an IP ban days
    // later. This assertion is the only place that can fail.
    let sent;
    await geocodingService.geocode('Hampi', {
      fetchImpl: async (url, options) => {
        sent = options;
        return okResponse([NOMINATIM_ROW]);
      }
    });

    expect(sent.headers['User-Agent']).toBe(geocodingService.USER_AGENT);
    expect(sent.headers['User-Agent']).toMatch(/EasyTrip/);
    expect(sent.headers['User-Agent']).toMatch(/https?:\/\//);
  });

  test('the query is URL-encoded into a fixed endpoint, so the caller picks no URL', async () => {
    // The distinction that keeps this off the SSRF list: the caller supplies a search term, not a
    // host, scheme or path.
    let requested;
    await geocodingService.geocode('Hampi & Badami?x=1#f', {
      fetchImpl: async (url) => {
        requested = url;
        return okResponse([]);
      }
    });

    expect(requested.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
    expect(requested).toContain('q=Hampi%20%26%20Badami%3Fx%3D1%23f');
    // The encoded term cannot introduce a second parameter or a fragment.
    expect(requested.split('#')).toHaveLength(1);
  });

  test('it is constrained to the catalogue’s country', async () => {
    // "Hampi" must not return Hampi, Ohio. The realistic wrong answer here is a geographic
    // ambiguity, not an attack.
    let requested;
    await geocodingService.geocode('Hampi', {
      fetchImpl: async (url) => {
        requested = url;
        return okResponse([]);
      }
    });
    expect(requested).toContain('countrycodes=in');
  });

  test('it asks for a bounded number of candidates', async () => {
    let requested;
    await geocodingService.geocode('Hampi', {
      fetchImpl: async (url) => {
        requested = url;
        return okResponse([]);
      }
    });
    expect(requested).toContain(`limit=${geocodingService.MAX_RESULTS}`);
  });

  test('more candidates than the cap are truncated even if the provider ignores limit=', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...NOMINATIM_ROW,
      display_name: `Result ${i}`
    }));
    const results = await geocodingService.geocode('Hampi', {
      fetchImpl: async () => okResponse(many)
    });
    expect(results).toHaveLength(geocodingService.MAX_RESULTS);
  });
});

describe('pacing and caching — the policy this integration lives under', () => {
  test('two different queries are at least a second apart', async () => {
    // The public instance allows 1 req/s absolute, and exceeding it gets the IP blocked rather than
    // throttled. Serialising here is the only place that can hold the line across concurrent admins.
    const stamps = [];
    const fetchImpl = async () => {
      stamps.push(Date.now());
      return okResponse([]);
    };

    await geocodingService.geocode('first query', { fetchImpl });
    await geocodingService.geocode('second query', { fetchImpl });

    expect(stamps).toHaveLength(2);
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(geocodingService.MIN_INTERVAL_MS - 50);
  }, 15000);

  test('a repeated query costs no upstream call at all', async () => {
    const fetchImpl = jest.fn(async () => okResponse([NOMINATIM_ROW]));

    await geocodingService.geocode('Hampi', { fetchImpl });
    const second = await geocodingService.geocode('Hampi', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toHaveLength(1);
  });

  test('case and repeated whitespace do not defeat the cache', async () => {
    const fetchImpl = jest.fn(async () => okResponse([NOMINATIM_ROW]));

    await geocodingService.geocode('Hampi, Karnataka', { fetchImpl });
    await geocodingService.geocode('  HAMPI,   Karnataka  ', { fetchImpl });

    // Two spellings of one question. Without normalisation each would spend a second of the budget.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('spacing AROUND punctuation is not normalised — the documented boundary', async () => {
    // `"Hampi , Karnataka"` and `"Hampi, Karnataka"` are one question to a person and two cache
    // entries here, because the key collapses runs of whitespace but does not rewrite punctuation.
    //
    // Pinned rather than fixed. Normalising around punctuation means deciding what counts as
    // punctuation in an address, in every language Nominatim accepts, to save one upstream call in
    // an uncommon case — and getting it wrong merges two genuinely different queries, which is a
    // worse failure than a redundant lookup. This assertion exists so the limit is a decision.
    const fetchImpl = jest.fn(async () => okResponse([NOMINATIM_ROW]));

    await geocodingService.geocode('Badami, Karnataka', { fetchImpl });
    await geocodingService.geocode('Badami , Karnataka', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }, 15000);

  test('a miss is cached too, so a re-typed typo does not re-ask', async () => {
    const fetchImpl = jest.fn(async () => okResponse([]));

    await geocodingService.geocode('zzzz', { fetchImpl });
    await geocodingService.geocode('zzzz', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('the provider having a bad day is not an EasyTrip error', () => {
  test('a non-200 is an empty result', async () => {
    const results = await geocodingService.geocode('Hampi', {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) })
    });
    expect(results).toEqual([]);
  });

  test('a thrown request is an empty result, not an exception', async () => {
    const results = await geocodingService.geocode('Hampi', {
      fetchImpl: async () => {
        throw new Error('timeout');
      }
    });
    expect(results).toEqual([]);
  });

  test('an unrecognised shape is an empty result, not a crash', async () => {
    // Reading `.map` off an object is how a provider change becomes a 500 on an admin form.
    for (const payload of [{ error: 'nope' }, null, 'text', 42]) {
      expect(
        await geocodingService.geocode(`shape-${JSON.stringify(payload)}`, {
          fetchImpl: async () => okResponse(payload)
        })
      ).toEqual([]);
    }
  }, 20000);

  test('a failure is never cached as a result, so a later attempt can still succeed', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return okResponse([NOMINATIM_ROW]);
    };

    expect(await geocodingService.geocode('Hampi', { fetchImpl })).toEqual([]);
    // Caching one bad moment would make it last 24 hours for a query that works.
    expect(await geocodingService.geocode('Hampi', { fetchImpl })).toHaveLength(1);
  }, 15000);
});
