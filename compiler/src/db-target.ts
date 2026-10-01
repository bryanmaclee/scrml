/**
 * db-target.ts — the ONE classifier for database connection targets.
 *
 * Lives outside `codegen/` so the early protect-analyzer stage can use it
 * without pulling a codegen module; `codegen/db-driver.ts` re-exports it and
 * builds `resolveDbDriver` on it. Pure: no I/O.
 */

import { resolve as resolvePath, dirname as dirnamePath } from "node:path";

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
 *                       `POSTGRES://` / `MONGODB://` / `SQLITE://` land HERE.
 *                       Also a `file:` URI (any case, with or without `//`): it
 *                       used to fall through to `sqlite-file` and name a file
 *                       literally called `file:./x.db` beside the source (S445 F8);
 *                       it is now an unsupported target (E-SQL-005) — write the
 *                       path itself, or `sqlite:<path>`.
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
  // S445 F8 — a `file:` URI is not a path; refuse it loudly rather than resolve it as one.
  const fileUri = trimmed.match(/^(file):/i);
  if (fileUri !== null) return { kind: "unsupported-scheme", trimmed, scheme: fileUri[1], sqlitePath: null };
  const m = trimmed.match(/^([a-z][a-z0-9+.\-]*):\/\//i);
  if (m !== null) return { kind: "unsupported-scheme", trimmed, scheme: m[1], sqlitePath: null };
  return { kind: "sqlite-file", trimmed, scheme: null, sqlitePath: trimmed };
}

/** True when the value names a network driver (Postgres / MySQL), not a file. */
export function isDriverConnectionUri(raw: string): boolean {
  const k = classifyDbTarget(raw).kind;
  return k === "postgres" || k === "mysql";
}


/**
 * THE resolver for a database FILE target (s445-dev-db-side-file) — the one place
 * a `db=` / `<db src=>` value becomes an absolute filesystem path.
 *
 * A relative SQLite path is resolved against the directory of the SOURCE FILE THAT
 * DECLARES IT — never against the process working directory. Two consumers call
 * this and nothing else, so they cannot disagree about which file a value names:
 *
 *   - the compile-time schema read (`protect-analyzer.ts`, E-PA-002/003/004), and
 *   - the emitted runtime handle (`codegen/sqlite-file-target.ts`, reached from
 *     `emit-server.ts` and `emit-tool.ts`), which writes this same absolute path
 *     into the server/tool module RELATIVE TO THE MODULE ITSELF, so `scrml dev`,
 *     `scrml serve`, a built `_server.js` and a `kind="tool"` binary all open the
 *     file the compiler checked, whatever directory the process was started in.
 *
 * Before this existed the two halves used different bases (compile: the source
 * file's directory; runtime: the process CWD, via a literal re-relativized to the
 * compile unit's output base), so `scrml dev` opened — and SQLite CREATED — an
 * empty file the compiler never looked at, or one it did look at and then
 * reported every declared table missing from (flogence S49/S51).
 *
 * SPEC §8.1.1 *Resolution base* (ruling:user-voice-scrml.md S445 item 6) is the
 * governing sentence: "A relative SQLite file path in a `db=` or `<db src=>` value
 * … SHALL resolve against the directory of the `.scrml` file that declares it."
 *
 * `cls.sqlitePath` is the path with any `sqlite:` prefix removed; for a target the
 * classifier does not call a sqlite file the trimmed value is resolved as-is, which
 * reproduces the schema read's pre-existing behaviour for those kinds exactly.
 * Pure: path arithmetic only, no filesystem access.
 */
export function resolveDbFilePath(cls: DbTargetClass, declaringSourceFile: string): string {
  return resolvePath(dirnamePath(declaringSourceFile), cls.sqlitePath ?? cls.trimmed);
}
