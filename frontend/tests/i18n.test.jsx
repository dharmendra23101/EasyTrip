import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LocaleSwitcher from '../src/components/LocaleSwitcher';
import Footer from '../src/components/Footer';
import Document from '../src/pages/_document';
import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, translate, useTranslation } from '../src/i18n';
import { en, hi } from '../src/i18n/dictionaries';

/**
 * Locale scaffolding (`IMP-114`).
 *
 * **This feature's failure mode is not a crash, it is a shrug.** `ROADMAP.md` blocked the item for
 * two sprints on exactly that risk: *"scaffolding with no second locale ships a switcher that does
 * nothing"*. So the assertions that matter are not "the module exports a function" — they are
 * *the switcher changes something a reader can see*, and *nothing it cannot translate is left
 * blank*.
 *
 * The vocabulary's own integrity — every key resolved, no dead Hindi strings, the locale list the
 * same in three files — is `scripts/check-i18n.mjs`, which runs in CI and on a laptop without a
 * test run. That split is deliberate and the same one `IMP-128` made: a guard that needs the suite
 * to run is a guard nobody runs while editing the thing it guards.
 */

const mockPush = jest.fn();
let mockLocale = 'en';

jest.mock('next/router', () => ({
  useRouter: () => ({
    locale: mockLocale,
    asPath: '/browse?theme=beach',
    pathname: '/browse',
    push: mockPush
  })
}));

jest.mock('../src/services/newsletterService', () => ({
  subscribeToNewsletter: jest.fn()
}));

beforeEach(() => {
  mockPush.mockClear();
  mockLocale = 'en';
});

describe('the lookup never renders nothing', () => {
  test('every English key resolves to real text in every locale', () => {
    // The invariant the whole design rests on: `hi` is *allowed* to be a subset, so a missing
    // string has to fall through to English rather than leaving a hole in the navbar. Asserting it
    // across the entire vocabulary — rather than on one hand-picked key — is what keeps it true as
    // the dictionary grows.
    for (const locale of LOCALES) {
      for (const key of Object.keys(en)) {
        const value = translate(locale, key);
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
        // Rendering the key itself is the last-resort branch, and no shipped key may reach it.
        expect(value).not.toBe(key);
      }
    }
  });

  test('a locale nobody defined falls back to English rather than failing', () => {
    expect(translate('fr', 'nav.home')).toBe(en['nav.home']);
    expect(translate(undefined, 'nav.home')).toBe(en['nav.home']);
  });

  test('an unknown key renders the key, because visibly wrong is what gets fixed', () => {
    // A blank vanishes into the layout and ships. `check-i18n.mjs` makes this unreachable in real
    // code by resolving every call site, so this asserts the behaviour of the safety net, not of
    // anything a user should ever see.
    expect(translate('en', 'nav.doesNotExist')).toBe('nav.doesNotExist');
  });

  test('Hindi is genuinely different text, not English wearing a locale code', () => {
    // The check that catches a dictionary copy-pasted and never translated — which would satisfy
    // every count-based assertion above it.
    const differing = Object.keys(hi).filter((key) => hi[key] !== en[key]);
    expect(differing.length).toBe(Object.keys(hi).length);
    expect(hi['nav.trips']).toMatch(/[ऀ-ॿ]/);
  });
});

describe('the hook', () => {
  const Probe = () => {
    const { t, locale } = useTranslation();
    return (
      <span>
        {locale}:{t('nav.home')}
      </span>
    );
  };

  test('follows the router locale', () => {
    mockLocale = 'hi';
    render(<Probe />);
    expect(screen.getByText(`hi:${hi['nav.home']}`)).toBeInTheDocument();
  });

  test('defaults to English when there is no locale, rather than throwing', () => {
    // A component rendered in isolation has no router. That must be a default, not a crash, or
    // every future component test has to mock routing to render a label.
    mockLocale = undefined;
    render(<Probe />);
    expect(screen.getByText(`${DEFAULT_LOCALE}:${en['nav.home']}`)).toBeInTheDocument();
  });
});

describe('the switcher does something', () => {
  test('every routable locale is offered, named in its own language', () => {
    // An endonym, not a translation: "Hindi" is no use to somebody who cannot read English, which
    // is the entire population this control exists for.
    render(<LocaleSwitcher />);

    for (const code of LOCALES) {
      expect(screen.getByRole('option', { name: LOCALE_NAMES[code] })).toBeInTheDocument();
    }
    expect(screen.getByRole('option', { name: 'हिन्दी' })).toBeInTheDocument();
  });

  test('choosing a language navigates to the same page in that locale', async () => {
    render(<LocaleSwitcher />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'hi');

    // `asPath`, not `pathname`: switching language on a filtered page has to keep the filters, or
    // the control silently discards the user's work as the price of reading it in Hindi.
    expect(mockPush).toHaveBeenCalledWith('/browse?theme=beach', undefined, {
      locale: 'hi',
      scroll: false
    });
  });

  test('it is labelled for assistive technology, not just decorated with a globe', () => {
    render(<LocaleSwitcher />);
    expect(screen.getByRole('combobox', { name: /language|भाषा/i })).toBeInTheDocument();
  });
});

describe('a real page in Hindi', () => {
  test('the footer renders its own headings translated', () => {
    mockLocale = 'hi';
    render(<Footer />);

    expect(screen.getByText(hi['footer.quickLinks'])).toBeInTheDocument();
    expect(screen.getByText(hi['footer.popularDestinations'])).toBeInTheDocument();
    expect(screen.queryByText(en['footer.quickLinks'])).not.toBeInTheDocument();
  });

  test('but destination names stay as they are, because the links search for them', () => {
    // `?location=Agra` matches an English value in the database. A translated label on that link
    // would look like polish and behave like a bug — the boundary between chrome and catalogue,
    // asserted rather than left to a comment.
    mockLocale = 'hi';
    render(<Footer />);

    // The accessible name carries the decorative chevron the markup prepends, so match the word
    // rather than the whole string.
    const agra = screen.getByRole('link', { name: /Agra/ });
    expect(agra).toHaveAttribute('href', '/browse?location=Agra');
    // And the quick links beside it *are* translated — the two lists differ on purpose.
    expect(
      screen.getByRole('link', { name: new RegExp(hi['footer.aboutUs']) })
    ).toBeInTheDocument();
  });
});

describe('the served document declares the language it is actually in', () => {
  // Not rendered: `Document` returns a tree of Next's own `Html`/`Head`/`Main`, which need the
  // framework's context to render but not to be *called*. Inspecting the returned element's props
  // is the cheapest honest way to assert an attribute that only exists in the served HTML.
  const langOf = (locale) => Document({ __NEXT_DATA__: { locale } }).props.lang;

  test('a Hindi page is announced as Hindi', () => {
    // A screen reader believes `lang`. Announcing Devanagari as English applies English phonetics
    // to it, which is a worse outcome than not translating at all — the accessibility half of the
    // same Article III argument that gates the copy itself.
    expect(langOf('hi')).toBe('hi');
  });

  test('and English stays English, including when nothing said so', () => {
    expect(langOf('en')).toBe('en');
    expect(langOf(undefined)).toBe('en');
    expect(Document({}).props.lang).toBe('en');
  });
});
