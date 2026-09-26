/**
 * S432 (ALTERNATIVE B) — a bare `when … changes { … }` LEADING a text run at a
 * <program>/<page>/<channel> default-logic body-top is REJECTED with
 * E-WHEN-NOT-IN-LOGIC-CONTEXT (SPEC §40.8 S432-B; §6.7.4) instead of page text.
 *
 * Pre-fix: the statement reached the logic-body parser only when it SHARED a
 * block-splitter text run with a preceding declaration (`<x> = 0\nwhen …` lifts
 * the whole run via TOPLEVEL_STATE_DECL_RE). Written after the first markup
 * child, after a `${}` block, after a `//` comment, or as the FIRST statement
 * of a run, it was a standalone text block led by `when`, matched no lift gate,
 * and shipped RAW into the DOM as page text — at exit 0, zero diagnostics, the
 * effect never registered. A leading `when` also dragged the declarations that
 * followed it in its run down to text.
 *
 * Fix (B): ast-builder.js TOPLEVEL_WHEN_STMT_RE gate (isDefaultLogicBody)
 * fires E-WHEN-NOT-IN-LOGIC-CONTEXT and recovers by lifting the run. A `when`
 * sharing a run with a preceding declaration is still lifted, silently. The
 * signature is the §6.7.4 head, or the §4.12.4 `when message|error … {` head.
 *
 * The file also pins the rest of the S432 measurement table (shape × position)
 * so a change to any neighbouring gate shows up here.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "when-lift-"));
let seq = 0;

function compile(src) {
  const name = `wl${++seq}`;
  const p = join(TMP, `${name}.scrml`);
  writeFileSync(p, src);
  const r = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
  let html = "";
  let js = "";
  let workers = "";
  for (const [fp, o] of r.outputs ?? []) {
    if (!fp.includes(name)) continue;
    html += o.html ?? "";
    js += o.clientJs ?? "";
    const wb = o.workerBundles;
    if (wb) workers += JSON.stringify(wb instanceof Map ? [...wb] : wb);
  }
  const body = html.split("<body")[1] ?? html;
  const codes = [...(r.errors ?? []), ...(r.warnings ?? [])].map(e => e.code);
  return { r, body, js, workers, codes };
}

// Positions of the shape inside the <program> body.
const AT = {
  // shape leads the first text run (no declaration before it in the run)
  lead: s => `<program>\n${s}\n<x> = 0\n<y> = 0\n<p>\${@x}\${@y}</p>\n</program>\n`,
  // shape shares a text run with a preceding declaration (always worked)
  share: s => `<program>\n<x> = 0\n<y> = 0\n${s}\n<p>\${@x}\${@y}</p>\n</program>\n`,
  // after a user-written ${} block
  afterLogic: s => `<program>\n\${ <x> = 0 }\n\${ <y> = 0 }\n${s}\n<p>\${@x}\${@y}</p>\n</program>\n`,
  // after the first markup child (the reported defect)
  afterMarkup: s => `<program>\n<x> = 0\n<y> = 0\n<p>\${@x}\${@y}</p>\n${s}\n</program>\n`,
  // after a `//` line comment (BS flushes the run at the comment)
  afterComment: s => `<program>\n<x> = 0\n<y> = 0\n// a comment\n${s}\n<p>\${@x}\${@y}</p>\n</program>\n`,
};

const WHEN_ERR = "E-WHEN-NOT-IN-LOGIC-CONTEXT";

describe("S432-B — a `when` leading a body-top run is diagnosed, never page text", () => {
  const forms = [
    ["single dep", `when @x changes { console.log("MK_WHEN") }`],
    ["paren dep-list", `when (@x, @y) changes { console.log("MK_WHEN") }`],
    ["no space before {", `when @x changes{ console.log("MK_WHEN") }`],
    ["multi-line body with a write", `when @x changes {\n  @y = @x * 2\n  console.log("MK_WHEN")\n}`],
    ["body with `<` comparison", `when @x changes { if (@x < 3) { console.log("MK_WHEN") } }`],
  ];
  for (const [formName, src] of forms) {
    for (const [pos, wrap] of Object.entries(AT)) {
      const accepted = pos === "share";
      test(`${formName} @ ${pos}: ${accepted ? "lifted with its run, no error" : "E-WHEN-NOT-IN-LOGIC-CONTEXT, exactly once"}`, () => {
        const { body, codes } = compile(wrap(src));
        expect(body).not.toContain("changes");
        expect(body).not.toContain("MK_WHEN");
        expect(codes.filter(c => c === WHEN_ERR).length).toBe(accepted ? 0 : 1);
      });
    }
  }

  test("the error is an Error (result.errors), names the `${ … }` fix and §40.8", () => {
    const { r } = compile(AT.afterMarkup(`when @x changes { go() }`));
    const e = (r.errors ?? []).filter(x => x.code === WHEN_ERR);
    expect(e.length).toBe(1);
    expect(e[0].message).toMatch(/\$\{ when @x changes/);
    expect(e[0].message).toMatch(/40\.8/);
    expect((r.warnings ?? []).filter(x => x.code === WHEN_ERR).length).toBe(0);
  });

  test("recovery: a LEADING `when` does not cascade E-STATE-UNDECLARED onto its run", () => {
    const { codes } = compile(AT.lead(`when @x changes { console.log("MK_WHEN") }`));
    expect(codes).toContain(WHEN_ERR);
    expect(codes).not.toContain("E-STATE-UNDECLARED");
  });

  test("<page> body-top after markup is diagnosed too", () => {
    const { codes } = compile(
      `<program>\n<page>\n<x> = 0\n<p>\${@x}</p>\nwhen @x changes { console.log("MK_WHEN") }\n</page>\n</program>\n`,
    );
    expect(codes).toContain(WHEN_ERR);
  });

  test("the canonical fix — `${ when … }` after markup — is clean", () => {
    const { codes, js } = compile(AT.afterMarkup(`\${ when @x changes { console.log("MK_WHEN") } }`));
    expect(codes).not.toContain(WHEN_ERR);
    expect(js).toContain("MK_WHEN");
  });
});
describe("S432 — no false positive: prose and non-default-logic loci stay text", () => {
  const prose = [
    "when the value changes, the log updates.",
    "when @x changes you will see it",
    "When @x changes { it is shown }", // capitalised: not the keyword
    "when x changes { … }", // no @ sigil on the dependency
    "whenever @x changes { … }",
  ];
  for (const p of prose) {
    test(`prose after markup stays page text: ${JSON.stringify(p)}`, () => {
      const { body } = compile(AT.afterMarkup(p));
      expect(body).toContain(p.split(" ").slice(0, 3).join(" "));
    });
  }

  test("inside nested markup (<div>) the gate does not reach — markup text locus", () => {
    const { body } = compile(`<program>\n<x> = 0\n<div>\nwhen @x changes { go() }\n</div>\n</program>\n`);
    expect(body).toContain("when @x changes");
  });
});

// ---------------------------------------------------------------------------
// The rest of the S432 shape × position table. These are CHARACTERIZATION
// pins, not endorsements: the shapes marked HELD are the open §40.8 hole
// recorded at SPEC §40.8 (S378 note) / §34 E-CONTROL-FLOW-IN-MARKUP (ruling 3,
// HELD by bryan S383) — control flow and bare calls at a body-top ship as page
// text. Whoever closes that hole updates these rows.
// ---------------------------------------------------------------------------
describe("S432 — measurement table: the other shapes after markup", () => {
  const lifted = [
    ["function decl", `function fnA() { return "MK1" }`, "fnA"],
    ["fn decl", `fn fnB() { return "MK2" }`, "fnB"],
    ["server function", `server function sfn() { return 1 }`, "sfn"],
    ["state decl", `<zz> = 5`, "zz"],
    ["derived decl", `const <dd> = @x + 1`, "dd"],
    ["const local", `const cc1 = "MKC1"`, "cc1"],
    ["let local", `let ll1 = "MKL1"`, "ll1"],
    ["on mount", `on mount { console.log("MKOM") }`, "MKOM"],
    ["type decl", `type Colr:enum = { Red, Blue }`, "Colr"],
  ];
  for (const [name, src, probe] of lifted) {
    test(`${name}: lifted (not page text)`, () => {
      const { body } = compile(AT.afterMarkup(src));
      expect(body).not.toContain(probe);
    });
  }

  test("`@x = 1` write: diagnosed E-WRITE-NOT-IN-LOGIC-CONTEXT (S123 Unit CC)", () => {
    const { codes } = compile(AT.afterMarkup(`@x = 7`));
    expect(codes).toContain("E-WRITE-NOT-IN-LOGIC-CONTEXT");
  });

  const held = [
    ["braced if", `if (@x > 0) { console.log("MKIF") }`, "MKIF"],
    ["braceless if", `if (@x > 0) console.log("MKIF2")`, "MKIF2"],
    ["for", `for (const i of [1]) { console.log("MKFOR") }`, "MKFOR"],
    ["while", `while (false) { console.log("MKWH") }`, "MKWH"],
    ["bare call", `console.log("MKCALL")`, "MKCALL"],
    ["cleanup() call", `cleanup(() => console.log("MKCL"))`, "MKCL"],
  ];
  for (const [name, src, probe] of held) {
    test(`${name}: HELD open hole — still page text (characterization, S383)`, () => {
      const { body } = compile(AT.afterMarkup(src));
      expect(body).toContain(probe);
    });
  }
});

process.on("exit", () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});
