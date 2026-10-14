import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { refusalMessage, resolveAuthEmulator } from './authEmulator';

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase - handle SSR (no window) and prevent multiple initializations
let firebaseApp;

if (typeof window !== 'undefined' && !getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

// Initialize Firebase Authentication and get a reference to the service
const auth = getAuth(firebaseApp);
const storage = getStorage(firebaseApp);

/**
 * Point sign-in at a local Auth Emulator when a test run asks for one (`TD-024`).
 *
 * `authEmulator.js` carries the reasoning, including why this cannot let anyone in. Two details are
 * here because they are about this call rather than about the decision:
 *
 * **`disableWarnings: true`** suppresses the SDK's fixed-position "running on the emulator" banner.
 * It is a useful signal and a terrible one to leave in a browser suite — it overlays the bottom of
 * every page and intercepts clicks aimed at whatever is under it. The signal is kept as the
 * `console.warn` below, which no test can accidentally click.
 *
 * **The refusal is logged, not swallowed.** A value that was typed and then ignored is exactly the
 * case where silence costs an hour.
 */
const emulator = resolveAuthEmulator(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST);

if (emulator.connect) {
  connectAuthEmulator(auth, emulator.url, { disableWarnings: true });
  console.warn(
    `Firebase Authentication is using the emulator at ${emulator.url}. ` +
      'No real account is involved, and no token from it is accepted by a production API.'
  );
} else if (emulator.reason !== 'not_configured') {
  console.error(refusalMessage(emulator));
}

export { auth, storage, firebaseApp };
