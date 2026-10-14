#!/usr/bin/env node
/**
 * Assert that the README's ER diagram describes the schema the migrations actually build.
 *
 * **Why this exists.** The README says its diagram was *"read out of a live database —
 * `information_schema` on a freshly migrated instance — rather than drawn from memory"*, and then
 * states two numbers: how many tables there are, and how many `REFERENCES` clauses. Both were true
 * when written. Neither was checked afterwards, and on 2026-09-07 the first one had already drifted:
 *
 *   - **`admin_audit_log` was missing entirely.** Migration `022` added it in Sprint 8.66, three
 *     controllers write to it, Sprint 8.68 built an admin page that reads it — and the diagram
 *     that claims to contain every table did not mention it. The sentence above it still said
 *     "sixteen", which was the count before that migration existed.
 *
 * That is the same failure `check-api-docs.mjs` was written for, one document over: a table of
 * things, maintained by hand, describing a set that grows in a different file. The route table
 * cannot drift any more. The schema could.
 *
 * **Why the count is checked separately from the list.** They fail differently. A missing entity is
 * a reader looking for a table and not finding it; a stale count is a reader trusting a diagram
 * that is *nearly* complete and never learning which part is missing. The second is worse, because
 * nothing about it looks wrong. Both are cheap to assert, so both are.
 *
 * **What this deliberately does not do.** It does not connect to a database. Every other guard in
 * `scripts/` asserts a property by reading text, runs on any laptop, and needs no service — and a
 * schema guard that required a live Postgres would run in exactly one CI job and nowhere else,
 * which is how a check stops being run before a change rather than after it. The cost is that this
 * reads the SQL rather than `information_schema`: it sees what the files declare, not what a server
 * made of them. For drift between two documents in this repository, that is the right resolution.
 *
 * **The parse was cross-checked against a live server once, by hand,** on a freshly migrated
 * database: `information_schema` reported the same 17 tables and the same 12 foreign keys this file
 * computes from the text. That is not a substitute for the guard — it is how the guard was shown to
 * agree with the thing it is standing in for. It also turned up the one honest discrepancy: `\dt`
 * shows **eighteen** tables, because `migrate.js` creates `schema_migrations` to record its own
 * progress. That table is the runner's bookkeeping, is created by no file here, and is excluded —
 * the README now says so out loud, so a reader who counts does not conclude the diagram is short.
 *
 * Same class as `check-api-docs.mjs`, `check-env-docs.mjs` and `check-test-counts.mjs`: a
 * falsifiable claim about the repository, not a test — it makes no claim about behaviour.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const MIGRATIONS_DIR = join(ROOT, 'backend/src/config/migrations');
const MIGRATIONS_README = join(MIGRATIONS_DIR, 'README.md');
const SCHEMA = join(ROOT, 'backend/src/config/schema.sql');

/**
 * Strip `--` line comments before looking for DDL.
 *
 * These files are more comment than SQL on purpose — `022`'s header is fifty lines arguing why the
 * table is allowed to exist — and those comments quote DDL. `check-theme-vocabulary.mjs` was bitten
 * by exactly this (Sprint 8.66): a comment inside an array literal donated a phantom entry to a
 * vocabulary. Stripping first is the fix that guard landed on; this one starts with it.
 */
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

/**
 * Every table the schema builds, mapped to the file that creates it.
 *
 * `schema.sql` is read first because it is the fresh-database path and runs first; a migration's
 * `CREATE TABLE IF NOT EXISTS` for a table it already made is a no-op, and attributing the table to
 * the file that actually creates it makes the failure message point somewhere useful.
 */
const declaredTables = () => {
  const files = [
    ['schema.sql', SCHEMA],
    ...readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => [f, join(MIGRATIONS_DIR, f)])
  ];

  const tables = new Map();
  for (const [label, path] of files) {
    const sql = stripComments(readFileSync(path, 'utf8'));
    for (const [, name] of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+)/gi)) {
      const table = name.toLowerCase();
      if (!tables.has(table)) tables.set(table, label);
    }
  }
  return tables;
};

/**
 * Every inline `REFERENCES` clause, counted once per column.
 *
 * Counted from the same union as the tables and deduplicated the same way, so a table defined in
 * `schema.sql` and re-declared by a migration contributes its foreign keys once. `schema_migrations`
 * is the runner's own bookkeeping table, created by `migrate.js` rather than by a file here, and it
 * is not part of the application schema the README describes.
 */
