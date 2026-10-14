import Link from 'next/link';
import { FiMapPin, FiStar, FiUsers, FiFlag, FiAlertCircle, FiImage } from 'react-icons/fi';

/**
 * The admin dashboard's real figures (`IMP-111`, `ADR-037`).
 *
 * **What this deliberately is not.** The item it implements asked for "tiles with real counts
 * replacing the four static tiles", and those tiles were removed in Phase 3 — one of them was the
 * fabricated "last login" that always read *just now*. So this is not a restoration; it is a
 * decision about what belongs on the page, and the decision is that **a total nobody acts on is
 * decoration.**
 *
 * Two kinds of tile, visually separated because they ask for different things:
 *
 *   - **Context** — how big is the catalogue, how engaged are people. Read once, glanced at after.
 *   - **Needs attention** — something is missing and the reader is the person who can add it. Each
 *     of these links to the work rather than describing it, and each disappears at zero, because a
 *     row reading "0 places need coordinates" is a claim on attention that earns nothing.
 */

const Tile = ({ icon, label, value, hint, tone = 'default' }) => (
  <div
    className={`rounded-xl border p-4 ${
      tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'
    }`}
  >
    <div className="flex items-center text-gray-500">
      <span className={tone === 'warn' ? 'text-amber-600' : 'text-primary-600'}>{icon}</span>
      <span className="ml-2 text-xs font-medium uppercase tracking-wide">{label}</span>
    </div>
    <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
  </div>
);

export const AdminStats = ({ analytics, loading, error }) => {
  if (loading) {
    return <p className="py-6 text-sm text-gray-500">Loading figures…</p>;
  }

  if (error) {
    // Stated, not hidden. A dashboard that silently renders nothing where numbers should be reads
    // as "everything is zero", which is a wrong answer rather than a missing one.
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!analytics) return null;

  const { catalogue, ratings } = analytics;
  const reviewsTotal = Object.values(ratings || {}).reduce((sum, n) => sum + n, 0);

  const attention = [
    {
      key: 'reports',
      icon: <FiFlag className="h-4 w-4" />,
      label: 'Open reports',
      value: catalogue.open_reports,
      hint: 'Reviews awaiting moderation',
      href: '/admin/moderation'
    },
    {
      key: 'coordinates',
      icon: <FiMapPin className="h-4 w-4" />,
      label: 'No coordinates',
      value: catalogue.places_without_coordinates,
      hint: 'These never appear on the map',
      href: '/admin/managePlaces'
    },
    {
      key: 'images',
      icon: <FiImage className="h-4 w-4" />,
      label: 'No image',
      value: catalogue.places_without_images,
      hint: 'These render a placeholder',
      href: '/admin/managePlaces'
    }
  ].filter((item) => item.value > 0);

  return (
    <div className="mb-12">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          icon={<FiMapPin className="h-4 w-4" />}
          label="Places"
          value={catalogue.places}
          hint={
            catalogue.places_without_reviews > 0
              ? `${catalogue.places_without_reviews} not yet reviewed`
              : 'All reviewed'
          }
        />
        <Tile
          icon={<FiStar className="h-4 w-4" />}
          label="Reviews"
          value={reviewsTotal}
          hint={
            // `null`, not 0, when nothing is rated — the BUG M-2 rule. "0.0 average" says every
            // place was rated badly; the truth is that none was rated at all.
            catalogue.average_rating === null
              ? 'No ratings yet'
              : `${catalogue.average_rating} average`
          }
        />
        <Tile
          icon={<FiUsers className="h-4 w-4" />}
          label="Users"
          value={catalogue.users}
          hint={`${catalogue.admins} admin${catalogue.admins === 1 ? '' : 's'}`}
        />
        <Tile
          icon={<FiMapPin className="h-4 w-4" />}
          label="Trips planned"
          value={catalogue.trips}
          hint={`${catalogue.saved_places} places saved`}
        />
      </div>

      {attention.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 flex items-center text-sm font-semibold text-gray-700">
            <FiAlertCircle className="mr-2 h-4 w-4 text-amber-500" />
            Needs attention
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {attention.map((item) => (
              // Linked, because the point of the tile is the work behind it. A number an admin has
              // to go and find the page for is a number they will read and forget.
              <Link key={item.key} href={item.href}>
                <Tile
                  icon={item.icon}
                  label={item.label}
                  value={item.value}
                  hint={item.hint}
                  tone="warn"
                />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminStats;
