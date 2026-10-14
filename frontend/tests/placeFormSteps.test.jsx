import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubmittingSummary } from '../src/components/admin/placeForm/SubmittingSummary';
import { StepLocation } from '../src/components/admin/placeForm/StepLocation';
import { StepMediaThemes } from '../src/components/admin/placeForm/StepMediaThemes';
import { collectErrors, collectStepErrors, emptyPlaceForm } from '../src/utils/placeFormValidation';

/**
 * The add-place wizard's progress copy and step navigation (`IMP-125`).
 *
 * **Why copy gets a test at all.** `ef7a25f` fixed the in-flight panel claiming *"Uploading image
 * to Firebase Storage"* when images have only ever gone to Cloudinary, and *"Setting up admin
 * permissions"* for a request that grants nobody anything. It shipped without one, and this
 * project's own position on that is written down: a fix with no test has a half-life. Copy is a
 * worse case than most — nothing compiles it, nothing type-checks it, and the reader who is misled
 * by it is an admin building a mental model of where their data went. The failure mode is somebody
 * reinstating a plausible-sounding line, and no other layer would notice.
 *
 * **Why the navigation gets one.** Steps 2 and 3 rendered the same block twice; `StepNavigation`
 * now renders it once. The mistake an extraction like that makes is not visual — it is wiring the
 * two `goToStep` targets to the wrong steps, which looks correct and moves the user backwards.
 * These assertions drive the real buttons on the real steps rather than the shared component, so
 * they fail if the wiring is wrong even when the component itself is fine.
 */

const form = (overrides = {}) => ({
  formData: {
    district: '',
    state: '',
    locality: '',
    pin_code: '',
    latitude: '',
    longitude: '',
    themes: [],
    ...overrides.formData
  },
  errors: {},
  handleChange: jest.fn(),
  handleThemeToggle: jest.fn(),
  handleImageChange: jest.fn(),
  handleImageRemove: jest.fn(),
  goToStep: jest.fn(),
  ...overrides
});

