import Head from 'next/head';
import Link from 'next/link';

import tripService from '../../services/tripService';
import PrintableItinerary from '../../components/trips/PrintableItinerary';

/**
 * A shared trip, read by somebody who is not signed in (`FV-009` stage c).
 *
 * ---------------------------------------------------------------------------
 * Server-rendered per request, and never cached
 * ---------------------------------------------------------------------------
 * `getServerSideProps` rather than `getStaticProps`, and this is the one decision on the page that
 * matters. An ISR-cached shared trip would keep serving after the link was revoked — the cache would
 * hold the last good render and hand it to the next person with the URL. **Revocation that takes
 * effect everywhere is the entire point of the token living on the trip**, and a cache in front of
 * it would quietly undo that.
 *
 * The API sets `Cache-Control: private, no-store` for the same reason; this page sets it too,
 * because the HTML is as sensitive as the JSON that produced it.
 *
 * ---------------------------------------------------------------------------
 * `noindex`, in the page and in the header
 * ---------------------------------------------------------------------------
 * These are somebody's holiday plans. They must not appear in a search result because one recipient
 * used a browser that submits URLs. The meta tag covers a crawler that renders the page; the API's
 * `X-Robots-Tag` covers the JSON being fetched directly.
 *
 * ---------------------------------------------------------------------------
 * It reuses the printable itinerary, which is not a coincidence
 * ---------------------------------------------------------------------------
 * `PrintableItinerary` was built to render a trip with **no controls of any kind** — no buttons, no
 * links, no form fields — because a document is not an application. A read-only view for somebody
 * who cannot edit anything wants exactly that, and reusing it means a control added to the workspace
 * can never accidentally appear here.
 *
 * The notes and checklist props are deliberately not passed. The API does not send them, and passing
 * nothing is what makes that visible at the call site rather than something a reader has to go and
 * check the server for.
 */
export default function SharedTripPage({ trip }) {
  if (!trip) {
    return (
      <>
        <Head>
          <title>Link not valid</title>
          <meta name="robots" content="noindex, nofollow" />
        </Head>
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <h1 className="text-xl font-semibold text-gray-900">This link is not valid</h1>
          {/* Deliberately one message for three cases — revoked, mistyped, never existed. Telling
              them apart would say whether a token was ever real, which is information about
              somebody else's trip. */}
          <p className="mt-2 text-gray-600">
            It may have been turned off by whoever shared it, or copied incompletely.
          </p>
          <Link href="/" className="mt-6 inline-block text-primary-600 underline">
            Go to EasyTrip
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{`${trip.title} — shared itinerary`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="mx-auto max-w-3xl px-8 pt-6 print:hidden">
        <p className="text-sm text-gray-500">
          Shared with you, read-only. You are not signed in and cannot change anything here.
        </p>
      </div>

      <PrintableItinerary trip={trip} />
    </>
  );
}

export async function getServerSideProps({ params, res }) {
  // Belt and braces with the API's own header: this is the HTML, and a proxy caching it would serve
  // a revoked trip just as effectively as a cached API response would.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  try {
    const trip = await tripService.getSharedTrip(params.token);
    // `?? null`, because `undefined` is not serialisable by Next and would throw at render time
    // rather than showing the "not valid" page this component already has.
    return { props: { trip: trip ?? null } };
  } catch {
    // Every failure is the same page. A 404 and a 500 look alike to the reader on purpose: neither
    // should say whether the token was ever real.
    return { props: { trip: null } };
  }
}
