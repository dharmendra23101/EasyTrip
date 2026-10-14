import Head from 'next/head';
import Link from 'next/link';
import { FiWifiOff } from 'react-icons/fi';

/**
 * The service worker's last resort (`IMP-115`).
 *
 * Reached only when a navigation fails and nothing for that URL is cached — a cold start with no
 * network. It exists so that case shows something explanatory rather than the browser's own error
 * page, which tells the user nothing about what EasyTrip can still do.
 *
 * **It is careful not to overpromise.** "You're offline" alone implies everything is waiting for
 * you; what is actually available is whatever this browser has already loaded. Saying which is the
 * difference between a helpful page and one that sends somebody to a wishlist that is not there —
 * per-user data is deliberately never cached (`ADR-038`), because a shared cache would hand it to
 * the next person on the device.
 */
export default function Offline() {
  return (
    <>
      <Head>
        <title>Offline | EasyTrip</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md text-center">
          <FiWifiOff className="mx-auto h-12 w-12 text-gray-400" />
          <h1 className="mt-6 text-2xl font-bold text-gray-900">You&apos;re offline</h1>

          <p className="mt-3 text-gray-600">
            EasyTrip can still show you pages you have already visited on this device. Anything new
            — and anything signed in, like your saved places or trips — needs a connection.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              Try again
            </button>
            <Link
              href="/browse"
              className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Browse cached places
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
