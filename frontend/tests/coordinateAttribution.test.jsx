import { render, screen } from '@testing-library/react';
import { MagazineSidebar } from '../src/components/place/MagazineSidebar';

/**
 * The ODbL attribution notice on a place page (`IMP-127`, `ADR-039`).
 *
 * ODbL section 4.3 obliges us to credit OpenStreetMap for geocoding **output**. The map embedded
 * beside this notice is Google's and credits Google — for the map. The coordinates it is centred on
 * are separate data under a separate licence, and when they came from Nominatim the credit is owed
 * here or nowhere.
 *
 * **Two failures, opposite in direction, both invisible in a browser:**
 *
 * 1. the notice never renders → a licence breach that looks exactly like a working page;
 * 2. the notice renders for every place → OpenStreetMap credited for coordinates an admin typed by
 *    hand, which is an invented provenance rather than a fixed one (the `IMP-027` class of defect,
 *    arrived at by trying to comply).
 *
 * So the negative case below is not padding. It is half the requirement.
 */

jest.mock('../src/components/place/PlaceWeather', () => ({
  __esModule: true,
  // The sidebar's first child fetches on mount; this suite is about the last one.
  default: () => null
}));

const place = (over = {}) => ({
  id: 1,
  name: 'Hampi',
  location: 'Hampi',
  latitude: 15.335,
  longitude: 76.46,
  coordinates_source: null,
  themes: [],
  tags: [],
  custom_keys: {},
  ...over
});

const notice = () => screen.queryByText(/Coordinates ©/i);

describe('geocoding attribution', () => {
  test('credits OpenStreetMap when the coordinates came from Nominatim', () => {
    render(<MagazineSidebar place={place({ coordinates_source: 'nominatim' })} />);

    expect(notice()).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'OpenStreetMap' });
    // The copyright page, not the homepage: it is the notice ODbL's attribution guideline points
    // at, and it is where a reader finds out what the licence actually permits.
    expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    expect(notice()).toHaveTextContent(/ODbL/);
  });

  test('says nothing for coordinates the admin typed', () => {
    render(<MagazineSidebar place={place()} />);
    expect(notice()).not.toBeInTheDocument();
  });

  test('says nothing for an unrecognised provenance', () => {
    // A value that survived a schema change but that nobody has vetted must not produce a legal
    // notice. Rendering `coordinates_source` directly would have credited "acme" here.
    render(<MagazineSidebar place={place({ coordinates_source: 'acme' })} />);
    expect(notice()).not.toBeInTheDocument();
  });

  test('says nothing when there is no map at all', () => {
    // The whole card is gated on coordinates, so a place without them cannot show a notice —
    // asserted rather than assumed, because the notice sits inside that gate by placement only.
    render(
      <MagazineSidebar
        place={place({ latitude: null, longitude: null, coordinates_source: 'nominatim' })}
      />
    );
    expect(notice()).not.toBeInTheDocument();
  });
});
