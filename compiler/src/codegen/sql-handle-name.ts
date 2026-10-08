/**
 * sql-handle-name.ts — THE names of the emitted database handles, in one place.
 *
 * §8.1.1 (S451): a file opens one handle per database its scopes name —
 * `_scrml_sql` for the file's default database, `_scrml_sql_<n>` for each other one
 * (`db-ownership.ts resolveDbScopes`). Every pass that recognises a handle in emitted
 * text (the declaration scan, the db-authoritative principal wrap, the client-leak
 * guard, the tool header) MUST recognise all of them; a pass that only knew
 * `_scrml_sql` silently skipped the db-authoritative tenant floor on every other
 * handle (S451 review HIGH-1). Prefer the structural handle set from
 * `collectDbScopes` where the caller has it; the pattern here is the fallback for
 * passes that only see text.
 *
 * FAIL CLOSED: a lowering that reaches a `?{}` with no handle threaded to it used to
 * default to `_scrml_sql` — the file's FIRST database. In a file with two or more
 * databases that is the wrong-database class itself, so the fallback there is
 * `UNRESOLVED_SQL_HANDLE`, which the server/tool emitters turn into a compile error
 * (E-INTERNAL-DB-HANDLE-UNRESOLVED) instead of a declaration. A single-database file
 * keeps `_scrml_sql`, byte-identical.
 */

/** The file's default database handle. */
export const DEFAULT_SQL_HANDLE = "_scrml_sql";

/** The handle a lowering gets when nothing told it which database it is on, in a
 *  file with two or more databases. Never declared; its presence is an error. */
export const UNRESOLVED_SQL_HANDLE = "_scrml_sql_UNRESOLVED";

/** Source of a regex matching any handle name (default, scoped, or unresolved). */
export const SQL_HANDLE_PATTERN = "_scrml_sql(?:_\\d+|_UNRESOLVED)?";

/** A fresh word-bounded global regex over every handle name. */
export function sqlHandleRegExp(flags = "g"): RegExp {
  return new RegExp(`\\b${SQL_HANDLE_PATTERN}\\b`, flags);
}

const EXACT = new RegExp(`^${SQL_HANDLE_PATTERN}$`);
/** True when `name` is an emitted handle identifier. */
export function isSqlHandleName(name: string): boolean {
  return EXACT.test(name);
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const AT = new RegExp(`^${SQL_HANDLE_PATTERN}`);
/**
 * The handle identifier starting at `src[at]`, word-bounded on both sides, or null.
 * When `known` is given (the structural set from `collectDbScopes`), a match must
 * also be one of those names.
 */
export function sqlHandleAt(src: string, at: number, known?: ReadonlySet<string> | null): string | null {
  if (src.charCodeAt(at) !== 95 /* _ */) return null;
  if (at > 0 && IDENT_CHAR.test(src[at - 1])) return null;
  const m = AT.exec(src.slice(at, at + 40));
  if (!m) return null;
  // Longest match first (`_scrml_sql_12` over `_scrml_sql`); then require a boundary.
  const name = m[0];
  const after = src[at + name.length];
  if (after !== undefined && IDENT_CHAR.test(after)) return null;
  if (known && !known.has(name) && name !== UNRESOLVED_SQL_HANDLE) return null;
  return name;
}

/** Declaration order: default first, then `_scrml_sql_<n>` ascending, unresolved last. */
export function compareSqlHandles(a: string, b: string): number {
  const rank = (s: string): number =>
    s === DEFAULT_SQL_HANDLE ? -1 : s === UNRESOLVED_SQL_HANDLE ? Number.MAX_SAFE_INTEGER : parseInt(s.slice(DEFAULT_SQL_HANDLE.length + 1), 10);
  return rank(a) - rank(b);
}

// ---------------------------------------------------------------------------
// The per-file fallback handle (set by the codegen entry for the file in hand).
// ---------------------------------------------------------------------------

let _fileFallback: string = DEFAULT_SQL_HANDLE;

/** Set the fallback for the file about to be emitted, from its database count. */
export function setFileSqlFallback(databaseCount: number): void {
  _fileFallback = databaseCount >= 2 ? UNRESOLVED_SQL_HANDLE : DEFAULT_SQL_HANDLE;
}

/** What a lowering with no threaded handle uses: `_scrml_sql` in a single-database
 *  file, `UNRESOLVED_SQL_HANDLE` (a compile error) in a multi-database one. */
export function fallbackSqlHandle(): string {
  return _fileFallback;
}
