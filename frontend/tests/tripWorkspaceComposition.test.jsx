import { render, screen, within } from '@testing-library/react';
import TripWorkspace from '../src/pages/trips/[id]';

/**
 * `FV-006` stage (c) — the claim that a trip is **one surface**, asserted rather than assumed.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 * Every panel on this page is already tested on its own: `feasibilityPanel`, `dayRoute`,
 * `shareTripPanel`, `duplicateTripButton`, `exportCalendarButton`, `tripWorkspacePanels`. Not one of
 * them asserts that the panel is **on the trip page**, and that is exactly what stage (c) claims:
 *
 * > *(c) the workspace UI that puts them on one surface*
 *
 * Delete `<TripNotes />` from this page and every one of those suites still passes. The notes
 * component works perfectly; nothing renders it. **A composition claim needs a composition test**,
 * and the scope's own words are the assertion list — a trip owns the itinerary, saved places, notes
 * and a checklist as first-class children of the same object.
 *
 * ---------------------------------------------------------------------------
 * The specific trap this guards, which the item already fell into once
 * ---------------------------------------------------------------------------
 * `FV-006`'s own history is the argument. Stage (a) shipped and sat unticked for many sprints while
 * the tables, the lifecycle, the controller, two pages and two suites all existed — recorded in
 * `FUTURE_VISION.md` as *"the documentation is evidence, not authority"*. Stage (c) was drifting the
 * same way: the roadmap said it "has been arriving incrementally", which is a sentence nobody can
 * check.
 *
 * After this file, that sentence is checkable, and it fails if a panel quietly stops being rendered.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT asserted here
 * ---------------------------------------------------------------------------
 * **Three of the seven children in the scope are absent on purpose**, each owned by its own item, and
 * this file must not pretend otherwise:
 *
 *   - **documents and tickets** — `BL-145`. A boarding pass is an identity document; defaulting to
 *     Cloudinary because it is already wired would choose a store for somebody's passport scan by
 *     convenience. Needs a privacy decision and an ADR, not a schema.
 *
 * **Expenses joined the surface too** (`FV-008`), leaving one: documents.
 *
 * **Collaborators used to be on that list and no longer are** (`FV-007` stage (b)), which is the
 * shape this file was written for: a child arrives, and the assertion moves from "deliberately
 * absent" to "on the surface" in the same commit that puts it there. Five of the scope's seven.
 */

const mockRouter = { query: { id: '7' }, isReady: true, push: jest.fn() };
jest.mock('next/router', () => ({ useRouter: () => mockRouter }));

const mockAuth = { currentUser: { uid: 'u1' }, loading: false, getIdToken: jest.fn() };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));

/**
 * A two-day trip with one stop on day one.
 *
 * Small on purpose: this file is about *which panels render*, and a richer fixture would make a
 * failure here look like an itinerary bug. `dayRoute.test.jsx` owns the itinerary's own behaviour.
 */
const workspace = {
  trip: {
    id: 7,
    title: 'Karnataka in November',
    status: 'draft',
    start_date: '2026-11-01',
    end_date: '2026-11-02',
    days: [
      {
        id: 71,
        day_number: 1,
        items: [{ id: 711, title: 'Hampi bazaar', item_type: 'activity', position: 1 }]
      },
      { id: 72, day_number: 2, items: [] }
    ]
  },
  // `ready` rather than `loading` is the page's gate, and getting that wrong renders a spinner
  // forever - which is what the first draft of this file did.
  ready: true,
  error: null,
  busy: false,
  actionError: null,
  refresh: jest.fn(),
  feasibility: null,
  checking: false,
  feasibilityError: null,
  checkFeasibility: jest.fn(),
  replan: null,
  replanning: false,
  replanError: null,
  suggestReplan: jest.fn(),
  routeSuggestions: {},
  suggestRoute: jest.fn(),
  applyRouteSuggestion: jest.fn(),
  dayRoutes: {},
  drawingDay: null,
  drawDay: jest.fn(),
  addDay: jest.fn(),
  removeDay: jest.fn(),
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
  moveItem: jest.fn()
};
jest.mock('../src/hooks/useTripWorkspace', () => ({ useTripWorkspace: () => workspace }));

