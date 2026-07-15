/**
 * Block Splitter — Stage 2 of the scrml compiler pipeline.
 *
 * Performs a single linear scan over preprocessed source text and partitions
 * it into a typed block tree. No tokenization of block content occurs here.
 *
 * Input:  { filePath: string, source: string }
 * Output: { filePath: string, blocks: Block[], errors: BSError[] }
 *
 * Block = {
 *   type:        'markup' | 'state' | 'logic' | 'sql' | 'css' | 'error-effect' | 'meta' | 'test' | 'comment' | 'text'
 *   raw:         string                          — verbatim source slice (including delimiters)
 *   span:        { start, end, line, col }       — byte offsets in source; line/col are 1-based
 *   depth:       number                          — nesting depth (0 = top-level)
 *   children:    Block[]                         — nested child blocks
 *   name:        string | null                   — tag/state name; null for brace-delimited blocks
 *   closerForm:  'explicit'|'inferred'|'self-closing'|null
 *   isComponent: boolean                         — true when name starts with uppercase (component reference, not HTML element)
 *   openerHadSpaceAfterLt: boolean               — P1 (SPEC §4.3 / §15.15.5): true when the opener used
 *                                                  whitespace between '<' and the identifier (e.g. `< db>`).
 *                                                  Informational only — drives W-WHITESPACE-001 from NR.
 *                                                  Tag/state classification does NOT depend on this in P1.
 * }
 *
 * Note: `<#name>` patterns (worker refs, input state refs) are kept as raw text.
 * Downstream stages handle them via regex: rewriteWorkerRefs (CG), rewriteInputStateRefs (CG),
 * preprocessWorkerAndStateRefs (TAB). No 'reference' block type is emitted.
 *
 * Error codes (collected into errors[] — scanning continues after each error):
 *   E-CTX-001  Wrong closer for current context (mismatched </tag>, `}` in markup context, etc.)
 *   E-CTX-002  Bare `/` or trailing `/` used inside a logic/sql/css/error-effect/meta context
 *   E-CTX-003  Unclosed context at end of file (one error per unclosed frame)
 *   E-STYLE-001 <style> blocks are not supported — use #{} for CSS
 *
 * Rules implemented:
 *   §4.1 / §4.2 / §4.3  HTML-vs-state disambiguation (no-ws = markup; ws = state — P1: classification
 *                        is now informational; NR (Stage 3.05) authoritatively resolves kind/category)
 *   §4.4                 Closer forms (trailing, explicit, inferred/bare)
 *   §4.6 (PA-001)        `<` suppression inside brace-delimited contexts
 *   §4.7 (PA-002)        `//` comment suppression to end of line
 *   §4.8 (PA-004)        Bare `/` only recognized outside braces; markup-text mode
 *                        does NOT track string state per Bug 2 C-narrow S109 (locus
 *                        argument: strings live in Logic context + attr-value scope,
 *                        not in markup-text body — sibling to Bug 4 C-narrow S108)
 *
 * Component vs HTML element convention:
 *   HTML elements use lowercase names (<div>, <input>, <button>).
 *   Component references use uppercase-initial names (<TodoItem>, <UserCard>).
 *   The isComponent flag is set to true for any markup tag whose name starts with
 *   an uppercase ASCII letter. This flag is NOT an error — it propagates downstream
 *   so later stages (TS-D, CG) can treat component references differently from HTML
 *   elements. E-MARKUP-001 (unknown HTML element) MUST be gated by !isComponent.
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

class BSError extends Error {
  constructor(code, message, span) {
    super(`${code}: ${message} (line ${span.line}, col ${span.col})`);
    this.name = "BSError";
    this.code = code;
    this.bsSpan = span;
  }
}

// ---------------------------------------------------------------------------
// HTML void elements — auto-self-closing (no children allowed)
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr",
]);

// ---------------------------------------------------------------------------
// HTML raw-content elements (SPEC §4.17) — scrml tokens inside are text
//
// `<pre>` and `<code>` are code-display contexts; their entire body is a
// single raw text run terminated only by the matching close tag. Inside,
// `${...}` / `<TagName>` / `?{}` / `#{}` / `!{}` / `^{}` / `_{...}` and any
// other scrml-significant token are NOT recognized — they pass through as
// literal text. HTML entity-escaping of `<` / `>` / `&` for display remains
// author responsibility (parallel to plain-HTML rules — browsers don't
// auto-encode inside `<pre>` either).
// ---------------------------------------------------------------------------

const RAW_CONTENT_ELEMENTS = new Set([
  "pre", "code",
]);

// ---------------------------------------------------------------------------
// Structural raw-body elements (S107 Phase 2 — SPEC §18.0.1 match block-form).
//
// Unlike RAW_CONTENT_ELEMENTS above (where the body is author-text for display),
// these are STRUCTURAL containers whose body is scrml code that must be
// re-tokenized by a dedicated downstream parser. BS captures the body as a
// single text run (no per-child markup pushing) — eliminating the
// `:`-shorthand vs bare-body shape-confusion that would otherwise fire
// E-CTX-003 on arm-children like `<Variant> : expr` (where the `<Variant>`
// opener has no closer because `:`-shorthand IS the body terminator).
//
// Currently: `<match>` only. Engine state-children have similar shape (per
// SPEC §51.0.I `:`-shorthand support) but engine uses a different recognition
// path (the `< engine>` whitespace-state-opener form via pushTagContext("state"))
// — Phase 2 doesn't touch that path. Match's recognition is via the regular
// markup-opener path, so this raw-body capture is the cleanest BS-side fix.
//
// Dual-closer support: scrml convention allows `</>` (unambiguous closer)
// in addition to `</tagname>`. The handler below scans for whichever appears
// first. Pre-S107 RAW_CONTENT_ELEMENTS only supports `</tagname>` (HTML
// convention); the match handler diverges.
//
// Downstream consumer: ast-builder.js's `case "markup":` dispatch for
// `block.name === "match"` (Phase 1, S107 commit `82c48fd`) captures the raw
// body via children-concat + raw-slice fallback. With raw-body capture, the
// children array has a single text node whose .raw is the body — armsRaw
// gets populated correctly without going through per-child parsing.
//
// Phase 2's match-statechild-parser.ts (new file) re-tokenizes armsRaw into
// structured MatchArmEntry[] — that's where arm body forms (self-closing /
// bare-body / `:`-shorthand) + payload binding + wildcard arm are recognized.
// ---------------------------------------------------------------------------

const STRUCTURAL_RAW_BODY_ELEMENTS = new Set([
  "match",
  // S130 HU-1 iteration Landing 1 — <each in=|of=> is the Tier-1 structural
  // iteration container; per Q3 RE-RATIFICATION its body admits §4.14
  // `:`-shorthand on per-item element openers (`<li : @.name>`). The opener
  // has no closer because `:`-shorthand IS the body terminator — same
  // shape-confusion the match-block-form fix addressed at S107 Phase 2.
  // Capturing the body raw lets the each-block dispatch in ast-builder.js
  // walk the body without firing E-CTX-003 on opener-without-closer
  // `:`-shorthand children.
  "each",
  // S219 W2 (endpoint-primitive-2026-06-25) — SPEC §61 typed-inbound
  // `<endpoint path= method= accepts=Enum> <Variant…> … </endpoint>`. Its body
  // is `<Variant>` arms (the §18.0.1 `<match>` arm grammar, REUSED), NOT bare
  // lines like `<api>` (§60). The arms use the canonical inside-opener
  // `:`-shorthand (`<Variant(payload) : expr>`) whose opener has no closer —
  // exactly the shape-confusion the `match`/`each` raw-body capture addresses.
  // Capturing the body raw lets the `block.name === "endpoint"` dispatch in
  // ast-builder.js re-tokenize the arms via parseMatchArms without firing
  // E-CTX-003 on the opener-without-closer arms.
  "endpoint",
  // §38.13.3 (realtime-external-db-writes) — `<onchange>` is the `watches=`
  // change-feed handler. Its body is per-variant `<Inserted>`/`<Updated>`/
  // `<Deleted>` arms over the synthesized `RowChange` (§38.13.2), the §18.0.1
  // `<match>` arm grammar REUSED — exactly like `<endpoint>`. Capturing the body
  // raw lets the `block.name === "onchange"` dispatch in ast-builder.js re-
  // tokenize the arms via parseMatchArms without firing E-CTX-003 on the
  // opener-without-closer `:`-shorthand arms.
  "onchange",
  // §65.3.2 / §65.6 (css-wave1-theme-tokens) — `<theme>` is the scrml-native
  // CSS token block. Its body is NOT markup children — it is bare
  // `name = value;` token bindings + `.Variant { … }` re-bind sub-blocks +
  // optional `@media (...) { … }` auto-bind sugar (§65.6). Capturing the body
  // raw lets the `block.name === "theme"` dispatch in ast-builder.js hand the
  // body to a dedicated theme-body parser (parseThemeBody) instead of the
  // markup/state child machinery, which would otherwise choke on the bare
  // `ink = #0f172a;` assignments and the `.Dark { … }` / `@media (…) { … }`
  // brace sub-blocks. Only the BLOCK form (`<theme …> … </theme>` / `</>`) is
  // captured here; the state-decl shape `<theme> = value` is reclaimed (§65.9 —
  // the corpus cells migrate, §65.14).
  "theme",
]);

// ---------------------------------------------------------------------------
// Bug-3 (S101) — Reserved document-root structural tags.
//
// These tags are document/route/channel/schema/module container roots per
// SPEC §4.15 / §38 / §39 / §40.8 / §41. They are never state-decl shapes
// even when their body contains nested state-decls (e.g.
// `<program>\n<formRes>...</></>` — `<program>` is the document root and
// `<formRes>` is the compound state-decl child INSIDE it).
//
// The compound-state-decl auto-lift (`peekCompoundStateDeclSignal`) must
// exclude these names so the parent is not misclassified as a compound.
// ---------------------------------------------------------------------------

const COMPOUND_LIFT_EXEMPT_TAGS = new Set([
  "program", "page", "channel", "schema", "seeds", "module",
  // §20.8.1 (Client Router — navigate-soft-nav Wave-1a) — `<outlet>` is the
  // persistent-shell swap region: the reserved-structural slot into which the
  // current route's content renders. It is a void/empty slot (NOT a raw-body
  // element — it does NOT go in STRUCTURAL_RAW_BODY_ELEMENTS), so it needs no
  // body-mode detection; it is listed here purely as a §4.15 reserved-structural
  // name so the compound-state-decl auto-lift never misclassifies an
  // `<outlet>...</outlet>` block-form as a compound state-decl.
  "outlet",
  // S107 Phase 1 (SPEC §18.0.1 match block-form impl arc).
  // `<match for=Type [on=expr]> <Variant>...</> ... </>` is a Tier 1
  // case-analysis container, not a compound state-decl. Its body looks
  // structurally similar (parent opener + nested `<...>` children + `</>`
  // close) so it was being misclassified by classifyOpenerForCompoundScan
  // and captured as opaque text — the root cause of why match block-form
  // was unparsed end-to-end pre-S107 (see docs/changes/match-block-form-
  // scoping/SCOPING.md §4 "Site 1 — parser"). Exempting `match` here lets
  // BS fall through to the regular markup-opener path, which then produces
  // a `type=markup name=match` block that ast-builder.js dispatches into a
  // structured `match-block` AST node (Phase 1).
  "match",
  // S130 HU-1 iteration Landing 1 — same reasoning as `match` above.
  // `<each in=@cell>...</each>` is a Tier 1 structural-iteration container,
  // not a compound state-decl. Without the exemption the auto-lift heuristic
  // would mis-classify the opener and capture the body as opaque text.
  "each",
  // g-colon-shorthand-markup-misparse (2026-06-18) — same reasoning as `match`
  // / `each` above. `<engine for=Type ...>...</>` (and the `<machine>` legacy
  // spelling) is a Tier 2 state-machine structural container (SPEC §4.15 /
  // §51.0), NOT a compound state-decl. The auto-lift heuristic classified an
  // engine whose state-children use the DEPRECATED after-`>` `:`-shorthand
  // (`<Idle rule=.Done> : <p>…</p>`) as a compound state-decl — because
  // classifyOpenerForCompoundScan reads the `:` after a child opener's `>` as a
  // Shape-2 typed-state-decl signal (line ~1823) — captured the whole engine as
  // opaque text, then EOF-dissolved it into a top-level text run, producing the
  // misleading E-STRUCTURAL-ELEMENT-MISPLACED on `<engine>` (the engine never
  // became a block). Exempting `engine`/`machine` here lets BS fall through to
  // the regular markup-opener path → a `type=markup name=engine` block whose
  // state-children (bare-body, inside-opener `:`-shorthand, and after-`>`
  // `:`-shorthand) are recognized as leaves and concatenated into
  // engine-decl.rulesRaw for the engine-statechild-parser re-parse.
  "engine",
  "machine",
  // S219 W2 (endpoint-primitive-2026-06-25) — same reasoning as `match` above.
  // `<endpoint path= method= accepts=Enum> <Variant…> … </endpoint>` (SPEC §61)
  // is a Tier-1 typed-inbound structural container, NOT a compound state-decl.
  // Its `<Variant>` arm body trips the compound-lift heuristic (the pre-S107
  // `<match>` failure); the exemption lets BS fall through to the regular
  // markup-opener path → a `type=markup name=endpoint` block whose body the
  // STRUCTURAL_RAW_BODY_ELEMENTS gate captures raw for the endpoint dispatch.
  // (`<api>` §60 needed NEITHER set — its body is bare endpoint lines, not
  // nested `<Variant>` openers.)
  "endpoint",
  // §38.13.3 (realtime-external-db-writes) — same reasoning as `endpoint`/`match`
  // above. `<onchange>` is a `watches=` change-feed handler whose `<Variant>` arm
  // body trips the compound-lift heuristic; the exemption lets BS fall through to
  // the regular markup-opener path → a `type=markup name=onchange` block whose
  // body the STRUCTURAL_RAW_BODY_ELEMENTS gate captures raw for the onchange
  // dispatch.
  "onchange",
  // §65.3.2 / §65.6 (css-wave1-theme-tokens) — same reasoning as `onchange`
  // above. `<theme for=@mode> ink = #0f172a; … .Dark { … } </theme>` is a
  // scrml-native CSS token container, NOT a compound state-decl. Its `.Variant`
  // brace sub-blocks + bare `name = value;` bindings trip the compound-lift
  // heuristic; the exemption lets BS fall through to the regular markup-opener
  // path → a `type=markup name=theme` block whose body the
  // STRUCTURAL_RAW_BODY_ELEMENTS gate captures raw for the theme dispatch.
  "theme",
]);

// ---------------------------------------------------------------------------
// Component name detection
//
// A tag name is a component reference (not an HTML element) if and only if
// its first character is an uppercase ASCII letter (A-Z).
// ---------------------------------------------------------------------------

/**
 * Returns true if `name` is a component reference (starts with uppercase ASCII).
 * @param {string} name
 * @returns {boolean}
 */
function isComponentName(name) {
  return name.length > 0 && name.charCodeAt(0) >= 65 && name.charCodeAt(0) <= 90;
}

// ---------------------------------------------------------------------------
// R24-BUG-4 / S138 — Generic `</>` closer support for STRUCTURAL_RAW_BODY_ELEMENTS
//
// Per SPEC §4.4.2: "`</>` SHALL close the innermost open markup tag or state
// block at the current position in the context stack." This applies uniformly,
// including to `<match>` + `<each>` structural raw-body elements.
//
// The pre-S138 depth tracker tracked same-kind nesting only (nested `<match>`
// inside `<match>` etc.) — sufficient for `</match>` / `</each>` explicit
// closers but blind to `</>` generic closers, because `</>` can close ANY
// open tag (arm-child or outer container).
//
// `findStructuralBodyEnd` runs a generic tag-stack scanner over the raw body:
// - skip-zones: `${...}` interpolation (brace-counted), `"..."` / `'...'`
//   strings, `<!-- -->` HTML comments, `//` to EOL + `/* */` scrml comments
// - tag-stack: push on each non-self-closing, non-`:`-shorthand opener;
//   pop on `</tagname>` / `</>`
// - outer-closer detection: when the stack is empty (all arm-children
//   balanced) AND we hit either `</tagname>` (matching the outer kind) OR
//   `</>`, that IS the outer closer
//
// Closer forms returned:
//   "explicit" — `</tagname>` matching the outer raw-body kind
//   "generic"  — `</>` (the S138 new path)
//   "inferred" — EOF hit without an outer-closer match (E-CTX-001 fallback)
//
// Same-kind nesting (HU-1 Q6 — nested `<each>` inside `<each>`) is naturally
// handled: a nested `<each>` opener pushes onto the stack like any other
// non-self-close tag; the matching `</each>` (or `</>`) pops it.
//
// `:`-shorthand detection — `<TagName : expr>` or `<TagName attr : expr>`:
// the colon shorthand body terminates at the next sibling/outer-closer; no
// balanced closer is needed. We detect via the same boundary-`:` scan the
// rest of BS uses (whitespace-surrounded `:` inside the opener attribute
// surface). Such openers are depth-neutral — do NOT push.
//
// Self-closing — `<TagName/>` or `<TagName attrs/>`: depth-neutral; do NOT
// push. Detected by terminating-`/>` on the opener.
// ---------------------------------------------------------------------------

/**
 * Skip past a `${...}` interpolation block from position `startPos` (which
 * SHALL be the `$` byte). Returns the position immediately after the matching
 * `}`. The scan brace-counts so nested `{...}` blocks balance.
 *
 * Inside `${...}`, `"..."` and `'...'` strings are also tracked so that
 * literal braces inside strings do NOT affect the brace counter.
 *
 * If EOF is hit before the matching `}`, returns `source.length` (caller
 * handles as "consumed to EOF").
 */
function skipDollarBrace(source, startPos) {
  const len = source.length;
  // expects source[startPos] === "$" && source[startPos+1] === "{"
  let i = startPos + 2;
  let depth = 1;
  let inDq = false;
  let inSq = false;
  while (i < len) {
    const c = source[i];
    if (inDq) {
      if (c === "\\" && i + 1 < len) { i += 2; continue; }
      if (c === '"') inDq = false;
      i++; continue;
    }
    if (inSq) {
      if (c === "\\" && i + 1 < len) { i += 2; continue; }
      if (c === "'") inSq = false;
      i++; continue;
    }
    if (c === '"') { inDq = true; i++; continue; }
    if (c === "'") { inSq = true; i++; continue; }
    if (c === "{") { depth++; i++; continue; }
    if (c === "}") {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return len;
}

/**
 * Skip past an HTML comment `<!-- ... -->` starting at `startPos` (which
 * SHALL be the `<` byte; caller has confirmed `<!--` prefix). Returns the
 * position immediately after the closing `-->`.
 */
function skipHtmlComment(source, startPos) {
  const len = source.length;
  let i = startPos + 4; // past `<!--`
  while (i < len) {
    if (source[i] === "-" && source[i + 1] === "-" && source[i + 2] === ">") {
      return i + 3;
    }
    i++;
  }
  return len;
}

/**
 * Skip past a `//` line comment starting at `startPos` (the first `/`).
 * Returns position immediately after the EOL (or EOF).
 */
function skipLineComment(source, startPos) {
  const len = source.length;
  let i = startPos + 2;
  while (i < len && source[i] !== "\n") i++;
  return i; // leave the `\n` for the outer scanner's line-tracker
}

/**
 * S144 Bug X (6nz, HIGH) — decide whether the `//` at `slashPos` falls INSIDE
 * a `"..."` or `'...'` string literal on its current source line.
 *
 * The block-splitter cannot afford full JS string-state tracking (regex
 * literals, template interpolation, etc. — see the §4.6 note in the main
 * loop), so this check is deliberately LINE-SCOPED and narrow: it rescans the
 * current physical line from its start up to `slashPos`, tracking double- and
 * single-quote parity with backslash-escape handling. If a quote of either
 * kind is still open at `slashPos`, the `//` is string content (NOT a
 * comment). This fixes the everyday `"https://..."` / bare-` // `-in-string
 * case without the over-reach of full string skipping (which mis-reads a
 * quote inside a regex like the double-quote class, or apostrophes in
 * block-comment prose).
 *
 * Returns the open quote char (`"`/`'`/`` ` ``) if inside a string at `slashPos`,
 * else null. Caller is responsible for only invoking this in brace-delimited
 * contexts (where string literals are a real concept).
 *
 * jwt-auth-bypass followup (2026-07-11, HIGH) — also tracks BACKTICK template
 * literals so a slash-slash / slash-star inside a backtick template (a glob such
 * as dir + slash-star-dot-js, or "open" + slash-star + interpolation) is
 * recognized as string content, not a comment. The scan stays LINE-SCOPED (a
 * template opened on a previous line is NOT seen — that case is caught by the
 * block-comment handler's containment safeguard). Backtick interpolation is
 * treated naively (the backtick toggle ignores the interpolation braces): the
 * probe templates carry their slash-star in template TEXT, not inside an
 * interpolation, so naive parity is correct for them; an interpolation-embedded
 * comment is the documented rare edge.
 */
function openStringQuoteAt(source, slashPos) {
  // Find the start of the current physical line.
  let lineStart = slashPos;
  while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart--;
  let inDouble = false;
  let inSingle = false;
  let inBacktick = false;
  for (let i = lineStart; i < slashPos; i++) {
    const ch = source[i];
    if (inDouble) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "\\") { i++; continue; }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inBacktick) {
      if (ch === "\\") { i++; continue; }
      if (ch === "`") inBacktick = false;
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === "`") { inBacktick = true; continue; }
  }
  if (inDouble) return '"';
  if (inSingle) return "'";
  if (inBacktick) return "`";
  return null;
}

/**
 * Skip past a `/* ... *\/` block comment starting at `startPos` (the first
 * `/`). Returns position immediately after the closing `*\/`.
 */
