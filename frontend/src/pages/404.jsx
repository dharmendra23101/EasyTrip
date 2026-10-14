import Head from 'next/head';
import Link from 'next/link';
import { FiCompass, FiHome, FiSearch } from 'react-icons/fi';

/**
 * Custom 404 (IMP-025).
 *
 * Next's default 404 is an unstyled system page — it looks like the site broke rather than like the
 * address was wrong. Every route that no longer exists now lands somewhere that offers a way onward.
 */
export default function NotFound() {
  return (
    <>
      <Head>
        <title>Page not found | EasyTrip</title>
        {/* A soft-404 is worse than a real one: keep search engines from indexing this. */}
        <meta name="robots" content="noindex" />
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-50 text-primary-600 mb-6">
            <FiCompass className="w-8 h-8" />
          </div>

          <p className="text-sm font-semibold text-primary-600 tracking-wide uppercase mb-2">404</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">We couldn&apos;t find that page</h1>
          <p className="text-gray-600 mb-8">
            The link may be out of date, or the address may have a typo. Everything on EasyTrip is
            reachable from the two places below.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors"
            >
              <FiHome className="mr-2" />
              Go home
            </Link>
            <Link
              href="/browse"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              <FiSearch className="mr-2" />
              Browse destinations
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
