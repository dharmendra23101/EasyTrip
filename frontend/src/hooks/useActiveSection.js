import { useState, useEffect } from 'react';

/**
 * Which of the page's sections is currently in view, for highlighting the table of contents
 * (IMP-070).
 *
 * `sections` must be a stable reference. A fresh array literal each render tears down and
 * re-registers the observer on every render — which is why the caller holds it as a module
 * constant rather than building it inline.
 *
 * @param {Array<{id: String}>} sections
 * @param {Array} deps - extra triggers for re-observing, e.g. the flag that decides whether the
 *   observed elements are mounted at all
 * @returns {[String, Function]} the active section id and a setter, for the "View All" affordance
 */
export function useActiveSection(sections, deps = []) {
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? null);

  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '0px',
      threshold: 0.3
    };

    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          if (id) {
            setActiveSection(id);
          }
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => {
      sections.forEach((section) => {
        const element = document.getElementById(section.id);
        if (element) observer.unobserve(element);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, ...deps]);

  return [activeSection, setActiveSection];
}
