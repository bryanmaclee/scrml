/**
 * @module is-some-deprecation
 * §42.2.2a / §55.1 / §63 (S462) — `is some` is the soft-deprecated spelling of `is given`.
 *
 * Ruling: user-voice-scrml.md S462 "a, validator too, go" — the expression form `x is some` is
 * SOFT-DEPRECATED through the §63 lifecycle (Stage 1: a W-lint, a reserved E-code, a `scrml fix`
 * rule), and the §55.1 universal-core validator `is some` retires on the same window to `is given`.
 * Both spellings parse IDENTICALLY (§63.1): the expression parser lowers each to the one `is-some`
 * presence node, and the validator scan names both `is given`.
 *
 * ONE code covers both surfaces — `W-IS-SOME-DEPRECATED` (reserved `E-IS-SOME-DEPRECATED`) —
 * because the two are one word with one replacement; the message says which surface it is.
 *
 * WHERE THE SITES COME FROM: impl#1's own token streams (ast-builder.js `_isSomeSink` — an `is`
 * KEYWORD followed by the IDENT `some`, at the real source offset of a logic body, an error / test
 * body or an attribute expression value). This module CONFIRMS each candidate against the file's
 * source text — `some` at the offset, whole-word, with only whitespace between it and a whole-word
 * `is` before it — and drops anything the source does not confirm. The lint (api.js, stage TAB) and
 * the `scrml fix` rule (commands/fix-is-some.js) both read the confirmed list, so they agree on
 * every site by construction.
 */

export const IS_SOME_LINT = "W-IS-SOME-DEPRECATED";
export const IS_SOME_RESERVED_ERROR = "E-IS-SOME-DEPRECATED";

export interface IsSomeSite {
  /** Absolute source offset of the `some` word. */
  start: number;
  end: number;
  kind: "expr" | "validator";
}

export interface ConfirmedIsSomeSite extends IsSomeSite {
  /** Offset of the `is` keyword before it. */
  isStart: number;
  line: number;
  col: number;
}

const ID = /[A-Za-z0-9_$]/;

/** Confirm each candidate site against `source`; return the confirmed ones in source order. */
export function confirmIsSomeSites(source: string, sites: ReadonlyArray<IsSomeSite> | undefined | null): ConfirmedIsSomeSite[] {
  if (typeof source !== "string" || !Array.isArray(sites) || sites.length === 0) return [];
  const out: ConfirmedIsSomeSite[] = [];
  const seen = new Set<number>();
  for (const s of sites) {
    if (!s || typeof s.start !== "number" || seen.has(s.start)) continue;
    const { start } = s;
    const end = start + 4;
    if (source.slice(start, end) !== "some") continue;
    if (end < source.length && ID.test(source[end])) continue;
    let k = start - 1;
    let ws = 0;
    while (k >= 0 && /\s/.test(source[k])) { k--; ws++; }
    if (ws === 0 || k < 1 || source[k] !== "s" || source[k - 1] !== "i") continue;
    const isStart = k - 1;
    if (isStart > 0 && ID.test(source[isStart - 1])) continue;
    seen.add(start);
    const { line, col } = lineColOf(source, start);
    out.push({ start, end, kind: s.kind === "validator" ? "validator" : "expr", isStart, line, col });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function lineColOf(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
  }
  return { line, col: offset - lineStart + 1 };
}

/** The W-IS-SOME-DEPRECATED message for one site. */
export function isSomeDeprecatedMessage(kind: "expr" | "validator"): string {
  if (kind === "validator") {
    return (
      "the validator `is some` is the soft-deprecated spelling of `is given` (§55.1). " +
      "Write `<x is given>` — the same predicate, the same `.NotSome` error, the same program. " +
      "`scrml fix` rewrites it (rule `is-some`)."
    );
  }
  return (
    "`x is some` is the soft-deprecated spelling of `x is given` (§42.2.2a). " +
    "Write `is given` — it means the same and compiles to the same program. " +
    "`scrml fix` rewrites it (rule `is-some`)."
  );
}

export interface IsSomeDiagnostic {
  code: string;
  message: string;
  severity: "info";
  span: { file: string; start: number; end: number; line: number; col: number };
}

/** One info-level W-IS-SOME-DEPRECATED per confirmed site of one file. */
export function isSomeDeprecationDiagnostics(
  filePath: string,
  source: string | undefined,
  sites: ReadonlyArray<IsSomeSite> | undefined | null,
): IsSomeDiagnostic[] {
  if (typeof source !== "string") return [];
  return confirmIsSomeSites(source, sites).map((s) => {
    const at = lineColOf(source, s.isStart);
    return {
      code: IS_SOME_LINT,
      message: isSomeDeprecatedMessage(s.kind),
      severity: "info" as const,
      span: { file: filePath, start: s.isStart, end: s.end, line: at.line, col: at.col },
    };
  });
}
