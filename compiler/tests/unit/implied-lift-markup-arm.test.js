/**
 * implied-lift-markup-arm — §17.6.10 / §10.1: the implied `lift` of a
 * single-markup-expression control-flow arm.
 *
 * Gap: `g-if-arm-bare-markup-branch-silently-dropped` (HIGH, adopter-reported,
 * routed S377, built S433).
 *
 *   ${ if (@on) { <p>Yes</p> } else { <p>No</p> } }
 *
 * rendered NOTHING — exit 0, zero diagnostics. The discriminator that named the
 * defect is the arm's VALUE, not the control-flow form: the same arms holding a
 * STRING render, and `{ lift <p>Yes</p> }` renders, so the compiler accepted a
 * string-valued and a lifted arm and dropped a bare MARKUP-valued one.
 *
 * SPEC is normative FOR the shape, so these tests pin conformance rather than a
 * new feature:
 *   §10.1 limb 2 (S391 amendment, `provenance: ruling:user-voice-scrml.md S371
 *     "value-form b"`) — "an arm body that is exactly one expression carries an
 *     implied `lift` of that expression".
 *   §17.6.10 — "A branch body that is exactly one expression SHALL be
 *     equivalent to `{ lift <expression> }`."
 *   §1.4 / L1 — "markup elements may sit anywhere expressions sit."
 *
 * THE BAR THESE TESTS ENFORCE is that equivalence, measured: for each shape the
 * bare-markup spelling and the explicit-`lift` spelling must emit the same DOM
 * construction. A test that merely asserted "something is emitted" would have
 * passed the first cut of the fix, which half-converted a cascade and left one
 * branch silently empty.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `implied_lift_${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
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
    for (const [fp, output] of result.outputs ?? []) {
      if (fp.includes(tag)) {
        html = output.html ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"), html, clientJs, tag };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

/**
 * Strip everything that legitimately differs between the two spellings — the
 * content-derived chunk-scope namespace, the temp file name, and gensym
 * ordinals — so what remains is the DOM construction itself.
 */
function shape(clientJs, tag) {
  if (!clientJs) return "";
  return clientJs
    .replace(new RegExp(tag, "g"), "X")
    // The chunk-scope namespace is a hash of the file's CONTENT, so the two
    // spellings differ there by construction (one of them holds the word
    // `lift`). Normalise every occurrence, wherever it appears.
    // (An `_`-delimited hash has no `\b` on its left, hence the explicit
    // character lookaround rather than a word boundary.)
    .replace(/(?<![0-9a-z])0[0-9a-z]{7}(?![0-9a-z])/g, "NS")
    .replace(/_(\d+)\b/g, "_N")
    .replace(/\s+/g, " ")
    .trim();
}

/** The two spellings must agree — that is §17.6.10's asserted equivalence. */
function expectLiftParity(bareSrc, liftSrc) {
  const bare = compileSource(bareSrc);
  const lift = compileSource(liftSrc);
  expect(lift.errors.map((e) => e.code)).toEqual([]);
  expect(bare.errors.map((e) => e.code)).toEqual([]);
  // Guard against a vacuous pass: the `lift` spelling must actually build DOM.
  expect(lift.clientJs).toContain("document.createElement");
  expect(shape(bare.clientJs, bare.tag)).toBe(shape(lift.clientJs, lift.tag));
  return bare;
}

const HEAD = `<div id="root">\n    \${\n        <on> = true\n        <n> = 3\n    }\n`;
const TAIL = `</div>\n`;

