const request = require('supertest');

// `mock`-prefixed so Jest's hoisted factory may close over it (see imageUpload.test.js).
const mockDestroyImage = jest.fn(async () => true);
jest.mock('../src/config/cloudinary', () => {
  const actual = jest.requireActual('../src/config/cloudinary');
  return {
    ...actual,
    uploadImage: jest.fn(),
    destroyImage: (...args) => mockDestroyImage(...args),
    destroyPlaceAssets: jest.fn(async () => 0)
  };
});

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Serving, listing and deleting place images.
 *
 * **The assertion that matters most is `M1`.** `GET /api/places/:id/image` has **no route
 * validator** — the id reaches the controller raw — and when it cannot resolve an image it answers
 * with a generated `image/svg+xml` document. A browser opening an SVG directly executes script
 * inside it, so any request input reaching that body is reflected XSS on an unauthenticated public
 * endpoint. `SECURITY_AUDIT` M1 was exactly that bug.
 *
 * The fix is in `placeholderImage.js`: anything that is not a positive integer gets a **constant**
 * document, and the integer branch interpolates the *parsed* number rather than the path param.
 * That guard had **never executed under test** — the only request any suite made to this route used
 * a numeric id (`rateLimit.test.js`, incidentally, while testing something else), so the branch
 * that does the protecting was never taken.
 *
 * Cloudinary is stubbed only for `destroyImage`, so the delete path's own logic — the place-scoped
 * DELETE, the `publicIdFromUrl` recovery — runs for real.
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

/**
 * Fixtures chosen against what the seed actually contains, verified by query:
 *   place 1 — primary image AND two gallery rows
 *   place 2 — primary image, empty gallery
 *   place 3 — no primary image, empty gallery
 */
const SEEDED_PLACE = 1;
const EMPTY_GALLERY_PLACE = 2;
const NO_PRIMARY_PLACE = 3;

/**
 * The placeholder is served as `image/svg+xml`, so superagent buffers it into `res.body` and
 * leaves `res.text` undefined. Reading `.text` yields `undefined`, and `expect(undefined).not.
 * toContain(x)` throws rather than passing — which is how the first draft of this file failed
 * loudly instead of passing vacuously.
 */
const svgText = (res) => (Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.text));

/**
 * A stored delivery URL and the public_id it must decompose back into.
 *
 * The folder is a fixed literal rather than the place id under test, so the assertion about
 * `publicIdFromUrl`'s output cannot drift out of step with the URL that was stored — which is
 * exactly what it did in the first draft of this file.
 */
const ASSET_FOLDER = 'easytrip/places/9';
const CLOUDINARY = (name) =>
  `https://res.cloudinary.com/demo/image/upload/v1/${ASSET_FOLDER}/${name}.jpg`;
const PUBLIC_ID = (name) => `${ASSET_FOLDER}/${name}`;

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockDestroyImage.mockClear();
  mockDestroyImage.mockResolvedValue(true);
});
afterAll(async () => {
  await closeDb();
});

/** Insert a gallery row directly, so serving/deleting can be tested without an upload. */
const addImage = async (placeId, url, order = 0) =>
  (
    await pool.query(
      'INSERT INTO place_images (place_id, image_url, display_order, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
      [placeId, url, order]
    )
  ).rows[0].id;

const clearPrimary = (placeId) =>
  pool.query('UPDATE places SET primary_image_url = NULL WHERE id = $1', [placeId]);

