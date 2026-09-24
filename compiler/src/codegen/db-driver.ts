/**
 * Driver URI resolution for `<program db="...">` (SPEC §44.2).
 *
 * The `db=` attribute on a `<program>` element accepts several connection
 * string forms. This module classifies the URI by prefix and returns:
 *   { driver, connectionString }
 *
 * Driver matrix (SPEC §44.2):
 *
 *   `db=` value form               | driver
 *   -------------------------------|----------
 *   `:memory:`                     | sqlite
 *   `sqlite:...`                   | sqlite
 *   `./path`, `../path`, `/path`   | sqlite (filesystem)
 *   `path.db`, `path.sqlite`, etc. | sqlite (heuristic — bare relative path)
 *   `postgres://...`               | postgres
 *   `postgresql://...`             | postgres
 *   `mysql://...`                  | mysql (Phase 3)
 *   anything else                  | E-SQL-005 (unsupported prefix)
 *
 * Returns the same `connectionString` value as input — Bun.SQL accepts
 * `postgres://`, `postgresql://`, file paths, and `:memory:` directly.
 *
 * No I/O. No URL parsing beyond prefix matching. This function is pure.
 */

import { redactDbUri } from "../db-uri-redact.ts";
import { classifyDbTarget } from "../db-target.ts";
export { classifyDbTarget, isDriverConnectionUri } from "../db-target.ts";
export type { DbTargetKind, DbTargetClass } from "../db-target.ts";

export type DbDriver = "sqlite" | "postgres" | "mysql";

export interface DbDriverInfo {
  driver: DbDriver;
  connectionString: string;
}

export interface DbDriverError {
  code: "E-SQL-005";
  message: string;
}

export type DbDriverResult =
  | { ok: true; info: DbDriverInfo }
  | { ok: false; error: DbDriverError };

/**
 * Classify a `db=` attribute value into a driver kind + canonical connection
 * string. Returns a result object — does NOT throw. Callers decide whether to
 * raise the error or continue with a fallback.
 *
 * @param uri  the raw `db=` attribute value (already string-unwrapped)
 */
export function resolveDbDriver(uri: string): DbDriverResult {
  if (typeof uri !== "string" || uri.length === 0) {
    return {
      ok: false,
      error: {
        code: "E-SQL-005",
        message:
          `E-SQL-005: \`<program db="">\` value is empty. Provide a SQLite path ` +
          `(e.g. \`./app.db\`, \`:memory:\`), a PostgreSQL URI ` +
          `(\`postgres://...\`), or a MySQL URI (\`mysql://...\`). ` +
          `See SPEC §44.2.`,
      },
    };
  }

  const cls = classifyDbTarget(uri);
  const trimmed = cls.trimmed;

  // PostgreSQL — both prefix forms are aliases (Bun.SQL accepts either).
  if (cls.kind === "postgres") {
    return {
      ok: true,
      info: { driver: "postgres", connectionString: trimmed },
    };
  }

  // MySQL — Phase 3. Recognize the prefix so codegen can plumb it through;
  // downstream stages may still bail out with their own diagnostics.
  if (cls.kind === "mysql") {
    return {
      ok: true,
      info: { driver: "mysql", connectionString: trimmed },
    };
  }

  // SQLite — explicit `sqlite:` prefix or in-memory `:memory:`.
  if (cls.kind === "sqlite-memory" || (cls.kind === "sqlite-file" && cls.scheme === "sqlite")) {
    return {
      ok: true,
      info: { driver: "sqlite", connectionString: trimmed },
    };
  }

  // Reject explicit non-relational schemes — these are not for `?{}`.
  // §44.2 normative: `mongo://` / `mongodb://` are invalid for `?{}`.
  if (cls.kind === "mongo") {
    return {
      ok: false,
      error: {
        code: "E-SQL-005",
        message:
          `E-SQL-005: \`<program db="${redactDbUri(trimmed)}">\` uses an unsupported prefix for \`?{}\`. ` +
          `MongoDB (\`mongo://\` / \`mongodb://\`) is not a SQL driver — use the meta ` +
          `context \`^{}\` for non-SQL data sources. See SPEC §44.2.`,
      },
    };
  }

  // Reject obvious URL schemes we don't support so typos surface early.
  // A relative path like `./app.db` matches the path heuristic below; a typo'd
  // scheme like `postgress://` (note the extra s) reaches this branch.
  if (cls.kind === "unsupported-scheme") {
    return {
      ok: false,
      error: {
        code: "E-SQL-005",
        message:
          `E-SQL-005: \`<program db="${redactDbUri(trimmed)}">\` uses an unrecognized URI scheme \`${cls.scheme}://\`. ` +
          `Supported schemes: \`postgres://\`, \`postgresql://\`, \`mysql://\`, \`sqlite:\`. ` +
          `For local files use a relative path (e.g. \`./app.db\`) or \`:memory:\`. ` +
          `See SPEC §44.2.`,
      },
    };
  }

  // Path-like heuristic: relative path, absolute path, or bare filename. Any
  // bare string that survived the earlier checks is treated as a SQLite file
  // path — this matches Bun.SQL's own behavior and SPEC §44.2's `./path`
  // entry. The host driver will surface a runtime error if the path is
  // genuinely malformed.
  return {
    ok: true,
    info: { driver: "sqlite", connectionString: trimmed },
  };
}

/**
 * Convenience: returns true if a `db=` value resolves to a recognized driver.
 * Useful for assertions at codegen time when callers don't need the full info.
 */
export function isSupportedDbUri(uri: string): boolean {
  return resolveDbDriver(uri).ok;
}
