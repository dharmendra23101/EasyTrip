import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FiArrowLeft, FiPrinter } from 'react-icons/fi';

import { useAuth } from '../../../context/AuthContext';
import tripService from '../../../services/tripService';
import LoadingSpinner from '../../../components/LoadingSpinner';
import PrintableItinerary from '../../../components/trips/PrintableItinerary';

/**
 * The printable itinerary (`FV-009` stage b) — *"the thing people genuinely carry"*.
 *
 * ---------------------------------------------------------------------------
 * Printed by the browser, not generated on the server
 * ---------------------------------------------------------------------------
 * Every browser prints to PDF, and `PE-010` records that a **server-side** PDF export would be "the
 * first operation that must outlive a request" — a background job queue with retries and a
 * dead-letter path, none of which exists yet. Building that to produce a document the browser can
 * already make would be a lot of infrastructure spent on a worse version of a solved problem.
 *
 * So this is a page, and `PE-010` stays unbuilt until something genuinely needs it. If a server-side
 * PDF is ever warranted — emailing an itinerary to somebody who is not signed in, say — this page is
 * the thing it would render, so nothing here is wasted.
 *
 * ---------------------------------------------------------------------------
 * Three requests, because they are three collections
 * ---------------------------------------------------------------------------
 * The workspace, the notes and the checklist are separate endpoints. The trip is fetched first,
 * because without it there is no document; the other two go together so the page waits once rather
 * than twice in series.
 *
 * **A failed notes or checklist fetch does not lose the itinerary.** The trip is the document; the
 * other two are sections of it. Printing an itinerary with no checklist is a smaller failure than
 * printing nothing, so those two are allowed to come back empty and the page says so rather than
 * silently omitting a packing list somebody expected to see.
 */
export default function PrintableTripPage() {
  const router = useRouter();
  const { id } = router.query;
  const { currentUser, loading: authLoading, getIdToken } = useAuth();

  const [trip, setTrip] = useState(null);
  const [notes, setNotes] = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;

    try {
      const token = await getIdToken();

      // The trip on its own first: without it there is no document, and its failure is the only one
      // that should stop the page.
      const loaded = await tripService.getTrip(id, token);
      setTrip(loaded);

      // `allSettled`, not `all`: one of these failing must not take the itinerary with it.
      const [noteResult, checklistResult] = await Promise.allSettled([
        tripService.listNotes(id, token),
        tripService.listChecklist(id, token)
      ]);

      if (noteResult.status === 'fulfilled') setNotes(noteResult.value);
      if (checklistResult.status === 'fulfilled') setChecklist(checklistResult.value);
      setPartial(noteResult.status === 'rejected' || checklistResult.status === 'rejected');
    } catch (loadError) {
      setError(loadError);
    } finally {
      setReady(true);
    }
  }, [id, getIdToken]);

  useEffect(() => {
    if (!authLoading && !currentUser) router.push('/login');
  }, [authLoading, currentUser, router]);

  useEffect(() => {
    if (currentUser) load();
  }, [currentUser, load]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  // A trip that is not yours and a trip that does not exist answer alike, by design — so this page
  // says the same thing for both rather than guessing which it was.
  if (error || !trip) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="text-gray-700">We could not find that trip.</p>
        <Link href="/trips" className="mt-4 inline-block text-primary-600 underline">
          Back to your trips
        </Link>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{`${trip.title} — itinerary`}</title>
        {/* Nothing here should ever be indexed: it is one person's trip. */}
        <meta name="robots" content="noindex" />
      </Head>

      {/* The only interactive part of the page, and it is `print:hidden` — a toolbar that printed
          itself would be the first thing wrong with the document it produced. */}
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-8 py-4 print:hidden">
        <Link
          href={`/trips/${trip.id}`}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <FiArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the trip
        </Link>

        {/* Not called on mount. A page that opens a print dialogue by itself takes the decision away
            from the reader, and gives somebody who only wanted to look at it a modal to dismiss. */}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white"
        >
          <FiPrinter className="h-4 w-4" aria-hidden="true" />
          Print
        </button>
      </div>

      {partial && (
        <p role="alert" className="mx-auto max-w-3xl px-8 pb-2 text-sm text-amber-700 print:hidden">
          Some of your notes or checklist could not be loaded, so this page may be missing them.
        </p>
      )}

      <PrintableItinerary trip={trip} notes={notes} checklist={checklist} />
    </>
  );
}
