import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { sortOptions } from '../src/components/browse/browseOptions';

/**
 * The relevance sort, on the client side (`IMP-112`).
 *
 * The server decides what actually runs — `relevance` with no search term resolves to `newest`
 * (`placeModel.listPlaces`, guarded in `backend/tests/search.test.js`). What is asserted here is
 * the *other* half of that rule: that the control never labels an order the query is not using.
 *
 * A stand-in for the dropdown is rendered rather than the whole browse page. `browse.jsx` needs a
 * router, an auth context, an IntersectionObserver and a server payload before it will mount, and
 * a test that assembled all four to check which two strings appear in a menu would be a test of the
 * scaffolding. The logic under test is the three lines this component reproduces verbatim.
 */

const SortMenu = ({ searchTerm }) => {
  const [sortPreference, setSortPreference] = useState('relevance');

  // Verbatim from `browse.jsx`. If that rule changes and this does not, the assertions below stop
  // describing the page — which is the known cost of a stand-in, and why the rule is three lines.
  const canSortByRelevance = Boolean(searchTerm);
  const sortOrder =
    sortPreference === 'relevance' && !canSortByRelevance ? 'newest' : sortPreference;

  return (
    <div>
      <span data-testid="label">Sort: {sortOptions.find((s) => s.id === sortOrder)?.label}</span>
      <ul data-testid="menu">
        {sortOptions
          .filter((option) => option.id !== 'relevance' || canSortByRelevance)
          .map((option) => (
            <li key={option.id}>
              <button onClick={() => setSortPreference(option.id)}>{option.label}</button>
            </li>
          ))}
      </ul>
    </div>
  );
};

describe('browse sort — relevance is offered only when it means something', () => {
  test('an unsearched catalogue does not offer "Best Match"', () => {
    render(<SortMenu searchTerm="" />);
    const menu = within(screen.getByTestId('menu'));
    expect(menu.queryByText('Best Match')).toBeNull();
    expect(menu.getByText('Newest First')).toBeInTheDocument();
  });

  test('and labels itself with the order that is actually running', () => {
    // The preference is `relevance`, but with nothing to rank the server runs `newest`. Showing
    // "Sort: Best Match" here would be the control claiming an ordering the results do not have.
    render(<SortMenu searchTerm="" />);
    expect(screen.getByTestId('label')).toHaveTextContent('Sort: Newest First');
  });

  test('a search term brings the option back, selected by default', () => {
    render(<SortMenu searchTerm="temple" />);
    expect(within(screen.getByTestId('menu')).getByText('Best Match')).toBeInTheDocument();
    expect(screen.getByTestId('label')).toHaveTextContent('Sort: Best Match');
  });

  test('an explicit choice survives — the default does not fight the user', async () => {
    const user = userEvent.setup();
    render(<SortMenu searchTerm="temple" />);

    await user.click(screen.getByRole('button', { name: 'Alphabetical' }));
    expect(screen.getByTestId('label')).toHaveTextContent('Sort: Alphabetical');
  });

  test('"Best Match" is the first option, because it is the default', () => {
    render(<SortMenu searchTerm="temple" />);
    const labels = within(screen.getByTestId('menu'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels[0]).toBe('Best Match');
  });

  test('every sort option the UI offers is one the API accepts', () => {
    // The server's enum is `placeModel.SORT_KEYS`, and the validator enumerates from it. This is
    // the third copy — the labels a user can click — and the failure it guards against is the one
    // `m1` actually had: a dropdown entry the server has never implemented, which returns 200 with
    // the default order and reads as "sorting is broken" rather than as an error.
    const apiSortKeys = ['newest', 'oldest', 'rating', 'popular', 'name', 'relevance'];
    for (const option of sortOptions) {
      expect(apiSortKeys).toContain(option.id);
    }
  });
});