/** `IMP-108` feeding `IMP-109`: the saved list is the source for new stops. */
const wishlist = {
  places: [
    { id: 1, name: 'Hampi' },
    { id: 2, name: 'Gokarna' }
  ],
  loading: false,
  error: null,
  ready: true,
  refresh: jest.fn()
};
jest.mock('../src/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

/**
 * The three panels that fetch their own collections are stubbed to a recognisable marker.
 *
 * Their behaviour is not this file's subject and they each have a suite. What matters here is
 * whether the page renders them at all, so a stub that cannot pass by accident is the right double —
 * if the page stops rendering one, no marker appears and this fails.
 */
jest.mock('../src/components/trips/TripNotes', () => ({
  __esModule: true,
  default: ({ tripId }) => <div data-testid="trip-notes">notes for {tripId}</div>
}));
jest.mock('../src/components/trips/TripChecklist', () => ({
  __esModule: true,
  default: ({ tripId }) => <div data-testid="trip-checklist">checklist for {tripId}</div>
}));
jest.mock('../src/components/trips/ShareTripPanel', () => ({
  __esModule: true,
  default: ({ tripId }) => <div data-testid="share-panel">share for {tripId}</div>
}));
jest.mock('../src/components/trips/TripCollaborators', () => ({
  __esModule: true,
  default: ({ tripId }) => <div data-testid="collaborators">people for {tripId}</div>
}));
jest.mock('../src/components/trips/TripExpenses', () => ({
  __esModule: true,
  default: ({ tripId }) => <div data-testid="expenses">cost of {tripId}</div>
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('a trip is one workspace, not a list with satellites', () => {
  test('the itinerary, notes and checklist are all on the same page', () => {
    render(<TripWorkspace />);

    // The itinerary: the trip's own days, with the stop that is on one of them.
    expect(screen.getByRole('heading', { name: /karnataka in november/i })).toBeInTheDocument();
    expect(screen.getByText(/hampi bazaar/i)).toBeInTheDocument();

    // Stage (b)'s two children, on the same surface rather than behind a tab or another route.
    expect(screen.getByTestId('trip-checklist')).toBeInTheDocument();
    expect(screen.getByTestId('trip-notes')).toBeInTheDocument();

    // And the fifth and sixth children, as of `FV-007` stage (b) and `FV-008`.
    expect(screen.getByTestId('collaborators')).toBeInTheDocument();
    expect(screen.getByTestId('expenses')).toBeInTheDocument();
  });

  test('each of them is bound to this trip, not to a trip', () => {
    // A panel rendered with the wrong id is the failure that looks fine in a screenshot and shows
    // somebody else's notes. The stubs echo what they were given.
    //
    // **Anchored regexes, not strings** — and mutation `M2` is why. `toHaveTextContent` matches a
    // **substring**, so binding the checklist to `trip.days[0].id` (71) instead of `trip.id` (7)
    // rendered "checklist for 71" and satisfied `toHaveTextContent('checklist for 7')`. The test
    // passed while the panel was pointed at the wrong row. Every id here is a prefix of ids that
    // exist on this very fixture, which is what makes the substring form dangerous rather than
    // merely loose.
    render(<TripWorkspace />);

    expect(screen.getByTestId('trip-checklist')).toHaveTextContent(/^checklist for 7$/);
    expect(screen.getByTestId('trip-notes')).toHaveTextContent(/^notes for 7$/);
    expect(screen.getByTestId('share-panel')).toHaveTextContent(/^share for 7$/);
    expect(screen.getByTestId('collaborators')).toHaveTextContent(/^people for 7$/);
    expect(screen.getByTestId('expenses')).toHaveTextContent(/^cost of 7$/);
  });

  test('saved places are offered as the source for a new stop, on every day', () => {
    // `IMP-108` exists before `IMP-109` for this reason — discovery feeds planning — and the scope
    // lists saved places as a first-class child of the trip. Being able to reach them *while*
    // building is the difference between a workspace and a form.
    render(<TripWorkspace />);

    const forms = screen.getAllByRole('form', { name: /add an item/i });
    expect(forms).toHaveLength(2);

    for (const form of forms) {
      const select = within(form).getByRole('combobox', { name: /saved place/i });
      expect(within(select).getByRole('option', { name: 'Hampi' })).toBeInTheDocument();
      expect(within(select).getByRole('option', { name: 'Gokarna' })).toBeInTheDocument();
    }
  });

  test('what you do with the plan as a whole is reachable without leaving', () => {
    // `FV-009` and stage (d). These are one intention — doing something with the trip rather than
    // editing a stop in it — and a reader who has to go somewhere else to export is on a list page.
    render(<TripWorkspace />);

    expect(screen.getByRole('button', { name: /calendar|export|\.ics/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /printable version/i })).toHaveAttribute(
      'href',
      '/trips/7/print'
    );

    // The two ways a trip reaches somebody else, together, because choosing between them is one
    // decision: add a person, or hand out a link anybody holding can read.
    expect(screen.getByTestId('collaborators')).toBeInTheDocument();
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();
  });

  test('the feasibility and replan panels are present and silent until asked', () => {
    // `FV-025` and `FV-027`: both render a control and no verdict until somebody asks, so their
    // presence is asserted on the control rather than on an answer neither has yet.
    //
    // Named individually rather than with one `/check/i`, which matches both and fails as
    // "multiple elements found" - a message that reads like a broken test rather than like two
    // panels being present, which is what it actually means.
    render(<TripWorkspace />);

    expect(screen.getByRole('button', { name: /check this plan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check the forecast/i })).toBeInTheDocument();

    // Neither has produced a verdict, so nothing is shouting at the reader on arrival.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
