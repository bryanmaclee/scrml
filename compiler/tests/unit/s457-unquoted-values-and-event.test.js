/**
 * s457-unquoted-values-and-event.test.js — S457 rulings 4a + 3a.
 *
 * 4a (user-voice-scrml.md S457 "1a 2a 3a 4a 5 dd it 6a", item 4) — an unquoted
 * attribute value is read WHOLE: a handler's assignment
 * (`onclick=@count = @count + 1` compiled to `count = count`) and a member chain
 * in ANY attribute (`if=fn().ok` lost the condition, `title=fmt(1).trim()` was
 * wired as a `title` EVENT LISTENER plus a stray `trim` attribute,
 * `onclick=fn() .then(g)` ran `fn()` alone). A value that cannot be read whole
 * is refused (E-ATTR-UNQUOTED-OPERATOR / E-ATTR-MULTI-STATEMENT), never
 * truncated. SPEC §5.2 "An unquoted value is read WHOLE".
 *
 * 3a (item 3) — a handler the compiler wraps (bare call / expression /
 * assignment, inline block, non-function `${…}`) does NOT bind `event`: the
 * listener's parameter is `_scrml_event` (outside the user namespace) and a free
 * `event` is E-EVENT-UNBOUND, pointing at `${(e) => …}`. SPEC §5.2 "Handler
 * values do not bind `event`".
 *
 * Gaps: g-unquoted-handler-assignment-rhs-dropped-s457,
 * g-unquoted-non-handler-value-chain-truncated-s457,
 * g-handler-event-binding-unspecified-s457.
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
  const name = `s457uv-${uniq}`;
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
      codes: (result.errors ?? []).map((e) => e.code),
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const page = (markup, extra = "") => `<program>
<msg> = "a"
<count> = 0
<n> = 2
<big> = false
<ok> = true
<list> = [{ name: "x" }]
function mk(x) { return { ok: x > 1, then: (f) => f(x), x: () => 1 } }
function fmt(x) { return " v" + x + " " }
function g(v) { @msg = "g" + v }
function f(v) { @msg = "f" + v }
${extra}
${markup}
<p id="out">\${@msg}</p>
</program>
`;

/** The emitted listeners of the delegated registry, in order. */
function handlersOf(clientJs) {
  return [...clientJs.matchAll(/"_scrml_attr_on[\w:]+_\d+": ([\s\S]*?),\n/g)].map((m) => m[1]);
}

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

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

