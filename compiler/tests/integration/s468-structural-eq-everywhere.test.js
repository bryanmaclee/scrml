/**
 * S468 — SPEC §45.1: "`==` is scrml's sole equality operator. It performs
 * structural value comparison." §45.8: "`==` SHALL perform deep structural
 * comparison for structs and enums."
 *
 * Gap g-structural-eq-emitted-as-strict-eq-outside-typed-fn-bodies-s464: `==`
 * lowered to `_scrml_structural_eq` only on the structured emitter path; every
 * raw-text lowering (the client string pipeline's Pass 18, and the `<each>`
 * per-item text path, which ran no equality pass at all) emitted `===` / loose
 * `==` — reference equality, so two equal structs compared false.
 *
 * Each program is compiled to disk and run in happy-dom with the TREE-SHAKEN
 * runtime the compiler emitted (so a missing `equality` chunk would surface as a
 * ReferenceError), then driven by clicks. Positions covered: inline handler
 * (assignment body), `!=` in a lambda handler, payload-enum `==`, primitive `==`
 * in a handler, postfix `@n++` (blast radius of the string path), `<each>` row
 * attribute, `<each>` row handler, markup interpolation, derived const, `if=`.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function build(src) {
  const dir = mkdtempSync(join(tmpdir(), "s468-eq-"));
  dirs.push(dir);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  expect(errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
  const runtimeFile = readdirSync(outDir).find((f) => /^scrml-runtime\..*\.js$/.test(f));
  const runtimeJs = runtimeFile ? readFileSync(join(outDir, runtimeFile), "utf8") : "";
  const html = readFileSync(join(outDir, "app.html"), "utf8");
  return { clientJs, runtimeJs, html };
}

async function run({ clientJs, runtimeJs, html }, drive) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  try {
    const g = globalThis;
    const bodyHtml = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) ?? [null, html])[1];
    g.document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    (0, eval)("(function () {\n" + runtimeJs + "\n" + clientJs + "\n})();");
    g.document.dispatchEvent(new g.Event("DOMContentLoaded", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    const text = (sel) => g.document.querySelector(sel)?.textContent?.trim() ?? null;
    const click = async (sel) => { g.document.querySelector(sel).click(); await new Promise((r) => setTimeout(r, 10)); };
    return await drive({ g, text, click });
  } finally {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  }
}

// The reviewer's c10 shape: two distinct-but-equal struct cells, compared in
// every position. Only the inline handler ever reaches the string pipeline here.
const POSITIONS = `\${
    type Point:struct = { x: number, y: number }
    <a> : Point = { x: 1, y: 2 }
    <b> : Point = { x: 1, y: 2 }
    <msg> : string = "none"
    const same = @a == @b
}
<p id="interp">\${@a == @b}</p>
<p id="interpne">\${@a != @b}</p>
<p id="derived">\${same}</p>
<p id="msg">\${@msg}</p>
<button id="h" onclick=\${@msg = (@a == @b) ? "yes" : "no"}>h</button>
<button id="hlit" onclick=\${@msg = (@a == { x: 1, y: 2 }) ? "lit-yes" : "lit-no"}>hlit</button>
<p id="ifattr" if=(@a == @b)>shown</p>
`;

// Handler-ONLY equality: no `==` anywhere else in the file, so the emitted
// runtime carries the helper only if the post-emit reference gate sees the
// handler's `_scrml_structural_eq(`.
const HANDLER_ONLY = `\${
    type Point:struct = { x: number, y: number }
    <a> : Point = { x: 1, y: 2 }
    <msg> : string = "none"
}
<p id="msg">\${@msg}</p>
<button id="h" onclick=\${@msg = (@a != { x: 1, y: 2 }) ? "ne" : "eq"}>h</button>
`;

const ADJACENT = `\${
    type Point:struct = { x: number, y: number }
    type Shape:enum = { Dot(p: Point), Empty }
    <items> : Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    <sel> : Point = { x: 1, y: 2 }
    <sh> : Shape = Shape.Dot({ x: 1, y: 2 })
    <n> : number = 2
    <msg> : string = ""
}
<ul id="list">
    <each in=@items key=@.x as it>
        <li class=\${it == @sel ? "on" : "off"} onclick=\${@msg = it == @sel ? "same" : "diff"}>\${it.x}</li>
    </each>
</ul>
<button id="inc" onclick=\${@n++}>inc</button>
<button id="lam" onclick=\${(e) => { @msg = (@sel != { x: 1, y: 2 }) ? "ne" : "eq" }}>lam</button>
<button id="enum" onclick=\${@msg = (@sh == Shape.Dot({ x: 1, y: 2 })) ? "deq" : "dne"}>enum</button>
<button id="prim" onclick=\${@msg = (@n == 3) ? "three" : "other"}>prim</button>
<p id="m">\${@msg}</p>
<p id="n">\${@n}</p>
`;

describe("S468 — library-module verbatim path (§45.1)", () => {
  test("`export const X = { a: 1 } == { a: 1 }` is true, `!=` false; helper ships with the module", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s468-eq-lib-"));
    dirs.push(dir);
    const outDir = join(dir, "dist");
    mkdirSync(outDir, { recursive: true });
    const file = join(dir, "models.scrml");
    writeFileSync(file, "${\n  export const SAME = { a: 1 } == { a: 1 }\n  export const DIFF = { a: 1 } != { a: 1 }\n  export const PRIM = 1 == 1\n}\n");
    const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    expect(errors.map((e) => e.code)).toEqual([]);
    const js = readFileSync(join(outDir, "models.js"), "utf8");
    expect(js).toContain("export const SAME = _scrml_structural_eq({ a: 1 }, { a: 1 })");
    expect(js).toContain("export const PRIM = 1 === 1");
    expect(js).toContain("function _scrml_structural_eq(");
    const mod = await import(`file://${join(outDir, "models.js")}?v=${Date.now()}`);
    expect(mod.SAME).toBe(true);
    expect(mod.DIFF).toBe(false);
    expect(mod.PRIM).toBe(true);
  });

  // Fix round 1 (F2): the primitive lowering used to wrap `(l === r)`; at the
  // start of a line that `(` made the previous line's result a callee under ASI.
  test("a statement starting with a primitive `==` after a call line still loads (ASI)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s468-eq-asi-"));
    dirs.push(dir);
    const outDir = join(dir, "dist");
    mkdirSync(outDir, { recursive: true });
    const file = join(dir, "models.scrml");
    writeFileSync(file, [
      "${",
      '  export const LABEL = "x"',
      "  export const TAG = makeTag()",
      '  typeof LABEL == "string" && globalThis.__s468AsiLog.push("side-effect-ran")',
      '  function makeTag() { return "t" }',
      "}",
      "",
    ].join("\n"));
    const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    expect(errors.map((e) => e.code)).toEqual([]);
    const js = readFileSync(join(outDir, "models.js"), "utf8");
    expect(js).not.toMatch(/\(typeof LABEL ===/);
    globalThis.__s468AsiLog = [];
    try {
      const mod = await import(`file://${join(outDir, "models.js")}?v=${Date.now()}`);
      expect(mod.TAG).toBe("t");
      expect(globalThis.__s468AsiLog).toEqual(["side-effect-ran"]);
    } finally {
      delete globalThis.__s468AsiLog;
    }
  });
});

describe("S468 fix round 1 — inline-handler shapes the reviewer found", () => {
  // F1: an operator inside a comment between the operands split the expression
  // there (`!_scrml_structural_eq(a /* is it, ? */ != b)`, the wrong polarity).
  test("a comment holding `!=` between the operands of `!=` (executed)", async () => {
    const art = build(`\${
    <a> : number = 1
    <b> : number = 1
    <out> : string = ""
}
<p id="w">\${@out}</p>
<button id="b" onclick=\${@out = (@a /* is it != ? */ != @b) ? "ne" : "eq"}>b</button>
<button id="c" onclick={
    const same = @a // left == right?
        == @b
    @out = same ? "same" : "differ"
}>c</button>
`);
    await run(art, async ({ text, click }) => {
      await click("#b");
      expect(text("#w")).toBe("eq");
      await click("#c");
      expect(text("#w")).toBe("same");
    });
  });
});

describe("S468 — `==` is structural in every lowering position (§45.1)", () => {
  test("no string-path `===` between two cell reads survives in the client", () => {
    const { clientJs } = build(POSITIONS);
    expect(clientJs).not.toMatch(/_scrml_cs_reactive_get\("a"\) === _scrml_cs_reactive_get\("b"\)/);
    expect(clientJs).toContain(`_scrml_structural_eq(_scrml_cs_reactive_get("a"), _scrml_cs_reactive_get("b"))`);
  });

  test("interpolation, derived const, if=, inline handler: equal structs compare equal", async () => {
    const art = build(POSITIONS);
    await run(art, async ({ text, click, g }) => {
      expect(text("#interp")).toBe("true");
      expect(text("#interpne")).toBe("false");
      expect(text("#derived")).toBe("true");
      expect(g.document.querySelector("#ifattr")).not.toBeNull();
      await click("#h");
      expect(text("#msg")).toBe("yes");
      await click("#hlit");
      expect(text("#msg")).toBe("lit-yes");
    });
  });

  test("handler-only `!=`: the tree-shaken runtime still defines the helper", async () => {
    const art = build(HANDLER_ONLY);
    expect(art.clientJs).toContain(`!_scrml_structural_eq(`);
    expect(art.runtimeJs).toContain("function _scrml_structural_eq(");
    await run(art, async ({ text, click }) => {
      await click("#h");
      expect(text("#msg")).toBe("eq");
    });
  });

  test("<each> row attribute + row handler, lambda `!=`, payload enum, primitive, postfix", async () => {
    const art = build(ADJACENT);
    // The <each> per-item text path used to ship JS loose `it == …`.
    expect(art.clientJs).not.toMatch(/\bit == _scrml_cs_reactive_get/);
    await run(art, async ({ text, click, g }) => {
      const lis = [...g.document.querySelectorAll("#list li")];
      expect(lis.map((li) => li.getAttribute("class"))).toEqual(["on", "off"]);
      lis[0].click();
      await new Promise((r) => setTimeout(r, 10));
      expect(text("#m")).toBe("same");
      lis[1].click();
      await new Promise((r) => setTimeout(r, 10));
      expect(text("#m")).toBe("diff");
      await click("#lam");
      expect(text("#m")).toBe("eq");
      await click("#enum");
      expect(text("#m")).toBe("deq");
      await click("#prim");
      expect(text("#m")).toBe("other");
      await click("#inc");
      expect(text("#n")).toBe("3");
      await click("#prim");
      expect(text("#m")).toBe("three");
    });
  });
});