function skipBlockComment(source, startPos) {
  const len = source.length;
  let i = startPos + 2;
  while (i < len) {
    if (source[i] === "*" && source[i + 1] === "/") return i + 2;
    i++;
  }
  return len;
}

/**
 * Skip past whitespace AND `//` line comments / `/* *\/` block comments
 * starting at `startPos`. Returns the offset of the first non-trivia byte
 * (or `len` at EOF).
 *
 * R28-BUG-3 (S143): the compound-state-decl auto-lift recognizers
 * (`classifyOpenerForCompoundScan` + `scanCompoundBlockEnd`) inspect the
 * bytes between a parent opener's `>` and its first structural child to
 * decide compound-vs-markup and to find the matching close. A `//` comment
 * (SPEC §27.1 — universal, valid in ALL contexts) sitting on its own line
 * between the parent opener and the first `<child>` is structurally inert
 * trivia, exactly like whitespace, and MUST be skipped. Without this skip
 * the classifier sees `/` (the comment's first byte) instead of `<`, falls
 * back to `kind: "markup"`, and the parent (`<div>`/`<program>` body) is
 * pushed as a markup context that never closes — surfacing W-PROGRAM-001 +
 * E-CTX-001/E-CTX-003 (the `:`-shorthand-engine + leading-`//`-comment
 * combinatorial-closer failure).
 */
function skipTriviaForCompoundScan(source, len, startPos) {
  let i = startPos;
  while (i < len) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    break;
  }
  return i;
}

/**
 * url-in-comment (2026-07) — decide whether the `//` at `slashPos` is part of a
 * URL VALUE rather than a `//` line comment.
 *
 * SPEC §27.1 keeps `//` a UNIVERSAL comment valid in ALL contexts (incl. CSS
 * per §27.2's `/* *\/` and `//` row, and markup). But a bare URL is DATA, not a
 * comment: a CSS `url(http://x)` / protocol-relative `url(//cdn)` value, or
 * markup prose (`Visit http://x`), must not have its `//` eaten as a line
 * comment — doing so swallows the rest of the line (incl. the closing `}` of a
 * `#{}` block or a `</p>` closer), unwinds context depth, and surfaces a
 * spurious E-CTX-001/003 "unclosed" (the confirmed miscompile this fixes).
 *
 * A `//` is treated as URL content when, on its current physical line, EITHER:
 *   (a) it is immediately preceded by `:` — a scheme separator
 *       (`http://`, `https://`, `ws://`, `file://`, …), OR
 *   (b) it sits inside an unclosed `url(` token (CSS protocol-relative
 *       `url(//cdn…)` where no scheme `:` precedes the `//`).
 *
 * This is deliberately NARROW: it fires only on genuine URLs. A real
 * `// comment` line has whitespace (or line-start) before the `//`, so it is
 * NOT matched and still strips normally — SPEC §27 comment behaviour is
 * preserved. The caller SHALL apply this ONLY in CSS + markup-text contexts
 * (NOT logic/SQL, where URLs live in quoted strings already handled by
 * openStringQuoteAt), so JS/SQL `//` comment semantics are untouched.
 *
 * Exported (url-comment-match-engine, 2026-07-09) so the `<match>` /
 * `<engine>` arm re-tokenizers (match-statechild-parser.ts `skipMatchComment`,
 * engine-statechild-parser.ts `skipCommentOrString`) reuse ONE source of truth
 * for URL detection — a URL in arm PROSE must not have its `//` eaten as a line
 * comment by the arm scanner's own `//` handler (which would swallow the arm's
 * `</>` / `</Variant>` closer → a spurious E-MATCH-PARSE-001 /
 * E-ENGINE-STATE-CHILD-MISSING). Same SPEC §27-preserving narrowness: only a
 * genuine URL is exempted; a real `// comment` still strips.
 */
export function urlSlashesAt(source, slashPos) {
  // (a) Scheme separator: a `:` immediately before the `//`.
  if (slashPos > 0 && source[slashPos - 1] === ":") return true;
  // (b) Inside a CSS `url(...)` token on the current physical line.
  let lineStart = slashPos;
  while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart--;
  let inUrl = false;
  for (let i = lineStart; i < slashPos; i++) {
    if (inUrl) {
      if (source[i] === ")") inUrl = false;
      continue;
    }
    // Detect a `url(` token (case-insensitive) at an identifier boundary — so
    // `curl(` / `blur(` do not false-match.
    if (
      (source[i] === "u" || source[i] === "U") &&
      (source[i + 1] === "r" || source[i + 1] === "R") &&
      (source[i + 2] === "l" || source[i + 2] === "L") &&
      source[i + 3] === "("
    ) {
      const before = i > 0 ? source[i - 1] : "";
      if (!/[A-Za-z0-9_\-]/.test(before)) {
        inUrl = true;
        i += 3; // skip past `rl(` (loop `i++` covers the `u`)
      }
    }
  }
  return inUrl;
}

/**
 * Read the lowercased tag name starting at `nameStart` (the first
 * post-`<` or post-`</` byte). Returns `{ name, nameEnd }` where `nameEnd`
 * is the position immediately after the last name byte. Returns name=""
 * if no identifier-shaped byte sequence is present.
 */
function readTagName(source, nameStart) {
  const len = source.length;
  let i = nameStart;
  // First char: ASCII letter or `_`
  if (i >= len) return { name: "", nameEnd: i };
  const c0 = source.charCodeAt(i);
  const isAlpha = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95;
  if (!isAlpha) return { name: "", nameEnd: i };
  i++;
  while (i < len) {
    const cc = source.charCodeAt(i);
    const ok = (cc >= 65 && cc <= 90) ||   // A-Z
               (cc >= 97 && cc <= 122) ||  // a-z
               (cc >= 48 && cc <= 57) ||   // 0-9
               cc === 95 || cc === 45;     // _ -
    if (!ok) break;
    i++;
  }
  return { name: source.slice(nameStart, i).toLowerCase(), nameEnd: i };
}

/**
 * Scan the opener body from position `openerNameEnd` (just past the tag
 * name) to find the opener's terminating `>` (or `/>` self-close).
 *
 * Returns `{ openerEnd, isSelfClosing, isColonShorthand }`:
 *   - openerEnd: position immediately after the `>` byte
 *   - isSelfClosing: true if the opener ended with `/>`
 *   - isColonShorthand: true if the opener body contained a `:`-shorthand
 *     introducer
 *
 * SPEC §4.14 `:`-shorthand recognition (mirrors `scanAttributes` in the
 * main scanner):
 *   - depth-0 `:` (not inside parens/brackets/braces/strings)
 *   - whitespace immediately before the `:` (distinguishes from namespace
 *     attribute prefixes like `bind:value` / `class:active`)
 *   - next char is NOT `:` (avoid `::` Phase-3 syntax)
 *
 * Paren / bracket / brace tracking: a `>` inside `(...)` / `[...]` / `{...}`
 * is content, not the opener terminator. Similarly a `:` inside any of
 * those is NOT shorthand-marker — e.g., `<Ready(count: int)> : "ready"`
 * has the type-annotation `:` inside `(...)` which is depth-positive.
 *
 * If EOF is reached, returns `{ openerEnd: len, isSelfClosing: false,
 * isColonShorthand: false }` — caller treats as malformed.
 */