describe('the in-flight panel only claims what the request does (IMP-125)', () => {
  test('it names Cloudinary — the service the upload actually goes to', () => {
    render(<SubmittingSummary isSubmitting primaryImage={{ name: 'shot.png' }} />);
    expect(screen.getByText(/Uploading image to Cloudinary/i)).toBeInTheDocument();
  });

  test('it never names Firebase as the destination for an image', () => {
    // The exact regression `ef7a25f` fixed. Firebase is real in this app — it is the auth
    // provider — which is presumably how the wrong service name arrived here in the first place,
    // and is why this asserts on the *rendered* text rather than on the file.
    render(<SubmittingSummary isSubmitting primaryImage={{ name: 'shot.png' }} />);
    expect(document.body).not.toHaveTextContent(/firebase/i);
    expect(document.body).not.toHaveTextContent(/storage/i);
  });

  test('it does not claim to set up permissions', () => {
    render(<SubmittingSummary isSubmitting primaryImage={{ name: 'shot.png' }} />);
    expect(document.body).not.toHaveTextContent(/permission/i);
  });

  test('with no image chosen it does not claim an upload at all', () => {
    // The other half of the same defect: a step that is listed unconditionally describes work the
    // request skips whenever the admin left the image blank.
    render(<SubmittingSummary isSubmitting primaryImage={null} />);
    expect(document.body).not.toHaveTextContent(/uploading/i);
    expect(screen.getByText(/Preparing place data/i)).toBeInTheDocument();
  });

  test('it renders nothing at all when no request is in flight', () => {
    // Guards the assertions above from passing vacuously: they must be looking at a panel that
    // renders, not at an empty document.
    const { container } = render(<SubmittingSummary isSubmitting={false} primaryImage={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the shared step navigation is wired to the right steps (IMP-125)', () => {
  const cases = [
    { name: 'Location Details', Step: StepLocation, back: 1, forward: 3, label: /Media & Themes/i },
    { name: 'Media & Themes', Step: StepMediaThemes, back: 2, forward: 4, label: /Tags & Details/i }
  ];

  test.each(cases)('$name renders exactly one Previous and one Next', ({ Step }) => {
    render(<Step form={form()} />);
    expect(screen.getAllByRole('button', { name: /Previous/i })).toHaveLength(1);
  });

  test.each(cases)('$name goes back to step $back', async ({ Step, back }) => {
    const f = form();
    render(<Step form={f} />);
    await userEvent.click(screen.getByRole('button', { name: /Previous/i }));
    expect(f.goToStep).toHaveBeenCalledWith(back);
  });

  test.each(cases)('$name goes forward to step $forward', async ({ Step, forward, label }) => {
    const f = form();
    render(<Step form={f} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(f.goToStep).toHaveBeenCalledWith(forward);
  });

  test.each(cases)('$name names its destination on the Next button', ({ Step, label }) => {
    // A label that says "Next" and nothing else is the drift this catches: the wizard tells the
    // admin where they are going, and the two steps must not both claim the same destination.
    render(<Step form={form()} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  test('both steps render the navigation identically — that is what sharing it means', () => {
    // The deduplication property itself. If someone re-inlines one of the two blocks and it drifts
    // by a class, this fails even though every assertion above still passes.
    const classesOf = (Step) => {
      const { unmount } = render(<Step form={form()} />);
      const previous = screen.getByRole('button', { name: /Previous/i });
      const row = previous.parentElement;
      const next = within(row)
        .getAllByRole('button')
        .find((b) => b !== previous);
      const shape = [row.className, previous.className, next.className];
      unmount();
      return shape;
    };

    const [locationRow, locationPrev, locationNext] = classesOf(StepLocation);
    expect(classesOf(StepMediaThemes)).toEqual([locationRow, locationPrev, locationNext]);
    // Not a comparison of two empty strings.
    expect(locationRow).toContain('justify-between');
    expect(locationNext).toContain('bg-primary-600');
  });
});

// ---------------------------------------------------------------------------
// Surveying a place while creating it (`BL-138`)
// ---------------------------------------------------------------------------
describe('accessibility on the create wizard', () => {
  test('a new form starts unsurveyed, and that is a complete answer', () => {
    // The API has accepted these on create since Sprint 8.33; what was missing was a control. A
    // create that says nothing must still produce a valid, unsurveyed place.
    const form = emptyPlaceForm();

    expect(form.step_free_access).toBe('unknown');
    expect(form.accessible_restroom).toBe('unknown');
    expect(form.accessibility_source).toBe('');
    expect(collectErrors({ ...form, name: 'A Place', location: 'Somewhere' }, null)).toEqual({});
  });

  test('the survey is on the wizard step, not only on the edit form', () => {
    // `BL-138` is about the control existing here at all — the validation tests below pass whether
    // or not it is rendered, which a mutation removing it proved.
    render(<StepMediaThemes form={form({ formData: { ...emptyPlaceForm() } })} />);

    // Presence, not visibility: framer-motion renders this step at `opacity: 0` until an animation
    // that jsdom never runs, so `toBeVisible` fails for every element on it. The rest of this file
    // asserts the same way for the same reason.
    expect(
      screen.getByRole('heading', { name: /Getting in and getting around/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Step-free access')).toBeInTheDocument();
  });

  test('a new place starts unsurveyed on screen as well as in the data', () => {
    render(<StepMediaThemes form={form({ formData: { ...emptyPlaceForm() } })} />);

    // `Not surveyed` selected for both axes, and no provenance asked for — the same restraint the
    // edit form shows, because an admin nudged out of `unknown` produces guesses.
    expect(
      screen.getByLabelText(/Not surveyed/, { selector: '#step_free_access-unknown' })
    ).toBeChecked();
    expect(screen.queryByLabelText(/Where did this come from/)).not.toBeInTheDocument();
  });

  test('an unattributed claim is an error on the step that collects it', () => {
    // Without `accessibility_source` in `STEP_FIELDS[3]` the wizard would let this past step 3 and
    // then refuse the final submit with a message keyed to a field no visible step owns — blocked,
    // with nothing on screen to explain why.
    const form = {
      ...emptyPlaceForm(),
      name: 'A Place',
      location: 'Somewhere',
      step_free_access: 'yes'
    };

    expect(collectStepErrors(3, form, null)).toHaveProperty('accessibility_source');
  });

  test('and a complete survey clears it', () => {
    const form = {
      ...emptyPlaceForm(),
      name: 'A Place',
      location: 'Somewhere',
      step_free_access: 'yes',
      accessibility_source: 'site_visit',
      accessibility_checked_on: '2026-08-01'
    };

    expect(collectStepErrors(3, form, null)).toEqual({});
    expect(collectErrors(form, null)).toEqual({});
  });

  test('the earlier steps are not blocked by a later step’s field', () => {
    // Step 3's error must not leak into steps 1 and 2, or an admin who has not reached the survey
    // yet cannot advance past the name.
    const form = {
      ...emptyPlaceForm(),
      name: 'A Place',
      location: 'Somewhere',
      step_free_access: 'yes'
    };

    expect(collectStepErrors(1, form, null)).toEqual({});
    expect(collectStepErrors(2, form, null)).toEqual({});
  });
});
