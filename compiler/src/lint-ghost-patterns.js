/**
 * @module lint-ghost-patterns
 * Ghost-error lint pre-pass for scrml.
 *
 * Scans a .scrml source string for known React/Vue/Svelte syntax patterns that
 * do not exist in scrml and emits "did you mean?" diagnostics. Runs BEFORE the
 * main compiler pipeline — diagnostics are warnings, not fatal errors. The real
 * compiler always runs regardless of lint findings.
 *
 * Anti-pattern catalog: scrml-support/docs/ghost-error-mitigation-plan.md §Anti-Pattern Catalog
 * Integration: called by api.js:compileScrml() before Stage 2 (BS).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   line: number,
 *   column: number,
 *   ghost: string,
 *   correction: string,
 *   message: string,
 *   severity: 'warning',
 *   code: string,
 * }} LintDiagnostic
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a flat string offset to { line, column } (1-based).
 *
 * @param {string} source
 * @param {number} offset — byte offset into source
 * @returns {{ line: number, column: number }}
 */
function offsetToLineCol(source, offset) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  const column = offset - lastNewline;
  return { line, column };
}

/**
 * Build a lint diagnostic from a regex match.
 *
 * @param {string} source
 * @param {RegExpExecArray} match
 * @param {string} ghost        — short pattern label shown in message
 * @param {string} correction   — correct scrml equivalent
 * @param {string} see          — spec section reference (e.g. "§5")
 * @param {string} code         — lint warning code (W-LINT-NNN)
 * @returns {LintDiagnostic}
 */
function makeDiag(source, match, ghost, correction, see, code) {
  const { line, column } = offsetToLineCol(source, match.index);
  return {
    line,
    column,
    ghost,
    correction,
    message: `Line ${line}: Found '${ghost}' — scrml uses '${correction}'. See ${see}.`,
    severity: "warning",
    code,
  };
}

// ---------------------------------------------------------------------------
// Helpers — context-aware range computation
// ---------------------------------------------------------------------------

/**
 * Returns true if the given offset falls inside any of the provided ranges.
 *
 * @param {number} offset
 * @param {Array<[number, number]>} ranges
 * @returns {boolean}
 */
function inRange(offset, ranges) {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
}

/**
 * Coordinated single-pass scanner that computes BOTH string-literal ranges and
 * comment ranges in one walk. The coordination matters: `//` inside `"..."` is
 * a string char (NOT a line comment), and `"..."` inside a `// ...` line is a
 * comment char (NOT a string opener). Computing the two range sets in
 * isolation produces phantom overlaps.
 *
 * Returns `{ stringRanges, commentRanges }`. Both are arrays of `[start, end)`
 * half-open intervals.
 *
 * Rules:
 *   - `"..."` / `'...'` are strings. `\` escapes the next char inside a string.
 *     A bare `\n` terminates an unclosed string (matches `buildStringRanges`'
 *     prior semantics).
 *   - `// ... \n` is a line comment.
 *   - `/* ... * /` (slash-star ... star-slash) is a block comment.
 *   - Strings opened inside comments do NOT open a string range.
 *   - Comments opened inside strings do NOT open a comment range.
 *
 * S121 Wave 11 Unit T fix:
 *   Pre-fix, `buildStringRanges` + `buildCommentRanges` ran independently and
 *   could produce phantom ranges. This coordinated pass is the load-bearing
 *   primitive for the brace-counter context-awareness — the brace counters
 *   use `skipRanges = stringRanges ∪ commentRanges` to decide whether a `{`
 *   or `}` is a structural brace or a literal character inside a string /
 *   comment.
 *
 * @param {string} source
 * @returns {{ stringRanges: Array<[number, number]>, commentRanges: Array<[number, number]> }}
 */
function buildSkipRanges(source) {
  const stringRanges = [];
  const commentRanges = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const c2 = source[i + 1];

    // HTML/markup comment — `<!-- ... -->`
    // SPEC §4.7 (S87/S88 amendment): the BS layer treats `<!-- -->` spans as
    // opaque raw content; this pre-BS lint pass must do the same so adopters
    // can document anti-patterns (e.g. friction-report `<!-- React uses === for
    // strict equality -->`) without W-LINT-* false fires (R24 Bug 30).
    //
    // Per HTML 5 §13.1.6 (and our `parseHtmlComment` infrastructure), comments
    // do NOT nest — the FIRST `-->` closes the comment regardless of any inner
    // `<!--`. Unterminated comments run to end-of-source. The whole `<!--...-->`
    // span is added to `commentRanges` so every existing `inRange(offset,
    // commentRanges)` skipIf in the PATTERNS table gains HTML-comment awareness.
    if (c === "<" && c2 === "!" && source[i + 2] === "-" && source[i + 3] === "-") {
      const start = i;
      i += 4;
      while (i < source.length - 2 && !(source[i] === "-" && source[i + 1] === "-" && source[i + 2] === ">")) i++;
      // Consume the closing `-->` (or run to end-of-source for unterminated)
      i = Math.min(i + 3, source.length);
      commentRanges.push([start, i]);
      continue;
    }

    // Line comment — `// ... \n`
    if (c === "/" && c2 === "/") {
      const start = i;
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      // Half-open: end is the offset of the `\n` (excluded), or source.length
      commentRanges.push([start, i]);
      continue;
    }

    // Block comment — `/* ... */`
    if (c === "/" && c2 === "*") {
      const start = i;
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      // Consume the closing `*/` (or run to end-of-source for unterminated)
      i = Math.min(i + 2, source.length);
      commentRanges.push([start, i]);
      continue;
    }

    // String literal — `"..."` or `'...'`
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      while (i < source.length && source[i] !== quote) {
        // `\` escapes the next char (including `\"`, `\\`, `\n` in raw form)
        if (source[i] === "\\" && i + 1 < source.length) {
          i += 2;
          continue;
        }
        // Unterminated string — bail at end-of-line (matches prior semantics)
        if (source[i] === "\n") break;
        i++;
      }
      // Consume closing quote if present
      if (i < source.length && source[i] === quote) i++;
      stringRanges.push([start, i]);
      continue;
    }

    i++;
  }
  return { stringRanges, commentRanges };
}

/**
 * Build a sorted list of merged `[start, end)` skip-intervals — strings and
 * comments combined. Used by the brace-matched range builders below to
 * decide whether a `{` or `}` is structural or a literal char inside a
 * string / comment.
 *
 * @param {{ stringRanges: Array<[number, number]>, commentRanges: Array<[number, number]> }} skip
 * @returns {Array<[number, number]>}
 */
function mergeSkipRanges({ stringRanges, commentRanges }) {
  const all = [...stringRanges, ...commentRanges].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([r[0], r[1]]);
    }
  }
  return merged;
}

