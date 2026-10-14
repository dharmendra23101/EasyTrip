const fs = require('fs');
const os = require('os');
const path = require('path');

// `mock`-prefixed so Jest's hoisted factory may close over it (see imageUpload.test.js).
const mockUpload = jest.fn();
jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload: (...args) => mockUpload(...args),
      destroy: jest.fn()
    },
    api: { delete_resources_by_prefix: jest.fn(), delete_folder: jest.fn() }
  }
}));

const { uploadImage } = require('../src/config/cloudinary');

/**
 * `uploadImage` — and the `finally` that `IMP-024` added.
 *
 * **Why this had no coverage.** Every suite that touches an upload mocks `../src/config/cloudinary`
 * wholesale, which is the right boundary for testing *callers* — `imageUpload.test.js` says so
 * explicitly: their SDK working is their test suite's job. The consequence is that this wrapper's
 * own logic never ran, and the wrapper is where a repaired defect lives.
 *
 * **The defect.** The temp-file cleanup used to sit after the upload resolved, so a **rejected**
 * upload skipped it and left the staged file in `backend/tmp/` forever. Its own comment records the
 * shape of that: *"Since every failed upload leaked, the directory grew without bound on exactly
 * the path that gets retried."* The fix was moving the unlink into a `finally` — one keyword, no
 * observable change on the happy path, and nothing has been holding it in place.
 *
 * The SDK is stubbed one layer down, at the `cloudinary` package, so the wrapper's real logic runs:
 * the existence check, the empty-file check, and the cleanup on both paths.
 */

let tmpDir;

const stagedFile = (contents = Buffer.alloc(64, 1)) => {
  const file = path.join(tmpDir, `upload-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(file, contents);
  return file;
};

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytrip-upload-'));
});
beforeEach(() => {
  mockUpload.mockReset();
  // The SDK takes a node-style callback; resolve it by default.
  mockUpload.mockImplementation((_file, _options, cb) =>
    cb(null, { secure_url: 'https://res.cloudinary.com/d/image/upload/v1/a.jpg', public_id: 'a' })
  );
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the staged file is always cleaned up (IMP-024)', () => {
  test('after a successful upload', async () => {
    const file = stagedFile();

    await uploadImage(file);

    expect(fs.existsSync(file)).toBe(false);
  });

  test('after a REJECTED upload — the regression IMP-024 fixed', async () => {
    // Before the `finally`, this file survived. Every retry staged another one, on exactly the
    // path a user retries.
    const file = stagedFile();
    mockUpload.mockImplementation((_f, _o, cb) => cb(new Error('cloudinary is down')));

    await expect(uploadImage(file)).rejects.toThrow(/cloudinary is down/);

    expect(fs.existsSync(file)).toBe(false);
  });

  test('after a rejection thrown before the upload is attempted', async () => {
    // The empty-file guard throws from inside the `try`, so the `finally` is the only thing that
    // removes the zero-byte file that caused it.
    const file = stagedFile(Buffer.alloc(0));

    await expect(uploadImage(file)).rejects.toThrow(/empty/i);

    expect(fs.existsSync(file)).toBe(false);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('what it refuses to send', () => {
  test('a path that does not exist is rejected without calling Cloudinary', async () => {
    await expect(uploadImage(path.join(tmpDir, 'no-such-file.png'))).rejects.toThrow(
      /does not exist/i
    );
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('an empty file is rejected rather than uploaded as a broken asset', async () => {
    await expect(uploadImage(stagedFile(Buffer.alloc(0)))).rejects.toThrow(/empty/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('what it returns', () => {
  test('the caller gets the delivery URL and the id, not the raw SDK response', async () => {
    // `placeController` reads `result.url` and `result.public_id`; Cloudinary's own field is
    // `secure_url`. The rename happens here, and a caller reading the wrong name gets undefined
    // stored in the database rather than an error.
    mockUpload.mockImplementation((_f, _o, cb) =>
      cb(null, {
        secure_url: 'https://res.cloudinary.com/d/image/upload/v1/x.jpg',
        public_id: 'easytrip/places/9/x',
        width: 1200,
        height: 800,
        format: 'jpg'
      })
    );

    await expect(uploadImage(stagedFile())).resolves.toEqual({
      url: 'https://res.cloudinary.com/d/image/upload/v1/x.jpg',
      public_id: 'easytrip/places/9/x',
      width: 1200,
      height: 800,
      format: 'jpg'
    });
  });

  test('the caller-supplied options reach the SDK, with the transformation applied', async () => {
    await uploadImage(stagedFile(), { folder: 'easytrip/places/9', public_id: 'p_9' });

    const [, options] = mockUpload.mock.calls[0];
    expect(options).toMatchObject({ folder: 'easytrip/places/9', public_id: 'p_9' });
    // Full-resolution originals must not reach a 400px card — the transform is not optional.
    expect(options.transformation).toEqual([
      { width: 1200, height: 800, crop: 'limit', quality: 'auto' }
    ]);
    expect(options.resource_type).toBe('image');
  });
});
