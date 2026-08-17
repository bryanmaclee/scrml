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
