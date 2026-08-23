/**
 * default-logic-comment-lift — S368 regression tests.
 *
 * SURFACED BY A HUMAN AUTHOR hand-writing scrml, not by a generated corpus.
 * The reproducer is archived at `docs/changes/default-logic-line-comment/`.
 *
 * BUG. A text run at a §40.8 default-logic root (`<program>` / `<page>` /
 * `<channel>` direct-child position) is lifted into a synthetic `${...}` logic
 * block only if it matches one of eight `^`-ANCHORED shape regexes in
 * `liftBareDeclarations` (ast-builder.js). A source comment defeated those
 * gates in two OPPOSITE directions, and both produce SILENT WRONG OUTPUT —
 * exit 0, zero diagnostics, the code shipped into the DOM as literal page text:
 *
 *   1. FLUSH (`// line comment`). BS extracts a line comment as its own
 *      `comment` child, SPLITTING one authored run into two text blocks. A
 *      statement that was riding a run whose LEADING content was a declaration
 *      becomes the head of a fresh run, matches nothing, and leaks.
 *
 *   2. ANCHOR DEFEAT (`/* block comment *​/`). A block comment stays INSIDE the
 *      run, so the run begins with `/*`. Every gate permits only `\s*` before
 *      its keyword, so the comment blocks the match and the DECLARATION ITSELF
 *      leaks — a leading block comment before `fn f(){...}` shipped the whole
 *      function into `<body>` as text.
 *
 * THE MASKING LIMB. A defect that turns code into text also suppresses every
 * diagnostic that code would have raised. In the operator's file the swallowed
 * statement was `log(@wop)` with `@wop` undeclared, and `E-STATE-UNDECLARED`
 * did NOT fire — the statement was never compiled. The fix must restore BOTH:
 * the statement compiles, AND its diagnostics fire. That is the merge-blocker.
 *
 * FIX. Normalise the INPUT the eight existing gates see rather than adding a
 * ninth shape regex (`TILDE_TOKEN_RE` and `TOPLEVEL_ON_LIFECYCLE_RE` were
 * already added to work around direction 1 for one shape each — this was the
 * third report of the same root cause). `coalesceCommentSeparatedRun` rejoins
 * byte-contiguous text/comment siblings; `stripLeadingComments` removes leading
 * comments for the gate TEST only. Merging is deliberately MINIMAL: a following
 * fragment that clears a gate ON ITS OWN is left alone, so a run that already
 * lifted correctly keeps its exact previous AST shape.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Compile a source string through the full pipeline and return the emitted
 * `<body>` text plus the diagnostics.
 *
 * The assertion has to read the EMITTED BODY, not the AST: the whole defect is
 * that the construct reaches the DOM as text, and an AST-shape assertion would
 * pass on a build that still shipped the leak.
 */
