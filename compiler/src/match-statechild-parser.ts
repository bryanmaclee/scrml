/* SPDX-License-Identifier: MIT
 *
 * S107 Phase 2 — Match block-form state-child parser (SPEC §18.0.1).
 *
 * Mirrors engine-statechild-parser.ts (S68 / B15) for the Tier-1 match locus.
 *
 * Input:  the raw text of a `<match>` body — the `armsRaw` field stamped on
 *         `match-block` AST nodes by ast-builder.js (Phase 1, S107 commit
 *         `82c48fd`). Body content is everything between the `<match for=Type
 *         [on=expr]>` opener and the explicit `</match>` closer; BS captures
 *         it as a single text run via STRUCTURAL_RAW_BODY_ELEMENTS (block-
 *         splitter.js §S107 Phase 2 gate), avoiding the `:`-shorthand vs
 *         bare-body shape-confusion that would otherwise fire E-CTX-003 on
 *         arm openers.
 *
 * Output: `MatchArmEntry[]` — one entry per arm-child with structural fields
 *         that SYM PASS (Phase 2) and codegen (Phase 3) consume.
 *
 * Arm recognition:
 *   1. Opener — `<NAME` where NAME is PascalCase variant ident OR `_` for
 *      wildcard. Each opener begins a new arm.
 *   2. Attributes — read until `>` or `/>`, balanced for `()`, `[]`, `{}`,
 *      `${...}`, and quoted strings (single + double). Captured as raw text
 *      slices for downstream parsing (Phase 4 type-system + payload-binding
 *      enrichment).
 *   3. Payload bindings — when `(` appears immediately after the name (no
 *      whitespace), the parenthesized identifiers are the payload-binding
 *      list per SPEC §18.0.1 line 9586-9588 (canonical Tier-1 form per
 *      Q-MB-3 ratification — engine's bare-attribute + named forms are
 *      §51.0.B.1-locus only). Captured as raw text in Phase 2; tokenized
 *      in Phase 4 (when the type-system reuse path lands).
 *   4. Body forms (three legal per §18.0.1 line 9589-9592):
 *      - Self-closing `<Variant/>` — no body. `bodyForm: "self-closing"`,
 *        `bodyRaw: ""`.
 *      - `:`-shorthand `<Variant attrs> : expr` — single expression body,
 *        terminated by either end-of-line (newline) OR next arm-opener at
 *        the same depth. `bodyForm: "shorthand"`, `bodyRaw: <expr-text>`.
 *      - Bare-body `<Variant attrs>...</>` or `<Variant attrs>...</Variant>`
 *        — markup body terminated by matching closer. `bodyForm: "bare-body"`,
 *        `bodyRaw: <body-text>`. Either `</>` or `</NAME>` closes.
 *
 * Phase 2 DOES NOT validate. It just tokenizes. SYM PASS at symbol-table.ts
 * does:
 *   - E-MATCH-NOT-EXHAUSTIVE  — variant-set vs for=Type's variants
 *   - W-MATCH-RULE-INERT      — any `rule=` attr on any arm
 *   - E-MATCH-EFFECT-FORBIDDEN — any `effect=` attr on any arm
 *   - E-MATCH-ONTRANSITION-FORBIDDEN — `<onTransition>` anywhere in arm body
 *   - E-MATCH-ON-REQUIRED     — on= missing AND no <engine for=Type> in scope
 *
 * Span tracking: positions are byte-offsets RELATIVE to armsRaw (not source).
 * Callers add the match-block's span.start to get absolute positions.
 */

// §24 HTML void elements — self-terminating, admit no children. A void
// opener (bare `<input>` or self-closed `<input/>`) inside a match-arm body
// must NOT be treated as a nesting container by `findArmCloser`; otherwise a
// bare void opener increments the close-finder's nesting `depth` and the
// arm's own `</>` / `</Variant>` closer is mis-consumed as the void's closer,
// so the arm appears unclosed → a misleading E-MATCH-PARSE-001. Mirrors the
// VOID_ELEMENTS set in block-splitter.js (the BS-stage companion that captures
// the match body raw); kept local because this file is otherwise import-free
// (parallel to the engine-statechild-parser scanner). Names are lowercased at
// the lookup site, matching the §24 registry casing.
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr",
]);