/**
 * Returns the next offset >= `i` that is OUTSIDE any skip-range. If `i` is
 * inside a skip-range, returns the range's `end` offset (the first offset
 * after the range). Otherwise returns `i` unchanged.
 *
 * `skipMerged` MUST be sorted by start offset (use `mergeSkipRanges`).
 *
 * @param {number} i
 * @param {Array<[number, number]>} skipMerged
 * @returns {number}
 */
function skipPastRanges(i, skipMerged) {
  // Linear scan is fine — skip-range counts are small relative to char-by-char
  // scans, and the brace counters call this once per `{` / `}`.
  for (const [start, end] of skipMerged) {
    if (i < start) return i;
    if (i < end) return end;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Brace-matched range builders — all context-aware via skipMerged
// ---------------------------------------------------------------------------

/**
 * Walk source from `start` (just past a `prefix{` opener) collecting the
 * closing `}` at depth 0, skipping any `{` / `}` chars that fall inside a
 * string or comment range.
 *
 * Returns the offset JUST PAST the matching closer (or source.length when
 * the source is unterminated — matches the naive builder's behavior).
 *
 * @param {string} source
 * @param {number} start — offset AFTER the opening brace
 * @param {Array<[number, number]>} skipMerged — sorted merged skip ranges
 * @returns {number}
 */
function findMatchingClose(source, start, skipMerged) {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    // If `i` is inside a skip range, leap past it
    const skipped = skipPastRanges(i, skipMerged);
    if (skipped !== i) {
      i = skipped;
      if (i >= source.length) break;
      continue;
    }
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return i;
}

/**
 * Build an array of [start, end) ranges that correspond to `${...}` logic
 * blocks in the source. Matches are brace-balanced. Content inside these
 * ranges should not trigger ghost-pattern detection (the user is writing JS
 * expression syntax inside a legitimate scrml logic interpolation).
 *
 * The scanner skips strings + comments so brace-literals inside `"{"` or
 * `// {` don't confuse the depth counter (S121 Wave 11 Unit T fix —
 * pre-fix, naive counting closed `${...}` blocks too early when string-
 * embedded braces unbalanced the depth count).
 *
 * @param {string} source
 * @param {Array<[number, number]>} skipMerged
 * @returns {Array<[number, number]>}
 */
function buildLogicRanges(source, skipMerged) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    // Don't open a logic range from inside a string / comment — phantom
    // `${...}` text in a doc-comment is not a real logic block.
    const skipped = skipPastRanges(i, skipMerged);
    if (skipped !== i) { i = skipped; continue; }
    if (source[i] === "$" && source[i + 1] === "{") {
      const start = i;
      const end = findMatchingClose(source, i + 2, skipMerged);
      ranges.push([start, end]);
      i = end;
      continue;
    }
    i++;
  }
  return ranges;
}

/**
 * Build ranges for `#{...}` CSS context blocks (brace-balanced + context-
 * aware). Used to detect Svelte-style `${}` interpolations inside CSS values.
 *
 * S121 Wave 11 Unit T fix — pre-fix, `#{` text inside a `// ... #{` comment
 * opened a phantom CSS range that swallowed downstream `${...}` blocks,
 * misfiring W-LINT-010 14 times across the native-parser .scrml mirrors.
 *
 * @param {string} source
 * @param {Array<[number, number]>} skipMerged
 * @returns {Array<[number, number]>}
 */
function buildCssRanges(source, skipMerged) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    const skipped = skipPastRanges(i, skipMerged);
    if (skipped !== i) { i = skipped; continue; }
    if (source[i] === "#" && source[i + 1] === "{") {
      const start = i;
      const end = findMatchingClose(source, i + 2, skipMerged);
      ranges.push([start, end]);
      i = end;
      continue;
    }
    i++;
  }
  return ranges;
}

/**
 * Build ranges for `~{...}` test-sigil blocks (brace-balanced + context-
 * aware).
 *
 * Per SPEC §32, `~{}` is the inline-test sigil. Its body contains scrml code
 * (test declarations, assertions, reactive reads/writes) that should not
 * trigger ghost-pattern detection — `@count = 0` inside a test body is a
 * legitimate reactive assignment, not a Vue-style attribute shorthand.
 *
 * @param {string} source
 * @param {Array<[number, number]>} skipMerged
 * @returns {Array<[number, number]>}
 */
function buildTildeRanges(source, skipMerged) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    const skipped = skipPastRanges(i, skipMerged);
    if (skipped !== i) { i = skipped; continue; }
    if (source[i] === "~" && source[i + 1] === "{") {
      const start = i;
      const end = findMatchingClose(source, i + 2, skipMerged);
      ranges.push([start, end]);
      i = end;
      continue;
    }
    i++;
  }
  return ranges;
}

/**
 * Collect ranges that correspond to `function NAME(...) { ... }` and
 * `fn NAME(...) -> T { ... }` bodies at file scope (v0.3 logic-default
 * mode). Inside these bodies, lint patterns that target attribute-position
 * shapes should not fire — `@cell = .Variant` reactive writes look
 * superficially like Vue `@click=` shorthand but are valid scrml.
 *
 * S96 Bug 9 fix; S121 Wave 11 Unit T context-aware refactor.
 *
 * @param {string} source
 * @param {Array<[number, number]>} skipMerged
 * @returns {Array<[number, number]>}
 */
function buildFunctionBodyRanges(source, skipMerged) {
  const ranges = [];
  // Match `function NAME(...)` or `fn NAME(...) -> T` followed by `{`.
  // The return-type clause is optional (functions don't have it; `fn` does).
  const re = /\b(?:function|fn)\s+\w+\s*\([^)]*\)\s*(?:->[^{]*)?\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    // Skip matches that fall inside a string / comment — `// fn foo() {` in
    // a comment is documentation, not a function declaration.
    if (inRange(start, skipMerged)) continue;
    const afterOpen = m.index + m[0].length; // position after the opening `{`
    const end = findMatchingClose(source, afterOpen, skipMerged);
    ranges.push([start, end]);
  }
  return ranges;
}

/**
 * Build ranges that correspond to markup-element OPENING TAGS — the region
 * spanning from `<TagName` through the closing `>` (or `/>`). These ranges
 * are the ONLY place where `@click=`, `:class=`, `v-if=`, and friends are
 * meaningful attribute shorthand syntax in other frameworks.
 *
 * W14 Unit AA fix (W-LINT-013): pre-fix, the Vue `@event=` lint scanned
 * raw source via `/\s@[a-z]\w*\s*=(?!=)/g` and skipped only `${}`, `~{}`,
 * comments, and `function/fn` bodies. But scrml v0.3 logic-default mode
 * (SPEC §40.8) allows bare `@cell = expr` reactive writes at statement
 * position inside `<program>` / `<page>` bodies — these false-fired as
 * Vue ghosts (119 fires across 15 sample files, e.g. `quiz-app.scrml`,
 * `recipe-book.scrml`). Gating W-LINT-013 to tag-opener ranges only fixes
 * the false-positive class while preserving signal on real `<button
 * @click="...">` adopter mistakes.
 *
 * Opener heuristic: `<` followed by `[A-Za-z]` (tag-name char) — excludes
 * `</closer`, `<!doctype`, and `<x> = 0` state-cell decls (which match
 * `<NAME>` but are themselves closed by `>` before any `@word=` content,
 * so the range is effectively empty for lint purposes). String-attribute
 * values (e.g. `<a href="https://x.com/?q=>foo">`) are honored via
 * `skipPastRanges`, so a `>` inside an attribute string doesn't close the
 * opener prematurely. A nested `<` (malformed markup) closes the current
 * opener at that point.
 *
 * @param {string} source
 * @param {Array<[number, number]>} skipMerged
 * @returns {Array<[number, number]>}
 */
