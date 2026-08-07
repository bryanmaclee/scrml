// code-segments.ts
// ---------------------------------------------------------------------------
// Shared regex-literal / comment / string-aware code-segment splitter.
//
// GITI-017 (S124 → S125): scrml keyword-lowering passes (`not `→`!`,
// `not`→`null`, `is not`→null-check, etc.) operate as text substitutions over
// emitted/parsed source. Without a fence, those substitutions corrupt the
// INTERIOR of regex literals, comments, and string literals — a silent
// data-corruption class: the JS stays syntactically valid and runs, but the
// regex body / comment text is wrong (e.g. `/not a jj repo/i` → `/!a jj repo/i`).
//
// S124 (f181d60a) fenced the codegen pass (rewriteNotKeyword in rewrite.ts).
// S125 (this module) extracts that fence into a leaf module with NO project
// imports so BOTH rewrite.ts AND expression-parser.ts (preprocessForAcorn,
// which has its OWN unfenced `not`-lowering — the residual half of the bug)
// can share ONE implementation rather than maintaining parallel mechanisms.
// Leaf placement avoids the rewrite.ts ↔ expression-parser.ts import cycle.

// Keywords that may precede a regex literal in expression position. Per
// ECMA-262, `/` after one of these ends an "expression-prefix" context, so the
// `/` opens a regex (not division). The set is intentionally minimal — false
// negatives (treating a regex as division) only fail to MASK and risk
// re-introducing the corruption; false positives (treating a division as
// regex) would mask code we should rewrite. Erring minimal preserves
// correctness on division-heavy code.
const REGEX_PERMISSIVE_KEYWORDS = new Set([
  "return", "typeof", "void", "delete", "new", "in", "of",
  "instanceof", "throw", "yield", "await",
]);

// Returns true if a `/` appearing immediately after `codeBefore` should be
// interpreted as the opener of a regex literal (rather than as division).
// `codeBefore` is the slice of source-text ending just before the `/`.
export function regexAllowedAfter(codeBefore: string): boolean {
  // Strip trailing whitespace to find the last meaningful character.
  let i = codeBefore.length - 1;
  while (i >= 0 && /\s/.test(codeBefore[i])) i--;
  // No prior code → expression start → regex.
  if (i < 0) return true;
  const lastCh = codeBefore[i];
  // After punctuation / operator → regex.
  // `}` is intentionally included: in JS it ends a block-statement (regex
  // follows) far more commonly than an object-literal in expression
  // position (where division would follow). Errs toward masking.
  if ("(,;:?[{=<>+-*%&|^!~}".includes(lastCh)) return true;
  // After identifier end → check for regex-permissive keyword.
  if (/[A-Za-z_$]/.test(lastCh)) {
    let j = i;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(codeBefore[j])) j--;
    const token = codeBefore.slice(j + 1, i + 1);
    return REGEX_PERMISSIVE_KEYWORDS.has(token);
  }
  // After `)`, `]`, digit, `.` → division.
  return false;
}

// ---------------------------------------------------------------------------
// Object-shorthand regions (S325, g-mangler-scope-blind-shorthand-key-rename)
//
// The second region class this module knows about. The first (above) is
// LEXICAL — a string / regex / comment is opaque because of what it IS. This
// one is STRUCTURAL — `{a, b, c}` is a region because of what its identifiers
// MEAN: in an object literal they are PROPERTY NAMES as well as value
// references, and in a destructuring pattern they are property names as well as
// BINDINGS. A text pass that renames one of them renames both halves at once,
// which is never what any caller wants.
//
// Concretely, `emit-client.ts`'s whole-buffer fn-name mangle turned
//
//     const inner = wrapped || {get, post, put, del, patch}
// into
//     const inner = wrapped || {_scrml_get_2, _scrml_post_3, …}
//
// so `inner.get(...)` became `undefined` — no syntax error, no diagnostic.
// ---------------------------------------------------------------------------

/**
 * What a `{ident, ident, …}` group IS, decided from the tokens around it.
 *
 *   object-literal   an object literal in EXPRESSION position. Each member is a
 *                    shorthand property: the KEY must survive verbatim, the
 *                    VALUE is an ordinary reference and may be rewritten (which
 *                    means the caller must EXPAND `n` to `n: <rewritten>`).
 *   binding-pattern  a destructuring pattern. Both halves are off limits: the
 *                    key names the property being READ, the binding is a NEW
 *                    local. Emit verbatim.
 *   unknown          not decided. The caller SHALL leave its existing behaviour
 *                    unchanged for this region — narrowing on a guess is how a
 *                    coverage hole gets opened (pa-base §8).
 */
export type BraceGroupKind = "object-literal" | "binding-pattern" | "unknown";

