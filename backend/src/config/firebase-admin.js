// `firebase-admin` v13 removed the old single-namespace export: `admin.auth()`,
// `admin.credential` and `admin.apps` no longer exist, and the package root now *is* the modular
// app API. So this file imports the functions it needs rather than a namespace object, and callers
// reach the Auth service through `getAuth()` from `firebase-admin/auth` rather than through an
// `admin` re-export from here.
const { initializeApp, getApp, getApps, cert } = require('firebase-admin/app');
const logger = require('../utils/logger');

// The single Firebase Admin initialization site for the server process.
// `getAuth()` throws unless `initializeApp()` has run in the same process,
// so app.js must require this module before mounting any route.

const REQUIRED_ENV_VARS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];

const failFast = (message, detail) => {
  logger.fatal(`Firebase Admin SDK: ${message}`);
  if (detail) {
    logger.fatal(`Firebase Admin SDK: ${detail}`);
  }
  logger.fatal('Firebase Admin SDK: refusing to start — every authenticated route would reject.');
  process.exit(1);
};

const initializeFirebaseAdmin = () => {
  if (getApps().length > 0) {
    return getApp();
  }

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    failFast(`missing required environment variable(s): ${missing.join(', ')}`);
  }

  try {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Service-account keys carried in env vars arrive with literal "\n" sequences.
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      }),
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    });

    logger.info('Firebase Admin SDK initialized');
    return app;
  } catch (error) {
    failFast('initialization failed', error.message);
  }
};

const firebaseAdmin = initializeFirebaseAdmin();

module.exports = { firebaseAdmin, initializeFirebaseAdmin };
