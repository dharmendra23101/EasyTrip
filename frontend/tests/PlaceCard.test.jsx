import { render, screen } from '@testing-library/react';
import PlaceCard from '../src/components/PlaceCard';
import { PLACEHOLDER_IMAGE } from '../src/utils/placeImage';

/**
 * PlaceCard (IMP-093).
 *
 * The unit suites already prove `placeImage` and `rating` behave. What they cannot prove is that
 * the *card actually uses them* — and that is precisely where BUG M-1 and M-2 lived: every helper
 * was correct, and five components each hand-rolled their own wrong copy instead of calling one.
 *
 * So these are integration assertions on purpose. They would fail if someone reintroduced an inline
 * `place.primary_image_url || place.image_url || placeholder` ladder, or an inline
 * `rating_sum / rating_count`, even though the helpers themselves stayed green.
 */

const GALLERY_ONLY = {
  id: 7,
  name: 'Gokarna',
  location: 'Uttara Kannada',
  primary_image_url: null,
  fallback_image_url: 'https://res.cloudinary.com/demo/image/upload/v1/gallery.jpg',
  average_rating: '4.5',
  rating_count: 2
};

const UNRATED = {
  id: 8,
  name: 'Badami',
  location: 'Bagalkot',
  primary_image_url: null,
  fallback_image_url: null,
  rating_sum: 0,
  rating_count: 0
};

describe('the card renders a place', () => {
  test('shows the name and links to its detail page', () => {
    render(<PlaceCard place={GALLERY_ONLY} />);
    expect(screen.getByText('Gokarna')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/places/7');
  });

  test('renders nothing rather than crashing on a malformed place', () => {
    // The card guards on `place && place.id && place.name`. A list endpoint returning a partial
    // row should degrade to an empty slot, not white-screen the grid — there is no error boundary
    // around individual cards.
    for (const bad of [null, undefined, {}, { id: 1 }, { name: 'no id' }]) {
      const { container, unmount } = render(<PlaceCard place={bad} />);
      expect(container).not.toHaveTextContent('undefined');
      unmount();
    }
  });
});

describe('it resolves images through the shared ladder (BUG M-1)', () => {
  test('a gallery-only place shows the gallery image, not the placeholder', () => {
    // The exact payload that used to render a placeholder in five different components.
    render(<PlaceCard place={GALLERY_ONLY} />);
    const img = screen.getByAltText('Gokarna');
    expect(img).toHaveAttribute('src', expect.stringContaining('gallery.jpg'));
    expect(img.getAttribute('src')).not.toBe(PLACEHOLDER_IMAGE);
  });

  test('a place with no image at all falls back to the placeholder', () => {
    render(<PlaceCard place={UNRATED} />);
    expect(screen.getByAltText('Badami')).toHaveAttribute('src', PLACEHOLDER_IMAGE);
  });
});

describe('it resolves ratings through the shared helper (BUG M-2)', () => {
  test('a rated place shows its average', () => {
    render(<PlaceCard place={GALLERY_ONLY} />);
    expect(screen.getByText('4.5')).toBeInTheDocument();
  });

  test('an UNRATED place never renders a 0 rating', () => {
    // The bug: `rating_sum / rating_count` recomputed inline gave `0`, which renders as a zero-star
    // rating — a place nobody has reviewed looking like a place everyone disliked.
    render(<PlaceCard place={UNRATED} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  });

  test('the average comes from average_rating, not a client-side division', () => {
    // If the card recomputed from sum/count it would show 5.0 here instead of the server's 4.5,
    // and the two would drift apart wherever rounding disagreed.
    render(
      <PlaceCard
        place={{ ...GALLERY_ONLY, average_rating: '4.5', rating_sum: 10, rating_count: 2 }}
      />
    );
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.queryByText('5.0')).not.toBeInTheDocument();
  });
});

describe('it formats dates through the shared helper (BUG-046 / IMP-122)', () => {
  // A UTC midnight. Anywhere behind UTC — the suite runs in America/Los_Angeles, and roughly half
  // the world qualifies — an unpinned formatter resolves this to the *previous day*.
  const NEW_YEAR = { ...GALLERY_ONLY, created_at: '2026-01-01T00:00:00.000Z' };

  test('a UTC-midnight date does not slip a day for viewers behind UTC', () => {
    render(<PlaceCard place={NEW_YEAR} />);

    // This is BUG-046 exactly, in the one component that renders on SSR `/browse` and hydrates in
    // the visitor's browser. The card already names its locale — its own comment records that Node
    // and the browser disagreeing on month format broke hydration for every card — but the time
    // zone was left to the runtime, which is the same fault on the other axis.
    expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Dec 31, 2025')).not.toBeInTheDocument();
  });

  test('a missing date renders the shared empty value, not the epoch', () => {
    // `new Date(null)` is the epoch, so an inline formatter renders a confident date for a row that
    // simply has no timestamp. Asserting the *positive* value rather than the absence of "1970",
    // because in a zone behind UTC the epoch renders as "Dec 31, 1969" and a `/1970/` matcher would
    // pass while the bug was still there.
    render(<PlaceCard place={{ ...GALLERY_ONLY, created_at: null }} />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  test('recent dates still read as relative time', () => {
    // The relative branch is the card's own behaviour and is deliberately kept — only the absolute
    // branch delegates. Without this, "use the shared helper" could quietly mean "lose the feature".
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    render(<PlaceCard place={{ ...GALLERY_ONLY, created_at: twoDaysAgo }} />);
    expect(screen.getByText(/days ago|Yesterday|Today/)).toBeInTheDocument();
  });
});