describe("§17.6.10 implied lift — a bare-markup arm renders", () => {
  test("the reported instance: if/else with a bare markup arm", () => {
    const bare = expectLiftParity(
      `${HEAD}    \${ if (@on) { <p>Yes</p> } else { <p>No</p> } }\n${TAIL}`,
      `${HEAD}    \${ if (@on) { lift <p>Yes</p> } else { lift <p>No</p> } }\n${TAIL}`,
    );
    // The defect was a SILENT drop, so pin the positive signal explicitly: both
    // branch bodies reach the emitted client JS, and a render anchor exists.
    expect(bare.clientJs).toContain('document.createTextNode("Yes")');
    expect(bare.clientJs).toContain('document.createTextNode("No")');
    expect(bare.html).toContain("data-scrml-logic");
  });

  test("a bare markup arm with NO else", () => {
    expectLiftParity(
      `${HEAD}    \${ if (@on) { <p>Yes</p> } }\n${TAIL}`,
      `${HEAD}    \${ if (@on) { lift <p>Yes</p> } }\n${TAIL}`,
    );
  });

  test("an else-if cascade, every link a bare markup arm", () => {
    const bare = expectLiftParity(
      `${HEAD}    \${ if (@n > 2) { <p>big</p> } else if (@n > 0) { <p>small</p> } else { <p>none</p> } }\n${TAIL}`,
      `${HEAD}    \${ if (@n > 2) { lift <p>big</p> } else if (@n > 0) { lift <p>small</p> } else { lift <p>none</p> } }\n${TAIL}`,
    );
    for (const t of ["big", "small", "none"]) {
      expect(bare.clientJs).toContain(`document.createTextNode("${t}")`);
    }
  });

  test("an if NESTED inside a bare-markup cascade", () => {
    const bare = expectLiftParity(
      `${HEAD}    \${ if (@on) { if (@n > 0) { <p>deep</p> } else { <p>zero</p> } } else { <p>off</p> } }\n${TAIL}`,
      `${HEAD}    \${ if (@on) { if (@n > 0) { lift <p>deep</p> } else { lift <p>zero</p> } } else { lift <p>off</p> } }\n${TAIL}`,
    );
    for (const t of ["deep", "zero", "off"]) {
      expect(bare.clientJs).toContain(`document.createTextNode("${t}")`);
    }
  });

  test("a nested markup SUBTREE in the arm", () => {
    const bare = compileSource(
      `${HEAD}    \${ if (@on) { <div class="w"><span>x</span></div> } else { <p>No</p> } }\n${TAIL}`,
    );
    expect(bare.errors.map((e) => e.code)).toEqual([]);
    expect(bare.clientJs).toContain('document.createElement("div")');
    expect(bare.clientJs).toContain('document.createElement("span")');
    expect(bare.clientJs).toContain('setAttribute("class", "w")');
  });

  test("a self-closing / void element arm", () => {
    expectLiftParity(
      `${HEAD}    \${ if (@on) { <hr/> } else { <br/> } }\n${TAIL}`,
      `${HEAD}    \${ if (@on) { lift <hr/> } else { lift <br/> } }\n${TAIL}`,
    );
  });

  test("an arm whose markup carries an EVENT HANDLER wires it", () => {
    const src = (kw) =>
      `<div id="root">\n    \${\n        <on> = true\n        function go() { @on = false }\n    }\n` +
      `    \${ if (@on) { ${kw}<button onclick=go()>Go</button> } else { ${kw}<p>No</p> } }\n${TAIL}`;
    const bare = expectLiftParity(src(""), src("lift "));
    expect(bare.clientJs).toContain("addEventListener");
  });

  test("an arm holding a COMPONENT is expanded, not emitted as a phantom tag", () => {
    const src = (kw) =>
      `<div id="root">\n    \${\n        const Badge = <span class="bdg">B</>\n        <on> = true\n    }\n` +
      `    \${ if (@on) { ${kw}<Badge/> } else { ${kw}<p>No</p> } }\n${TAIL}`;
    const bare = expectLiftParity(src(""), src("lift "));
    // The component must have been EXPANDED — the pass runs ahead of CE. A
    // `createElement("Badge")` here would be the residual-component failure.
    expect(bare.clientJs).toContain('document.createElement("span")');
    expect(bare.clientJs).not.toContain('createElement("Badge")');
  });
});

