/**
 * diagnostic-format.js — shared CLI diagnostic-formatting helpers.
 *
 * stripRedundantCode — remove a leading `${code}: ` self-prefix from a diagnostic
 * MESSAGE at print time. Historically most `TABError` messages self-include their
 * own code (`E-X: …` — 86 of 92 at the time of writing), while every CLI formatter
 * ALSO prepends `${code}: ` / `[${code}]`, so the code printed twice
 * (`error [E-SWITCH-FORBIDDEN]: E-SWITCH-FORBIDDEN: …`) and, in `build.js`, the
 * redundant prefix ate the 120-char message slice → truncated tails (the original
 * Fieldman/assetManagement report).
 *
 * This strips the message's self-prefix for DISPLAY ONLY. The diagnostic DATA
 * (`result.errors[i].message`) is deliberately untouched, so the 51 tests that
 * assert `message.toContain("E-…")` stay green — the fix is confined to the
 * human-facing formatters. The proper convention fix (stop the messages
 * self-prefixing) would touch 86 literals + 51 tests and is a separate cleanup.
 *
 * g-tab-error-messages-self-prefix-code (S347-peter).
 *
 * @param {string} code    the diagnostic code (e.g. "E-SWITCH-FORBIDDEN")
 * @param {string} message the raw diagnostic message
 * @returns {string} message with a single leading `${code}:` (+ following blanks) removed, if present
 */
export function stripRedundantCode(code, message) {
  if (!code || typeof message !== "string") return message;
  const prefix = `${code}:`;
  if (message.startsWith(prefix)) {
    return message.slice(prefix.length).replace(/^[ \t]+/, "");
  }
  return message;
}

/**
 * resolveDiagLocation — resolve a diagnostic's source location, preferring an
 * explicit top-level field and falling back to the same field on `.span`.
 *
 * A diagnostic reaches the CLI formatters in two shapes: some carry
 * `line`/`column`/`file` flattened to the top level (CG-gate errors, lint
 * diagnostics), while TS/BS/TAB-stage errors carry their location ONLY on
 * `.span` (`{ file, line, col }`) — `collectErrors` never flattens it. The
 * compile formatters historically read only the top-level fields, so a
 * span-only diagnostic (every E-STATE-UNDECLARED / E-SCOPE-001 / …) printed
 * with no `--> file:line:col`. This centralizes the EXACT three-level fallback
 * chain the sibling formatters already use (build.js:903-905/916-918,
 * dev.js:512/602/628/816) — note the MIDDLE `?? diag.col` level, alongside
 * `diag.span?.col` — so all three compile formatters resolve location
 * identically. Returns `undefined` for any component that does not resolve;
 * callers append `-->` only when `file` is present, and `:line` / `:col` only
 * when each is present.
 *
 * @param {object} diag a diagnostic (error / warning / lint) object
 * @returns {{ file: (string|undefined), line: (number|undefined), col: (number|undefined) }}
 */
export function resolveDiagLocation(diag) {
  if (!diag || typeof diag !== "object") return { file: undefined, line: undefined, col: undefined };
  const span = diag.span;
  return {
    file: diag.filePath || diag.file || span?.file || undefined,
    line: diag.line ?? span?.line ?? undefined,
    col: diag.column ?? diag.col ?? span?.col ?? undefined,
  };
}
