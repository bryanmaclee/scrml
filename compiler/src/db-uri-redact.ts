/**
 * Display form of a database target for a message that names it
 * (s430-dev-db-stub F4).
 *
 * This is NOT the redaction mechanism — that is value-based and lives in
 * `diagnostic-secrets.ts` (the compileScrml chokepoint). This helper decides
 * only how a message DISPLAYS the one value it is about: the value's secret
 * spans (the URI userinfo, every password-parameter value) are replaced
 * POSITIONALLY by `<redacted>`; nothing else in the value changes. A plain
 * SQLite path (`./app.db`, `sqlite:./app.db`, `:memory:`) passes through
 * unchanged.
 */

import { displayConnectionValue } from "./diagnostic-secrets.ts";

export function redactDbUri(target: string): string {
  if (typeof target !== "string" || target.length === 0) return target;
  return displayConnectionValue(target);
}
