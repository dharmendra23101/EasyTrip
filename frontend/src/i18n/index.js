import { useRouter } from 'next/router';

import { dictionaries, en } from './dictionaries';

/**
 * String lookup, with no dependencies (`IMP-114`).
 *
 * ---------------------------------------------------------------------------
 * Why there is no i18n library here
 * ---------------------------------------------------------------------------
 * `ROADMAP.md` raised this as an owner decision and recorded the recommendation this file
 * implements: **Next's own `i18n` config gives locale-prefixed routing and detection for zero
 * dependencies**, and a plain dictionary covers lookup. `next-i18next` is three packages
 * (`next-i18next`, `i18next`, `react-i18next`) in a project that spent `IMP-068` pruning fifteen
 * and is still repaying `IMP-119`'s advisory backlog.
 *
 * `next-i18next` earns its cost when there are **namespaces, plurals, interpolation and
 * server-side translation loading** — that is, once there is real translated content to manage.
 * There are twenty strings. Adopting a framework for twenty strings is `SESSION_PROTOCOL.md`
 * §11.5 exactly: the technology arriving before the problem.
 *
 * **The migration path is deliberately short**, because that is what makes deferring safe: every
 * component calls `t('some.key')` and nothing else. Swapping the implementation of `t` is the whole
 * change if plurals ever arrive.
 *
 * ---------------------------------------------------------------------------
 * The one invariant
 * ---------------------------------------------------------------------------
 * **A missing translation renders English, never a blank and never a raw key.** `hi` is a subset of
 * `en` by design, so this is the normal path rather than an error path — which is precisely why it
 * is the thing under test rather than a comment.
 */

/** The locales the app routes for. Must match `next.config.js`; `check-i18n.mjs` asserts it does. */
export const LOCALES = ['en', 'hi'];

export const DEFAULT_LOCALE = 'en';

/** Endonyms — a language is listed in its own language, or the switcher is useless to its reader. */
export const LOCALE_NAMES = { en: 'English', hi: 'हिन्दी' };

/**
 * `('hi', 'nav.home')` -> `'होम'`. Pure, so the fallback ladder can be proved without a router.
 *
 * Three rungs, and the last one is deliberate: an unknown key returns **the key itself**. A blank
 * would vanish silently into the layout and a raw key is visibly wrong, and visibly wrong is the
 * behaviour that gets fixed. `check-i18n.mjs` makes it unreachable in shipped code by asserting
 * every `t(...)` call site resolves in `en`.
 */
export const translate = (locale, key) => dictionaries[locale]?.[key] ?? en[key] ?? key;

/**
 * The hook components use.
 *
 * `useRouter()` is the locale source because Next's built-in routing is what sets it — there is no
 * second source of truth to keep in sync. Outside a router (a unit test rendering a component in
 * isolation) it is absent, and the default locale is the right answer there rather than a crash.
 */
export const useTranslation = () => {
  const router = useRouter();
  const locale = router?.locale || DEFAULT_LOCALE;

  return {
    locale,
    t: (key) => translate(locale, key)
  };
};