function compileSource(scrmlSource) {
  const tag = `dlc-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_default_logic_comment_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let html = null;
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        html = output.html ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    const bodyMatch = html ? html.match(/<body>([\s\S]*?)<\/body>/) : null;
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      body: bodyMatch ? bodyMatch[1] : "",
      clientJs: clientJs ?? "",
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

function codesOf(diags) {
  return diags.map((e) => e.code ?? "");
}

describe("S368 — a source comment must not defeat the §40.8 default-logic lift", () => {
  // -------------------------------------------------------------------------
  // Direction 1 — the `//` FLUSH. This is the operator's reproducer.
  // -------------------------------------------------------------------------

  test("MERGE-BLOCKER: a `//`-separated statement compiles instead of shipping as page text", () => {
    const { body, clientJs } = compileSource(
      `<program>\nconst bias = 1.2\n// c\nlog("MARKER_ONE");\n<p>ok</>\n</program>\n`,
    );
    // The statement is NOT in the rendered page.
    expect(body).not.toContain(`log("MARKER_ONE")`);
    // ...because it was compiled into the client bundle.
    expect(clientJs).toContain("MARKER_ONE");
  });

  test("MERGE-BLOCKER: a diagnostic inside the swallowed run still fires", () => {
    // `@wop` is undeclared. Pre-fix this compiled EXIT 0 with zero diagnostics,
    // because the statement carrying the read was never parsed at all.
    const { errors } = compileSource(
      `<program>\nconst bias = 1.2\n// c\nlog(@wop);\n<p>ok</>\n</program>\n`,
    );
    expect(codesOf(errors)).toContain("E-STATE-UNDECLARED");
  });

  test("the comment's POSITION is what mattered — a `fn` in the file is not the determinant", () => {
    // Measured during triage: `decl / fn / // c / log(@wop)` was silent while
    // `decl / // c / fn / log(@wop)` errored, which read as "adding a `fn`
    // suppresses the diagnostic". It is not: the determinant is whether the
    // comment sits between the last declaration and the swallowed statement.
    // Both orderings must now report.
    const commentBeforeFn = compileSource(
      `<program>\nconst bias = 1.2\n// c\nfn f(a: number){ return a }\nlog(@wop);\n<p>ok</>\n</program>\n`,
    );
    const commentAfterFn = compileSource(
      `<program>\nconst bias = 1.2\nfn f(a: number){ return a }\n// c\nlog(@wop);\n<p>ok</>\n</program>\n`,
    );
    expect(codesOf(commentBeforeFn.errors)).toContain("E-STATE-UNDECLARED");
    expect(codesOf(commentAfterFn.errors)).toContain("E-STATE-UNDECLARED");
  });

  test("every statement of a multi-statement run is rescued, not just the first", () => {
    const { body, clientJs } = compileSource(
      `<program>\nconst bias = 1.2\n// c\nlog("MARK_A")\nlog("MARK_B")\nlog("MARK_C")\n<p>ok</>\n</program>\n`,
    );
    for (const m of ["MARK_A", "MARK_B", "MARK_C"]) {
      expect(body).not.toContain(`log("${m}")`);
      expect(clientJs).toContain(m);
    }
  });

  // -------------------------------------------------------------------------
  // Direction 2 — the `/* */` ANCHOR DEFEAT. Strictly more severe: it leaks
  // canonical DECLARATIONS, and it was recorded during triage as "clean".
  // -------------------------------------------------------------------------

  test("a leading block comment must not leak a `fn` declaration as page text", () => {
    const { body, clientJs } = compileSource(
      `<program>\n/* c */\nfn markerFn(a: number){ return a }\n<p>ok</>\n</program>\n`,
    );
    expect(body).not.toContain("fn markerFn");
    expect(clientJs).toContain("markerFn");
  });

  test("a leading block comment must not leak a `const` declaration as page text", () => {
    const { body, clientJs } = compileSource(
      `<program>\n/* c */\nconst markerConst = 1.2\n<p>ok</>\n</program>\n`,
    );
    expect(body).not.toContain("const markerConst");
    expect(clientJs).toContain("markerConst");
  });

  test("a leading LINE comment must not leak a `const` declaration as page text", () => {
    const { body, clientJs } = compileSource(
      `<program>\n// c\nconst markerLine = 1.2\n<p>ok</>\n</program>\n`,
    );
    expect(body).not.toContain("const markerLine");
    expect(clientJs).toContain("markerLine");
  });

  // -------------------------------------------------------------------------
  // Guards — the normalisation must not start rendering comments, must not
  // widen what default-logic mode admits, and must not disturb the pairing
  // gates that consume a FOLLOWING markup block.
  // -------------------------------------------------------------------------

  test("a comment that is not part of a lifted run never renders as page text", () => {
    // No gate fires here (no declaration anywhere in the body), so the ORIGINAL
    // blocks are pushed unchanged and the comment must stay invisible.
    const { body } = compileSource(
      `<program>\n// COMMENT_TEXT_MUST_NOT_RENDER\n<p>ok</>\n</program>\n`,
    );
    expect(body).not.toContain("COMMENT_TEXT_MUST_NOT_RENDER");
  });

  test("a comment inside a lifted run does not render either", () => {
    const { body } = compileSource(
      `<program>\nconst bias = 1.2\n// INNER_COMMENT_MUST_NOT_RENDER\nlog("x");\n<p>ok</>\n</program>\n`,
    );
    expect(body).not.toContain("INNER_COMMENT_MUST_NOT_RENDER");
  });

  test("the `const Name = <markup>` pairing gate still pairs across a leading comment", () => {
    // Coalescing declines when the merged run trails with a pairing shape, so
    // the component-def branch keeps its block-indexed markup pairing. Without
    // that guard this emitted a dangling `const Name = ` logic body and failed
    // with E-CODEGEN-INVALID-LOGIC.
    const { errors } = compileSource(
      `<program>\n// c\nconst PairCard = <div>hi</>\n<p>ok</>\n</program>\n`,
    );
    expect(codesOf(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("prose after a comment in a plain markup body is still prose, not logic", () => {
    // The normalisation is gated to non-markup parents (`parentType !==
    // "markup"`). Inside a `<div>` the comment still flushes the text run, but
    // the following prose must NOT be lifted — otherwise `function words are
    // prose` would parse as a declaration and the paragraph would vanish (the
    // exact failure mode `bare-decl-markup-text-no-lift.test.js` guards).
    //
    // NOTE (pre-existing, out of scope): a `//` on the SAME line as a closer —
    // `<p>the // operator divides</>` — makes BS treat the rest of the line as
    // a comment and eat the `</>`, yielding E-CTX-001/E-CTX-003. Identical
    // before and after this change; verified by direct compile at the
    // merge-base. Probed here with the comment on its own line so the guard
    // under test is the LIFT gating, not that BS behaviour.
    const { body, errors } = compileSource(
      `<program>\nconst bias = 1.2\n<div>\n// note\nfunction words are prose here\n</>\n</program>\n`,
    );
    expect(body).toContain("function words are prose here");
    expect(codesOf(errors)).not.toContain("E-SCOPE-001");
  });

  test("a run that already lifted keeps its previous shape — no gratuitous consolidation", () => {
    // Two declaration runs separated by a comment BOTH lift on their own today.
    // Merging them would consolidate two logic nodes into one and move the
    // emitted artifact for no benefit, so the coalescer must stop before a
    // fragment that clears a gate by itself.
    const { body, clientJs } = compileSource(
      `<program>\nfn first(a: number){ return a }\n// c\nfn second(b: number){ return b }\n<p>ok</>\n</program>\n`,
    );
    expect(body).not.toContain("fn first");
    expect(body).not.toContain("fn second");
    expect(clientJs).toContain("first");
    expect(clientJs).toContain("second");
  });
});
