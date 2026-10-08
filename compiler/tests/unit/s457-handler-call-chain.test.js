/**
 * s457-handler-call-chain.test.js
 *
 * g-onclick-unquoted-call-chain-drops-callback-s457 (HIGH).
 *
 *     <button onclick=Promise.resolve(5).then(function (v) { @msg = "x" })>
 *
 * emitted `function(_scrml_event) { Promise.resolve(5); }` — the callback vanished and
 * `then function v @msg="x"` leaked onto the <button> as attributes, at exit 0.
 *
 * Governing text, SPEC §5.2.3:
 *   - table, "Bare single-expression": "One expression — calls, assignments,
 *     compound updates, method invocations"
 *   - "A BARE (unbraced) event-handler value SHALL contain exactly one scrml
 *     expression — one of the three bare shapes in the table above."
 *   - "A bare attribute value has no closing delimiter of its own; its extent
 *     is found by scanning forward, and an attribute boundary is whitespace at
 *     depth 0."
 * The value is one method-invocation expression whose whitespace all sits
 * inside parentheses, so it is legal and must compile whole. The unquoted-value
 * reader stopped at the first call's `)`; it now continues through a postfix
 * continuation (`.name`, `?.`, `[…]`, `(…)`) to the §5.2.3 boundary.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

function compileToOutputs(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `s457chain-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const page = (button, extra = "") => `<program>
<msg> = "a"
<count> = 0
<list> = [{ go: () => 7 }]
const handlers = [() => 3]
function fn(x) { return { then: (f) => f(x), x: () => 1 } }
function g(v) { @msg = "g" + v }
${extra}
${button}
<p id="out">\${@msg}</p>
</program>
`;

/** The emitted listener for the single delegated handler on the page. */
function handlerOf(clientJs) {
  const m = clientJs.match(/"_scrml_attr_on[\w:]+_\d+": ([\s\S]*?),\n  \};/);
  return m ? m[1] : null;
}

/** The opening tag of the first <button>. */
function buttonTag(html) {
  return html.match(/<button[^>]*>/)?.[0] ?? null;
}

describe("§1 the whole chain is the handler; nothing leaks into the element", () => {
  test("THE REPRO: `.then(function (v) { @msg = \"x\" })` survives", () => {
    const { errors, clientJs, html } = compileToOutputs(
      page(`<button onclick=Promise.resolve(5).then(function (v) { @msg = "x" })>go</button>`),
    );
    expect(errors).toEqual([]);
    expect(handlerOf(clientJs)).toBe(
      `function(_scrml_event) { Promise.resolve(5).then(function (v) { _scrml_cs_reactive_set("msg", "x"); }); }`,
    );
    expect(buttonTag(html)).toBe(`<button data-scrml-bind-onclick="_scrml_attr_onclick_1">`);
  });

  const shapes = [
    [`onclick=fn(1).then(g)`, /^function\(_scrml_event\) \{ _scrml_fn_\d+\(1\)\.then\(_scrml_g_\d+\); \}$/],
    [`onclick=fn(1)(2)`, /^function\(_scrml_event\) \{ _scrml_fn_\d+\(1\)\(2\); \}$/],
    [`onclick=fn()?.x()`, /^function\(_scrml_event\) \{ _scrml_fn_\d+\(\)\?\.x\(\); \}$/],
    [`onclick=fn()[0]`, /^function\(_scrml_event\) \{ _scrml_fn_\d+\(\)\[0\]; \}$/],
    [`onclick=handlers[0]()`, /^function\(_scrml_event\) \{ handlers\[0\]\(\); \}$/],
    [`onclick=@list[0].go()`, /^function\(_scrml_event\) \{ _scrml_cs_reactive_get\("list"\)\[0\]\.go\(\); \}$/],
    [`on:click=fn(1).then(g)`, /^function\(_scrml_event\) \{ _scrml_fn_\d+\(1\)\.then\(_scrml_g_\d+\); \}$/],
  ];
  for (const [attr, want] of shapes) {
    test(`\`${attr}\` — one expression`, () => {
      const { errors, clientJs, html } = compileToOutputs(page(`<button ${attr}>go</button>`));
      expect(errors).toEqual([]);
      expect(handlerOf(clientJs)).toMatch(want);
      // no stray attribute made of the expression's tail
      expect(buttonTag(html)).toMatch(/^<button data-scrml-bind-on[\w:]+="_scrml_attr_on[\w]+_1">$/);
    });
  }

  test("an attribute after the chain is still its own attribute", () => {
    const { errors, clientJs, html } = compileToOutputs(page(`<button onclick=fn(1).then(g) class="x">go</button>`));
    expect(errors).toEqual([]);
    expect(handlerOf(clientJs)).toMatch(/_scrml_fn_\d+\(1\)\.then\(_scrml_g_\d+\);/);
    expect(buttonTag(html)).toBe(`<button data-scrml-bind-onclick="_scrml_attr_onclick_1" class="x">`);
  });

  test("a chain on the LEFT of a bare assignment: `onclick=@list[0] = 5`", () => {
    const { errors, clientJs } = compileToOutputs(page(`<button onclick=@list[0] = 5>go</button>`));
    expect(errors).toEqual([]);
    expect(handlerOf(clientJs)).toContain(`_scrml_cs_reactive_get("list")[0] = 5`);
  });
});

