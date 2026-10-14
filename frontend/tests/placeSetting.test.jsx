import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingSelector } from '../src/components/admin/SettingSelector';
import { EditPlaceFields } from '../src/components/admin/editPlace/EditPlaceFields';
import { PLACE_SETTINGS, PLACE_SETTING_OPTIONS } from '../src/constants/placeSetting';
import { emptyPlaceForm } from '../src/utils/placeFormValidation';
import { useEditPlace } from '../src/hooks/useEditPlace';
import { getPlaceById, updatePlace } from '../src/services/placeService';

jest.mock('../src/services/placeService', () => ({
  getPlaceById: jest.fn(),
  updatePlace: jest.fn()
}));

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

/**
 * The admin control for `places.setting` (`TD-023`).
 *
 * **What this closes.** The column shipped in Sprint 8.17 with a migration, a validator, a `CHECK`
 * constraint and an index — and **nothing that could write it**. Two features then shipped that
 * read it (`FV-031` daylight, `FV-027` rain), leaving both correct, live, and firing on nothing,
 * because every row in the catalogue sits at `unknown`.
 *
 * So the assertion that matters is not "a radio renders". It is **the form shows what the place is
 * already classified as** — because a control that silently starts at the default is worse than no
 * control: it turns every unrelated edit into a quiet reclassification.
 */

const editForm = (setting) => ({
  formData: {
    name: 'Hampi',
    location: 'Hampi',
    district: '',
    state: '',
    locality: '',
    pin_code: '',
    latitude: '',
    longitude: '',
    description: '',
    setting
  },
  handleChange: jest.fn()
});

describe('the choice is presented with its consequence', () => {
  test('every value the backend accepts is offered, and nothing else', () => {
    // The list is duplicated across the tier boundary and guarded by
    // `scripts/check-theme-vocabulary.mjs`. This asserts the *UI* renders the whole vocabulary —
    // a guard comparing two constants cannot see a control that only draws three of them.
    render(<SettingSelector value="unknown" onChange={jest.fn()} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(PLACE_SETTINGS.length);
    expect(radios.map((radio) => radio.value).sort()).toEqual([...PLACE_SETTINGS].sort());
  });

  test('each option says what it commits the place to', () => {
    // An admin choosing between four words with no guidance guesses, and the guess becomes the
    // input to two planning rules. The consequence has to be visible before the click, not
    // discoverable after it.
    render(<SettingSelector value="unknown" onChange={jest.fn()} />);

    for (const option of PLACE_SETTING_OPTIONS) {
      expect(screen.getByText(option.description)).toBeInTheDocument();
    }
  });

  test('"not classified" reads as an answer rather than a failure to answer', () => {
    // The engines treat `unknown` as *no evidence* and stay silent, which is strictly better than
    // a guess. A UI that shames an admin out of it produces exactly the data these features cannot
    // use — so this asserts the copy, because the copy is the mechanism.
    render(<SettingSelector value="unknown" onChange={jest.fn()} />);

    const unknown = PLACE_SETTING_OPTIONS.find((option) => option.value === 'unknown');
    expect(unknown.description).toMatch(/safe answer, not a missing one/i);
    expect(screen.getByText(/stays silent rather than guessing/i)).toBeInTheDocument();
  });

  test('choosing one reports the value, not the label', () => {
    const onChange = jest.fn();
    render(<SettingSelector value="unknown" onChange={onChange} />);

    return userEvent.click(screen.getByRole('radio', { name: /Outdoors/ })).then(() => {
      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.calls[0][0].target.value).toBe('outdoor');
      // `name` is what the shared `handleChange` writes into `formData`, so it is part of the
      // contract rather than an attribute.
      expect(onChange.mock.calls[0][0].target.name).toBe('setting');
    });
  });
});

describe('the edit form shows what the place already is', () => {
  test.each(PLACE_SETTINGS)('a place classified %s opens on that answer', (setting) => {
    // The defect this prevents is silent: open a place to fix a typo in its description, and a
    // control that started at the default reclassifies it on save without anyone touching it.
    render(<EditPlaceFields form={editForm(setting)} />);

    const chosen = screen.getAllByRole('radio').find((radio) => radio.checked);
    expect(chosen.value).toBe(setting);
  });

  test('a place the API did not classify falls to unknown, not to blank', () => {
    // `getPlaceById` only started returning `setting` in this sprint. An older cached response, or
    // any future one that drops the column, must land on the value that asserts nothing.
    render(<EditPlaceFields form={editForm(undefined)} />);

    const chosen = screen.getAllByRole('radio').find((radio) => radio.checked);
    expect(chosen.value).toBe('unknown');
  });
});

describe('a new place carries a real default', () => {
  test('the wizard starts at unknown rather than an empty string', () => {
    // Not cosmetic. The API validator is `optional({ values: 'falsy' })`, so '' reads as *not
    // provided* — a form that looked like it had chosen would have silently chosen nothing.
    expect(emptyPlaceForm().setting).toBe('unknown');
    expect(PLACE_SETTINGS).toContain(emptyPlaceForm().setting);
  });
});

describe('the classification survives the round trip', () => {
  const auth = {
    currentUser: { uid: 'admin-1', displayName: 'Ada' },
    isAdmin: true,
    getIdToken: async () => 'token'
  };

  const place = (over = {}) => ({
    id: 1,
    name: 'Hampi',
    location: 'Hampi',
    description: 'Ruins',
    themes: [],
    tags: [],
    custom_keys: {},
    ...over
  });

  beforeEach(() => {
    jest.clearAllMocks();
    updatePlace.mockResolvedValue({});
  });

  test('what the API says a place is, is what the form loads', async () => {
    // The gap `EditPlaceFields`' own test cannot see: that component is handed a `formData`, and
    // this is the code that builds one. Drop the mapping and every place opens as `unknown`.
    getPlaceById.mockResolvedValue(place({ setting: 'outdoor' }));

    const { result } = renderHook(() => useEditPlace('1', auth, jest.fn()));

    await waitFor(() => expect(result.current.formData.setting).toBe('outdoor'));
  });

  test('a place the API says nothing about loads as unclassified', async () => {
    getPlaceById.mockResolvedValue(place());

    const { result } = renderHook(() => useEditPlace('1', auth, jest.fn()));

    await waitFor(() => expect(result.current.formData.name).toBe('Hampi'));
    expect(result.current.formData.setting).toBe('unknown');
  });

  test('and the chosen classification is what gets saved', async () => {
    // The last link. Everything above could be right and the value could still never leave the
    // browser — `buildPlaceFormData` sends whatever `formData` holds, so this asserts the field is
    // in it under the name the API validates.
    getPlaceById.mockResolvedValue(place({ setting: 'unknown' }));

    const { result } = renderHook(() => useEditPlace('1', auth, jest.fn()));
    await waitFor(() => expect(result.current.formData.name).toBe('Hampi'));

    act(() => {
      result.current.handleChange({ target: { name: 'setting', value: 'indoor' } });
    });
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} });
    });

    expect(updatePlace).toHaveBeenCalled();
    expect(updatePlace.mock.calls[0][1].setting).toBe('indoor');
  });
});