// g-markup-comment-angle-bracket-parsed-as-tag (ss39 item 1) — comment trivia
// inside a match-arm body. BS captures the `<match>` body as a single raw text
// run (STRUCTURAL_RAW_BODY_ELEMENTS), so any comment inside it survives verbatim
// into `armsRaw`. The arm scanners below (`findArmCloser`, `findNextArmOpener`,
// and the main loop's stray-content advance) interpret `<` as a structural
// tag opener/closer — but an angle-bracket FRAGMENT inside a comment is inert
// trivia (SPEC §27.1 — `//` universal; §27.2 — `<!-- -->` markup-native), NOT a
// tag. Without this skip, `// NOT a <form> — use the <each> helper` had its
// `<form>` / `<each>` consumed as openers → the close-finder's nesting depth
// never unwound → a misleading E-MATCH-PARSE-001 ("arm has no matching closer")
// + E-MATCH-NOT-EXHAUSTIVE on an otherwise well-formed arm/match.
//
// The three forms mirror BS's `findStructuralBodyEnd` (block-splitter.js) EXACTLY
// — that helper already skips `//` (skipLineComment), `/* */` (skipBlockComment),
// and `<!-- -->` (skipHtmlComment) when locating the body END, so the arm-split
// here MUST classify the same byte ranges as inert or the two scanners disagree
// on the body span. (`/* */` is not a §27.2 markup-native comment, but the BS
// raw-body scan treats it as one; consistency with the body-end scan is the
// governing constraint inside the captured raw body.)
//
// String literals / backticks are deliberately NOT skipped: per the
// g-match-arm-apostrophe ruling (S195/S196) a `'` / `"` at the arm-body markup-
// text level is PROSE, not a string delimiter. A `//` inside an ATTRIBUTE value
// (e.g. `<a href="//cdn.x">`) never reaches here — the opener's inner quote-aware
// `q`-loop in `findArmCloser` consumes it before the outer loop sees it.
//
// Returns the index immediately past the comment when one starts at `i`, else
// `i` unchanged. `//` returns the index of the terminating newline (left for the
// caller, matching skipLineComment); `/* */` and `<!-- -->` return past their
// closer (or EOF for an unterminated comment — best-effort recovery, parity with BS).
function skipMatchComment(s: string, i: number): number {
  const c = s[i];
  const c2 = s[i + 1];
  // `//` line comment (SPEC §27.1 — universal).
  if (c === "/" && c2 === "/") {
    let j = i + 2;
    while (j < s.length && s[j] !== "\n") j++;
    return j;
  }
  // `/* */` block comment.
  if (c === "/" && c2 === "*") {
    let j = i + 2;
    while (j < s.length) {
      if (s[j] === "*" && s[j + 1] === "/") return j + 2;
      j++;
    }
    return s.length; // unterminated — consume to EOF
  }
  // `<!-- -->` HTML markup comment (SPEC §27.2 — markup-native).
  if (c === "<" && c2 === "!" && s[i + 2] === "-" && s[i + 3] === "-") {
    let j = i + 4;
    while (j < s.length) {
      if (s[j] === "-" && s[j + 1] === "-" && s[j + 2] === ">") return j + 3;
      j++;
    }
    return s.length; // unterminated — consume to EOF
  }
  return i;
}

export interface MatchArmAttr {
  name: string;     // attribute name (e.g. "rule", "effect")
  valueRaw: string; // raw attribute value (or empty for bareword attrs)
  // Local byte offsets within armsRaw. The SYM-PASS adds the match-block's
  // span.start to absolutize for diagnostic positioning.
  spanStart: number;
  spanEnd: number;
}

export interface MatchArmEntry {
  variantName: string;        // PascalCase variant ident OR "_" for wildcard
  isWildcard: boolean;        // true iff variantName === "_"
  payloadBindingsRaw: string; // raw text inside `(...)` if present, else empty
  attrs: MatchArmAttr[];
  bodyForm: "self-closing" | "shorthand" | "bare-body";
  bodyRaw: string;            // body content (empty for self-closing)
  /** S160 (S154 ruling (b)) — TRUE when a `"shorthand"` arm used the LEGACY
   *  after-`>` placement (`<Variant> : expr`) rather than the canonical
   *  inside-opener placement (`<Variant : expr>`). Both produce an identical
   *  entry; this flag drives `W-COLON-SHORTHAND-LEGACY-PLACEMENT` (§34).
   *  Absent / false for inside-opener shorthand, bare-body, and self-closing. */
  legacyColonPlacement?: boolean;
  // Local byte offsets within armsRaw of the whole arm (opener through close).
  spanStart: number;
  spanEnd: number;
  // Local byte offset of the arm-opener `<` (for arm-targeted diagnostics).
  openerStart: number;
}

