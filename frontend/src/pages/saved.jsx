import { useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FiHeart, FiCompass, FiAlertCircle } from 'react-icons/fi';

import { useAuth } from '../context/AuthContext';
import RecommendedForYou from '../components/RecommendedForYou';
import { useWishlist } from '../hooks/useWishlist';
import PlaceCard from '../components/PlaceCard';
import LoadingSpinner from '../components/LoadingSpinner';

/**
 * "Saved places" — the view half of `IMP-108`.
 *
 * The API already returned the full card payload; without this page a user could save places and
 * had nowhere to see them, which is a wishlist that only ever writes. Phase 7's own success metric
 * is *"no feature shipped without an empty, loading, and error state"*, and a feature with no view
 * has nowhere to put any of the three.
 *
 * **Signed out, this page redirects rather than showing the localStorage list.** The heart still
 * works signed out — those marks are on the device and are imported on sign-in — but rendering them
 * as a saved-places *page* would promise durability the local copy does not have. The list you can
 * open and return to is the one the server holds.
 */
export default function SavedPlaces() {
  const { currentUser, loading: authLoading, getIdToken } = useAuth();
  const { places, loading, error, refresh, ready } = useWishlist();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push('/login');
    }
  }, [authLoading, currentUser, router]);

  const showSpinner = authLoading || !ready || (loading && places.length === 0);

  return (
    <>
      <Head>
        <title>Saved places · EasyTrip</title>
        {/* A personal list is nobody else's business and has nothing to index. */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="bg-gray-50 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <header className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-900 flex items-center">
              <FiHeart className="mr-3 h-8 w-8 text-red-500" aria-hidden="true" />
              Saved places
            </h1>
            <p className="mt-2 text-gray-600">
              Everything you have saved, newest first. Tap the heart on any place to add it here.
            </p>
          </header>

          {showSpinner && (
            <div className="py-20 flex justify-center">
              <LoadingSpinner />
            </div>
          )}

          {/*
            Failed-to-load and genuinely-empty are rendered as different things, deliberately. Showing
            "nothing saved yet" after a failed request tells the user their data is gone, which is
            the conflation `IMP-031` exists to prevent — and it is the more alarming of the two
            messages to get wrong.
          */}
          {!showSpinner && error && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center"
            >
              <FiAlertCircle className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-semibold text-gray-900">
                We could not load your saved places
              </h2>
              <p className="mt-1 text-gray-600">
                They are still saved — this is a problem reaching the server, not lost data.
              </p>
              <button
                type="button"
                onClick={refresh}
                className="mt-6 rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white hover:bg-primary-700"
              >
                Try again
              </button>
            </div>
          )}

          {!showSpinner && !error && places.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
              <FiHeart className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-serif font-bold text-gray-900">Nothing saved yet</h2>
              <p className="mt-2 text-gray-600">
                Browse destinations and tap the heart on anything you want to come back to.
              </p>
              <Link
                href="/browse"
                className="mt-6 inline-flex items-center rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white hover:bg-primary-700"
              >
                <FiCompass className="mr-2 h-5 w-5" aria-hidden="true" />
                Explore places
              </Link>
            </div>
          )}

          {!showSpinner && !error && places.length > 0 && (
            <>
              <p className="sr-only" role="status">
                {places.length} saved {places.length === 1 ? 'place' : 'places'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {places.map((place) => (
                  <PlaceCard key={place.id} place={place} />
                ))}
              </div>
            </>
          )}

          {/* `FV-019`. On this page rather than browse, because this is where the signal it is built
              from lives: a reader looking at what they saved is exactly the reader for whom "picked
              from what you save" is a checkable claim rather than a mysterious one. It renders
              nothing when a fetch fails, and an actionable sentence when nothing is saved. */}
          {!showSpinner && (
            <div className="mt-10">
              <RecommendedForYou getToken={getIdToken} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
