/**
 * The strings, in one place per locale (`IMP-114`).
 *
 * ---------------------------------------------------------------------------
 * What is translated, and what deliberately is not
 * ---------------------------------------------------------------------------
 * **The chrome is translated. The catalogue is not.** Navigation, controls and the words EasyTrip
 * itself writes live here. Place names, descriptions, reviews and "Best Time to Visit" are rows in
 * PostgreSQL, written in English, and no amount of front-end scaffolding translates them.
 *
 * `KNOWN_LIMITATIONS.md` said this before any of it was built — *"the constraint is content, not
 * code"* — and it is still the honest description. A Hindi reader gets Hindi navigation around
 * English place data. That is a real, stated boundary rather than a bug, and pretending otherwise
 * would need a translated catalogue that does not exist.
 *
 * **Proper nouns stay as they are.** The footer's destination links carry `?location=Agra`, which
 * matches an English value in the database. Translating the label while the query stays English
 * would put a Hindi word on a link that searches for an English one — a mismatch that looks like
 * polish and behaves like a bug.
 *
 * ---------------------------------------------------------------------------
 * `hi` is deliberately allowed to be a subset of `en`
 * ---------------------------------------------------------------------------
 * A missing Hindi string falls back to English (see `translate`), so a partial dictionary renders a
 * partly-English page rather than a blank or a raw key. That is the whole reason this ships before
 * a full translation exists: the alternative recorded in `ROADMAP.md` was *"a switcher that does
 * nothing"*, and the alternative to **that** was machine-translating the entire UI with no fluent
 * reviewer — which `PROJECT_CONSTITUTION.md` Article III rates worse than English-only.
 *
 * ⚠️ **The Hindi below has not been reviewed by a fluent speaker.** It is standard Devanagari UI
 * vocabulary of the kind Indian consumer apps use, chosen for exactly that reason — but "standard"
 * is a claim about convention, not a review. `KNOWN_LIMITATIONS.md` records it as needing one.
 */

/**
 * English is the source of truth. Every key any component asks for must exist here, and
 * `scripts/check-i18n.mjs` fails the build if one does not.
 */
export const en = {
  'nav.home': 'Home',
  'nav.browse': 'Browse',
  'nav.profile': 'My Profile',
  'nav.saved': 'Saved Places',
  'nav.trips': 'My Trips',
  'nav.admin': 'Admin Dashboard',
  'nav.signOut': 'Sign out',
  'nav.login': 'Login',
  'nav.signUp': 'Sign Up',
  'nav.signedInAs': 'Signed in as',
  'nav.openMenu': 'Open main menu',
  'nav.language': 'Language',

  'footer.quickLinks': 'Quick Links',
  'footer.popularDestinations': 'Popular Destinations',
  'footer.home': 'Home',
  'footer.destinations': 'Destinations',
  'footer.aboutUs': 'About Us'
};

/**
 * Hindi. A subset by design — see the header.
 *
 * Where a term is genuinely used in English by Hindi speakers in this context (log in, admin), the
 * Devanagari transliteration is used rather than a literal translation nobody says out loud. That
 * is a judgement, and it is the kind of judgement a fluent reviewer should overrule freely.
 */
export const hi = {
  'nav.home': 'होम',
  'nav.browse': 'ब्राउज़ करें',
  'nav.profile': 'मेरी प्रोफ़ाइल',
  'nav.saved': 'सहेजे गए स्थान',
  'nav.trips': 'मेरी यात्राएँ',
  'nav.admin': 'एडमिन डैशबोर्ड',
  'nav.signOut': 'साइन आउट',
  'nav.login': 'लॉग इन',
  'nav.signUp': 'साइन अप',
  'nav.signedInAs': 'साइन इन:',
  'nav.openMenu': 'मुख्य मेन्यू खोलें',
  'nav.language': 'भाषा',

  'footer.quickLinks': 'त्वरित लिंक',
  'footer.popularDestinations': 'लोकप्रिय गंतव्य',
  'footer.home': 'होम',
  'footer.destinations': 'गंतव्य',
  'footer.aboutUs': 'हमारे बारे में'
};

export const dictionaries = { en, hi };
