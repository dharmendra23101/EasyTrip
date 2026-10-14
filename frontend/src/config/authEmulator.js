/**
 * Whether the browser's Firebase Auth SDK should talk to a local emulator (`TD-024`).
 *
 * **The gap this closes.** `e2e/global-setup.js` sets `FIREBASE_AUTH_EMULATOR_HOST`, which
 * **`firebase-admin` reads on the server** — so the API has always verified real emulator tokens on
 * its real code path (`ADR-028`). The **client** SDK was never pointed anywhere, so a browser could
 * not sign in at all, and every page behind `useAuth()` — the trip workspace, the profile, the
 * wishlist, the admin place form — had no end-to-end coverage. The authenticated specs that existed
 * worked around it by posting a token into the SSR gate's cookie, which proves the gate and nothing
 * past it.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate module from `firebase.js`
 * ---------------------------------------------------------------------------
 * `firebase.js` calls `initializeApp` at import time, so it cannot be imported by a unit test
 * without standing up the SDK. The **decision** — connect, or refuse, and why — is a pure function
 * of one string, and putting it here is what makes the refusals assertable. A security guard nobody
 * can test is a comment.
 *
 * ---------------------------------------------------------------------------
 * Why an explicit variable rather than `NODE_ENV`
 * ---------------------------------------------------------------------------
 * `NODE_ENV !== 'production'` would be shorter and wrong. The E2E suite runs `next dev`, but so does
 * every contributor working against their **real** Firebase project — and deriving the emulator from
 * the mode would redirect their sign-in to a port with nothing behind it. Emulator use is a fact
 * about the run, not about the build mode, so it is stated rather than inferred.
 *
 * The name mirrors the Admin SDK's own `FIREBASE_AUTH_EMULATOR_HOST`, and so does the format: a bare
 * `host:port`. Two variables spelling the same idea two ways is how one of them ends up set alone.
 *
 * ---------------------------------------------------------------------------
 * Why loopback-only, when the value is already build-time
 * ---------------------------------------------------------------------------
 * Every `NEXT_PUBLIC_*` value is inlined into the browser bundle, so anyone who can set this can
 * already produce whatever artefact they like — the standard "an attacker who can set build
 * variables already owns the build" argument, and it is true.
 *
 * It is also not the whole picture, which is why the check is here anyway. The realistic failure is
 * not an attacker; it is **a copied deployment configuration**, and the difference between the two
 * bad outcomes is large. Pointed at loopback in production, sign-in fails immediately and visibly on
 * the first attempt. Pointed at a *remote* host, sign-in appears to work while every credential the
 * form collects goes somewhere else. Refusing anything that is not loopback deletes the second
 * outcome for four lines, and it can be asserted.
 *
 * **What this deliberately does not claim.** It is not the security boundary. That is server-side:
 * the API verifies every token with the real `firebase-admin`, an emulator-minted token fails that
 * check, and `backend/src/config/env.js` refuses to boot with `FIREBASE_AUTH_EMULATOR_HOST` set
 * under `NODE_ENV=production` (Sprint 6.4). This variable can break a build's sign-in; it cannot let
 * anyone in. That asymmetry is the reason the change is safe to make at all.
 */

/**
 * The only hosts an emulator may live on.
 *
 * `::1` is stored unbracketed because that is what `URL.hostname` yields once the brackets a literal
 * IPv6 host must be written with are stripped.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Decide what to do with `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST`.
 *
 * Returns a reason rather than a bare `null` in every refusing case, because the caller logs it.
 * "Set, and ignored for a stated reason" and "not set" are different situations, and a developer
 * who typed the value deserves to learn which one they are in — a guard that silently declines is
 * indistinguishable from a guard that is not wired up, which is the failure `RouteSuggestion`'s
 * rendered declines exist to avoid one tier up.
 *
 * @param {string|undefined} raw - the variable's value, exactly as read
 * @returns {{connect: true, url: string}|{connect: false, reason: string, value?: string, hostname?: string}}
 */
export const resolveAuthEmulator = (raw) => {
  const value = String(raw ?? '').trim();

  if (value === '') return { connect: false, reason: 'not_configured' };

  // A scheme, a path or a userinfo section all mean this is not the `host:port` the Admin SDK's
  // variable takes, and guessing which half was meant is how `http://user@evil.test/` becomes a
  // hostname nobody inspected. `[::1]:9099` contains neither character, so IPv6 survives this.
  if (/[/@]/.test(value)) return { connect: false, reason: 'not_host_port', value };

  let hostname;
  try {
    // Parsed rather than split on ':' — a port is optional, and an IPv6 literal is all colons.
    hostname = new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return { connect: false, reason: 'not_host_port', value };
  }

  if (!LOOPBACK_HOSTNAMES.has(hostname))
    return { connect: false, reason: 'not_loopback', hostname };

  return { connect: true, url: `http://${value}` };
};

/** The sentence written to the console when a configured value was refused. Never the value. */
export const refusalMessage = (result) => {
  if (result.reason === 'not_loopback') {
    return (
      `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST names ${result.hostname}, which is not a loopback ` +
      'address. Ignoring it and using real Firebase Authentication. The Auth Emulator may only be ' +
      'reached at 127.0.0.1, localhost or ::1.'
    );
  }
  return (
    'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST is not a bare host:port (for example 127.0.0.1:9099). ' +
    'Ignoring it and using real Firebase Authentication.'
  );
};

export default resolveAuthEmulator;
