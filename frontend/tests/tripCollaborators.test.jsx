import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TripCollaborators from '../src/components/trips/TripCollaborators';
import tripService from '../src/services/tripService';
import { ApiClientError } from '../src/services/apiClient';

/**
 * The people on a trip, in the interface (`FV-007` stage b).
 *
 * **What is worth asserting here is what the panel promises**, not that a list renders. Three
 * claims, each of which is easy to get wrong in a way that looks fine:
 *
 *   1. **"Share" over-promises and the panel must not.** A person added here can read the trip and
 *      nothing else. If the interface implies collaboration, somebody adds a friend, tells them to
 *      add a hotel, and the friend meets an error the interface never mentioned.
 *   2. **The owner's controls are the owner's.** A viewer must not be offered an add field or a
 *      remove button. Hiding them is a courtesy rather than a permission — the server refuses
 *      either way, and `backend/tests/tripCollaborators.test.js` asserts that half — but an
 *      interface that offers an action it knows will fail is one that teaches people to distrust it.
 *   3. **A failed read must not read as "nobody has this trip."** That is a claim about who can see
 *      the reader's plan, and it is `IMP-031`'s mistake in the place it matters most.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: {
    listCollaborators: jest.fn(),
    addCollaborator: jest.fn(),
    removeCollaborator: jest.fn()
  }
}));

const getToken = jest.fn().mockResolvedValue('token');

const OWNER_VIEW = {
  your_role: 'owner',
  collaborators: [
    { user_id: 'u-otto', email: 'otto@easytrip.test', name: 'Otto Other', role: 'viewer' }
  ]
};

beforeEach(() => {
  jest.clearAllMocks();
  tripService.listCollaborators.mockResolvedValue(OWNER_VIEW);
  tripService.addCollaborator.mockResolvedValue({ user_id: 'u-new', role: 'viewer' });
  tripService.removeCollaborator.mockResolvedValue(true);
});

describe('the panel says what sharing actually does', () => {
  test('it tells the owner what each of the two roles actually allows', async () => {
    // Both halves matter. "Everyone can read" is the floor; "an editor can also change the plan,
    // but not its name, dates, audience or sharing" is the ceiling — and the ceiling is the part
    // somebody would otherwise assume, because "editor" sounds unlimited.
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/everyone you add can read this trip/i)).toBeInTheDocument();
    expect(screen.getByText(/an editor can also change the plan/i)).toBeInTheDocument();
    expect(screen.getByText(/not its name, its dates, who else is on it/i)).toBeInTheDocument();
  });

  test('an editor is told what they can and cannot do, which is neither of the other two', async () => {
    tripService.listCollaborators.mockResolvedValue({ ...OWNER_VIEW, your_role: 'editor' });

    render(<TripCollaborators tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/read this trip and change its plan/i)).toBeInTheDocument();
    expect(screen.getByText(/only its owner can rename it/i)).toBeInTheDocument();
    // An editor is still not an owner: no add field, no remove buttons.
    expect(screen.queryByLabelText(/add somebody by email/i)).not.toBeInTheDocument();
  });

  test('each person is labelled with what they can do, not just listed', async () => {
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    // Scoped to the row, because the role <select> offers the same words on purpose — the badge and
    // the choice that produced it should read alike, so an unscoped query matches both.
    const row = (await screen.findByText('Otto Other')).closest('li');
    expect(within(row).getByText(/^can read$/i)).toBeInTheDocument();
  });

  test('an editor is labelled differently from a viewer', async () => {
    // Two people with different powers that render identically is the failure this guards: an owner
    // scanning the list must be able to tell who can change the plan.
    tripService.listCollaborators.mockResolvedValue({
      your_role: 'owner',
      collaborators: [
        { user_id: 'u-a', email: 'a@easytrip.test', name: 'Ann', role: 'viewer' },
        { user_id: 'u-b', email: 'b@easytrip.test', name: 'Ben', role: 'editor' }
      ]
    });

    render(<TripCollaborators tripId={7} getToken={getToken} />);

    const ann = (await screen.findByText('Ann')).closest('li');
    const ben = screen.getByText('Ben').closest('li');

    expect(within(ann).getByText(/^can read$/i)).toBeInTheDocument();
    expect(within(ben).getByText(/^can edit$/i)).toBeInTheDocument();
  });

  test('the no-email limitation is stated before somebody meets it as an error', async () => {
    // There is no mail service, so the address is a lookup key against existing accounts. Invisible
    // until it fails, unless the form says so.
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/need an EasyTrip account already/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is emailed/i)).toBeInTheDocument();
  });
});

describe('the owner’s controls are the owner’s', () => {
  test('an owner gets the add field and a remove button', async () => {
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    expect(await screen.findByLabelText(/add somebody by email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove otto other/i })).toBeInTheDocument();
  });

  test('a viewer gets neither, and is told why', async () => {
    tripService.listCollaborators.mockResolvedValue({ ...OWNER_VIEW, your_role: 'viewer' });

    render(<TripCollaborators tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/only its owner can change it/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/add somebody by email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});

describe('adding somebody', () => {
  test('the address reaches the service and the list is re-read', async () => {
    const user = userEvent.setup();
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    await user.type(await screen.findByLabelText(/add somebody by email/i), 'new@easytrip.test');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(tripService.addCollaborator).toHaveBeenCalledWith(
        7,
        'new@easytrip.test',
        'token',
        // The role travels with the address, and defaults to the weaker one.
        'viewer'
      )
    );
    // Re-read rather than pushed into local state: the server decides what the list is, and an
    // optimistic row would show somebody as having access before they do.
    await waitFor(() => expect(tripService.listCollaborators).toHaveBeenCalledTimes(2));
  });

  test('the 422 for an unregistered address is shown in its own words', async () => {
    // The API writes a sentence for a reader; `tripService` passes it through rather than replacing
    // it with a generic fallback. If that ever stops being true, this fails.
    tripService.addCollaborator.mockRejectedValue(
      new ApiClientError(
        'Nobody is registered with that email address. They need an EasyTrip account before they can be added to a trip.',
        422
      )
    );
    const user = userEvent.setup();
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    await user.type(await screen.findByLabelText(/add somebody by email/i), 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nobody is registered/i);
  });

  test('a failed add keeps what was typed', async () => {
    // Clearing the field on failure loses the address and leaves somebody re-typing one the server
    // has already rejected.
    tripService.addCollaborator.mockRejectedValue(new ApiClientError('Nope', 422));
    const user = userEvent.setup();
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    const field = await screen.findByLabelText(/add somebody by email/i);
    await user.type(field, 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await screen.findByRole('alert');
    expect(field).toHaveValue('ghost@example.com');
  });

  test('a successful add clears the field', async () => {
    const user = userEvent.setup();
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    const field = await screen.findByLabelText(/add somebody by email/i);
    await user.type(field, 'new@easytrip.test');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(field).toHaveValue(''));
  });
});

describe('the two absences it is careful about', () => {
  test('an empty list is an empty list, and says so plainly', async () => {
    tripService.listCollaborators.mockResolvedValue({ your_role: 'owner', collaborators: [] });

    render(<TripCollaborators tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/have not added anybody yet/i)).toBeInTheDocument();
  });

  test('a failed read renders nothing rather than claiming nobody has the trip', async () => {
    /**
     * **The rejection is resolved by hand, and mutation `M3` is why.**
     *
     * The first version of this test rendered, then `await waitFor(() => expect(container)
     * .toBeEmptyDOMElement())`. That passes on the **pre-load** DOM, which is also empty — so
     * deleting the `loadFailed` guard entirely left the test green while a failed read rendered
     * "Nobody else has been added", the exact claim this test exists to forbid.
     *
     * Holding the promise and rejecting it inside `act` removes the race: when the assertion runs,
     * the failure has definitely been handled, so an empty DOM means the component chose to render
     * nothing rather than not having decided yet.
     */
    let reject;
    tripService.listCollaborators.mockReturnValue(
      new Promise((_resolve, rejectIt) => {
        reject = rejectIt;
      })
    );

    render(<TripCollaborators tripId={7} getToken={getToken} />);
    await waitFor(() => expect(tripService.listCollaborators).toHaveBeenCalled());

    await act(async () => {
      reject(new ApiClientError('network', 500));
    });

    expect(screen.queryByRole('heading', { name: /people on this trip/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/added anybody yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nobody else has been added/i)).not.toBeInTheDocument();
  });

  test('a collaborator with no name is still shown, by their email', async () => {
    // The uid is the fact; the `users` row may not exist yet. Rendering nothing for them would make
    // somebody with access invisible to the person who granted it.
    tripService.listCollaborators.mockResolvedValue({
      your_role: 'owner',
      collaborators: [{ user_id: 'u-x', email: 'x@easytrip.test', name: null, role: 'viewer' }]
    });

    render(<TripCollaborators tripId={7} getToken={getToken} />);

    expect(await screen.findByText('x@easytrip.test')).toBeInTheDocument();
  });
});

describe('choosing what somebody may do', () => {
  test('the default is the weaker role', async () => {
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    const select = await screen.findByLabelText(/what they can do/i);
    expect(select).toHaveValue('viewer');
  });

  test('choosing editor sends editor', async () => {
    const user = userEvent.setup();
    render(<TripCollaborators tripId={7} getToken={getToken} />);

    await user.type(await screen.findByLabelText(/add somebody by email/i), 'new@easytrip.test');
    await user.selectOptions(screen.getByLabelText(/what they can do/i), 'editor');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(tripService.addCollaborator).toHaveBeenCalledWith(
        7,
        'new@easytrip.test',
        'token',
        'editor'
      )
    );
  });

  test('a viewer is offered no choice at all', async () => {
    tripService.listCollaborators.mockResolvedValue({ ...OWNER_VIEW, your_role: 'viewer' });

    render(<TripCollaborators tripId={7} getToken={getToken} />);

    await screen.findByText(/you can read this trip/i);
    expect(screen.queryByLabelText(/what they can do/i)).not.toBeInTheDocument();
  });
});