// ---------------------------------------------------------------------------
describe("§1 4a — a handler expression is read whole", () => {
  test("THE REPRO: `onclick=@count = @count + 1` keeps its `+ 1`", () => {
    const { errors, clientJs } = compileToOutputs(page(`<button onclick=@count = @count + 1>go</button>`));
    expect(errors).toEqual([]);
    expect(handlersOf(clientJs)[0]).toBe(
      `function(_scrml_event) { _scrml_cs_reactive_set("count", _scrml_cs_reactive_get("count") + 1); }`,
    );
  });

  const shapes = [
    [`onclick=@msg = @ok ? "y" : "n"`, /_scrml_cs_reactive_set\("msg", _scrml_cs_reactive_get\("ok"\) \? "y" : "n"\)/],
    [`onclick=@ok = !@ok`, /_scrml_cs_reactive_set\("ok", !_scrml_cs_reactive_get\("ok"\)\)/],
    [`onclick=@n += 2 * 3`, /_scrml_cs_reactive_set\("n", _scrml_cs_reactive_get\("n"\) \+ \(2 \* 3\)\)/],
    [`onclick=mk(1) .then(g)`, /_scrml_mk_\d+\(1\)\s*\.then\(_scrml_g_\d+\)/],
    [`onclick=@count = mk(1) .x() + 1`, /_scrml_cs_reactive_set\("count", _scrml_mk_\d+\(1\)\s*\.x\(\) \+ 1\)/],
    // `>=` never closes the opener (block splitter, issue #28), spaced or not
    [`onclick=@big = @n >= 2`, /_scrml_cs_reactive_set\("big", _scrml_cs_reactive_get\("n"\) >= 2\)/],
    [`onclick=@big = @n>=2`, /_scrml_cs_reactive_set\("big", _scrml_cs_reactive_get\("n"\) >= 2\)/],
    [`onclick=@big = @n < 3`, /_scrml_cs_reactive_set\("big", _scrml_cs_reactive_get\("n"\) < 3\)/],
    [`onclick=@ok = @msg is not`, /_scrml_cs_reactive_set\("ok", _scrml_cs_reactive_get\("msg"\) === null/],
  ];
  for (const [attr, want] of shapes) {
    test(`\`${attr}\``, () => {
      const { errors, clientJs, html } = compileToOutputs(page(`<button ${attr}>go</button>`));
      expect(errors).toEqual([]);
      expect(handlersOf(clientJs)[0]).toMatch(want);
      expect(html).toMatch(/<button data-scrml-bind-onclick="_scrml_attr_onclick_\d+">/);
    });
  }

  test("`>=` right after a call is the tag close + a `=` label, as the block splitter reads it", () => {
    // samples/compilation-tests/combined-020-calculator.scrml: `<button onclick=calculate()>=</>`
    const { errors, clientJs, html } = compileToOutputs(page(`<button id="eq" onclick=g(1)>=</button>`));
    expect(errors).toEqual([]);
    expect(handlersOf(clientJs)[0]).toMatch(/^function\(_scrml_event\) \{ _scrml_g_\d+\(1\); \}$/);
    expect(html).toMatch(/<button id="eq" data-scrml-bind-onclick="_scrml_attr_onclick_\d+">=<\/button>/);
  });

  test("a spaced `>=` the opener scan ended the tag at is refused, not truncated", () => {
    const { codes } = compileToOutputs(page(`<button onclick=@big = mk(1).x() >= 2>go</button>`));
    expect(codes).toEqual(["E-ATTR-UNQUOTED-OPERATOR"]);
  });

  test("two assignment handlers and a class on one element stay three attributes", () => {
    const { errors, clientJs, html } = compileToOutputs(
      page(`<button onclick=@n = @n * 2 onmouseenter=@n = 0 class="x">go</button>`),
    );
    expect(errors).toEqual([]);
    const hs = handlersOf(clientJs).join("\n") + clientJs;
    expect(hs).toMatch(/_scrml_cs_reactive_set\("n", _scrml_cs_reactive_get\("n"\) \* 2\)/);
    expect(hs).toMatch(/_scrml_cs_reactive_set\("n", 0\)/);
    expect(html).toMatch(/class="x"/);
  });

  test("EXECUTED: two clicks count to 2", async () => {
    const { get } = await load(page(`<button onclick=@count = @count + 1>go</button>`));
    document.querySelector("button").click();
    document.querySelector("button").click();
    expect(get("count")).toBe(2);
  });
});

describe("§2 4a — a member chain in ANY attribute", () => {
  test("`if=mk(2).ok` keeps the condition (was `if=mk(2)` + E-CODEGEN / an always-rendered element)", () => {
    const { errors, clientJs } = compileToOutputs(page(`<p id="c" if=mk(2).ok>shown</p>`));
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_mk_\d+\(2\)\.ok/);
  });

  test("`title=fmt(1).trim()` is the attribute's VALUE, not an event listener, and no `trim` attribute", () => {
    const { errors, clientJs, html } = compileToOutputs(page(`<p id="t" title=fmt(1).trim()>t</p>`));
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/addEventListener\("title"/);
    expect(clientJs).toMatch(/_scrml_fmt_\d+\(1\)\.trim\(\)/);
    expect(html).not.toMatch(/\btrim\b/);
  });

  test("`title=@list[0].name` reads the index and the member", () => {
    const { errors, clientJs } = compileToOutputs(page(`<p title=@list[0].name>t</p>`));
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_cs_reactive_get\("list"\)\[0\]\.name/);
  });

  test("EXECUTED: `if=mk(1).ok` hides, `if=mk(2).ok` shows; the title is trimmed", async () => {
    await load(page(`<p id="no" if=mk(1).ok>no</p><p id="yes" if=mk(2).ok>yes</p><p id="t" title=fmt(1).trim()>t</p>`));
    expect(document.getElementById("no")).toBeNull();
    expect(document.getElementById("yes")).not.toBeNull();
    expect(document.getElementById("t").getAttribute("title")).toBe("v1");
  });
});

