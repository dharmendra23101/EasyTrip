import { render, screen } from '@testing-library/react';

import { AdminStats } from '../src/components/admin/AdminStats';

jest.mock('next/link', () => {
  const Link = ({ children }) => children;
  Link.displayName = 'Link';
  return Link;
});

/**
 * The admin dashboard's figures (`IMP-111`, `ADR-037`).
 *
 * A dashboard tile is the easiest place in a product to show a wrong number, because it is
 * *presented* as the authority and nobody cross-checks it. The assertions here are mostly about the
 * cases where the honest render is "none" or nothing at all.
 */

const CATALOGUE = {
  places: 4,
  reviews: 3,
  users: 3,
  admins: 1,
  trips: 2,
  saved_places: 5,
  places_without_coordinates: 1,
  places_without_images: 0,
  places_without_reviews: 2,
  average_rating: 3.75,
  open_reports: 0
};

const analytics = (overrides = {}) => ({
  catalogue: { ...CATALOGUE, ...(overrides.catalogue || {}) },
  ratings: overrides.ratings || { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
  activity: [],
  needsAttention: []
});

describe('the context tiles', () => {
  test('they render the figures they were given', () => {
    render(<AdminStats analytics={analytics()} loading={false} error={null} />);

    expect(screen.getByText('Places')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3.75 average')).toBeInTheDocument();
    expect(screen.getByText('1 admin')).toBeInTheDocument();
  });

  test('an unrated catalogue says so rather than showing a zero average', () => {
    // BUG M-2's rule at the dashboard. "0 average" asserts every place was rated badly; the truth
    // is that none was rated at all.
    render(
      <AdminStats
        analytics={analytics({ catalogue: { average_rating: null }, ratings: {} })}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(screen.queryByText(/0 average/)).toBeNull();
  });

  test('the admin count is pluralised, because "1 admins" reads as a bug', () => {
    render(
      <AdminStats
        analytics={analytics({ catalogue: { admins: 3 } })}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText('3 admins')).toBeInTheDocument();
  });

  test('the review total comes from the distribution, so the two cannot disagree', () => {
    // Rendering `catalogue.reviews` beside a distribution summing to something else is two numbers
    // on one screen contradicting each other.
    render(
      <AdminStats
        analytics={analytics({ ratings: { 1: 2, 2: 0, 3: 1, 4: 1, 5: 1 } })}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});

describe('the needs-attention tiles', () => {
  test('a non-zero count is surfaced with what it means', () => {
    render(<AdminStats analytics={analytics()} loading={false} error={null} />);

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('No coordinates')).toBeInTheDocument();
    expect(screen.getByText('These never appear on the map')).toBeInTheDocument();
  });

  test('a zero count is NOT rendered', () => {
    // "0 places need images" is a claim on attention that earns nothing, and a dashboard of them
    // trains the reader to skip the section that matters.
    render(<AdminStats analytics={analytics()} loading={false} error={null} />);
    expect(screen.queryByText('No image')).toBeNull();
  });

  test('with nothing outstanding, the whole section disappears', () => {
    render(
      <AdminStats
        analytics={analytics({
          catalogue: {
            open_reports: 0,
            places_without_coordinates: 0,
            places_without_images: 0
          }
        })}
        loading={false}
        error={null}
      />
    );

    expect(screen.queryByText('Needs attention')).toBeNull();
    // …while the context tiles are still there.
    expect(screen.getByText('Places')).toBeInTheDocument();
  });

  test('open reports appear when there are any', () => {
    render(
      <AdminStats
        analytics={analytics({ catalogue: { open_reports: 7 } })}
        loading={false}
        error={null}
      />
    );

    // Scoped to the tile rather than `getByText('7')`. A bare number query matches whichever tile
    // happens to share the value — with `open_reports: 4` this test found the Places count instead
    // and failed as ambiguous, which is the useful version of that mistake.
    const tile = screen.getByText('Open reports').closest('div').parentElement;
    expect(tile).toHaveTextContent('7');
    expect(tile).toHaveTextContent('Reviews awaiting moderation');
  });
});

describe('the states that are not data', () => {
  test('loading says so instead of rendering zeroes', () => {
    render(<AdminStats analytics={null} loading error={null} />);
    expect(screen.getByText(/Loading figures/)).toBeInTheDocument();
    expect(screen.queryByText('Places')).toBeNull();
  });

  test('an error is shown, not swallowed into an empty dashboard', () => {
    // Silently rendering nothing where numbers belong reads as "everything is zero".
    render(<AdminStats analytics={null} loading={false} error="Could not load the figures." />);

    expect(screen.getByText('Could not load the figures.')).toBeInTheDocument();
    expect(screen.queryByText('Places')).toBeNull();
  });

  test('no analytics at all renders nothing rather than throwing', () => {
    const { container } = render(<AdminStats analytics={null} loading={false} error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
