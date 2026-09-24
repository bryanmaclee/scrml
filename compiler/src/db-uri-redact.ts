/**
 * Display form of a database target for a message that names it
 * (s430-dev-db-stub F4).
 *
 * This is NOT the redaction mechanism — that is value-based and lives in
 * `diagnostic-secrets.ts` (every compile-unit connection value's secret parts
 * are removed from every diagnostic at the compileScrml chokepoint). This
 * helper only decides how a message DISPLAYS the one value it is about, and it
 * works on that value alone:
 *
 *   - the whole userinfo of `scheme://userinfo@host` is shown as `<redacted>`
 *     (the user name is half a credential; everything up to the LAST `@` after
 *     `://` counts, so an unencoded `@` or `/` in a password cannot leak);
 *   - every secret `deriveSecrets` finds in the value (query / keyword
 *     password parameters, in raw, unquoted and decoded forms) is replaced.
 *
 * A plain SQLite path (`./app.db`, `sqlite:./app.db`, `:memory:`) passes
 * through unchanged.
 */

import { deriveSecrets } from "./diagnostic-secrets.ts";

const REDACTED = "<redacted>";

export function redactDbUri(target: string): string {
  if (typeof target !== "string" || target.length === 0) return target;
  let out = target;

  const schemeMatch = out.match(/^\s*[a-z][a-z0-9+.\-]*:\/\//i);
  if (schemeMatch !== null) {
    const prefix = schemeMatch[0];
    const rest = out.slice(prefix.length);
    const lastAt = rest.lastIndexOf("@");
    if (lastAt >= 0) {
      out = prefix + REDACTED + rest.slice(lastAt);
    }
  }

  const secrets = deriveSecrets(target).sort((a, b) => b.length - a.length);
  for (const s of secrets) {
    if (out.includes(s)) out = out.split(s).join(REDACTED);
  }
  return out;
}