describe("§3 4a — a value that cannot be read whole is refused, never truncated", () => {
  const refused = [
    [`<p title=@msg + "x">t</p>`, "E-ATTR-UNQUOTED-OPERATOR", "`title=`"],
    [`<a href=docs/intro>x</a>`, "E-ATTR-UNQUOTED-OPERATOR", "`href=`"],
    [`<button onclick=mk(1) (g)>go</button>`, "E-ATTR-UNQUOTED-OPERATOR", "`onclick={"],
    [`<button onclick=@big = @n > 1>go</button>`, "E-ATTR-UNQUOTED-OPERATOR", "`onclick={ @big = @n }`"],
    [`<p title=mk(1); g(2)>x</p>`, "E-ATTR-MULTI-STATEMENT", "attribute `title`"],
    [`<p if=!@ok && @big>x</p>`, "E-ATTR-UNQUOTED-OPERATOR", "unquoted condition"],
  ];
  for (const [markup, code, hint] of refused) {
    test(`${markup} → ${code}`, () => {
      const { errors, codes } = compileToOutputs(page(markup));
      expect(codes).toContain(code);
      expect(codes.filter((c) => c === code).length).toBe(1);
      expect(errors.find((e) => e.code === code).message).toContain(hint);
    });
  }

  test("inside an <each> row the refusal is reported, not discarded with the sub-build", () => {
    const { codes } = compileToOutputs(page(`<ul><each in=@list as it><li title=it.name + 1>r</li></each></ul>`));
    expect(codes).toContain("E-ATTR-UNQUOTED-OPERATOR");
  });

  const accepted = [
    // a non-handler value admits no operator, so its `>` is the tag close
    `<input id="v" value=@msg >`,
    // a newline before the tag close is layout, not an operator
    `<button onclick=@count = @count + 1\n>go</button>`,
    `<input bind:value=@msg />`,
  ];
  for (const markup of accepted) {
    test(`accepted: ${JSON.stringify(markup)}`, () => {
      expect(compileToOutputs(page(markup)).codes).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
describe("§4 3a — the wrapper does not bind `event`; a free `event` is E-EVENT-UNBOUND", () => {
  const refused = [
    [`<input oninput=f(event.target.value)>`, "`oninput=${(e) => f(e.target.value)}`"],
    [`<button onclick={ f(event.type) }>go</button>`, "`onclick=${(e) => f(e.type)}`"],
    [`<button onclick=\${ f(event.type) }>go</button>`, "`onclick=${(e) => f(e.type)}`"],
    [`<button onclick=@msg = event.type>go</button>`, "`onclick=${(e) => @msg = e.type}`"],
    [`<button onclick={ [1].forEach(x => f(event.type)) }>go</button>`, "(e) =>"],
    ["<button onclick={ @msg = `t ${event.type}` }>go</button>", "(e) =>"],
    [`<ul><each in=@list as it><li><button onclick=f(event.type)>r</button></li></each></ul>`, "(e) =>"],
  ];
  for (const [markup, fix] of refused) {
    test(`${markup}`, () => {
      const { errors, codes } = compileToOutputs(page(markup));
      expect(codes).toEqual(["E-EVENT-UNBOUND"]);
      expect(errors[0].message).toContain(fix);
    });
  }

  const clean = [
    `<button onclick=\${(e) => f(e.type)}>go</button>`,
    `<button onclick=\${(event) => f(event.type)}>go</button>`,
    `<button onclick={ [1].forEach(event => f(event)) }>go</button>`,
    `<button onclick=f("event")>go</button>`,
    `<form onsubmit=f(1)><button>go</button></form>`,
  ];
  for (const markup of clean) {
    test(`no E-EVENT-UNBOUND: ${markup}`, () => {
      expect(compileToOutputs(page(markup)).codes).toEqual([]);
    });
  }

  test("the listener's parameter is `_scrml_event` (outside the user namespace, §47.1.1)", () => {
    const { clientJs } = compileToOutputs(page(`<form onsubmit=f(1)><button>go</button></form>`));
    expect(handlersOf(clientJs)[0]).toMatch(/^function\(_scrml_event\) \{ _scrml_event\.preventDefault\(\); _scrml_f_\d+\(1\); \}$/);
  });

  test("an arrow handler lowered as a statement list binds its parameter from `_scrml_event`", () => {
    // A `!{}` guard in the body makes the AST builder lower the arrow as a
    // statement list (S440) with a `const <param> = _scrml_event` prelude — for a
    // parameter named `event` too, now that the listener's own is `_scrml_event`.
    const { codes, clientJs } = compileToOutputs(page(
      `<button onclick=\${(event) => { risky() !{ | .Empty :> @msg = event.type } }}>go</button>`,
      `type LoadError:enum = { Empty }\n\${ function risky()! -> LoadError { fail LoadError.Empty } }`,
    ));
    expect(codes).toEqual([]);
    expect(clientJs).toMatch(/function\(_scrml_event\) \{ const event = _scrml_event;/);
  });

  test("EXECUTED: that guard arm reads `event.type` through the prelude", async () => {
    const { get } = await load(page(
      `<button onclick=\${(event) => { risky() !{ | .Empty :> @msg = event.type } }}>go</button>`,
      `type LoadError:enum = { Empty }\n\${ function risky()! -> LoadError { fail LoadError.Empty } }`,
    ));
    document.querySelector("button").click();
    expect(get("msg")).toBe("click");
  });

  test("EXECUTED (THE g-handler-event-binding repro): a user `function event` called from a handler runs", async () => {
    // HEAD before s457: the wrapper's `event` parameter shadowed the function —
    // "event is not a function" at click.
    const { get } = await load(page(`<button onclick=event(5)>go</button>`, `function event(v) { @msg = "ev" + v }`));
    document.querySelector("button").click();
    expect(get("msg")).toBe("ev5");
  });

  test("EXECUTED: the migrated `${(e) => f(e.target.value)}` reads the input's value", async () => {
    const { get } = await load(page(`<input id="i" oninput=\${(e) => f(e.target.value)}>`));
    const input = document.getElementById("i");
    input.value = "typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get("msg")).toBe("ftyped");
  });

  test("EXECUTED: an arrow statement-list handler with parameter `event` sees the event", async () => {
    const { get } = await load(page(`<button onclick=\${(event) => { @msg = event.type; @count = 1 }}>go</button>`));
    document.querySelector("button").click();
    expect(get("msg")).toBe("click");
    expect(get("count")).toBe(1);
  });

  test("a component prop named `event` is the prop inside the handler (no longer shadowed)", () => {
    const { codes, clientJs } = compileToOutputs(page(
      `<B event="hi"/>`,
      `\${ const B = <button props={ event: string } onclick={ @msg = event }>go</> }`,
    ));
    expect(codes).toEqual([]);
    expect(clientJs).toMatch(/_scrml_cs_reactive_set\("msg", "hi"\)/);
  });
});
