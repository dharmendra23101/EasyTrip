const request = require('supertest');

/**
 * Gallery image upload — the one write path with no coverage at all (`IMP-014` / `IMP-075` Step B).
 *
 * **Why this file exists now.** The framework upgrade preparation pass
 * (`docs/FRAMEWORK_UPGRADE_PLAN.md`) had to record that the `cloudinary` 1 → 2 major is the only
 * step whose success could not be demonstrated by running the suite: nothing here contained a
 * multipart request, an `.attach()`, or a stub for the Cloudinary client.
 *
 * **Correction (Sprint 6.14).** The paragraph above used to continue: *"and this endpoint passes a
 * user-supplied caption and filename into an upload"*. **Neither is true**, and `SECURITY_AUDIT`
 * §14 and `FRAMEWORK_UPGRADE_PLAN` Step B carried the same wrong claim. The caption reaches only a
 * parameterized `INSERT`; the filename multer writes is `fieldname-timestamp-random.ext`, with the
 * extension already vetted by `fileFilter`. Neither value is ever passed to the Cloudinary SDK.
 * The advisory — *"Arbitrary Argument Injection through parameters that include an ampersand"* — is
 * therefore **not reachable through this endpoint**, which is a claim worth holding still rather
 * than rediscovering, so `describe('nothing user-controlled reaches a Cloudinary parameter')`
 * below asserts it.
 *
 * **Where the boundary is.** Only `uploadImage` is mocked. Multer is real, so the multipart parse,
 * the disk staging, the extension/mimetype agreement check and the magic-byte content sniff all
 * execute for real against a real Postgres. What is faked is the network call to a third party —
 * the same boundary `AuthContext.test.jsx` draws around Firebase, and for the same reason: their
 * SDK working is their test suite's job, ours calling it correctly is this one's.
 */

// `mock`-prefixed so Jest's hoisted factory may close over it — the factory runs before
// module scope is initialised, and that prefix is the documented opt-out.
const mockUploadImage = jest.fn();
jest.mock('../src/config/cloudinary', () => ({
  cloudinary: { uploader: {} },
  uploadImage: (...args) => mockUploadImage(...args),
  destroyImage: jest.fn(async () => ({ result: 'ok' })),
  destroyPlaceAssets: jest.fn(async () => ({})),
  publicIdFromUrl: jest.fn(() => null)
}));

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

/**
 * Real file headers, because `inspectFileContents` reads the first 12 bytes and does not care what
 * the client claimed. A fixture of arbitrary bytes would be rejected before reaching the controller,
 * and the test would pass for the wrong reason.
 */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1)
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 1)]);

/** Place 2 (Coorg) has no gallery rows in the seed — place 1 does, so ordering starts dirty there. */
const EMPTY_GALLERY_PLACE = 2;

const upload = (
  placeId,
  { buffer = PNG, filename = 'shot.png', type = 'image/png', caption, headers = asAdmin } = {}
) => {
  let req = request(app).post(`/api/admin/places/${placeId}/images`).set(headers);
  if (caption !== undefined) req = req.field('caption', caption);
  return req.attach('image', buffer, { filename, contentType: type });
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockUploadImage.mockReset();
  mockUploadImage.mockResolvedValue({
    url: 'https://res.cloudinary.com/demo/image/upload/v1/easytrip/places/2/uploaded.png',
    public_id: 'easytrip/places/2/uploaded'
  });
});
afterAll(async () => {
  await closeDb();
});

const galleryOf = async (placeId) =>
  (
    await pool.query(
      'SELECT id, image_url, caption, display_order FROM place_images WHERE place_id = $1 ORDER BY display_order',
      [placeId]
    )
  ).rows;