function buildTagOpenerRanges(source, skipMerged) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    // Don't open a tag range from inside a string / comment.
    const skipped = skipPastRanges(i, skipMerged);
    if (skipped !== i) { i = skipped; continue; }
    if (source[i] === "<") {
      const next = source[i + 1];
      // Only count `<Letter...` as a tag opener — skip `</closer`, `<!`,
      // `<?`, and `<` followed by whitespace / operator.
      if (next && /[A-Za-z]/.test(next)) {
        const start = i;
        let j = i + 1;
        while (j < source.length) {
          const sk = skipPastRanges(j, skipMerged);
          if (sk !== j) { j = sk; continue; }
          const ch = source[j];
          if (ch === ">") { j++; break; }
          // Self-closing `/>` ends the opener too.
          if (ch === "/" && source[j + 1] === ">") { j += 2; break; }
          // Nested `<` (malformed) — close opener here, restart at this `<`.
          if (ch === "<") break;
          j++;
        }
        ranges.push([start, j]);
        i = j;
        continue;
      }
    }
    i++;
  }
  return ranges;
}


/**
 * Returns true if the brace at `braceOffset` opens a markup-valued braced
 * attribute — i.e. the first non-whitespace character after the `{` is `<`
 * followed by a tag-name character (letter). This is the canonical scrml
 * "markup-as-value" shape for braced attributes (§1.4 markup-as-first-class-
 * value pillar), most visibly used by `<errorBoundary fallback={<markup/>}>`
 * (SPEC §19.6.2).
 *
 * W-LINT-007's purpose is catching JSX SCALAR braced attributes
 * (`prop={value}`, `prop={expr}`). A braced value whose value-side starts
 * with `<TagName` is markup-as-value, NOT a JSX scalar. R25 Bug 44 closes
 * the false-positive class for this shape — the only currently-canonical
 * SPEC site is `<errorBoundary fallback={<markup/>}>` (7 instances in
 * SPEC.md), but the rule is value-shape-based (not element-/attribute-
 * specific) so future canonical `<Comp slot={<m/>}>` shapes (markup as
 * component prop value) get the exemption for free.
 *
 * Scalar value shapes that MUST still fire: `{value}`, `{fn()}`,
 * `{a + b}`, `{(e) => ...}`, `{!x}`, `{[1,2]}`, `{ {k: v} }`, etc.
 * Whitespace between `{` and `<` is permitted. The opening tag does not
 * need to be closed inside the pattern's offset window — the cheap peek
 * is sufficient to discriminate markup-as-value from scalar.
 *
 * @param {string} source
 * @param {number} braceOffset — offset of the `{` in source
 * @returns {boolean}
 */
