/**
 * S432 — a bare `when … changes { … }` at a <program>/<page>/<channel>
 * default-logic body-top is a reactive effect wherever it sits among the
 * body's children (SPEC §40.8 lifecycle-statement lift; §6.7.4).
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
 * Fix: ast-builder.js TOPLEVEL_WHEN_STMT_RE, riding the GITI-029 lifecycle-
 * statement gate (isDefaultLogicBody). The signature is the §6.7.4 grammar
 * head (`when` + @-dep-list + `changes` [+ `reads …`] + `{`) or the §4.12.4
 * worker-handler head (`when message|error … {`), so prose never matches.
 *
 * The file also pins the rest of the S432 measurement table (shape × position)
 * so a change to any neighbouring gate shows up here.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import { TOPLEVEL_WHEN_STMT_RE } from "../../src/ast-builder.js";

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

describe("S432 — bare `when … changes {}` lifts at every body-top position", () => {
  const forms = [
    ["single dep", `when @x changes { console.log("MK_WHEN") }`],
    ["paren dep-list", `when (@x, @y) changes { console.log("MK_WHEN") }`],
    ["no space before {", `when @x changes{ console.log("MK_WHEN") }`],
    ["multi-line body with a write", `when @x changes {\n  @y = @x * 2\n  console.log("MK_WHEN")\n}`],
    ["body with `<` comparison", `when @x changes { if (@x < 3) { console.log("MK_WHEN") } }`],
  ];
  for (const [formName, src] of forms) {
    for (const [pos, wrap] of Object.entries(AT)) {
      test(`${formName} @ ${pos}: registered, not page text, no errors`, () => {
        const { body, js, r } = compile(wrap(src));
        expect(body).not.toContain("changes");
        expect(body).not.toContain("MK_WHEN");
        expect(js).toContain("MK_WHEN");
        expect((r.errors ?? []).filter(e => !String(e.code).startsWith("W-") && e.severity !== "warning")).toEqual([]);
      });
    }
  }

  test("after-markup emit is identical to the always-working shared-run emit", () => {
    const src = `when @x changes { @y = @x + 1 }`;
    const a = compile(AT.share(src)).js;
    const b = compile(AT.afterMarkup(src)).js;
    const effect = s => s.split("\n").filter(l => l.includes("_scrml_when_changes") || l.includes("_scrml_effect") || l.includes('"y"')).join("\n");
    expect(effect(b)).toBe(effect(a));
    expect(effect(b)).not.toBe("");
  });

  test("a LEADING `when` no longer drags the following declarations to page text", () => {
    const { body, codes } = compile(AT.lead(`when @x changes { console.log("MK_WHEN") }`));
    expect(body).not.toContain("<x> = 0");
    expect(codes).not.toContain("E-STATE-UNDECLARED");
  });

  test("<page> body-top after markup lifts too", () => {
    const { body, js } = compile(
      `<program>\n<page>\n<x> = 0\n<p>\${@x}</p>\nwhen @x changes { console.log("MK_WHEN") }\n</page>\n</program>\n`,
    );
    expect(body).not.toContain("changes");
    expect(js).toContain("MK_WHEN");
  });

  test("worker `when message(d) {}` after markup reaches the worker bundle", () => {
    const src = mid =>
      `<program>\n<x> = 0\n<program name="wk">\n${mid}\n</program>\n<p>\${@x}</p>\n</program>\n`;
    const shared = compile(src(`<z> = 0\nwhen message(d) { send("MK_WK" + d) }\n<p>w</p>`));
    const after = compile(src(`<p>w</p>\nwhen message(d) { send("MK_WK" + d) }`));
    expect(shared.workers).toContain("MK_WK"); // control
    expect(after.workers).toContain("MK_WK");
  });

  test("diagnostics on a lifted after-markup `when` match the shared-run position", () => {
    // (E-LIFECYCLE-006 — §6.7.4 self-trigger — has no emit site in compiler/src
    // at 451296f3; a separate finding. What this pins is position-parity.)
    for (const src of [`when @x changes { @x = @x + 1 }`, `when @x changes reads @y { go(@y) }`]) {
      const a = compile(AT.share(src)).codes.sort();
      const b = compile(AT.afterMarkup(src)).codes.sort();
      expect(b).toEqual(a);
    }
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

// ---------------------------------------------------------------------------
// S432 review fixes (F1/F2/F3).
// ---------------------------------------------------------------------------
describe("S432 — the head regex: exact coverage, linear time", () => {
  test("matches the §6.7.4 heads and the INSIDE-worker §43.5.2 heads", () => {
    for (const s of [
      "when @x changes {", "when @x changes{", "  when (@a, @b) changes {", "when (@a)changes {",
      "when @x changes reads @y {", "when @x changes reads @y, @z {",
      "when message {", "when message(d) {", "when message (d) {", "when error(e) {",
    ]) expect(TOPLEVEL_WHEN_STMT_RE.test(s)).toBe(true);
  });

  test("does NOT claim the parent-side `when … from <#w>` head (F1 — the splitter cuts the run at `<#w>`)", () => {
    for (const s of [
      "when message from <#wk> (r) {", "when error from <#wk> (e) {", "when terminate from <#wk> {",
      "when message from ", "when message from _scrml_worker_wk (r) {",
    ]) expect(TOPLEVEL_WHEN_STMT_RE.test(s)).toBe(false);
  });

  test("does not match prose heads", () => {
    for (const s of ["when the value changes, {x}", "when @x changes you {", "when x changes {", "whenever @x changes {", "when @x {"])
      expect(TOPLEVEL_WHEN_STMT_RE.test(s)).toBe(false);
  });

  test("F2 — 40K whitespace inside every head shape tests in < 50 ms (no adjacent-quantifier backtracking)", () => {
    const ws = " ".repeat(40000);
    for (const s of [
      "when message" + ws + "x", "when error" + ws + "x", "when message(" + ws + "x",
      "when @x" + ws + "x", "when @x changes" + ws + "x", "when @x changes reads @y" + ws + "x",
      "when (@a" + ws + "x", "when (@a," + ws + "@b" + ws + "x", ws + "when" + ws + "x",
    ]) {
      const t = performance.now();
      TOPLEVEL_WHEN_STMT_RE.test(s);
      expect(performance.now() - t).toBeLessThan(50);
    }
  });
});

describe("S432 — the two open exceptions the §40.8 amendment names (characterization)", () => {
  test("parent-side `when message from <#wk> (r) {}` after markup still ships as page text — g-when-from-worker-parent-handler-ships-as-page-text-at-body-top", () => {
    const W = `<program name="wk">\n<z> = 0\nwhen message(d) { send(d + 1) }\n</program>\n`;
    const H = `when message from <#wk> (r) { @got = r }`;
    const bare = compile(`<program>\n<got> = 0\n${W}<p>\${@got}</p>\n${H}\n</program>\n`);
    expect(bare.body).toContain("when message from");
    const wrapped = compile(`<program>\n<got> = 0\n${W}<p>\${@got}</p>\n\${ ${H} }\n</program>\n`);
    expect(wrapped.body).not.toContain("when message from"); // the documented `${ … }` form works
  });

  test("a PROSE line before the `when` in the same run disables the lift — g-default-logic-auto-lift-silently-disabled-by-a-preceding-prose-line", () => {
    const { body } = compile(`<program>\n<x> = 0\n<p>\${@x}</p>\nSome prose line here.\nwhen @x changes { go() }\n</program>\n`);
    expect(body).toContain("when @x changes");
  });

  test("declarations before the `when` in the same run DO lift it (a named position)", () => {
    const { body, js } = compile(`<program>\n<x> = 0\n<p>\${@x}</p>\n<y> = 1\nwhen @x changes { console.log("MK_WHEN") }\n</program>\n`);
    expect(body).not.toContain("when @x changes");
    expect(js).toContain("MK_WHEN");
  });
});

describe("S432 F3 — head-shaped PROSE at body-top is no longer page text", () => {
  test("`when message {x} arrives …` after markup is now a LOUD error (was page text)", () => {
    const { body, r } = compile(AT.afterMarkup("when message {x} arrives we reply"));
    expect(body).not.toContain("arrives we reply");
    expect((r.errors ?? []).length).toBeGreaterThan(0);
    expect((r.errors ?? []).map(e => e.code)).toContain("E-SCOPE-001");
  });

  test("`when @x changes {see below}` compiles clean to an unparseable body — g-when-body-not-validated-garbage-compiles-to-a-client-syntax-error (pre-existing at the shared-run position)", () => {
    const shared = compile(AT.share("when @x changes {see below}"));
    const after = compile(AT.afterMarkup("when @x changes {see below}"));
    for (const c of [shared, after]) {
      expect(c.body).not.toContain("see below");
      expect(c.js).toContain("see below;"); // the garbage body reaches the client verbatim
    }
    expect(after.codes.sort()).toEqual(shared.codes.sort()); // same outcome as the always-lifted position
  });
});

process.on("exit", () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});
