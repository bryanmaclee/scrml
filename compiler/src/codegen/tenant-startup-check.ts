/**
 * §14.8.10 (S456) — the built server's startup check for UNDECLARED tenant tables.
 *
 * Ruling (user-voice-scrml.md S456, "b, startup check lands with it"): a table carrying a
 * `tenant_id` column that is NOT in the compilation's tenant set (no `<schema>` declares
 * it, no `<db src=… tables=…>` registry lists it) is REFUSED where the compiler can see
 * it (`E-TENANT-UNDECLARED`, compiler/src/tenant-undeclared.ts) and CHECKED AT STARTUP
 * where it cannot — a Postgres / MySQL database, a `<program db=>` SQLite file the
 * compile never opens, a database seeded after the build. The floor scopes reads by the
 * compiled set, so such a table's rows would reach every request unscoped.
 *
 * Two halves:
 *
 *   1. Each server module that declares a database handle exports
 *      `_scrml_tenant_startup_check = { undeclared() }` (emitted here, wired by
 *      `emit-server.ts`). `undeclared()` asks each of the module's handles which
 *      relations carry a `tenant_id` column — SQLite `sqlite_master` ×
 *      `pragma_table_info`, Postgres `pg_catalog`, MySQL `information_schema` — and
 *      returns every one whose name is not in the tenant set compiled into the module.
 *      A database it cannot inspect is returned too (`error`), never treated as clean.
 *
 *   2. The refusal gate (`TENANT_GATE_LINES`) runs every module's check before any request
 *      is answered — in `scrml build`'s `_server.js` (commands/build.js `generateServerEntry`)
 *      and, the same text, in `scrml dev`'s app process (commands/dev.js, s457). While one
 *      reports anything, every request answers 503, `/_scrml/health` answers 503 (and
 *      re-runs the check, so fixing the database clears it without a restart), and each
 *      finding is printed once to the server log — the §47.14 referenced-database
 *      startup family (`E-DEPLOY-DB-TENANT-UNDECLARED`).
 *
 * Matching is case-insensitive on the relation's own name (SQLite identifiers are
 * case-insensitive; the compiled set is lowercased — `TenantTableSet`). Views count: a
 * view whose rows carry `tenant_id` is read by the floor exactly like a table, so an
 * undeclared one is the same unscoped read (PA reading, S456).
 */

import { redactDbUri } from "../db-uri-redact.ts";

/** The export name `_server.js` imports (commands/build.js `describeServerUnit`). */
export const TENANT_STARTUP_CHECK_EXPORT = "_scrml_tenant_startup_check";

/** One database handle a server module declares, as the startup check reads it. */
export interface TenantCheckHandle {
  /** The emitted handle identifier (`_scrml_sql`, `_scrml_sql_1`, …). */
  ident: string;
  driver: "sqlite" | "postgres" | "mysql";
  /** The `db=` / `src=` value as written — displayed with its secrets redacted. */
  connection: string;
}

/**
 * The runtime helper. A function declaration (hoisted), so the module export below can
 * be appended anywhere after the handle declarations.
 */
export const TENANT_UNDECLARED_HELPER_LINES: readonly string[] = Object.freeze([
  "// §14.8.10 (S456) — which relations in each database carry a `tenant_id` column that",
  "// this build does not declare tenant-scoped. The tenant floor scopes reads by the",
  "// compiled set, so such a table's rows would reach every request unscoped: the built",
  "// server (_server.js) refuses to serve while this returns anything. A database it",
  "// cannot inspect is reported too — never treated as clean.",
  "async function _scrml_tenant_undeclared_in(handles, declared) {",
  "  const found = [];",
  "  for (const h of handles) {",
  "    let rows;",
  "    try {",
  "      if (h.driver === \"sqlite\") {",
  "        // pragma_table_xinfo, not _info: generated and hidden columns (an fts4 languageid=) count.",
  "        rows = await h.handle`SELECT m.name AS name FROM sqlite_master m, pragma_table_xinfo(m.name) p WHERE m.type IN ('table', 'view') AND substr(m.name, 1, 7) <> 'sqlite_' AND lower(p.name) = 'tenant_id'`;",
  "      } else if (h.driver === \"postgres\") {",
  "        // pg_catalog, not information_schema: the latter lists only what the current role may read.",
  "        rows = await h.handle`SELECT n.nspname AS sch, c.relname AS name FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE lower(a.attname) = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition AND n.nspname <> 'information_schema' AND left(n.nspname, 3) <> 'pg_'`;",
  "      } else {",
  "        rows = await h.handle`SELECT table_schema AS sch, table_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND lower(column_name) = 'tenant_id'`;",
  "      }",
  "    } catch (e) {",
  "      found.push({ db: h.label, table: null, error: String((e && e.message) || e) });",
  "      continue;",
  "    }",
  "    for (const r of rows) {",
  "      const name = String(r.name);",
  "      if (declared.has(name.toLowerCase())) continue;",
  "      found.push({ db: h.label, table: r.sch ? `${r.sch}.${name}` : name, error: null });",
  "    }",
  "  }",
  "  return found;",
  "}",
]);

