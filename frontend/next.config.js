/** @type {import('next').NextConfig} */

// Fail-fast environment validation (IMP-100). next.config.js is loaded by `dev`, `build`, `start`
// and `lint` alike, which makes it the only hook that runs before the app regardless of how it was
// started. A missing NEXT_PUBLIC_* is inlined into the bundle as `undefined` at build time, so it
// has to be caught here — after the build it is baked into the artifact.
//
// Only `next build` is fatal; every other command warns. See env.validation.js for why.
require('./env.validation').validateEnv();

// Browser-tier security headers (IMP-058). helmet covers the Express API; nothing
// covered the pages the browser actually loads, so the site was framable — a
// clickjacking route straight at the admin console (SECURITY_AUDIT 10.2).
//
// The CSP here deliberately declares `frame-ancestors` and nothing else. That is the
// one directive that cannot be set from a <meta> tag and the one the audit asked for,
// and a CSP carrying no fetch directives cannot break script, style or image loading.
// A full script-src/style-src policy needs a live build plus a click-through of
// Firebase auth, Google One Tap, the Maps embed, Leaflet tiles and Cloudinary, so it
// is left to a later hardening pass rather than guessed at here.
//
// frame-ancestors governs who may frame US; the Google Maps <iframe> on the place
// page is unaffected.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
];

const nextConfig = {
  // Next 16 builds with Turbopack by default, and Turbopack infers the workspace root by looking for
  // lockfiles. This repository has one at the root *and* one here, because it is a `concurrently`
  // monorepo rather than npm workspaces (`ADR-010`) — each package resolves its own dependencies on
  // purpose. Left to infer, Turbopack picks the repository root and traces output files from there,
  // which is the wrong tree for a deployment artifact. Stating it is a correctness fix, not a way to
  // silence the warning.
  turbopack: {
    root: __dirname
  },

  // Next 16 writes `AGENTS.md` and a `CLAUDE.md` pointing at it into this directory on every `dev`
  // run, and re-creates them if they are deleted. Off, for two reasons that are not about the
  // content.
  //
  // First, a `CLAUDE.md` is *loaded as project instructions*, and this one is authored by the
  // framework rather than by anyone who works on this repository — it would arrive in the tree
  // without passing through the review every other instruction here has. Second, it regenerates on
  // a command that is supposed to be read-only, so an untracked pair of files reappears in
  // `git status` after any `npm run dev` and after every E2E run, which is how a dirty tree stops
  // being informative.
  //
  // The guidance itself is reasonable and is not being disputed: `docs/FRAMEWORK_UPGRADE_PLAN.md`
  // §8 records it, and `node_modules/next/dist/docs/` is where it points either way.
  agentRules: false,

  reactStrictMode: true,
  // Locale routing, for zero dependencies (IMP-114). `en` is the default and therefore
  // unprefixed, so every existing URL is untouched; Hindi lives under /hi.
  //
  // `localeDetection: false` is the load-bearing setting and it is a product decision, not a
  // default. With detection on, a browser sending `Accept-Language: hi` is redirected into a
  // locale whose dictionary is deliberately partial — so the users most likely to be sent there
  // are the ones most likely to notice half a translation. The owner's decision was "English
  // default, Hindi optional", and optional means chosen, not detected.
  i18n: {
    locales: ['en', 'hi'],
    defaultLocale: 'en',
    localeDetection: false
  },
  // Stop advertising the framework and its version.
  poweredByHeader: false,
  // `unoptimized: true` disabled the optimizer globally, so every `next/image` in the codebase
  // did nothing at all — no resizing, no WebP/AVIF, no srcset — while still paying the component's
  // overhead (IMP-049). Removing it is what makes the three existing usages, and any migrated
  // `<img>`, actually optimize.
  images: {
    // `remotePatterns` rather than the deprecated `domains`: it constrains protocol and path, so
    // only Cloudinary delivery URLs are proxied. An over-broad allowlist turns the optimizer into
    // an open image proxy that anyone can point at arbitrary hosts.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**'
      }
    ],
    // Modern formats first; Next falls back to the original when the browser cannot accept them.
    formats: ['image/avif', 'image/webp'],
    // The widths actually used: cards render around 400px, the detail hero full-bleed. Trimming
    // the default ladder avoids generating variants nothing requests.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    // Optimized derivatives are immutable for their URL, so let the browser keep them.
    minimumCacheTTL: 60 * 60 * 24 * 30
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders
      }
    ];
  }
};

module.exports = nextConfig;