describe("§2 the shapes this does not touch are byte-identical", () => {
  // Each of these reached the reader before s457 and must emit exactly what it did.
  const controls = [
    [`onclick=g(1)`, `function(_scrml_event) { _scrml_g_4(1); }`],
    [`onclick=@count++`, `function(_scrml_event) { _scrml_cs_reactive_set("count", _scrml_cs_reactive_get("count") + 1); }`],
    [`onclick=@msg = "b"`, `function(_scrml_event) { _scrml_cs_reactive_set("msg", "b"); }`],
  ];
  for (const [attr, want] of controls) {
    test(`\`${attr}\``, () => {
      const { errors, clientJs } = compileToOutputs(page(`<button ${attr}>go</button>`));
      expect(errors).toEqual([]);
      expect(handlerOf(clientJs)).toBe(want);
    });
  }
});

describe("§3 a bare `;` sequence after a chain is still E-MULTI-STATEMENT-HANDLER", () => {
  test("`onclick=fn(1).then(g);g(2)` is refused, not truncated", () => {
    const { errors } = compileToOutputs(page(`<button onclick=fn(1).then(g);g(2)>go</button>`));
    expect(errors.map((e) => e.code)).toContain("E-MULTI-STATEMENT-HANDLER");
  });
});

describe("§4 executed: the callback runs", () => {
  async function load(source) {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    const { errors, clientJs, html } = compileToOutputs(source);
    if (errors.length) throw new Error(errors.map((e) => e.code).join(","));
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (body ? body[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    // eslint-disable-next-line no-eval
    eval(`(function() {\n${SCRML_RUNTIME}\n` +
      captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\n`) + `\n})();`);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    return { get: (n) => window._scrml_reactive_get(n) };
  }

  test("THE REPRO: the Promise callback sets @msg after the click", async () => {
    const { get } = await load(page(`<button onclick=Promise.resolve(5).then(function (v) { @msg = "x" + v })>go</button>`));
    document.querySelector("button").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(get("msg")).toBe("x5");
    expect(document.getElementById("out").textContent).toBe("x5");
  });

  test("`fn(1).then(g)` passes 1 to g", async () => {
    const { get } = await load(page(`<button onclick=fn(1).then(g)>go</button>`));
    document.querySelector("button").click();
    expect(get("msg")).toBe("g1");
  });

  test("inside an <each> row the chain is the row's handler too", async () => {
    const { get } = await load(page(
      `<ul><each in=@list as it><li><button class="row" onclick=fn(it.go()).then(g)>r</button></li></each></ul>`,
    ));
    document.querySelector(".row").click();
    expect(get("msg")).toBe("g7");
  });
});

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
