import { render, screen, waitFor } from '@testing-library/react';
import PlaceWeather from '../src/components/place/PlaceWeather';
import { fetchPlaceWeather } from '../src/services/placesApi';
import { formatWeekdayShort } from '../src/utils/dateFormat';

/**
 * The weather panel (`IMP-110`).
 *
 * **This component exists because the last one lied.** The place page used to render a hardcoded
 * 24 °C "Partly cloudy" as though it were a reading, and `IMP-027` deleted it rather than leave
 * invented data on the page. So the assertions that matter are the negative ones: when there is no
 * real reading, **no number appears** — not a placeholder, not a dash, not a skeleton that never
 * resolves.
 */

jest.mock('../src/services/placesApi', () => ({
  __esModule: true,
  fetchPlaceWeather: jest.fn()
}));

const payload = (over = {}) => ({
  available: true,
  timezone: 'Asia/Kolkata',
  source: 'Open-Meteo',
  current: {
    temperature_c: 27,
    feels_like_c: 29,
    humidity_pct: 62,
    wind_kph: 11,
    code: 2,
    condition: 'Partly cloudy',
    is_wet: false
  },
  forecast: [
    {
      date: '2026-03-01',
      min_c: 19,
      max_c: 31,
      code: 2,
      condition: 'Partly cloudy',
      is_wet: false
    },
    { date: '2026-03-02', min_c: 20, max_c: 28, code: 63, condition: 'Rain', is_wet: true }
  ],
  ...over
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchPlaceWeather.mockResolvedValue(payload());
});

describe('a real reading', () => {
  test('renders the temperature, the condition and the source', async () => {
    render(<PlaceWeather placeId={1} />);

    expect(await screen.findByText('27')).toBeInTheDocument();
    // `getAllByText`, not `getByText`: since Sprint 8.74 each forecast day also announces its own
    // condition to a screen reader, and this fixture's first forecast day is "Partly cloudy" too.
    // The current reading is the *visible* one, which is what distinguishes it from the sr-only
    // copies — asserting on that rather than on "there is exactly one" keeps the test about the
    // panel instead of about the fixture's choice of weather.
    expect(
      screen.getAllByText('Partly cloudy').some((node) => !node.className.includes('sr-only'))
    ).toBe(true);
    expect(screen.getByText(/feels like 29/i)).toBeInTheDocument();
    // Attribution is required by Open-Meteo's terms — and naming the source is what distinguishes
    // this panel from the fabricated one it replaced.
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute(
      'href',
      'https://open-meteo.com/'
    );
  });

  test('renders the forecast strip with pinned weekday labels', async () => {
    render(<PlaceWeather placeId={1} />);

    await screen.findByText('27');
    // Asserted against the same helper the component uses, because the point is that the label is
    // computed with a pinned locale and zone — a hardcoded 'Sun' here would pass in one timezone
    // and fail in another, which is `BUG-046` reproduced inside its own regression test.
    expect(screen.getByText(formatWeekdayShort('2026-03-01'))).toBeInTheDocument();
    expect(screen.getByText('31°')).toBeInTheDocument();
    expect(screen.getByText('19°')).toBeInTheDocument();
  });

  test("announces each forecast day's condition, which only the icon used to carry", async () => {
    render(<PlaceWeather placeId={1} />);
    await screen.findByText('27');

    // The day glyph is `aria-hidden`, so before Sprint 8.74 a screen reader got a weekday and two
    // numbers and no way to learn it was going to rain. The server has always sent the words.
    const rain = screen.getByText('Rain');
    expect(rain).toBeInTheDocument();
    expect(rain).toHaveClass('sr-only');

    // Asserted as *absent from the accessibility tree* rather than merely present in the DOM: an
    // icon that is announced would duplicate the sentence beside it, and the whole point is that
    // exactly one of the two reaches a screen reader.
    expect(document.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  test('omits optional readings the provider did not send, rather than rendering blanks', async () => {
    fetchPlaceWeather.mockResolvedValue(
      payload({
        current: { ...payload().current, feels_like_c: null, humidity_pct: null, wind_kph: null }
      })
    );

    render(<PlaceWeather placeId={1} />);

    expect(await screen.findByText('27')).toBeInTheDocument();
    expect(screen.queryByText(/feels like/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/km\/h/)).not.toBeInTheDocument();
  });
});

describe('nothing is invented when there is no reading', () => {
  test('a provider outage says so, and shows no number', async () => {
    fetchPlaceWeather.mockResolvedValue({ available: false, reason: 'provider_unavailable' });

    render(<PlaceWeather placeId={1} />);

    expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
    // The assertion this component exists for. A degree sign anywhere in the unavailable state
    // would mean a number was invented to fill the slot.
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+°/)).not.toBeInTheDocument();
  });

  test('a place with no coordinates gets its own sentence, not the outage one', async () => {
    // Two different facts: one is about this place forever, the other is about right now. Telling
    // a user "unavailable right now" about a place that will never have coordinates is a small lie.
    fetchPlaceWeather.mockResolvedValue({ available: false, reason: 'no_coordinates' });

    render(<PlaceWeather placeId={1} />);

    expect(await screen.findByText(/no coordinates on file/i)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable right now/i)).not.toBeInTheDocument();
  });

  test('a thrown request degrades to the unavailable state rather than crashing the page', async () => {
    fetchPlaceWeather.mockRejectedValue(new Error('network'));

    render(<PlaceWeather placeId={1} />);

    expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
  });

  test('an aborted request leaves the panel loading rather than claiming a failure', async () => {
    // Navigating away aborts; reporting that as an outage would blame the provider for the user
    // changing their mind.
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchPlaceWeather.mockRejectedValue(aborted);

    render(<PlaceWeather placeId={1} />);

    await waitFor(() => expect(fetchPlaceWeather).toHaveBeenCalled());
    expect(screen.queryByText(/unavailable right now/i)).not.toBeInTheDocument();
  });
});

describe('what it asks for', () => {
  test('it fetches the place it was given, once', async () => {
    render(<PlaceWeather placeId={42} />);

    await waitFor(() => expect(fetchPlaceWeather).toHaveBeenCalledTimes(1));
    expect(fetchPlaceWeather).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  test('no place id means no request', async () => {
    render(<PlaceWeather placeId={undefined} />);

    await waitFor(() => expect(fetchPlaceWeather).not.toHaveBeenCalled());
  });
});
