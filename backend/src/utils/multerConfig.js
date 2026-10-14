const fs = require('fs');
const path = require('path');
const multer = require('multer');
const logger = require('./logger');

// Uploads are staged on disk and then streamed to Cloudinary by the controllers,
// which read `req.file.path` — this must resolve to the same directory that
// config/cloudinary.js uses so the two halves of the pipeline agree.
const tmpDir = path.join(__dirname, '../../tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILE_COUNT = 5;

// Extension -> mimetypes accepted for that extension. SVG is deliberately absent:
// it is script-capable markup and would be a stored-XSS vector once served back.
const ALLOWED_TYPES = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp']
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The client-supplied mimetype is trivially forged, so the real type is derived
// from the file header instead.
const SIGNATURES = [
  {
    mimetype: 'image/jpeg',
    matches: (header) =>
      header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
  },
  {
    mimetype: 'image/png',
    matches: (header) => header.length >= 8 && header.subarray(0, 8).equals(PNG_SIGNATURE)
  },
  {
    mimetype: 'image/webp',
    matches: (header) =>
      header.length >= 12 &&
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP'
  }
];

const HEADER_BYTES = 12;

const allowedExtensions = Object.keys(ALLOWED_TYPES).join(', ');

class UploadRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadRejectedError';
    this.status = 400;
  }
}

const extensionOf = (filename) => path.extname(filename || '').toLowerCase();

const fileFilter = (req, file, cb) => {
  const extension = extensionOf(file.originalname);
  const allowedMimetypes = ALLOWED_TYPES[extension];

  if (!allowedMimetypes) {
    return cb(
      new UploadRejectedError(
        `Unsupported file extension "${extension || 'none'}". Allowed: ${allowedExtensions}`
      )
    );
  }

  if (!allowedMimetypes.includes((file.mimetype || '').toLowerCase())) {
    return cb(
      new UploadRejectedError(
        `Content type "${file.mimetype || 'none'}" does not match extension "${extension}"`
      )
    );
  }

  cb(null, true);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // fileFilter has already vetted the extension, so nothing attacker-controlled
    // from originalname reaches the filesystem.
    cb(null, file.fieldname + '-' + uniqueSuffix + extensionOf(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILE_COUNT
  }
});

const readHeader = (filePath) => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
};

// Returns an error message when the bytes on disk are not one of the allowed
// image formats, or contradict the extension the file was stored under.
const inspectFileContents = (file) => {
  let header;
  try {
    header = readHeader(file.path);
  } catch (error) {
    logger.error({ err: error }, 'Could not read uploaded file header');
    return 'Uploaded file could not be read';
  }

  const signature = SIGNATURES.find((candidate) => candidate.matches(header));

  if (!signature) {
    return 'File contents are not a valid JPEG, PNG or WebP image';
  }

  const extension = extensionOf(file.path);
  if (!(ALLOWED_TYPES[extension] || []).includes(signature.mimetype)) {
    return `File contents (${signature.mimetype}) do not match the "${extension}" extension`;
  }

  return null;
};

const uploadedFiles = (req) => {
  if (req.file) {
    return [req.file];
  }
  if (Array.isArray(req.files)) {
    return req.files;
  }
  if (req.files && typeof req.files === 'object') {
    return Object.values(req.files).reduce((all, group) => all.concat(group), []);
  }
  return [];
};

const removeTempFile = (filePath) => {
  if (!filePath) {
    return;
  }
  fs.promises.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') {
      logger.warn({ err: error }, 'Could not remove temporary upload');
    }
  });
};

const cleanupUploads = (req) => {
  uploadedFiles(req).forEach((file) => removeTempFile(file.path));
};

// Staged files must not outlive the response, whichever way it ends: the
// controller may have already consumed and unlinked them (unlink then no-ops),
// or the request may have failed validation before anyone looked at them.
const scheduleCleanup = (req, res) => {
  let cleaned = false;
  const run = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    cleanupUploads(req);
  };

  res.on('finish', run);
  res.on('close', run);
};

const uploadErrorMessage = (error) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return `File is too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`;
      case 'LIMIT_FILE_COUNT':
        return `Too many files. Maximum is ${MAX_FILE_COUNT}`;
      case 'LIMIT_UNEXPECTED_FILE':
        return `Unexpected file field "${error.field}"`;
      default:
        return error.message;
    }
  }
  return error.message || 'Upload failed';
};

const rejectUpload = (res, field, message) =>
  res.status(400).json({
    message: 'Invalid file upload',
    errors: [{ field, message }]
  });

// Configurable middleware supporting both single and multiple file uploads.
const uploadMiddleware = (fieldName, multiple = false) => {
  const parse = multiple ? upload.array(fieldName, MAX_FILE_COUNT) : upload.single(fieldName);

  return (req, res, next) => {
    parse(req, res, (error) => {
      scheduleCleanup(req, res);

      if (error) {
        cleanupUploads(req);
        return rejectUpload(res, error.field || fieldName, uploadErrorMessage(error));
      }

      const files = uploadedFiles(req);
      for (const file of files) {
        const problem = inspectFileContents(file);
        if (problem) {
          cleanupUploads(req);
          return rejectUpload(res, file.fieldname || fieldName, problem);
        }
      }

      next();
    });
  };
};

module.exports = {
  uploadMiddleware,
  cleanupUploads
};
