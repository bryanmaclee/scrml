/**
 * E-STATE-BLOCK-STATEMENT-FORM — a lifecycle STATEMENT written directly in a
 * `<db>` / `<state>` / `<schema>` STATE-block markup body is REFUSED.
 *
 * change-id: db-state-block-locus-2026-08-25 (ruling 1, S375 — bryan ratified
 * limb (b): logic at a state-block locus is REFUSED, not linted).
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 *
 *   <db src="sqlite:./app.db" tables="items">
 *     on mount { loadDashboard() }
 *   </db>
 *
 * compiled at **exit 0 with zero diagnostics**, shipped `on mount {
 * loadDashboard() }` into `<body>` as **literal page text**, and never invoked
 * `loadDashboard`. The author's initialization silently never happened and the
 * page displayed its own source.
 *
 * ── WHY IT IS AN ERROR AND NOT A LINT ────────────────────────────────────────
 *
 * A state-block body is MARKUP context, not a logic locus. SPEC is explicit in
 * two places (both §34 catalog rows, normative):
 *
 *   - §34 row `E-WRITE-NOT-IN-LOGIC-CONTEXT` (§40.8, §6.1.1, §6.2): "`<db>` /
 *     `<state>` STATE-block bodies are NOT default-logic-mode loci".
 *   - §34 row `W-STATE-BLOCK-BARE-WRITE-DECL` (§38.4, §6, §40.8): "A state-block
 *     body is markup context (SPEC §4)".
 *
 * §40.8's `default-logic` auto-lift — the mode in which `on mount { … }` IS
 * lifted to logic — is scoped to `<program>` / `<page>` / `<channel>` bodies
 * (the S111 amendment of 2026-05-20, §4.18: `default-logic` is "a distinct third
 * body-mode" owned by §40.8; grep SPEC.md for "S111 amendment"). A state block is none of those, so the identical
 * source line that becomes logic one locus up becomes TEXT here. That
 * asymmetry, silently, is the defect.
 *
 * Per S368 (logic at a markup locus is REFUSED, not linted) this is conformance
 * restoration against a ruling already made, not new policy.
 *
 * ── SCOPE: ONE NAMED FORM, AND THE COMPLEMENT IS DELIBERATELY REFUSED ────────
 *
 * This lint fires on EXACTLY the `on mount {` / `on dismount {` lifecycle
 * opener — the shape `TOPLEVEL_ON_LIFECYCLE_RE` (`ast-builder.js:756-757`)
 * auto-lifts at the §40.8 locus. Mirroring that regex is the whole scoping
 * argument: **the form that WOULD have been logic one locus up, and silently
 * is not here.** It is keyword-led AND brace-terminated, so it cannot collide
 * with prose ("Notes on mount points…" does not match — no `{`).
 *
 * Everything else at this locus is deliberately NOT covered:
 *
 *   - **Bare calls** (`loadDashboard()`) — the S368 bare-call ruling explicitly
 *     rejected "diagnose every non-declaration run", and there is a MEASURED
 *     false-positive class: a TYPESTATE transition declaration
 *     (`validate() => < Validated> { }`) sits in a `< Draft>` block that the
 *     block splitter classifies as `type:"state"`, so a bare-call gate here
 *     would reject 4 live conformance cases under
 *     `conformance/cases/type-state-codes/`. Out of scope by evidence, not by
 *     omission.
 *   - **Control flow** (`if (…) { }`, `for`, `while`) — ALREADY covered at this
 *     locus by `E-CONTROL-FLOW-IN-MARKUP`, verified by compiling. Adding it here
 *     would double-fire.
 *   - **Bare writes** (`@x = init`) — covered by the sibling INFO lint
 *     `W-STATE-BLOCK-BARE-WRITE-DECL` and its own reserved deprecation endpoint
 *     `E-STATE-BLOCK-BARE-WRITE-DECL`. Untouched: that code is a DEPRECATION
 *     CYCLE endpoint for the write form and is still mid-window.
 *   - **Prose / free text** — must keep compiling, and does (regression-covered).
 *
 * ── WHY A FRESH CODE RATHER THAN THE RESERVED `E-STATE-BLOCK-BARE-WRITE-DECL` ─
 *
 * The dispatching brief proposed reusing the reserved
 * `E-STATE-BLOCK-BARE-WRITE-DECL`. That code is shape-specific, not
 * locus-specific: its §34 row (§38.4, §6) defines it as "A bare `@name = init`
 * directly in a `<db>` / `<state>` STATE-block markup body is rejected.
 * Deprecation cycle endpoint — activates after the
 * W-STATE-BLOCK-BARE-WRITE-DECL window". An
 * `on mount { … }` block is neither a bare write nor a declaration, and the
 * write form's deprecation window is still OPEN (the W- lint is the active
 * stage). Firing the reserved E- code for a different shape would put the
 * catalog in an incoherent state — the same code simultaneously "RESERVED — not
 * yet emitted" for writes and live for lifecycle blocks — and violates the
 * standing rule that a diagnostic code shall not carry two unrelated meanings
 * (allocate fresh, never renumber).
 *
 * `DIAGNOSTIC_CODE` below is a single constant precisely so this is a one-line
 * flip if the operator rules the other way.
 *
 * ── WHERE THIS RUNS, AND WHY NOT IN `ast-builder.js` ─────────────────────────
 *
 * The sibling write-form scan (`scanStateBlockBareWriteDecls`,
 * `ast-builder.js:1923`) runs inside `liftBareDeclarations`. This pass instead
 * runs over the block-split AST (`bsResults`) from `api.js`, the same stage-2.5
 * slot as `W-INTERP-IN-RAW-CONTENT` and `W-INPUT-STATE-MARKUP-NONREACTIVE` —
 * both of which are markup-text lints over BS output, the identical shape. The
 * NODE domain is the same as the sibling's (a state block's DIRECT text
 * children), so nothing is lost by the relocation.
 *
 * ⚠ The node domain is the same; the LINE domain is no longer. Since
 * `db-locus-blockcomment-fp-2026-08-26` this pass masks comment regions before
 * matching (see `maskCommentRegions`) and the sibling does not — the sibling has
 * no comment handling at ALL, not even the `//` carve-out this one used to have.
 * VERIFIED BY EXECUTION at that change: a `@count = 0` sitting inside a
 * `/* ... *` + `/` block in a `<db>` body still draws
 * `W-STATE-BLOCK-BARE-WRITE-DECL` at line 4. It is the same false-positive class
 * this module just closed, one severity down (warning, so non-fatal) and in
 * `ast-builder.js`, which was out of scope for that dispatch. Filed, not fixed —
 * do not read the sibling's silence as evidence the shape is fine.
 *
 * ── A NOTE ON HOW SPEC IS CITED HERE: BY CODE NAME, NEVER BY LINE ───────────
 *
 * These citations used to carry bare SPEC.md line numbers (19720, 20072, and two
 * others). One of the four ROTTED INSIDE A SINGLE COMMIT: a §34 row
 * inserted at 19722 pushed `E-STATE-BLOCK-BARE-WRITE-DECL` from 20072 to 20073,
 * so the comment silently began pointing at `E-CONST-AT-DEPRECATED` instead —
 * a citation that still LOOKS precise while naming the wrong row. (The other
 * three were re-verified at the same time and were still correct, which is the
 * point: rot is silent and per-line, so a spot-check of one proves nothing about
 * the rest.)
 *
 * A §34 code name plus its section list is stable under insertion, is greppable
 * in one command, and fails LOUDLY rather than silently if the row is renamed or
 * struck. This repo has a row-provenance gate for exactly this reason. Do not
 * reintroduce line numbers here.
 *
 * @module lint-e-state-block-statement-form
 */

