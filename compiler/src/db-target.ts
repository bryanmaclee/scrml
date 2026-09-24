/**
 * db-target.ts — the ONE classifier for database connection targets.
 *
 * Lives outside `codegen/` so the early protect-analyzer stage can use it
 * without pulling a codegen module; `codegen/db-driver.ts` re-exports it and
 * builds `resolveDbDriver` on it. Pure: no I/O.
 */

/**
 * THE classifier for a `db=` / `<db src=>` value (s430-dev-db-stub R2-1). Both
 * `resolveDbDriver` (codegen) and the protect-analyzer (compile-time schema
 * read) call this, so the two can never disagree about what a value is.
 *
 * It reproduces codegen's PRE-EXISTING acceptance EXACTLY: leading/trailing
 * whitespace is trimmed (as `resolveDbDriver` always did), and the driver
 * prefixes are matched CASE-SENSITIVELY (`postgres://`, never `POSTGRES://`).
 * Case-insensitive scheme acceptance (RFC 3986 §3.1; Bun.SQL does accept
 * `POSTGRES://`) would be a newly-accepting language change with no governing
 * SPEC sentence — it is deferred to a ruling, not done here.
 *
 *   postgres            starts with `postgres://` | `postgresql://`
 *   mysql               starts with `mysql://`
 *   sqlite-memory       exactly `:memory:`
 *   sqlite-file         starts with `sqlite:` (SPEC §8.1.1: `sqlite:./path` is
 *                       the local file `./path`), or anything with no `scheme://`
 *   mongo               starts with `mongo://` | `mongodb://`   (E-SQL-005)
 *   unsupported-scheme  any other `scheme://` shape, matched case-INsensitively
 *                       exactly as `resolveDbDriver`'s E-SQL-005 branch did — so
 *                       `POSTGRES://` / `MONGODB://` / `SQLITE://` land HERE
 *   empty               "" / whitespace
 *
 * `scheme` is the matched scheme as WRITTEN (case preserved — it is quoted
 * back in E-SQL-005). `sqlitePath` is the filesystem path for `sqlite-file`
 * (a `sqlite:` / `sqlite://` prefix removed), else null.
 */
export type DbTargetKind =
  | "postgres" | "mysql" | "mongo" | "unsupported-scheme"
  | "sqlite-memory" | "sqlite-file" | "empty";

export interface DbTargetClass {
  kind: DbTargetKind;
  trimmed: string;
  scheme: string | null;
  sqlitePath: string | null;
}

export function classifyDbTarget(raw: string): DbTargetClass {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) return { kind: "empty", trimmed, scheme: null, sqlitePath: null };
  if (trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://")) {
    return { kind: "postgres", trimmed, scheme: trimmed.slice(0, trimmed.indexOf(":")), sqlitePath: null };
  }
  if (trimmed.startsWith("mysql://")) return { kind: "mysql", trimmed, scheme: "mysql", sqlitePath: null };
  if (trimmed === ":memory:") return { kind: "sqlite-memory", trimmed, scheme: null, sqlitePath: null };
  if (trimmed.startsWith("sqlite:")) {
    return { kind: "sqlite-file", trimmed, scheme: "sqlite", sqlitePath: trimmed.replace(/^sqlite:(?:\/\/)?/, "") };
  }
  if (trimmed.startsWith("mongo://") || trimmed.startsWith("mongodb://")) {
    return { kind: "mongo", trimmed, scheme: trimmed.slice(0, trimmed.indexOf(":")), sqlitePath: null };
  }
  const m = trimmed.match(/^([a-z][a-z0-9+.\-]*):\/\//i);
  if (m !== null) return { kind: "unsupported-scheme", trimmed, scheme: m[1], sqlitePath: null };
  return { kind: "sqlite-file", trimmed, scheme: null, sqlitePath: trimmed };
}

/** True when the value names a network driver (Postgres / MySQL), not a file. */
export function isDriverConnectionUri(raw: string): boolean {
  const k = classifyDbTarget(raw).kind;
  return k === "postgres" || k === "mysql";
}

