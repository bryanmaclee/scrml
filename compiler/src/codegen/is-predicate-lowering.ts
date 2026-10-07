// is-predicate-lowering.ts
// ---------------------------------------------------------------------------
// ONE definition of what the §42 / §43 `is` predicates lower to, shared by the
// two codegen paths that lower them:
//
//   1. the STRUCTURED path — `emit-expr.ts emitBinary`, for a `binary` node with
//      op `is-some` / `is-not` / `is-not-not` / `is` (enum variant);
//   2. the STRING path — `rewrite.ts`, for text the structured parser could not
//      model and handed over as an escape-hatch `raw` (a block-bodied
//      `function (…) { … }` / `(…) => { … }` callback, an object-literal method,
//      a sequence expression, …).
//
// Why the string path needs this at all (#1333,
// g-is-some-in-a-function-expression-body-emits-an-undefined-helper):
// `expression-parser.ts preprocessForAcorn` rewrites `x is some` to the
// placeholder call `__scrml_is_some__(x)` so acorn can parse it, and
// `esTreeToExprNode` turns the placeholder back into a `binary` node — but only
// where it builds a tree. A block-bodied function expression is NOT built into
// a tree; it becomes an escape-hatch whose `raw` is sliced out of the
// PREPROCESSED text (it has to be: acorn's offsets are in that text). So the
// placeholder rode the raw into the string rewriter, which had no rule for it,
// and `__scrml_is_some__(v)` — defined nowhere — reached the artifact
// (a ReferenceError at run time, no diagnostic).
//
// The placeholder is the BETTER input for the string path, not a nuisance to
// undo: `rewriteIsPredicates`' structural `scanLhsLeft` already decided the
// operand's extent (call tails, index tails, member chains, `<#id>` refs), and
// the call's balanced parentheses carry that decision. Lowering the placeholder
// here — instead of restoring `x is some` and re-deriving the operand with the
// string path's narrower regexes — keeps one operand-extent decision for the
// whole compiler and one lowering for both paths.
//
// SPEC: §42.2.2a (`x is some` → `x !== null && x !== undefined`), §42.5 / §42.8
// (`x is not` → `(x === null || x === undefined)`; `is not not` → presence),
// §42.2.4 (a compound operand is evaluated EXACTLY ONCE), §43 / §51.3.2
// (`x is .V` matches a unit variant string or a payload variant's tag).
//
// Leaf module: no project imports except the shared code-segment regex
// decision, so both emit-expr.ts and rewrite.ts can import it without a cycle.
// ---------------------------------------------------------------------------

import { regexAllowedAfter } from "./code-segments.ts";

/**
 * The single-eval IIFE parameter name for a non-trivial `is`-operand.
 * `__scrml_*` is the reserved compiler-local prefix; a stable (uncounted) name
 * keeps chunk content hashes deterministic (§47.5 / §40.9.8); each call site
 * gets its own IIFE scope, so reuse never collides.
 */
export const IS_OP_IIFE_LOCAL = "__scrml_is_v";

/** `x is some` / `x is given` / `x is not not` — presence. */
export function lowerPresenceCheck(operand: string, trivial: boolean): string {
  if (trivial) return `(${operand} !== null && ${operand} !== undefined)`;
  return `((${IS_OP_IIFE_LOCAL}) => ${IS_OP_IIFE_LOCAL} !== null && ${IS_OP_IIFE_LOCAL} !== undefined)(${operand})`;
}

/** `x is not` — absence. */
export function lowerAbsenceCheck(operand: string, trivial: boolean): string {
  if (trivial) return `(${operand} === null || ${operand} === undefined)`;
  return `((${IS_OP_IIFE_LOCAL}) => ${IS_OP_IIFE_LOCAL} === null || ${IS_OP_IIFE_LOCAL} === undefined)(${operand})`;
}

/**
 * `x is .V` / `x is T.V` — tag-normalized variant test. `variantLiteral` is the
 * already-quoted JS string of the bare variant name (`"V"`). The left operand
 * is bound once by the IIFE, so a side-effecting operand runs once (§42.2.4).
 */
export function lowerVariantCheck(operand: string, variantLiteral: string): string {
  return `(function(__v){return (typeof __v === "object" && __v !== null && typeof __v.variant === "string" ? __v.variant : __v) === ${variantLiteral};})(${operand})`;
}

// ---------------------------------------------------------------------------
// The placeholder vocabulary `expression-parser.ts formatIsPredicate` writes.
// ---------------------------------------------------------------------------

const IS_PLACEHOLDERS = new Set([
  "__scrml_is_some__",
  "__scrml_is_not__",
  "__scrml_is_not_not__",
  "__scrml_is_variant__",
]);

/** A textual operand that re-reading cannot observe: a bare name, `@cell`, or a literal. */
export function isTrivialOperandText(t: string): boolean {
  if (/^@?[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) return true;
  if (/^-?\d+(\.\d+)?$/.test(t)) return true;
  if (/^"[^"\\]*"$/.test(t) || /^'[^'\\]*'$/.test(t)) return true;
  return false;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Index just past the string literal opened at `s[i]` (`"` or `'`). */
function skipQuoted(s: string, i: number): number {
  const q = s[i];
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === "\\") { j += 2; continue; }
    if (s[j] === q) return j + 1;
    if (s[j] === "\n") return j; // unterminated — stop at the line end
    j++;
  }
  return s.length;
}

