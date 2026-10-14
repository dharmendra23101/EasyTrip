import { useRouter } from 'next/router';
import { FiGlobe } from 'react-icons/fi';

import { LOCALES, LOCALE_NAMES, useTranslation } from '../i18n';

/**
 * The language control (`IMP-114`).
 *
 * **A `<select>`, not a styled dropdown.** Two options, and the native control already gives
 * keyboard operation, a touch-native picker on mobile, and a screen-reader role — all of which the
 * profile dropdown next to it had to be given by hand (`IMP-077`, `useDismissable`). Rebuilding
 * that for two items would be work spent re-earning what the platform provides.
 *
 * **It navigates rather than storing a preference.** The locale lives in the URL because Next's
 * routing puts it there, which means a Hindi page is a *shareable* Hindi page. A preference in
 * `localStorage` would render Hindi for one browser and English for the link it sends to somebody
 * else — and would need hydration care to avoid rendering the wrong language on the server.
 *
 * `router.asPath` preserves the current page and its query, so switching language on a filtered
 * browse page keeps the filters. `scroll: false` keeps the reader where they were: changing
 * language is not navigation to somewhere new.
 */
const LocaleSwitcher = ({ className = '' }) => {
  const router = useRouter();
  const { t, locale } = useTranslation();

  const change = (event) => {
    router.push(router.asPath, undefined, { locale: event.target.value, scroll: false });
  };

  return (
    <label className={`relative inline-flex items-center ${className}`}>
      {/* The icon is decoration; the label is what assistive technology reads. */}
      <FiGlobe className="pointer-events-none absolute left-2 h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{t('nav.language')}</span>
      <select
        value={locale}
        onChange={change}
        className="min-h-[44px] cursor-pointer rounded-lg border border-current/20 bg-transparent py-2 pl-8 pr-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {LOCALES.map((code) => (
          // `text-gray-900` on the option, not the select: an open native dropdown paints on the
          // system menu background, which is light in both themes, so inheriting the navbar's
          // white-on-dark text renders white text on white.
          <option key={code} value={code} className="text-gray-900">
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
};

export default LocaleSwitcher;
