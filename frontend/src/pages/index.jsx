import Head from 'next/head';
import { fetchPlaces } from '../services/placesApi';
import { useHomeCarousel } from '../hooks/useHomeCarousel';
import { HeroBackground } from '../components/home/HeroBackground';
import { HeroMobile } from '../components/home/HeroMobile';
import { HeroDesktop } from '../components/home/HeroDesktop';
import { FeaturesSection } from '../components/home/FeaturesSection';
import { CategoriesSection } from '../components/home/CategoriesSection';

/**
 * The landing page.
 *
 * Places arrive from `getStaticProps` (IMP-040) and the carousel state lives in
 * `useHomeCarousel`; each band of the page is its own component under `components/home/`.
 *
 * Mobile and desktop are two different component trees rather than one responsive tree, which is
 * how the page was already written — the carousel, its controls and its card layout genuinely
 * differ, not just their sizes.
 */
const Home = ({ places = [], loadError = null }) => {
  const home = useHomeCarousel(places, loadError);

  return (
    <>
      <Head>
        <title>EasyTrip - Discover Your Journey</title>
        <meta
          name="description"
          content="Explore curated destinations with EasyTrip, your premium travel companion."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gray-900">
        {/* Hero Section */}
        <div className="relative min-h-screen overflow-hidden">
          <HeroBackground home={home} />

          <div className="relative container mx-auto px-3 sm:px-4 lg:px-8 min-h-screen flex items-center py-8 sm:py-12 lg:py-16">
            {home.isMobile ? <HeroMobile home={home} /> : <HeroDesktop home={home} />}
          </div>
        </div>

        <FeaturesSection />
        <CategoriesSection />
      </div>
    </>
  );
};

/**
 * Pre-render the landing page and refresh it in the background (IMP-040).
 *
 * What this replaces: the carousel used to download **every place, all columns**, sort them in
 * the browser, keep the top four and throw the rest away — then cache those four in localStorage
 * for five minutes to avoid doing it again. The server can sort and limit, so the request is now
 * for four rows instead of the catalogue, and ISR makes it the *build's* request rather than
 * every visitor's. The localStorage cache is gone with it: a pre-rendered page already has the
 * data in its HTML, which beats reading it back out of localStorage after hydration.
 *
 * `revalidate: 300` keeps the previous five-minute freshness contract, now served from the CDN
 * edge instead of each browser's own storage.
 */
export async function getStaticProps() {
  try {
    const placesResult = await fetchPlaces({ sort: 'rating', limit: 4 });

    const places = placesResult.data.map((place) => ({
      ...place,
      tags: place.tags || ['Destination'],
      best_time: place.best_time || 'Year round'
    }));

    return {
      props: { places },
      revalidate: 300
    };
  } catch (error) {
    // A build or revalidation must not fail because the API is briefly unreachable. Render the
    // page with its error state and retry sooner than the normal interval — the alternative is
    // a failed deploy, or a stale page with no way to recover on its own.
    console.error('[getStaticProps] home:', error.message);
    return {
      props: { places: [], loadError: 'Failed to load destinations. Please try again.' },
      revalidate: 30
    };
  }
}

export default Home;