const declaredReferences = () => {
  const seen = new Set();
  const files = [
    SCHEMA,
    ...readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => join(MIGRATIONS_DIR, f))
  ];

  for (const path of files) {
    const sql = stripComments(readFileSync(path, 'utf8'));
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+)\s*\(/gi;
    let match;
    while ((match = create.exec(sql))) {
      const table = match[1].toLowerCase();
      // Walk to the matching close paren so a column list cannot run into the next statement.
      let depth = 0;
      let i = create.lastIndex - 1;
      const start = i;
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')' && --depth === 0) break;
      }
      const body = sql.slice(start + 1, i);
      for (const [, column] of body.matchAll(/([a-z_]+)\s+[a-z ]*?references\s+[a-z_]+/gi)) {
        seen.add(`${table}.${column.toLowerCase()}`);
      }
    }
  }
  return seen;
};

/**
 * The entities named by the README's `erDiagram`, from both the relationships and the detail blocks.
 *
 * A table can appear as either and counts either way: several tables are drawn only as a
 * relationship because, as the README puts it, nothing about them is surprising, and `users`
 * appears only as a block because nothing references it.
 */
const diagrammedEntities = (readme) => {
  const block = /```mermaid\s*\nerDiagram\n([\s\S]*?)```/.exec(readme);
  if (!block) return null;

  const entities = new Set();
  const detailed = new Set();
  for (const line of block[1].split('\n')) {
    const relationship = /^\s*([a-z_]+)\s+[|}o{.-]+\s+([a-z_]+)\s*:/i.exec(line);
    if (relationship) {
      entities.add(relationship[1].toLowerCase());
      entities.add(relationship[2].toLowerCase());
      continue;
    }
    const detail = /^\s*([a-z_]+)\s*\{\s*$/i.exec(line);
    if (detail) {
      entities.add(detail[1].toLowerCase());
      detailed.add(detail[1].toLowerCase());
    }
  }
  return { entities, detailed };
};

/**
 * `"seventeen"` and `"17"` both mean 17.
 *
 * The prose here spells small numbers, and a guard that forced `All 17 tables` into a sentence
 * would be trading the document's readability for the checker's convenience. Supporting both costs
 * a lookup table.
 */
const WORDS = new Map(
  [
    'zero,one,two,three,four,five,six,seven,eight,nine,ten',
    'eleven,twelve,thirteen,fourteen,fifteen,sixteen,seventeen,eighteen,nineteen,twenty',
    'twenty-one,twenty-two,twenty-three,twenty-four,twenty-five,twenty-six,twenty-seven',
    'twenty-eight,twenty-nine,thirty'
  ]
    .join(',')
    .split(',')
    .map((word, value) => [word, value])
);

const parseCount = (raw) => {
  const text = raw.toLowerCase().replace(/,/g, '');
  if (/^\d+$/.test(text)) return Number(text);
  return WORDS.has(text) ? WORDS.get(text) : null;
};

/** The README's own sentence about the diagram, which is the claim this guard exists to check. */
const CLAIM =
  /All ([\w-]+) (?:application )?tables and every one of the ([\w-]+) `REFERENCES` clauses are (?:here|drawn)/i;

const failures = [];

const readme = readFileSync(README, 'utf8');

/**
 * The README hard-wraps at 100 columns, so any sentence long enough to be worth checking is long
 * enough to contain a newline — and where it falls moves whenever a word is edited earlier in the
 * paragraph. Both claim regexes run against a whitespace-collapsed copy so that re-wrapping a
 * paragraph cannot fail a guard about its content. (Found immediately: adding six words to the
 * sentence below pushed `are here` onto the next line and the guard reported it as missing.)
 */
const prose = readme.replace(/\s+/g, ' ');

const tables = declaredTables();
const references = declaredReferences();
const diagram = diagrammedEntities(readme);
const entities = diagram?.entities ?? null;

// ---- Check 1: the diagram lists every table, and no others -----------------------------------

if (entities === null) {
  failures.push(
    '  MISSING     README.md no longer contains a ```mermaid / erDiagram block. The schema diagram\n' +
      '              is a Phase 14 deliverable; if it moved, point this guard at where it went.'
  );
} else {
  for (const [table, file] of [...tables].sort()) {
    if (!entities.has(table)) {
      failures.push(
        `  UNDIAGRAMMED  ${table} — created by ${file}, absent from the README's erDiagram`
      );
    }
  }
  for (const entity of [...entities].sort()) {
    if (!tables.has(entity)) {
      failures.push(
        `  PHANTOM       ${entity} — drawn in the README's erDiagram, created by no .sql file`
      );
    }
  }
}

// ---- Check 2: the two numbers beside it ------------------------------------------------------

const claim = CLAIM.exec(prose);
if (!claim) {
  failures.push(
    '  MISSING     README no longer contains the "All N tables and every one of the M `REFERENCES`\n' +
      '              clauses are here" sentence. It is the claim this guard checks — restore it or\n' +
      '              retire the guard deliberately.'
  );
} else {
  const claimedTables = parseCount(claim[1]);
  const claimedReferences = parseCount(claim[2]);

  if (claimedTables === null) {
    failures.push(
      `  UNREADABLE  README says "${claim[1]} tables" — not a number this guard can parse`
    );
  } else if (claimedTables !== tables.size) {
    failures.push(
      `  COUNT       README says ${claim[1]} tables; the .sql files create ${tables.size}`
    );
  }

  if (claimedReferences === null) {
    failures.push(
      `  UNREADABLE  README says "${claim[2]} \`REFERENCES\` clauses" — not a number this guard can parse`
    );
  } else if (claimedReferences !== references.size) {
    failures.push(
      `  COUNT       README says ${claim[2]} \`REFERENCES\` clauses; the .sql files declare ${references.size}`
    );
  }
}

// ---- Check 2b: the sentence that accounts for the tables it did not detail ---------------------

/**
 * *"Seven tables carry no detail block above because nothing about them is surprising."*
 *
 * Included because this one had drifted too, and more quietly than the headline count: it said
 * "Five", listed six tables, and one of the six had a detail block. A reader counting the diagram
 * against that sentence finds three different answers. It is derivable — entities minus entities
 * with blocks — so nothing is gained by leaving it typed.
 */
const UNDETAILED_CLAIM = /([\w-]+) tables carry no detail block above/i;

if (entities !== null) {
  const undetailed = [...entities].filter((entity) => !diagram.detailed.has(entity));
  const claimed = UNDETAILED_CLAIM.exec(prose);

  if (!claimed) {
    failures.push(
      '  MISSING     README no longer contains the "N tables carry no detail block above" sentence.'
    );
  } else {
    const stated = parseCount(claimed[1]);
    if (stated === null) {
      failures.push(
        `  UNREADABLE  README says "${claimed[1]} tables carry no detail block" — not a parseable number`
      );
    } else if (stated !== undetailed.length) {
      failures.push(
        `  COUNT       README says ${claimed[1]} tables carry no detail block; the diagram leaves ` +
          `${undetailed.length} undetailed (${undetailed.sort().join(', ')})`
      );
    }
  }
}

// ---- Check 2c: this guard's own row in the guards table ---------------------------------------

/**
 * The guards table summarises this check as *"(17 today)"*, and a hand-typed number beside a
 * guarded one is the drift this file exists to prevent. `check-api-docs.mjs` carries the same
 * assertion for its own row, added in the same sprint after its parenthetical was found one behind.
 */
const summaryRow = /\|\s*`check:schema-docs`\s*\|[^|]*?\((\d+) today\)/.exec(readme);
if (summaryRow && Number(summaryRow[1]) !== tables.size) {
  failures.push(
    `  SUMMARY     README's guards table says "(${summaryRow[1]} today)"; there are ${tables.size} tables`
  );
}

// ---- Check 3: every migration is described where migrations are described ---------------------

/**
 * Filenames from the **table** in the migrations README, not from its prose.
 *
 * Rule 1 there uses `010_x.sql` as an illustration of zero-padding. Reading filenames from the whole
 * document would demand a migration that was never meant to exist — a guard failing on its own
 * documentation's example is how a guard gets deleted instead of fixed.
 */
const describedMigrations = () => {
  const text = readFileSync(MIGRATIONS_README, 'utf8');
  const described = new Set();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cell = /^\|\s*`([0-9]{3}_[a-z0-9_]+\.sql)`/.exec(line);
    if (cell) described.add(cell[1]);
  }
  return described;
};

const onDisk = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^[0-9]{3}_.*\.sql$/.test(f))
  .sort();
const described = describedMigrations();

for (const file of onDisk) {
  if (!described.has(file)) {
    failures.push(
      `  UNDESCRIBED   ${file} — applied by the runner, absent from migrations/README.md's table`
    );
  }
}
for (const file of [...described].sort()) {
  if (!onDisk.includes(file)) {
    failures.push(`  PHANTOM       ${file} — described in migrations/README.md, no such file`);
  }
}

// ---- Report -----------------------------------------------------------------------------------

if (failures.length === 0) {
  console.log(
    `  OK  ${tables.size} tables and ${references.size} \`REFERENCES\` clauses, all diagrammed; ` +
      `${onDisk.length} migrations, all described`
  );
  process.exit(0);
}

for (const failure of failures) console.error(failure);
console.error(
  `\n  ${failures.length} schema documentation problem(s). The .sql files are the source of truth:\n` +
    '  update README.md\'s erDiagram and its "All N tables" sentence, or migrations/README.md, to\n' +
    '  match what the migrations build.'
);
process.exit(1);
