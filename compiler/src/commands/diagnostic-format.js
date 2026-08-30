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
 * resolveDiagLocation — read a diagnostic's source location from EITHER the flat
 * fields or the `span` carrier.
 *
 * S385 (`g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm`,
 * defect 2). The CLI formatters read only the flat `filePath` / `line` / `column`
 * fields, but most stage diagnostics carry their location in a `span` object
 * — `{ file, start, end, line, col }` — and set no flat fields at all. The key
 * name differs as well: a span says `col`, the flat form says `column`.
 *
 * Consequence: a fully-located diagnostic printed with NO location at all.
 * `E-STATE-UNDECLARED` was the reported instance — its span is populated
 * correctly at the fire site (measured: `line 6, col 14`) and simply never
 * reached the output, so it rendered as a bare message plus `stage: TS`. For an
 * adopter that meant hand-bisecting a 3,700-line file to locate three errors.
 *
 * This is NOT specific to that code. EVERY span-only diagnostic was equally
 * location-less, and no stage diagnostic ever printed a `:line:col` at all — the
 * `--> path` line appeared bare whenever `filePath` happened to be stamped.
 *
 * Flat fields win when both are present: a formatter-specific override stays
 * authoritative, and `span` is purely a fallback.
 *
 * @param {object} d diagnostic object (error, warning, or lint)
 * @returns {{ filePath: string|null, line: number|null, column: number|null }}
 */
/**
 * stripRedundantLocation — remove a message's trailing `(line N, col N)` when the
 * formatter is about to print the SAME coordinates on its `-->` line.
 *
 * S385. Several diagnostics bake their location into the message text (`… See
 * SPEC §40.8. (line 2, col 5)`). Before the `span`-carrier fallback landed, the
 * `-->` line printed a bare path with no coordinates, so the baked-in text was
 * the only location an author got. Now that `-->` carries `path:2:5`, the two
 * render back-to-back and the duplication is exact:
 *
 *     warning [W-PROGRAM-REDUNDANT-LOGIC]: … (line 2, col 5)
 *       --> app.scrml:2:5
 *
 * Strips ONLY on an exact coordinate match, so a message that legitimately cites
 * a DIFFERENT line (a "declared at …" cross-reference) keeps its text. Print-time
 * only — `result.warnings[i].message` is untouched, mirroring stripRedundantCode.
 *
 * @param {string} message the raw diagnostic message
 * @param {number|null} line the line the formatter will print
 * @param {number|null} column the column the formatter will print
 * @returns {string}
 */
export function stripRedundantLocation(message, line, column) {
  if (typeof message !== "string" || !line) return message;
  return message.replace(
    /\s*\(line\s+(\d+),\s*col(?:umn)?\s+(\d+)\)\s*$/,
    (whole, l, c) =>
      Number(l) === Number(line) && Number(c) === Number(column) ? "" : whole,
  );
}

export function resolveDiagLocation(d) {
  if (!d || typeof d !== "object") return { filePath: null, line: null, column: null };
  const span = d.span && typeof d.span === "object" ? d.span : null;
  return {
    filePath: d.filePath || d.file || (span && span.file) || null,
    line: d.line ?? (span ? span.line : null) ?? null,
    column: d.column ?? (span ? span.col : null) ?? null,
  };
}