export interface MatchParseDiagnostic {
  code: string;    // e.g. "E-MATCH-PARSE-001"
  message: string;
  spanStart: number;
  spanEnd: number;
}

export interface MatchParseResult {
  arms: MatchArmEntry[];
  diagnostics: MatchParseDiagnostic[];
}

/**
 * Parse a match-block's armsRaw into structured arm entries.
 *
 * Returns the entries + any parse-time diagnostics (malformed openers,
 * unclosed bare-body arms, etc.). Callers (SYM PASS) consume both.
 */
export function parseMatchArms(armsRaw: string): MatchParseResult {
  const arms: MatchArmEntry[] = [];
  const diagnostics: MatchParseDiagnostic[] = [];
  if (!armsRaw || typeof armsRaw !== "string") {
    return { arms, diagnostics };
  }

  let pos = 0;
  const len = armsRaw.length;

  function skipWhitespace(): void {
    while (pos < len && /\s/.test(armsRaw[pos])) pos++;
  }

  function isArmOpener(at: number): boolean {
    if (at >= len) return false;
    if (armsRaw[at] !== "<") return false;
    if (at + 1 >= len) return false;
    const next = armsRaw[at + 1];
    // PascalCase (variant) OR `_` (wildcard arm per §18.0.1 line 9594).
    // Exclude `<` followed by `/` (closer), `<` followed by lowercase (HTML
    // tag — not an arm; could be body content of a preceding arm), `<` inside
    // already-scanned arm body (handled by body-scan logic).
    return /[A-Z_]/.test(next);
  }

  // Scan attributes — returns the position of the opener's terminating `>`
  // (or `/>`). Captures attr name/value pairs along the way. Balanced for
  // `()`, `[]`, `{}`, `${...}`, quoted strings.
  function scanOpenerAttrs(
    openerStart: number,
    nameEnd: number,
    payloadBindingsRaw: string,
  ): { closeAt: number; selfClosing: boolean; attrs: MatchArmAttr[]; insideColonAt: number } {
    const attrs: MatchArmAttr[] = [];
    let p = nameEnd;
    // If a payload `(...)` followed the name, skip past it.
    if (payloadBindingsRaw) {
      p += 1 + payloadBindingsRaw.length + 1; // `(` + content + `)`
    }
    while (p < len) {
      // Skip whitespace
      const pBeforeWs = p;
      while (p < len && /\s/.test(armsRaw[p])) p++;
      if (p >= len) break;
      const c = armsRaw[p];
      if (c === ">") return { closeAt: p, selfClosing: false, attrs, insideColonAt: -1 };
      if (c === "/" && p + 1 < len && armsRaw[p + 1] === ">") {
        return { closeAt: p + 1, selfClosing: true, attrs, insideColonAt: -1 };
      }
      // S160 (S154 ruling (b)) — INSIDE-opener `:`-shorthand body-introducer.
      // A `:` reached at the top of the attribute scan that is preceded by at
      // least one whitespace character (§4.14 line 983 — the disambiguator vs.
      // a `bind:`/`on:`/`class:` namespace separator, which glues the `:` to the
      // identifier) opens the single-expression body INSIDE the opener. The body
      // runs to the `>` that terminates the opener; scan forward past it (string-,
      // `${...}`-, and bracket-aware so a `>` inside a string or nested markup is
      // opaque — the angleDepth rule, §4.13/§4.14) to find the real opener `>`.
      if (c === ":" && p > pBeforeWs) {
        const insideColonAt = p;
        const closeAt = scanToOpenerClose(p + 1);
        return { closeAt, selfClosing: false, attrs, insideColonAt };
      }
      // Read attr name
      if (!/[A-Za-z_]/.test(c)) {
        // Unexpected character — bail with what we have.
        return { closeAt: p, selfClosing: false, attrs, insideColonAt: -1 };
      }
      const attrNameStart = p;
      while (p < len && /[A-Za-z0-9_:-]/.test(armsRaw[p])) p++;
      const attrName = armsRaw.slice(attrNameStart, p);
      // Optional `=value`
      let valueRaw = "";
      if (p < len && armsRaw[p] === "=") {
        p++; // consume `=`
        // Value: quoted string, ident, dotted path, `${...}`, etc.
        // Capture up to next whitespace OR `>` OR `/>` at top depth.
        let depth = 0;
        let inDQ = false;
        let inSQ = false;
        const valueStart = p;
        while (p < len) {
          const vc = armsRaw[p];
          if (inDQ) {
            if (vc === '"') inDQ = false;
            else if (vc === "\\") { p++; }
            p++;
            continue;
          }
          if (inSQ) {
            if (vc === "'") inSQ = false;
            else if (vc === "\\") { p++; }
            p++;
            continue;
          }
          if (vc === '"') { inDQ = true; p++; continue; }
          if (vc === "'") { inSQ = true; p++; continue; }
          if (vc === "{" || vc === "(" || vc === "[") { depth++; p++; continue; }
          if (vc === "}" || vc === ")" || vc === "]") { if (depth > 0) depth--; p++; continue; }
          if (depth === 0) {
            if (/\s/.test(vc)) break;
            if (vc === ">") break;
            if (vc === "/" && p + 1 < len && armsRaw[p + 1] === ">") break;
          }
          p++;
        }
        valueRaw = armsRaw.slice(valueStart, p);
      }
      attrs.push({
        name: attrName,
        valueRaw,
        spanStart: attrNameStart,
        spanEnd: p,
      });
    }
    // Reached EOF without `>` — caller will see this as malformed.
    return { closeAt: p, selfClosing: false, attrs, insideColonAt: -1 };
  }

  // S160 (S154 ruling (b)) — given the position just past an inside-opener
  // `:`-shorthand body-introducer, scan forward to the `>` that terminates the
  // opener. The single-expression body may contain a string literal (`"...>"`),
  // a `${...}` interpolation, or nested markup-as-value (`<p>...</p>`) whose `>`
  // chars are NOT the opener terminator — so the scan is string-, `${}`-, and
  // angleDepth-aware (a `<` inside the body opens a nested tag; its matching `>`
  // is consumed at depth>0). Returns the index of the opener's terminating `>`,
  // or `len` if none is found (malformed — the caller treats this like a missing
  // closer).
  function scanToOpenerClose(from: number): number {
    let p = from;
    let inDQ = false;
    let inSQ = false;
    let angleDepth = 0;
    // Code-expression nesting depth ({ } / ( ) / [ ]). A `>` inside a §4.18
    // code-default arm body — the arrow `=>`, a comparison `a > b`, or `>=` —
    // is an OPERATOR, not the opener terminator. Without this, a shorthand
    // body like `<Updated(row) : { @rows = @rows.map(r => …) }>` truncated at
    // the `>` of `=>` (the realtime `<onchange>` arms, §38.13.3, all use
    // `.map(r => …)` / `.filter(r => …)`). Mirrors `_findOnchangeOpenerEnd`'s
    // brace/paren/bracket tracking in ast-builder.js.
    let codeDepth = 0;
    while (p < len) {
      const c = armsRaw[p];
      if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") p++; p++; continue; }
      if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") p++; p++; continue; }
      if (c === '"') { inDQ = true; p++; continue; }
      if (c === "'") { inSQ = true; p++; continue; }
      // `${...}` logic-context interpolation — consume the balanced brace block
      // so a `>` operator inside (e.g. `${a > b ? x : y}`) is not the terminator.
      if (c === "$" && armsRaw[p + 1] === "{") {
        p += 2;
        let braceDepth = 1;
        while (p < len && braceDepth > 0) {
          const c2 = armsRaw[p];
          if (c2 === "{") braceDepth++;
          else if (c2 === "}") braceDepth--;
          p++;
        }
        continue;
      }
      // Bare code-expression nesting (a §4.18 code-default body `{ … }`, a
      // parenthesised sub-expression, an array/index). `${…}` was consumed
      // above, so a `{` reached here is a bare code brace.
      if (c === "{" || c === "(" || c === "[") { codeDepth++; p++; continue; }
      if (c === "}" || c === ")" || c === "]") { if (codeDepth > 0) codeDepth--; p++; continue; }
      // Nested markup-as-value: a `<` (not a closer `</`) opens a nested tag —
      // but ONLY at code-depth 0. Inside a code body a `<` is a comparison
      // operator (`a < b`), which must NOT pollute the markup angle depth.
      if (c === "<") { if (codeDepth === 0) angleDepth++; p++; continue; }
      if (c === ">") {
        // A `>` inside a code expression (arrow / comparison) is opaque.
        if (codeDepth > 0) { p++; continue; }
        if (angleDepth > 0) { angleDepth--; p++; continue; }
        return p; // the opener's terminating `>`
      }
      p++;
    }
    return len;
  }

  function scanPayloadBindings(at: number): { contentRaw: string; afterClose: number } {
    // Caller ensures armsRaw[at] === "(".
    let p = at + 1;
    let depth = 1;
    let inDQ = false;
    let inSQ = false;
    const start = p;
    while (p < len && depth > 0) {
      const c = armsRaw[p];
      if (inDQ) {
        if (c === '"') inDQ = false;
        else if (c === "\\") p++;
        p++;
        continue;
      }
      if (inSQ) {
        if (c === "'") inSQ = false;
        else if (c === "\\") p++;
        p++;
        continue;
      }
      if (c === '"') { inDQ = true; p++; continue; }
      if (c === "'") { inSQ = true; p++; continue; }
      if (c === "(") { depth++; p++; continue; }
      if (c === ")") {
        depth--;
        if (depth === 0) {
          return { contentRaw: armsRaw.slice(start, p), afterClose: p + 1 };
        }
        p++;
        continue;
      }
      p++;
    }
    // Unclosed — bail
    return { contentRaw: armsRaw.slice(start, p), afterClose: p };
  }

  // Find the next arm-opener `<NAME` from position `at` onward, ignoring
  // `<` characters inside quoted strings or balanced braces.
  function findNextArmOpener(at: number): number {
    let p = at;
    let braceDepth = 0;
    while (p < len) {
      const c = armsRaw[p];
      // g-match-arm-apostrophe-bs (S195/S196) — same locus ruling as findArmCloser:
      // a `'` / `"` at the arm-body MARKUP-TEXT level is prose, not a string-span
      // delimiter, so it must not be tracked here (it would otherwise swallow the
      // next `<Variant>` arm-opener). `${...}` logic-context strings are guarded by
      // the braceDepth counter below (a `<` arm-opener only counts at braceDepth 0).
      // Comment trivia is inert — a PascalCase `<Loading>` mention inside a
      // `//` / `/* */` / `<!-- -->` comment must not be read as an arm-opener
      // (g-markup-comment-angle-bracket-parsed-as-tag, ss39 item 1).
      const afterComment = skipMatchComment(armsRaw, p);
      if (afterComment !== p) { p = afterComment; continue; }
      if (c === "{") { braceDepth++; p++; continue; }
      if (c === "}") { if (braceDepth > 0) braceDepth--; p++; continue; }
      if (braceDepth === 0 && isArmOpener(p)) return p;
      p++;
    }
    return -1;
  }

  // Find the matching close for a bare-body arm. Accepts `</>` OR `</NAME>`.
  // Scans forward from `at`, tracking nested `<TAG>...</TAG>` pairs so the
  // close-finder doesn't terminate at a body's own nested closer.
  function findArmCloser(at: number, variantName: string): { contentEnd: number; closerEnd: number } | null {
    let p = at;
    let depth = 1;
    while (p < len) {
      const c = armsRaw[p];
      // g-match-arm-apostrophe-bs (S195/S196) — a `'` / `"` at the ARM-BODY
      // MARKUP-TEXT level (between tags) is PROSE, NOT a string-span delimiter.
      // The outer close-finder must NOT track string state here: a contraction
      // or possessive apostrophe in arm free-text (`<Failed> <p>We'll try again
      // later.</p> </>`) would otherwise open a phantom string that consumes the
      // `</p>` / `</>` closers, so the arm looks unclosed → a misleading
      // E-MATCH-PARSE-001. Mirrors the S109 locus ruling (strings live in LOGIC
      // context + ATTRIBUTE VALUES — markup-text body is text). Opener-INTERNAL
      // strings (attribute values, `:`-shorthand display-text literals) are still
      // tracked by the inner `q`-loop's qDQ/qSQ state below; `${...}` logic blocks
      // are opaque there too.
      //
      // Comment trivia (`//` / `/* */` / `<!-- -->`) is inert — an angle-bracket
      // fragment inside a comment is NOT a structural opener/closer and must not
      // move the nesting `depth` (g-markup-comment-angle-bracket-parsed-as-tag,
      // ss39 item 1). Checked before the `<` branch so `<!--` is skipped as a
      // comment rather than mis-read as a malformed opener. Mirrors BS's
      // findStructuralBodyEnd, which skips the same ranges when locating the
      // body END — the two scanners must agree on the body span.
      const afterComment = skipMatchComment(armsRaw, p);
      if (afterComment !== p) { p = afterComment; continue; }
      if (c === "<") {
        // Closer forms
        if (armsRaw.slice(p, p + 3) === "</>") {
          depth--;
          if (depth === 0) return { contentEnd: p, closerEnd: p + 3 };
          p += 3;
          continue;
        }
        const namedCloser = `</${variantName}>`;
        if (armsRaw.slice(p, p + namedCloser.length) === namedCloser) {
          depth--;
          if (depth === 0) return { contentEnd: p, closerEnd: p + namedCloser.length };
          p += namedCloser.length;
          continue;
        }
        // Generic closer `</NAME>` — decrement nesting depth for matching prior `<NAME>`.
        if (armsRaw[p + 1] === "/") {
          // Walk to end of closer
          let q = p + 2;
          while (q < len && armsRaw[q] !== ">") q++;
          if (q < len) {
            depth--;
            p = q + 1;
            continue;
          }
        }
        // Opener `<TAG>` — increment depth (but skip self-closing AND §24
        // void elements, which are self-terminating leaves with no children).
        if (/[A-Za-z_]/.test(armsRaw[p + 1])) {
          // Read the opener tag name (so a bare void element does not push the
          // close-finder's nesting depth). Tag-name chars: letters, digits,
          // `_`, `-` per the HTML/scrml element grammar; lowercased for the
          // §24 VOID_ELEMENTS lookup.
          let nameEnd = p + 1;
          while (nameEnd < len && /[A-Za-z0-9_-]/.test(armsRaw[nameEnd])) nameEnd++;
          const openerTagName = armsRaw.slice(p + 1, nameEnd).toLowerCase();
          const isVoidOpener = VOID_ELEMENTS.has(openerTagName);
          // Scan to opener's `>` or `/>`
          let q = p + 1;
          let qBrace = 0;
          let qDQ = false;
          let qSQ = false;
          let foundOpenerEnd = false;
          while (q < len) {
            const qc = armsRaw[q];
            if (qDQ) { if (qc === '"') qDQ = false; else if (qc === "\\") q++; q++; continue; }
            if (qSQ) { if (qc === "'") qSQ = false; else if (qc === "\\") q++; q++; continue; }
            if (qc === '"') { qDQ = true; q++; continue; }
            if (qc === "'") { qSQ = true; q++; continue; }
            if (qc === "{" || qc === "(" || qc === "[") { qBrace++; q++; continue; }
            if (qc === "}" || qc === ")" || qc === "]") { if (qBrace > 0) qBrace--; q++; continue; }
            if (qBrace === 0) {
              if (qc === "/" && q + 1 < len && armsRaw[q + 1] === ">") {
                // Self-closing — don't increment depth
                q += 2;
                foundOpenerEnd = true;
                break;
              }
              if (qc === ">") {
                // §24 void elements are self-terminating even in their bare
                // (un-self-closed) form — they admit no children, so a bare
                // `<input>` / `<br>` / `<img>` must NOT increment the nesting
                // depth (mirrors the self-closing branch above and the BS-stage
                // VOID_ELEMENTS gate). Otherwise the arm's `</>` / `</Variant>`
                // closer is mis-consumed as this void's closer → the arm looks
                // unclosed → a misleading E-MATCH-PARSE-001.
                if (!isVoidOpener) depth++;
                q++;
                foundOpenerEnd = true;
                break;
              }
            }
            q++;
          }
          // Resume scanning from just past the opener's terminating `>` / `/>`.
          // (Previously this used `p = q` inside the loop then `if (p < q)
          // continue`, which — since `p === q` after the assignment — ALWAYS
          // fell through to the trailing `p++`. That dropped the byte
          // immediately after the opener; harmless when it was body text, but
          // it SKIPPED the `<` of a closer that sat flush against the opener
          // `>` — e.g. `<input></Editing>` — so the arm's real closer was
          // missed and a misleading E-MATCH-PARSE-001 fired. Resuming at `q`
          // and `continue`-ing unconditionally fixes both the void-leaf cases
          // and the latent flush-closer case.)
          p = q;
          if (foundOpenerEnd) continue;
          // EOF inside the opener (malformed) — `q === len`; `p === len` now,
          // so the outer `while (p < len)` exits and findArmCloser returns null
          // (the caller fires E-MATCH-PARSE-001 for the genuinely-malformed arm).
        }
      }
      p++;
    }
    return null;
  }

  // Main loop — parse arms until exhausted.
  while (pos < len) {
    skipWhitespace();
    if (pos >= len) break;
    if (!isArmOpener(pos)) {
      // Skip stray content between arms (whitespace, comments — Phase 2
      // doesn't lint these; Phase 4 may add). Comment trivia is skipped as a
      // unit so a PascalCase `<Loading>` mention inside a between-arms comment
      // isn't mis-read as an arm-opener on a later iteration
      // (g-markup-comment-angle-bracket-parsed-as-tag, ss39 item 1). Otherwise
      // advance one char to make progress (stray text is unusual but must not
      // infinite-loop).
      const afterComment = skipMatchComment(armsRaw, pos);
      pos = afterComment !== pos ? afterComment : pos + 1;
      continue;
    }
    const armOpenerStart = pos;
    pos++; // consume `<`
    // Read variant name
    const nameStart = pos;
    if (armsRaw[pos] === "_") {
      // Wildcard arm
      pos++;
    } else {
      while (pos < len && /[A-Za-z0-9_]/.test(armsRaw[pos])) pos++;
    }
    const variantName = armsRaw.slice(nameStart, pos);
    const isWildcard = variantName === "_";

    // Check for payload bindings `(...)`.
    let payloadBindingsRaw = "";
    if (pos < len && armsRaw[pos] === "(") {
      const pl = scanPayloadBindings(pos);
      payloadBindingsRaw = pl.contentRaw;
      // scanOpenerAttrs will skip past the payload region.
    }

    // Parse attrs + find opener-close.
    const openerScan = scanOpenerAttrs(armOpenerStart + 1, pos, payloadBindingsRaw);
    pos = openerScan.closeAt + 1; // advance past `>` or `/>`

    if (openerScan.selfClosing) {
      arms.push({
        variantName,
        isWildcard,
        payloadBindingsRaw,
        attrs: openerScan.attrs,
        bodyForm: "self-closing",
        bodyRaw: "",
        spanStart: armOpenerStart,
        spanEnd: pos,
        openerStart: armOpenerStart,
      });
      continue;
    }

    // S160 (S154 ruling (b)) — INSIDE-opener `:`-shorthand (canonical). The
    // `:` body-introducer was found INSIDE the opener by `scanOpenerAttrs`; the
    // single-expression body runs from one past the `:` (`insideColonAt`) to the
    // opener's terminating `>` (`closeAt`). After-`:` whitespace is optional
    // (§4.14) — the body text is trimmed, so `:@thing` and `: @thing` produce the
    // same body. This is the canonical placement; the legacy after-`>` form is
    // handled below (deprecation window, marked `legacyColonPlacement`).
    if (openerScan.insideColonAt >= 0) {
      const bodyRaw = armsRaw.slice(openerScan.insideColonAt + 1, openerScan.closeAt).trim();
      arms.push({
        variantName,
        isWildcard,
        payloadBindingsRaw,
        attrs: openerScan.attrs,
        bodyForm: "shorthand",
        bodyRaw,
        spanStart: armOpenerStart,
        spanEnd: pos,
        openerStart: armOpenerStart,
      });
      continue;
    }

    // Body form discrimination — check for LEGACY after-`>` `:`-shorthand vs
    // bare-body. After `>`, skip horizontal whitespace (NOT newlines per §32.4-style
    // line-boundary semantics — `:`-shorthand fits on one line typically).
    let bodyScanPos = pos;
    while (bodyScanPos < len && (armsRaw[bodyScanPos] === " " || armsRaw[bodyScanPos] === "\t")) {
      bodyScanPos++;
    }

    if (bodyScanPos < len && armsRaw[bodyScanPos] === ":") {
      // `:`-shorthand body — body terminates at end-of-line OR next arm-opener.
      const bodyStart = bodyScanPos + 1; // skip `:`
      let bodyP = bodyStart;
      // Skip whitespace after `:` to start of expression
      while (bodyP < len && (armsRaw[bodyP] === " " || armsRaw[bodyP] === "\t")) bodyP++;
      const exprStart = bodyP;
      // Body content extends to newline OR next arm-opener at this position.
      let bodyEnd = bodyP;
      while (bodyEnd < len) {
        if (armsRaw[bodyEnd] === "\n") {
          // Check if next non-whitespace is an arm-opener
          let peekP = bodyEnd + 1;
          while (peekP < len && /\s/.test(armsRaw[peekP])) peekP++;
          if (peekP >= len || isArmOpener(peekP)) {
            break; // end of `:`-shorthand body
          }
          // Otherwise body continues across the newline (multi-line `:`-shorthand,
          // less common but allowed).
        }
        bodyEnd++;
      }
      const bodyRaw = armsRaw.slice(exprStart, bodyEnd).trim();
      pos = bodyEnd;
      arms.push({
        variantName,
        isWildcard,
        payloadBindingsRaw,
        attrs: openerScan.attrs,
        bodyForm: "shorthand",
        bodyRaw,
        // S160 (S154 ruling (b)) — this is the LEGACY after-`>` placement.
        legacyColonPlacement: true,
        spanStart: armOpenerStart,
        spanEnd: pos,
        openerStart: armOpenerStart,
      });
      continue;
    }

    // Bare-body — scan for matching `</>` or `</Variant>` closer.
    const closer = findArmCloser(pos, variantName);
    if (!closer) {
      diagnostics.push({
        code: "E-MATCH-PARSE-001",
        message: `E-MATCH-PARSE-001: <${variantName}> arm has no matching closer ('</>' or '</${variantName}>'). Use one of the three legal body forms per SPEC §18.0.1: self-closing '<${variantName}/>', ':'-shorthand '<${variantName}> : expr', or bare-body '<${variantName}>...</>' (or '</${variantName}>').`,
        spanStart: armOpenerStart,
        spanEnd: len,
      });
      // Advance to EOF to avoid infinite loop.
      pos = len;
      continue;
    }
    const bodyRaw = armsRaw.slice(pos, closer.contentEnd).trim();
    pos = closer.closerEnd;
    arms.push({
      variantName,
      isWildcard,
      payloadBindingsRaw,
      attrs: openerScan.attrs,
      bodyForm: "bare-body",
      bodyRaw,
      spanStart: armOpenerStart,
      spanEnd: pos,
      openerStart: armOpenerStart,
    });
  }

  return { arms, diagnostics };
}