/**
 * Diagnostic code. Single constant by design — see the header note on why this
 * is a fresh allocation rather than the reserved `E-STATE-BLOCK-BARE-WRITE-DECL`.
 */
export const DIAGNOSTIC_CODE = "E-STATE-BLOCK-STATEMENT-FORM";

/**
 * State-block element names whose bodies are markup context. Mirrors
 * `_STATE_BLOCK_BARE_WRITE_NAMES` (`ast-builder.js:1160`) so this pass and the
 * sibling write-form scan agree on what a "state block" is.
 *
 * `<engine>` / `<machine>` are deliberately absent: they route to `engine-decl`,
 * a different grammar with its own code-default body mode (§4.18.1), where a
 * bare run IS code.
 */
const STATE_BLOCK_NAMES = new Set(["db", "state", "schema"]);

/**
 * The lifecycle opener that auto-lifts at the §40.8 default-logic locus.
 * Deliberately identical in shape to `TOPLEVEL_ON_LIFECYCLE_RE`
 * (`ast-builder.js:756-757`) — the point of the diagnostic is that THIS form is
 * logic at `<program>` and text at `<db>`.
 *
 * The trailing `\{` is load-bearing: it is what keeps prose out. A text run
 * beginning "on mount points are documented below" does not match.
 */