export interface ObjectShorthandRegion {
  /** Index of the opening `{` within the code segment. */
  start: number;
  /** Index one past the closing `}`. */
  end: number;
  kind: BraceGroupKind;
  /** The bare identifiers between the braces, in source order. */
  names: string[];
}

/**
 * A `{` group whose ENTIRE content is a comma-separated list of bare
 * identifiers. Anything else — a `key: value` pair, a nested brace, a call, a
 * spread — fails to match, which is what keeps the cross-file module-registry
 * footer (`_scrml_modules[k] = { pub: emitted, … }`, emit-client.ts) outside
 * this region class: its members are `key: value`, not shorthand.
 */
const SHORTHAND_GROUP_RE =
  /\{\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)*\s*,?\s*\}/g;

/**
 * Words that are never a shorthand property name, so a `{…}` containing one is
 * a BLOCK, not an object. `{ return }` / `{ break }` are the realistic emitted
 * shapes; the rest are here so the set reads as a rule rather than a patch.
 */
const NOT_A_PROPERTY_NAME = new Set([
  "return", "break", "continue", "throw", "yield", "await", "delete", "typeof",
  "void", "new", "in", "of", "instanceof", "this", "true", "false", "null",
  "if", "else", "for", "while", "do", "switch", "case", "default", "try",
  "catch", "finally", "function", "class", "const", "let", "var", "export",
  "import", "debugger", "with",
]);

/**
 * Characters that, immediately to the left of a `{`, put it in EXPRESSION
 * position — i.e. make it an object literal rather than a block.
 *
 * Deliberately minimal, in the same spirit as `REGEX_PERMISSIVE_KEYWORDS`
 * above: a false negative only leaves today's behaviour in place, while a false
 * positive would fence (or expand) something that is not an object at all.
 * `:` is NOT in the set — a `label: { … }` and a `case x: { … }` are blocks, and
 * a `key: {a, b}` property value has no measured incidence.
 * `>` is NOT in the set either, because the `>` of `=> {` opens a function BODY.
 */
const BRACE_OPENS_OBJECT_AFTER = new Set([",", "[", "=", "|", "&", "?"]);

function identifierEndingAt(code: string, i: number): { token: string; before: number } | null {
  if (i < 0 || !/[A-Za-z0-9_$]/.test(code[i])) return null;
  let j = i;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(code[j])) j--;
  return { token: code.slice(j + 1, i + 1), before: j };
}

function skipSpaceLeft(code: string, i: number): number {
  while (i >= 0 && /\s/.test(code[i])) i--;
  return i;
}

function skipSpaceRight(code: string, i: number): number {
  while (i < code.length && /\s/.test(code[i])) i++;
  return i;
}

/** Decide what a `{ident, …}` group at [open, closeExclusive) is. */
export function classifyBraceGroup(
  code: string,
  open: number,
  closeExclusive: number,
): BraceGroupKind {
  // ---- right of `}` -------------------------------------------------------
  const r = skipSpaceRight(code, closeExclusive);
  // `{a} = x` — assignment-destructuring TARGET (`==` is a comparison against
  // an object literal, `=>` is an arrow whose params were parenthesised).
  if (code[r] === "=" && code[r + 1] !== "=" && code[r + 1] !== ">") return "binding-pattern";
  // `({a}) => …` — arrow FORMAL PARAMETER.
  if (code[r] === ")") {
    const k = skipSpaceRight(code, r + 1);
    if (code[k] === "=" && code[k + 1] === ">") return "binding-pattern";
  }

  // ---- left of `{` --------------------------------------------------------
  const i = skipSpaceLeft(code, open - 1);
  if (i < 0) return "unknown";
  const ch = code[i];

  if (ch === "(") {
    // `(` is genuinely ambiguous: `f({a, b})` is a call argument (an object
    // literal) and `function f({a, b})` is a formal parameter (a pattern). Only
    // the `function`-headed form is decided; everything else reads as a call.
    const j = skipSpaceLeft(code, i - 1);
    const head = identifierEndingAt(code, j);
    if (head) {
      if (head.token === "function") return "binding-pattern";
      // `function NAME(` — step over NAME and look once more.
      const outer = identifierEndingAt(code, skipSpaceLeft(code, head.before));
      if (outer && outer.token === "function") return "binding-pattern";
    }
    return "object-literal";
  }

  if (BRACE_OPENS_OBJECT_AFTER.has(ch)) return "object-literal";

  const token = identifierEndingAt(code, i);
  if (token) {
    if (token.token === "return") return "object-literal";
    if (token.token === "const" || token.token === "let" || token.token === "var") {
      return "binding-pattern";
    }
  }

  return "unknown";
}

/**
 * Find every object-shorthand group in ONE code segment (a segment as produced
 * by `rewriteCodeSegments` — i.e. already free of strings, regex literals and
 * comments), classified by `classifyBraceGroup`.
 *
 * Returned regions are non-overlapping and in source order.
 */
