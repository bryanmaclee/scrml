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
  // s457 3a (S458 fix round) — judged on the EMITTED listener with Acorn's scope
  // model (codegen/listener-event-check.ts), so every front end and every binder
  // position is covered: component bodies (native re-parse), `<match>` arms,
  // lifted markup (`^{ emit() }` markup is refused upstream, §22.4.1); a binder elsewhere in the handler or the
  // file does not silence it (review F3 / F4).
  const refused = [
    [`<input oninput=f(event.target.value)>`, "`oninput=${(e) => …}`"],
    [`<button onclick={ f(event.type) }>go</button>`, "`onclick=${(e) => …}`"],
    [`<button onclick=\${ f(event.type) }>go</button>`, "`onclick=${(e) => …}`"],
    [`<button onclick=@msg = event.type>go</button>`, "`onclick=${(e) => …}`"],
    [`<button onclick={ [1].forEach(x => f(event.type)) }>go</button>`, "(e) =>"],
    ["<button onclick={ @msg = `t ${event.type}` }>go</button>", "(e) =>"],
    [`<ul><each in=@list as it><li><button onclick=f(event.type)>r</button></li></each></ul>`, "(e) =>"],
    // F4 — a binder of `event` elsewhere in the handler binds only its own scope
    [`<button onclick={ [1].map((event) => event); f(event.type) }>go</button>`, "(e) =>"],
    // F3 — a function-local `const event` elsewhere in the file binds nothing here
    [`<button onclick=f(event.type)>go</button>\n\${ function k() { const event = 1; return event } }`, "(e) =>"],
    // F1 — the native-parser positions
    [`\${ const Btn = <button props={ label: string } onclick={ f(event.type) }>\${label}</> }\n<Btn label="a"/>`, "(e) =>"],
    [`\${ const Btn = <button props={ label: string } onclick=@msg = event.type>\${label}</> }\n<Btn label="a"/>`, "(e) =>"],
    [`type Ph:enum = { A }\n<ph>: Ph = .A\n<match for=Ph on=@ph><A><button onclick=f(event.type)>x</button></A></match>`, "(e) =>"],
    [`<div>\${ lift <button onclick=f(event.type)>x</button> }</div>`, "(e) =>"],
  ];
  for (const [markup, fix] of refused) {
    test(`${markup}`, () => {
      const { errors, codes } = compileToOutputs(page(markup));
      expect(codes).toEqual(["E-EVENT-UNBOUND"]);
      expect(errors[0].message).toContain(fix);
    });
  }

  const clean = [
    `<button onclick=f(event)>go</button>\n\${ const event = "x" }`,
    `<ul>\${ for (event of @list) { lift <li><button onclick=f(event.name)>r</button></li> } }</ul>`,
    `<ul><each in=@list as event><li><button onclick=f(event.name)>r</button></li></each></ul>`,
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

// ---------------------------------------------------------------------------
describe("§5 4a — ONE reader: the native re-parse paths and lifted markup read the same (S458 F1/F2)", () => {
  // Component bodies, `<match>` arms and `^{ emit() }` markup are re-parsed by
  // the native parser (tag-frame.js); lifted markup by the lift tag parser. Both
  // now call the TAB tokenizer's reader (compiler/src/unquoted-attr-value.ts).
  const COMP = (attrs) => `\${ const Btn = <button props={ label: string } ${attrs}>\${label}</> }\n<Btn label="a"/>`;
  const ARM = (markup) => `type Ph:enum = { A, B }\n<ph>: Ph = .A\n<match for=Ph on=@ph><A>${markup}</A><B><p>b</p></B></match>`;
  const read = [
    ["component body", COMP(`onclick=@count = @count + 1`)],
    ["<match> arm", ARM(`<button onclick=@count = @count + 1>x</button>`)],
    ["lifted markup", `<div>\${ lift <button onclick=@count = @count + 1>x</button> }</div>`],
  ];
  for (const [where, markup] of read) {
    test(`${where}: \`onclick=@count = @count + 1\` keeps its \`+ 1\``, () => {
      const { codes, clientJs } = compileToOutputs(page(markup));
      expect(codes).toEqual([]);
      expect(clientJs).toMatch(/_scrml_cs_reactive_set\("count", _scrml_cs_reactive_get\("count"\) \+ 1\)/);
    });
  }

  // `^{ emit() }` markup: §22.4.1 (S458, #1359) admits only plain attribute values
  // in emit() output, so an unquoted handler EXPRESSION there is refused whole —
  // never wired, never truncated. (Was a "keeps its `+ 1`" / E-EVENT-UNBOUND
  // vehicle before the allow-list landed.)
  for (const markup of [
    `^{ emit("<button onclick=@count = @count + 1>e</button>") }`,
    `^{ emit("<button onclick=f(event.type)>e</button>") }`,
  ]) {
    test(`^{ emit() } markup: \`${markup}\` is refused (E-META-EVAL-002), no listener emitted`, () => {
      const { codes, clientJs } = compileToOutputs(page(markup));
      expect(codes).toContain("E-META-EVAL-002");
      expect(clientJs).not.toMatch(/_scrml_cs_reactive_set\("count", _scrml_cs_reactive_get\("count"\)\)/);
    });
  }

  test("component body: `onclick=mk(1) .then(g)` keeps `.then(g)`", () => {
    const { codes, clientJs } = compileToOutputs(page(COMP(`onclick=mk(1) .then(g)`)));
    expect(codes).toEqual([]);
    expect(clientJs).toMatch(/_scrml_mk_\d+\(1\)\s*\.then\(_scrml_g_\d+\)/);
  });

  const refused = [
    ["component body", COMP(`title=@msg + "x"`)],
    ["<match> arm", ARM(`<p title=@msg + "x">x</p>`)],
    ["lifted markup", `<div>\${ lift <p title=@msg + "x">x</p> }</div>`],
    ["^{ emit() } markup", `^{ emit("<p title=@msg + 1>e</p>") }`],
  ];
  for (const [where, markup] of refused) {
    test(`${where}: \`title=@msg + …\` is E-ATTR-UNQUOTED-OPERATOR`, () => {
      expect(compileToOutputs(page(markup)).codes).toContain("E-ATTR-UNQUOTED-OPERATOR");
    });
  }

  test("F6 — a refused attribute in a component body is reported as itself, without the E-COMPONENT cascade", () => {
    const { codes } = compileToOutputs(page(COMP(`title=@msg + "x"`)));
    expect(codes).toEqual(["E-ATTR-UNQUOTED-OPERATOR"]);
  });

  test("lifted markup: `title=fmt(1).trim()` is the attribute value", () => {
    const { codes, clientJs } = compileToOutputs(page(`<div>\${ lift <p id="t" title=fmt(1).trim()>x</p> }</div>`));
    expect(codes).toEqual([]);
    expect(clientJs).toMatch(/setAttribute\("title", _scrml_g\.String\(_scrml_fmt_\d+\(1\)\.trim\(\)/);
  });

  test("F5 — literal text after an unquoted value is pointed at the quoted form", () => {
    const { errors } = compileToOutputs(page(`<a href=https://example.com/x>x</a>`));
    expect(errors.map((e) => e.code)).toContain("E-ATTR-UNQUOTED-OPERATOR");
    expect(errors.find((e) => e.code === "E-ATTR-UNQUOTED-OPERATOR").message).toContain('`href="https://example.com/x"`');
  });
});

// ---------------------------------------------------------------------------
describe("§6 S458 re-review — (c), F7, (d), every listener emitter, <each> function values", () => {
  test("(c) a user `function event` is the binding in EVERY position: `event.preventDefault()` is that function, not a dangling `event`", () => {
    const { codes, clientJs } = compileToOutputs(page(
      `<form onsubmit={ event.preventDefault(); f("sub") }><button>s</button></form>`,
      `\${ function event() { return "userfn" } }`,
    ));
    expect(codes).toEqual([]);
    const m = clientJs.match(/function (_scrml_event_\d+)\(\)/);
    expect(m).not.toBeNull();
    expect(clientJs).toContain(`${m[1]}.preventDefault()`);
    expect(clientJs).not.toMatch(/[^_\w.]event\.preventDefault\(\)/);
  });

  test("(c) with a user `function event`, `event.type` in another handler is that function (resolved, not free)", () => {
    const { codes, clientJs } = compileToOutputs(page(
      `<button onclick=f(event.type)>go</button>`,
      `\${ function event() { return 1 } }`,
    ));
    expect(codes).toEqual([]);
    expect(clientJs).toMatch(/_scrml_f_\d+\(_scrml_event_\d+\.type\)/);
  });

  const COMP = (attrs) => `\${ const C = <div props={ label: string }><button ${attrs}>t</button></> }\n<C label="a"/>`;
  for (const attr of [`onclick=@count = @count > 1`, `onclick=@count = @count + 1 `]) {
    test(`F7 component body: \`${attr}>\` (spaced tag close after a handler expression) is refused like top level`, () => {
      expect(compileToOutputs(page(COMP(attr))).codes).toEqual(["E-ATTR-UNQUOTED-OPERATOR"]);
    });
  }

  const MV = (markup) => `\${ const el = ${markup} }\n<div>\${ lift el }</div>`;
  test("(d) markup VALUE: `onclick=mk(1) .then(g)` keeps `.then(g)`", () => {
    const { codes, clientJs } = compileToOutputs(page(MV(`<button onclick=mk(1) .then(g)>x</button>`)));
    expect(codes).toEqual([]);
    expect(clientJs).toMatch(/_scrml_mk_\d+\(1\)\s*\.then\(_scrml_g_\d+\)/);
  });
  for (const markup of [`<button onclick=@count = @count > 1>x</button>`, `<p title=@msg + "x">x</p>`]) {
    test(`(d) markup VALUE: \`${markup}\` is refused (the diagnostic is forwarded, not discarded)`, () => {
      expect(compileToOutputs(page(MV(markup))).codes).toEqual(["E-ATTR-UNQUOTED-OPERATOR"]);
    });
  }

  const CH = (attrs) => `<div><channel name="u" topic="main" ${attrs}></channel></div>`;
  test("channel `onclient:open=f(event.type)` is E-EVENT-UNBOUND at the attribute", () => {
    const { codes, errors } = compileToOutputs(page(CH(`onclient:open=f(event.type)`)));
    expect(codes).toEqual(["E-EVENT-UNBOUND"]);
    expect(errors[0].message).toContain("`onclient:open=");
  });
  test("channel `onclient:error=f(err)` binds `err` to the event (§38.10.1)", () => {
    const { codes, clientJs } = compileToOutputs(page(CH(`onclient:open=f(e) onclient:error=f(err)`)));
    expect(codes).toEqual([]);
    expect(clientJs).toMatch(/\.onopen = \(e\) => \{ _scrml_f_\d+\(e\); \}/);
    expect(clientJs).toMatch(/\.onerror = \(err\) => \{ _scrml_f_\d+\(err\); \}/);
  });

  // S458 round-3 nit: `onclient:error`'s event is named `error` (§38.10.1); with
  // no plain parameter named in the call, `error` binds nothing.
  test("channel `onclient:error=f(error.type)` — the unbound `error` is E-EVENT-UNBOUND at the attribute", () => {
    const { codes, errors } = compileToOutputs(page(CH(`onclient:error=f(error.type)`)));
    expect(codes).toEqual(["E-EVENT-UNBOUND"]);
    expect(errors[0].message).toContain("`error` in the `onclient:error=` handler is not bound");
    expect(errors[0].message).toContain("§38.10.1");
    expect(errors[0].message).toContain("`onclient:error=handle(e)`");
    expect(errors[0].message).not.toContain("${(e) =>");
  });
  test("channel `onclient:error=f(error.type)` beside a file-level `const error` — bound, no diagnostic", () => {
    expect(compileToOutputs(page(CH(`onclient:error=f(error.type)`), `\${ const error = { type: "x" } }`)).codes).toEqual([]);
  });
  test("`error` is only the onclient:error listener's name: `onclient:open=f(error)` is not E-EVENT-UNBOUND", () => {
    expect(compileToOutputs(page(CH(`onclient:open=g(1, error)`))).codes).not.toContain("E-EVENT-UNBOUND");
  });
  test("channel `onclient:open=f(event.type)` — the message gives the §38.10.1 form, not a `${(e) => …}` value", () => {
    const { errors } = compileToOutputs(page(CH(`onclient:open=f(event.type)`)));
    expect(errors[0].message).toContain("`onclient:open=handle(e)`");
  });

  const W = `<program name="w">\n\${ when message(data) { send({ r: data }) } }\n</>\n`;
  test("parent `when message from <#w> (d)` — a free `event` in the body is E-EVENT-UNBOUND, described as the hook", () => {
    const { codes, errors } = compileToOutputs(page(`${W}\${ when message from <#w> (d) { @msg = event.type } }`));
    expect(codes).toEqual(["E-EVENT-UNBOUND"]);
    expect(errors[0].message).toContain("`event` in the `when message` hook is not bound");
    expect(errors[0].message).not.toContain("inline-block handler");
  });
  test("parent `when error from <#w> (e)` — described as the `when error` hook", () => {
    const { codes, errors } = compileToOutputs(page(`${W}\${ when error from <#w> (e) { @msg = event.type } }`));
    expect(codes).toEqual(["E-EVENT-UNBOUND"]);
    expect(errors[0].message).toContain("`event` in the `when error` hook is not bound");
  });
  test("worker `when message(data)` — a free `event` in the worker body is E-EVENT-UNBOUND, described as the hook", () => {
    const { codes, errors } = compileToOutputs(page(`<program name="w">\n\${ when message(data) { send({ r: event }) } }\n</>\n`));
    expect(codes).toEqual(["E-EVENT-UNBOUND"]);
    expect(errors[0].message).toContain("`event` in the `when message` hook is not bound");
    expect(errors[0].message).not.toContain("emitted listener:");
  });

  test("<each>: a function VALUE `${() => …}` is the listener (§5.2.1) — judged as at top level", () => {
    const top = compileToOutputs(page(`<button onclick=\${() => f(event.type)}>r</button>`));
    const row = compileToOutputs(page(`<ul><each in=@list as it><li><button onclick=\${() => f(event.type)}>r</button></li></each></ul>`));
    expect(top.codes).toEqual([]);
    expect(row.codes).toEqual(top.codes);
  });
});
