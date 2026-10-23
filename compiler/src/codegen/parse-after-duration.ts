// =============================================================================
// parse-after-duration.ts — shared helper for the `after=` duration grammar
// =============================================================================
//
// **SPEC:** §51.12.3 (literal form) + §51.12.3.1 (S67 computed-delay amendment).
//
// Two surfaces consume this helper:
//   1. Legacy `<machine>` form `.From after DURATION => .To` — parsed in
//      `type-system.ts:parseMachineRules` (the `after` clause between the
//      from-spec and `=>`).
//   2. Engine `<onTimeout>` element `<onTimeout after=DURATION to=.Variant/>`
//      — `OnTimeoutEntry.after` raw text from `engine-statechild-parser.ts`.
//
// Grammar (informal):
//   DURATION  ::= LITERAL_DURATION | COMPUTED_DURATION
//   LITERAL_DURATION  ::= NUMBER UNIT
//   COMPUTED_DURATION ::= '${' EXPR '}' UNIT
//   NUMBER ::= digit+ ('.' digit+)?
//   UNIT   ::= 'ms' | 's' | 'm' | 'h'
//   EXPR   ::= any JS expression text (single-level brace match per S67 dispatch
//              — spec examples use parens, not nested braces, inside the EXPR)
//
// The literal form is constant-folded to integer milliseconds at compile time;
// the computed form is preserved as `{exprText, unitMultiplier}` so the
// codegen layer can emit per-arm runtime computation. Per SPEC §51.12.3.1
// runtime values that are negative or NaN are clamped at zero by the runtime
// — the compile-time check only guards against unparseable shapes.
//
// **Single-level brace limitation (§3 decision #2):** the regex
// `\$\{([^}]*)\}<unit>` matches the FIRST `}`. Spec examples
//   `${@backoffDelay}ms`
//   `${Math.min(1000 * 2 ** @attempt, 30000)}ms`
// work because they use parens, not nested braces, inside the expression. If a
// future use case demands nested braces (e.g., object-literal expressions), this
// helper SHOULD be upgraded to depth-tracking parsing. Until then the regex
// shape is documented + accepted.

/** Result discriminator for `parseAfterDuration`. */
import { logicBlockClose } from "../interpolation-extent.ts";

export type AfterDurationResult =
  | { kind: "literal"; ms: number }
  | { kind: "computed"; exprText: string; unitMultiplier: number }
  | { kind: "invalid"; reason: string };

/** Map from UNIT suffix to multiplier (× to convert to milliseconds). */
const UNIT_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60000,
  h: 3600000,
};

/**
 * Parse a raw `after=` duration string.
 *
 * @param raw  the raw text. Quotes are NOT stripped here — caller (e.g., the
 *             engine state-child parser) already strips them.
 * @returns    one of three discriminated shapes:
 *               - `{kind: "literal", ms}` — constant-folded milliseconds.
 *               - `{kind: "computed", exprText, unitMultiplier}` — caller
 *                  emits `(exprText) * unitMultiplier` then clamps.
 *               - `{kind: "invalid", reason}` — malformed.
 *
 * **Negative literal handling:** `Math.round(n × multiplier)` followed by a
 * non-negative check. A negative literal (e.g. `-30s`) is rejected with
 * `kind: "invalid"`. The runtime clamp covers the computed-form path only.
 *
 * **Whitespace:** the literal regex permits whitespace between number + unit
 * (matching the legacy machine grammar `.Loading after 30 s => .X`). For
 * engine `<onTimeout after=...>` the parser strips quotes + trims so this is
 * not invoked with leading/trailing whitespace, but the regex tolerates it
 * defensively.
 */
export function parseAfterDuration(raw: string): AfterDurationResult {
  if (typeof raw !== "string") {
    return { kind: "invalid", reason: "duration text is not a string" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: "invalid", reason: "duration is empty" };
  }

  // Computed form FIRST (so `${...}ms` doesn't accidentally fall through the
  // literal regex). S469 (review of 5a88c3030, L2) — the `${…}` extent is read by THE one
  // reader (interpolation-extent `logicBlockClose`: acorn, both goals), not a single-level
  // `[^}]*` match, which made `${ f({a:1}) }ms` / `${ x !{ … } }ms` "invalid" and the timer
  // was dropped.
  let computedMatch: RegExpMatchArray | null = null;
  if (trimmed.startsWith("${")) {
    const close = logicBlockClose(trimmed, 0);
    if (close < 0) {
      return { kind: "invalid", reason: `computed duration '${trimmed}' has a \`\${…}\` that cannot be read` };
    }
    const unitM = trimmed.slice(close + 1).trim().match(/^(ms|s|m|h)$/i);
    if (unitM) computedMatch = [trimmed, trimmed.slice(2, close), unitM[1]!] as unknown as RegExpMatchArray;
  }
  if (computedMatch) {
    const exprText = computedMatch[1]!.trim();
    if (exprText.length === 0) {
      return {
        kind: "invalid",
        reason: "computed duration `${...}` has an empty expression",
      };
    }
    const unit = computedMatch[2]!.toLowerCase();
    const unitMultiplier = UNIT_MULTIPLIERS[unit];
    // unitMultiplier is guaranteed defined by the regex's unit alternation,
    // but TS narrowing through Record<string, number> keeps the index
    // signature unsound; assert defensively.
    if (typeof unitMultiplier !== "number") {
      return {
        kind: "invalid",
        reason: `unknown duration unit '${unit}' (expected ms/s/m/h)`,
      };
    }
    return { kind: "computed", exprText, unitMultiplier };
  }

  // Literal form. Negative numbers explicitly NOT permitted at compile time
  // (the spec text in §51.12.3 + §51.12.3.1 says SHALL produce non-negative
  // — for a literal this is a static error; for computed it's a runtime
  // clamp. We mirror that split here.).
  const literalMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (literalMatch) {
    const n = parseFloat(literalMatch[1]!);
    const unit = literalMatch[2]!.toLowerCase();
    const multiplier = UNIT_MULTIPLIERS[unit];
    if (typeof multiplier !== "number") {
      return {
        kind: "invalid",
        reason: `unknown duration unit '${unit}' (expected ms/s/m/h)`,
      };
    }
    const ms = Math.round(n * multiplier);
    if (!Number.isFinite(ms) || ms < 0) {
      return {
        kind: "invalid",
        reason: `duration '${trimmed}' is not a finite non-negative number`,
      };
    }
    return { kind: "literal", ms };
  }

  return {
    kind: "invalid",
    reason:
      `duration '${trimmed}' does not match LITERAL form ` +
      `(N{ms|s|m|h}) or COMPUTED form (\${expr}{ms|s|m|h})`,
  };
}