/**
 * Extract enum-variant names from a `type Foo:enum = { A, B, C }` type-decl's
 * raw text. Returns the variant names in declaration order; payload-bearing
 * variants strip the payload arglist (`Variant(field:Type)` → `Variant`).
 *
 * Used by SYM PASS to compute exhaustiveness for E-MATCH-NOT-EXHAUSTIVE.
 *
 * Phase 2 baseline shape — Phase 4 will replace this with proper type-system
 * integration once the bare-variant inference path is reused.
 */
export function extractEnumVariants(rawText: string): string[] {
  // Strip outer braces if present
  let s = rawText.trim();
  if (s.startsWith("{")) s = s.slice(1);
  if (s.endsWith("}")) s = s.slice(0, -1);

  const variants: string[] = [];
  let pos = 0;
  const len = s.length;
  while (pos < len) {
    // Skip whitespace + commas
    while (pos < len && /[\s,]/.test(s[pos])) pos++;
    if (pos >= len) break;
    // Read variant name
    const nameStart = pos;
    while (pos < len && /[A-Za-z0-9_]/.test(s[pos])) pos++;
    const name = s.slice(nameStart, pos);
    if (!name) {
      pos++; // make progress
      continue;
    }
    variants.push(name);
    // Skip whitespace BEFORE checking for the payload arglist. The enum
    // type-decl's `raw` is tokenizer-JOINED text — `Ready(count: int)` in
    // source arrives here as `Ready ( count : int )` with spaces around the
    // parens. S109 fix: pre-S109 the `s[pos] === "("` check ran immediately
    // after the name and saw the space, NOT the `(`, so the payload skip
    // never fired — `count` + `int` were then read as PHANTOM variant names,
    // firing a spurious E-MATCH-NOT-EXHAUSTIVE on every payload-bearing enum
    // used in a `<match for=Type>` block. (Match block-form Phase 5.)
    let probe = pos;
    while (probe < len && /\s/.test(s[probe])) probe++;
    if (probe < len && s[probe] === "(") {
      pos = probe;
      let depth = 1;
      pos++;
      while (pos < len && depth > 0) {
        if (s[pos] === "(") depth++;
        else if (s[pos] === ")") depth--;
        pos++;
      }
    }
  }
  return variants;
}