describe('the placeholder never reflects request input (SECURITY_AUDIT M1)', () => {
  const HOSTILE = [
    ['a script tag', '<script>alert(1)</script>'],
    ['an svg event handler', '"><image href=x onerror=alert(1)>'],
    ['a javascript url', 'javascript:alert(1)'],
    ['a plain word', 'not-a-number'],
    ['a negative number', '-5'],
    ['a float', '1.5']
  ];

  test.each(HOSTILE)('%s never appears in the response body', async (_label, id) => {
    const res = await request(app).get(`/api/places/${encodeURIComponent(id)}/image`);

    expect(res.status).toBe(200);
    expect(svgText(res)).not.toContain('script');
    expect(svgText(res)).not.toContain('onerror');
    expect(svgText(res)).not.toContain(id);
  });

  test('the response really is served as SVG, or the assertions above guard nothing', async () => {
    // If the content type were text/plain the XSS would not be reachable and these tests would be
    // proving something irrelevant. The risk is real precisely because browsers run script in SVG.
    const res = await request(app).get('/api/places/not-a-number/image');

    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svgText(res)).toContain('<svg');
    expect(svgText(res)).toContain('No Image Available');
  });

  test('a valid id embeds the parsed integer, so the safe branch is genuinely different', async () => {
    // Without this, every assertion above would still pass if the generic document were returned
    // for *everything* — a guard that never varies is indistinguishable from a broken feature.
    await clearPrimary(EMPTY_GALLERY_PLACE);
    const res = await request(app).get(`/api/places/${EMPTY_GALLERY_PLACE}/image`);

    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svgText(res)).toContain(`Place ID: ${EMPTY_GALLERY_PLACE}`);
  });

  test('a numeric-leading id is not smuggled through parseInt', async () => {
    // `parseInt('2abc')` is 2, so the isNaN gate lets this through — and the *placeholder builder*
    // is what stops the raw param being embedded. This asserts the second guard, not the first.
    await clearPrimary(EMPTY_GALLERY_PLACE);
    const res = await request(app).get(`/api/places/${EMPTY_GALLERY_PLACE}abc/image`);

    expect(svgText(res)).not.toContain('abc');
  });
});

