import Head from 'next/head';
import { getPlaceLargeImageUrl, PLACEHOLDER_IMAGE } from '../../utils/placeImage';
import { absoluteUrl } from '../../services/siteUrl';
import { buildPlaceStructuredData, serializeStructuredData } from '../../utils/placeStructuredData';

/**
 * Everything a crawler and a link preview read for one place (`IMP-113`).
 *
 * **The bug this rewrite fixes.** `og:url` was
 * `typeof window !== 'undefined' ? window.location.href : ''` — and the whole point of the Open
 * Graph tags is to be read from the *server-rendered* HTML, where `window` does not exist. Every
 * crawler and every link unfurler therefore received `<meta property="og:url" content="">`. The
 * ternary looks like a careful SSR guard and is exactly backwards: it disables the tag for the only
 * consumer that reads it. The value now comes from configuration (`siteUrl.js`), which is available
 * on both sides, and is omitted entirely when no origin is configured rather than shipped empty.
 */
export const PlaceSeoHead = ({ place }) => {
  const title = `${place.name} | EasyTrip Magazine`;
  const description =
    place.description ||
    `Discover ${place.name} in ${place.location} - Comprehensive travel guide with expert tips, photos and reviews.`;
  const image = getPlaceLargeImageUrl(place, 1600, PLACEHOLDER_IMAGE);

  // Null when no site origin is configured. Every tag below that needs it is then omitted rather
  // than emitted empty — an empty canonical is worse than none, because a crawler that reads
  // `<link rel="canonical" href="">` resolves it against the current URL in some implementations
  // and treats the page as canonicalised to the site root in others.
  const pageUrl = absoluteUrl(`/places/${place.id}`);

  const structuredData = serializeStructuredData(buildPlaceStructuredData(place, image, pageUrl));

  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta
        name="keywords"
        content={`${place.name}, ${place.location}, ${place.tags?.join(', ') || 'travel'}, tourism, vacation, travel guide`}
      />

      {/* One URL is the real one. Without this, `/places/1?utm_source=x` and `/places/1` are two
          pages competing with each other for the same content. */}
      {pageUrl && <link rel="canonical" href={pageUrl} />}

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      {/* Absent before this sprint. Without it a consumer falls back to `website`, which is the
          wrong type for a page about one thing. */}
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content="EasyTrip" />
      {pageUrl && <meta property="og:url" content={pageUrl} />}

      {/* `summary_large_image` was declared while the title, description and image tags a Twitter
          card reads were never emitted. The card type promised a layout the tags could not fill. */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {structuredData && (
        <script
          type="application/ld+json"
          // Safe because `serializeStructuredData` escapes every `<` and `>` as the JSON escapes
          // < / >, so the sequence `</script` cannot occur in the output at all. See
          // that function's comment for why JSON.stringify alone is not enough.
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
      )}
    </Head>
  );
};