describe('who may add a gallery image', () => {
  test('an anonymous request is refused', async () => {
    const res = await request(app)
      .post(`/api/admin/places/${EMPTY_GALLERY_PLACE}/images`)
      .attach('image', PNG, { filename: 'shot.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
    expect(await galleryOf(EMPTY_GALLERY_PLACE)).toHaveLength(0);
  });

  test('a signed-in non-admin is refused', async () => {
    const res = await upload(EMPTY_GALLERY_PLACE, { headers: asUser });
    expect(res.status).toBe(403);
    // The point of asserting the table too: a 403 that still wrote a row would be a worse bug than
    // a 200, and the status alone cannot tell the difference.
    expect(await galleryOf(EMPTY_GALLERY_PLACE)).toHaveLength(0);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });
});

describe('a successful upload', () => {
  test('stores the URL Cloudinary returned, not one the client supplied', async () => {
    const res = await upload(EMPTY_GALLERY_PLACE, { caption: 'Coffee country' });

    expect(res.status).toBe(201);
    const rows = await galleryOf(EMPTY_GALLERY_PLACE);
    expect(rows).toHaveLength(1);
    expect(rows[0].image_url).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1/easytrip/places/2/uploaded.png'
    );
    expect(rows[0].caption).toBe('Coffee country');
  });

  test('files the asset under the place, which is what makes cascade deletion work', async () => {
    await upload(EMPTY_GALLERY_PLACE);

    // `destroyPlaceAssets` removes a whole place's images by folder prefix rather than by tracking
    // individual public_ids, so the folder is load-bearing — an upload filed elsewhere would be
    // orphaned in Cloudinary forever when the place is deleted.
    expect(mockUploadImage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ folder: `easytrip/places/${EMPTY_GALLERY_PLACE}` })
    );
  });

  test('a blank caption is stored as NULL rather than an empty string', async () => {
    await upload(EMPTY_GALLERY_PLACE, { caption: '   ' });
    expect((await galleryOf(EMPTY_GALLERY_PLACE))[0].caption).toBeNull();
  });

  test('images queue in the order they arrive', async () => {
    await upload(EMPTY_GALLERY_PLACE, { caption: 'first' });
    await upload(EMPTY_GALLERY_PLACE, { caption: 'second' });

    // `COALESCE(MAX(display_order), -1) + 1` has a distinct branch for the very first row, where
    // MAX over no rows is NULL. Both branches run here, in order.
    const rows = await galleryOf(EMPTY_GALLERY_PLACE);
    expect(rows.map((r) => [r.caption, r.display_order])).toEqual([
      ['first', 0],
      ['second', 1]
    ]);
  });
});

