import { render, screen, act, waitFor } from '@testing-library/react';
import AuthProvider, { useAuth } from '../src/context/AuthContext';

/**
 * AuthContext (IMP-093, locking in the fix for BUG C1, defect 1).
 *
 * The bug: `places/[id].jsx` did `const { currentUser, isAuthenticated } = useAuth()` while the
 * provider's `value` object exposed `currentUser, loading, isAdmin, …` and **not
 * `isAuthenticated`**. So `isAuthenticated` was permanently `undefined`, and every guard written as
 * `if (!isAuthenticated) return toast.error('You must be logged in')` fired for users who were
 * logged in. It broke review submission and review reporting.
 *
 * That is a *contract* bug — a consumer destructuring a name the provider never published — and it
 * is invisible to a build, to a linter, and to any test that renders a page with a mocked context.
 * The only thing that catches it is asserting the real provider's real value object.
 */

// Firebase is a boundary, mocked exactly as far as the contract needs. `onIdTokenChanged` is
// captured so a test can drive the auth state directly rather than faking a login.
let idTokenListener = null;
jest.mock('firebase/auth', () => ({
  onIdTokenChanged: jest.fn((auth, cb) => {
    idTokenListener = cb;
    return () => {};
  }),
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  updateProfile: jest.fn(),
  signInWithPopup: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  getRedirectResult: jest.fn(() => Promise.resolve(null))
}));

jest.mock('../src/config/firebase', () => ({ auth: {}, default: {} }));

jest.mock('../src/services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ isAdmin: false })) }
}));

/** Renders the real provider and exposes whatever the context published. */
let seen = null;
const Probe = () => {
  seen = useAuth();
  return <div data-testid="ready">{String(seen.loading)}</div>;
};

const renderProvider = async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await screen.findByTestId('ready');
};

const signIn = async (user = { uid: 'u1', email: 'a@b.com', getIdToken: async () => 'tok' }) => {
  await act(async () => {
    await idTokenListener?.(user);
  });
};

beforeEach(() => {
  idTokenListener = null;
  seen = null;
});

describe('the published contract (BUG C1, defect 1)', () => {
  test('the provider exposes every name its consumers destructure', async () => {
    await renderProvider();

    // Derived from what pages and hooks actually pull out of `useAuth()`. A rename or removal here
    // does not fail a build — it silently yields `undefined`, which is exactly how C1 shipped.
    const consumed = [
      'currentUser',
      'isAuthenticated',
      'loading',
      'isAdmin',
      'register',
      'login',
      'logout',
      'updateProfile',
      'signInWithGoogle',
      'resetPassword',
      'getIdToken',
      'isClient'
    ];

    expect(Object.keys(seen).sort()).toEqual([...consumed].sort());
  });

  test('isAuthenticated is present and is a boolean, not undefined', async () => {
    await renderProvider();
    // The single assertion that would have caught C1.
    expect(seen).toHaveProperty('isAuthenticated');
    expect(typeof seen.isAuthenticated).toBe('boolean');
  });

  test('every published action is callable', async () => {
    await renderProvider();
    for (const name of [
      'register',
      'login',
      'logout',
      'updateProfile',
      'signInWithGoogle',
      'resetPassword',
      'getIdToken'
    ]) {
      expect(typeof seen[name]).toBe('function');
    }
  });
});

describe('isAuthenticated tracks the signed-in user', () => {
  test('false with no user', async () => {
    await renderProvider();
    await act(async () => {
      await idTokenListener?.(null);
    });
    expect(seen.isAuthenticated).toBe(false);
    expect(seen.currentUser).toBeNull();
  });

  test('true once a user arrives', async () => {
    await renderProvider();
    await signIn();
    await waitFor(() => expect(seen.isAuthenticated).toBe(true));
    expect(seen.currentUser).toMatchObject({ uid: 'u1' });
  });

  test('it is a coerced boolean, never the user object itself', async () => {
    // `isAuthenticated: currentUser` would satisfy every truthiness check in the app and still be
    // the wrong contract — consumers pass it to `aria-*` and serialise it.
    await renderProvider();
    await signIn();
    await waitFor(() => expect(seen.isAuthenticated).toBe(true));
    expect(seen.isAuthenticated).not.toBe(seen.currentUser);
  });

  test('signing out flips it back to false', async () => {
    await renderProvider();
    await signIn();
    await waitFor(() => expect(seen.isAuthenticated).toBe(true));

    await act(async () => {
      await idTokenListener?.(null);
    });
    expect(seen.isAuthenticated).toBe(false);
  });
});

describe('the loading gate', () => {
  test('resolves rather than hanging on the auth spinner forever', async () => {
    // `loading` stuck at true leaves the whole app behind a spinner; the provider has an explicit
    // timeout on the admin check for this reason.
    await renderProvider();
    await act(async () => {
      await idTokenListener?.(null);
    });
    await waitFor(() => expect(seen.loading).toBe(false));
  });
});

describe('the admin gate mirror cookie', () => {
  test('a signed-in user gets the et_id_token cookie the SSR admin gates read', async () => {
    // A Firebase ID token lives in JS memory, so without this mirror a document navigation to
    // /admin/* carries no credential at all and the getServerSideProps gate always denies.
    await renderProvider();
    await signIn();
    await waitFor(() => expect(document.cookie).toContain('et_id_token=tok'));
  });

  test('signing out clears it', async () => {
    await renderProvider();
    await signIn();
    await waitFor(() => expect(document.cookie).toContain('et_id_token=tok'));

    await act(async () => {
      await idTokenListener?.(null);
    });
    await waitFor(() => expect(document.cookie).not.toContain('et_id_token=tok'));
  });
});
