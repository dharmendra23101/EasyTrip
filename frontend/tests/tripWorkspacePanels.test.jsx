import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TripChecklist from '../src/components/trips/TripChecklist';
import TripNotes from '../src/components/trips/TripNotes';
import tripService from '../src/services/tripService';

/**
 * The notes and checklist panels (`FV-006` stage b).
 *
 * **The two panels handle failure deliberately differently, and that asymmetry is most of what is
 * tested here.**
 *
 * A checklist tick is optimistic: it paints before the server answers, because it is an interaction
 * somebody performs a dozen times while packing and a spinner on each one makes the list feel
 * broken. It therefore has to **roll back** when the server refuses — an optimistic update with no
 * rollback is just a lie that renders quickly.
 *
 * A note is not optimistic at all. It is something the reader wrote, sometimes at length, and
 * showing it as saved before it is saved is how somebody closes the tab believing they have a
 * booking reference they no longer have anywhere else. So a failed note keeps its text **in the
 * textarea**, which is the recovery path, and the tests assert the text is still there rather than
 * only that an error appeared.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: {
    listChecklist: jest.fn(),
    addChecklistItem: jest.fn(),
    updateChecklistItem: jest.fn(),
    deleteChecklistItem: jest.fn(),
    listNotes: jest.fn(),
    addNote: jest.fn(),
    updateNote: jest.fn(),
    deleteNote: jest.fn()
  }
}));

const getToken = jest.fn().mockResolvedValue('token-123');

const ITEM = { id: 1, trip_id: 7, label: 'Passport', is_done: false, position: 0 };
const NOTE = {
  id: 1,
  trip_id: 7,
  body: 'Booked the hotel',
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-03-01T10:00:00Z'
};

beforeEach(() => {
  jest.clearAllMocks();
  getToken.mockResolvedValue('token-123');
  tripService.listChecklist.mockResolvedValue([]);
  tripService.listNotes.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------
describe('the checklist ticks instantly, and takes it back if the server refuses', () => {
  test('a tick paints before the server answers', async () => {
    tripService.listChecklist.mockResolvedValue([ITEM]);
    // Never resolves, so anything on screen is there because of the optimistic update alone.
    tripService.updateChecklistItem.mockReturnValue(new Promise(() => {}));

    render(<TripChecklist tripId={7} getToken={getToken} />);
    const box = await screen.findByRole('button', { name: 'Passport' });

    await userEvent.click(box);

    expect(box).toHaveAttribute('aria-pressed', 'true');
  });

  test('a refused tick is rolled back, and the reader is told', async () => {
    // The assertion that makes the optimistic update honest rather than merely fast.
    tripService.listChecklist.mockResolvedValue([ITEM]);
    tripService.updateChecklistItem.mockRejectedValue(new Error('Could not update this item'));

    render(<TripChecklist tripId={7} getToken={getToken} />);
    const box = await screen.findByRole('button', { name: 'Passport' });

    await userEvent.click(box);

    await waitFor(() => expect(box).toHaveAttribute('aria-pressed', 'false'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update this item');
  });

  test('a tick sends is_done alone, so it cannot blank the label', async () => {
    // The client half of the bug the server's PATCH exists to prevent. A payload carrying the label
    // is one refactor away from carrying a stale one.
    tripService.listChecklist.mockResolvedValue([ITEM]);
    tripService.updateChecklistItem.mockResolvedValue({ ...ITEM, is_done: true });

    render(<TripChecklist tripId={7} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Passport' }));

    await waitFor(() =>
      expect(tripService.updateChecklistItem).toHaveBeenCalledWith(
        7,
        1,
        { is_done: true },
        'token-123'
      )
    );
  });

  test('the tick state is not carried by colour alone', async () => {
    // WCAG 1.4.1. `aria-pressed` is what a screen reader reports; a line-through and a tinted icon
    // are a visual convention it cannot see.
    tripService.listChecklist.mockResolvedValue([{ ...ITEM, is_done: true }]);

    render(<TripChecklist tripId={7} getToken={getToken} />);

    expect(await screen.findByRole('button', { name: 'Passport' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('adding is not optimistic — the row appears when the server says it exists', async () => {
    tripService.addChecklistItem.mockReturnValue(new Promise(() => {}));

    render(<TripChecklist tripId={7} getToken={getToken} />);
    await userEvent.type(screen.getByLabelText(/add a checklist item/i), 'Charger');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    // A row that appears and then vanishes is worse than one that takes a moment to appear.
    expect(screen.queryByRole('button', { name: 'Charger' })).not.toBeInTheDocument();
  });

  test('a null reply adds no row, rather than one the server never accepted', async () => {
    // `P5` survived the test above: it holds the add promise open forever, so it never reaches the
    // `if (created)` guard at all and cannot tell a guarded append from an unguarded one. A resolved
    // `null` — the malformed-response shape — is what separates them.
    tripService.addChecklistItem.mockResolvedValue(null);

    render(<TripChecklist tripId={7} getToken={getToken} />);
    await userEvent.type(screen.getByLabelText(/add a checklist item/i), 'Charger');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(tripService.addChecklistItem).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Charger' })).not.toBeInTheDocument();
    expect(screen.getByText(/nothing on the list yet/i)).toBeInTheDocument();
  });

  test('a blank label cannot be submitted at all', async () => {
    render(<TripChecklist tripId={7} getToken={getToken} />);

    await userEvent.type(screen.getByLabelText(/add a checklist item/i), '   ');

    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
    expect(tripService.addChecklistItem).not.toHaveBeenCalled();
  });

  test('a new item is appended, matching where the server puts it', async () => {
    tripService.listChecklist.mockResolvedValue([ITEM]);
    tripService.addChecklistItem.mockResolvedValue({
      ...ITEM,
      id: 2,
      label: 'Charger',
      position: 1
    });

    render(<TripChecklist tripId={7} getToken={getToken} />);
    await screen.findByRole('button', { name: 'Passport' });

    await userEvent.type(screen.getByLabelText(/add a checklist item/i), 'Charger');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    const labels = (await screen.findAllByRole('listitem')).map((li) => li.textContent);
    expect(labels[0]).toMatch(/Passport/);
    expect(labels[1]).toMatch(/Charger/);
  });

  test('an empty list says so, because it is empty for a reason about the reader', async () => {
    // Unlike `QuieterNearby`, which renders nothing: that panel is empty because nobody curated the
    // catalogue, which is a claim about the world. This one is empty because the reader has not
    // written in it yet.
    render(<TripChecklist tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/nothing on the list yet/i)).toBeInTheDocument();
  });

  test('a failed load is shown rather than swallowed', async () => {
    tripService.listChecklist.mockRejectedValue(new Error('Could not load the checklist'));

    render(<TripChecklist tripId={7} getToken={getToken} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the checklist');
  });
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
describe('a note is never shown as saved before it is saved', () => {
  test('a failed note keeps its text in the textarea', async () => {
    // The recovery path. Clearing the field and showing an error beside an empty box is how the
    // text is lost for good.
    tripService.addNote.mockRejectedValue(new Error('Could not save this note'));

    render(<TripNotes tripId={7} getToken={getToken} />);
    const box = screen.getByLabelText(/add a note/i);
    await userEvent.type(box, 'Ravi says take the 6am bus');
    await userEvent.click(screen.getByRole('button', { name: /add note/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this note');
    expect(box).toHaveValue('Ravi says take the 6am bus');
  });

  test('a saved note clears the box and appears at the top', async () => {
    tripService.listNotes.mockResolvedValue([NOTE]);
    tripService.addNote.mockResolvedValue({
      ...NOTE,
      id: 2,
      body: 'Ravi says take the 6am bus',
      created_at: '2026-03-02T10:00:00Z',
      updated_at: '2026-03-02T10:00:00Z'
    });

    render(<TripNotes tripId={7} getToken={getToken} />);
    await screen.findByText('Booked the hotel');

    await userEvent.type(screen.getByLabelText(/add a note/i), 'Ravi says take the 6am bus');
    await userEvent.click(screen.getByRole('button', { name: /add note/i }));

    await waitFor(() => expect(screen.getByLabelText(/add a note/i)).toHaveValue(''));
    // Newest first, matching the server's order — the list must not need a reload to be right.
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ravi says take the 6am bus');
  });

  test('the note is trimmed by the client that validated it, not left to the server', async () => {
    // `P12` survived every test above because none of them typed padded text. The trim is this
    // component's own — the button enables on `draft.trim()`, so sending the untrimmed draft means
    // validating one string and transmitting a different one, and at 4,999 characters plus two
    // spaces the server rejects what the client accepted.
    tripService.addNote.mockResolvedValue({ ...NOTE, id: 9, body: 'Booked the hotel' });

    render(<TripNotes tripId={7} getToken={getToken} />);
    await userEvent.type(screen.getByLabelText(/add a note/i), '  Booked the hotel  ');
    await userEvent.click(screen.getByRole('button', { name: /add note/i }));

    await waitFor(() =>
      expect(tripService.addNote).toHaveBeenCalledWith(7, 'Booked the hotel', 'token-123')
    );
  });

  test('a blank note cannot be submitted', async () => {
    render(<TripNotes tripId={7} getToken={getToken} />);

    await userEvent.type(screen.getByLabelText(/add a note/i), '   ');

    expect(screen.getByRole('button', { name: /add note/i })).toBeDisabled();
    expect(tripService.addNote).not.toHaveBeenCalled();
  });

  test('when a note was written is visible text, not a tooltip', async () => {
    // Part of what the note means. A `title` is not available to everyone reading it.
    tripService.listNotes.mockResolvedValue([NOTE]);

    render(<TripNotes tripId={7} getToken={getToken} />);

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText(/March 1, 2026/)).toBeInTheDocument();
  });

  test('"edited" appears only when the note was actually edited', async () => {
    // On every note it would be noise; on an unedited note it would be false.
    tripService.listNotes.mockResolvedValue([
      NOTE,
      { ...NOTE, id: 2, body: 'Changed my mind', updated_at: '2026-03-05T10:00:00Z' }
    ]);

    render(<TripNotes tripId={7} getToken={getToken} />);
    await screen.findByText('Booked the hotel');

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).queryByText(/edited/)).not.toBeInTheDocument();
    expect(within(items[1]).getByText(/edited/)).toBeInTheDocument();
  });

  test('a failed edit keeps the editor open, holding the text', async () => {
    tripService.listNotes.mockResolvedValue([NOTE]);
    tripService.updateNote.mockRejectedValue(new Error('Could not update this note'));

    render(<TripNotes tripId={7} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /edit note/i }));

    const editor = screen.getByLabelText(/edit note/i);
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Booked the hotel, room 3');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update this note');
    // Closing it would discard the edit that just failed to save.
    expect(screen.getByLabelText(/edit note/i)).toHaveValue('Booked the hotel, room 3');
  });

  test('line breaks in a note survive rendering', async () => {
    // A note is often a list. Collapsing it into a paragraph loses what it said.
    tripService.listNotes.mockResolvedValue([{ ...NOTE, body: 'Line one\nLine two' }]);

    render(<TripNotes tripId={7} getToken={getToken} />);

    const body = await screen.findByText(/Line one/);
    expect(body).toHaveClass('whitespace-pre-wrap');
  });

  test('deleting removes the note', async () => {
    tripService.listNotes.mockResolvedValue([NOTE]);
    tripService.deleteNote.mockResolvedValue(true);

    render(<TripNotes tripId={7} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /delete note/i }));

    await waitFor(() => expect(screen.queryByText('Booked the hotel')).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------
describe('the token is fetched per call, not held', () => {
  test('each request asks for a fresh token', async () => {
    // A token captured once goes stale on a workspace left open, and every write after that fails
    // with a 401 that reads like a permissions bug.
    tripService.listChecklist.mockResolvedValue([]);
    tripService.addChecklistItem.mockResolvedValue({ ...ITEM, id: 3, label: 'Charger' });

    render(<TripChecklist tripId={7} getToken={getToken} />);
    await waitFor(() => expect(tripService.listChecklist).toHaveBeenCalled());

    const afterLoad = getToken.mock.calls.length;

    await userEvent.type(screen.getByLabelText(/add a checklist item/i), 'Charger');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(getToken.mock.calls.length).toBeGreaterThan(afterLoad));
  });
});