describe("§17.6.10 implied lift — the fragmented arm (one expression, several nodes)", () => {
  // The block-splitter hoists a `${…}` inside the arm's markup to a sibling
  // BLOCK_REF node, so `{ <p>n=${@n}</p> }` is ONE expression spread over
  // [html-fragment, logic, html-fragment]. The first cut of the fix counted
  // nodes and declined it — that branch stayed silently empty while its sibling
  // rendered. This is the commonest adopter spelling, so it gets its own block.
  test("an arm whose markup interpolates a reactive cell", () => {
    const bare = expectLiftParity(
      `${HEAD}    \${ if (@on) { <p>n=\${@n}</p> } else { <p>No</p> } }\n${TAIL}`,
      `${HEAD}    \${ if (@on) { lift <p>n=\${@n}</p> } else { lift <p>No</p> } }\n${TAIL}`,
    );
    expect(bare.clientJs).toContain('document.createTextNode("n=")');
    // The interpolation must be a live reactive READ, not a baked constant —
    // that is what distinguishes a recovered markup tree from a text dump.
    expect(bare.clientJs).toContain('_scrml_cs_reactive_get("n")');
  });
});

describe("§17.6.10 implied lift — inside a <match for=…> arm", () => {
  // emit-match re-parses the arm body from `entry.bodyRaw` at emit time, which
  // discards the pipeline-stage desugar; without the re-application at that
  // site the branches dropped here while the identical interpolation at file
  // level rendered.
  const matchSrc = (kw) =>
    `<div id="root">\n    \${\n        type View = .List | .Grid\n        <view>: View = View.List\n        <on> = true\n    }\n` +
    `    <match for=View on=@view>\n        <List>\${ if (@on) { ${kw}<p>L</p> } else { ${kw}<p>x</p> } }</List>\n` +
    `        <Grid><p>G</p></Grid>\n    </match>\n${TAIL}`;

  test("a bare-markup arm inside a match arm renders, at lift parity", () => {
    const bare = expectLiftParity(matchSrc(""), matchSrc("lift "));
    expect(bare.clientJs).toContain('document.createTextNode("L")');
    expect(bare.clientJs).toContain('document.createTextNode("x")');
  });
});

describe("§17.6.10 implied lift — inside a COMPONENT body", () => {
  // `parseComponentBody` re-parses a component definition's body from
  // `normalizeTokenizedRaw(raw)`, which throws away the copy the pipeline-stage
  // pass desugared — so a bare-markup arm inside a component body stayed dropped
  // while the identical interpolation OUTSIDE a component rendered, and while the
  // component's own explicit-`lift` twin rendered. A live asymmetry against the
  // equivalence §17.6.10 asserts. Third re-parse site; see the module docstring
  // on why the durable placement is the TAB.
  const compSrc = (kw) =>
    `<div id="root">\n    \${\n        <on> = true\n` +
    `        const Card = <div class="c">\${ if (@on) { ${kw}<p>MARKA</p> } else { ${kw}<p>MARKB</p> } }</>\n    }\n` +
    `    <Card/>\n${TAIL}`;

  test("a bare-markup arm in a component body renders, at lift parity", () => {
    const bare = expectLiftParity(compSrc(""), compSrc("lift "));
    expect(bare.clientJs).toContain('document.createTextNode("MARKA")');
    expect(bare.clientJs).toContain('document.createTextNode("MARKB")');
  });
});

