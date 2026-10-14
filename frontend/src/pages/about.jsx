import Head from 'next/head';
import Link from 'next/link';
import { FiMapPin, FiStar, FiFilter, FiArrowRight } from 'react-icons/fi';

/**
 * About page (IMP-025).
 *
 * Built rather than removed, because "Learn More" is the landing page's secondary call to action and
 * a link to nothing was the weakest thing on it.
 *
 * Everything here is deliberately checkable against the product. No visitor counts, no testimonials,
 * no founding story — the same sprint removes fabricated content from the detail page (IMP-027), and
 * inventing it here would be the identical mistake in a nicer font.
 */
export default function About() {
  const capabilities = [
    {
      icon: <FiMapPin className="w-5 h-5" />,
      title: 'Curated destinations',
      body: 'Every place is added by hand with its location, description, photos, and the themes that describe it — not scraped, and not generated.'
    },
    {
      icon: <FiFilter className="w-5 h-5" />,
      title: 'Filters that actually filter',
      body: 'Theme, minimum rating, and best-time-to-visit are applied by the database, so the result set is the real answer rather than a subset trimmed in the browser.'
    },
    {
      icon: <FiStar className="w-5 h-5" />,
      title: 'Ratings from real reviews',
      body: 'Each rating is the average of reviews left by signed-in users, one review per person per place. Nothing is seeded or padded.'
    }
  ];

  return (
    <>
      <Head>
        <title>About | EasyTrip</title>
        <meta
          name="description"
          content="What EasyTrip is, what it does, and what it deliberately does not do."
        />
      </Head>

      <div className="min-h-screen bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">About EasyTrip</h1>
          <p className="text-lg text-gray-600 mb-12">
            EasyTrip is a travel-destination discovery platform for India. It helps you find places
            worth visiting by theme, location, season, and what other travellers actually thought.
          </p>

          <div className="space-y-8 mb-16">
            {capabilities.map((item) => (
              <div key={item.title} className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
                  {item.icon}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">{item.title}</h2>
                  <p className="text-gray-600">{item.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Stating the boundaries plainly is more useful than implying the product does
              everything. It also keeps this page true as the roadmap moves. */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 mb-12">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              What EasyTrip doesn&apos;t do
            </h2>
            <ul className="space-y-2 text-gray-600">
              <li>
                • No bookings, payments, or live pricing — it is a discovery tool, not a travel
                agent.
              </li>
              <li>
                • Coverage is India-focused and curated, so it is deliberately not exhaustive.
              </li>
              <li>
                • Ratings reflect EasyTrip&apos;s own users, not aggregated third-party scores.
              </li>
            </ul>
          </div>

          <div className="border-t border-gray-200 pt-8">
            <p className="text-gray-600 mb-4">
              EasyTrip is an actively developed project. Features ship when they work end to end
              rather than when the screen looks finished.
            </p>
            <Link
              href="/browse"
              className="inline-flex items-center text-primary-600 font-medium hover:text-primary-700"
            >
              Start browsing destinations
              <FiArrowRight className="ml-2" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