export function findObjectShorthandRegions(code: string): ObjectShorthandRegion[] {
  const out: ObjectShorthandRegion[] = [];
  if (!code || code.indexOf("{") === -1) return out;
  SHORTHAND_GROUP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SHORTHAND_GROUP_RE.exec(code)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const names = m[0].slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => NOT_A_PROPERTY_NAME.has(n))) continue; // a block, not an object
    out.push({ start, end, kind: classifyBraceGroup(code, start, end), names });
  }
  return out;
}

/**
 * Split `expr` into code regions and opaque non-code regions (string / regex
 * literal / line-comment / block-comment). `transform` is applied ONLY to code
 * regions; non-code regions are emitted verbatim. Regex-vs-division is
 * disambiguated by regexAllowedAfter.
 *
 * Template literals (backtick strings) are a hybrid: their static text spans are
 * opaque string content (NEVER transformed), but their `${...}` interpolations
 * are CODE and ARE descended into and transformed. This matters for the
 * whole-buffer fn-name mangle (emit-client.ts) and the keyword-lowering passes:
 * a user fn called inside a `class="x-${fn()}"` attr template literal, or a
 * `not`/`is` operator inside any `${...}`, must be lowered the same as code in
 * raw statement position. (S144 Bug Z fenced rewrites OUT of pure `"..."`/`'...'`
 * string content; the `${...}` interior was never string content — it only
 * looked opaque because backticks shared the plain-string scanner.)
 *
 * This is the single shared fence used by every scrml keyword-lowering text
 * pass (see module header). Callers pass the substitution they want applied
 * only outside literals/comments.
 */