/** Index just past the regex literal opened at `s[i]`, or -1 when it is division. */
function skipRegex(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\n") return -1;
    if (c === "\\") { j += 2; continue; }
    if (c === "[") {
      j++;
      while (j < s.length && s[j] !== "]") { if (s[j] === "\n") return -1; j += s[j] === "\\" ? 2 : 1; }
      j++;
      continue;
    }
    if (c === "/") {
      j++;
      while (j < s.length && IDENT_PART.test(s[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

/**
 * Index just past the template literal opened at `s[i]` (a backtick), stepping
 * over every `${ … }` interpolation with the code-aware close finder.
 */
function skipTemplate(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") return j + 1;
    if (c === "$" && s[j + 1] === "{") {
      const close = findCodeClose(s, j + 1);
      if (close === -1) return s.length;
      j = close + 1;
      continue;
    }
    j++;
  }
  return s.length;
}

/**
 * Given `s[openIdx]` an opening `(` / `[` / `{`, return the index of its
 * matching close, skipping string / template / regex literals and comments.
 * -1 when unbalanced.
 */
function findCodeClose(s: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") { i = skipQuoted(s, i); continue; }
    if (c === "`") { i = skipTemplate(s, i); continue; }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e === -1 ? s.length : e + 2; continue; }
    if (c === "/" && regexAllowedAfter(s.slice(0, i))) {
      const e = skipRegex(s, i);
      if (e !== -1) { i = e; continue; }
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
    i++;
  }
  return -1;
}

/** Split `s` at its top-level commas (code-aware). */
function splitTopLevelArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") { i = skipQuoted(s, i); continue; }
    if (c === "`") { i = skipTemplate(s, i); continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    i++;
  }
  parts.push(s.slice(start));
  return parts;
}

/**
 * Lower one placeholder call whose argument text is `argText`. Returns null
 * when the arguments do not have the shape `formatIsPredicate` writes — the
 * call is then left in place, and the emit gate refuses the artifact
 * (validate-emit.ts) rather than shipping a guess.
 */
function lowerOne(name: string, argText: string): string | null {
  const args = splitTopLevelArgs(argText);
  if (name === "__scrml_is_variant__") {
    if (args.length !== 2) return null;
    const operand = lowerIsPlaceholders(args[0].trim());
    const tagText = args[1].trim();
    const m = /^"([^"\\]*)"$/.exec(tagText);
    if (!operand || !m) return null;
    const variant = m[1].replace(/\s+/g, "");
    const bare = variant.slice(variant.lastIndexOf(".") + 1);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(bare)) return null;
    return lowerVariantCheck(operand, JSON.stringify(bare));
  }
  if (args.length !== 1) return null;
  const operand = lowerIsPlaceholders(args[0].trim());
  if (!operand) return null;
  const trivial = isTrivialOperandText(operand);
  return name === "__scrml_is_not__"
    ? lowerAbsenceCheck(operand, trivial)
    : lowerPresenceCheck(operand, trivial);
}

/**
 * Rewrite every `__scrml_is_some__(…)` / `__scrml_is_not__(…)` /
 * `__scrml_is_not_not__(…)` / `__scrml_is_variant__(…, "…")` placeholder call
 * in CODE positions of `text` to its JS lowering. String, template-text, regex
 * and comment interiors are left alone; template `${ … }` interpolations are
 * code and are lowered. Nested placeholders (one inside another's operand) are
 * lowered inside-out. Text with no placeholder is returned unchanged
 * (identity, byte for byte).
 */
export function lowerIsPlaceholders(text: string): string {
  if (!text || text.indexOf("__scrml_is_") === -1) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { const e = skipQuoted(text, i); out += text.slice(i, e); i = e; continue; }
    if (c === "`") {
      // Copy template text verbatim; lower each `${ … }` interpolation as code.
      let j = i + 1;
      out += c;
      while (j < text.length) {
        const t = text[j];
        if (t === "\\") { out += text.slice(j, j + 2); j += 2; continue; }
        if (t === "`") { out += t; j++; break; }
        if (t === "$" && text[j + 1] === "{") {
          const close = findCodeClose(text, j + 1);
          if (close === -1) { out += text.slice(j); j = text.length; break; }
          out += "${" + lowerIsPlaceholders(text.slice(j + 2, close)) + "}";
          j = close + 1;
          continue;
        }
        out += t;
        j++;
      }
      i = j;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") { let e = i; while (e < text.length && text[e] !== "\n") e++; out += text.slice(i, e); i = e; continue; }
    if (c === "/" && text[i + 1] === "*") { const e0 = text.indexOf("*/", i + 2); const e = e0 === -1 ? text.length : e0 + 2; out += text.slice(i, e); i = e; continue; }
    if (c === "/" && regexAllowedAfter(text.slice(0, i))) {
      const e = skipRegex(text, i);
      if (e !== -1) { out += text.slice(i, e); i = e; continue; }
    }
    if (IDENT_START.test(c) && (i === 0 || !IDENT_PART.test(text[i - 1]))) {
      let j = i + 1;
      while (j < text.length && IDENT_PART.test(text[j])) j++;
      const name = text.slice(i, j);
      // A member name (`o.__scrml_is_some__`) is not a placeholder CALL — leave
      // it for the emit gate rather than splice a lowering after a `.`.
      let p = i - 1;
      while (p >= 0 && /\s/.test(text[p])) p--;
      if (IS_PLACEHOLDERS.has(name) && text[p] !== ".") {
        let k = j;
        while (k < text.length && /\s/.test(text[k])) k++;
        if (text[k] === "(") {
          const close = findCodeClose(text, k);
          if (close !== -1) {
            const lowered = lowerOne(name, text.slice(k + 1, close));
            if (lowered !== null) {
              out += lowered;
              i = close + 1;
              continue;
            }
          }
        }
      }
      out += name;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
