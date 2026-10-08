/**
 * ship-strip.ts — behaviour-neutral comment + whitespace strip for SHIPPED browser JS (S459).
 *
 * What ships to a browser (the shared runtime, every `.client.js`, every per-route chunk, the
 * chunk-activation script, every worker bundle) carries the compiler's own commentary: on a
 * `<program>` + `<outlet/>` shell, comments are 57% of the runtime's raw bytes. A production
 * build (`scrml build`, or `scrml compile --minify`) drops them; `scrml dev` and a plain
 * `scrml compile` keep the readable text.
 *
 * WHAT THIS IS NOT: a minifier. No identifier is renamed, no syntax is rewritten, no
 * statement is moved. The output is the input's token stream, re-joined:
 *
 *   - every comment is removed, EXCEPT the ones a toolchain reads: `/*! … *\/`, `@license`,
 *     `@preserve`, `__PURE__` / `__NO_SIDE_EFFECTS__` annotations and `sourceMappingURL` /
 *     `sourceURL` pragmas (and a leading `#!` line);
 *   - between two tokens the gap becomes ONE `\n` if the original gap held a line terminator
 *     (a removed comment that spanned a line counts — ECMA-262 §12.4: a MultiLineComment with a
 *     LineTerminator is a LineTerminator for automatic semicolon insertion), otherwise ONE space
 *     where the two tokens would otherwise fuse (`return x`, `a - -b`, `/re/ in o`, `a < /x/`),
 *     otherwise nothing. Indentation goes; line structure stays, so the shipped file reads one
 *     statement per line and every ASI / restricted-production decision is unchanged.
 *
 * Every token is copied as its EXACT source slice — string, template and regex contents
 * (including a `//`, a `/*` or a `</script>` inside them) are never touched.
 *
 * ONE READER, FAIL CLOSED. The result is re-parsed in every goal (script / module) the input
 * parses in, and its token stream — each token's type, exact text, and whether a line
 * terminator precedes it — must equal the input's. Token identity plus line-terminator
 * identity is parse identity. On ANY mismatch, or if the input does not parse, the strip
 * falls back to the comment-only form (original whitespace kept), verified the same way, and
 * failing that ships the input unchanged and says why (`reason`). It never ships text it did
 * not prove equivalent.
 *
 * @module codegen/ship-strip
 */

// @ts-ignore — acorn is imported untyped elsewhere in the compiler for the same reason.
import * as acorn from "acorn";

/** Comments a toolchain reads — kept verbatim. */
const KEEP_COMMENT = /^!|__PURE__|__NO_SIDE_EFFECTS__|@license|@preserve|^[#@]\s*source(Mapping)?URL=/;

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

type Goal = "script" | "module";

interface Tok { start: number; end: number; label: string }
interface Com { start: number; end: number; block: boolean; text: string }

interface Scan { toks: Tok[]; coms: Com[] }

function scan(src: string, goal: Goal): Scan | null {
  const toks: Tok[] = [];
  const coms: Com[] = [];
  try {
    acorn.parse(src, {
      ecmaVersion: "latest",
      sourceType: goal,
      allowHashBang: true,
      onToken: (t: any) => {
        if (t.type.label !== "eof") toks.push({ start: t.start, end: t.end, label: t.type.label });
      },
      onComment: (block: boolean, text: string, start: number, end: number) => {
        coms.push({ start, end, block, text });
      },
    });
  } catch {
    return null;
  }
  return { toks, coms };
}

/** Multi-character punctuators (and comment / HTML-comment openers) a join must not create. */
const FUSIBLE = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "**", "&&", "||", "??", "?.", "++", "--",
  "//", "/*", "<!--", "-->", "</",
];

function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[A-Za-z0-9_$\\]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

/** Would `a` immediately followed by `b` lex differently from `a b`? (Conservative.) */
function needsSpace(a: string, aLabel: string, b: string): boolean {
  const last = a[a.length - 1];
  const first = b[0];
  if (isWordChar(last) && isWordChar(first)) return true;
  // `/re/` followed by a word would absorb it as flags; `1 .x` would read `1.` as the number.
  if (aLabel === "regexp" && isWordChar(first)) return true;
  if (aLabel === "num" && first === ".") return true;
  // A number glued to a following `.` already handled; a `.` glued to a following digit:
  if (last === "." && /[0-9]/.test(first ?? "")) return true;
  for (const p of FUSIBLE) {
    for (let k = 1; k < p.length; k++) {
      if (a.endsWith(p.slice(0, k)) && b.startsWith(p.slice(k))) return true;
    }
  }
  return false;
}

function keptCommentText(src: string, c: Com): string | null {
  if (!KEEP_COMMENT.test(c.text)) return null;
  return src.slice(c.start, c.end);
}

/**
 * Re-join `src`'s tokens. `collapse` = true drops all non-required whitespace; false keeps the
 * original whitespace and only removes comments (the fallback form).
 */