export function rewriteCodeSegments(
  expr: string,
  transform: (codeSegment: string) => string,
): string {
  if (!expr || typeof expr !== "string") return expr;

  const result: string[] = [];
  type Mode =
    | "code"
    | "string"
    | "template"
    | "regex"
    | "line-comment"
    | "block-comment";
  let mode: Mode = "code";
  let stringDelim = "";
  let i = 0;
  let segStart = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (mode === "code") {
      // Block comment opener
      if (ch === "/" && expr[i + 1] === "*") {
        result.push(transform(expr.slice(segStart, i)));
        mode = "block-comment";
        segStart = i;
        i += 2;
        continue;
      }
      // Line comment opener
      if (ch === "/" && expr[i + 1] === "/") {
        result.push(transform(expr.slice(segStart, i)));
        mode = "line-comment";
        segStart = i;
        i += 2;
        continue;
      }
      // Regex literal opener — only when the preceding token-context admits it
      if (ch === "/" && regexAllowedAfter(expr.slice(segStart, i))) {
        result.push(transform(expr.slice(segStart, i)));
        mode = "regex";
        segStart = i;
        i++;
        continue;
      }
      // Template-literal opener — hybrid string: static spans opaque, `${...}`
      // interpolations descended into (handled in "template" mode below).
      if (ch === "`") {
        result.push(transform(expr.slice(segStart, i)));
        result.push("`"); // emit the opening backtick verbatim
        mode = "template";
        segStart = i + 1;
        i++;
        continue;
      }
      // String literal opener (single/double quote — fully opaque)
      if (ch === '"' || ch === "'") {
        result.push(transform(expr.slice(segStart, i)));
        mode = "string";
        stringDelim = ch;
        segStart = i;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (mode === "string") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === stringDelim) {
        i++;
        result.push(expr.slice(segStart, i)); // preserve string literal as-is
        segStart = i;
        mode = "code";
        continue;
      }
      i++;
      continue;
    }

    if (mode === "template") {
      // Escaped char (incl. escaped backtick / escaped `${`) — opaque, skip.
      if (ch === "\\") {
        i += 2;
        continue;
      }
      // Interpolation opener `${` — flush the static text span as opaque, then
      // descend into the interpolation interior as CODE (recursively, so nested
      // strings / regex / template literals inside the interpolation are fenced
      // correctly). Brace-depth tracking finds the matching close `}`.
      if (ch === "$" && expr[i + 1] === "{") {
        result.push(expr.slice(segStart, i)); // static template text — opaque
        const interpStart = i + 2;
        let depth = 1;
        let j = interpStart;
        let innerMode: "code" | "string" | "template" | "regex" = "code";
        let innerDelim = "";
        let innerSegStart = interpStart; // start of the current code run (for regexAllowedAfter)
        while (j < expr.length && depth > 0) {
          const c = expr[j];
          if (innerMode === "code") {
            if (c === "\\") { j += 2; continue; }
            if (c === "{") { depth++; j++; continue; }
            if (c === "}") { depth--; j++; if (depth === 0) break; continue; }
            if (c === '"' || c === "'") { innerMode = "string"; innerDelim = c; j++; continue; }
            if (c === "`") { innerMode = "template"; j++; continue; }
            if (c === "/" && expr[j + 1] !== "*" && expr[j + 1] !== "/" &&
                regexAllowedAfter(expr.slice(innerSegStart, j))) {
              innerMode = "regex"; j++; continue;
            }
            // Skip line/block comments inside an interpolation (rare, but keep
            // brace counting honest — a `}` inside a comment must not close).
            if (c === "/" && expr[j + 1] === "/") {
              j += 2;
              while (j < expr.length && expr[j] !== "\n") j++;
              continue;
            }
            if (c === "/" && expr[j + 1] === "*") {
              j += 2;
              while (j < expr.length && !(expr[j] === "*" && expr[j + 1] === "/")) j++;
              j += 2;
              innerSegStart = j;
              continue;
            }
            j++;
            continue;
          }
          if (innerMode === "string") {
            if (c === "\\") { j += 2; continue; }
            if (c === innerDelim) { innerMode = "code"; j++; innerSegStart = j; continue; }
            j++;
            continue;
          }
          if (innerMode === "template") {
            if (c === "\\") { j += 2; continue; }
            if (c === "`") { innerMode = "code"; j++; innerSegStart = j; continue; }
            // Nested template interpolation — track its braces so the outer
            // depth counter is not corrupted by `}` inside the nested string.
            if (c === "$" && expr[j + 1] === "{") {
              let nd = 1;
              j += 2;
              while (j < expr.length && nd > 0) {
                if (expr[j] === "\\") { j += 2; continue; }
                if (expr[j] === "{") nd++;
                else if (expr[j] === "}") nd--;
                j++;
              }
              continue;
            }
            j++;
            continue;
          }
          // innerMode === "regex"
          if (c === "\\") { j += 2; continue; }
          if (c === "[") {
            j++;
            while (j < expr.length) {
              if (expr[j] === "\\") { j += 2; continue; }
              if (expr[j] === "]") { j++; break; }
              j++;
            }
            continue;
          }
          if (c === "/") {
            j++;
            while (j < expr.length && /[A-Za-z0-9_$]/.test(expr[j])) j++;
            innerMode = "code";
            innerSegStart = j;
            continue;
          }
          if (c === "\n") { innerMode = "code"; innerSegStart = j; continue; }
          j++;
          continue;
        }
        // j now points just past the matching `}` (or end-of-string if
        // unterminated). The interpolation interior is [interpStart, interpEnd).
        const interpEnd = depth === 0 ? j - 1 : j;
        const interior = expr.slice(interpStart, interpEnd);
        // Recurse so nested literals/comments inside the interior are fenced.
        result.push("${");
        result.push(rewriteCodeSegments(interior, transform));
        if (depth === 0) result.push("}");
        i = j;
        segStart = i;
        continue;
      }
      // Closing backtick — flush the trailing static text, emit the backtick.
      if (ch === "`") {
        result.push(expr.slice(segStart, i)); // static template text — opaque
        result.push("`");
        i++;
        segStart = i;
        mode = "code";
        continue;
      }
      i++;
      continue;
    }

    if (mode === "regex") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "[") {
        // Enter char-class — consume until unescaped `]`. `/` is literal inside.
        i++;
        while (i < expr.length) {
          if (expr[i] === "\\") { i += 2; continue; }
          if (expr[i] === "]") { i++; break; }
          i++;
        }
        continue;
      }
      if (ch === "/") {
        // Closing slash — consume IdentifierPart-shaped flags
        i++;
        while (i < expr.length && /[A-Za-z0-9_$]/.test(expr[i])) i++;
        result.push(expr.slice(segStart, i)); // preserve regex literal as-is
        segStart = i;
        mode = "code";
        continue;
      }
      if (ch === "\n") {
        // Unterminated regex — JS doesn't allow LF in regex bodies. Bail
        // back to code mode; what we accumulated may not parse downstream
        // but the masking layer doesn't try to be smarter than Acorn.
        mode = "code";
        continue;
      }
      i++;
      continue;
    }

    if (mode === "line-comment") {
      if (ch === "\n") {
        result.push(expr.slice(segStart, i)); // preserve comment text, newline stays in segStart slice
        segStart = i;
        mode = "code";
        continue;
      }
      i++;
      continue;
    }

    if (mode === "block-comment") {
      if (ch === "*" && expr[i + 1] === "/") {
        i += 2;
        result.push(expr.slice(segStart, i)); // preserve comment text
        segStart = i;
        mode = "code";
        continue;
      }
      i++;
      continue;
    }
  }

  // Final segment
  if (mode === "code") {
    result.push(transform(expr.slice(segStart)));
  } else {
    // Unterminated string/regex/comment — preserve as-is. Downstream
    // parsing will surface the syntax error.
    result.push(expr.slice(segStart));
  }

  return result.join("");
}