describe('what is refused, and whether it costs an upload', () => {
  test('a request with no file attached is a 400', async () => {
    const res = await request(app)
      .post(`/api/admin/places/${EMPTY_GALLERY_PLACE}/images`)
      .set(asAdmin)
      .field('caption', 'no file here');
    expect(res.status).toBe(400);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  test('an unknown place is rejected BEFORE anything is uploaded', async () => {
    const res = await upload(999999);

    expect(res.status).toBe(404);
    // The ordering is the assertion. Uploading first and checking the place afterwards would leave
    // a paid-for asset in Cloudinary with no row referencing it and nothing to clean it up —
    // invisible from the app, and permanent.
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  test('an SVG is refused on its extension — it is script-capable markup', async () => {
    const res = await upload(EMPTY_GALLERY_PLACE, {
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      filename: 'payload.svg',
      type: 'image/svg+xml'
    });
    expect(res.status).toBe(400);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  test('contents are trusted over the claimed type', async () => {
    // A JPEG body wearing a .png name and an image/png content-type. Both client-supplied fields
    // agree with each other and both are wrong; only reading the magic bytes catches it.
    const res = await upload(EMPTY_GALLERY_PLACE, { buffer: JPEG, filename: 'shot.png' });

    expect(res.status).toBe(400);
    expect(res.body.errors?.[0]?.message ?? res.body.message).toMatch(/do not match|not a valid/i);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  test('a file that is not an image at all is refused', async () => {
    const res = await upload(EMPTY_GALLERY_PLACE, {
      buffer: Buffer.from('MZ\x90\x00 this is an executable, not a picture'),
      filename: 'trojan.png'
    });
    expect(res.status).toBe(400);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });
});

/**
 * The property that makes the `cloudinary` argument-injection advisory unreachable here.
 *
 * `cloudinary < 2.7.0` mis-handles a parameter value containing `&`: it can be read as a delimiter
 * and inject further parameters into the signed request. That is only exploitable if attacker text
 * reaches a parameter, so the question is not "which cloudinary version" but "what do we send".
 *
 * Today the answer is: nothing an attacker writes. Every option is a server literal, a validated
 * integer, `Date.now()`, a Firebase uid from `verifyIdToken`, or a place name run through
 * `encodeURIComponent`. **None of that is asserted anywhere**, which makes it an accident rather
 * than a property — deleting one `encodeURIComponent`, or adding `caption` to the options object
 * because it seems useful metadata, would silently make the advisory reachable and no test would
 * notice.
 *
 * These assertions read what the controller actually handed to `uploadImage`, so they describe the
 * boundary rather than the implementation behind it. They stay true and stay useful after the 1 → 2
 * upgrade, and they are what makes that upgrade a currency decision instead of a security one.
 */
describe('nothing user-controlled reaches a Cloudinary parameter', () => {
  /** Every string an attacker could hope to smuggle a delimiter through. */
  const HOSTILE = 'a&b=c&api_key=stolen&d|e%f"g\'h<i>j';

  const optionsFromLastUpload = () => {
    expect(mockUploadImage).toHaveBeenCalledTimes(1);
    return mockUploadImage.mock.calls[0][1];
  };

  /** Every leaf string in the options object, so nothing hides inside `tags`. */
  const leafValues = (options) =>
    Object.values(options)
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((v) => typeof v === 'string');

  test('a hostile caption never reaches the upload options at all', async () => {
    const res = await upload(EMPTY_GALLERY_PLACE, { caption: HOSTILE });
    expect(res.status).toBe(201);

    const options = optionsFromLastUpload();
    // Not "is it escaped" — it must not be there in any form, escaped or otherwise.
    expect(JSON.stringify(options)).not.toMatch(/stolen/);
    expect(JSON.stringify(options)).not.toMatch(/api_key/);
  });

  test('the hostile caption did reach the database, or the test above proves nothing', async () => {
    // The vacuity guard. If the caption were dropped entirely the assertion above would pass while
    // describing a feature that does not work.
    await upload(EMPTY_GALLERY_PLACE, { caption: HOSTILE });
    const [row] = await galleryOf(EMPTY_GALLERY_PLACE);
    expect(row.caption).toBe(HOSTILE);
  });

  test('no upload option carries a raw ampersand', async () => {
    await upload(EMPTY_GALLERY_PLACE, { caption: HOSTILE });

    for (const value of leafValues(optionsFromLastUpload())) {
      expect({ value, hasAmpersand: value.includes('&') }).toEqual({ value, hasAmpersand: false });
    }
  });

  test('a hostile filename never reaches the upload options', async () => {
    // multer rewrites the stored name to `fieldname-timestamp-random.ext`; `originalname` is only
    // consulted for its extension, which `fileFilter` has already vetted.
    await upload(EMPTY_GALLERY_PLACE, { filename: 'a&api_key=stolen&.png' });

    const options = optionsFromLastUpload();
    expect(JSON.stringify(options)).not.toMatch(/stolen/);
    // The staged path is argument 0, and it must not carry it either.
    expect(mockUploadImage.mock.calls[0][0]).not.toMatch(/stolen/);
  });

  test('every option value is built from server-controlled parts only', async () => {
    await upload(EMPTY_GALLERY_PLACE, { caption: HOSTILE });
    const options = optionsFromLastUpload();

    // Stated positively so the assertion says what the contract *is*, not just what it forbids.
    expect(options.folder).toBe(`easytrip/places/${EMPTY_GALLERY_PLACE}`);
    expect(options.public_id).toMatch(new RegExp(`^place_${EMPTY_GALLERY_PLACE}_gallery_[0-9]+$`));
    expect(options.tags).toEqual(['place', `id_${EMPTY_GALLERY_PLACE}`, 'gallery']);
    // uid comes from verifyIdToken, not the request body.
    expect(options.context).toBe(`place_id=${EMPTY_GALLERY_PLACE}|user=seed-admin-uid`);
  });
});

/**
 * The primary-image path, and the one free-text value that *does* reach Cloudinary.
 *
 * `placeController` builds `context: place_id=<id>|user=<uid>|name=<encodeURIComponent(name)>`. The
 * place name is admin-authored free text with a 200-character allowance and no character
 * restriction, so `encodeURIComponent` is the only thing standing between it and a Cloudinary
 * parameter — and until this suite, **nothing attached an image to place create or update at all**,
 * so that call had no coverage whatsoever.
 *
 * Asserted on the encoded *result* rather than on the call to `encodeURIComponent`, so switching to
 * any other correct escaping keeps these green while deleting the escaping does not.
 */
describe('the primary-image path encodes the one value that is free text', () => {
  const HOSTILE_NAME = 'Coorg & Co&api_key=stolen';

  const createPlace = (name) =>
    request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .field('name', name)
      .field('location', 'Karnataka')
      .attach('image', PNG, { filename: 'shot.png', contentType: 'image/png' });

  test('a place name containing an ampersand is percent-encoded before it is sent', async () => {
    const res = await createPlace(HOSTILE_NAME);
    expect(res.status).toBe(201);

    expect(mockUploadImage).toHaveBeenCalledTimes(1);
    const { context } = mockUploadImage.mock.calls[0][1];

    // `&` is the delimiter the advisory abuses. After encoding there must be none left, and the
    // encoded form must actually be present — otherwise the name was dropped rather than escaped.
    expect(context).not.toMatch(/&/);
    expect(context).toContain(encodeURIComponent(HOSTILE_NAME));
    expect(context).toMatch(/^place_id=\d+\|user=seed-admin-uid\|name=/);
  });

  test('the name was stored unescaped, so the encoding is for transport only', async () => {
    // The vacuity guard, and a real contract of its own: percent-encoding must not leak into what
    // the site displays. A place called "Coorg %26 Co" on the detail page would be a regression.
    await createPlace(HOSTILE_NAME);
    const { rows } = await pool.query('SELECT name FROM places ORDER BY id DESC LIMIT 1');
    expect(rows[0].name).toBe(HOSTILE_NAME);
  });
});