describe('resolving which image to serve', () => {
  test('a specific image id redirects to that image', async () => {
    const imageId = await addImage(SEEDED_PLACE, CLOUDINARY('specific'));
    const res = await request(app).get(`/api/places/${SEEDED_PLACE}/images/${imageId}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(CLOUDINARY('specific'));
  });

  test('an image belonging to another place is not served through this one', async () => {
    // The query is scoped `WHERE id = $1 AND place_id = $2`. Without the second clause, any gallery
    // image could be fetched through any place id — the rows are not secret, but the scoping is
    // what makes the route's contract mean anything.
    const foreign = await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('foreign'));
    await clearPrimary(SEEDED_PLACE);

    const res = await request(app).get(`/api/places/${SEEDED_PLACE}/images/${foreign}`);

    expect(res.headers.location).not.toBe(CLOUDINARY('foreign'));
  });

  test('with no specific id, the primary image wins', async () => {
    await pool.query('UPDATE places SET primary_image_url = $1 WHERE id = $2', [
      CLOUDINARY('primary'),
      SEEDED_PLACE
    ]);
    await addImage(SEEDED_PLACE, CLOUDINARY('gallery'));

    const res = await request(app).get(`/api/places/${SEEDED_PLACE}/image`);
    expect(res.headers.location).toBe(CLOUDINARY('primary'));
  });

  test('with no primary image, the first gallery image by display order is used', async () => {
    // Place 3 on purpose: it has no primary image and no seeded gallery rows, so the ordering
    // under test is the only thing deciding the answer. Using place 1 here would race the two
    // rows the seed already puts in its gallery.
    await addImage(NO_PRIMARY_PLACE, CLOUDINARY('second'), 5);
    await addImage(NO_PRIMARY_PLACE, CLOUDINARY('first'), 1);

    const res = await request(app).get(`/api/places/${NO_PRIMARY_PLACE}/image`);
    // The ordering has to match what the gallery shows first, or the card and the page disagree.
    expect(res.headers.location).toBe(CLOUDINARY('first'));
  });

  test('a place that does not exist gets the placeholder, not a 404 or a crash', async () => {
    const res = await request(app).get('/api/places/999999/image');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
  });

  test('a redirect is cacheable, since the destination for an id is stable', async () => {
    await pool.query('UPDATE places SET primary_image_url = $1 WHERE id = $2', [
      CLOUDINARY('primary'),
      SEEDED_PLACE
    ]);
    const res = await request(app).get(`/api/places/${SEEDED_PLACE}/image`);
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
  });
});

describe('listing a place gallery', () => {
  test('returns rows in display order', async () => {
    await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('b'), 2);
    await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('a'), 1);

    const res = await request(app).get(`/api/places/${EMPTY_GALLERY_PLACE}/images`);

    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.image_url)).toEqual([CLOUDINARY('a'), CLOUDINARY('b')]);
  });

  test('a non-numeric id is a 400 with no SVG involved', async () => {
    // Different contract from the image route on purpose: this one returns JSON, so it can afford
    // to reject rather than degrade.
    const res = await request(app).get('/api/places/not-a-number/images');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid place id/i);
  });

  test('a place with no images is an empty list, not a 404', async () => {
    const res = await request(app).get(`/api/places/${EMPTY_GALLERY_PLACE}/images`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('deleting a gallery image', () => {
  test('an anonymous request is refused and the row survives', async () => {
    const imageId = await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('keep'));

    const res = await request(app).delete(
      `/api/admin/places/${EMPTY_GALLERY_PLACE}/images/${imageId}`
    );

    expect(res.status).toBe(401);
    expect((await request(app).get(`/api/places/${EMPTY_GALLERY_PLACE}/images`)).body).toHaveLength(
      1
    );
    expect(mockDestroyImage).not.toHaveBeenCalled();
  });

  test('a signed-in non-admin is refused', async () => {
    const imageId = await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('keep'));

    const res = await request(app)
      .delete(`/api/admin/places/${EMPTY_GALLERY_PLACE}/images/${imageId}`)
      .set(asUser);

    expect(res.status).toBe(403);
    expect(mockDestroyImage).not.toHaveBeenCalled();
  });

  test('an admin delete removes the row and returns 204', async () => {
    const imageId = await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('gone'));

    const res = await request(app)
      .delete(`/api/admin/places/${EMPTY_GALLERY_PLACE}/images/${imageId}`)
      .set(asAdmin);

    expect(res.status).toBe(204);
    expect((await request(app).get(`/api/places/${EMPTY_GALLERY_PLACE}/images`)).body).toEqual([]);
  });

  test('the remote asset is cleaned up using the id recovered from the stored URL', async () => {
    // This is the caller `publicIdFromUrl` exists for, and the two have to agree or the cleanup
    // deletes the wrong asset — or nothing, while the row disappears.
    const imageId = await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('gone'));

    await request(app)
      .delete(`/api/admin/places/${EMPTY_GALLERY_PLACE}/images/${imageId}`)
      .set(asAdmin);

    expect(mockDestroyImage).toHaveBeenCalledWith(PUBLIC_ID('gone'));
  });

  test('deleting through the wrong place is a 404 and removes nothing', async () => {
    // Same scoping property as the read path, and here it is destructive rather than merely
    // informational: without `AND place_id = $2` an admin could delete any image via any place.
    const foreign = await addImage(NO_PRIMARY_PLACE, CLOUDINARY('foreign'));

    const res = await request(app)
      .delete(`/api/admin/places/${EMPTY_GALLERY_PLACE}/images/${foreign}`)
      .set(asAdmin);

    expect(res.status).toBe(404);
    // The row is still there, under the place it actually belongs to.
    const survivors = (await request(app).get(`/api/places/${NO_PRIMARY_PLACE}/images`)).body;
    expect(survivors.map((r) => r.id)).toContain(foreign);
    expect(mockDestroyImage).not.toHaveBeenCalled();
  });

  test('a failed remote cleanup still deletes the row', async () => {
    // The row is the source of truth. A cleanup failure must not resurrect a deleted image.
    mockDestroyImage.mockResolvedValue(false);
    const imageId = await addImage(EMPTY_GALLERY_PLACE, CLOUDINARY('gone'));

    const res = await request(app)
      .delete(`/api/admin/places/${EMPTY_GALLERY_PLACE}/images/${imageId}`)
      .set(asAdmin);

    expect(res.status).toBe(204);
    expect((await request(app).get(`/api/places/${EMPTY_GALLERY_PLACE}/images`)).body).toEqual([]);
  });
});
