/**
 * @module commands/introspect
 * scrml introspect subcommand — read a LIVE Postgres database's schema and emit
 * the equivalent scrml `<schema>` source (BaaS #3). Eases adopter migration:
 * bring an existing Postgres database into a scrml `<schema>` block.
 *
 * Usage:
 *   scrml introspect <postgres-url> [--out <file.scrml>] [--table <name>]
 *
 * Options:
 *   --out <file>     Write the emitted <schema> source to <file> (default: stdout)
 *   --table <name>   Emit only the named table (default: all base tables)
 *   --help, -h       Show this message
 *
 * Postgres-only (v1). A non-postgres URL is a clean error — introspect reads
 * `information_schema`, which the SQLite path does not expose the same way.
 *
 * The emitted <schema> SOURCE goes to stdout (or --out); status lines and any
 * W-INTROSPECT-* warnings go to stderr, so `scrml introspect ... > schema.scrml`
 * pipes clean source.
 */

import { writeFileSync } from "fs";
import { resolve } from "path";
import { SQL } from "bun";
import { resolveDbDriver } from "../codegen/db-driver.ts";
import { readActualSchemaPg, emitScrmlSchemaSource, readTableNamesPg } from "../schema-differ.js";

const isTTY = process.stderr.isTTY;
const c = {
  red: (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  dim: (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

function printHelp() {
  console.log(`scrml introspect — read a live Postgres schema, emit scrml <schema> source

Usage:
  scrml introspect <postgres-url> [--out <file.scrml>] [--table <name>]

Options:
  --out <file>     Write the emitted <schema> source to <file> (default: stdout)
  --table <name>   Emit only the named table (default: all base tables)
  --help, -h       Show this message

Postgres-only (v1). Reads base tables + columns + single-column PRIMARY KEY /
NOT NULL / UNIQUE / DEFAULT / FOREIGN KEY. CHECK constraints, composite keys,
indexes, enums, views and sequences are not recovered (serial -> integer).`);
}

/**
 * Parse the introspect argv. Returns { url, outFile, tableFilter, help } or
 * exits(1) on an unrecognized flag.
 */
function parseArgs(args) {
  let url = null;
  let outFile = null;
  let tableFilter = null;
  let help = false;

  // A flag that takes a value (`--out <x>` / `--table <x>`) must be followed by
  // that value — otherwise `args[++i]` is undefined and the flag would silently
  // no-op (e.g. `--out` as the last arg would dump to stdout).
  const requireValue = (flag, i, what) => {
    if (i + 1 >= args.length) {
      console.error(c.red("error:") + ` ${flag} requires ${what}`);
      console.error(c.dim("Run `scrml introspect --help` for usage."));
      process.exit(1);
    }
  };
  const requireNonEmpty = (flag, value, what) => {
    if (value === "") {
      console.error(c.red("error:") + ` ${flag} requires ${what}`);
      console.error(c.dim("Run `scrml introspect --help` for usage."));
      process.exit(1);
    }
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--out") {
      requireValue("--out", i, "a file path");
      outFile = args[++i];
    } else if (a.startsWith("--out=")) {
      outFile = a.slice("--out=".length);
      requireNonEmpty("--out", outFile, "a file path");
    } else if (a === "--table") {
      requireValue("--table", i, "a table name");
      tableFilter = args[++i];
    } else if (a.startsWith("--table=")) {
      tableFilter = a.slice("--table=".length);
      requireNonEmpty("--table", tableFilter, "a table name");
    } else if (!a.startsWith("-") && url === null) {
      url = a;
    } else {
      console.error(c.red("error:") + ` unrecognized argument: ${a}`);
      console.error(c.dim("Run `scrml introspect --help` for usage."));
      process.exit(1);
    }
  }

  return { url, outFile, tableFilter, help };
}

export async function runIntrospect(args) {
  const { url, outFile, tableFilter, help } = parseArgs(args);

  if (help) {
    printHelp();
    return;
  }

  if (!url) {
    console.error(c.red("error:") + " scrml introspect requires a Postgres connection URL");
    console.error(c.dim("Run `scrml introspect --help` for usage."));
    process.exit(1);
  }

  // Validate the URL resolves to the Postgres driver — introspect is
  // Postgres-only in v1 (it reads information_schema).
  const resolved = resolveDbDriver(url);
  if (!resolved.ok) {
    console.error(c.red("error:") + " " + resolved.error.message);
    process.exit(1);
  }
  if (resolved.info.driver !== "postgres") {
    console.error(
      c.red("error:") +
        ` scrml introspect is Postgres-only (v1). The URL "${url}" resolves to the ` +
        `"${resolved.info.driver}" driver. Provide a postgres:// or postgresql:// URL.`,
    );
    process.exit(1);
  }

  let source;
  let warnings;
  let emittedTables;
  let droppedCount;
  let sql;
  try {
    // Constructing the handle can throw synchronously on a malformed (but
    // postgres-prefixed) URL (`postgres://host:notaport/db`) — keep it INSIDE
    // the try so it surfaces as a clean error, not an unhandled rejection.
    sql = new SQL(resolved.info.connectionString);

    // `--table` reads ONLY the requested table (the filter is pushed,
    // parameterized, into the tables query) — 3 queries, not 2N+1, and the
    // read-side warnings scope naturally to the requested table.
    const { tables, warnings: readWarnings } = await readActualSchemaPg(sql, { tableFilter });

    // A `--table <name>` typo must be a loud error, not a silent empty schema.
    // We only read the requested table, so list the available names on demand.
    if (tableFilter && tables.length === 0) {
      const names = await readTableNamesPg(sql);
      const available = names.join(", ") || "(none)";
      console.error(
        c.red("error:") +
          ` table "${tableFilter}" not found in the database. Available: ${available}`,
      );
      await closeSql(sql);
      process.exit(1);
      return;
    }

    const emitted = emitScrmlSchemaSource({ tables }, { tableFilter });
    source = emitted.source;
    warnings = [...(readWarnings ?? []), ...emitted.warnings];
    emittedTables = emitted.emittedTables;
    droppedCount = emitted.droppedCount;
  } catch (err) {
    console.error(c.red("error:") + ` failed to introspect Postgres schema: ${err.message}`);
    if (sql) await closeSql(sql);
    process.exit(1);
    return;
  }
  await closeSql(sql);

  // Warnings + status → stderr (keep stdout clean for `> schema.scrml`).
  for (const w of warnings) {
    console.error(w);
  }
  if (droppedCount > 0) {
    console.error(
      c.dim(`${droppedCount} field(s) dropped as unrepresentable — review before use.`),
    );
  }

  // A `--table <name>` that names an EXISTING table whose name/columns are not
  // representable (all dropped) must be a loud error — never a silent empty
  // schema + exit 0.
  if (tableFilter && !emittedTables.includes(tableFilter)) {
    console.error(
      c.red("error:") +
        ` table "${tableFilter}" exists but its name/columns are not representable ` +
        `in scrml <schema> (see the warnings above).`,
    );
    process.exit(1);
    return;
  }

  if (outFile) {
    const abs = resolve(process.cwd(), outFile);
    try {
      writeFileSync(abs, source, "utf8");
    } catch (err) {
      console.error(c.red("error:") + ` failed to write ${abs}: ${err.message}`);
      process.exit(1);
      return;
    }
    console.error(c.dim(`Wrote ${abs}`));
  } else {
    process.stdout.write(source);
  }
}

/**
 * Close a Bun.SQL handle, tolerating both the presence/absence of `.end()` and
 * a close-time error (we never want handle teardown to mask a successful read).
 */
async function closeSql(sql) {
  try {
    await sql.end?.();
  } catch {
    /* ignore teardown errors */
  }
}
