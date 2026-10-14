/**
 * Reads the migration directory. Shared by the runner (`script/migrate.js`, which applies them)
 * and by `app.js` (which only reports what is pending at boot), so the two can never disagree
 * about which files exist or what order they run in.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Every `.sql` file in the migrations directory, in applied order, with a checksum.
 *
 * Order is lexical, which is why filenames are zero-padded to three digits: at `010_` an unpadded
 * scheme would sort before `002_` and apply out of order.
 *
 * Checksums are normalised to LF first. Without that, the same file checks out with CRLF on
 * Windows and LF in CI and the two hash differently — which the runner would report as a migration
 * having been tampered with after it was applied.
 */
const listMigrationFiles = () =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      return {
        name,
        sql,
        checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
      };
    });

module.exports = { listMigrationFiles, MIGRATIONS_DIR };
