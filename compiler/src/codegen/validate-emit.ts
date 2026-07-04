/**
 * Emitted-JS parse gate (Approach A — ratified S141, A+D).
 *
 * After codegen produces the final JS artifacts, parse each one with the
 * in-process Acorn that is already a compiler dependency, and FAIL the compile
 * with `E-CODEGEN-INVALID-LOGIC` if any artifact does not parse. This makes
 * "compile exits 0 ⇒ the emitted JS is at least syntactically valid" a
 * compile-time invariant rather than a runtime time-bomb.
 *
 * In-tree precedent: `meta-eval.ts:reparseEmitted()` already re-parses the
 * compiler's own `^{}` meta-block output and fails with `E-META-EVAL-002`.
 * This module mirrors that pattern for the final `.client.js` / `.server.js` /
 * library / per-route-chunk artifacts. Design source:
 * `scrml-support/docs/deep-dives/emitted-js-parse-gate-invariant-2026-05-29.md`.
 *
 * Cost: an always-on pass over a 8433-line / 64-artifact reference app measures
 * ~24 ms median (in-process, no subprocess spawn) — comfortably inside the
 * SPEC §2.4 "4000 lines < 1s" budget. The subprocess `node --check` alternative
 * (~31 ms/spawn, ~2.2 s on the same corpus) was eliminated on perf in the
 * deep-dive. See the gate's wiring comment in `api.js` for the always-on vs
 * flag-gated decision rationale.
 *
 * @module codegen/validate-emit
 */

// @ts-ignore — acorn ships its own types but the compiler imports it untyped
// elsewhere (expression-parser.ts:16) for the same reason.
import * as acorn from "acorn";
import { CGError } from "./errors.ts";

/**
 * An emitted artifact to validate. `sourceType` selects the Acorn parse goal:
 * client IIFE bundles and server/library/chunk ESM are BOTH accepted because
 * the gate parses every artifact as `module` first (a superset that admits
 * `import`/`export`) and only falls back to `script` if the module parse fails
 * for a reason OTHER than a real syntax error — see `validateEmittedArtifact`.
 */
export interface EmitArtifact {
  /** Source-file path the artifact was generated from (for the diagnostic). */
  sourceFile: string;
  /** The dist-facing artifact name, e.g. `app.client.js` (for the diagnostic). */
  artifact: string;
  /** The exact JS bytes about to be written. */
  contents: string;
}

/**
 * Acorn parse options. `ecmaVersion: 2022` accepts every modern construct the
 * compiler legitimately emits (async/await, template literals, optional
 * chaining `?.`, nullish `??`, spread, class fields). `sourceType: "module"`
 * additionally accepts top-level `import`/`export` (server + library + the
 * stdlib-import-rewritten client bundles). Emitted JS never uses the few
 * script-only constructs that a module goal rejects (top-level `return`,
 * `with`), so the module goal is a safe superset for every artifact.
 *
 * Verified empirically (2026-05-29) against the trucking-dispatch reference
 * app: every VALID artifact parses clean as `module`; the only module-parse
 * failures are genuine miscompiles (truncated `!==`, leaked `server {` block),
 * which is exactly what the gate exists to catch.
 */
const PARSE_OPTIONS = { ecmaVersion: 2022 as const, sourceType: "module" as const };

/**
 * Parse one emitted artifact. Returns a `CGError` with code
 * `E-CODEGEN-INVALID-LOGIC` if it does not parse, or `null` if it is valid JS.
 *
 * The diagnostic names the artifact + the byte/line/column offset Acorn
 * reports + a short offending snippet (a 60-char window centered on the parse
 * position), and frames the failure as a COMPILER DEFECT — the adopter cannot
 * fix the emitted JS, so "please report it" is the correct audience message.
 */
