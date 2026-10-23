/**
 * arm-list-split.ts — read a RAW arm-list text (the token-joined text an expression-position
 * `match` carries as `rawArms`, or a raw arm the codegen re-splits) with the LEXER, not a
 * character heuristic. S469 round 2 (s469-impl1-arm-commas review F1 / F2).
 *
 * Why: the character scanners that split arm text tracked quotes but not regular-expression
 * literals. A regex holding a `,` (`/a,b/`) looked like an arm separator (F1: a valid arm
 * refused), and a regex holding a quote (`/"/`, `/'/`) flipped the string tracking so a
 * following arm boundary was never seen (F2: an arm silently DROPPED, the previous arm
 * returning the next arm's pattern). The logic tokenizer already decides regex-vs-division
 * (`tokenizeLogic` → `isRegexContext`, with S412's control-flow-head rule), strings,
 * templates and comments; every function here reads its tokens, so there is one reader.
 *
 * The arm text is re-tokenized on its own. The one place a lone re-tokenization could read a
 * `/` differently from the statement it came from is right after the deprecated `->` arm
 * arrow (two PUNCT tokens, so `-> /re/` would lex as division): `armTokens` reads that arrow
 * as `:>` (same length, offsets unchanged) before tokenizing.
 */

import { tokenizeLogic } from "./tokenizer.ts";

export interface ArmTok {
  kind: string;
  text: string;
  start: number;
  end: number;
}

/** The tokens of `s` (offsets into `s`), comments dropped; null if the lexer throws. */
export function armTokens(s: string): ArmTok[] | null {
  if (typeof s !== "string") return null;
  // `->` (deprecated arm arrow) → `:>`, same length: an arm arrow puts the lexer in
  // regex context, as `:>` / `=>` already do.
  const lexText = s.replace(/(^|[\s)\]\w"'`])->(?=\s)/g, (_m, p: string) => p + ":>");
  let raw: Array<{ kind: string; text: string; span: { start: number; end: number } }>;
  try {
    raw = tokenizeLogic(lexText, 0, 1, 1, []) as never;
  } catch {
    return null;
  }
  const out: ArmTok[] = [];
  for (const t of raw) {
    if (!t || t.kind === "EOF" || t.kind === "COMMENT") continue;
    out.push({ kind: t.kind, text: t.text, start: t.span.start, end: t.span.end });
  }
  return out;
}

function depthDelta(t: ArmTok): number {
  if (t.kind !== "PUNCT") return 0;
  if (t.text === "(" || t.text === "[" || t.text === "{") return 1;
  if (t.text === ")" || t.text === "]" || t.text === "}") return -1;
  return 0;
}

const isArrowTok = (t: ArmTok | undefined): boolean =>
  !!t && t.kind === "OPERATOR" && (t.text === ":>" || t.text === "=>");

/** Indices of the depth-0 `,` tokens. */
function topLevelCommaIdx(ts: ArmTok[]): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (depth === 0 && t.kind === "PUNCT" && t.text === ",") out.push(k);
    depth += depthDelta(t);
  }
  return out;
}

function hasTopLevelArrow(ts: ArmTok[], from: number, to: number): boolean {
  let depth = 0;
  for (let k = from; k < to; k++) {
    if (depth === 0 && isArrowTok(ts[k])) return true;
    depth += depthDelta(ts[k]);
  }
  return false;
}

/**
 * S469 (dpa-073 F2 / F5(1)) — split one arm string at its depth-0 `,` arm separators and
 * drop the trailing one. Fail closed: taken only when EVERY piece carries a depth-0 arm
 * arrow and only the LAST piece is empty (the trailing `,`); otherwise the text is returned
 * whole, for the lowering to refuse (`rawArmHasStrayComma`).
 */
export function splitArmSeparatorCommas(arm: string): string[] {
  if (!arm.includes(",")) return [arm];
  const ts = armTokens(arm);
  if (!ts) return [arm];
  const commas = topLevelCommaIdx(ts);
  if (commas.length === 0) return [arm];
  const bounds = [-1, ...commas, ts.length];
  const pieces: Array<[number, number]> = [];
  for (let b = 0; b + 1 < bounds.length; b++) pieces.push([bounds[b] + 1, bounds[b + 1]]);
  // the trailing `,` leaves one empty last piece
  if (pieces.length > 1 && pieces[pieces.length - 1][0] >= pieces[pieces.length - 1][1]) pieces.pop();
  if (pieces.some(([a, z]) => a >= z)) return [arm]; // a leading `,` or `,,`
  if (!pieces.every(([a, z]) => hasTopLevelArrow(ts, a, z))) return [arm];
  return pieces.map(([a, z]) => arm.slice(ts[a].start, ts[z - 1].end).trim());
}

/**
 * S469 — does a raw arm still hold a depth-0 `,` token? After `splitArmSeparatorCommas`
 * every separator is gone, so one that remains separates nothing: `,,`, a leading `,`, or a
 * comma sequence in the body (`.A :> f(x), 2`; scrml has no comma operator, §40.8). A `,`
 * inside a string, a template, a regular expression or brackets is not one. If the text
 * cannot be lexed the answer is `true` (fail closed: the lowering refuses it).
 */
export function rawArmHasStrayComma(arm: string): boolean {
  if (typeof arm !== "string" || !arm.includes(",")) return false;
  const ts = armTokens(arm);
  if (!ts) return true;
  return topLevelCommaIdx(ts).length > 0;
}

/**
 * Does the arm text hold a `/` the lexer reads as DIVISION? Used only to word a refusal:
 * impl#1's lexer reads a `/` right after a binary `+` / `-` / `*` / `%` as division, so a
 * regular expression written there (`"x" + /a,b/.source`) reaches this text as
 * `/ a , b /` (g-impl1-regex-after-binary-operator-lexed-as-division-s469).
 */
export function armHasDivisionSlash(arm: string): boolean {
  const ts = armTokens(arm);
  return !!ts && ts.some((t) => t.kind === "PUNCT" && t.text === "/");
}

/**
 * Literal spans of `s` as the lexer reads them — every STRING (quoted or template) and REGEX
 * token, keyed by start offset. A character scanner that looks for arm heads skips these
 * spans whole instead of guessing where a literal ends.
 */
export function literalSpans(s: string): Map<number, { end: number; kind: "string" | "template" | "regex" }> | null {
  const ts = armTokens(s);
  if (!ts) return null;
  const out = new Map<number, { end: number; kind: "string" | "template" | "regex" }>();
  for (const t of ts) {
    if (t.kind === "REGEX") out.set(t.start, { end: t.end, kind: "regex" });
    else if (t.kind === "STRING") out.set(t.start, { end: t.end, kind: s[t.start] === "`" ? "template" : "string" });
  }
  return out;
}
