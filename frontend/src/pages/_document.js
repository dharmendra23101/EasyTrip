import { Html, Head, Main, NextScript } from 'next/document';

export default function Document(props) {
  // The served `lang` must be the served locale (IMP-114). It was hardcoded to "en", which a
  // screen reader believes: a Hindi page announced as English is read with English phonetics,
  // which is worse than no translation. Next puts the resolved locale on `__NEXT_DATA__`, so this
  // follows the routing rather than duplicating the decision.
  const locale = props?.__NEXT_DATA__?.locale || 'en';

  return (
    <Html lang={locale}>
      {/* Fonts are no longer requested here. `next/font` in `_app.jsx` self-hosts Inter and
          Playfair Display from the build output (IMP-041), which removes the render-blocking
          stylesheet request to fonts.googleapis.com, the two preconnects it needed, and the
          second hop to fonts.gstatic.com for the font files themselves. */}
      <Head />
      <body className="antialiased">
        {/* IMP-123 — the server-rendered content, for a client that will not run the script that
            reveals it.

            IMP-040 moved the home page and /places/[id] to getStaticProps + ISR and /browse to
            getServerSideProps so their content would be in the HTML. It is in the HTML, and then
            hidden by it: Framer Motion serialises every `motion.*` element's `initial` prop into
            the server render as an inline `opacity: 0`, and only animates to 1 once
            requestAnimationFrame runs on the client. 89 such props across 32 components. A reader
            with scripting off gets a complete document painted at zero opacity.

            This restores them and nothing else. With JavaScript on, the block is inert and every
            entrance animation runs exactly as before — which is deliberate: the animation is a
            product decision (IMP-082 already handles `prefers-reduced-motion`), and a fix that
            quietly removed it would be trading one defect for a different one.

            `transform` is reset with it because `initial={{ opacity: 0, y: 20 }}` also serialises a
            `translateY`, so revealing the element without it leaves the article 20px out of place
            with nothing to animate it back.

            Inline rather than a stylesheet link: a client degraded enough to have scripting off may
            not fetch a second resource either, and a rule that arrives after the paint is a rule
            that did not help. */}
        <noscript>
          <style
            dangerouslySetInnerHTML={{
              __html:
                '[style*="opacity:0"],[style*="opacity: 0"]{opacity:1 !important;transform:none !important}'
            }}
          />
        </noscript>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