function scanOpenerBody(source, openerNameEnd) {
  const len = source.length;
  let i = openerNameEnd;
  let isSelfClosing = false;
  let isColonShorthand = false;
  let inDq = false;
  let inSq = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  // §51.0.J derived-engine EXPRESSION form (S190) — the `derived=<expr>` opener
  // value (ternary `derived=@n > 5 ? .A : .B`, call `derived=classify(@n)`,
  // conditional) is a scrml expression, so inside it a `>` / `<` / `>=` / `<=`
  // is a COMPARISON OPERATOR (not the opener terminator) and a `?`-introduced
  // `:` is the TERNARY alternative separator (not a §4.14 `:`-shorthand body).
  // `inDerivedExpr` flips true once we pass a depth-0 `derived=`; `ternaryDepth`
  // counts unmatched `?` so the matching `:` is recognized as ternary, mirror
  // of the S188 cluster-A `?`-depth guard. The `match @x {...}` form's braces
  // and the bare `@ident` legacy form are unaffected (neither carries a stray
  // operator/ternary `:`).
  let inDerivedExpr = false;
  let ternaryDepth = 0;
  while (i < len) {
    const c = source[i];
    // Detect the start of a depth-0 `derived=` attribute value.
    if (!inDerivedExpr && !inDq && !inSq &&
        parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 &&
        c === "d" && /(?:^|\s)derived\s*=/.test(source.slice(Math.max(0, i - 1), i + 9))) {
      const m = /^derived\s*=/.exec(source.slice(i));
      if (m && (i === openerNameEnd || /\s/.test(source[i - 1]))) {
        inDerivedExpr = true;
        i += m[0].length;
        continue;
      }
    }
    // String tracking.
    if (inDq) {
      if (c === "\\" && i + 1 < len) { i += 2; continue; }
      if (c === '"') inDq = false;
      i++; continue;
    }
    if (inSq) {
      if (c === "\\" && i + 1 < len) { i += 2; continue; }
      if (c === "'") inSq = false;
      i++; continue;
    }
    if (c === '"') { inDq = true; i++; continue; }
    if (c === "'") { inSq = true; i++; continue; }
    // Paren / bracket / brace depth — `>` and `:` inside these are content.
    if (parenDepth > 0 || bracketDepth > 0 || braceDepth > 0) {
      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      else if (c === "[") bracketDepth++;
      else if (c === "]") bracketDepth--;
      else if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
      i++; continue;
    }
    if (c === "(") { parenDepth++; i++; continue; }
    if (c === "[") { bracketDepth++; i++; continue; }
    // Sigil-prefixed brace openers + bare `{` open brace.
    if (c === "{" ||
        ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") &&
         source[i + 1] === "{")) {
      braceDepth++;
      if (c !== "{") i++; // skip the sigil char; the `{` is consumed next iteration
      i++;
      continue;
    }
    // §51.0.J (S190) — inside a `derived=<expr>` value, track ternary `?` depth
    // and treat a comparison `>` / `<` (incl. `>=` / `<=` / `>>` / `<<`) as an
    // operator, not the opener terminator.
    if (inDerivedExpr) {
      if (c === "?") { ternaryDepth++; i++; continue; }
      if (c === ":" && ternaryDepth > 0) { ternaryDepth--; i++; continue; }
      if (c === "<") {
        let j = i + 1; while (j < len && (source[j] === "=" || source[j] === "<")) j++;
        i = j; continue;
      }
      if (c === ">") {
        // A comparison `>` / `>=` / `>>` / `>>>` is followed (after optional
        // whitespace) by another operand; the opener-close `>` is followed by
        // whitespace+newline, EOF, a body `<` tag, or `/`.
        const opLen = (source[i + 1] === ">" ? (source[i + 2] === ">" ? 3 : 2)
          : (source[i + 1] === "=" ? 2 : 1));
        let k = i + opLen;
        while (k < len && (source[k] === " " || source[k] === "\t")) k++;
        const nxt = k < len ? source[k] : "";
        const isOperandLead = nxt !== "" && /[0-9A-Za-z_$@.("'!+\-]/.test(nxt);
        if (opLen > 1 || isOperandLead) { i = i + opLen; continue; }
        // Genuine opener close — fall through to the `>` return below.
      }
    }
    // SPEC §4.14 `:`-shorthand introducer at depth-0.
    if (c === ":" && source[i + 1] !== ":") {
      const prev = i > openerNameEnd ? source[i - 1] : "";
      const prevSpace = prev === " " || prev === "\t" || prev === "\n" || prev === "\r";
      if (prevSpace) {
        isColonShorthand = true;
      }
    }
    if (c === "/" && source[i + 1] === ">") {
      isSelfClosing = true;
      return { openerEnd: i + 2, isSelfClosing, isColonShorthand };
    }
    if (c === ">") {
      return { openerEnd: i + 1, isSelfClosing, isColonShorthand };
    }
    i++;
  }
  return { openerEnd: len, isSelfClosing, isColonShorthand };
}

/**
 * Generic tag-stack scanner for STRUCTURAL_RAW_BODY_ELEMENTS bodies. Starts
 * at `startPos` (immediately after the outer opener's `>`) and runs until
 * one of:
 *   - the outer `</tagname>` is encountered with the stack empty
 *     → returns `{ contentEnd: pos, closerForm: "explicit", closerLen }`
 *   - `</>` is encountered with the stack empty
 *     → returns `{ contentEnd: pos, closerForm: "generic", closerLen: 3 }`
 *   - EOF
 *     → returns `{ contentEnd: len, closerForm: "inferred", closerLen: 0 }`
 *
 * `outerTagName` is the lowercased tag name of the outer raw-body element
 * (e.g., "match" / "each"). The scanner skips `${...}` interpolation
 * blocks, `"..."` / `'...'` strings, `<!-- -->` HTML comments, `//` line
 * comments, and `/* *\/` block comments — `<` characters inside any of
 * those do NOT affect the tag-stack.
 *
 * Returned `contentEnd` is the position of the byte BEFORE the closer (or
 * `len` if EOF). Caller advances past the closer of length `closerLen`.
 */
function findStructuralBodyEnd(source, startPos, outerTagName) {
  const len = source.length;
  // Stack of open tag names (lowercased) AT THE BODY LEVEL — does not
  // include the outer raw-body element itself.
  const tagStack = [];
  let i = startPos;
  while (i < len) {
    const c = source[i];
    // Skip zones — check before any `<` interpretation.
    if (c === "$" && source[i + 1] === "{") {
      i = skipDollarBrace(source, i);
      continue;
    }
    // g-match-arm-apostrophe-bs (S195/S196) — a `'` / `"` at the MARKUP-TEXT level
    // (between tags, outside `${...}`) is PROSE, NOT a string-span delimiter. The
    // body-level scan must NOT skip a quoted span here: a possessive apostrophe or
    // contraction in arm free-text (`<Failed> <p>We'll try again later.</p> </>`)
    // would otherwise open a phantom string that consumes the `</p>` / `</>`
    // closers through to EOF — the tag-stack never unwinds and the scan surfaces a
    // misleading E-CTX-001/003 "Unclosed <match>". This mirrors the S109 locus
    // ruling (bug-4 deep-dive): strings live in LOGIC context (inside `${...}`,
    // already opaque via skipDollarBrace above) and in ATTRIBUTE VALUES (handled
    // with local quote-state inside scanOpenerBody) — markup-text body is text with
    // no string concept. (A paired-quote string containing `/<X` in markup prose is
    // the documented narrow edge case with an entity-escape workaround, same as the
    // S109 main-loop ruling.)
    if (c === "/" && source[i + 1] === "/") {
      // url-in-comment (2026-07): a `//` that is part of a URL VALUE in this
      // raw-body text (`<match>`/`<each>` arm prose — `See http://x`) is DATA,
      // not a comment; skipping it as a line comment would swallow the rest of
      // the line incl. a `</p>` / `</match>` closer and derail the tag-stack.
      if (urlSlashesAt(source, i)) { i += 2; continue; }
      i = skipLineComment(source, i);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    if (c !== "<") {
      i++;
      continue;
    }
    // c === "<" — disambiguate.
    // HTML comment `<!-- -->`:
    if (source[i + 1] === "!" && source[i + 2] === "-" && source[i + 3] === "-") {
      i = skipHtmlComment(source, i);
      continue;
    }
    // Closer `</...>`:
    if (source[i + 1] === "/") {
      // Generic `</>`:
      if (source[i + 2] === ">") {
        if (tagStack.length === 0) {
          // Outer closer — generic form.
          return { contentEnd: i, closerForm: "generic", closerLen: 3 };
        }
        tagStack.pop();
        i += 3;
        continue;
      }
      // Explicit `</tagname>`:
      const { name: closerName, nameEnd: closerNameEnd } = readTagName(source, i + 2);
      if (closerName === "" || source[closerNameEnd] !== ">") {
        // Malformed closer — skip the `<` and continue. Downstream
        // re-parse will surface the real error.
        i++;
        continue;
      }
      if (tagStack.length === 0 && closerName === outerTagName) {
        // Outer closer — explicit form.
        const closerLen = closerNameEnd + 1 - i;
        return { contentEnd: i, closerForm: "explicit", closerLen };
      }
      // Pop the matching tag from the stack (best-effort — if stack-top
      // doesn't match we still pop, letting downstream re-parse surface
      // the real diagnostic).
      if (tagStack.length > 0) {
        tagStack.pop();
      }
      i = closerNameEnd + 1;
      continue;
    }
    // Opener `<tagname...>` — read the tag name.
    const { name: openerName, nameEnd: openerNameEnd } = readTagName(source, i + 1);
    if (openerName === "") {
      // Not an opener (e.g., bare `<` in code-default body). Advance one.
      i++;
      continue;
    }
    // Scan the opener body to find `>` or `/>` and detect `:`-shorthand.
    const { openerEnd, isSelfClosing, isColonShorthand } = scanOpenerBody(source, openerNameEnd);
    let isAfterCloseColonShorthand = false;
    if (!isSelfClosing && !isColonShorthand) {
      // Match-arm-style after-`>` colon `:`-shorthand: `<Variant> : expr` or
      // `<Variant>: expr`. Per match-statechild-parser convention (parallel
      // to the SPEC §18.0.1 worked examples), if the next non-horizontal-
      // whitespace char after `>` (on the same logical line up to the next
      // newline that introduces an arm-opener) is `:`, treat the opener as
      // shorthand-bodied — depth-neutral.
      let peek = openerEnd;
      while (peek < len && (source[peek] === " " || source[peek] === "\t")) peek++;
      if (peek < len && source[peek] === ":") {
        isAfterCloseColonShorthand = true;
      }
    }
    if (
      !isSelfClosing &&
      !isColonShorthand &&
      !isAfterCloseColonShorthand &&
      !VOID_ELEMENTS.has(openerName)
    ) {
      // Non-self-close, non-shorthand opener — pushes onto the stack.
      //
      // §24 void elements (`<input>`, `<br>`, `<img>`, …) are SELF-TERMINATING
      // even in their bare (un-self-closed) form — they admit no children. A
      // bare void opener inside a STRUCTURAL_RAW_BODY (match / each) body must
      // NOT push onto the tag-stack; otherwise the next `</>` / `</tag>` closer
      // (e.g. a match arm's `</>` or the outer `</match>`) is mis-consumed as
      // the void element's closer, the stack never unwinds, and the scan runs
      // to EOF — surfacing a misleading E-CTX-001 "Unclosed <match>" instead of
      // parsing the void as a leaf. `readTagName` lowercased `openerName`, so
      // the VOID_ELEMENTS lookup is case-correct. (The self-closed `<input/>`
      // form already short-circuits via `isSelfClosing` above.)
      tagStack.push(openerName);
    }
    i = openerEnd;
  }
  return { contentEnd: len, closerForm: "inferred", closerLen: 0 };
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

/**
 * Split preprocessed source into a typed block tree.
 *
 * Errors are collected into the returned errors[] array rather than thrown.
 * Scanning continues after each error using a best-effort recovery strategy,
 * so callers receive all errors in one pass instead of stopping at the first.
 *
 * @param {string} filePath
 * @param {string} source  - preprocessed source text
 * @returns {{ filePath: string, blocks: Block[], errors: BSError[] }}
 */
export function splitBlocks(filePath, source) {
  const len = source.length;

  // --- Scanner state ---
  let pos = 0;   // current byte offset (0-based)
  let line = 1;  // current line (1-based)
  let col = 1;   // current col  (1-based)

  // Context stack frames:
  //   For markup/state: { type, name, isComponent, depth, startPos, startLine, startCol, children, braceDepth:0 }
  //   For brace-delimited: { type, name:null, depth, startPos, startLine, startCol, children, braceDepth }
  const stack = [];

  // Root-level blocks (when stack is empty)
  const rootBlocks = [];

  // Accumulated errors — never throw; always push and continue.
  const errors = [];

  // Text accumulation: position where current text run started (-1 = not accumulating)
  let textStart = -1;
  let textStartLine = 1;
  let textStartCol = 1;

  // Quote state for bare-/ disambiguation (section 4.8)
  // Tracks whether we are inside a "..." or '...' string at the global scan level.
  // This is reset/managed carefully around tag attribute scanning.
  let inDoubleQuote = false;
  let inSingleQuote = false;

  // Orphan brace depth: tracks bare `{` at top/markup/state level that are NOT
  // preceded by a context sigil ($, ?, #, !, ^, ~). This handles type declarations
  // like `type X:enum = { A, B, C }` where `{...}` is structural text, not a context.
  let orphanBraceDepth = 0;

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Array to append blocks into (current frame's children, or rootBlocks). */
  function targetChildren() {
    return stack.length > 0 ? stack[stack.length - 1].children : rootBlocks;
  }

  /** The top stack frame, or null. */
  function topFrame() {
    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  /**
   * g-colon-shorthand-markup-misparse (2026-06-18) — true when the top frame is
   * an `<engine>` / `<machine>` markup body (where state-children live). Used to
   * scope the DEPRECATED after-`>` `:`-shorthand recognition to the engine locus:
   * an engine state-child opener (`<Idle rule=.Done> : <p>…</p>`) followed by an
   * after-`>` ` : ` is a self-terminating leaf, not a context-pushing opener. The
   * match / each loci already cover the after-`>` form via findStructuralBodyEnd
   * (they are STRUCTURAL_RAW_BODY); engine is NOT, so it needs this main-loop
   * recognition. Scoping to the engine frame keeps a stray `<div> : x` in plain
   * markup unaffected.
   */
  function topIsEngineBody() {
    const f = topFrame();
    if (f === null) return false;
    const nm = typeof f.name === "string" ? f.name.toLowerCase() : "";
    return f.type === "markup" && (nm === "engine" || nm === "machine");
  }

  /** True if the top frame is a brace-delimited context. */
  function topIsBraceContext() {
    const f = topFrame();
    return f !== null && (
      f.type === "logic" || f.type === "sql" ||
      f.type === "css" || f.type === "error-effect" ||
      f.type === "meta" || f.type === "test" ||
      f.type === "foreign"   // dpa-003 (S216) — `_={ … }=` opaque brace context
    );
  }

  /** Current nesting depth = stack length. */
  function depth() {
    return stack.length;
  }

  // ---------------------------------------------------------------------------
  // Position tracking
  // ---------------------------------------------------------------------------

  function ch(offset = 0) {
    return pos + offset < len ? source[pos + offset] : "";
  }

  /**
   * §54.3 transition-decl target recognizer.
   *
   * Given the position of a `<` that begins a `< Ident>` state-opener at
   * state-body level, determine whether this `<` is actually the TARGET of
   * a state-local transition declaration (not a nested state push).
   *
   * Recognizes the suffix pattern immediately preceding the `<`:
   *     <ident> <ws>* `(` <balanced> `)` <ws>* `=>` <ws>*
   *
   * When this returns true, the caller should consume `< Ident>` as text
   * (so it survives as part of the transition signature for AST Phase 4b)
   * and leave the state frame unchanged.
   */
  function isAfterTransitionArrow(tagStartPos) {
    let i = tagStartPos - 1;
    // Skip whitespace before '<'
    while (i >= 0 && /\s/.test(source[i])) i--;
    if (i < 1) return false;
    // Expect '=>'
    if (source[i] !== ">" || source[i - 1] !== "=") return false;
    // Walk past '=>' and any whitespace
    i -= 2;
    while (i >= 0 && /\s/.test(source[i])) i--;
    // Expect closing ')'
    if (i < 0 || source[i] !== ")") return false;
    // Balance-match back through parens
    let parenDepth = 1;
    i--;
    while (i >= 0 && parenDepth > 0) {
      const c = source[i];
      if (c === ")") parenDepth++;
      else if (c === "(") parenDepth--;
      i--;
    }
    if (parenDepth !== 0) return false;
    // Skip whitespace
    while (i >= 0 && /\s/.test(source[i])) i--;
    // Expect an identifier char (the transition name)
    if (i < 0 || !/[A-Za-z0-9_]/.test(source[i])) return false;
    return true;
  }

  /** Advance one character, updating line/col. */
  function step() {
    if (pos < len) {
      if (source[pos] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      pos++;
    }
  }

  /** Advance n characters. */
  function advance(n) {
    for (let i = 0; i < n; i++) step();
  }

  // ---------------------------------------------------------------------------
  // Text accumulation
  // ---------------------------------------------------------------------------

  /** Begin accumulating a text run at the current position (if not already started). */
  function beginText() {
    if (textStart === -1) {
      textStart = pos;
      textStartLine = line;
      textStartCol = col;
    }
  }

  /**
   * Flush accumulated text into the current target, then reset text state.
   * No-op if textStart === -1.
   */
  function flushText() {
    if (textStart === -1) return;
    const raw = source.slice(textStart, pos);
    if (raw.length > 0) {
      targetChildren().push({
        type: "text",
        raw,
        span: { start: textStart, end: pos, line: textStartLine, col: textStartCol },
        depth: depth(),
        children: [],
        name: null,
        closerForm: null,
        isComponent: false,
      });
    }
    textStart = -1;
  }

  // ---------------------------------------------------------------------------
  // Tag/attribute scanning helpers
  // ---------------------------------------------------------------------------

  /**
   * Read a maximal identifier at current position.
   * Identifier chars: [A-Za-z0-9_-]
   */
  function readIdent() {
    let id = "";
    while (pos < len && /[A-Za-z0-9_\-]/.test(source[pos])) {
      id += source[pos];
      step();
    }
    return id;
  }

  /**
   * Scan attribute content from current position up through and including '>'.
   * Handles quoted values so '>' inside '"..."' or "'...'" is not treated as a tag-close.
   * Also handles bare '{...}' attribute values (e.g., props={...}, onClick={handler})
   * so '>' inside any '{...}' does not prematurely close the tag.
   * Also returns whether the tag ended with '/>' (self-closing).
   *
   * After this call, pos is just past the '>'.
   * IMPORTANT: this uses LOCAL quote state so the global quote flags remain correct.
   *
   * SPEC §4.14 `:`-shorthand body recognition (R25-Bug-40, 2026-05-27): when
   * the opener carries a top-level ` :` (whitespace-bounded colon NOT part of
   * a namespace-prefixed attribute name like `bind:value` / `class:active` /
   * `on:click` — those have NO whitespace before the `:`), the colon
   * introduces a `:`-shorthand single-expression body that runs through to
   * the opener's `>`. The opener has NO closer. Callers treat
   * `shorthand: true` as a leaf-block emit (analogous to `selfClosing`).
   * Bracket-depth tracking (brace/paren/bracket/quote) prevents premature
   * `>` termination inside the body expression. Embedded markup-as-value
   * inside the shorthand body (e.g. `<Loading : <p>...</p>>`,
   * `<Idle rule=.Loading : <button onclick=load()>Load</button>>`) IS handled
   * (g-colon-shorthand-markup-misparse, 2026-06-18) via SPEC §4.13 angleDepth
   * tracking, gated on `shorthand === true` so an embedded markup tag's `>` is
   * body content, not the opener terminator — the opener `>` is the one at
   * angle depth 0 (§4.14:985 markup-as-value body / :990 angleDepth rule).
   * The Bug-40 each-item-body cases (`<li : @.name>`,
   * `<li class="card" : @.title>`, `<empty : "none">`) remain covered by the
   * brace/paren/bracket tracking (no embedded markup → angle depth stays 0).
   *
   * @returns {{ attrRaw: string, selfClosing: boolean, shorthand: boolean }}
   */
  function scanAttributes() {
    let attrRaw = "";
    let localDouble = false;
    let localSingle = false;
    let selfClosing = false;
    let shorthand = false;
    // shorthandColonAttrOff — offset of the `:` introducer WITHIN attrRaw
    // (i.e., attrRaw.length at the moment we recognize the `:`-shorthand).
    // Surfaced so callers / ast-builder can slice the opener at the
    // introducer to separate attribute region from shorthand body. -1 when
    // not in shorthand mode.
    let shorthandColonAttrOff = -1;
    let braceDepth = 0;   // track '{' nesting inside attribute values (sigil-prefixed or bare)
    let parenDepth = 0;   // §5.5.2: track '(' nesting so '>' in (expr) doesn't close the tag
    let bracketDepth = 0; // R25-Bug-40: track '[' nesting so '>' in [expr] (array-access etc.) doesn't close the tag
    // cluster-A (S188) — track depth-0 ternary `?` so the `:` branch separator
    // of a stray unquoted ternary condition (`if=@n ? @m : @n`) is NOT mistaken
    // for a `:`-shorthand body introducer. Without this, the ` : ` shreds the
    // opener into a closer-less shorthand leaf and surfaces a misleading
    // E-CTX-001 on the element's real closer. (The whole unquoted-ternary
    // condition is then captured by the attribute tokenizer as an
    // ATTR_OP_REJECT → E-ATTR-UNQUOTED-OPERATOR, the canonical reject.)
    let ternaryDepth = 0;
    // g-colon-shorthand-markup-misparse (2026-06-18) — SPEC §4.13 angleDepth +
    // §4.14:990 ("The `angleDepth` rule (§4.13) applies inside the expression —
    // embedded markup is handled by tracking angle depth"). Once a `:`-shorthand
    // body is recognized (the SHALL-be-one-expression body per §4.14:985, which
    // explicitly admits markup-as-value), a `<tag>` / `</tag>` / `<tag/>` in the
    // body must NOT have its `>` mistaken for the opener terminator. This counter
    // is only consulted while `shorthand === true`; it tracks embedded markup-tag
    // nesting inside the shorthand body so the opener-terminating `>` is the one
    // encountered at `shorthandAngleDepth === 0`. Pre-fix, only brace/paren/
    // bracket depth was tracked, so `<Loading : <p>x</p>>` truncated the body at
    // the inner `<p>`'s `>` and shredded the engine/match body (the documented
    // gap in the scanAttributes header comment, now closed).
    let shorthandAngleDepth = 0;
    // §36 / §6.7.7 (request-id-render-bridge, 2026-06-22) — a `<#id>` input-state
    // OR `<request>` ref used in an UNQUOTED attribute value (`if=<#feed>.loading`,
    // `show=<#cursor>.pressed(0)`) carries an embedded `>` (the `<#id>` close) that
    // must NOT be read as the opener terminator — otherwise the trailing `.member`
    // (`.loading`/`.data`) is shredded into body content and lost (the attr value
    // captures only the bare `<#id>`, so `if=<#feed>.loading` lowered to a bare base
    // read of the wrong thing). Track a hash-ref angle depth: a `<#` increments, its
    // matching `>` decrements and is consumed as part of attrRaw (NOT a terminator).
    // This is the `<#id>` analogue of the §4.13 `shorthandAngleDepth` markup-tag rule.
    let hashRefAngleDepth = 0;
    // §51.0.J derived-engine EXPRESSION form (S190) — once the scanner passes a
    // depth-0 `derived=` attribute name, the value is a scrml EXPRESSION (the
    // ternary `derived=@n > 5 ? .A : .B`, call `derived=classify(@n)`, or
    // conditional form). Inside it a comparison `>` / `<` (incl. `>=` / `<=` /
    // `>>` / `<<`) is an OPERATOR, NOT the opener terminator — the OPPOSITE of
    // the S188 cluster-A condition-attr reject (where the operator is illegal).
    // `inDerivedExpr` flips true at the `derived=` boundary; the ternary `?`
    // tracking below (shared with cluster-A) already makes the ternary `:` not
    // a `:`-shorthand. Legacy `derived=@ident` and `derived=match @x {...}` are
    // unaffected (no stray comparison operator at depth-0).
    let inDerivedExpr = false;
    // issue #28 (leading-`=` body text) — track whether the scanner is CURRENTLY
    // inside an UNQUOTED attribute VALUE (`if=@n …`). The S188 cluster-A `>=`
    // reject below (a depth-0 `>` immediately followed by `=` treated as a stray
    // comparison operator) is legitimate ONLY inside such a value. It becomes
    // true at a depth-0 `=` assignment and FALSE again the moment a delimited
    // value is opened (`"`, `'`, `(`, `{`, `[`, or a sigil-brace) — a quoted/
    // parenthesized/braced value is not a bare unquoted comparison value, so a
    // leading-`=` body after e.g. `id="cell"` (`<span id="cell">= hi>`) must NOT
    // be read as a comparison. At a BARE tag terminator (no unquoted value in
    // progress — `<span>= hi>`, `<td>=SUM(A1:A9)>`) the `>` closes the opener and
    // the leading `=` is body text. Without this gate the `>` + leading `=` were
    // swallowed together, the opener never terminated, and a misleading
    // E-CTX-001 cascade fired on the outer structural tags.
    let inUnquotedValue = false;

    while (pos < len) {
      const c = source[pos];

      // Inside any brace expression: track nested brace depth so '>' does not close the tag.
      // Covers sigil-prefixed (${...}, ?{...}, etc.) and bare ({...}) attribute values.
      if (braceDepth > 0) {
        if (c === "{") {
          braceDepth++;
        } else if (c === "}") {
          braceDepth--;
        }
        attrRaw += c;
        step();
        continue;
      }

      // Inside parenthesized expression: track paren depth so '>' doesn't close the tag.
      // Handles class:active=(@count > 0), if=(@a > @b), etc.
      if (parenDepth > 0) {
        if (c === "(") {
          parenDepth++;
        } else if (c === ")") {
          parenDepth--;
        }
        attrRaw += c;
        step();
        continue;
      }

      // R25-Bug-40: inside bracketed expression: `[ ... ]` (array literal /
      // member access / collection projection). `>` inside `[...]` is content
      // (`items[@i > 0]`, `arr[arr.length > 1 ? 0 : 1]` etc.). Tracked
      // independently from parenDepth because `[` / `(` may nest in either
      // order and either-order tracking is sufficient (no cross-bracket
      // mismatch is meaningful inside an opener).
      if (bracketDepth > 0) {
        if (c === "[") {
          bracketDepth++;
        } else if (c === "]") {
          bracketDepth--;
        }
        attrRaw += c;
        step();
        continue;
      }

      if (!localDouble && !localSingle) {
        // §36 / §6.7.7 — a `<#id>` ref token inside an unquoted attr value. The
        // `<#` opens a hash-ref whose `>` is part of the token, not the opener
        // close. Consume `<#` and bump the depth so the matching `>` (handled just
        // below) is absorbed into attrRaw with the trailing `.member` preserved.
        if (c === "<" && ch(1) === "#") {
          hashRefAngleDepth++;
          attrRaw += "<#";
          advance(2);
          continue;
        }
        if (c === ">" && hashRefAngleDepth > 0) {
          hashRefAngleDepth--;
          attrRaw += c;
          step();
          continue;
        }
        // g-colon-shorthand-markup-misparse (2026-06-18) — SPEC §4.13 angleDepth
        // tracking inside a `:`-shorthand markup-as-value body (§4.14:985/:990).
        // Active ONLY once the `:`-shorthand introducer has been recognized
        // (`shorthand === true`). An embedded markup tag's `>` must not be read
        // as the opener terminator; the opener `>` is the one seen at angle
        // depth 0. This MUST run before the plain `>` / `/>` terminator handlers
        // below. Per §4.13: a `<` immediately followed by a letter or `/`
        // increments; a `>` while depth > 0 decrements (and is body content,
        // not a tag boundary); `/>` while depth > 0 closes the embedded tag.
        if (shorthand) {
          if (c === "<" && /[A-Za-z\/]/.test(ch(1))) {
            shorthandAngleDepth++;
            attrRaw += c;
            step();
            continue;
          }
          if (c === "/" && ch(1) === ">" && shorthandAngleDepth > 0) {
            // Embedded self-closing tag (`<br/>`, `<input/>`) inside the body —
            // closes the tag it opened; NOT the shorthand opener's terminator.
            shorthandAngleDepth--;
            attrRaw += "/>";
            advance(2);
            continue;
          }
          if (c === ">" && shorthandAngleDepth > 0) {
            shorthandAngleDepth--;
            attrRaw += c;
            step();
            continue;
          }
        }
        // cluster-A (S188 "reject + parens") — `g-attr-gte-tagclose` early
        // guard. A depth-0 `>=` sequence (a `>` IMMEDIATELY followed by `=`)
        // is never an opener terminator: the tag close is `>` and the
        // self-close is `/>`; no valid scrml opener ends with `>` adjacent to
        // `=`. Such a `>=` only arises as a stray comparison operator inside an
        // unquoted condition attribute value (`if=@n >= 3`). If we let the `>`
        // close the tag here, the trailing `= 3>` shreds into body content and
        // surfaces the misleading E-CTX-001 "no matching tag" cascade. Instead,
        // keep scanning — the `>=` (and the rest of the operator condition)
        // flows into attrRaw, the attribute tokenizer captures it as an
        // ATTR_OP_REJECT, and the AST builder fires the clean
        // E-ATTR-UNQUOTED-OPERATOR (parens/quotes steer) ONCE.
        // §51.0.J (S190) — detect crossing the `derived=` attribute-name
        // boundary. attrRaw accumulates the opener content; when it just
        // closed a `derived=` token we are now reading the derived EXPRESSION.
        if (!inDerivedExpr && /(?:^|\s)derived\s*=$/.test(attrRaw)) {
          inDerivedExpr = true;
        }
        // §51.0.J (S190) — inside a `derived=<expr>` value, a comparison
        // `>` / `<` (incl. `>=` / `<=` / `>>` / `>>>` / `<<`) is an operator,
        // not the opener close. The opener-close `>` is followed (after
        // optional whitespace) by EOF / newline / a body `<` tag / `/`, never
        // by another operand. (For the legacy `if=`/`show=` condition attrs,
        // inDerivedExpr stays false and the S188 cluster-A reject below fires.)
        if (inDerivedExpr && c === "<") {
          attrRaw += c; step();
          while (pos < len && (ch(0) === "=" || ch(0) === "<")) { attrRaw += source[pos]; step(); }
          continue;
        }
        if (inDerivedExpr && c === ">") {
          const opLen = (ch(1) === ">" ? (ch(2) === ">" ? 3 : 2) : (ch(1) === "=" ? 2 : 1));
          let k = pos + opLen;
          while (k < len && (source[k] === " " || source[k] === "\t")) k++;
          const nxt = k < len ? source[k] : "";
          const isOperandLead = nxt !== "" && /[0-9A-Za-z_$@.("'!+\-]/.test(nxt);
          if (opLen > 1 || isOperandLead) {
            for (let q = 0; q < opLen; q++) { attrRaw += source[pos]; step(); }
            continue;
          }
          // else: genuine opener close — fall through to the `>` handler below.
        }
        // issue #28 — the S188 cluster-A `>=` reject fires ONLY while inside an
        // unquoted attribute value (`inUnquotedValue`). At a bare tag terminator
        // (no unquoted value in progress — including after a quoted attribute
        // like `id="cell"`) the `>` closes the opener; the following `=` is
        // leading body text, handled by the plain `>` case below.
        if (c === ">" && ch(1) === "=" && inUnquotedValue) {
          attrRaw += c;
          step();
          continue;
        }
        if (c === ">") {
          attrRaw += c;
          step();
          break;
        }
        if (c === "/" && ch(1) === ">") {
          selfClosing = true;
          attrRaw += "/>";
          advance(2);
          break;
        }
        // R25-Bug-40 — SPEC §4.14 `:`-shorthand body recognition. At depth-0,
        // a `:` whose PREVIOUS char in attrRaw is whitespace (or attrRaw is
        // entirely whitespace — i.e., the colon is the first non-whitespace
        // content after the tag name) AND whose NEXT char in source is NOT
        // another `:` (avoid `::` Phase-3 syntax) introduces a single-
        // expression shorthand body that runs to the next top-level `>`.
        // The opener has no closer (closerForm: "shorthand" on the leaf).
        //
        // This is the BS-level recognition required by SPEC §4.14 ("The
        // block splitter recognizes a `:`-shorthand body by the post-
        // attribute `:` token inside an opener — a within-opener scan
        // concern"). Pre-S136 BS did NOT implement this, so `:`-shorthand
        // openers inside each-block bodies (re-split via splitBlocks) fired
        // E-CTX-003 and the openers were silently dropped — Bug 40 root
        // cause. Engine state-child `:`-shorthand was downstream re-parsed
        // from rulesRaw, masking the same BS-level non-compliance.
        //
        // Mandatory whitespace BEFORE `:` distinguishes from namespace
        // attribute prefixes (`bind:value`, `class:active`, `on:click`,
        // `aria-foo:bar`) which have NO whitespace before `:`.
        if (c === ":" && ch(1) !== ":" && ternaryDepth > 0) {
          // cluster-A (S188) — this `:` is the alternative-branch separator of
          // an open depth-0 ternary (`if=@n ? @m : @n`), NOT a `:`-shorthand
          // body introducer. Consume it as opener content and close the
          // ternary so the rest of the operator condition flows into attrRaw
          // (to be captured as an ATTR_OP_REJECT downstream).
          ternaryDepth--;
          attrRaw += c;
          step();
          continue;
        }
        if (c === ":" && ch(1) !== ":") {
          // Look back in attrRaw for previous char. SPEC §4.14: "opens with
          // a single `:` token preceded by at least one whitespace
          // character following the last attribute (or the tag name if
          // there are no attributes)". Therefore the predecessor MUST
          // be whitespace AND attrRaw must be non-empty (an empty attrRaw
          // means the `:` is immediately adjacent to the tag name with NO
          // whitespace — SPEC says that's E-PARSE-001 / namespace-prefix
          // shape, NOT shorthand).
          if (attrRaw.length > 0 && /\s/.test(attrRaw[attrRaw.length - 1])) {
            shorthand = true;
            shorthandColonAttrOff = attrRaw.length; // position of the `:` within attrRaw
            // Mark the `:` introducer in attrRaw — caller does not branch
            // on attrRaw structure, but downstream emit-each / detection
            // helpers inspect the markup leaf's `raw` (which includes the
            // entire opener slice — `<li : @.name>`).
            attrRaw += c;
            step();
            // Continue the scanner — `>` at depth-0 still terminates the
            // opener (now interpreted as the shorthand-body terminator).
            continue;
          }
        }
        // Sigil-prefixed brace openers: ${, ?{, #{, !{, ^{, ~{
        if ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && ch(1) === "{") {
          braceDepth = 1;
          inUnquotedValue = false; // issue #28 — a braced value is not a bare unquoted value
          attrRaw += c;
          step();
          attrRaw += source[pos];
          step();
          continue;
        }
        // cluster-A (S188) — a bare depth-0 `?` (NOT the `?{` SQL sigil handled
        // above) opens a ternary. Track it so the matching `:` is consumed as
        // the alternative-branch separator (above) rather than mistaken for a
        // `:`-shorthand body introducer. (`if=@n ? @m : @n` is a stray unquoted
        // ternary — rejected downstream via ATTR_OP_REJECT.)
        if (c === "?") {
          ternaryDepth++;
          attrRaw += c;
          step();
          continue;
        }
        // Bare '{' opener: props={...}, class={expr}, onClick={handler}.
        // Track brace depth so '>' inside the value is not treated as a tag-close.
        // This fixes parsing of function type annotations like 'onClick: () => void'.
        if (c === "{") {
          braceDepth++;
          inUnquotedValue = false; // issue #28 — braced value is not a bare unquoted value
          attrRaw += c;
          step();
          continue;
        }
        // §5.5.2: '(' opener for parenthesized expressions: class:active=(@count > 0).
        // Track paren depth so '>' inside the value is not treated as a tag-close.
        if (c === "(") {
          parenDepth++;
          inUnquotedValue = false; // issue #28 — parenthesized value is not a bare unquoted value
          attrRaw += c;
          step();
          continue;
        }
        // R25-Bug-40: '[' opener for bracket expressions in shorthand bodies
        // (`<li : @.items[0]>`, `<li : @.arr[@.i > 0]>`). Tracked so '>' inside
        // doesn't close the tag.
        if (c === "[") {
          bracketDepth++;
          inUnquotedValue = false; // issue #28 — bracketed value is not a bare unquoted value
          attrRaw += c;
          step();
          continue;
        }
        // issue #28 — a depth-0 `=` (attribute assignment) enters an attribute
        // value. It is provisionally an UNQUOTED value; if the value turns out to
        // be delimited (`"`, `'`, `(`, `{`, `[`, sigil-brace) the opener handlers
        // above/below clear the flag on the very next char. This runs inside the
        // `!localDouble && !localSingle` block, so an `=` inside a quoted value
        // (`title="a=b"`) never sets it. No `continue` — the `=` still appends
        // via the catch-all below.
        if (c === "=") { inUnquotedValue = true; }
        if (c === '"') {
          localDouble = true;
          inUnquotedValue = false; // issue #28 — quoted value is not a bare unquoted value
          attrRaw += c;
          step();
          continue;
        }
        if (c === "'") {
          localSingle = true;
          inUnquotedValue = false; // issue #28 — quoted value is not a bare unquoted value
          attrRaw += c;
          step();
          continue;
        }
      } else if (localDouble && c === '"') {
        localDouble = false;
        attrRaw += c;
        step();
        continue;
      } else if (localSingle && c === "'") {
        localSingle = false;
        attrRaw += c;
        step();
        continue;
      } else if (c === "\\") {
        // Escape: consume two chars
        attrRaw += c;
        step();
        if (pos < len) {
          attrRaw += source[pos];
          step();
        }
        continue;
      }

      attrRaw += c;
      step();
    }

    return { attrRaw, selfClosing, shorthand, shorthandColonAttrOff };
  }

  // g-colon-shorthand-markup-misparse (2026-06-18) — DEPRECATED after-`>`
  // `:`-shorthand placement (`<Variant attrs> : expr`, the `:` AFTER the
  // opener-terminating `>`). SPEC §4.14:999 / §51.0.I:25813 / §18.0.1:11216:
  // the after-`>` placement is DEPRECATED but parses IDENTICALLY during the
  // window (it builds the same AST + emits identically, surfacing only the
  // info-level `W-COLON-SHORTHAND-LEGACY-PLACEMENT`). The match/each loci
  // already handle this in `findStructuralBodyEnd` (the opener is depth-neutral
  // and the body markup balances in the raw-body tag-stack), but `<engine>` is
  // NOT a STRUCTURAL_RAW_BODY element — its body is parsed as nested block
  // contexts in the main loop, where an after-`>` state-child opener was pushed
  // as a context that never receives a closer (the `: expr` IS the body), so at
  // EOF the unclosed contexts triggered recovery and the WHOLE engine dissolved
  // to text → the misleading E-STRUCTURAL-ELEMENT-MISPLACED on `<engine>` + the
  // bare-variant cascade. This helper, called immediately after a non-self-
  // closing / non-(inside-opener-)shorthand opener's `>`, peeks for the
  // after-`>` ` : ` and, if present, consumes the `: expr` body to end-of-line
  // (the §51.0.I:970 / match-statechild `[^\n]*` single-line convention) so the
  // opener + after-`>` body is captured as one leaf (no context push). The
  // engine-statechild-parser re-parses the captured text and emits the lint.
  // pos is just past the opener `>`. Returns true if an after-`>` body was
  // consumed (caller emits a leaf, no push), false otherwise (caller proceeds).
  function tryConsumeAfterCloseColonShorthand() {
    let peek = pos;
    while (peek < len && (source[peek] === " " || source[peek] === "\t")) peek++;
    if (peek >= len || source[peek] !== ":") return false;
    // Guard against `::` (Phase-3 syntax) — not an after-`>` shorthand introducer.
    if (source[peek + 1] === ":") return false;
    // Consume horizontal whitespace + the `:` + the single-line body. The body
    // runs to the next newline (the single-line after-`>` convention). A markup
    // body (`<p>…</p>`) on the same line is captured verbatim; the engine-state-
    // child / match-statechild parser owns the inner re-parse.
    while (pos < len && source[pos] !== "\n") step();
    return true;
  }

  // R25-Bug-74 (S177) — distinguish a GENUINE `:`-shorthand body (`<span :@thing>`,
  // `<Idle : startGame()>`) from a `:name=` DIRECTIVE attribute (`<column :let={...}>`)
  // that merely tripped the whitespace-preceded-`:` shorthand scanner. Both set
  // `shorthand=true`; only the genuine body is subject to the §4.14:987 closer-
  // presence override (E-CLOSER-001). The directive form is `:` followed (after
  // optional whitespace) by an identifier and then (after optional whitespace) by
  // `=` — i.e. a `name=value` attribute introduced by the leading `:` (mirrors the
  // native tag-frame `:name=` exclusion + emit-each's directive guard). Anything
  // else after the `:` is a single-expression body. `colonOff` is the offset of the
  // `:` within `attrRaw` (the value scanAttributes returned as `shorthandColonAttrOff`).
  function isGenuineShorthandBodyNotDirective(attrRaw, colonOff) {
    if (typeof attrRaw !== "string" || typeof colonOff !== "number" || colonOff < 0) {
      // No reliable colon offset — be conservative; treat as genuine so the
      // closer-presence override still fires (the caller already confirmed a
      // shorthand body was recognized).
      return true;
    }
    // Body text after the `:` introducer, with the trailing `/>` (or `>`) stripped.
    let body = attrRaw.slice(colonOff + 1);
    body = body.replace(/\/?>\s*$/, "");
    // `:name=` directive shape: optional ws, identifier, optional ws, `=`.
    const directive = /^\s*[A-Za-z_][A-Za-z0-9_-]*\s*=/.test(body);
    return !directive;
  }

  // ---------------------------------------------------------------------------
  // Phase A1a Step 11.0d — top-level state-decl signal peek
  //
  // Pre-condition: source[pos] === "<", source[pos+1] is [A-Za-z_], and
  // we are at TRUE top level (stack.length === 0). This non-mutating scan
  // peeks past `<NAME [attrs]>` to determine whether the immediately
  // following non-space (excluding newlines) char is `=` or `:` — the
  // state-decl Shape 1/2/3 signals.
  //
  // SPEC §6.2 — `<count> = 0`, `<userName req length(>=2)> = <input/>`,
  // `<count>: number = 0`. All three forms have `=` or `:` immediately
  // after `>`.
  //
  // Self-closing `<NAME/>` is NOT a state-decl (it's markup leaf).
  // Component-defs (`< userBadge name(string)>`) take the whitespace-state
  // BS branch (line 1088), not this markup branch — untouched here.
  //
  // Tightened post-`>` predicate:
  //   - `=` followed by `=` is comparison — not a decl.
  //   - `=` followed by `>` is arrow — not a decl.
  //   - `:` is always a state-decl typed-form signal at top level
  //     (no ambient JS construct at file top level uses `<NAME>: TYPE`).
  //
  // Returns true iff a state-decl signal is detected. Does NOT modify scanner state.
  // ---------------------------------------------------------------------------

  /** @returns {boolean} */
  function peekTopLevelStateDeclSignal() {
    let p = pos + 1; // past '<'
    // Read identifier
    while (p < len && /[A-Za-z0-9_\-]/.test(source[p])) p++;
    if (p === pos + 1) return false; // no ident
    // Skip attribute content up to '>' — non-mutating mirror of scanAttributes balance logic.
    let braceDepth = 0;
    let parenDepth = 0;
    let inDouble = false;
    let inSingle = false;
    while (p < len) {
      const c = source[p];
      if (braceDepth > 0) {
        if (c === "{") braceDepth++;
        else if (c === "}") braceDepth--;
        p++;
        continue;
      }
      if (parenDepth > 0) {
        if (c === "(") parenDepth++;
        else if (c === ")") parenDepth--;
        p++;
        continue;
      }
      if (!inDouble && !inSingle) {
        // cluster-A (S188) — `g-attr-gte-tagclose`: a `>=` (a `>` immediately
        // followed by `=`) inside an opener is a stray comparison operator
        // (`if=@n >= 3`), never the opener terminator. Skip past it so this
        // peek does not mis-read the `=` of `>=` as a Shape-1 state-decl `=`
        // signal (which would gobble the whole `<p if=@n >= 3>` opener as a
        // text/decl block and surface a misleading E-CTX-001 on `</p>`).
        if (c === ">" && p + 1 < len && source[p + 1] === "=") { p += 2; continue; }
        if (c === ">") { p++; break; }
        if (c === "/" && p + 1 < len && source[p + 1] === ">") return false; // self-closing — not state-decl
        if ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && p + 1 < len && source[p + 1] === "{") {
          braceDepth = 1; p += 2; continue;
        }
        if (c === "{") { braceDepth++; p++; continue; }
        if (c === "(") { parenDepth++; p++; continue; }
        if (c === '"') { inDouble = true; p++; continue; }
        if (c === "'") { inSingle = true; p++; continue; }
      } else if (inDouble && c === '"') { inDouble = false; p++; continue; }
      else if (inSingle && c === "'") { inSingle = false; p++; continue; }
      else if (c === "\\") { p += 2; continue; }
      p++;
    }
    if (p > len) return false; // ran past EOF
    // Skip horizontal whitespace (NOT newlines — newlines separate statements).
    while (p < len && (source[p] === " " || source[p] === "\t")) p++;
    if (p >= len) return false;
    if (source[p] === "=") {
      const nxt = p + 1 < len ? source[p + 1] : "";
      if (nxt === "=" || nxt === ">") return false; // comparison '==' or arrow '=>'
      return true;
    }
    if (source[p] === ":") {
      // Typed-decl signal. ':' is unambiguous at top-level after a tag.
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // S139 Bug 51-C — Shape 1/2 state-decl span end scanner
  //
  // After `peekTopLevelStateDeclSignal` confirms a top-level state-decl, this
  // helper scans the WHOLE decl span — LHS opener + `=`/`:`-RHS — and returns
  // the position just past the end. Caller gobbles `[pos, endPos)` as a single
  // text block (mirroring the compound-decl path at scanCompoundBlockEnd /
  // line 2174-2200).
  //
  // Why this exists: pre-S139, the BS path after the peek did `beginText() +
  // step()` and let char-by-char text accumulation continue. That works for
  // Shape 1 expression-RHS (`<count> = 0` — no `<` in RHS), but BREAKS for
  // Shape 2 markup-RHS (`<userName req length(>=2)> = <input type="text"/>`)
  // — the `<input>` opener triggers the markup-opener path, becoming a
  // sibling block. The LHS-only text gets auto-lifted, parser sees `<userName
  // ... > = ` with no RHS → produces Shape 1 plain cell with no renderSpec →
  // SYM fires E-CELL-NO-RENDER-SPEC on the use-site (Bug 51-C reproducer).
  //
  // Returns -1 if the RHS scan fails (unterminated markup, malformed shape).
  // Caller falls back to existing per-char text accumulation in that case.
  function scanShape12DeclEnd() {
    let p = pos + 1; // past '<'
    // Step 1: skip LHS identifier
    while (p < len && /[A-Za-z0-9_\-]/.test(source[p])) p++;
    if (p === pos + 1) return -1;
    // Step 2: skip attributes up to `>` (mirror peekTopLevelStateDeclSignal)
    let braceDepth = 0;
    let parenDepth = 0;
    let inDouble = false;
    let inSingle = false;
    while (p < len) {
      const c = source[p];
      if (braceDepth > 0) {
        if (c === "{") braceDepth++;
        else if (c === "}") braceDepth--;
        p++;
        continue;
      }
      if (parenDepth > 0) {
        if (c === "(") parenDepth++;
        else if (c === ")") parenDepth--;
        p++;
        continue;
      }
      if (!inDouble && !inSingle) {
        if (c === ">") { p++; break; }
        if (c === "/" && p + 1 < len && source[p + 1] === ">") return -1;
        if ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && p + 1 < len && source[p + 1] === "{") {
          braceDepth = 1; p += 2; continue;
        }
        if (c === "{") { braceDepth++; p++; continue; }
        if (c === "(") { parenDepth++; p++; continue; }
        if (c === '"') { inDouble = true; p++; continue; }
        if (c === "'") { inSingle = true; p++; continue; }
      } else if (inDouble && c === '"') { inDouble = false; p++; continue; }
      else if (inSingle && c === "'") { inSingle = false; p++; continue; }
      else if (c === "\\") { p += 2; continue; }
      p++;
    }
    if (p > len) return -1;
    // Step 3: skip horizontal whitespace (not newlines)
    while (p < len && (source[p] === " " || source[p] === "\t")) p++;
    // Step 4: skip `: TypeAnnotation` if present (typed-decl form)
    if (p < len && source[p] === ":") {
      p++;
      // Skip type expression — bounded by `=` or newline. Conservative: stop
      // on `=` (the RHS sentinel) or `\n` (decl boundary). Type expressions
      // are simple identifier sequences in canonical use; richer forms are
      // bounded by the caller's existing TOPLEVEL_STATE_DECL_RE.
      while (p < len && source[p] !== "=" && source[p] !== "\n") p++;
    }
    if (p >= len) return p;
    if (source[p] !== "=") return -1;
    p++; // consume `=`
    // Step 5: skip whitespace before RHS (allow newlines — Shape 2 RHS may be
    // on the next line under v0.3 default-logic-mode formatting)
    while (p < len && (source[p] === " " || source[p] === "\t")) p++;
    if (p >= len) return p;
    // Step 6: scan RHS
    if (source[p] === "<") {
      // Shape 2 — markup RHS. Scan one balanced markup element.
      p++; // consume `<`
      let d = 1; // tag depth (1 = inside the opening tag's attrs)
      let inDoubleR = false;
      let inSingleR = false;
      while (p < len) {
        const c = source[p];
        if (inDoubleR) {
          if (c === "\\") { p += 2; continue; }
          if (c === '"') inDoubleR = false;
          p++;
          continue;
        }
        if (inSingleR) {
          if (c === "\\") { p += 2; continue; }
          if (c === "'") inSingleR = false;
          p++;
          continue;
        }
        if (c === '"') { inDoubleR = true; p++; continue; }
        if (c === "'") { inSingleR = true; p++; continue; }
        if (c === "/" && p + 1 < len && source[p + 1] === ">") {
          // self-closing — `<input/>` shape
          p += 2;
          d--;
          if (d === 0) return p;
          continue;
        }
        if (c === ">") {
          p++;
          // Note: a tag-opener's `>` does NOT decrement d (we wait for
          // either matching close `</X>` or self-close `/>`). But under our
          // single-element scan, we entered with d=1 already (inside the
          // opener's attrs). The `>` closes the opener's attrs; for non-
          // self-closing, we then need a matching `</X>` to terminate. d
          // is bumped on `<X` and decremented on `</X>` and `/>` only.
          continue;
        }
        if (c === "<") {
          // Look ahead: closer `</...>` or nested opener `<X...>`?
          if (p + 1 < len && source[p + 1] === "/") {
            // closer
            p += 2;
            // Scan to matching `>`, then decrement d
            while (p < len && source[p] !== ">" && source[p] !== "\n") p++;
            if (p >= len || source[p] !== ">") return -1;
            p++;
            d--;
            if (d === 0) return p;
            continue;
          }
          if (p + 1 < len && /[A-Za-z_]/.test(source[p + 1])) {
            // nested opener
            d++;
            p++;
            continue;
          }
          // `<` followed by something else — treat as content
          p++;
          continue;
        }
        p++;
      }
      return -1; // unterminated
    }
    // Expression RHS (Shape 1 or Shape 3 derived).
    //
    // markup-value-in-expression-2026-06-17 (b) — markup-as-value in EXPRESSION
    // position (a ternary arm: `const <badge> = @n > 0 ? <span>p</span> :
    // <span>n</span>`; SPEC §1.4 / §7.4, PRIMER §6.6.17). Pre-fix this branch
    // unconditionally returned -1, ceding to legacy per-char text accumulation —
    // which STOPS at the first `<span` markup-opener and splits the ternary arms
    // into SEPARATE top-level markup blocks. The parser then saw only the text
    // `const <badge> = @n > 0 ?` → the arms were DROPPED → `() => ... > 0 ?)` →
    // E-CODEGEN-INVALID-LOGIC.
    //
    // Fix: scan the full balanced expression; if it CONTAINS a markup element,
    // gobble the whole decl (including the markup arms) as ONE text block so the
    // arms survive to codegen. When the RHS has NO markup, return -1 to preserve
    // the legacy path EXACTLY (multi-line `match @phase { ... }` bodies, etc. —
    // the orphan-brace accumulation already handles those, and end-of-line
    // scanning would truncate them).
    {
      let q = p;
      let bd = 0;     // () [] {} delimiter depth
      let ad = 0;     // markup element nesting depth
      let inD = false, inS = false, inT = false; // " ' ` string state
      let sawMarkup = false;
      while (q < len) {
        const c = source[q];
        if (inD) { if (c === "\\") { q += 2; continue; } if (c === '"') inD = false; q++; continue; }
        if (inS) { if (c === "\\") { q += 2; continue; } if (c === "'") inS = false; q++; continue; }
        if (inT) { if (c === "\\") { q += 2; continue; } if (c === "`") inT = false; q++; continue; }
        if (c === '"') { inD = true; q++; continue; }
        if (c === "'") { inS = true; q++; continue; }
        if (c === "`") { inT = true; q++; continue; }
        if (c === "(" || c === "[" || c === "{") { bd++; q++; continue; }
        if (c === ")" || c === "]" || c === "}") { if (bd > 0) bd--; q++; continue; }
        if (c === "<") {
          // Markup close `</X>` / `</>` — decrement element depth.
          if (source[q + 1] === "/") {
            if (ad > 0) ad--;
            q += 2;
            while (q < len && source[q] !== ">" && source[q] !== "\n") q++;
            if (q < len && source[q] === ">") q++;
            continue;
          }
          // Markup opener `<X ...>` — only when followed by an identifier char
          // (a `<` preceded by a value is the less-than operator; but a markup
          // VALUE element opener is always `<` + letter/underscore). Self-close
          // `<X/>` is balanced inline.
          if (/[A-Za-z_]/.test(source[q + 1] || "")) {
            // markup-value-in-expression-2026-06-17 — DISCRIMINATOR. A markup
            // element is part of the RHS expression VALUE only when it sits in
            // operand position: at the RHS head, or after an operator/opener
            // (`?`, `:`, `(`, `,`, `=`, `&`, `|`, etc.). When the nearest
            // preceding non-ws char is a VALUE-TERMINATOR (alphanumeric / `_` /
            // `)` `]` `}` / quote), the RHS value already COMPLETED and this `<`
            // opens a SEPARATE SIBLING markup element — e.g. `<x> = 1<div>…`,
            // `<x> = null<div>…`, `<x> = true<div class:active=@x>…`. In that
            // case the decl ended before the `<`; cede to the legacy per-char
            // path (return -1) which correctly stops at the markup opener. Only
            // applies at the top level (no open delimiter / element) — markup
            // nested inside `(...)`/another element is always part of the value.
            if (bd === 0 && ad === 0) {
              let b = q - 1;
              while (b >= p && /\s/.test(source[b])) b--;
              const prev = b >= p ? source[b] : "";
              if (prev && /[A-Za-z0-9_)\]}"'`]/.test(prev)) {
                return -1; // sibling markup — RHS value already complete
              }
            }
            sawMarkup = true;
            // Scan the opener to its `>` or `/>`.
            let r = q + 1;
            let rbd = 0, rD = false, rS = false;
            let selfClose = false;
            while (r < len) {
              const rc = source[r];
              if (rD) { if (rc === '"') rD = false; r++; continue; }
              if (rS) { if (rc === "'") rS = false; r++; continue; }
              if (rbd > 0) { if (rc === "{") rbd++; else if (rc === "}") rbd--; r++; continue; }
              if (rc === '"') { rD = true; r++; continue; }
              if (rc === "'") { rS = true; r++; continue; }
              if (rc === "{") { rbd++; r++; continue; }
              if (rc === "/" && source[r + 1] === ">") { selfClose = true; r += 2; break; }
              if (rc === ">") { r++; break; }
              r++;
            }
            if (!selfClose) ad++;
            q = r;
            continue;
          }
          // `<` not opening markup — treat as less-than operator, keep scanning.
          q++;
          continue;
        }
        // A depth-0 newline OUTSIDE any open markup ends the decl. (Markup
        // arms on their own lines stay attached because ad > 0 keeps us in.)
        if (c === "\n" && bd === 0 && ad === 0) break;
        q++;
      }
      // Only divert from the legacy path when the RHS actually carried markup;
      // otherwise the orphan-brace per-char accumulation owns it (unchanged).
      if (sawMarkup && ad === 0 && bd === 0 && q > p) return q;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Bug-3 (S101) — Variant C compound state-decl peek
  //
  // SPEC §6.3.2 (Tier 2 ad-hoc compound): the parent opener `<NAME>` is
  // followed by structural-children declarations and a `</>` (or `</NAME>`)
  // close. Distinct from Shape 1 / Shape 2 (peeked by
  // peekTopLevelStateDeclSignal above) because the post-`>` lookahead is
  // NOT `=`/`:` — it's whitespace (possibly newline) + nested `<child>`.
  //
  // Lookahead pattern:
  //   `<NAME [attrs]>` `\s*` `<` IDENT `[attrs]>` `\s*` (`=` | `:` | `<` ...)
  //
  // The nested `<child>` must itself look like a state-decl (its `>` followed
  // by `=`/`:`) OR itself look like a recursive compound (its `>` followed by
  // whitespace + another `<`). Either way we're in compound territory.
  //
  // Self-closing parent `<NAME/>` is NOT a compound (it's a markup leaf).
  // Anonymous close `</>` immediately after parent's `>` (empty compound)
  // IS allowed — `<formRes></>` is a degenerate but legal compound (no
  // children). Matched by recognising `</` after whitespace.
  //
  // Returns true iff a compound state-decl shape is detected. Does NOT
  // modify scanner state.
  // ---------------------------------------------------------------------------

  /** @returns {boolean} */
  function peekCompoundStateDeclSignal() {
    // Reserved document-root tags (program / page / channel / schema /
    // seeds / module) are container roots, not state-decl shapes, even
    // when their body contains nested state-decls. Bail early so the parent
    // is not misclassified as a compound.
    let p = pos + 1;
    let nameEnd = p;
    while (nameEnd < len && /[A-Za-z0-9_\-]/.test(source[nameEnd])) nameEnd++;
    if (nameEnd === p) return false;
    const tagName = source.slice(p, nameEnd);
    if (COMPOUND_LIFT_EXEMPT_TAGS.has(tagName)) return false;

    // Use the classifier to determine whether the parent at `pos` looks like
    // a compound state-decl opener. The classifier inspects the nested child
    // (if any) and only returns "compound" when the child itself is a
    // state-decl-shaped opener (`<x> = …` / `<x>: T = …`) OR another
    // recursive compound. Ordinary markup parents
    // (`<keyboard id="x"/>` + `<mouse id="x"/>` siblings) and prose-bearing
    // parents (`<div>hello<span/></div>`) are classified as "markup" and
    // return false here.
    const cls = classifyOpenerForCompoundScan(pos);
    return cls != null && cls.kind === "compound";
  }

  // ---------------------------------------------------------------------------
  // Bug-3 (S101) — Variant C compound: scan forward to find the matching
  // `</>` / `</NAME>` close. Counts nested `<NAME>...</>` pairs so that
  // recursive compound is accumulated as a single text run.
  //
  // Pre-condition: source[pos] === '<', source[pos+1] is a markup ident,
  // and peekCompoundStateDeclSignal() returned true.
  //
  // Returns the byte offset of the position JUST AFTER the matching close
  // tag, or -1 if the compound is unclosed (in which case the caller should
  // fall back to the default markup-opener path so existing E-CTX-003
  // diagnostics fire correctly).
  //
  // The scan is permissive — it walks through nested `<ident ...>` openers
  // and matching closers, tracking depth. Sigil-prefixed brace contexts
  // (`${...}`, `?{...}`, etc.) are NOT entered because the compound body
  // is structural-state-decls only; if such tokens appear they're either
  // RHS init exprs (handled at parse-time by tryParseStructuralDecl, which
  // re-tokenizes the wrapped logic body) or content of a Shape 2 markup
  // RHS (also re-tokenized). Both cases are fine to accumulate as text.
  // ---------------------------------------------------------------------------

  /**
   * issue #28 — disambiguate a leading-`=` markup body from a `<name> = RHS`
   * state-decl. Returns true iff a matching `</tagName>` close tag appears
   * at-or-after `fromPos` (just past an opener's `>`) — meaning the opener is a
   * MARKUP element (`<span>= hi</span>`), NOT a state-decl whose RHS merely
   * begins with `=` (a state-decl child has no `</name>` close).
   *
   * The scanned region is MARKUP BODY TEXT — free-text (§4.18.1), where `'` and
   * `"` are LITERAL characters, not string delimiters. It MUST NOT track string
   * state: doing so mis-reads an apostrophe / inch-mark in ordinary prose
   * (`= don't`, `= 5" wide`) as opening a phantom string that swallows the real
   * `</name>` close — re-triggering the exact E-CTX-001/E-CTX-003 cascade this
   * fix removes (adversarial-review CONFIRMED-1). Only `//` / block comments
   * (universal, §27.1) are skipped.
   *
   * Performance: the `</tagName>` positions are indexed once per compile
   * (`closeTagIndex`, built lazily) and answered by binary search, so a run of
   * closeless `<x>=…` children cannot blow the scan up to O(N^2).
   */
  function openerHasMatchingCloseTag(tagName, fromPos) {
    const positions = getCloseTagPositions(tagName);
    if (positions.length === 0) return false;
    // Smallest recorded `</tagName>` position >= fromPos (binary search).
    let lo = 0, hi = positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (positions[mid] >= fromPos) hi = mid; else lo = mid + 1;
    }
    return lo < positions.length;
  }

  // issue #28 (perf) — lazily built index: tag name -> sorted array of the
  // source offsets at which a `</tagName>` close tag begins. Built by ONE linear
  // pass over the source that skips `//` line and `/* */` block comments (a
  // `</name>` inside a comment is not a real close) but does NOT track string
  // state (the disambiguation target is markup body text where quotes are
  // literal — see openerHasMatchingCloseTag). Amortizes the close-tag lookup to
  // O(log k) per query instead of an O(N) forward scan.
  let closeTagIndex = null;
  function getCloseTagPositions(tagName) {
    if (closeTagIndex === null) {
      closeTagIndex = new Map();
      let i = 0;
      while (i < len) {
        const c = source[i];
        if (c === "/" && source[i + 1] === "/") {
          if (urlSlashesAt(source, i)) { i += 2; continue; }
          i = skipLineComment(source, i);
          continue;
        }
        if (c === "/" && source[i + 1] === "*") { i = skipBlockComment(source, i); continue; }
        if (c === "<" && source[i + 1] === "/") {
          const start = i;
          let j = i + 2;
          const nameStart = j;
          while (j < len && /[A-Za-z0-9_\-]/.test(source[j])) j++;
          const name = source.slice(nameStart, j);
          if (name.length > 0) {
            let arr = closeTagIndex.get(name);
            if (!arr) { arr = []; closeTagIndex.set(name, arr); }
            arr.push(start);
          }
          i = j;
          continue;
        }
        i++;
      }
    }
    return closeTagIndex.get(tagName) || [];
  }

  /**
   * Helper for scanCompoundBlockEnd — classify a `<ident...>` opener at
   * offset `p` as one of:
   *   - "state-decl": followed by `=` or `:` after `>` (no close tag needed)
   *   - "compound":   followed by whitespace + `<` (recursive compound; needs close)
   *   - "markup":     ordinary markup opener (close tag needed)
   *   - "self-close": `<NAME/>` (no close needed)
   *
   * Also returns the byte offset of the position JUST AFTER the opener's
   * terminating `>` (or `/>`).
   *
   * @param {number} p — must point at `<` followed by an ident
   * @returns {{ kind: "state-decl"|"compound"|"markup"|"self-close", afterOpener: number } | null}
   */
  function classifyOpenerForCompoundScan(p) {
    if (source[p] !== "<") return null;
    let q = p + 1;
    if (q >= len) return null;
    if (!/[A-Za-z_]/.test(source[q])) return null;
    const nameStartC = q;
    while (q < len && /[A-Za-z0-9_\-]/.test(source[q])) q++;
    const cTagName = source.slice(nameStartC, q);
    // Attr scan with balanced quotes / braces / parens — mirrors
    // peekTopLevelStateDeclSignal's pattern.
    let braceDepth = 0;
    let parenDepth = 0;
    let qDouble = false;
    let qSingle = false;
    let selfClosing = false;
    while (q < len) {
      const c2 = source[q];
      if (braceDepth > 0) {
        if (c2 === "{") braceDepth++;
        else if (c2 === "}") braceDepth--;
        q++;
        continue;
      }
      if (parenDepth > 0) {
        if (c2 === "(") parenDepth++;
        else if (c2 === ")") parenDepth--;
        q++;
        continue;
      }
      if (!qDouble && !qSingle) {
        if (c2 === ">") { q++; break; }
        if (c2 === "/" && q + 1 < len && source[q + 1] === ">") {
          selfClosing = true;
          q += 2;
          break;
        }
        if ((c2 === "$" || c2 === "?" || c2 === "#" || c2 === "!" || c2 === "^" || c2 === "~") && q + 1 < len && source[q + 1] === "{") {
          braceDepth = 1; q += 2; continue;
        }
        if (c2 === "{") { braceDepth++; q++; continue; }
        if (c2 === "(") { parenDepth++; q++; continue; }
        if (c2 === '"') { qDouble = true; q++; continue; }
        if (c2 === "'") { qSingle = true; q++; continue; }
      } else if (qDouble && c2 === '"') { qDouble = false; q++; continue; }
      else if (qSingle && c2 === "'") { qSingle = false; q++; continue; }
      else if (c2 === "\\") { q += 2; continue; }
      q++;
    }
    if (q > len) return null;
    if (selfClosing) {
      return { kind: "self-close", afterOpener: q };
    }
    // Inspect what follows `>`.
    let r = q;
    while (r < len && (source[r] === " " || source[r] === "\t")) r++;
    if (r < len) {
      if (source[r] === "=") {
        const nxt = r + 1 < len ? source[r + 1] : "";
        // issue #28 — a `<name>` whose element body BEGINS with `=`
        // (`<span>= hi</span>`, `<td>=SUM(A1:A9)</td>`) is MARKUP with a
        // leading-`=` text body, NOT a `<name> = RHS` state-decl child. The two
        // shapes are locally indistinguishable (both are `>` then `=` then a
        // char), so disambiguate structurally: a state-decl child has NO
        // matching close tag, whereas markup does. Without this the parent
        // (`<div>`/`<tr>`) is misread as a compound state-decl, the subtree is
        // gobbled + auto-lifted (→ a phantom `@div` reactive var → E-DG-002),
        // and the tag stack corrupts into an E-CTX-001 cascade.
        if (nxt !== "=" && nxt !== ">" && !openerHasMatchingCloseTag(cTagName, q)) {
          return { kind: "state-decl", afterOpener: q };
        }
      } else if (source[r] === ":") {
        return { kind: "state-decl", afterOpener: q };
      }
    }
    // Try the compound classification: post-`>` newline + ident.
    // EMPTY body (`<NAME></>` — immediate close after the opener) is
    // ambiguous between empty compound state and empty markup element; the
    // safe default is "markup" so existing markup behaviour is preserved.
    // A user wanting an empty compound state-decl can wrap in `${...}`.
    //
    // R28-BUG-3 (S143): skip whitespace AND `//`/`/* */` comment trivia (SPEC
    // §27.1 — `//` is universal, valid in ALL contexts) so a comment line
    // between the parent opener and the first `<child>` does not derail the
    // compound-vs-markup classification. Pre-fix this skipped only whitespace,
    // so a leading `//` comment made the scanner see `/` instead of `<`, mis-
    // classify the parent as ordinary markup, and push it as a never-closing
    // context (W-PROGRAM-001 + E-CTX-001/E-CTX-003 on `:`-shorthand engines).
    let s = skipTriviaForCompoundScan(source, len, q);
    if (s < len && source[s] === "<") {
      const nx = s + 1 < len ? source[s + 1] : "";
      if (/[A-Za-z_]/.test(nx)) {
        // Disambiguate by classifying the NESTED opener — if it's
        // state-decl-shaped or recursive-compound-shaped, the outer is a
        // compound. Otherwise it's ordinary markup.
        const nested = classifyOpenerForCompoundScan(s);
        if (nested && (nested.kind === "state-decl" || nested.kind === "compound")) {
          return { kind: "compound", afterOpener: q };
        }
        // Self-close child or markup child — outer is markup.
      }
      // `<` followed by `/` (immediate close) — empty body, default to markup.
    }
    return { kind: "markup", afterOpener: q };
  }

  /**
   * Bug-3 (S101) — Variant C compound: scan forward to find the matching
   * `</>` / `</NAME>` close. Properly handles compound children
   * (`<NAME> = init` form — no close tag needed) vs nested-compound /
   * markup-RHS sub-structures (which DO need balanced closes).
   *
   * Pre-condition: source[pos] === '<', source[pos+1] is a markup ident,
   * and peekCompoundStateDeclSignal() returned true.
   *
   * @returns {number} byte offset just past close tag, or -1 if unclosed
   */
  function scanCompoundBlockEnd() {
    // Step 1: skip past the parent compound's opener (the `<NAME>` at pos).
    const cls = classifyOpenerForCompoundScan(pos);
    if (!cls || cls.kind === "self-close") return -1;
    let p = cls.afterOpener;
    let depth = 1; // we're now inside the parent compound

    // issue #28 (adversarial-review CONFIRMED-1) — this scan walks the compound
    // body, which INCLUDES markup-child bodies (free-text per §4.18.1) where `'`
    // and `"` are LITERAL characters, not string delimiters. It MUST NOT track
    // string state: an odd apostrophe / inch-mark in a markup child's prose
    // (`<note>= don't</note>`, `<cell>= 5" wide</cell>`) would otherwise open a
    // phantom string that swallows the real `</name>` closer, mis-balance the
    // depth count, and re-trigger the E-CTX-001/E-CTX-003 cascade this fix
    // removes. (A `</name>`/`<tag>` embedded in a genuine state-decl RHS *string*
    // is the same rare, contrived tradeoff accepted for openerHasMatchingCloseTag.)
    while (p < len && depth > 0) {
      const c = source[p];
      // R28-BUG-3 (S143): skip `//` line / `/* */` block comments (SPEC §27.1)
      // so a comment body containing `<` chars cannot derail the depth count of
      // the compound-span scan.
      // url-in-comment (2026-07): a `//` that is part of a URL VALUE (`://`
      // scheme or CSS `url(...)`) in this compound body is DATA, not a comment;
      // skipping it would eat a `</>` / `</NAME>` closer and corrupt the span.
      if (c === "/" && source[p + 1] === "/") {
        if (urlSlashesAt(source, p)) { p += 2; continue; }
        p = skipLineComment(source, p);
        continue;
      }
      if (c === "/" && source[p + 1] === "*") { p = skipBlockComment(source, p); continue; }
      if (c === "<") {
        const next = p + 1 < len ? source[p + 1] : "";
        if (next === "/") {
          // Close tag — `</>` or `</NAME>`. Advance past `>`.
          let q = p + 2;
          while (q < len && source[q] !== ">" && source[q] !== "\n") q++;
          if (q >= len) return -1;
          if (source[q] !== ">") return -1;
          q++;
          depth--;
          if (depth === 0) return q;
          p = q;
          continue;
        }
        if (/[A-Za-z_]/.test(next)) {
          const inner = classifyOpenerForCompoundScan(p);
          if (!inner) {
            // Malformed — fall through as content.
            p++;
            continue;
          }
          // State-decl shape (`<x> = …` / `<x>: T = …`) — the child has NO
          // matching close tag. The RHS init expression continues until the
          // next sibling decl opener / parent close — which we'll naturally
          // encounter as the loop continues. No depth change.
          if (inner.kind === "state-decl" || inner.kind === "self-close") {
            p = inner.afterOpener;
            continue;
          }
          // Compound or ordinary markup — requires a matching close.
          // Increment depth and continue past the opener.
          depth++;
          p = inner.afterOpener;
          continue;
        }
        // `<` followed by something else (`<=`, `<<`). Treat as content.
        p++;
        continue;
      }
      p++;
    }
    return depth === 0 ? p : -1;
  }

  // ---------------------------------------------------------------------------
  // Context stack operations
  // ---------------------------------------------------------------------------

  /** Push a brace-delimited context frame. The opener has already been consumed. */
  function pushBraceContext(type, openPos, openLine, openCol) {
    // Inherit tagNesting from the parent brace-context frame (if any).
    // This tracks how many markup tags are open around this point in the
    // enclosing logic context, so child blocks (BLOCK_REF) can carry the count.
    const parentFrame = topFrame();
    const inheritedTagNesting = (parentFrame && parentFrame.tagNesting != null)
      ? parentFrame.tagNesting : 0;
    stack.push({
      type,
      name: null,
      isComponent: false,
      depth: stack.length,  // depth = stack length BEFORE push
      startPos: openPos,
      startLine: openLine,
      startCol: openCol,
      children: [],
      braceDepth: 1,
      tagNesting: inheritedTagNesting,
      // Local string tracking for tag nesting disambiguation (private state)
      _inDouble: false,
      _inSingle: false,
      _inBacktick: false,
    });
  }

  /**
   * Match a foreign-code opener `_` + zero-or-more `=` + `{` at position `p`
   * (SPEC §23.2: "`_` followed by zero or more `=` followed by `{`"). Returns
   * the level (count of `=`) on a match, or -1 on no match. The `_` must NOT be
   * the tail of a longer JS identifier (so `foo_{` / `a_={` never match) — the
   * preceding char must be a non-identifier char (or start-of-input). This is
   * the load-bearing guard that keeps `_ = {` (the spaced assignment) and an
   * ordinary `_underscoreVar` from being misread as a foreign opener: `_ = {`
   * has a SPACE after `_` so it fails the `=`*`{` shape, and an identifier like
   * `my_` has an identifier char before `_`.
   */
  function matchForeignOpener(p) {
    if (source[p] !== "_") return -1;
    const prev = p > 0 ? source[p - 1] : "";
    // `_` preceded by an identifier char is a mid-identifier underscore, not an
    // opener (e.g. `my_var`, `__proto__`). Allow start-of-input, whitespace,
    // and punctuation (`=`, `(`, `,`, `{`, etc.) before the `_`.
    if (prev && /[A-Za-z0-9_$]/.test(prev)) return -1;
    let q = p + 1;
    let level = 0;
    while (source[q] === "=") { level++; q++; }
    if (source[q] !== "{") return -1;
    return level;
  }

  /**
   * Push a foreign-code (`_={ … }=`) brace context (SPEC §23.2, dpa-003 S216).
   * `level` is the count of `=` markers in the opener (`_{`=0, `_={`=1, …),
   * stored as `foreignLevel` so the main-loop opaque scanner closes only on a
   * `}` followed by EXACTLY `level` `=` characters. `openPos` is the position
   * of the leading `_` so the captured raw slice includes the full opener.
   */
  function pushForeignContext(level, openPos, openLine, openCol) {
    const parentFrame = topFrame();
    const inheritedTagNesting = (parentFrame && parentFrame.tagNesting != null)
      ? parentFrame.tagNesting : 0;
    stack.push({
      type: "foreign",
      name: null,
      depth: stack.length,
      startPos: openPos,
      startLine: openLine,
      startCol: openCol,
      children: [],
      braceDepth: 1,
      foreignLevel: level,
      tagNesting: inheritedTagNesting,
      _inDouble: false,
      _inSingle: false,
      _inBacktick: false,
    });
  }

  /**
   * Push a markup/state context frame. The tag opener (through '>') has been consumed.
   *
   * `openerHadSpaceAfterLt` (P1, SPEC §4.3 / §15.15.5): records whether the opener
   * used whitespace between `<` and the identifier. Per the state-as-primary
   * unification this is informational only — it drives W-WHITESPACE-001
   * diagnostics from NR. The tag/state classification is not gated on this flag
   * by downstream stages in P1.
   */
  function pushTagContext(type, name, openPos, openLine, openCol, openerHadSpaceAfterLt = false) {
    stack.push({
      type,
      name,
      isComponent: isComponentName(name),
      depth: stack.length,
      startPos: openPos,
      startLine: openLine,
      startCol: openCol,
      children: [],
      braceDepth: 0,
      openerHadSpaceAfterLt,
    });
  }

  /**
   * Pop the top brace-delimited frame and emit it as a block into the new target.
   * Caller must call flushText() before this.
   * pos should be just past the closing '}'.
   */
  function popBraceContext() {
    const frame = stack.pop();
    const block = {
      type: frame.type,
      raw: source.slice(frame.startPos, pos),
      span: { start: frame.startPos, end: pos, line: frame.startLine, col: frame.startCol },
      depth: frame.depth,
      children: frame.children,
      name: null,
      closerForm: null,
      isComponent: false,
    };
    // Propagate tagNesting from the parent frame at the time this child was
    // created.  The tokenizer makes this available as tok.block.tagNesting so
    // the AST builder can decide whether a BLOCK_REF is a statement boundary.
    if (frame.tagNesting > 0) {
      block.tagNesting = frame.tagNesting;
    }
    // dpa-003 (S216) — carry the foreign opener level (`_{`=0, `_={`=1, …) so
    // buildBlock's `case "foreign"` slices the right opener/closer width and
    // emit-logic emits a level-correct ForeignBlock.
    if (frame.type === "foreign") {
      block.foreignLevel = frame.foreignLevel || 0;
    }
    targetChildren().push(block);
  }

  /**
   * Pop the top markup/state frame and emit it as a block.
   * flushText() must have been called for the frame's children already.
   * pos should be just past the closer.
   * @param {'inferred'|'explicit'} closerForm
   */
  function popTagContext(closerForm) {
    const frame = stack.pop();
    targetChildren().push({
      type: frame.type,
      raw: source.slice(frame.startPos, pos),
      span: { start: frame.startPos, end: pos, line: frame.startLine, col: frame.startCol },
      depth: frame.depth,
      children: frame.children,
      name: frame.name,
      closerForm,
      isComponent: frame.isComponent ?? false,
      openerHadSpaceAfterLt: frame.openerHadSpaceAfterLt === true,
    });
  }

  // ---------------------------------------------------------------------------
  // Main scan loop
  // ---------------------------------------------------------------------------

  while (pos < len) {
    const curPos = pos;
    const curLine = line;
    const curCol = col;
    const c = source[pos];

    // -----------------------------------------------------------------------
    // Section 4.7: '//' comment suppression (applies at most context levels)
    //
    // S94 BS-batch v2 (Shape #19 / #20) — `//` comment extraction must NOT
    // fire inside an orphan-brace body (function-body or type-decl body at
    // markup direct-child level). Inside such a body, the text is the
    // ENTIRE function body destined for BARE_DECL_RE auto-lift; if BS
    // extracts comments as separate `comment` blocks, the lift sees only
    // the FIRST text fragment (everything up to the first comment) and the
    // rest of the body — including the closing `}` — leaks into the parent
    // markup as orphan siblings. Downstream this surfaces as E-PARSE-001
    // on the dangling `}` and E-SCOPE-001 on body-local identifiers.
    //
    // Inside an orphan-brace body, `//` is content text. The body's eventual
    // re-tokenization via tokenizeLogic's own `readLineComment` (after
    // BARE_DECL_RE wraps the body in `${...}` and parseLogicBody runs)
    // handles JS-style line comments correctly. So pulling the comment out
    // at BS level only hurts; pulling it out only inside non-orphan-brace
    // contexts is the canonical behaviour.
    //
    // At brace-delimited contexts (`${...}` / `?{...}` / etc.), this gate
    // does NOT apply — the comment IS pulled out as a separate `comment`
    // BS child (and tokenizeLogic still re-handles `//` inside the bodyRaw
    // content, so the duplication is benign). The orphan-brace case is
    // distinct because the lift pass expects ONE TEXT BLOCK.
    // -----------------------------------------------------------------------
    if (c === "/" && ch(1) === "/" && !inDoubleQuote && !inSingleQuote && !(orphanBraceDepth > 0 && !topIsBraceContext())) {
      // S144 Bug X (6nz, HIGH): inside a brace-delimited context, a `//` that
      // falls INSIDE a `"..."` / `'...'` string literal on the current line is
      // string CONTENT, not a line comment. Pre-S144 it was mis-read as a
      // comment, eating the rest of the line — incl. a trailing object-literal
      // `}` — and unwinding brace/context depth → spurious E-CTX-003 'Unclosed
      // logic/program' (e.g. the `//` in `"https://example.com"`). The
      // top-level inDoubleQuote/inSingleQuote flags are dead (S109/Bug 2 retired
      // markup-text string tracking), so we use a line-scoped, regex-safe check
      // (openStringQuoteAt) rather than full string-state tracking. When inside
      // a string we consume up to the matching close quote as raw content and
      // resume normal scanning — the `}` after the string is then seen normally.
      if (topIsBraceContext()) {
        const openQ = openStringQuoteAt(source, curPos);
        if (openQ) {
          beginText();
          step(); step(); // consume the `//` as string content
          while (pos < len) {
            const sc = source[pos];
            if (sc === "\\" && pos + 1 < len) { step(); step(); continue; }
            if (sc === openQ) { step(); break; } // consume the closing quote
            if (sc === "\n") break; // unterminated on this line — stop, recover
            step();
          }
          continue;
        }
      }
      // url-in-comment (2026-07): a `//` that is part of a URL VALUE is DATA,
      // not a comment — see urlSlashesAt. This applies in CSS (`#{}`, a brace
      // context) and markup-text (non-brace) only; logic/SQL/meta/etc. keep
      // JS/SQL `//` comment semantics (their URLs are quoted strings, handled
      // by the openStringQuoteAt branch above). SPEC §27 keeps `//` a universal
      // comment; this narrow carve-out only exempts genuine URLs so a bare
      // `url(http://x)` / `Visit http://x` no longer swallows the line's closer.
      const _urlTopFrame = topFrame();
      const _urlExemptCtx =
        !topIsBraceContext() ||
        (_urlTopFrame !== null && _urlTopFrame.type === "css");
      if (_urlExemptCtx && urlSlashesAt(source, curPos)) {
        beginText();
        step(); step(); // consume the `//` as raw content, resume scanning
        continue;
      }
      flushText();
      const commentStart = curPos;
      const commentStartLine = curLine;
      const commentStartCol = curCol;
      advance(2); // consume //
      // Scan to end of line
      while (pos < len && source[pos] !== "\n") step();
      if (pos < len) step(); // consume the newline
      targetChildren().push({
        type: "comment",
        raw: source.slice(commentStart, pos),
        span: { start: commentStart, end: pos, line: commentStartLine, col: commentStartCol },
        depth: depth(),
        children: [],
        name: null,
        closerForm: null,
        isComponent: false,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // Section 27.1: '/* ... */' block-comment suppression INSIDE brace contexts.
    //
    // jwt-auth-bypass (2026-07-11, HIGH) — inside a brace-delimited context
    // (`${...}` logic, `?{}` SQL, `#{}` CSS, `!{}`, `^{}`, `~{}` test), a
    // `/* ... */` block comment (e.g. a JSDoc `/** @returns Promise<string> */`)
    // is a CODE comment (SPEC §27.1 — `//` + `/* */` are universal). Pre-fix the
    // main loop skipped `//` line comments (above) but NOT `/* */`, so the
    // comment BODY was scanned char-by-char: a `<string>` / `Promise<T>` inside
    // it was mis-read as a markup tag-opener → `frame.tagNesting++` that never
    // decrements → the leaked tagNesting propagated onto every subsequent
    // error-effect (`!{...}`) child BLOCK_REF (line ~2245). collectExpr's
    // statement-boundary break (ast-builder.js, `tok.block?.tagNesting === 0`
    // guard) was then BYPASSED, so a failable handler `call() !{ … }` was
    // ABSORBED into the preceding expression — the "statement boundary not
    // detected" drop that silently discarded the rest of jwt.scrml's exports
    // (`signJwt`/`verifyJwt`/…), classifying the async fns as SYNC downstream →
    // an unawaited-Promise auth bypass (same class as issue #26). A `!{}` /
    // `${}` literally written inside the comment prose likewise spawned a
    // spurious child block. Skipping the whole `/* … */` as a `comment` block
    // (parallel to the `//` handler above) makes the comment interior inert, so
    // the block STRUCTURE (children + tagNesting) is correct; tokenizeLogic's
    // own `readBlockComment` still re-handles the comment text in `bodyRaw`
    // (benign duplication, same as the `//` case).
    //
    // Scope: brace contexts ONLY (`topIsBraceContext()`) — the confirmed locus.
    // markup-text `/* */` is NOT a comment (that is `<!-- -->`) and is left
    // untouched. The `openStringQuoteAt` guard mirrors the `//` handler: a `/*`
    // inside a `"..."` / `'...'` / `` `…` `` string literal on the current line
    // is string content, not a comment opener.
    //
    // jwt-auth-bypass followup (2026-07-11, HIGH — adversarial S239 catch) — the
    // block-splitter has NO regex-awareness, so a `/*` INSIDE a regex literal
    // (`/\/*$/`, `/[/*]/g`) or a MULTI-LINE / interpolated backtick template is
    // not a comment. Two safeguards below prevent the "phantom comment eats to
    // EOF → whole-file E-CTX-003" regression:
    //   (a) the `openStringQuoteAt` backtick tracking (single-line templates), and
    //   (b) a CONTAINMENT pre-scan: a real comment's `*/` closer SHALL appear
    //       before the enclosing brace context's own closing `}`. We pre-scan
    //       (non-destructively) for `*/`, tracking relative brace depth; if a `}`
    //       that closes THIS context (relDepth 0) — or EOF — is reached before
    //       `*/`, the `/*` was NOT a comment (it is regex / template content), so
    //       we BAIL: emit the `/` as ordinary text and let normal brace-context
    //       scanning consume the rest. This turns a whole-file failure into, at
    //       worst, a local no-op (a real comment carrying an unbalanced `}` in
    //       prose reverts to pre-fix, tokenizeLogic-handled behavior).
    // -----------------------------------------------------------------------
    if (c === "/" && ch(1) === "*" && topIsBraceContext()) {
      const openQ = openStringQuoteAt(source, curPos);
      if (openQ) {
        // `/*` sits inside a string literal on this line — consume as string
        // content up to the closing quote (mirrors the `//` string branch).
        beginText();
        step(); step(); // consume the `/*` as string content
        while (pos < len) {
          const sc = source[pos];
          if (sc === "\\" && pos + 1 < len) { step(); step(); continue; }
          if (sc === openQ) { step(); break; } // consume the closing quote
          if (sc === "\n") break; // unterminated on this line — stop, recover
          step();
        }
        continue;
      }
      // Containment pre-scan (non-destructive): is there a `*/` before this
      // brace context's closing `}` (or EOF)? Pure brace-depth — a `}` at
      // relDepth 0 is the context closer.
      let commentContained = false;
      {
        let j = curPos + 2; // past `/*`
        let relDepth = 0;
        while (j < len) {
          const cj = source[j];
          if (cj === "*" && source[j + 1] === "/") { commentContained = true; break; }
          if (cj === "{") { relDepth++; j++; continue; }
          if (cj === "}") {
            if (relDepth === 0) break; // context closer reached before `*/` — NOT a comment
            relDepth--; j++; continue;
          }
          j++;
        }
      }
      if (!commentContained) {
        // Not a real comment (regex `/*` / multi-line-or-interpolated template
        // `/*`). Emit the `/` as ordinary text and resume normal scanning; the
        // brace-context branch consumes the rest with correct depth tracking.
        beginText();
        step();
        continue;
      }
      flushText();
      const commentStart = curPos;
      const commentStartLine = curLine;
      const commentStartCol = curCol;
      advance(2); // consume '/*'
      // Scan to the closing '*/' (step() maintains line/col across newlines).
      // The pre-scan above guarantees a `*/` exists before the context boundary.
      while (pos < len) {
        if (source[pos] === "*" && ch(1) === "/") {
          advance(2); // consume '*/'
          break;
        }
        step();
      }
      targetChildren().push({
        type: "comment",
        raw: source.slice(commentStart, pos),
        span: { start: commentStart, end: pos, line: commentStartLine, col: commentStartCol },
        depth: depth(),
        children: [],
        name: null,
        closerForm: null,
        isComponent: false,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // Section 27.2: '<!-- ... -->' HTML markup-comment suppression.
    //
    // SPEC §27.2 lists `<!-- -->` as the markup-context native comment.
    // Without BS-level suppression, structural tag text inside an HTML
    // comment (e.g. `<!-- <program> -->`, `<!-- <channel name="foo"> -->`)
    // would be parsed as a real opener/closer at lines 1064+, corrupting
    // the block stream. The bug is otherwise unrecoverable downstream
    // because BS-emitted block frames are already wrong.
    //
    // Suppression scope: applies only at non-brace-delimited contexts
    // (i.e., markup/state/root) — inside `${...}`, `?{...}`, `#{...}`, etc.
    // the sequence `<!--` is not a comment and falls through as text.
    // Quote tracking honored to avoid eating `"<!--"` as a comment.
    //
    // S87 v0.3 BS-comment-skip dispatch — closes a Wave-3 fixture-sweep
    // architectural OQ. SPEC §4.7 amendment proposed to PA: drop the
    // "SHALL NOT handle <!-- -->" exclusion; replace with "SHALL skip
    // <!-- ... --> at markup/state/root context, mirroring //".
    // -----------------------------------------------------------------------
    if (
      c === "<" &&
      ch(1) === "!" &&
      ch(2) === "-" &&
      ch(3) === "-" &&
      !inDoubleQuote &&
      !inSingleQuote &&
      !topIsBraceContext()
    ) {
      flushText();
      const commentStart = curPos;
      const commentStartLine = curLine;
      const commentStartCol = curCol;
      advance(4); // consume '<!--'
      // Scan to closing '-->' (or EOF). Nested HTML comments are not a
      // thing per the HTML spec; first '-->' closes.
      while (pos < len) {
        if (source[pos] === "-" && ch(1) === "-" && ch(2) === ">") {
          advance(3); // consume '-->'
          break;
        }
        step();
      }
      // (If we hit EOF without seeing '-->', the comment runs to EOF —
      //  no error emitted; downstream stages will surface unclosed-marker
      //  problems if the user truly forgot the closer. This matches how
      //  unclosed `//` lines are handled — best-effort recovery.)
      targetChildren().push({
        type: "comment",
        raw: source.slice(commentStart, pos),
        span: { start: commentStart, end: pos, line: commentStartLine, col: commentStartCol },
        depth: depth(),
        children: [],
        name: null,
        closerForm: null,
        isComponent: false,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // Quote state tracking RETIRED in markup-text mode (Bug 2 C-narrow, S109).
    //
    // Pre-S109 behavior: at markup/state level (outside braces), a stray `'`
    // or `"` toggled a global "in-string" mode and the rest of the file was
    // consumed as raw content until the matching quote appeared. This was
    // intended to protect the bare-`/` closer heuristic from misfiring inside
    // paired-quote strings in markup-text (e.g., `<p>"text /<tag>" more</p>`).
    //
    // The protection was **net-negative**:
    //   - common bug class: unpaired quote in markup-text prose
    //     (`<code>X</code>'s` / `text 'with apostrophe` / typo'd `"`)
    //     ate the rest of the file → silent cascade of unclosed-element
    //     errors with a wrong line number. The dogfood Bug 2 report was the
    //     surfacing — adopter wrote scrml-about-scrml prose with possessive
    //     apostrophe-s and compile blew up.
    //   - rare protected class: paired-quote string containing `/<X` in
    //     markup-text body. Author can entity-escape (`&#47;` / `&lt;`) if
    //     this ever happens in real prose.
    //
    // Locus argument (mirrors Bug 4 C-narrow at SPEC §4.17, S108): strings
    // live in **Logic context** (inside braces) and in **attribute values**
    // (handled by scanAttributes() with LOCAL state). Markup-text body is
    // text — no string concept. Tracking string state at the markup-state
    // level was an over-reach.
    //
    // The bare-`/` closer recognizer at line ~1973 already requires next
    // non-whitespace == `<` or EOF (looksLikeCloser) — plain `/` in text
    // doesn't fire it. The string-mode protection was only load-bearing for
    // the very narrow `quote-/<X-quote` shape; that shape is now a
    // documented edge case with an entity-escape workaround.
    //
    // The inDoubleQuote / inSingleQuote variables remain declared (line ~214)
    // and reset at tag-context boundaries (~1706, ~1736, ~1899, ~1933,
    // ~1962). Those resets are now defensive no-ops in markup-text. The
    // `//` comment scanner (line ~969) and `<!--` HTML comment scanner
    // (line ~1011) gate on `!inDoubleQuote && !inSingleQuote` — those gates
    // are trivially true now in markup-text (which is the right behavior:
    // `//` and `<!--` are well-defined comment markers regardless of nearby
    // text-level apostrophes).
    //
    // Deep-dive cross-ref: `scrml-support/docs/deep-dives/bug-4-docs-mode-escape-2026-05-19.md`
    // §"Broad C extension" + Q-BUG4-OPEN-5 (this is the sibling locus violation
    // closed at S109).
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Brace-delimited context handling
    // -----------------------------------------------------------------------
    if (topIsBraceContext()) {
      const frame = topFrame();

      // -----------------------------------------------------------------------
      // Foreign-code (`_={ … }=`) OPAQUE scan (SPEC §23.2 / §23.2.3).
      //
      // dpa-003 (S216) — inline value-returning `_{}` in a logic context. The
      // interior of a `_{}` block is OPAQUE (§23.2.3 "TAB does NOT tokenize
      // interior"; the compiler SHALL NOT parse/tokenize/type-check it). So we
      // do NOT run the generic `{`/`}` brace-depth tracking or any sigil
      // detection inside a foreign frame — a `{` inside a foreign string
      // literal or comment must not affect the close. The ONLY thing that
      // closes a foreign block is the LEVEL-AWARE closer: a `}` followed by
      // EXACTLY `frame.foreignLevel` `=` characters (§23.2 normative). The
      // verbatim raw slice is captured by popBraceContext's source.slice.
      // -----------------------------------------------------------------------
      if (frame.type === "foreign") {
        const lvl = frame.foreignLevel || 0;
        if (c === "}") {
          // Peek for `}` + exactly `lvl` `=` chars (level-aware closer).
          let eq = 0;
          while (eq < lvl && source[curPos + 1 + eq] === "=") eq++;
          // A trailing `=` beyond the level would be `}===…` — still closes at
          // `lvl` (the §23.2 rule is "the same number of `=` as the opener").
          if (eq === lvl) {
            flushText();
            advance(1 + lvl); // consume `}` + the level `=` markers
            popBraceContext();
            continue;
          }
        }
        // Any other character (including `{`, `}` not at the level closer,
        // quotes, sigils) is opaque foreign content — consume verbatim.
        beginText();
        step();
        continue;
      }

      // -----------------------------------------------------------------------
      // Backtick template literal tracking inside meta (^{}) contexts.
      //
      // Without this, `${...}` inside template literals like emit(`<div>${x}</div>`)
      // are misinterpreted as nested logic block openers. We track backtick state
      // on the frame and skip all sigil detection while inside a template literal,
      // only tracking interpolation depth to know when `}` closes an interpolation
      // vs. the brace context.
      //
      // Only applies to meta blocks — in logic/sql/css blocks the tokenizer
      // handles template literals correctly at a later stage.
      // -----------------------------------------------------------------------
      if (frame.type === "meta") {
        if (c === "`" && !(curPos > 0 && source[curPos - 1] === "\\")) {
          if (!frame._inBacktick) {
            frame._inBacktick = true;
            frame._btInterpDepth = 0;
            beginText();
            step();
            continue;
          } else if (frame._btInterpDepth === 0) {
            // Closing backtick — exit template literal
            frame._inBacktick = false;
            beginText();
            step();
            continue;
          }
        }
        if (frame._inBacktick) {
          if (c === "$" && ch(1) === "{" && !(curPos > 0 && source[curPos - 1] === "\\")) {
            // Enter template interpolation
            frame._btInterpDepth = (frame._btInterpDepth || 0) + 1;
            beginText();
            advance(2);
            continue;
          }
          if (c === "{" && frame._btInterpDepth > 0) {
            // Nested brace inside interpolation
            frame._btInterpDepth++;
            beginText();
            step();
            continue;
          }
          if (c === "}" && frame._btInterpDepth > 0) {
            frame._btInterpDepth--;
            beginText();
            step();
            continue;
          }
          // Any other char inside backtick — just consume
          beginText();
          step();
          continue;
        }
      }

      // -----------------------------------------------------------------------
      // Brace-in-string detection for brace-delimited contexts (§4.6).
      //
      // Full string-state tracking is impractical at the BS level because the
      // BS cannot reliably distinguish string delimiters from other uses of
      // quote characters (regex patterns, template interpolation boundaries,
      // apostrophes in comments, etc.).
      //
      // Instead, we detect the exact 3-character patterns: '{', '}', "{", "}"
      // — a brace character immediately surrounded by matching quotes. This
      // handles the common case (Set/Map literals with single-brace strings)
      // without any risk of state corruption.
      //
      // For longer strings containing braces (e.g., "{ hello }"), users should
      // use String.fromCharCode(123/125) as a workaround.
      // -----------------------------------------------------------------------
      let _inBraceStr = false;
      if (c === "{" || c === "}") {
        const prev1 = curPos > 0 ? source[curPos - 1] : "";
        const next1 = curPos + 1 < len ? source[curPos + 1] : "";
        if ((prev1 === '"' && next1 === '"') || (prev1 === "'" && next1 === "'")) {
          _inBraceStr = true;
        }
      }

      // Nested '{' - increment brace depth (skip if inside a string literal)
      if (!_inBraceStr && c === "{") {
        frame.braceDepth++;
        beginText();
        step();
        continue;
      }

      // '}' - decrement brace depth or close context (skip if inside a string literal)
      if (!_inBraceStr && c === "}") {
        frame.braceDepth--;
        if (frame.braceDepth === 0) {
          flushText();
          step(); // consume '}'
          // For error-effect blocks: consume trailing `catch TYPE [as BINDING] { body }` clauses
          if (frame.type === "error-effect") {
            // Keep consuming catch arms until no more `catch` keyword follows
            while (pos < len) {
              // Skip whitespace/newlines
              let lookAhead = pos;
              while (lookAhead < len && /\s/.test(source[lookAhead])) lookAhead++;
              // Check for `catch` keyword
              if (source.slice(lookAhead, lookAhead + 5) === "catch" &&
                  (lookAhead + 5 >= len || /\W/.test(source[lookAhead + 5]))) {
                // Advance past whitespace and `catch`
                while (pos < lookAhead + 5) step();
                // Now consume until the matching `}` (tracking nesting)
                let catchBraceDepth = 0;
                while (pos < len) {
                  if (source[pos] === "{") { catchBraceDepth++; step(); }
                  else if (source[pos] === "}") {
                    catchBraceDepth--;
                    step();
                    if (catchBraceDepth === 0) break;
                  } else { step(); }
                }
              } else {
                break; // no more catch clauses
              }
            }
          }
          popBraceContext();
        } else {
          beginText();
          step();
        }
        continue;
      }

      // Nested brace-delimited openers.
      // Inside double/single quoted strings, ${ ?{ etc. are literal text and
      // must NOT push a new context.
      //
      // Foreign-code opener `_={ … }=` (SPEC §23.2, dpa-003 S216) — recognized
      // FIRST so a `_={` is not misread as `_ = {` (identifier + assign +
      // object). The opaque-interior scan above (frame.type === "foreign")
      // then owns everything until the level-aware `}=` closer.
      if (!_inBraceStr) {
        const _fLvl = matchForeignOpener(curPos);
        if (_fLvl >= 0) {
          flushText();
          advance(1 + _fLvl + 1); // `_` + level `=` + `{`
          pushForeignContext(_fLvl, curPos, curLine, curCol);
          continue;
        }
      }
      if (!_inBraceStr && c === "$" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("logic", curPos, curLine, curCol);
        continue;
      }
      if (!_inBraceStr && c === "?" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("sql", curPos, curLine, curCol);
        continue;
      }
      if (!_inBraceStr && c === "#" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("css", curPos, curLine, curCol);
        continue;
      }
      if (!_inBraceStr && c === "!" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("error-effect", curPos, curLine, curCol);
        continue;
      }
      if (!_inBraceStr && c === "^" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("meta", curPos, curLine, curCol);
        continue;
      }
      if (!_inBraceStr && c === "~" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("test", curPos, curLine, curCol);
        continue;
      }

      // -------------------------------------------------------------------
      // Lightweight tag nesting tracking inside brace-delimited contexts.
      // Per §4.6, `<` is NOT a block delimiter here — we're only COUNTING
      // tag nesting so child BLOCK_REFs carry the context. The block tree
      // structure is unchanged.
      // -------------------------------------------------------------------

      // Only track at braceDepth 1 (top level of this brace context).
      // Deeper nesting is inside JS objects/blocks — not tag territory.
      if (frame.braceDepth === 1) {

        // inStr: read from frame state maintained globally at the top of
        // the brace context block (see string quote tracking section above).
        // Note: _inBacktick is not tracked (see comment there) so only
        // double and single quote state is used here.
        const inStr = frame._inDouble || frame._inSingle;

        if (!inStr) {
          // '</>' — inferred closer inside brace context: decrement tagNesting
          if (c === "<" && ch(1) === "/" && ch(2) === ">") {
            if (frame.tagNesting > 0) frame.tagNesting--;
            beginText(); step(); step(); step(); // consume </>
            continue;
          }

          // '</identifier>' — explicit close tag: decrement tagNesting
          if (c === "<" && ch(1) === "/" && /[A-Za-z_]/.test(ch(2) || "")) {
            if (frame.tagNesting > 0) frame.tagNesting--;
            // Consume the whole '</ident>' as raw text
            beginText(); step(); // '<'
            step(); // '/'
            while (pos < len && /[A-Za-z0-9_\-]/.test(source[pos])) step(); // ident
            while (pos < len && source[pos] !== ">" && source[pos] !== "\n") step(); // skip to >
            if (pos < len && source[pos] === ">") step();
            continue;
          }

          // '<identifier' — potential tag open
          if (c === "<" && /[A-Za-z_]/.test(ch(1) || "")) {
            // Scan ahead (non-destructively) to see if this ends with '>' or '/>'
            let look = pos + 1;
            // Skip identifier
            while (look < len && /[A-Za-z0-9_\-]/.test(source[look])) look++;
            // Skip attributes: scan to '>' or '/>' or newline (bail)
            let localBraceD = 0;
            let localDQ = false, localSQ = false;
            let selfClose = false;
            let foundClose = false;
            while (look < len) {
              const lc = source[look];
              if (localBraceD > 0) {
                if (lc === "{") localBraceD++;
                else if (lc === "}") localBraceD--;
                look++;
                continue;
              }
              if (!localDQ && !localSQ) {
                if (lc === "{") { localBraceD++; look++; continue; }
                if (lc === '"') { localDQ = true; look++; continue; }
                if (lc === "'") { localSQ = true; look++; continue; }
                if (lc === "/" && look + 1 < len && source[look + 1] === ">") {
                  selfClose = true;
                  foundClose = true;
                  break;
                }
                if (lc === ">") {
                  foundClose = true;
                  break;
                }
              } else if (localDQ && lc === '"') {
                localDQ = false;
              } else if (localSQ && lc === "'") {
                localSQ = false;
              }
              look++;
            }
            // S83 B8/B4 — Don't count V5-strict structural state-decls as
            // tag openers. The `<NAME [attrs]> = init` shape is a state-decl
            // (§6.1, §6.2). Mirrors the top-level `peekTopLevelStateDeclSignal`
            // (L444) — at brace-context tag-nesting bookkeeping, peek past
            // the closing `>` and detect the same `=` or `:` decl signal.
            // Without this, `<sending> = false` inside a `${}` body
            // incremented frame.tagNesting, leaking into subsequent BLOCK_REFs
            // (e.g., `!{...}` failable handler) which then bypassed the L1888
            // statement-boundary break and were absorbed into preceding bare
            // exprs. (P-FUP-1 RESOLVED at top-level; this is the brace-context
            // sibling.)
            let isStructuralDeclSignal = false;
            if (foundClose && !selfClose) {
              let p = look + 1; // past '>'
              while (p < len && (source[p] === " " || source[p] === "\t")) p++;
              if (p < len) {
                const nc = source[p];
                if (nc === "=") {
                  const nxt = p + 1 < len ? source[p + 1] : "";
                  if (nxt !== "=" && nxt !== ">") isStructuralDeclSignal = true;
                } else if (nc === ":") {
                  isStructuralDeclSignal = true;
                }
              }
            }
            if (foundClose && !selfClose && !isStructuralDeclSignal) {
              frame.tagNesting++;
            }
            // Self-closing tags do not increment tagNesting.
            // Either way, consume as raw text (the BS does not create block nodes).
            beginText();
            step();
            continue;
          }

          // Bare '/' — no longer a valid tag closer (Phase 3).
          // Previously decremented tagNesting inside brace contexts.
          // Now just treat as raw content. </> handles nesting decrement above.
        }
      }

      // All other characters inside brace context: raw content
      beginText();
      step();
      continue;
    }

    // -----------------------------------------------------------------------
    // Markup / state context (or top-level)
    // -----------------------------------------------------------------------

    // '}' at markup/state level - if tracking orphan braces, just decrement
    if (c === "}") {
      if (orphanBraceDepth > 0) {
        orphanBraceDepth--;
        beginText();
        step();
        continue;
      }
      // Record the error and treat the stray '}' as raw text — continue scanning.
      errors.push(new BSError(
        "E-CTX-001",
        `Unexpected '}' — this closing brace doesn't match any open block. Check for a missing context opener above this line.`,
        { start: curPos, end: curPos + 1, line: curLine, col: curCol }
      ));
      beginText();
      step();
      continue;
    }

    // Brace-delimited openers at markup/state level.
    //
    // When orphanBraceDepth > 0, we are inside a bare `{ ... }` block at
    // markup-level (e.g. a type-decl body `type X:enum = { ... }`, a
    // function-body lift `function f() { ... }`, or a match-expression
    // body `match @x { ... }`). Inside such a block, sigil-prefixed
    // brace openers (`${`, `?{`, etc.) are NOT scrml mode-switch boundaries
    // — they're text content that will be re-parsed by the lift pass
    // (liftBareDeclarations wraps the surrounding text in `${...}` and the
    // tokenizer handles template-literal `${...}` correctly inside JS
    // string contexts).
    //
    // Bug-batch S93 (Bug 3 + Bug 3-adjacent): pre-fix, BS treated `${hh}`
    // inside `function f() { return \`${hh}\` }` as a new logic context
    // because the program-body markup frame doesn't track JS string state.
    // Bug 3-adj had the analogous failure for `renders <p>${email}</>` in
    // a type-decl enum body. Both cases hit `orphanBraceDepth > 0` here.
    if (orphanBraceDepth === 0) {
      if (c === "$" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("logic", curPos, curLine, curCol);
        continue;
      }
      // S108 Bug 4 C-narrow (SPEC §3.1 + §8.1 conformance): `?{` is a SQL
      // opener ONLY in Logic context. The context grid at §3.1 normatively
      // places SQL as a child of Logic; §8.1 reaffirms ("SQL contexts open
      // inside Logic via `?{`"). Pre-S108, BS recognized `?{` at the
      // markup/state level too — that produced the dogfood bug surface
      // where bare `?{` in markup-text prose ate the rest of the file as
      // SQL (catastrophic EOF-cascade). The companion brace-context loop
      // at line 1245 (above) still recognizes `?{` inside `${...}` — that
      // path IS the §3.1 SQL-inside-Logic case and remains unchanged.
      //
      // Composes with S101 (`RAW_CONTENT_ELEMENTS`): S101 made `?{` inert
      // inside `<pre>` / `<code>`; C-narrow makes `?{` inert in markup-text
      // body generally. Both rules collapse into "`?{` is a SQL opener only
      // where SPEC §3.1 normatively places SQL — inside Logic." See
      // `scrml-support/docs/deep-dives/bug-4-docs-mode-escape-2026-05-19.md`
      // for the 5-phase deliberation that produced this verdict.
      //
      // Fall-through behavior: when `?{` appears in markup-text, the `?`
      // accumulates as plain text via the default text-accumulation branch
      // at the bottom of the loop, and the `{` hits the orphan-brace
      // handler at ~line 1482 which increments `orphanBraceDepth`. As long
      // as the author's prose closes the brace (e.g. `?{...}` balanced),
      // the orphan-brace machinery decrements back to zero on the matching
      // `}`. Unbalanced `?{` alone produces an `E-CTX-003` unclosed-brace
      // error with a pointer to the source — much cleaner than the
      // pre-S108 EOF-cascade.
      if (c === "#" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("css", curPos, curLine, curCol);
        continue;
      }
      if (c === "!" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("error-effect", curPos, curLine, curCol);
        continue;
      }
      if (c === "^" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("meta", curPos, curLine, curCol);
        continue;
      }
      if (c === "~" && ch(1) === "{") {
        flushText();
        advance(2);
        pushBraceContext("test", curPos, curLine, curCol);
        continue;
      }
    }

    // dpa-003 (S216) — a foreign opener `_=*{` inside an orphan-brace body
    // (a function body destined for the BARE_DECL_RE lift) must be skipped
    // OPAQUELY to its level-aware `}=` closer (NOT counted as orphan braces).
    // The slice interior is opaque ts/js (§23.2.3); an embedded `}` / `}=` /
    // unbalanced brace inside a string or comment in the slice would otherwise
    // corrupt the orphanBraceDepth counter (E-CTX-001 on the real closer). We
    // consume the whole `_{ … }=` as raw text; the lift then wraps the body in
    // `${...}` and the re-split (ast-builder.js) builds the proper foreign
    // child. Only fires inside an orphan-brace body (the pre-lift fn body); at
    // depth 0 (markup direct child) the existing sidecar handling is untouched.
    if (orphanBraceDepth > 0 && !topIsBraceContext()) {
      const _fLvlOrphan = matchForeignOpener(curPos);
      if (_fLvlOrphan >= 0) {
        const lvl = _fLvlOrphan;
        beginText();
        advance(1 + lvl + 1); // `_` + level `=` + `{`
        // Scan to the level-aware closer `}` + lvl `=`, treating everything as
        // opaque (a brace inside a string/comment does not close).
        while (pos < len) {
          if (source[pos] === "}") {
            let eq = 0;
            while (eq < lvl && source[pos + 1 + eq] === "=") eq++;
            if (eq === lvl) { advance(1 + lvl); break; }
          }
          step();
        }
        continue;
      }
    }

    // Bare '{' at markup/state level (no preceding sigil) - track as orphan brace.
    // This handles type declarations like `type X:enum = { A, B, C }` where the
    // braces are structural text, not context delimiters.
    //
    // §54.3 transition-decl body: when the enclosing state frame is armed by
    // a preceding `ident(...) => < Target>` pattern, this `{` opens a logic
    // body frame instead of incrementing orphanBraceDepth.
    if (c === "{") {
      const tfBrace = topFrame();
      if (tfBrace && tfBrace.transitionBodyPending) {
        tfBrace.transitionBodyPending = false;
        flushText();
        step(); // consume '{'
        pushBraceContext("logic", curPos, curLine, curCol);
        continue;
      }
      orphanBraceDepth++;
      beginText();
      step();
      continue;
    }

    // '<' - tag or state opener
    if (c === "<") {
      const next = ch(1);

      // '</>' — inferred closer (3-char unambiguous token); must precede </identifier> check
      if (next === "/" && ch(2) === ">") {
        // Bug-batch S93 (Bug 3-adjacent companion): inside an orphan-brace
        // block, `</>` is part of the brace-body content (it pairs with a
        // `<tag>` opener that is also being treated as text). Consume as
        // raw text instead of popping the enclosing frame.
        if (orphanBraceDepth > 0) {
          beginText();
          step(); step(); step();
          continue;
        }
        const frame = topFrame();
        if (!frame || (frame.type !== "markup" && frame.type !== "state")) {
          beginText();
          step(); step(); step();
          continue;
        }
        flushText();
        advance(3); // consume </>
        popTagContext("inferred");
        continue;
      }

      // '</identifier>' - explicit close tag
      if (next === "/") {
        // Bug-batch S93 (Bug 3-adjacent companion): same orphan-brace gate
        // as `</>`. Inside `{ renders <p>${x}</p> }` the `</p>` is text.
        if (orphanBraceDepth > 0) {
          beginText();
          step(); step(); // consume `</`
          while (pos < len && /[A-Za-z0-9_\-]/.test(source[pos])) step();
          while (pos < len && source[pos] !== ">" && source[pos] !== "\n") step();
          if (pos < len && source[pos] === ">") step();
          continue;
        }
        flushText();
        advance(2); // consume </
        const tagName = readIdent();
        // scan past optional whitespace and '>'
        while (pos < len && source[pos] !== ">" && source[pos] !== "\n") step();
        if (pos < len && source[pos] === ">") step();

        const frame = topFrame();
        if (!frame || (frame.type !== "markup" && frame.type !== "state")) {
          // No open tag context — record error and discard the stray closer.
          errors.push(new BSError(
            "E-CTX-001",
            `Unexpected '</${tagName}>' — there is no matching '<${tagName}>' open above. Check for a typo in the tag name, or a missing opening tag.`,
            { start: curPos, end: pos, line: curLine, col: curCol }
          ));
          continue;
        }
        if (frame.name !== tagName) {
          // Mismatched close tag — record error, pop the open frame (best-effort recovery),
          // and continue. The popped frame uses "explicit" closerForm even though it's wrong
          // so downstream stages get a usable block shape.
          errors.push(new BSError(
            "E-CTX-001",
            `'</${tagName}>' tries to close '<${frame.name}>', but these tags don't match. Check that every opening tag has the right closing tag.`,
            { start: curPos, end: pos, line: curLine, col: curCol }
          ));
          popTagContext("explicit");
          continue;
        }
        // text is already flushed into frame.children (flushText above)
        popTagContext("explicit");
        continue;
      }

      // '<#identifier>' — worker reference or input state reference.
      // `<#name>` is ALWAYS kept as raw text so downstream stages can handle it:
      //   - `<#name>.send(expr)` → rewriteWorkerRefs in CG (§43/§46)
      //   - `when message from <#name>` → preprocessWorkerAndStateRefs in TAB (§46)
      //   - `<#name>` standalone → rewriteInputStateRefs in CG (§36)
      // A `reference` block type cannot be used here because TAB has no handler
      // for it and would emit E-PARSE-001 on any `<#name>` in markup context.
      if (next === "#") {
        flushText();
        const refStart = curPos;
        const refStartLine = curLine;
        const refStartCol = curCol;
        advance(2); // consume '<#'
        readIdent(); // skip identifier (advance pos past it)
        // Scan to closing '>'
        while (pos < len && source[pos] !== ">" && source[pos] !== "\n") step();
        if (pos < len && source[pos] === ">") step();
        // Keep <#name> as text — reset textStart so next flushText() includes it.
        textStart = refStart;
        textStartLine = refStartLine;
        textStartCol = refStartCol;
        continue;
      }

      // '<letter' or '<_' - markup tag (section 4.1)
      if (/[A-Za-z_]/.test(next)) {
        // Bug-batch S93 (Bug 3-adjacent): when inside an orphan-brace block
        // (`type X:enum = { ... }`, `function f() { ... }`, match body),
        // `<tag>` openers are part of the brace-block content (e.g. a
        // type-decl variant's `renders <p>...</>` markup-RHS clause is
        // text inside the type-decl body until the lift pass wraps it in
        // a synthetic `${...}`). Without this gate, pre-fix BS pushed a
        // markup context that split the text-block in half and dropped
        // the variant binding's lexical scope.
        if (orphanBraceDepth > 0) {
          beginText();
          step(); // consume '<' so we don't loop on it
          continue;
        }

        // Phase A1a Step 11.0d — top-level state-decl signal.
        // SPEC §6.2: `<count> = 0` (Shape 1), `<count>: number = 0` (Shape 1+typed),
        // `<userName req> = <input/>` (Shape 2). At TRUE top level (no enclosing
        // block context), recognize the post-`>` `=` or `:` signal and let the
        // entire `<NAME [attrs]>...` slice flow through as TEXT instead of
        // pushing a markup context. liftBareDeclarations then wraps such text
        // blocks in `${...}` synthetic logic, where parseLogicBody's existing
        // tryParseStructuralDecl recognizer (Step 2 + 11.0a + 11.0c) parses it.
        //
        // Component-defs (`< userBadge name(string) role(Role)>`) take the
        // whitespace-state branch (line below) — untouched.
        //
        // S83 B4 — Channel body is also a V5-strict declaration site
        // (SPEC §38.4): `<messages> = []` declares an auto-synced reactive
        // cell at channel scope. Apply the same peek as top-level when
        // immediately inside a `<channel>` markup context.
        //
        // S86 v0.3 Wave 2 follow-up — `<program>` and `<page>` bodies parse
        // in default-logic mode under v0.3 (SPEC §40.8 normative statement:
        // "Inside `<program>`, the body parses in default-logic mode. Bare
        // top-level declarations (`<x> = 0`, `function f() { ... }`) auto-lift
        // to the logic context without explicit `${...}` wrapping."). The
        // V5-strict state-decl shape (`<x>=0`, `<x>:Type=…`, derived
        // `const <x>=…`, Shape 2 `<userName req>=<input/>`) is one of the
        // declaration shapes that must auto-lift inside both contexts —
        // parallel to the existing `<channel>`-body recognition. The TAB-layer
        // lift (ast-builder.js liftBareDeclarations) already recognizes
        // isProgramRoot/isPageRoot from Wave 2 item (b) commit `9201c4e`; this
        // BS-layer extension closes the upstream gap so the recognition fires
        // before the markup-opener path is taken.
        const tf = topFrame();
        const isChannelBody = tf && tf.type === "markup" && tf.name === "channel";
        const isProgramBody = tf && tf.type === "markup" && tf.name === "program";
        const isPageBody = tf && tf.type === "markup" && tf.name === "page";
        if ((stack.length === 0 || isChannelBody || isProgramBody || isPageBody) && peekTopLevelStateDeclSignal()) {
          // S139 Bug 51-C — scan the WHOLE Shape 1/2 decl span and gobble it
          // as a single text block. Pre-S139, this branch did beginText() +
          // step() + continue, letting per-char text accumulation continue.
          // That works for Shape 1 expression-RHS (`<count> = 0` — no `<` in
          // RHS) but BREAKS for Shape 2 markup-RHS (`<userName req> =
          // <input/>`): the `<input>` opener hits the markup-opener path on
          // the next loop iteration and becomes a sibling block, leaving the
          // auto-lift to wrap LHS-only → parser produces Shape 1 plain cell
          // with no renderSpec → SYM fires E-CELL-NO-RENDER-SPEC on the use-
          // site. The scan helper handles both forms and emits the full span
          // as ONE text block (mirroring the compound-decl path below).
          // Fall back to legacy per-char accumulation if the scan fails.
          const endPos = scanShape12DeclEnd();
          if (endPos > pos) {
            // If text has already been accumulating (e.g. `const ` or `export
            // const ` prefix before `<NAME>`), INCLUDE it in the gobbled block.
            // The ast-builder lift regex TOPLEVEL_STATE_DECL_RE requires the
            // optional `const ` prefix to be in the SAME text block as the
            // opener; flushing then pushing would split them and break the lift.
            const blockStart = (textStart !== -1) ? textStart : pos;
            const blockStartLine = (textStart !== -1) ? textStartLine : curLine;
            const blockStartCol = (textStart !== -1) ? textStartCol : curCol;
            while (pos < endPos) step();
            targetChildren().push({
              type: "text",
              raw: source.slice(blockStart, pos),
              span: { start: blockStart, end: pos, line: blockStartLine, col: blockStartCol },
              depth: depth(),
              children: [],
              name: null,
              closerForm: null,
              isComponent: false,
            });
            textStart = -1;
            inDoubleQuote = false;
            inSingleQuote = false;
            continue;
          }
          // Legacy fallback (Shape 1 still works via per-char accumulation
          // since there's no `<` in the RHS to confuse the markup-opener path).
          beginText();
          step(); // consume '<' so we don't loop on it
          continue;
        }
        // Bug-3 (S101) — Variant C compound state-decl auto-lift.
        // SPEC §6.3.2 (Tier 2 ad-hoc compound) at <program>/<page>/<channel>
        // direct-child position under v0.3 default-logic mode (§40.8). The
        // parent opener `<NAME>` is followed by structural state-decl
        // children + `</>` close. Distinct from Shape 1/2 (which have `=`/`:`
        // immediately after `>` — peeked above).
        //
        // When detected, scan forward to the matching `</>` close and emit
        // the entire span as a SINGLE text block. liftBareDeclarations then
        // wraps in `${...}` (via TOPLEVEL_STATE_DECL_RE extension) and the
        // parser's tryParseStructuralDecl handles the compound shape natively.
        if ((stack.length === 0 || isChannelBody || isProgramBody || isPageBody) && peekCompoundStateDeclSignal()) {
          const endPos = scanCompoundBlockEnd();
          if (endPos > pos) {
            flushText();
            const startPos = curPos;
            const startLine = curLine;
            const startCol = curCol;
            // Advance the scanner through the entire compound span,
            // tracking line/col via step() so subsequent block spans stay
            // accurate.
            while (pos < endPos) step();
            targetChildren().push({
              type: "text",
              raw: source.slice(startPos, pos),
              span: { start: startPos, end: pos, line: startLine, col: startCol },
              depth: depth(),
              children: [],
              name: null,
              closerForm: null,
              isComponent: false,
            });
            // Reset textStart so subsequent text accumulation doesn't
            // re-include the compound span.
            textStart = -1;
            inDoubleQuote = false;
            inSingleQuote = false;
            continue;
          }
          // scanCompoundBlockEnd returned -1 — unclosed compound. Fall
          // through to the default markup-opener path so the standard
          // E-CTX-003 diagnostic fires.
        }
        flushText();
        step(); // consume '<'
        const tagName = readIdent();

        // E-STYLE-001: <style> blocks are not supported in scrml.
        // Record the error, scan past the entire <style>...</style> block to recover,
        // and continue. This avoids a cascade of parse errors from the style body.
        if (tagName.toLowerCase() === "style") {
          errors.push(new BSError(
            "E-STYLE-001",
            `<style> blocks are not supported in scrml. Use #{} for CSS.\n` +
            `  Hint: Run \`scrml compile --convert-legacy-css\` to auto-convert.`,
            { start: curPos, end: pos, line: curLine, col: curCol }
          ));
          // Scan to the matching </style> close tag (case-insensitive), or EOF.
          while (pos < len) {
            if (source[pos] === "<" && source.slice(pos, pos + 8).toLowerCase() === "</style>") {
              advance(8);
              break;
            }
            step();
          }
          inDoubleQuote = false;
          inSingleQuote = false;
          continue;
        }

        const isComp = isComponentName(tagName);
        const { attrRaw: openerAttrRaw, selfClosing, shorthand, shorthandColonAttrOff } = scanAttributes();
        const lowerTagName = tagName.toLowerCase();
        // g-colon-shorthand-markup-misparse (2026-06-18) — DEPRECATED after-`>`
        // `:`-shorthand on an engine state-child (`<Idle rule=.Done> : <p>…</p>`),
        // scoped to the `<engine>`/`<machine>` body locus. When the opener closed
        // with a bare `>` (not self-closing, not an inside-opener shorthand) and
        // is immediately followed by ` : `, consume the single-line `: expr` body
        // so the opener + after-`>` body is one self-terminating leaf (the `: expr`
        // IS the body — no `</Idle>` closer). Routes through the shorthand-leaf
        // branch below (closerForm "shorthand"), identical to the inside-opener
        // form, so it lands in engine-decl.rulesRaw and the engine-statechild-
        // parser surfaces W-COLON-SHORTHAND-LEGACY-PLACEMENT.
        const afterCloseColon =
          !shorthand && !selfClosing &&
          topIsEngineBody() && tryConsumeAfterCloseColonShorthand();
        // R4a (S159 — S154 ruling (a)): a GENUINE `:`-shorthand body has NO
        // closer (`<span : @label>` — no `/>`). A self-closing opener that also
        // tripped the shorthand scanner (e.g. `<column :let={...}/>`, where the
        // `:let` directive prefix looks colon-introduced) is NOT a `:`-shorthand
        // body — `selfClosing` wins. Gate the shorthand branch on `!selfClosing`
        // so only a true bodied shorthand (incl. `<br : x>` / `<input : @val>`,
        // which then reach the void-reject guard) takes this path.
        // R25-Bug-74 (S177) — SPEC §4.14:987 closer-presence override: a tag
        // that uses a `:`-shorthand body MUST NOT carry any closer (`</>`, `/`,
        // or `/>`). When BOTH a `:`-shorthand body AND a `/>` self-closing
        // terminator are present (`<span :@thing/>`), that is `E-CLOSER-001`
        // ("closer present on `:`-shorthand body — choose one form"). Without
        // this guard the `else if (selfClosing || VOID_ELEMENTS...)` branch
        // below wins (since `!selfClosing` is false) and SILENTLY swallows the
        // shorthand body, mis-emitting a bogus self-closing leaf and false-firing
        // W-DG-002 on the dropped cell. This must NOT regress the `:let={...}/>`
        // directive-prefix case (the comment block above): `:let=` (and any
        // `:name=` directive attribute) tripped the shorthand scanner because it
        // is whitespace-preceded `:`, but it is a directive ATTRIBUTE, not a
        // single-expression shorthand body — that case keeps `selfClosing`
        // winning (no E-CLOSER-001) and falls through to the self-closing branch.
        if (shorthand && selfClosing &&
            isGenuineShorthandBodyNotDirective(openerAttrRaw, shorthandColonAttrOff)) {
          errors.push(new BSError(
            "E-CLOSER-001",
            `<${tagName}> uses a \`:\`-shorthand body but also has a closer (\`/>\`). ` +
            `A \`:\`-shorthand body has NO closer — choose one form: write ` +
            `\`<${tagName} : expr>\` (shorthand, no closer) OR \`<${tagName}>...</>\` ` +
            `(bare-body with a closer) OR \`<${tagName} attrs/>\` (self-closing, no body).`,
            { start: curPos, end: pos, line: curLine, col: curCol }
          ));
          // Recovery: emit the leaf as a self-closing markup so downstream stages
          // get a usable shape (the diagnostic is already fatal — exit 1).
          targetChildren().push({
            type: "markup",
            raw: source.slice(curPos, pos),
            span: { start: curPos, end: pos, line: curLine, col: curCol },
            depth: depth(),
            children: [],
            name: tagName,
            closerForm: "self-closing",
            isComponent: isComp,
            openerHadSpaceAfterLt: false,
          });
        } else if ((shorthand && !selfClosing) || afterCloseColon) {
          // R25-Bug-40 — SPEC §4.14 `:`-shorthand body: the opener carries
          // its single-expression body inside the opener (between the `:`
          // and `>`); there is NO closer. Emit as a leaf block (analogous
          // to self-closing) with closerForm:"shorthand" so downstream
          // consumers (ast-builder, emit-each, native-parser parity) can
          // recognize the shape. The opener's full raw text — including
          // the ` : <body-expr>` segment — is on `.raw`, which is what
          // emit-each.ts's `detectShorthandOpener` / `extractShorthandExpr`
          // inspect. The `shorthandColonOff` field records the offset of
          // the `:` WITHIN block.raw — ast-builder uses this to slice the
          // opener at the introducer (attribute region vs shorthand body)
          // so tokenizeAttributes does not misparse `@.name` etc. as two
          // bareword attributes.
          // shorthandColonOff is the offset of `:` inside block.raw;
          // attrRaw starts immediately after the tag name (length of
          // `<` + tag name). Compute: `<` (1) + tagName.length + offset
          // of `:` within attrRaw.
          // g-colon-shorthand-markup-misparse (2026-06-18) — the after-`>`
          // form (`afterCloseColon`) lands here too; its `:` is OUTSIDE the
          // opener so `shorthandColonOff` does not apply (it stays -1 and the
          // field is omitted). Engine state-children are re-parsed downstream
          // from rulesRaw, so the offset is not load-bearing for them.
          const shorthandColonOff =
            afterCloseColon ? -1 : 1 + tagName.length + shorthandColonAttrOff;
          targetChildren().push({
            type: "markup",
            raw: source.slice(curPos, pos),
            span: { start: curPos, end: pos, line: curLine, col: curCol },
            depth: depth(),
            children: [],
            name: tagName,
            closerForm: "shorthand",
            isComponent: isComp,
            openerHadSpaceAfterLt: false,
            ...(shorthandColonOff >= 0 ? { shorthandColonOff } : {}),
          });
        } else if (selfClosing || VOID_ELEMENTS.has(lowerTagName)) {
          // Self-closing ('/>') or HTML void element - emit as leaf block, no context push.
          // R4a (S159 — S154 ruling (a)): this branch now follows the `shorthand`
          // branch above, so a void element that carries a `:`-shorthand body
          // (`<br : x>`, `<input : @val>`) is recognized as closerForm:"shorthand"
          // (reaching the type-system E-COLON-SHORTHAND-ON-VOID guard) rather than
          // being silently mis-classified self-closing with its body swallowed.
          // SAFE: `<input/>` / `<input type="text"/>` are selfClosing (no shorthand
          // marker) and `<input>` (no shorthand, not selfClosing) still void
          // short-circuits here — only `<void : expr>` (the rejected case) is
          // re-routed.
          targetChildren().push({
            type: "markup",
            raw: source.slice(curPos, pos),
            span: { start: curPos, end: pos, line: curLine, col: curCol },
            depth: depth(),
            children: [],
            name: tagName,
            closerForm: "self-closing",
            isComponent: isComp,
            openerHadSpaceAfterLt: false,
          });
        } else if (!isComp && STRUCTURAL_RAW_BODY_ELEMENTS.has(lowerTagName)) {
          // S107 Phase 2 — SPEC §18.0.1 match block-form structural raw-body.
          // S138 Phase 5 (R24-BUG-4) — `</>` generic closer now supported per
          // SPEC §4.4.2 ("`</>` SHALL close the innermost open tag").
          //
          // Body captured as single text run; closer is one of:
          //   `</tagname>` — explicit close (S107 Phase 2 baseline)
          //   `</>`        — generic close (S138 Phase 5, R24-BUG-4)
          //   inferred     — EOF reached without a matching closer (E-CTX-001)
          //
          // The body-end scan uses a generic tag-stack (findStructuralBodyEnd
          // — module-scope helper) that pushes on each non-self-close,
          // non-`:`-shorthand opener and pops on `</tagname>` / `</>` arm-
          // children closers. When the stack is empty AND we hit either a
          // matching `</outerKind>` or a `</>`, that IS the outer closer.
          //
          // Skip zones during scan: `${...}` interpolation blocks (brace-
          // counted), `"..."` / `'...'` strings, `<!-- -->` HTML comments,
          // `//` line comments, and `/* */` block comments — `<` characters
          // inside any of those do NOT affect the depth counter.
          //
          // Same-kind nesting (HU-1 Q6 — nested `<each>` inside `<each>`)
          // continues to work — a nested same-kind opener pushes like any
          // other tag; the matching `</each>` (or `</>`) pops it; the outer
          // closer is only recognized when stack is empty.
          //
          // The match-statechild-parser at SYM-time re-tokenizes the captured
          // body content to recognize arm shapes (self-closing / bare-body /
          // `:`-shorthand) and arm-closer forms.
          const contentStart = pos;
          const contentStartLine = curLine;
          const contentStartCol = curCol;
          const scanResult = findStructuralBodyEnd(source, pos, lowerTagName);
          // Advance the position-tracker (with line/col updates) up to
          // contentEnd — we walk one char at a time via step() so the
          // existing line/col machinery stays consistent.
          while (pos < scanResult.contentEnd) step();
          const contentEnd = pos;
          const children = [];
          if (contentEnd > contentStart) {
            children.push({
              type: "text",
              raw: source.slice(contentStart, contentEnd),
              span: {
                start: contentStart,
                end: contentEnd,
                line: contentStartLine,
                col: contentStartCol,
              },
              depth: depth(),
              children: [],
              name: null,
              closerForm: null,
              isComponent: false,
            });
          }
          let closerForm;
          if (scanResult.closerForm === "explicit") {
            advance(scanResult.closerLen);
            closerForm = "explicit";
          } else if (scanResult.closerForm === "generic") {
            advance(scanResult.closerLen); // 3 — `</>`
            closerForm = "generic";
          } else {
            // "inferred" — EOF reached without a matching closer.
            errors.push(new BSError(
              "E-CTX-001",
              `Unclosed <${tagName}> structural element. Expected '</${lowerTagName}>' or '</>'.`,
              { start: curPos, end: pos, line: curLine, col: curCol }
            ));
            closerForm = "inferred";
          }
          targetChildren().push({
            type: "markup",
            raw: source.slice(curPos, pos),
            span: { start: curPos, end: pos, line: curLine, col: curCol },
            depth: depth(),
            children,
            name: tagName,
            closerForm,
            isComponent: isComp,
            openerHadSpaceAfterLt: false,
          });
        } else if (!isComp && RAW_CONTENT_ELEMENTS.has(lowerTagName)) {
          // SPEC §4.17 — raw-content element. Inside `<pre>` / `<code>`, scrml
          // tokens (`${...}`, `<TagName>`, `?{}`, `#{}`, `!{}`, `^{}`, `_{...}`)
          // are NOT recognized; the entire body is a single text run terminated
          // by the matching close tag. HTML entity-escaping of `<` / `>` / `&`
          // for display remains author responsibility (parallel to plain-HTML
          // rules — browsers don't auto-encode inside `<pre>` either).
          //
          // The `!isComp` guard ensures `<Pre>` / `<Code>` (component refs,
          // which lowercase to the same names) take the normal markup path,
          // not raw-content — component-name detection is uppercase-first.
          const contentStart = pos;
          const contentStartLine = curLine;
          const contentStartCol = curCol;
          const closeNeedle = `</${lowerTagName}>`;
          const closeLen = closeNeedle.length;
          while (pos < len) {
            if (
              source[pos] === "<" &&
              source.slice(pos, pos + closeLen).toLowerCase() === closeNeedle
            ) {
              break;
            }
            step();
          }
          const contentEnd = pos;
          const children = [];
          if (contentEnd > contentStart) {
            children.push({
              type: "text",
              raw: source.slice(contentStart, contentEnd),
              span: {
                start: contentStart,
                end: contentEnd,
                line: contentStartLine,
                col: contentStartCol,
              },
              depth: depth(),
              children: [],
              name: null,
              closerForm: null,
              isComponent: false,
            });
          }
          let closerForm = "explicit";
          if (pos < len) {
            advance(closeLen);
          } else {
            errors.push(new BSError(
              "E-CTX-001",
              `Unclosed <${tagName}> raw-content element (expected '${closeNeedle}'). Add the matching close tag.`,
              { start: curPos, end: pos, line: curLine, col: curCol }
            ));
            closerForm = "inferred";
          }
          targetChildren().push({
            type: "markup",
            raw: source.slice(curPos, pos),
            span: { start: curPos, end: pos, line: curLine, col: curCol },
            depth: depth(),
            children,
            name: tagName,
            closerForm,
            isComponent: isComp,
            openerHadSpaceAfterLt: false,
          });
        } else {
          pushTagContext("markup", tagName, curPos, curLine, curCol, false);
        }
        // Reset quote state - we just finished scanning a tag (attributes use local state)
        inDoubleQuote = false;
        inSingleQuote = false;
        continue;
      }

      // '< whitespace' - state block (section 4.2)
      if (/\s/.test(next)) {
        // Bug-batch S93 (Bug 3-adjacent companion): orphan-brace gating —
        // a `< name>` state-opener inside a `{ ... }` brace block at
        // markup-level is content text, not a real state push. Mirror the
        // markup `<TAG>` orphan-brace gate above.
        if (orphanBraceDepth > 0) {
          beginText();
          step(); // consume '<' so we don't loop on it
          continue;
        }

        // §54.3 transition-decl target: if this `<` follows `ident(...) =>`
        // inside a state body, treat `< Target>` as text, not a state push.
        // The next `{` at state-body level opens a logic body frame.
        const tfInner = topFrame();
        if (tfInner && tfInner.type === "state" && isAfterTransitionArrow(curPos)) {
          step(); // consume '<'
          while (pos < len && /\s/.test(source[pos])) step();
          readIdent();
          while (pos < len && source[pos] !== ">" && source[pos] !== "\n") step();
          if (pos < len && source[pos] === ">") step();
          // Forward-peek: only arm the flag when `{` (ignoring whitespace)
          // follows the target — i.e., the full compound pattern is present.
          let p = pos;
          while (p < len && /\s/.test(source[p])) p++;
          if (p < len && source[p] === "{") {
            tfInner.transitionBodyPending = true;
          }
          inDoubleQuote = false;
          inSingleQuote = false;
          continue;
        }
        flushText();
        step(); // consume '<'
        while (pos < len && /\s/.test(source[pos])) step(); // skip whitespace
        const stateName = readIdent();
        const { selfClosing: stateSelfClosing, shorthand: stateShorthand, shorthandColonAttrOff: stateShorthandColonAttrOff } = scanAttributes();
        // g-colon-shorthand-markup-misparse (2026-06-18) — DEPRECATED after-`>`
        // `:`-shorthand on a whitespace-form engine state-child opener
        // (`< Idle rule=.Done> : <p>…</p>`). Same recognition as the no-space
        // markup path; routes through the stateShorthand leaf branch below.
        const stateAfterCloseColon =
          !stateShorthand && !stateSelfClosing &&
          topIsEngineBody() && tryConsumeAfterCloseColonShorthand();
        if (stateSelfClosing) {
          // P1 (uniform opener, SPEC §15.15): permit `< name attr=...` /> ` self-closing
          // for state openers — required to make state types behave uniformly with the
          // no-space markup path. NR resolves the kind/category; W-WHITESPACE-001 is
          // emitted because of the opener whitespace.
          targetChildren().push({
            type: "state",
            raw: source.slice(curPos, pos),
            span: { start: curPos, end: pos, line: curLine, col: curCol },
            depth: depth(),
            children: [],
            name: stateName,
            closerForm: "self-closing",
            isComponent: isComponentName(stateName),
            openerHadSpaceAfterLt: true,
          });
        } else if (stateShorthand || stateAfterCloseColon) {
          // R25-Bug-40 — SPEC §4.14 `:`-shorthand body on state openers
          // (engine state-children: `<Idle : startGame()>`, etc.). Same
          // treatment as the markup path — leaf block, no context push,
          // closerForm:"shorthand". The opener's `.raw` carries the
          // entire opener including the body expression. Downstream
          // engine-statechild-parser re-parses `rulesRaw` (which still
          // includes this opener verbatim via the .raw concat in
          // ast-builder), so engine semantics are unchanged. The BS-level
          // recognition prevents the spurious E-CTX-003 "Unclosed"
          // error class that pre-S136 fired silently and was discarded.
          // shorthandColonOff: offset of `:` in block.raw. For state
          // openers raw starts with `<` + maybe-whitespace + tagName, so
          // we compute via the absolute position arithmetic instead — the
          // offset within attrRaw is reliable, BUT the state opener's
          // preamble can include arbitrary whitespace between `<` and the
          // tag name (`< Idle ...>`). The simplest portable value is the
          // offset of `:` within block.raw computed by scanning the raw —
          // surfaced as raw.indexOf(" :") at consumer side. We don't
          // surface shorthandColonOff for state openers in this landing
          // because engine state-children are downstream re-parsed (the
          // BS recognition is correctness-preserving, not codegen-feeding).
          targetChildren().push({
            type: "state",
            raw: source.slice(curPos, pos),
            span: { start: curPos, end: pos, line: curLine, col: curCol },
            depth: depth(),
            children: [],
            name: stateName,
            closerForm: "shorthand",
            isComponent: isComponentName(stateName),
            openerHadSpaceAfterLt: true,
          });
        } else {
          pushTagContext("state", stateName, curPos, curLine, curCol, true);
        }
        // Reset quote state after tag
        inDoubleQuote = false;
        inSingleQuote = false;
        continue;
      }

      // Any other '<' (operator, lone bracket, etc.) - raw content
      beginText();
      step();
      continue;
    }

    // '/' - no longer a valid closer (Phase 3: use </> or </tag> instead)
    if (c === "/") {
      // '/>' - self-closing sequence; valid (section 4.8)
      if (ch(1) === ">") {
        beginText();
        step();
        continue;
      }

      // Bare '/' was a closer in Phase 1-2 but is no longer valid.
      // Per spec, '/' only carries closer-meaning inside tag-angle-bracket
      // contexts (<...>, </>). In markup *text content*, '/' is a literal
      // character (division operator, path separators, literal slashes between
      // ${} interpolations, etc.) and must NOT emit E-SYNTAX-050.
      //
      // We still flag the legacy closer pattern: a '/' in text whose next
      // non-whitespace character is '<' (an attempted followup close tag) or
      // EOF (trailing '/' at end of markup body — the pre-Phase-3 close form).
      // This preserves the diagnostic for mistakes like `<p>hello/</p>` or
      // `<div>content/` while allowing literal slashes in interpolation text.
      const frame = topFrame();
      if (frame && (frame.type === "markup" || frame.type === "state")) {
        // Scan ahead past whitespace to determine whether this '/' looks like
        // a legacy tag-closer attempt.
        let look = pos + 1;
        while (look < len && /\s/.test(source[look])) look++;
        const nextNonWs = look < len ? source[look] : "";
        // S177 bug-4 — refine the legacy bare-`/`-closer heuristic. A bare `/`
        // looks like a legacy closer attempt only when it stands WHERE a closer
        // would go: at EOF, or immediately before a NEW OPENER (`<name` — the
        // writer used `/` to close and then started a sibling/child). It is NOT
        // a closer attempt when the very next non-ws token is a REAL CLOSE TAG
        // (`</...` — `</>` or `</tag>`): a real closer is already present, so the
        // `/` is unambiguously literal markup text (a trailing path slash, a
        // standalone `… defined /</>`). Previously ANY following `<` fired,
        // false-positiving the literal-`/`-before-close-tag case (`<li>… /</>`).
        // The CONF-015 canonical contract is the EOF case (`<p>hello/`,
        // `<div>content/`), which still fires; only the slash-before-close-tag
        // over-fire is suppressed.
        const nextIsCloseTag = nextNonWs === "<" && source[look + 1] === "/";
        const looksLikeCloser =
          nextNonWs === "" || (nextNonWs === "<" && !nextIsCloseTag);
        if (looksLikeCloser) {
          errors.push(new BSError(
            "E-SYNTAX-050",
            `Bare '/' is no longer a valid closer. Use '</>' to close '<${frame.name}>', or use the explicit form '</${frame.name}>'.`,
            { start: curPos, end: curPos + 1, line: curLine, col: curCol }
          ));
        }
      }

      // Treat '/' as raw content
      beginText();
      step();
      continue;
    }

    // Default: raw content
    beginText();
    step();
  }

  // --- End of file ---
  flushText();

  // Unclosed contexts: E-CTX-003 — emit one error per unclosed frame so the user
  // sees all unclosed tags at once, not just the innermost one.
  if (stack.length > 0) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const frame = stack[i];
      errors.push(new BSError(
        "E-CTX-003",
        `Unclosed '${frame.name || frame.type}' — opened but never closed before end of file.`,
        { start: frame.startPos, end: frame.startPos + 1, line: frame.startLine, col: frame.startCol }
      ));
    }
  }

  return { filePath, blocks: rootBlocks, errors };
}

// ---------------------------------------------------------------------------
// Pipeline contract wrapper
// ---------------------------------------------------------------------------

/**
 * @param {{ filePath: string, source: string, macroTable?: Map<string,string> }} input
 * @returns {{ filePath: string, blocks: Block[], errors: BSError[] }}
 */
export function runBlockSplitter(input) {
  return splitBlocks(input.filePath, input.source);
}

export { BSError };
