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
 *   §4.8 (PA-004)        Bare `/` only recognized outside braces and outside quoted strings
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

  /** True if the top frame is a brace-delimited context. */
  function topIsBraceContext() {
    const f = topFrame();
    return f !== null && (
      f.type === "logic" || f.type === "sql" ||
      f.type === "css" || f.type === "error-effect" ||
      f.type === "meta" || f.type === "test"
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
   * @returns {{ attrRaw: string, selfClosing: boolean }}
   */
  function scanAttributes() {
    let attrRaw = "";
    let localDouble = false;
    let localSingle = false;
    let selfClosing = false;
    let braceDepth = 0; // track '{' nesting inside attribute values (sigil-prefixed or bare)
    let parenDepth = 0; // §5.5.2: track '(' nesting so '>' in (expr) doesn't close the tag

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

      if (!localDouble && !localSingle) {
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
        // Sigil-prefixed brace openers: ${, ?{, #{, !{, ^{, ~{
        if ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && ch(1) === "{") {
          braceDepth = 1;
          attrRaw += c;
          step();
          attrRaw += source[pos];
          step();
          continue;
        }
        // Bare '{' opener: props={...}, class={expr}, onClick={handler}.
        // Track brace depth so '>' inside the value is not treated as a tag-close.
        // This fixes parsing of function type annotations like 'onClick: () => void'.
        if (c === "{") {
          braceDepth++;
          attrRaw += c;
          step();
          continue;
        }
        // §5.5.2: '(' opener for parenthesized expressions: class:active=(@count > 0).
        // Track paren depth so '>' inside the value is not treated as a tag-close.
        if (c === "(") {
          parenDepth++;
          attrRaw += c;
          step();
          continue;
        }
        if (c === '"') {
          localDouble = true;
          attrRaw += c;
          step();
          continue;
        }
        if (c === "'") {
          localSingle = true;
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

    return { attrRaw, selfClosing };
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
    // Section 4.7: '//' comment suppression (applies at ALL context levels)
    // -----------------------------------------------------------------------
    if (c === "/" && ch(1) === "/" && !inDoubleQuote && !inSingleQuote) {
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
    // Quote state tracking (section 4.8) - applies at markup/state level only.
    // We track global quote state for bare-/ disambiguation.
    // Tag attribute content is handled by scanAttributes() with LOCAL state.
    // Inside brace-delimited contexts, quote tracking is skipped because
    // brace contexts only need to count { and } depth; regex literals and
    // other quote-containing patterns can cause false state transitions.
    // -----------------------------------------------------------------------
    if (!topIsBraceContext()) {
      if (!inSingleQuote && c === '"') {
        const escaped = curPos > 0 && source[curPos - 1] === "\\";
        if (!escaped) inDoubleQuote = !inDoubleQuote;
        beginText();
        step();
        continue;
      }
      if (!inDoubleQuote && c === "'") {
        const escaped = curPos > 0 && source[curPos - 1] === "\\";
        if (!escaped) {
          if (inSingleQuote) {
            // Close the string
            inSingleQuote = false;
          } else {
            // Only open single-quote string mode if the ' is NOT embedded in a word.
            // Apostrophes in contractions (We'll, it's, can't) are preceded by a
            // letter/digit and should NOT suppress a subsequent bare '/' closer.
            // A word-initial ' (preceded by whitespace, '>', or start) IS a string.
            const prev = curPos > 0 ? source[curPos - 1] : " ";
            if (!/[A-Za-z0-9]/.test(prev)) {
              inSingleQuote = true;
            }
          }
        }
        beginText();
        step();
        continue;
      }

      // Inside a quoted string: everything is raw content
      if (inDoubleQuote || inSingleQuote) {
        beginText();
        step();
        continue;
      }
    }

    // -----------------------------------------------------------------------
    // Brace-delimited context handling
    // -----------------------------------------------------------------------
    if (topIsBraceContext()) {
      const frame = topFrame();

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

    // Brace-delimited openers at markup/state level
    if (c === "$" && ch(1) === "{") {
      flushText();
      advance(2);
      pushBraceContext("logic", curPos, curLine, curCol);
      continue;
    }
    if (c === "?" && ch(1) === "{") {
      flushText();
      advance(2);
      pushBraceContext("sql", curPos, curLine, curCol);
      continue;
    }
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
          // Don't flush text; don't step. Let the default raw-content path
          // accumulate the entire `<NAME [attrs]> = expr` line as text.
          beginText();
          step(); // consume '<' so we don't loop on it
          continue;
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
        const { selfClosing } = scanAttributes();
        if (selfClosing || VOID_ELEMENTS.has(tagName.toLowerCase())) {
          // Self-closing ('/>') or HTML void element - emit as leaf block, no context push
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
        const { selfClosing: stateSelfClosing } = scanAttributes();
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
        const looksLikeCloser = nextNonWs === "" || nextNonWs === "<";
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
