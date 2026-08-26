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
 *   - `E-WRITE-NOT-IN-LOGIC-CONTEXT` (SPEC.md:19720): "`<db>` / `<state>`
 *     STATE-block bodies are NOT default-logic-mode loci".
 *   - `W-STATE-BLOCK-BARE-WRITE-DECL` (SPEC.md:19721): "A state-block body is
 *     markup context (SPEC §4)".
 *
 * §40.8's `default-logic` auto-lift — the mode in which `on mount { … }` IS
 * lifted to logic — is scoped to `<program>` / `<page>` / `<channel>` bodies
 * (SPEC.md:1191, the S111 amendment: `default-logic` is "a distinct third
 * body-mode" owned by §40.8). A state block is none of those, so the identical
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
 * locus-specific: SPEC.md:20072 defines it as "A bare `@name = init` directly in
 * a `<db>` / `<state>` STATE-block markup body is rejected. Deprecation cycle
 * endpoint — activates after the W-STATE-BLOCK-BARE-WRITE-DECL window". An
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
 * detection domain is byte-identical to the sibling's (a state block's DIRECT
 * text children), so nothing is lost by the relocation.
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
 */
function isStateBlock(node) {
  if (!node) return false;
  if (node.type === "state") return true;
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
 * Scan a state block's DIRECT text children for a lifecycle statement form.
 *
 * Only direct text children are scanned — the same domain as the sibling
 * `scanStateBlockBareWriteDecls`. Nested deeper markup is prose context and is
 * governed by its own element's body mode.
 */
function scanStateBlockChildren(node, filePath, diagnostics) {
  for (const child of node.children || []) {
    if (!child || child.type !== "text" || typeof child.raw !== "string") continue;
    const baseLine =
      child.span && typeof child.span.line === "number" ? child.span.line : 1;
    const baseStart =
      child.span && typeof child.span.start === "number" ? child.span.start : 0;

    let offset = 0;
    const lines = child.raw.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      // `//`-led comment lines are not scanned — same carve-out the sibling
      // write-form scan makes.
      if (!/^\s*\/\//.test(line)) {
        const m = line.match(STATE_BLOCK_ON_LIFECYCLE_RE);
        if (m) {
          const colStart = line.length - line.trimStart().length;
          const span = {
            file: filePath,
            start: baseStart + offset + colStart,
            end: baseStart + offset + line.length,
            line: baseLine + li,
            col: colStart + 1,
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
