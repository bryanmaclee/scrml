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
 * read) call this, so a value the driver accepts as Postgres can never be
 * treated as a file path by the other. Leading/trailing whitespace is ignored
 * and URI schemes compare case-insensitively (RFC 3986 §3.1; Bun.SQL accepts
 * `POSTGRES://` as the postgres adapter — measured).
 *
 *   postgres            postgres:// | postgresql://
 *   mysql               mysql://
 *   mongo               mongo:// | mongodb://          (invalid for `?{}`)
 *   unsupported-scheme  any other `scheme://`
 *   sqlite-memory       :memory:
 *   sqlite-file         `sqlite:` prefix, or anything else (a path)
 *   empty               "" / whitespace
 *
 * `sqlitePath` is the filesystem path for `sqlite-file` (the `sqlite:` /
 * `sqlite://` prefix removed), else null.
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
  const m = trimmed.match(/^([a-z][a-z0-9+.\-]*):\/\//i);
  const scheme = m ? m[1].toLowerCase() : null;
  if (scheme === "postgres" || scheme === "postgresql") return { kind: "postgres", trimmed, scheme, sqlitePath: null };
  if (scheme === "mysql") return { kind: "mysql", trimmed, scheme, sqlitePath: null };
  if (trimmed === ":memory:") return { kind: "sqlite-memory", trimmed, scheme: null, sqlitePath: null };
  if (/^sqlite:/i.test(trimmed)) {
    return { kind: "sqlite-file", trimmed, scheme: "sqlite", sqlitePath: trimmed.replace(/^sqlite:(?:\/\/)?/i, "") };
  }
  if (scheme === "mongo" || scheme === "mongodb") return { kind: "mongo", trimmed, scheme, sqlitePath: null };
  if (scheme !== null) return { kind: "unsupported-scheme", trimmed, scheme, sqlitePath: null };
  return { kind: "sqlite-file", trimmed, scheme: null, sqlitePath: trimmed };
}

/** True when the value names a network driver (Postgres / MySQL), not a file. */
export function isDriverConnectionUri(raw: string): boolean {
  const k = classifyDbTarget(raw).kind;
  return k === "postgres" || k === "mysql";
}

