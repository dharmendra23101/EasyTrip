/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');

/**
 * Every page under `pages/admin/` must be gated server-side (`IMP-054`).
 *
 * **This is a structural assertion, not a behavioural one**, and it exists because the failure it
 * guards is invisible: a page missing `getServerSideProps = requireAdminPage` looks identical in
 * development, passes every other test, and works perfectly for an admin. The only symptom is that
 * an anonymous visitor is served the admin shell before the client-side redirect fires.
 *
 * It was written because that had already happened. `admin/users.jsx` was the one page of five
 * without the gate — found in Sprint 7.10 while adding a sixth, which is precisely when an omission
 * like this gets copied rather than noticed.
 *
 * Deliberately reads the source text rather than importing the modules: importing a Next page pulls
 * in React, the auth context and Firebase, and this needs to know one thing about a file.
 */

const ADMIN_PAGES_DIR = path.join(__dirname, '../src/pages/admin');

/** Every page file under `pages/admin/`, recursively — `editPlace/[id].jsx` is one level down. */
const adminPages = (dir = ADMIN_PAGES_DIR, prefix = 'admin') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return adminPages(full, `${prefix}/${entry.name}`);
    if (!/\.(jsx?|tsx?)$/.test(entry.name)) return [];
    return [{ route: `${prefix}/${entry.name}`, path: full }];
  });

describe('server-side admin gating (IMP-054)', () => {
  const pages = adminPages();

  test('the directory is actually being scanned', () => {
    // Without this, a broken glob turns the suite below into zero assertions that pass — the same
    // failure mode as a `describe` with no tests in it.
    expect(pages.length).toBeGreaterThanOrEqual(5);
    expect(pages.map((p) => p.route)).toEqual(
      expect.arrayContaining(['admin/index.jsx', 'admin/editPlace/[id].jsx'])
    );
  });

  test.each(adminPages().map((p) => [p.route, p.path]))(
    '%s exports the server-side gate',
    (route, file) => {
      const source = fs.readFileSync(file, 'utf8');

      expect(source).toMatch(/from '.*services\/adminGate'/);
      // The export itself, not just the import — importing it and forgetting to export it is the
      // shape this would otherwise miss.
      expect(source).toMatch(/export const getServerSideProps\s*=\s*requireAdminPage/);
    }
  );

  test('no admin page relies on a client-side redirect alone', () => {
    // The inverse phrasing of the rule, so the failure message names the actual risk rather than a
    // missing string.
    const ungated = adminPages().filter(
      ({ path: file }) =>
        !/export const getServerSideProps\s*=\s*requireAdminPage/.test(
          fs.readFileSync(file, 'utf8')
        )
    );

    expect(ungated.map((p) => p.route)).toEqual([]);
  });
});