describe("§17.6.10 implied lift — the boundaries it must NOT cross", () => {
  test("a statement-position if in a FUNCTION body gains no lift", () => {
    // `lift` in a function body is not an accumulation into a markup parent, so
    // synthesising one there would change what the code means rather than
    // restore what it says. The arm keeps its pre-existing (dropped) behaviour.
    const r = compileSource(
      `<div id="root">\n    \${\n        <on> = true\n        function f() {\n            if (@on) { <p>never</p> }\n        }\n    }\n` +
      `    <button onclick=f()>go</button>\n${TAIL}`,
    );
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).not.toContain('document.createTextNode("never")');
  });

  test("an arm holding TWO markup elements is not a value-form and is not converted", () => {
    // §17.6.10's grammar is `'{' expression '}'` — exactly ONE expression
    // (invariant 83: a local `length !== 1` test, not §18.5's positional tail
    // rule). Two elements are outside it, so the pass declines. Conversion is
    // ALL-OR-NOTHING per cascade, so the sibling `else` arm is left alone too
    // rather than rendering half the construct and implying the shape is
    // supported. Tracked separately as a silent-drop gap.
    const r = compileSource(
      `${HEAD}    \${ if (@on) { <p>A</p><p>B</p> } else { <p>No</p> } }\n${TAIL}`,
    );
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).not.toContain('document.createTextNode("A")');
    // The all-or-nothing rule: the convertible sibling is NOT half-emitted.
    expect(r.clientJs).not.toContain('document.createTextNode("No")');
  });

  // ⛑ THE ALL-OR-NOTHING INVARIANT, PER ARM POSITION. These three shapes are the
  // ones the original 13 tests had no analogue of — every arm in them led with
  // markup — and the invariant was stated in the module header and NOT enforced
  // for an arm whose markup is not the first piece. All three half-rendered at
  // exit 0 with no diagnostic: the other arms converted and this one stayed
  // dropped, which is worse than the uniform drop because the working half argues
  // the construct is supported. `else { log(…)  <p>…</p> }` is ordinary code.
  //
  // Base-side result for all three (measured at 280ecbdd): NOTHING renders.
  // So the bar is "still nothing", not "everything" — the cascade must revert
  // WHOLE, and the test asserts the sibling arm is absent too.
  const STMT_HEAD = `<div id="root">\n    \${\n        <on> = true\n        <n> = 1\n        <k> = 0\n    }\n`;

  test("a STATEMENT-LED consequent declines the whole cascade (no half-render)", () => {
    const r = compileSource(`${STMT_HEAD}    \${ if (@on) { @k = 1 <p>MARKA</p> } else { <p>MARKB</p> } }\n${TAIL}`);
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).not.toContain("MARKA");
    // The sibling arm must NOT render on its own — that was the defect.
    expect(r.clientJs).not.toContain("MARKB");
  });

  test("a STATEMENT-LED alternate declines the whole cascade (no half-render)", () => {
    const r = compileSource(
      `${STMT_HEAD}    \${ if (@on) { <p>MARKA</p> } else { @k = 1\n        <p>MARKB</p> } }\n${TAIL}`,
    );
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).not.toContain("MARKB");
    expect(r.clientJs).not.toContain("MARKA");
  });

  test("a statement-led MIDDLE arm declines the whole three-arm cascade", () => {
    const r = compileSource(
      `${STMT_HEAD}    \${ if (@n > 2) { <p>MARKA</p> } else if (@n > 0) { @k = 1\n        <p>MARKMID</p> } else { <p>MARKC</p> } }\n${TAIL}`,
    );
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).not.toContain("MARKMID");
    // Arms 1 and 3 converted while the middle stayed dropped — the exact shape.
    expect(r.clientJs).not.toContain("MARKA");
    expect(r.clientJs).not.toContain("MARKC");
  });

  test("REGRESSION GUARD for that decline: an `else if` cascade and a nested `if` still CONVERT", () => {
    // The first cut of the decline scanned the arm's whole source extent, which
    // spans a nested `if`'s arms — so it declined every cascade and every
    // nested-`if` arm, undoing two shapes the fix had already covered. The scan
    // skips `if-stmt` pieces because the recursion already owns their markup.
    const cascade = compileSource(
      `${STMT_HEAD}    \${ if (@n > 2) { <p>MARKA</p> } else if (@n > 0) { <p>MARKMID</p> } else { <p>MARKC</p> } }\n${TAIL}`,
    );
    expect(cascade.errors.map((e) => e.code)).toEqual([]);
    for (const m of ["MARKA", "MARKMID", "MARKC"]) expect(cascade.clientJs).toContain(m);

    const nested = compileSource(
      `${STMT_HEAD}    \${ if (@on) { if (@n > 0) { <p>MARKA</p> } else { <p>MARKB</p> } } else { <p>MARKC</p> } }\n${TAIL}`,
    );
    expect(nested.errors.map((e) => e.code)).toEqual([]);
    for (const m of ["MARKA", "MARKB", "MARKC"]) expect(nested.clientJs).toContain(m);
  });

  test("a STRING arm still takes the value-form route, unchanged", () => {
    // The value-form lowering (a conditional expression + `_scrml_render_value`)
    // is the correct route for a string arm and must not be disturbed.
    const r = compileSource(`${HEAD}    \${ if (@on) { "Yes" } else { "No" } }\n${TAIL}`);
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).toContain("_scrml_render_value");
    expect(r.clientJs).toContain('"Yes"');
    expect(r.clientJs).not.toContain("_scrml_lift(");
  });
});