/** The display label of one database in a server-log line: the `db=` value, secrets redacted. */
export function tenantCheckLabel(connection: string): string {
  return redactDbUri(connection);
}

/**
 * The module export `_server.js` runs: the helper above plus
 * `export const _scrml_tenant_startup_check = { undeclared() }` over `handles`, with the
 * compilation's tenant set baked in. Returns no lines when the module has no handle.
 */
export function tenantStartupCheckLines(
  handles: readonly TenantCheckHandle[],
  declaredTenantTables: Iterable<string>,
): string[] {
  if (handles.length === 0) return [];
  const declared = [...new Set([...declaredTenantTables].map((t) => t.toLowerCase()))].sort();
  const lines: string[] = [];
  lines.push("");
  lines.push(...TENANT_UNDECLARED_HELPER_LINES);
  lines.push("// The tables this compilation declares tenant-scoped (§14.8.10: `<schema>` + `<db tables=>`).");
  lines.push(`const _SCRML_TENANT_DECLARED = new Set(${JSON.stringify(declared)});`);
  lines.push(`export const ${TENANT_STARTUP_CHECK_EXPORT} = {`);
  lines.push("  undeclared: () => _scrml_tenant_undeclared_in([");
  for (const h of handles) {
    lines.push(`    { handle: ${h.ident}, driver: ${JSON.stringify(h.driver)}, label: ${JSON.stringify(tenantCheckLabel(h.connection))} },`);
  }
  lines.push("  ], _SCRML_TENANT_DECLARED),");
  lines.push("};");
  return lines;
}

/**
 * s457 — the REFUSAL GATE over every server module's check, as ONE text that both hosts run.
 * `scrml build`'s `_server.js` emits it verbatim (`tenantGateEntryLines`, below), and `scrml
 * dev` instantiates the same text in its app process (`createTenantGate`), so the two cannot
 * drift: the ruling ("b, startup check lands with it", S456) puts the check in the tenant floor,
 * not in one command. The text reads one free variable, `_SCRML_TENANT_CHECKS` (the modules'
 * `_scrml_tenant_startup_check` exports), and defines `_scrml_tenant_refusals(recheck)`: how
 * many findings stand (a request answers 503 while any does). It runs the first check at once.
 */
export const TENANT_GATE_LINES: readonly string[] = Object.freeze([
  "// A database that does not answer within this long counts as unchecked (refused).",
  "const _SCRML_TENANT_CHECK_TIMEOUT_MS = 10000;",
  "async function _scrml_tenant_undeclared() {",
  "  const found = [];",
  "  for (const check of _SCRML_TENANT_CHECKS) {",
  "    try {",
  "      let timer;",
  "      const timeout = new Promise((_, reject) => {",
  "        timer = setTimeout(() => reject(new Error(`no answer within ${_SCRML_TENANT_CHECK_TIMEOUT_MS / 1000} s`)), _SCRML_TENANT_CHECK_TIMEOUT_MS);",
  "      });",
  "      try {",
  "        found.push(...(await Promise.race([check.undeclared(), timeout])));",
  "      } finally {",
  "        clearTimeout(timer);",
  "      }",
  "    } catch (e) {",
  "      found.push({ db: \"(a server module's database)\", table: null, error: String((e && e.message) || e) });",
  "    }",
  "  }",
  "  // Modules that share a database report its tables once.",
  "  const seen = new Set();",
  "  return found.filter((f) => {",
  "    const key = `${f.db}\\0${f.table}\\0${f.error}`;",
  "    if (seen.has(key)) return false;",
  "    seen.add(key);",
  "    return true;",
  "  });",
  "}",
  "function _scrml_tenant_report(found) {",
  "  for (const f of found) {",
  "    console.error(f.table !== null",
  "      ? `scrml: E-DEPLOY-DB-TENANT-UNDECLARED: database ${f.db} holds \"${f.table}\", which has a ` +",
  "        `tenant_id column, but this build does not declare it tenant-scoped (no <schema> and no ` +",
  "        `<db tables=> names it), so the tenant floor would not scope its rows. This server answers ` +",
  "        `503 until that is fixed: declare the table in <schema> so the tenant floor scopes it, and ` +",
  "        `rebuild — or, if it is not tenant data, rename the column (a tenant_id column is the ` +",
  "        `declaration; there is no opt-out).`",
  "      : `scrml: E-DEPLOY-DB-TENANT-UNDECLARED: database ${f.db} could not be checked — the ` +",
  "        `connection or the catalogue query failed (${f.error}); no undeclared table was found, ` +",
  "        `the database could not be asked. This server answers 503 and keeps re-checking until ` +",
  "        `the check succeeds.`);",
  "  }",
  "}",
  "// The standing findings (null until the first check finishes), the one check in",
  "// flight, and the backoff between checks that ordinary requests trigger.",
  "let _scrml_tenant_found = null;",
  "let _scrml_tenant_inflight = null;",
  "let _scrml_tenant_started = 0;",
  "let _scrml_tenant_wait = 1000;",
  "let _scrml_tenant_logged = \"\";",
  "function _scrml_tenant_run() {",
  "  if (_scrml_tenant_inflight) return _scrml_tenant_inflight;",
  "  _scrml_tenant_started = Date.now();",
  "  _scrml_tenant_inflight = _scrml_tenant_undeclared().then((found) => {",
  "    const wasRefusing = _scrml_tenant_found !== null && _scrml_tenant_found.length > 0;",
  "    _scrml_tenant_found = found;",
  "    _scrml_tenant_inflight = null;",
  "    if (found.length === 0) {",
  "      _scrml_tenant_wait = 1000;",
  "      _scrml_tenant_logged = \"\";",
  "      if (wasRefusing) console.error(\"scrml: the undeclared-tenant-table check now passes; serving.\");",
  "    } else {",
  "      _scrml_tenant_wait = Math.min(_scrml_tenant_wait * 2, 30000);",
  "      // Log a finding set once, not on every re-check.",
  "      const key = JSON.stringify(found);",
  "      if (key !== _scrml_tenant_logged) {",
  "        _scrml_tenant_logged = key;",
  "        _scrml_tenant_report(found);",
  "      }",
  "    }",
  "    return found;",
  "  });",
  "  return _scrml_tenant_inflight;",
  "}",
  "const _scrml_tenant_boot = _scrml_tenant_run();",
  "// How many findings stand (a request answers 503 while any does). `recheck` (the",
  "// health route) checks now; any other request starts a background re-check once",
  "// the backoff has passed and answers from the standing result meanwhile.",
  "async function _scrml_tenant_refusals(recheck) {",
  "  if (_scrml_tenant_found === null) {",
  "    // The boot check has not finished: wait for it, but no longer than its own timeout.",
  "    await Promise.race([_scrml_tenant_boot, new Promise((r) => setTimeout(r, _SCRML_TENANT_CHECK_TIMEOUT_MS + 1000))]);",
  "    if (_scrml_tenant_found === null) return 1;",
  "  }",
  "  if (_scrml_tenant_found.length > 0) {",
  "    if (recheck) await _scrml_tenant_run();",
  "    else if (!_scrml_tenant_inflight && Date.now() - _scrml_tenant_started >= _scrml_tenant_wait) void _scrml_tenant_run();",
  "  }",
  "  return _scrml_tenant_found.length;",
  "}",
]);