function reprint(src: string, s: Scan, collapse: boolean): string {
  const { toks, coms } = s;
  let ci = 0;
  const out: string[] = [];
  // Leading `#!` line (acorn skips it without reporting a comment).
  let pos = 0;
  if (src.startsWith("#!")) {
    const nl = src.search(LINE_TERMINATOR);
    const end = nl === -1 ? src.length : nl;
    out.push(src.slice(0, end));
    pos = end;
  }
  // The last few characters already emitted: a fusion can span more than one token
  // (`<` `!` `--` would join to the script-goal HTML comment opener `<!--`).
  let tail = "";
  const gapOut = (from: number, to: number, prevRaw: string | null, prevLabel: string, nextRaw: string | null): string => {
    const gap = src.slice(from, to);
    if (gap.length === 0) return "";
    const kept: string[] = [];
    // Original gap text with every REMOVED comment replaced (fallback form only).
    let residue = "";
    let cur = from;
    while (ci < coms.length && coms[ci].start < to) {
      const c = coms[ci++];
      if (c.start < from) continue;
      residue += src.slice(cur, c.start);
      const k = keptCommentText(src, c);
      if (k !== null) {
        kept.push(k);
        residue += k;
      } else {
        // A removed block comment that held a line terminator stays a line terminator.
        residue += c.block ? (LINE_TERMINATOR.test(c.text) ? "\n" : " ") : "";
      }
      cur = c.end;
    }
    residue += src.slice(cur, to);
    const lineBreak = LINE_TERMINATOR.test(gap);
    if (!collapse) return residue;
    if (kept.length > 0) {
      const sep = lineBreak ? "\n" : " ";
      // A kept line comment always ends at a line terminator (or EOF): close it with one.
      return sep + kept.join(sep) + (lineBreak || nextRaw === null ? "\n" : " ");
    }
    if (lineBreak) return "\n";
    if (prevRaw !== null && nextRaw !== null && needsSpace(tail, prevLabel, nextRaw)) return " ";
    return "";
  };
  let prevRaw: string | null = null;
  let prevLabel = "";
  for (const t of toks) {
    const raw = src.slice(t.start, t.end);
    const g = gapOut(pos, t.start, prevRaw, prevLabel, raw);
    // No separator at all at the very start of the file in collapse mode.
    const sep = prevRaw === null && collapse && pos === 0 ? g.replace(/^\n/, "") : g;
    out.push(sep);
    out.push(raw);
    tail = (tail + sep + raw).slice(-4);
    prevRaw = raw;
    prevLabel = t.label;
    pos = t.end;
  }
  // Trailing gap (a final `//# sourceMappingURL=` pragma, a closing license block).
  const trailing = gapOut(pos, src.length, prevRaw, prevLabel, null);
  out.push(collapse ? trailing.replace(/\n$/, "") : trailing);
  let text = out.join("");
  if (collapse && !text.endsWith("\n") && src.endsWith("\n")) text += "\n";
  return text;
}

/** Token-stream signature: type, exact text, and line-terminator-before for every token. */
function signature(src: string, s: Scan): string[] {
  const sig: string[] = [];
  let prevEnd = -1;
  // Comments in a gap are part of the gap: a block comment spanning a line is a line break.
  // The first token has no predecessor, so a line break before it decides nothing.
  for (const t of s.toks) {
    const lb = prevEnd >= 0 && LINE_TERMINATOR.test(src.slice(prevEnd, t.start)) ? "\n" : "";
    sig.push(lb + t.label + "\u0000" + src.slice(t.start, t.end));
    prevEnd = t.end;
  }
  return sig;
}

function sameSignature(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface ShipStripResult {
  /** The text to ship: stripped when proven equivalent, otherwise the input unchanged. */
  text: string;
  /** "full" = comments + whitespace; "comments" = comment-only fallback; "none" = unchanged. */
  mode: "full" | "comments" | "none";
  /** Why a less-stripped form shipped (absent when mode is "full"). */
  reason?: string;
}

/**
 * Strip comments + non-required whitespace from browser JS, proven token-identical.
 * Never throws; never returns text it did not verify.
 */
export function shipStrip(src: string): ShipStripResult {
  if (typeof src !== "string" || src.length === 0) return { text: src, mode: "none", reason: "empty input" };
  const goals: Goal[] = ["script", "module"];
  const scans = new Map<Goal, Scan>();
  for (const g of goals) {
    const s = scan(src, g);
    if (s) scans.set(g, s);
  }
  if (scans.size === 0) return { text: src, mode: "none", reason: "input does not parse as script or module" };
  const ref = scans.values().next().value as Scan;

  const verify = (candidate: string): string | null => {
    for (const [g, s] of scans) {
      const t = scan(candidate, g);
      if (!t) return `stripped text does not parse as ${g}`;
      if (!sameSignature(signature(src, s), signature(candidate, t))) {
        return `stripped token stream differs from the input (${g})`;
      }
    }
    return null;
  };

  const full = reprint(src, ref, true);
  const fullErr = verify(full);
  if (fullErr === null) return { text: full, mode: "full" };

  const commentsOnly = reprint(src, ref, false);
  const comErr = verify(commentsOnly);
  if (comErr === null) return { text: commentsOnly, mode: "comments", reason: fullErr };

  return { text: src, mode: "none", reason: `${fullErr}; comment-only fallback: ${comErr}` };
}

/** Test hook: the collapse-mode reprint WITHOUT verification (never ship this directly). */
export function _reprintForTest(src: string, goal: Goal = "script"): string {
  const s = scan(src, goal);
  return s ? reprint(src, s, true) : src;
}

/**
 * The shipped bytes for a browser artifact under the build's strip setting, plus a warning
 * sink for a fallback. `enabled` false is the identity (dev / plain compile).
 */
export function shipText(
  src: string,
  enabled: boolean,
  artifact: string,
  onFallback?: (artifact: string, mode: ShipStripResult["mode"], reason: string) => void,
): string {
  if (!enabled || typeof src !== "string" || src.length === 0) return src;
  const r = shipStrip(src);
  if (r.mode !== "full" && onFallback) onFallback(artifact, r.mode, r.reason ?? "");
  return r.text;
}
