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
 * with no `--> file:line:col`. This centralizes location resolution for the three
 * COMPILE formatters (formatError / formatWarning / formatLintDiagnostic) so
 * they agree with each other. Returns `undefined` for any component that does
 * not resolve; callers append `-->` only when `file` is present, and `:line` /
 * `:col` only when each is present.
 *
 * ⚑ It is NOT byte-identical to the sibling chains in `build.js:903-905/916-918`
 * and `dev.js:512/602/628/816`, and that divergence is deliberate. Those use a
 * flat `filePath || file || span?.file` precedence for the FILE while taking
 * `line`/`col` from whichever carrier has them. This helper resolves the three
 * components ATOMICALLY instead (see below), which means that when a top-level
 * `filePath` and a `.span.file` name DIFFERENT files and the coordinates come
 * from the span, this reports the SPAN's file where `build.js`/`dev.js` would
 * report the top-level one. No in-tree producer emits that shape today, so the
 * two agree in practice — but do not read this as "all three commands resolve
 * identically", because on a mismatched carrier they do not. Reconciling
 * `build.js`/`dev.js` onto this helper is deliberately out of scope here.
 *
 * @param {object} diag a diagnostic (error / warning / lint) object
 * @returns {{ file: (string|undefined), line: (number|undefined), col: (number|undefined) }}
 */
export function resolveDiagLocation(diag) {
  if (!diag || typeof diag !== "object") return { file: undefined, line: undefined, col: undefined };
  const span = diag.span && typeof diag.span === "object" ? diag.span : undefined;
  const flatFile = diag.filePath || diag.file || undefined;
  const spanFile = span?.file || undefined;
  const flatLine = diag.line ?? undefined;
  const flatCol = diag.column ?? diag.col ?? undefined;

  // S385 — resolve file/line/col ATOMICALLY, from ONE carrier.
  //
  // Resolving each component independently could pair a top-level `filePath`
  // with a `line`/`col` taken from a `.span` that names a DIFFERENT file. The
  // formatter then prints `thatFile:line:col` AND renders that file's line as
  // the offending source — confidently wrong, which is worse than incomplete.
  // So the file always comes from the same carrier as the coordinates.
  //
  // Top-level coordinates still WIN over the span (the #756 contract): an
  // explicit top-level field is a deliberate override.
  const sameFile = !flatFile || !spanFile || flatFile === spanFile;

  if (flatLine !== undefined) {
    // Borrow the span's col only when both carriers agree on the file AND on
    // the LINE. Guarding file identity alone still paired a top-level `line: 5`
    // with a `span.col` measured on line 9, rendering `--> app.scrml:5:11`
    // where column 11 belongs to a different line — the same
    // confidently-wrong class the file guard exists to prevent, one axis over.
    const spanColUsable =
      sameFile && (span?.line === undefined || span.line === flatLine);
    return {
      file: flatFile ?? spanFile,
      col: flatCol ?? (spanColUsable ? span?.col ?? undefined : undefined),
      line: flatLine,
    };
  }
  if (span?.line !== undefined) {
    // Coordinates come from the span, so the file does too — even when a
    // top-level `filePath` names something else.
    //
    // A top-level `column`/`col` still WINS here when both carriers name the
    // SAME file (the #756 contract). Discarding it unconditionally was an
    // over-application of the atomicity rule: `{filePath:"a.scrml", column:7,
    // span:{file:"a.scrml", line:3}}` printed `--> a.scrml:3:7` before the
    // atomicity change and `--> a.scrml:3` after. Dropping the flat col is only
    // correct when the files DIFFER, because only then does it index into
    // something other than the file being reported.
    return {
      file: spanFile ?? flatFile,
      line: span.line,
      col: (sameFile ? flatCol : undefined) ?? span.col ?? undefined,
    };
  }
  return { file: flatFile ?? spanFile, line: undefined, col: undefined };
}

/**
 * stripRedundantLocation — remove a message's trailing `(line N, col N)` when the
 * formatter is about to print the SAME coordinates on its `-->` line.
 *
 * S385. Several diagnostics bake their location into the message text (`… See
 * SPEC §40.8. (line 2, col 5)`). Before #756 the `-->` line printed a bare path
 * with no coordinates, so the baked-in text was the only location an author got.
 * #756 made `-->` carry `path:2:5`, so the two now render back-to-back and the
 * duplication is exact:
 *
 *     warning [W-PROGRAM-REDUNDANT-LOGIC]: … (line 2, col 5)
 *       --> app.scrml:2:5
 *
 * Strips ONLY on an exact coordinate match, so a message that legitimately cites
 * a DIFFERENT line (a "declared at …" cross-reference) keeps its text. Callers
 * must gate on the `-->` line ACTUALLY being printed — which needs a resolved
 * FILE, not just a line — or the message would lose coordinates that nothing
 * replaces. Print-time only; the diagnostic DATA is untouched, mirroring
 * stripRedundantCode.
 *
 * @param {string} message the raw diagnostic message
 * @param {number|undefined} line the line the formatter will print
 * @param {number|undefined} column the column the formatter will print
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
