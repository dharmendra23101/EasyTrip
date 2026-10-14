import { act, renderHook, waitFor } from '@testing-library/react';

import { usePlaceForm } from '../src/hooks/usePlaceForm';

jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() }
}));
const { toast } = require('react-toastify');

/**
 * The address lookup in the add-place wizard (`IMP-116`, `ADR-035`).
 *
 * The behaviour worth guarding is not "it calls the endpoint" — it is **when the form is allowed to
 * fill itself in.** A geocoder returning several candidates and a UI picking the first one is how a
 * place ends up pinned in the wrong district, discovered later, by a visitor.
 *
 * `usePlaceForm` takes its dependencies as arguments precisely so this is testable without a
 * router, a Firebase session or a network.
 */

const HAMPI = {
  label: 'Hampi, Ballari, Karnataka, India',
  latitude: 15.335,
  longitude: 76.46,
  district: 'Ballari',
  state: 'Karnataka',
  postcode: '583239'
};

const OTHER = {
  label: 'Hampi Road, Hosapete, Karnataka, India',
  latitude: 15.2689,
  longitude: 76.3909,
  district: 'Ballari',
  state: 'Karnataka',
  postcode: '583201'
};

const setup = (geocode) =>
  renderHook(() =>
    usePlaceForm({
      getIdToken: async () => 'test-token',
      createPlace: jest.fn(),
      onCreated: jest.fn(),
      geocode
    })
  );

/** Type into the form's controlled fields the way the inputs do. */
const type = (result, fields) =>
  act(() => {
    for (const [name, value] of Object.entries(fields)) {
      result.current.handleChange({ target: { name, value, type: 'text' } });
    }
  });

beforeEach(() => jest.clearAllMocks());