function isMarkupValuedBracedAttr(source, braceOffset) {
  // Walk past the `{` and any whitespace.
  let i = braceOffset + 1;
  while (i < source.length && (source[i] === " " || source[i] === "\t" || source[i] === "\n" || source[i] === "\r")) i++;
  // Markup-as-value shape: `<` followed by a tag-name char (letter — covers
  // both lowercase HTML/lifecycle tags `<div` and PascalCase user tags
  // `<Fallback`). `</closer`, `<!doctype`, `<?xml`, etc. do not match — but
  // those aren't valid markup-value shapes anyway.
  if (source[i] !== "<") return false;
  const next = source[i + 1];
  if (!next || !/[A-Za-z]/.test(next)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/**
 * Each pattern:
 *   regex       — RegExp with global flag (exec loop)
 *   ghost       — display label for message
 *   correction  — scrml equivalent
 *   see         — spec section
 *   code        — W-LINT-NNN
 *   skipIf      — optional fn(offset, logicRanges, cssRanges, commentRanges,
 *                 tildeRanges, functionBodyRanges, stringRanges,
 *                 tagOpenerRanges, source, matchEnd) -> bool to skip match. Backwards compatible
 *                 — patterns may use shorter signatures.
 */
const PATTERNS = [
  // Pattern 1: <style> block — unambiguous, no scrml meaning
  //
  // S121 Wave 11 Unit T fix: pre-fix `skipIf: null` fired on `<style>` inside
  // doc-comments + string-literal diagnostic-message text. The native-parser
  // .scrml mirror IS the source of the parser that rejects `<style>`, so
  // every comment / string reference fired falsely (10 fires on
  // parse-markup.scrml alone). Adding comment + string skip closes the
  // mirror-class false positives while preserving signal on real `<style>`
  // openers in adopter code.
  {
    regex: /<style\b/gi,
    ghost: "<style>",
    correction: "#{ css rules }",
    see: "§9",
    code: "W-LINT-001",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges, _tildeRanges, _functionBodyRanges, stringRanges) =>
      inRange(offset, commentRanges) || inRange(offset, stringRanges),
  },

  // Pattern 2: oninput=${...} arrow that assigns to @var — ghost bind pattern
  // Matches: oninput=${  (any)  @var = ...}
  {
    regex: /\boninput\s*=\s*\$\{[^}]*@\w+\s*=/gi,
    ghost: "oninput=${e => @x = e.target.value}",
    correction: "bind:value=@x",
    see: "§5",
    code: "W-LINT-002",
    skipIf: null, // Whole pattern including ${ is the ghost; no false-positive risk
  },

  // Pattern 3: className= — React class attribute
  {
    regex: /\bclassName\s*=/g,
    ghost: "className={expr}",
    correction: 'class:name=@cond or class="name"',
    see: "§5",
    code: "W-LINT-003",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 4: onChange=, onSubmit= (camelCase events)
  // Matches any on[Upper] event name assignment
  {
    regex: /\bon[A-Z]\w*\s*=/g,
    ghost: "onChange={handler}",
    correction: "onchange=handler()",
    see: "§5",
    code: "W-LINT-004",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 5: value={expr} where { is NOT preceded by $ — JSX attribute braces
  // Must match: value={  but NOT value=${
  // Negative lookbehind: not preceded by $
  {
    regex: /\bvalue\s*=\s*(?<!\$)\{/g,
    ghost: "value={@state}",
    correction: "value=@state",
    see: "§5",
    code: "W-LINT-005",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 6: for (item of @items) — JS for-of loop in markup context
  // (only meaningful outside ${} logic blocks)
  {
    regex: /\bfor\s*\(\s*\w+\s+of\s+@/g,
    ghost: "for (item of @items)",
    correction: "for @items / lift item /",
    see: "§10",
    code: "W-LINT-006",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 7: <Comp prop={val}> — JSX attribute braces on component props
  // Matches prop={  but NOT prop=${ and NOT value= (covered by P5)
  // Only trigger when the attribute name is NOT 'value' (P5 covers that)
  // Skip when the match falls inside a `//` or block comment (per SPEC §27).
  //
  // S96 Bug 8 fix:
  //   - `(?<![:\w])` excludes `:struct`/`:enum`/`:union` etc. — the colon-
  //     tagged type-shape in `type Task:struct = { ... }` made `struct = {`
  //     fire as a false positive. `:\w` includes any word-char-preceded
  //     identifier (covers `type:X` shape variants).
  //   - `(?<!type )` excludes the non-tagged form `type X = { ... }`.
  //   - `props\b` added to the exclusion list — canonical component-prop
  //     declaration `props = { name: string }` is intentional scrml shape.
  {
    regex: /(?<!:\w*)(?<!type )\b(?!value\b|props\b)(\w+)\s*=\s*(?<!\$)\{(?!\{)/g,
    ghost: "<Comp prop={val}>",
    correction: "<Comp prop=val>",
    see: "§5",
    code: "W-LINT-007",
    // S121 Wave 11 Unit T fix — add stringRanges to skip
    // `prop={val}`-shaped text inside string literals (diagnostic-message
    // strings discussing the JSX form). The function-body skip ALSO closes
    // the structural false positive at parse-css-body.scrml:359 where
    // `const seen = {}` (an object-literal assignment in v0.3 logic-default
    // mode) was firing — once the brace-counter is context-aware, the
    // outer `${...}` properly covers the function body and logicRanges
    // suppresses the match.
    //
    // R25 Bug 44 fix — exempt markup-valued braced attributes, the canonical
    // scrml shape per §1.4 (markup-as-first-class-value) for passing markup
    // through a braced attribute slot. The only currently-canonical SPEC
    // site is `<errorBoundary fallback={<markup/>}>` (SPEC §19.6.2 — 7
    // instances in SPEC.md), but the rule is value-shape-based (peek the
    // first non-whitespace char after `{` for `<TagName`), not element- or
    // attribute-specific, so future canonical `<Comp slot={<m/>}>` shapes
    // (markup-as-value as a component prop) get the exemption for free.
    // Scalar braced values like `{value}`, `{fn()}`, `{(e) => ...}` STILL
    // fire — `isMarkupValuedBracedAttr` returns false for any value-side
    // that doesn't start with `<` + tag-name char. The regex's last char
    // is the `{`, so `braceOffset = matchEnd - 1`.
    skipIf: (offset, logicRanges, _cssRanges, commentRanges, _tildeRanges, functionBodyRanges, stringRanges, _tagOpenerRanges, source, matchEnd) =>
      inRange(offset, logicRanges) ||
      inRange(offset, commentRanges) ||
      inRange(offset, stringRanges) ||
      inRange(offset, functionBodyRanges || []) ||
      (source !== undefined && matchEnd !== undefined && isMarkupValuedBracedAttr(source, matchEnd - 1)),
  },

  // Pattern 8: {cond && <El>} — React conditional rendering
  // Only trigger outside ${} logic blocks (inside logic it's valid JS)
  {
    regex: /\{[^}]+&&\s*</g,
    ghost: "{cond && <El>}",
    correction: "<El if=@cond>",
    see: "§17",
    code: "W-LINT-008",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 9: onClick=, onDblClick= etc. (camelCase click events)
  // Note: onC... catches onClick, onClose etc. — but camelCase is the signal.
  // Covered generically by W-LINT-004 (on[Upper]) but kept explicit for clarity
  // Deduplicated: W-LINT-004 already matches onClick. This entry is intentionally
  // omitted — W-LINT-004 (on[A-Z]) covers all camelCase events including onClick.
  // Keeping the slot here as a comment so the pattern numbering matches the plan.
  // (No separate entry for W-LINT-009 — W-LINT-004 subsumes it.)

  // Pattern 10: ${} interpolation INSIDE #{} CSS context — Svelte pattern
  // Matches: #{ ... ${ ... } ... } — the ${ inside CSS is the ghost
  //
  // S121 Wave 11 Unit T fix: pre-fix, `buildCssRanges` was a naive `#{`
  // brace-counter that didn't skip strings / comments. A `#{` inside a
  // doc-comment opened a phantom CSS range that swallowed dozens of real
  // `${...}` blocks downstream — 14 false fires on parse-markup.scrml's
  // comment-class .scrml mirror. The cssRanges builder is now context-aware
  // (skips strings + comments via skipMerged); the skipIf below adds
  // defense-in-depth by also skipping matches that fall inside a comment or
  // string literal directly.
  {
    regex: /\$\{/g,
    ghost: "${} in CSS context",
    correction: "@var directly in #{}",
    see: "§9",
    code: "W-LINT-010",
    skipIf: (offset, _logicRanges, cssRanges, commentRanges, _tildeRanges, _functionBodyRanges, stringRanges) => {
      // Skip — not in CSS context (the lint's whole purpose is CSS-embedded
      // `${...}` detection).
      if (!inRange(offset, cssRanges)) return true;
      // Defense-in-depth — even if a real `#{...}` CSS block contains a
      // `${...}` inside a string/comment, the match is documentation, not a
      // ghost.
      if (inRange(offset, commentRanges)) return true;
      if (inRange(offset, stringRanges)) return true;
      return false;
    },
  },

  // Pattern 11: Vue `:attr=` colon-prefixed attribute binding
  // Matches: whitespace + `:ident=` where no ident precedes the colon
  // (distinguishes from scrml's `class:name=@cond` which has `class` before `:`)
  //
  // S121 Wave 11 Unit T fix — pre-fix the skipIf only checked logicRanges,
  // so `:attr=` text inside doc-comments and string-literal demonstrations
  // of Vue syntax (parse-stmt.scrml mirror class) fired falsely.
  //
  // S138 Bug 33 fix — exclude scrml-reserved `:let=` (canonical §16.6
  // parametric-snippet slot-binding form per SPEC §41.16.3 `<column>`
  // slot grammar). `:let={(row) => ...}` is NOT Vue-style; it's scrml's
  // explicit row-binding mechanism for column slot bodies (per the
  // OQ-TF-11 MEDIUM verdict, S105). The negative-lookahead `(?!let\b)`
  // narrows the pattern to genuine Vue-shape `:attr=` while leaving
  // scrml's reserved `:let=` alone. Other scrml `:`-prefixed slot
  // shapes (none currently — `:let=` is the only canonical reserved
  // shape) can be added to the negative-lookahead group as they
  // ratify.
  {
    regex: /\s:(?!let\b)[a-z][a-zA-Z0-9-]*\s*=/g,
    ghost: ":attr=\"expr\"",
    correction: "attr=@var (or attr=\"literal\")",
    see: "§5",
    code: "W-LINT-011",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges, _tildeRanges, _functionBodyRanges, stringRanges) =>
      inRange(offset, logicRanges) ||
      inRange(offset, commentRanges) ||
      inRange(offset, stringRanges),
  },

  // Pattern 12: Vue directives `v-if=`, `v-for=`, `v-model=`, `v-show=`,
  // `v-else`, `v-else-if=`, `v-on:event=`, `v-bind:attr=`, `v-html=`, `v-text=`,
  // `v-slot`, `v-cloak`, `v-once`, `v-pre`.
  {
    regex: /\bv-(?:if|else-if|else|for|model|show|on|bind|html|text|slot|cloak|once|pre)\b(?::[a-zA-Z]+)?\s*(?==|>|\s)/g,
    ghost: "v-if / v-for / v-model / @click / :class",
    correction: "scrml uses if=@cond, for @items, bind:value=@x, onclick=fn(), class:name=@cond",
    see: "§5, §10, §17",
    code: "W-LINT-012",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 13: Vue `@event=` attribute shorthand (e.g., `@click="fn"`,
  // `@click.stop="fn"`). Distinguished from scrml's `@var` reactive sigil by
  // requiring an `=` after the `@word` — scrml uses `@var` as VALUES
  // (`value=@count`), never as attribute NAMES. The trailing `(?!=)` negative
  // lookahead rejects `@var ==` (scrml equality per SPEC §45) so the lint
  // does not misfire on `assert @count == 0` or `if=(@x == 1)` expressions.
  //
  // W14 Unit AA scope-gate (the tagOpenerRanges check at the bottom): Vue's
  // `@click="..."` shorthand is *exclusively* an HTML markup-element attribute
  // shorthand — it only appears between `<TagName` and the closing `>` of an
  // opener. Bare `@var = expr` at statement position in scrml v0.3 logic-
  // default mode (SPEC §6.1.2 + §40.8) is a legitimate reactive write, NOT a
  // Vue ghost. Pre-fix, this lint fired 119 times on real samples (quiz-app,
  // recipe-book, etc.) because the prior guards (logic / comment / tilde /
  // function-body) didn't cover the `<program>` / `<page>` body case. The
  // tag-opener gate is an ADDITIONAL skip — the existing guards stay
  // because `${ @x = expr }` inside an opener (`oninput=${ @v = ev.target }`)
  // is a legitimate reactive write inside a logic interp, not a Vue ghost.
  //
  // S96 Bug 9 fix — also skip function-body ranges. `@dragPhase = .Dragging`
  // inside `function startDrag() { ... }` is a legitimate reactive write,
  // not a Vue ghost. Function bodies in v0.3 logic-default mode live at
  // file scope WITHOUT a wrapping `${...}`, so logicRanges doesn't cover
  // them.
  {
    regex: /\s@[a-z][a-zA-Z0-9]*(?:\.[a-z]+)*\s*=(?!=)/g,
    ghost: "@click=\"handler\" (Vue event shorthand)",
    correction: "onclick=handler() (scrml uses standard on<event> attribute names)",
    see: "§5",
    code: "W-LINT-013",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges, tildeRanges, functionBodyRanges, _stringRanges, tagOpenerRanges) =>
      inRange(offset, logicRanges) ||
      inRange(offset, commentRanges) ||
      inRange(offset, tildeRanges) ||
      inRange(offset, functionBodyRanges || []) ||
      !inRange(offset, tagOpenerRanges || []),
  },

  // Pattern 14: Svelte block directives `{#if ...}`, `{:else}`, `{/if}`,
  // `{#each xs as x}`, `{#await}`, `{#key}`, `{:then}`, `{:catch}`.
  {
    regex: /\{[#:\/]\s*(?:if|else|each|await|then|catch|key)\b/g,
    ghost: "{#if @cond} ... {/if} (Svelte block)",
    correction: "scrml uses <el if=@cond>, for @items / lift ... /, or match + <:arms/>",
    see: "§10, §17",
    code: "W-LINT-014",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 15: Svelte raw-HTML directive `{@html expr}`.
  {
    regex: /\{@html\s/g,
    ghost: "{@html expr} (Svelte raw HTML)",
    correction: "scrml uses ${ rawHtml() } inside markup; no dedicated @html directive",
    see: "§5",
    code: "W-LINT-015",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) => inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 17: React hooks — useState, useEffect, useRef, useMemo, useCallback,
  // useContext, useReducer, useLayoutEffect, useTransition, useDeferredValue,
  // useId, useSyncExternalStore, useInsertionEffect (W-LINT-016, S97).
  //
  // The adopter likely came from React and is reaching for hooks. Each maps
  // to a scrml primitive that's structurally simpler:
  //   useState(init)         → <x> = init  (read @x, write @x = expr)
  //   useEffect(fn, [deps])  → reactive ${ ... } block (deps auto-tracked);
  //                            lifecycle via <onMount>/<onCleanup> tags (§6.7)
  //   useRef(init)           → <x> = init  OR  bind:this=@el for DOM refs
  //   useMemo(() => e, deps) → const <x> = e  (derived cell, deps auto-tracked)
  //   useCallback(fn, deps)  → just declare fn; no re-render model, no memo needed
  //   useContext(Ctx)        → component prop-passing or stdlib equivalents
  //   useReducer(red, init)  → <engine for=Type initial=.X> with rule= contracts
  //
  // Pattern matches `useFoo(` — the call form. Bare references without `(`
  // can't act as hooks anyway. Skip in comments to avoid false positives in
  // explanatory text.
  {
    regex: /\b(useState|useEffect|useRef|useMemo|useCallback|useContext|useReducer|useLayoutEffect|useTransition|useDeferredValue|useId|useSyncExternalStore|useInsertionEffect)\s*\(/g,
    ghost: "useState() / useEffect() / useRef() etc. (React hook call)",
    correction: "scrml has no React hooks (no virtual DOM, no re-render model). State: `<x> = init` (read `@x`, write `@x = expr`). Effects: reactive `${...}` blocks auto-track deps; lifecycle via `<onMount>` / `<onCleanup>`. Memo: `const <x> = expr`. Reducer: `<engine for=Type>` with `rule=` contracts. See SPEC §6 (state), §6.7 (lifecycle), §51 (engines).",
    see: "§6, §6.7, §51",
    code: "W-LINT-016",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 18: Vue composition-API calls (W-LINT-017, S97).
  //
  // Detects the most common reactivity / effect / lifecycle / composition
  // entry points: `ref`, `reactive`, `computed`, `readonly`, `shallowRef`,
  // `shallowReactive`, `toRef`, `toRefs`, `unref`, `watch`, `watchEffect`,
  // `watchPostEffect`, `watchSyncEffect`, `onMounted`, `onUpdated`,
  // `onUnmounted`, `onBeforeMount`, `onBeforeUpdate`, `onBeforeUnmount`,
  // `onErrorCaptured`, `provide`, `inject`, `defineComponent`, `defineProps`,
  // `defineEmits`, `defineExpose`.
  //
  // Skips: `useId` is omitted (also a React 19 hook; covered by W-LINT-016).
  // `onMount`-without-the-`ed`-suffix is NOT included — too risky given
  // scrml may grow its own lifecycle vocabulary using similar names.
  //
  // Match form is `\bword\s*\(` — the call. Skip in comments.
  {
    regex: /\b(ref|reactive|computed|readonly|shallowRef|shallowReactive|toRef|toRefs|unref|watch|watchEffect|watchPostEffect|watchSyncEffect|onMounted|onUpdated|onUnmounted|onBeforeMount|onBeforeUpdate|onBeforeUnmount|onErrorCaptured|provide|inject|defineComponent|defineProps|defineEmits|defineExpose)\s*\(/g,
    ghost: "ref() / reactive() / computed() / watch() / onMounted() etc. (Vue composition API)",
    correction: "scrml has no Vue composition API. State: `<x> = init` (read `@x`, write `@x = expr`). Computed: `const <x> = expr` (derived cell, deps auto-tracked). Watch / effect: reactive `${...}` blocks fire on dep change. Lifecycle: `<onMount>` / `<onCleanup>` (§6.7). Props: component `props={...}` block (§15.10). See SPEC §6 (state), §6.7 (lifecycle), §15 (components).",
    see: "§6, §6.7, §15",
    code: "W-LINT-017",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 19: Svelte store API calls (W-LINT-018, S97).
  //
  // Detects `writable`, `readable`, `derived` (from `svelte/store`), and
  // `tick`, `setContext`, `getContext`, `hasContext`, `createEventDispatcher`,
  // `beforeUpdate`, `afterUpdate` (lifecycle / context helpers from `svelte`).
  //
  // Skips: bare `derived` would collide with scrml's `derived=expr` engine
  // attribute (§51.0.J L20). The pattern requires `derived\s*\(` (call form)
  // to disambiguate — engine attribute is `derived=` not `derived(`.
  //
  // Also skips: `onMount` / `onDestroy` — too risky given scrml may grow its
  // own lifecycle vocabulary using similar names. `$store` auto-subscribe is
  // ALSO NOT detected here — distinguishing legitimate `$identifier` (rare
  // but possible) from Svelte auto-subscribe needs more context than this
  // pass has.
  {
    regex: /\b(writable|readable|derived|tick|setContext|getContext|hasContext|createEventDispatcher|beforeUpdate|afterUpdate)\s*\(/g,
    ghost: "writable() / readable() / derived() etc. (Svelte store / lifecycle helper)",
    correction: "scrml has no Svelte stores. State: `<x> = init` is automatically reactive (no store wrapper needed). Cross-component sharing: declare at `<program>` scope. Derived: `const <x> = expr` (auto-tracks deps). Effects: reactive `${...}` blocks. Lifecycle: `<onMount>` / `<onCleanup>` (§6.7). Context: component props + state passing. Events: `${dispatch(...)}` or direct handler call. See SPEC §6 (state), §6.7 (lifecycle), §15 (components).",
    see: "§6, §6.7, §15",
    code: "W-LINT-018",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 20: Solid reactivity / effect calls (W-LINT-019, S97).
  //
  // Detects: `createSignal`, `createEffect`, `createMemo`, `createStore`,
  // `createResource`, `createComputed`, `createDeferred`, `createSelector`,
  // `createReaction`, `createMutable`, `createRoot`, `createContext`,
  // `mergeProps`, `splitProps`, `untrack`, `batch`.
  //
  // Skips: `For`, `Show`, `Switch`, `Match`, `Index` — these are Solid
  // CONTROL-FLOW COMPONENTS used as markup tags. Detecting them needs the
  // markup-tag context (which this pre-Stage-2 lint doesn't have); also
  // PascalCase-bare-component-tags fire E-COMPONENT-020 if they're not
  // declared. Adopter feedback already exists via that path.
  //
  // `useContext` from `solid-js` collides with `useContext` from React
  // (covered by W-LINT-016 already — same lint message; one diagnostic
  // per call site is fine).
  {
    regex: /\b(createSignal|createEffect|createMemo|createStore|createResource|createComputed|createDeferred|createSelector|createReaction|createMutable|createRoot|createContext|mergeProps|splitProps|untrack|batch)\s*\(/g,
    ghost: "createSignal() / createEffect() / createMemo() / createStore() etc. (Solid primitive)",
    correction: "scrml has no Solid primitives. State: `<x> = init` (Solid signal). Effects: reactive `${...}` blocks (Solid createEffect). Memo: `const <x> = expr` (Solid createMemo). Store: nested compound state `<obj><field> = init</>` (§6.3 Variant C). Resource: a server-side function `${ function fetch() { ... } }` (the server boundary is inferred per §12.2) + RemoteData enum (§13.5). Lifecycle: `<onMount>` / `<onCleanup>` (§6.7). Untrack / batch are no-ops in scrml — the compiler manages reactivity granularity. See SPEC §6, §6.3, §6.7, §13.5.",
    see: "§6, §6.3, §6.7, §13.5",
    code: "W-LINT-019",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 21: Vue double-brace interpolation `{{ expr }}` (W-LINT-020, S97).
  //
  // Vue uses `{{ user.name }}` in markup; scrml uses `${ @user.name }`.
  // The `${` form is the canonical scrml markup-interpolation slot per
  // §5 / §7.4. Adopter coming from Vue reflexively writes `{{ ... }}`;
  // scrml silently emits the literal text `{{ user.name }}` into HTML
  // (it's not recognized as an interpolation), so the bug is silent at
  // compile time and visible only at runtime.
  //
  // Skip inside `${...}` logic blocks (where `{{` might be the start of
  // a JS object-in-object literal — rare but valid), comments, and CSS.
  {
    regex: /\{\{[^}]*\}\}/g,
    ghost: "{{ expr }} (Vue double-brace interpolation)",
    correction: "scrml uses `${ expr }` for markup interpolation (§5, §7.4). Replace `{{ user.name }}` with `${@user.name}` (reactive read) or `${user.name}` (plain ident in scope).",
    see: "§5, §7.4",
    code: "W-LINT-020",
    skipIf: (offset, logicRanges, cssRanges, commentRanges) =>
      inRange(offset, logicRanges) || inRange(offset, cssRanges) || inRange(offset, commentRanges),
  },

  // Pattern 22: Angular structural directive `*ngIf`, `*ngFor`, etc.
  // (W-LINT-021 — Angular family lint, shared code across the 3 sub-patterns).
  //
  // Match shape: whitespace + `*ng` + UppercaseWord + optional `=`.
  // Common Angular structural directives: *ngIf, *ngFor, *ngSwitch,
  // *ngSwitchCase, *ngSwitchDefault, *ngTemplateOutlet, *ngContent.
  {
    regex: /(?:^|\s)\*ng[A-Z]\w*\s*=/g,
    ghost: "*ngIf= / *ngFor= / *ngSwitch= (Angular structural directive)",
    correction: "scrml uses native markup conditionals: `if=@cond` / `else-if=@cond` / `else` for selection (§17); `for @items / lift item /` for iteration (§10); `<match for=Type on=@x>` for switch-on-discriminant (§18). No `*ng` prefix.",
    see: "§10, §17, §18",
    code: "W-LINT-021",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) =>
      inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 23: Angular `(event)=` event binding (W-LINT-021 — same code).
  //
  // Match shape: `(word)=` where word is an event name like `click`,
  // `submit`, `change`. Distinct from scrml's `class:active=(expr)` —
  // the parens here are BEFORE `=` (as part of the attribute NAME),
  // not after `=` (as the value).
  {
    regex: /(?:^|\s)\([a-z][a-zA-Z]*\)\s*=/g,
    ghost: "(click)= / (submit)= (Angular event binding)",
    correction: "scrml uses bare event-handler attributes: `onclick=fn()`, `onsubmit=fn()`, etc. No parens around the event name. Per SPEC §5.2.2 the bare-call auto-wraps as `function(event){ fn(); }`.",
    see: "§5.2",
    code: "W-LINT-021",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) =>
      inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 24: Angular `[(ngModel)]=` two-way binding + `[prop]=` property
  // binding (W-LINT-021 — same code).
  //
  // Match shape: `[name]=` or `[(name)]=`. Covers `[(ngModel)]="x"`,
  // `[class.active]="isActive"`, `[disabled]="x"`, `[style.color]="c"`.
  {
    regex: /(?:^|\s)\[\(?[a-zA-Z][\w.-]*\)?\]\s*=/g,
    ghost: "[(ngModel)]= / [class.X]= / [prop]= (Angular property/two-way binding)",
    correction: "scrml uses `bind:value=@x` for two-way binding (§5.4); `class:name=@cond` for class binding (§5.5.2); `prop=@var` for one-way property binding. No square-bracket prefix.",
    see: "§5.4, §5.5.2",
    code: "W-LINT-021",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges) =>
      inRange(offset, logicRanges) || inRange(offset, commentRanges),
  },

  // Pattern 25: TypeScript `interface Foo { ... }` declaration (W-LINT-022, S97).
  //
  // scrml's type vocabulary is `type Name:struct = { ... }` /
  // `type Name:enum = { ... }` / `type Name:union = ...` — colon-tagged.
  // The TS `interface` keyword is not in scrml. Adopter writing
  // `interface User { name: string }` will get E-SCOPE-001 on
  // `interface` (the identifier isn't bound) — generic.
  //
  // Match `\binterface\s+[A-Z]\w*` — the keyword + uppercase name; the
  // `{` following is implied (interfaces with method/field bodies all
  // open with `{`). Skip in comments + strings.
  {
    regex: /\binterface\s+[A-Z]\w*\b/g,
    ghost: "interface Foo { ... } (TypeScript)",
    correction: "scrml has no `interface` keyword. Use `type Foo:struct = { name: string }` for record-shaped types (§14.3). For sum/variant types use `type Foo:enum = { A, B(payload: T) }` (§14.4). For unions use `type Foo:union = A | B`. The colon-tagged shape is structural — not nominal — and works across SQL schema / refinement-type predicates.",
    see: "§14.3, §14.4",
    code: "W-LINT-022",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 26: TypeScript untagged `type Name = { ... }` (W-LINT-022 — same code).
  //
  // scrml requires the `:struct` / `:enum` / `:union` tag. Untagged
  // `type X = { ... }` is the TS form and silently passes through to
  // codegen with `E-SCOPE-001` (the bare `{}` object literal becomes
  // an empty object expression).
  //
  // Regex disambiguates from scrml's canonical form: `\btype\s+[A-Z]\w*`
  // captures the keyword + name; `\s*=\s*\{` requires `=` directly
  // (with whitespace) followed by `{`. scrml's `type X:struct = {` has
  // `:struct` between `X` and `=` — the `\w*` (no `:`) won't match across
  // that colon, so canonical scrml types don't trip the lint.
  {
    regex: /\btype\s+[A-Z]\w*\s*=\s*\{/g,
    ghost: "type X = { ... } (TypeScript untagged type alias)",
    correction: "scrml requires a colon tag: `type Foo:struct = { name: string }`. The tag determines structural meaning — `:struct` (record), `:enum` (sum / tagged variant), `:union` (untagged sum). See SPEC §14.3 / §14.4.",
    see: "§14.3, §14.4",
    code: "W-LINT-022",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 27: React Fragment `<>` opener (W-LINT-023, S97).
  //
  // Adopter writes `<><div>a</div><div>b</div></>` expecting a React
  // Fragment (group siblings without a wrapper element). Pre-fix this
  // fired generic `E-CTX-001` — context-mismatch error, no hint that
  // adopter reached for a Fragment. Post-fix W-LINT-023 names the
  // shape + scrml alternatives.
  //
  // Pattern matches the LITERAL two-char sequence `<>` — the Fragment
  // opener. scrml's BARE CLOSER `</>` (open + slash + close) is NOT
  // matched because the `<` and `>` aren't adjacent (the `/` separates
  // them). `<>` with no element name is unambiguous as a React-ism in
  // scrml's vocabulary — markup openers always carry an element name
  // (HTML or scrml-defined).
  //
  // Skip in comments. Don't skip in logic blocks — markup-as-value
  // pillar (L1) means a function might `return <></>` as a Fragment-as-
  // value; that's still a React-ism worth flagging.
  {
    regex: /<>/g,
    ghost: "<>...</> (React Fragment)",
    correction: "scrml has no Fragment shape. To group sibling elements: wrap in a real element (`<div>`, `<span>`, etc.), use `${ ... lift ... }` iteration, or return a single-root markup tree. Components return ONE root element per definition (§15); multi-root components are not supported.",
    see: "§15, §16",
    code: "W-LINT-023",
    skipIf: (offset, _logicRanges, _cssRanges, commentRanges) => inRange(offset, commentRanges),
  },

  // Pattern 28: Svelte `$store` auto-subscribe inside `${...}` markup-interp
  // (W-LINT-024, S98).
  //
  // S97 hand-off recorded this as the only remaining `generic-error` in the
  // brute-force stress harness — every other framework-syntax-in-scrml ghost
  // produced a specific lint, but Svelte's `$store` auto-subscribe fell
  // through to generic-error fallback. This pattern closes that gap.
  //
  // The Svelte shape: `$store` (where `store` is a writable/readable store)
  // inside markup auto-dereferences to the store's current value:
  //   <script>let count = writable(0)</script>
  //   <p>{$count}</p>            <!-- Svelte: reads the store -->
  //
  // The adopter reflexively writes `${ $count }` in scrml expecting the same;
  // scrml has no store-prefix sigil. The canonical scrml shape is `${ @count }`
  // for a reactive cell, or `${ count }` for a plain identifier in scope.
  //
  // Pattern (approach (a) per S97 hand-off): match `$ident` where `ident`
  // starts with a letter or `_`. The regex `\$[a-zA-Z_]\w*` matches `$count`
  // but NOT `${...}` (the `{` is not in the identifier char class) and NOT
  // bare `$` (requires at least one identifier char).
  //
  // Fires ONLY when offset is inside a `${...}` logic-interp block — narrow
  // false-positive surface, catches the load-bearing case (markup-interpolated
  // `$store`). The fire condition is INVERTED from most patterns (which skip
  // INSIDE logic blocks); see Pattern 10 (W-LINT-010) for the same
  // inverted-skip shape.
  //
  // Skip conditions:
  //   - Outside `${...}`: not a Svelte-ghost context (the lint is narrowly
  //     scoped to markup interpolation slots per S97 approach-(a)).
  //   - Inside a string literal: `"$store"` is a literal string, not a
  //     Svelte ghost (uses stringRanges from `buildStringRanges`).
  //   - Inside a comment: documentation about Svelte syntax should not
  //     fire (uses commentRanges).
  //   - Preceded by `\`: escaped sigil (`\$count`) is opt-out.
  //
  // Future extension: approach (b) (`.subscribe(` follow-up) and approach (c)
  // (scope-aware later-stage detection) per S97 hand-off, gated on friction
  // signals. (a) lands first because it has the narrowest false-positive
  // surface and the highest signal-to-noise ratio for the Svelte adopter.
  {
    // Negative lookbehind `(?<!\\)` rejects `\$count` (escaped sigil opts
    // out). Matches `$count`, `$store`, `$_x`, etc. Excludes `${` because
    // `{` is not in the `[a-zA-Z_]` opener class — the `${...}` interpolation
    // opener itself never matches.
    regex: /(?<!\\)\$[a-zA-Z_]\w*/g,
    ghost: "$store (Svelte auto-subscribe prefix)",
    correction: "scrml has no store auto-subscription. For reactive cells, use the canonical `@cell` sigil (per V5-strict §6.1) — e.g. `${@count}` instead of `${$count}`. If you have a Svelte store object explicitly, call its `.subscribe()` method directly; scrml does not auto-dereference. See SPEC §6 (state declarations) and §6.1 (V5-strict access).",
    see: "§6, §6.1",
    code: "W-LINT-024",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges, _tildeRanges, _functionBodyRanges, stringRanges) => {
      // Skip if NOT inside a `${...}` logic-interp block — approach (a)
      // narrowly scopes the lint to markup-interpolation contexts.
      if (!inRange(offset, logicRanges)) return true;
      // Skip if inside a string literal — `"$store"` is literal text.
      if (inRange(offset, stringRanges || [])) return true;
      // Skip if inside a comment — documentation about Svelte syntax.
      if (inRange(offset, commentRanges)) return true;
      return false;
    },
  },

  // Pattern 16: W-LIFECYCLE-CANDIDATE — string-discriminator trap.
  //
  // S64 debate-04 verdict A+ #2 (string-switch trap, gingerbill design insight):
  // detect a state-cell decl `<NAME>[: Type] = "VALUE"` whose RHS is a string
  // literal whose value lexically resembles an enum variant tag — single-word,
  // initial-uppercase, alphanumeric only (e.g. "Loading", "Idle", "Pending").
  // Predicate: ^[A-Z][A-Za-z0-9]*$. Lowercase-initial strings do NOT fire (high
  // false-positive cost — see docs/changes/a-plus-verdict-execution/SURVEY-NOTE.md).
  {
    regex: /<([a-zA-Z_][a-zA-Z0-9_]*)>\s*(?::\s*[A-Za-z_][\w.]*\s*)?=\s*(?:"([A-Z][A-Za-z0-9]*)"|'([A-Z][A-Za-z0-9]*)')/g,
    ghost: "<state> = \"PascalCaseValue\" (string-discriminator trap)",
    correction: "lift to an enum: `type Phase:enum = { Idle, Loading, Error, Success }; <phase>: Phase = .Idle`. Unlocks <match for=Phase> structural exhaustiveness (Tier 1) and <engine for=Phase> transition-validation (Tier 2). See primer §1 (tier ladder); debate-04 string-switch-trap design insight.",
    see: "§6 (W-LIFECYCLE-CANDIDATE)",
    code: "W-LIFECYCLE-CANDIDATE",
    skipIf: (offset, logicRanges, _cssRanges, commentRanges, tildeRanges) =>
      inRange(offset, logicRanges) ||
      inRange(offset, commentRanges) ||
      inRange(offset, tildeRanges),
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lint a scrml source string for known ghost patterns from other frameworks.
 *
 * Each diagnostic describes a pattern that does not exist in scrml and suggests
 * the correct scrml equivalent. Diagnostics are warnings — they do not block
 * compilation.
 *
 * @param {string} source    — raw .scrml file content
 * @param {string} [filePath] — optional file path for future use (not currently used in messages)
 * @returns {LintDiagnostic[]}
 */
export function lintGhostPatterns(source, filePath) {
  if (!source || source.length === 0) return [];

  // Compute string + comment ranges first, in a single coordinated pass so
  // `//` inside a string isn't a phantom comment and `"..."` inside a `//`
  // comment isn't a phantom string. The brace-matched range builders below
  // consume the merged skip-range list to skip braces inside strings /
  // comments (S121 Wave 11 Unit T fix).
  const { stringRanges, commentRanges } = buildSkipRanges(source);
  const skipMerged = mergeSkipRanges({ stringRanges, commentRanges });

  const logicRanges = buildLogicRanges(source, skipMerged);
  const cssRanges = buildCssRanges(source, skipMerged);
  const tildeRanges = buildTildeRanges(source, skipMerged);
  const functionBodyRanges = buildFunctionBodyRanges(source, skipMerged);
  const tagOpenerRanges = buildTagOpenerRanges(source, skipMerged);
  const diagnostics = [];

  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = re.exec(source)) !== null) {
      const offset = match.index;

      // Apply false-positive guard
      if (pattern.skipIf && pattern.skipIf(offset, logicRanges, cssRanges, commentRanges, tildeRanges, functionBodyRanges, stringRanges, tagOpenerRanges, source, offset + match[0].length)) {
        continue;
      }

      diagnostics.push(
        makeDiag(source, match, pattern.ghost, pattern.correction, pattern.see, pattern.code)
      );

      // Prevent infinite loops on zero-width matches
      if (match[0].length === 0) re.lastIndex++;
    }
  }

  // Sort by line, then column for deterministic output
  diagnostics.sort((a, b) => a.line !== b.line ? a.line - b.line : a.column - b.column);

  return diagnostics;
}
