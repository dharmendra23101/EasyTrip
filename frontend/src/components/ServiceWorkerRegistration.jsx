import { useEffect } from 'react';

/**
 * Registers the service worker (`IMP-115`, `ADR-038`).
 *
 * A component rather than a bare `useEffect` in `_app`, so the conditions under which it registers
 * live in one readable place — and so the whole thing can be removed by deleting one line if the
 * PWA is ever rolled back.
 */
export const ServiceWorkerRegistration = () => {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // **Production only, deliberately.** In development Next serves modules that change on every
    // edit, and a cache-first worker in front of them is how you spend twenty minutes debugging a
    // fix that did apply. The dev experience is also the one place a stale shell is guaranteed.
    if (process.env.NODE_ENV !== 'production') return;

    // After load rather than during it: registration competes with the resources the page needs to
    // render, and the worker has nothing to do on this visit anyway — it takes effect on the next.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        // Silent by design. A failed registration means no offline support, which is a degradation
        // of an enhancement — the app works exactly as it did before. Surfacing it would be an
        // error message about a feature the user never asked for.
        console.warn('Service worker registration failed:', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }

    return undefined;
  }, []);

  return null;
};

export default ServiceWorkerRegistration;
