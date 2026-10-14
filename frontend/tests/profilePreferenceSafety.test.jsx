import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profile from '../src/pages/profile';
import apiClient from '../src/services/apiClient';

/**
 * The profile form's write path, and the one thing it must never do (`BUG-062`).
 *
 * ---------------------------------------------------------------------------
 * Why an empty form is a dangerous thing to submit
 * ---------------------------------------------------------------------------
 * `FV-020`'s preferences and `FV-029`'s access needs are **clearable**: `[]` clears an array,
 * `null` clears a scalar, `false` clears a boolean. That is deliberate, and it is the only reason
 * a stated preference can ever be un-stated through the form.
 *
 * It also makes the initial state byte-identical to a deliberate wipe. `authController.js` guards
 * the *omission* case in SQL — `COALESCE` leaves a column alone when the field is absent, so an
 * older client saving a name cannot erase fields it has never heard of — but nothing can
 * distinguish "the user cleared this" from "the page never loaded it" once the value is on the
 * wire.
 *
 * So when `GET /auth/profile` fails, the page renders every preference empty and the next save of
 * an unrelated field would post that emptiness as fact. **A dropped request during page load would
 * destroy a stored profile as a side effect of renaming yourself.**
 *
 * This is `IMP-031`'s "empty and failed are different states" — the conflation `myReviews.test.jsx`
 * guards on the read side — except here it is not merely *reported*, it is *written back*.
 *
 * ---------------------------------------------------------------------------
 * What the fix is, and therefore what these assert
 * ---------------------------------------------------------------------------
 * Until the load succeeds the payload **omits both groups**, which routes the write into the
 * COALESCE path the backend already built. And the page says so, because an empty form that is
 * silently not-your-data is an interface making a false claim.
 */

jest.mock('../src/services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() }
}));

const updateProfile = jest.fn(async () => ({ success: true }));
const mockAuth = {
  currentUser: { uid: 'u1', displayName: 'Mukund', email: 'a@b.com' },
  loading: false,
  updateProfile,
  getIdToken: jest.fn(async () => 'tok')
};
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// Out of scope and it fetches on mount; `myReviews.test.jsx` is where it is covered.
jest.mock('../src/components/profile/MyReviews', () => ({
  __esModule: true,
  default: () => null
}));

/** What a traveller who has actually set things looks like coming back from the API. */
const STORED = {
  location: 'Bengaluru',
  dob: null,
  requires_step_free: true,
  requires_accessible_restroom: false,
  interests: ['beach', 'heritage'],
  budget_band: 'mid',
  travel_pace: 'relaxed',
  party_type: 'solo',
  dietary_needs: ['jain']
};

const PREFERENCE_FIELDS = [
  'interests',
  'budget_band',
  'travel_pace',
  'party_type',
  'dietary_needs',
  'requires_step_free',
  'requires_accessible_restroom'
];

const save = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(updateProfile).toHaveBeenCalled());
  return updateProfile.mock.calls.at(-1)[0];
};

beforeEach(() => jest.clearAllMocks());

describe('a failed profile load cannot erase a stored profile', () => {
  test('saving after a failed load omits every clearable field', async () => {
    apiClient.get.mockRejectedValue(new Error('network'));
    render(<Profile />);
    await screen.findByRole('status');

    const body = await save();

    // Omitted, not sent-as-empty. `toBeUndefined` would also pass if the key were present and
    // undefined, which serialises away — so assert on the key itself.
    for (const field of PREFERENCE_FIELDS) {
      expect(Object.keys(body)).not.toContain(field);
    }
    // The rest of the form still saves. Refusing the whole write would turn a transient failure
    // into an unusable page, which is the overcorrection.
    expect(body.name).toBe('Mukund');
  });

  test('it says the sections are empty because the load failed, not because they are', async () => {
    apiClient.get.mockRejectedValue(new Error('network'));
    render(<Profile />);

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/could not be loaded/i);
    expect(notice).toHaveTextContent(/saving will leave them untouched/i);
  });

  test('a response with no body is a failed load too, not an empty profile', async () => {
    // `data` undefined returns early, before the state is populated. That path must reach the
    // same conclusion as a thrown error, or the quieter failure is the dangerous one.
    apiClient.get.mockResolvedValue({});
    render(<Profile />);
    await screen.findByRole('status');

    const body = await save();
    for (const field of PREFERENCE_FIELDS) {
      expect(Object.keys(body)).not.toContain(field);
    }
  });
});

describe('a successful load submits what was loaded', () => {
  test('the notice is gone and every field is sent', async () => {
    apiClient.get.mockResolvedValue({ data: STORED });
    render(<Profile />);
    await screen.findByDisplayValue('Bengaluru');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const body = await save();
    expect(body).toMatchObject({
      interests: ['beach', 'heritage'],
      budget_band: 'mid',
      travel_pace: 'relaxed',
      party_type: 'solo',
      dietary_needs: ['jain'],
      requires_step_free: true,
      requires_accessible_restroom: false
    });
  });

  test('clearing a loaded preference still sends the clear', async () => {
    // The other half of the rule. Suppressing the fields is only correct *before* the load; doing
    // it afterwards would make a preference impossible to unset, which is the opposite defect.
    apiClient.get.mockResolvedValue({ data: STORED });
    render(<Profile />);
    await screen.findByDisplayValue('Bengaluru');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/budget/i), '');

    const body = await save();
    expect(body.budget_band).toBe('');
    expect(body.travel_pace).toBe('relaxed');
  });
});