export function validateEmittedArtifact(art: EmitArtifact): CGError | null {
  try {
    acorn.parse(art.contents, PARSE_OPTIONS);
    return null;
  } catch (e) {
    // Acorn's SyntaxError carries { pos, loc: { line, column }, message }.
    const err = e as { pos?: number; loc?: { line: number; column: number }; message?: string };
    const pos = typeof err.pos === "number" ? err.pos : 0;
    const line = err.loc?.line ?? 1;
    const col = err.loc?.column ?? 0;
    const snippet = extractSnippet(art.contents, pos);
    const rawMessage = (err.message ?? String(e)).replace(/\s*\(\d+:\d+\)\s*$/, "");

    const message =
      `E-CODEGEN-INVALID-LOGIC: the compiler could not lower this construct to valid output.\n` +
      `  artifact: ${art.artifact} (byte ${pos}, line ${line}, column ${col})\n` +
      `  ${rawMessage}\n` +
      `    ${snippet}\n` +
      `  This is a compiler defect (codegen produced malformed output). Please report it. ` +
      `No codegen output artifacts were written (vendored stdlib shims may already be staged).`;

    return new CGError(
      "E-CODEGEN-INVALID-LOGIC",
      message,
      { file: art.sourceFile, start: pos, end: pos, line, col },
      "error",
    );
  }
}

/**
 * Validate a batch of emitted artifacts. Returns one `CGError` per artifact
 * that fails to parse (empty array when all artifacts are valid JS). The caller
 * pushes these into the standard CG error stream so the compile aborts (exit 1,
 * no files written) per the §2.2.1 invariant.
 */
export function validateEmittedArtifacts(artifacts: EmitArtifact[]): CGError[] {
  const errors: CGError[] = [];
  for (const art of artifacts) {
    const err = validateEmittedArtifact(art);
    if (err) errors.push(err);
  }
  return errors;
}

/**
 * Is `src` exactly ONE JavaScript expression (consuming the whole string)?
 *
 * Uses the same in-process Acorn the emit gate uses, via `parseExpressionAt`:
 * parse a single expression starting at offset 0, then require it to consume
 * the entire (trimmed) input — any trailing non-whitespace means a SECOND
 * statement follows, so the input was multi-statement (not a lone expression).
 * A parse failure (a leading non-expression statement such as a `let`/`const`
 * declaration) is likewise NOT a single expression.
 *
 * Used by the §61 `<endpoint>` codegen (`emit-server.ts`) to detect a
 * multi-statement bare-body arm BEFORE wrapping it as `await (<expr>)`: a
 * multi-statement body cannot be a single value-expression, so the compiler
 * fires the clean named `E-ENDPOINT-MULTI-STATEMENT-ARM` (a SPEC §61.10
 * future-wave gap) instead of letting the malformed `await (…)` trip the
 * generic `E-CODEGEN-INVALID-LOGIC` gate above. This correctly admits the
 * SUPPORTED forms — a single value-expression that legitimately spans multiple
 * source lines (a call split across lines, a multi-line object literal) parses
 * as one expression and consumes the whole string; only a genuine 2+-statement
 * body leaves a trailing statement.
 *
 * An empty string returns `true` (the caller handles the self-closing / empty
 * arm via its own 204 short-circuit before reaching this check).
 */
export function isSingleJsExpression(src: string): boolean {
  const t = (src ?? "").trim();
  if (t === "") return true;
  try {
    // parseExpressionAt parses ONE expression and stops; `.end` is the offset
    // just past it. ecmaVersion 2022 matches the emit gate's PARSE_OPTIONS.
    const node = acorn.parseExpressionAt(t, 0, { ecmaVersion: 2022 }) as { end?: number };
    const end = typeof node?.end === "number" ? node.end : 0;
    return t.slice(end).trim().length === 0;
  } catch {
    return false;
  }
}

/**
 * Extract a single-line, ~60-char window centered on `pos` for the diagnostic.
 * Collapses interior whitespace so a multi-line / heavily-indented emit reads
 * cleanly on one line, and marks the truncation with ellipses.
 */
function extractSnippet(src: string, pos: number): string {
  const radius = 30;
  const start = Math.max(0, pos - radius);
  const end = Math.min(src.length, pos + radius);
  let window = src.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) window = "..." + window;
  if (end < src.length) window = window + "...";
  return window;
}