const STATE_BLOCK_ON_LIFECYCLE_RE = /^\s*on\s+(mount|dismount)\s*\{/;

/**
 * True when a block-splitter node is a state block whose body is markup context.
 *
 * BOTH openers must be recognised, and they are classified DIFFERENTLY by BS:
 *   - the canonical no-space `<db>` is classified `type:"markup"` with `name:"db"`;
 *   - the deprecated whitespace `< db>` is classified `type:"state"`.
 * The one live corpus member of this defect (`samples/htmx-debate-dashboard.scrml:14`)
 * uses the DEPRECATED form, so a markup-only gate would have missed it entirely.
 *
 * ── THE TWO ARMS ARE NAME-GUARDED SYMMETRICALLY, AND THAT IS DELIBERATE ──────
 *
 * The `state` arm used to return `true` unconditionally while the `markup` arm
 * was name-guarded. That asymmetry READ as intentional and was not: it made this
 * module's own documented `<engine>` / `<machine>` exclusion (below) apply to
 * only ONE of the two ways a block can arrive here.
 *
 * `type:"state"` is not a semantic classification — it is what the block
 * splitter calls ANY whitespace-form opener `< Name …>`. MEASURED over the 2,353
 * corpus sources at the time of the fix: **123 `type:"state"` nodes, and only 44
 * of them are named `db`.** The other 79 are `engine` (x31), typestate
 * transition declarations (`Draft`, `Validated`, `Submission`, `Todo`),
 * whitespace-form COMPONENT definitions (`taskItem`, `siteHeader`, `sidebar`,
 * `statusBadge`, …) and even plain HTML (`p`, `div`). The unguarded arm claimed
 * every one of them.
 *
 * PA-REPRODUCED and independently re-reproduced: `on mount { go() }` inside a
 * `< Idle rule=.Active>` engine state-child drew this code at severity error. At
 * that locus the diagnostic's PREMISE is false — an engine state-child body is a
 * code-default locus (§4.18.1), so the statement does NOT ship into the DOM as
 * page text — and its remediation ("move it to the `<program>` body") is wrong
 * advice. A fatal refuse gate was giving wrong guidance at a locus it was never
 * scoped to. No corpus file happened to fire, but that is luck: none of those 79
 * nodes contains a line beginning `on mount {`. Luck is not scoping.
 *
 * The name guard does NOT blind the deprecated-opener arm this module exists to
 * cover, and that was checked rather than assumed: BS records `name:"db"` on the
 * `< db>` node (`name:"Idle"` on the engine child), so `< db …>` still matches
 * and all 44 corpus instances are retained. The canonical `<Idle rule=…>` form
 * never reached here at all — it is not a `type:"state"` node.
 */
function isStateBlock(node) {
  if (!node) return false;
  // Both arms name-guarded — see the note above. `type:"state"` means "a
  // whitespace-form opener", not "a state block", so it needs the same filter
  // the markup arm has always had.
  if (node.type === "state") return STATE_BLOCK_NAMES.has(node.name);
  return node.type === "markup" && STATE_BLOCK_NAMES.has(node.name);
}

/**
 * ⚠ DO NOT cite a sibling diagnostic code by its bare `E-`/`W-`/`I-` token in
 * this message. `scripts/corpus-emit-differential.ts:431` builds each source's
 * fired-code set by regexing `\b[EWI]-[A-Z0-9-]+\b` out of the compiler's OUTPUT
 * TEXT, so a code merely CITED in prose is indistinguishable from one that
 * actually fired. The first cut of this message cross-referenced
 * `E-WRITE-NOT-IN-LOGIC-CONTEXT` and the corpus differential duly reported that
 * code as newly firing on `samples/htmx-debate-dashboard.scrml` — a phantom.
 * Cite the SPEC SECTION (`§34`, `§4.18.1`), never the code token.
 */
function buildMessage(keyword) {
  return (
    `a lifecycle block \`on ${keyword} { ... }\` written directly in a ` +
    `state-block (\`<db>\` / \`<state>\`) body is not logic and will never run. ` +
    `A state-block body is MARKUP context, not a logic locus — \`<db>\` / ` +
    `\`<state>\` bodies are not \`default-logic\` loci (§34, §4.18.1), so the ` +
    `\`on ${keyword}\` auto-lift ` +
    `that applies in a \`<program>\` / \`<page>\` / \`<channel>\` body (§40.8) ` +
    `does NOT apply here and the statement would ship into the DOM as literal ` +
    `page text. Move the lifecycle block OUT of the state-block body to the ` +
    `\`<program>\` / \`<page>\` body, where \`on ${keyword} { ... }\` is lifted ` +
    `to logic; or wrap it in an explicit \`\${ ... }\` logic block.`
  );
}

/**
 * Comment delimiters, as STRING constants rather than inline literals.
 *
 * Two reasons, both practical: a literal block-comment terminator cannot appear
 * inside the JSDoc that explains the machine below, and naming the three tokens
 * makes `maskCommentRegions` read as the state machine it is instead of as a
 * pile of two-character `indexOf` calls.
 */
const LINE_COMMENT_OPEN = "//";
const BLOCK_COMMENT_OPEN = "/*";
const BLOCK_COMMENT_CLOSE = "*" + "/";

/**
 * Mask every COMMENT region of one line with spaces, carrying block-comment
 * state in and out so a comment that OPENS on one line and CLOSES on another is
 * modelled correctly.
 *
 * ── WHY A STATE MACHINE RATHER THAN A SECOND PATTERN ────────────────────────
 *
 * The first cut of this scan carved comments out with a second regex bolted
 * beside the lifecycle one: `if (!/^\s*\/\//.test(line))`. That test has no
 * state, so it recognised only a line-comment-LED line, and a block-comment
 * CONTINUATION line reading `on mount { ... }` matched the lifecycle pattern
 * and REFUSED a legal file (`db-locus-blockcomment-fp-2026-08-26`). A pattern
 * cannot express "am I inside a region that began on an EARLIER line" — only
 * carried state can. So the comment model is a state machine, and the lifecycle
 * test stays the ONE anchored pattern it always was, run against this
 * machine's OUTPUT.
 *
 * Masking (rather than skipping the line) is what buys the close-then-statement
 * case: a line whose block comment terminates and is FOLLOWED by
 * `on dismount { ... }` masks its terminator to spaces, and the anchored
 * lifecycle pattern still matches the statement — which MUST still fire.
 * Spaces rather than deletion so `masked.length === line.length` and the span
 * arithmetic in the caller stays byte-exact against the ORIGINAL source.
 *
 * ── WHAT IS DELIBERATELY NOT MODELLED: STRING LITERALS ──────────────────────
 *
 * A JS tokenizer would also track `'` / `"` / backtick so a comment opener
 * inside a string is not an opener. This scan does NOT, and that is deliberate:
 * a state-block body is MARKUP context, so its text children are PROSE, and
 * prose is full of apostrophes (`don't`, `it's`). A string-literal tracker over
 * prose would open a "string" at every contraction and never close it, turning
 * free text into an unbounded suppression region — a defect in the same family
 * as the one this fixes. The residual cost is an opener inside a string literal
 * reading as a comment, which SUPPRESSES the diagnostic. That direction is the
 * safe one for a REFUSE gate: a false negative restores the pre-lint status quo
 * (silent page text), while a false positive REJECTS A LEGAL FILE — which is
 * precisely the defect being closed here.
 *
 * @param {string} line — one source line, the `\n` already stripped
 * @param {{ inBlockComment: boolean }} state — carried across lines; MUTATED
 * @returns {string} the line with every comment region replaced by spaces
 */
function maskCommentRegions(line, state) {
  let masked = "";
  let i = 0;
  while (i < line.length) {
    if (state.inBlockComment) {
      // Inside a block comment. scrml/JS block comments do NOT nest, so the
      // FIRST terminator closes — an opener that appears inside an already-open
      // comment is inert, and one terminator ends the whole run.
      const close = line.indexOf(BLOCK_COMMENT_CLOSE, i);
      if (close === -1) {
        masked += " ".repeat(line.length - i);
        i = line.length;
      } else {
        masked += " ".repeat(close + BLOCK_COMMENT_CLOSE.length - i);
        i = close + BLOCK_COMMENT_CLOSE.length;
        state.inBlockComment = false;
      }
      continue;
    }
    const lineCommentAt = line.indexOf(LINE_COMMENT_OPEN, i);
    const blockOpenAt = line.indexOf(BLOCK_COMMENT_OPEN, i);
    if (lineCommentAt === -1 && blockOpenAt === -1) {
      masked += line.slice(i);
      i = line.length;
    } else if (
      blockOpenAt === -1 ||
      (lineCommentAt !== -1 && lineCommentAt < blockOpenAt)
    ) {
      // A line comment comes first, so the REST of this line is comment and any
      // block opener after it is inert — `// see /` + `* below` opens nothing,
      // and the NEXT line is scanned normally.
      masked +=
        line.slice(i, lineCommentAt) + " ".repeat(line.length - lineCommentAt);
      i = line.length;
    } else {
      masked +=
        line.slice(i, blockOpenAt) + " ".repeat(BLOCK_COMMENT_OPEN.length);
      i = blockOpenAt + BLOCK_COMMENT_OPEN.length;
      state.inBlockComment = true;
    }
  }
  return masked;
}

/**
 * Scan a state block's DIRECT text children for a lifecycle statement form.
 *
 * Only direct text children are scanned — the same domain as the sibling
 * `scanStateBlockBareWriteDecls`. Nested deeper markup is prose context and is
 * governed by its own element's body mode.
 *
 * Block-comment state is carried ACROSS the direct text children of ONE state
 * block, and reset at each state block. So an opener the block splitter
 * happened to split around — because it parsed an element out of the middle of
 * a commented-out run — still suppresses what follows. That is both faithful to
 * comment semantics and the fail-OPEN direction this gate wants.
 */
function scanStateBlockChildren(node, filePath, diagnostics) {
  const commentState = { inBlockComment: false };
  for (const child of node.children || []) {
    if (!child || child.type !== "text" || typeof child.raw !== "string") continue;
    // `child.span` locates `child.raw[0]` in the SOURCE, all three fields
    // agreeing: `start` is the byte offset and `line`/`col` are its 1-based
    // position. MEASURED, not assumed — for `<db …>on mount { go() }</db>` BS
    // records `{start:132, line:5, col:42}` and byte 132 does resolve to line 5,
    // column 42.
    const baseLine =
      child.span && typeof child.span.line === "number" ? child.span.line : 1;
    const baseCol =
      child.span && typeof child.span.col === "number" ? child.span.col : 1;
    const baseStart =
      child.span && typeof child.span.start === "number" ? child.span.start : 0;

    let offset = 0;
    const lines = child.raw.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      // Comments are masked to spaces FIRST, then the ONE anchored lifecycle
      // pattern runs against the masked text. Because the mask preserves
      // length, every column derived below is an offset into the ORIGINAL line.
      const masked = maskCommentRegions(line, commentState);
      const m = masked.match(STATE_BLOCK_ON_LIFECYCLE_RE);
      if (m) {
        const colStart = masked.length - masked.trimStart().length;
        // ⚠ `colStart` is an offset into `line`, NOT a source column, and the
        // two coincide only from the SECOND line of the child onward. A text
        // child can begin mid-line — `<db …>on mount { go() }</db>` puts the
        // whole child on the opener's line — and for that child line 0 starts at
        // source column `baseCol`, not at column 1. Emitting `colStart + 1`
        // unconditionally reported col 1 for a statement at col 42, so `col`
        // disagreed with the byte-exact `span.start` beside it and any consumer
        // that navigates by line/col (LSP, editor, formatter) jumped to the
        // wrong place — in a diagnostic whose entire job is to point at the
        // offending statement. Every earlier fixture put the statement on its
        // own line, which is why the suite never saw it.
        //
        // The LINE needs no such correction and must not be given one:
        // `baseLine` is the line of `raw[0]`, which IS line 0 of the child, and
        // each split consumes exactly one `\n`. So `baseLine + li` is already
        // right at `li === 0` and at every later line.
        const col = li === 0 ? baseCol + colStart : colStart + 1;
        const span = {
          file: filePath,
          start: baseStart + offset + colStart,
          end: baseStart + offset + line.length,
          line: baseLine + li,
          col,
        };
        diagnostics.push({
          filePath,
          line: span.line,
          column: span.col,
          code: DIAGNOSTIC_CODE,
          // `E-` prefix + severity:"error" partition this into
          // `result.errors` (fatal; CLI exit 1) — the whole point of the
          // ruling. The sibling write-form lint stays Info.
          severity: "error",
          message: buildMessage(m[1]),
          span,
        });
      }
      offset += line.length + 1; // +1 for the consumed "\n"
    }
  }
}

function walk(blocks, filePath, diagnostics) {
  if (!Array.isArray(blocks)) return;
  for (const node of blocks) {
    if (!node) continue;
    if (isStateBlock(node)) scanStateBlockChildren(node, filePath, diagnostics);
    walk(node.children || [], filePath, diagnostics);
  }
}

/**
 * @param {Array<{ filePath?: string, blocks?: object[] }>} bsResults — array of
 *   block-splitter results (`{ filePath, blocks, errors }`)
 * @returns {Array<{ filePath: string, line: number, column: number, code: string,
 *   severity: string, message: string, span: object }>}
 */
export function runEStateBlockStatementForm(bsResults) {
  const diagnostics = [];
  if (!bsResults || !Array.isArray(bsResults)) return diagnostics;
  for (const result of bsResults) {
    if (!result || !Array.isArray(result.blocks)) continue;
    walk(result.blocks, result.filePath || "", diagnostics);
  }
  return diagnostics;
}
