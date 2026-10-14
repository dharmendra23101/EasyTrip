import { render, screen } from '@testing-library/react';
import { PlaceTableDesktop } from '../src/components/admin/managePlaces/PlaceTableDesktop';
import { PlaceGridDesktop } from '../src/components/admin/managePlaces/PlaceGridDesktop';
import { PlaceListMobile } from '../src/components/admin/managePlaces/PlaceListMobile';

/**
 * The admin place list does not claim to know who last edited a place (`M-4`).
 *
 * ---------------------------------------------------------------------------
 * What was wrong for the whole life of the project
 * ---------------------------------------------------------------------------
 * All three admin list views rendered `place.updated_by_name || 'Unknown'`. **No query has ever
 * selected or computed `updated_by_name`** — so the column read "Unknown" for every place, always,
 * and did so in a way that says *"we know there is an editor and we cannot name them"* rather than
 * *"this was never wired up"*. A field that is always its own fallback is a fabricated absence.
 *
 * ---------------------------------------------------------------------------
 * Why it was deleted rather than populated
 * ---------------------------------------------------------------------------
 * `places.updated_by` exists and holds a raw Firebase UID. Turning it into a name means joining
 * `users` and shipping the result — and **the admin list is served by the public `/places`
 * endpoint**, not an admin-only one. So populating this column would put a privileged account's
 * display name in a response every anonymous visitor receives.
 *
 * That is `M-3` again with a softer payload: `M-3` was the same table's `updated_by` UID reaching
 * `__NEXT_DATA__` on every public place page. Building an admin-only list endpoint to carry one
 * cosmetic column is disproportionate; showing a name to the world to fill it is worse. The column
 * that never worked is gone, and `updated_at` — which is real, public and already rendered — stays.
 *
 * These assertions are the regression guard: they fail if anybody re-adds the field, which is easy
 * to do by copying a neighbouring row.
 */

const place = {
  id: 1,
  name: 'Hampi',
  location: 'Ballari',
  district: 'Ballari',
  state: 'Karnataka',
  updated_at: '2026-03-01T09:30:00.000Z',
  themes: [],
  tags: []
};

// The field the API has never returned. Present here on purpose: if a view starts reading it again,
// these tests fail loudly rather than silently rendering somebody's name.
const withPhantomAuthor = { ...place, updated_by_name: 'Ada Admin' };

/** The three views take one `manage` object, not loose props. */
const manageWith = (places) => ({
  filteredPlaces: places,
  confirmDelete: () => {},
  truncateText: (text) => text
});

describe.each([
  ['PlaceTableDesktop', PlaceTableDesktop],
  ['PlaceGridDesktop', PlaceGridDesktop],
  ['PlaceListMobile', PlaceListMobile]
])('%s', (name, Component) => {
  test('renders no editor name, even when the payload carries one', () => {
    render(<Component manage={manageWith([withPhantomAuthor])} />);

    expect(screen.queryByText('Ada Admin')).not.toBeInTheDocument();
    // The two fallbacks the deleted markup used. Asserting on these rather than only on the name
    // catches a re-add that keeps the placeholder — which is the state this defect was in.
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown User')).not.toBeInTheDocument();
  });

  test('still shows when the place was last updated, which is real', () => {
    render(<Component manage={manageWith([place])} />);

    // The honest half of the same row. Removing the author must not have taken the timestamp.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});