/** The comment `_server.js` prints above the gate. */
const TENANT_GATE_HEADER_LINES: readonly string[] = Object.freeze([
  "// §14.8.10 — UNDECLARED TENANT TABLES. The tenant floor scopes the tables this build",
  "// declares tenant-scoped (<schema>, <db tables=>). A table in a database that carries",
  "// tenant_id but is not declared would be read unscoped — every tenant's rows to every",
  "// request — so this server refuses to serve while one exists, or while a database",
  "// cannot be checked: every request answers 503. It re-checks (one check at a time;",
  "// ordinary requests at most every 1 s, backing off to 30 s; /_scrml/health at once),",
  "// so a database that comes up later, or is fixed in place, is served without a restart.",
]);

/**
 * The gate as `_server.js` carries it: its header, the module checks it runs (by import
 * alias), then `TENANT_GATE_LINES`. Returns no lines when no module has a check.
 */
export function tenantGateEntryLines(checkAliases: readonly string[]): string[] {
  if (checkAliases.length === 0) return [];
  return [
    ...TENANT_GATE_HEADER_LINES,
    `const _SCRML_TENANT_CHECKS = [${checkAliases.join(", ")}];`,
    ...TENANT_GATE_LINES,
    "",
  ];
}

/** One module's `_scrml_tenant_startup_check` export, as the gate calls it. */
export interface TenantStartupCheck {
  undeclared(): Promise<Array<{ db: string; table: string | null; error: string | null }>>;
}

/** A running gate: `refusals(recheck)` resolves to the number of standing findings. */
export interface TenantGate {
  refusals(recheck: boolean): Promise<number>;
}

/**
 * Run `TENANT_GATE_LINES` in THIS process over `checks` (`scrml dev`'s app process). The
 * first check starts at once, exactly as it does when `_server.js` loads. The text is the
 * compiler's own constant, not input, and it is the same text `_server.js` runs.
 */
export function createTenantGate(checks: readonly TenantStartupCheck[]): TenantGate {
  const run = new Function(
    "_SCRML_TENANT_CHECKS",
    `${TENANT_GATE_LINES.join("\n")}\nreturn { refusals: _scrml_tenant_refusals };`,
  ) as (c: readonly TenantStartupCheck[]) => TenantGate;
  return run([...checks]);
}

/** The text of a refused request — `_server.js` and `scrml dev` answer the same. */
export const TENANT_REFUSED_STATUS_TEXT = "Service Unavailable";

/** `/_scrml/health`'s reason while the gate refuses (a count, never a table: the route is public). */
export function tenantHealthReason(undeclared: number): string {
  return `${undeclared} undeclared tenant table(s) or unchecked database(s)`;
}