describe('a lookup needs something to look up', () => {
  test('an empty location asks the server nothing', async () => {
    const geocode = jest.fn();
    const { result } = setup(geocode);

    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(geocode).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Please enter a location first');
  });

  test('the query uses the whole address, not the location alone', async () => {
    // "Hampi" is ambiguous where "Hampi, Ballari, Karnataka" is not, and the extra fields are
    // already on the form — not using them means asking a worse question than we could.
    const geocode = jest.fn(async () => ({ results: [HAMPI], status: 'exact' }));
    const { result } = setup(geocode);

    type(result, { location: 'Hampi', district: 'Ballari', state: 'Karnataka' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(geocode).toHaveBeenCalledWith('test-token', 'Hampi, Ballari, Karnataka');
  });

  test('blank address fields are skipped rather than sent as empty segments', async () => {
    const geocode = jest.fn(async () => ({ results: [], status: 'no_match' }));
    const { result } = setup(geocode);

    type(result, { location: 'Hampi', district: '  ', state: '' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(geocode).toHaveBeenCalledWith('test-token', 'Hampi');
  });
});

describe('one match fills the form; several do not', () => {
  test('an exact match applies itself', async () => {
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(result.current.formData.latitude).toBe('15.335');
    expect(result.current.formData.longitude).toBe('76.46');
    expect(result.current.geocodeResults).toEqual([]);
  });

  test('an ambiguous match fills NOTHING and offers the candidates', async () => {
    // The rule this whole file exists for. Picking `results[0]` here would look identical to the
    // exact case from the admin's side — a pin appears, they assume it is right.
    const { result } = setup(async () => ({ results: [HAMPI, OTHER], status: 'ambiguous' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(result.current.formData.latitude).toBe('');
    expect(result.current.formData.longitude).toBe('');
    expect(result.current.geocodeResults).toHaveLength(2);
  });

  test('choosing a candidate commits it and closes the list', async () => {
    const { result } = setup(async () => ({ results: [HAMPI, OTHER], status: 'ambiguous' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });
    act(() => result.current.applyGeocodeResult(OTHER));

    expect(result.current.formData.latitude).toBe('15.2689');
    expect(result.current.geocodeResults).toEqual([]);
  });

  test('dismissing the list leaves the form untouched', async () => {
    const { result } = setup(async () => ({ results: [HAMPI, OTHER], status: 'ambiguous' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });
    act(() => result.current.clearGeocodeResults());

    expect(result.current.geocodeResults).toEqual([]);
    expect(result.current.formData.latitude).toBe('');
  });

  test('a miss says so out loud rather than doing nothing', async () => {
    // A lookup that silently changes nothing is indistinguishable from the "coming soon" stub this
    // replaces — which is the specific failure IMP-116 is about.
    const { result } = setup(async () => ({ results: [], status: 'no_match' }));

    type(result, { location: 'Nowhereville' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('No coordinates found'));
    expect(result.current.formData.latitude).toBe('');
  });
});

describe('what a result is allowed to overwrite', () => {
  test('it fills address fields the admin left blank', async () => {
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(result.current.formData.district).toBe('Ballari');
    expect(result.current.formData.state).toBe('Karnataka');
    expect(result.current.formData.pin_code).toBe('583239');
  });

  test('it does NOT overwrite what the admin typed', async () => {
    // Helpfulness that loses somebody's work. The geocoder's phrasing of a district is not more
    // authoritative than the curator's.
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi', district: 'Bellary (old spelling)', state: 'Karnataka' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(result.current.formData.district).toBe('Bellary (old spelling)');
    // …while the coordinates, which is what was asked for, are still set.
    expect(result.current.formData.latitude).toBe('15.335');
  });

  test('coordinates are written as strings, like every other field on this form', async () => {
    // The validator parses strings. A number here would make these the one pair of fields with a
    // different type flowing through the same checks.
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(typeof result.current.formData.latitude).toBe('string');
    expect(typeof result.current.formData.longitude).toBe('string');
  });
});

describe('the form records where the coordinates came from (IMP-127)', () => {
  test('an untouched form claims nothing', () => {
    const { result } = setup(jest.fn());
    // `null`, not `''`: `buildPlaceFormData` drops null, so no claim is sent at all. An empty
    // string would reach the API's allowlist and be rejected as an unknown geocoder.
    expect(result.current.formData.coordinates_source).toBeNull();
  });

  test('an exact match attributes the coordinates to the geocoder', async () => {
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(result.current.formData.coordinates_source).toBe('nominatim');
  });

  test('choosing a candidate attributes it too', async () => {
    const { result } = setup(async () => ({ results: [HAMPI, OTHER], status: 'ambiguous' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });
    // Before the choice there are no coordinates, so there is nothing to attribute.
    expect(result.current.formData.coordinates_source).toBeNull();

    act(() => result.current.applyGeocodeResult(OTHER));
    expect(result.current.formData.coordinates_source).toBe('nominatim');
  });

  test('typing over a looked-up coordinate revokes the claim', async () => {
    // The property the whole item turns on: attribution belongs to a coordinate pair, not to a
    // row. Leaving `nominatim` here would credit OpenStreetMap for a number the admin typed.
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });
    expect(result.current.formData.coordinates_source).toBe('nominatim');

    type(result, { latitude: '15.4' });
    expect(result.current.formData.coordinates_source).toBeNull();
  });

  test('editing an unrelated field leaves the claim alone', async () => {
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    type(result, { name: 'Hampi Ruins', description: 'Edited.' });
    expect(result.current.formData.coordinates_source).toBe('nominatim');
  });

  test('typing over the longitude revokes it as well', async () => {
    // Both halves of the pair, not just the one that happened to get a test.
    const { result } = setup(async () => ({ results: [HAMPI], status: 'exact' }));

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    type(result, { longitude: '76.5' });
    expect(result.current.formData.coordinates_source).toBeNull();
  });
});

describe('failures', () => {
  test('a rejected lookup is reported and the busy flag clears', async () => {
    const { result } = setup(async () => {
      throw new Error('network down');
    });

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Could not look up'));
    // A stuck spinner leaves the button permanently disabled — the failure after the failure.
    await waitFor(() => expect(result.current.isLookingUp).toBe(false));
  });

  test('an expired session is reported as one', async () => {
    const geocode = jest.fn();
    const { result } = renderHook(() =>
      usePlaceForm({
        getIdToken: async () => null,
        createPlace: jest.fn(),
        onCreated: jest.fn(),
        geocode
      })
    );

    type(result, { location: 'Hampi' });
    await act(async () => {
      await result.current.handleLocationLookup();
    });

    expect(geocode).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('session has expired'));
    await waitFor(() => expect(result.current.isLookingUp).toBe(false));
  });

  test('applying nothing does nothing', async () => {
    const { result } = setup(async () => ({ results: [], status: 'no_match' }));
    act(() => result.current.applyGeocodeResult(undefined));
    expect(result.current.formData.latitude).toBe('');
  });
});
