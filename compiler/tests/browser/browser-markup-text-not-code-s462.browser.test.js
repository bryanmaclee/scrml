/**
 * browser-markup-text-not-code-s462 — EXECUTES markup whose display text sits
 * between interpolations, in every position a markup body can be written.
 *
 * Bug (s462-given-body-text-as-code): in a markup element written at statement
 * position in a logic body — `${ given @u :> { <p>${@u.name} - ${@n}</p> } }`, or
 * the canonical `${ if (@u is given) { <p>…</p> } }` — the TEXT between two
 * interpolations parsed as statements:
 *   - ` - ` lowered to `-;` (E-CODEGEN-INVALID-LOGIC — the build failed);
 *   - display text `track(@n)` compiled to a CALL that ran on load (measured:
 *     `#hits` 0 → 1 in happy-dom and in Chromium) while the `<p>` rendered nothing;
 *   - other text (`if (x) return`, `a + b`) failed as E-SCOPE-001 /
 *     E-STMT-RETURN-OUTSIDE-FUNCTION, naming code the author never wrote.
 *
 * SPEC §4.18.1: a plain-markup element body is free text — "In a free-text body a
 * bare run is **display text**, literal by default" — and "Body modes nest. A
 * plain-markup element opened *inside* a code-default body … opens a
 * **free-text-mode** body".
 *
 * Each case asserts the build is clean, the text renders literally, and the
 * text's would-be call never runs (`#hits` stays 0, also after a re-render).
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-markup-text-not-code-s462");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  if (errors.length > 0) return { errors, clientJs: "" };
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__mtc_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  )(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const text = (sel) => document.querySelector(sel)?.textContent ?? null;
const squash = (s) => (s ?? "").replace(/\s+/g, " ").trim();

const PRE = `<program>
@u = { name: "bob" }
@n = 3
@hits = 0
@xs = ["x", "y"]
function track(x) {
  @hits = @hits + 1
  return x
}
`;
const POST = `
<span id="hits">\${@hits}</span>
</program>
`;
const T = "track(@n) a + b; if (x) return; const z = 1; while (true) {}";

/**
 * Compile, mount, check the render, bump @n, check again; `#hits` must stay 0 throughout.
 * `loose`: compare with ALL whitespace removed — for the positions whose whitespace
 * handling around an interpolation is a separate, pre-existing gap (§4.18.5; the lift
 * path drops the space between `${…}` and text). This file pins text-vs-code only.
 */
async function runCase(name, body, sel, expectFor, loose = false) {
  const norm = loose ? (s) => (s ?? "").replace(/\s+/g, "") : squash;
  const { errors, clientJs } = compileAndMount(PRE + body + POST, name);
  expect(errors).toEqual([]);
  expect(clientJs).not.toMatch(/^\s*-;\s*$/m);
  await flush();
  expect(norm(text(sel))).toBe(norm(expectFor(3)));
  expect(text("#hits")).toBe("0");
  globalThis.__mtc_set("n", 4);
  await flush();
  expect(norm(text(sel))).toBe(norm(expectFor(4)));
  expect(text("#hits")).toBe("0");
}

describe("markup text between interpolations is text — given guard body (s462)", () => {
  test("`${@u.name} - ${@n}` renders `bob - 3` (pre-fix: `-;` in the JS, build failed)", async () => {
    await runCase("given-dash", `<div id="host">\${ given @u :> { <p id="p">\${@u.name} - \${@n}</p> } }</div>`,
      "#p", (n) => `bob - ${n}`);
  });

  test("display text `track(@n)` is shown, never called (pre-fix: it ran on load, #hits 1)", async () => {
    await runCase("given-track", `<div id="host">\${ given @u :> { <p id="p">\${@u.name} track(@n) \${@n}</p> } }</div>`,
      "#p", (n) => `bob track(@n) ${n}`);
  });

  test("`a + b`, `;`, `(`, `)` and keywords in the text render literally", async () => {
    await runCase("given-kw", `<div id="host">\${ given @u :> { <p id="p">\${@u.name} ${T} \${@n}</p> } }</div>`,
      "#p", (n) => `bob ${T} ${n}`);
  });

  test("`@n + @n` written as text is text, not an expression", async () => {
    await runCase("given-aplusb", `<div id="host">\${ given @u :> { <p id="p">\${@n} @n + @n \${@n}</p> } }</div>`,
      "#p", (n) => `${n} @n + @n ${n}`);
  });

  test("nested elements with text between them, and an interpolated attribute", async () => {
    await runCase("given-nested", `<div id="host">\${ given @u :> { <div id="d" class="c-\${@n}"><b>\${@u.name}</b> track(@n) <i>\${@n}</i> - x</div> } }</div>`,
      "#d", (n) => `bob track(@n) ${n} - x`);
    expect(document.querySelector("#d")?.getAttribute("class")).toBe("c-4");
  });
});

describe("markup text between interpolations is text — sibling positions (s462)", () => {
  test("the canonical `if (@u is given) { <p>…</p> }` body", async () => {
    await runCase("if-track", `<div id="host">\${ if (@u is given) { <p id="p">\${@u.name} ${T} \${@n}</p> } }</div>`,
      "#p", (n) => `bob ${T} ${n}`);
  });

  test("an `if … else` cascade's markup arms", async () => {
    await runCase("ifelse-track", `<div id="host">\${ if (@n > 99) { <p id="p">\${@u.name} - \${@n}</p> } else { <p id="q">\${@n} track(@n) \${@n}</p> } }</div>`,
      "#q", (n) => `${n} track(@n) ${n}`);
  });

  test("`if (…) { lift <p>…</p> }`", async () => {
    await runCase("iflift-track", `<div id="host">\${ if (@u is given) { lift <p id="p">\${@u.name} - track(@n) - \${@n}</p> } }</div>`,
      "#p", (n) => `bob - track(@n) - ${n}`, true);
  });

  test("a `<match>` arm body", async () => {
    await runCase("match-track", `type St:enum = { Open, Closed }
<st>: St = .Open
<div id="host"><match for=St on=@st>
  <Open><p id="p">\${@u.name} ${T} \${@n}</p></>
  <Closed>"closed"</>
</match></div>`, "#p", (n) => `bob ${T} ${n}`);
  });

  test("an engine state-child body", async () => {
    await runCase("engine-track", `type Ph:enum = { Idle, Active }
<div id="host"><engine for=Ph initial=.Idle>
  <Idle rule=.Active><p id="p">\${@u.name} ${T} \${@n}</p></>
  <Active rule=.Idle></>
</></div>`, "#p", (n) => `bob ${T} ${n}`);
  });

  test("an `<each>` body", async () => {
    await runCase("each-track", `<ul id="host"><each in=@xs><li class="r">\${@.} track(@n) - \${@n}</li></each></ul>`,
      "#host", (n) => `x track(@n) - ${n}y track(@n) - ${n}`);
  });

  test("a component body", async () => {
    await runCase("comp-track", `const Card = <div class="card">\${@u.name} track(@n) - \${@n}</div>
<div id="host"><Card/></div>`, "#host", (n) => `bob track(@n) - ${n}`);
  });

  test("plain markup", async () => {
    await runCase("plain-track", `<p id="p">\${@u.name} ${T} \${@n}</p>`, "#p", (n) => `bob ${T} ${n}`);
  });
});

// Fix round 1 (S462 review of a273fd596).
describe("fix round 1 — fail closed, no new silent drops, no expression split (s462)", () => {
  // MED-2 + ruling Q24 (a): an element whose text the parser read as markup but that no
  // lowering renders is a compile ERROR — never an empty render at exit 0.
  const refused = {
    "`a < b` in the element's text (the implied-lift re-parse declines it)":
      `<div id="host">\${ if (@u is given) { <p>\${@n} a < b track(@n) \${@n}</p> } }</div>`,
    "a quoted `\"</p>\"` in the element's text":
      `<div id="host">\${ if (@u is given) { <p>\${@n} "</p>" track(@n) \${@n}</p> } }</div>`,
    "a `for` body without `lift`":
      `<div id="host">\${ for (const x of @xs) { <p>\${x} track(@n) - \${@n}</p> } }</div>`,
    "two elements in one arm":
      `<div id="host">\${ if (@n > 1) { <p>\${@n} track(@n) - \${@n}</p> <p>two</p> } }</div>`,
  };
  for (const [label, body] of Object.entries(refused)) {
    test(`refused: ${label}`, () => {
      const { errors } = compileAndMount(PRE + body + POST, "refused-" + label.replace(/[^a-z]+/gi, "-").slice(0, 30));
      expect(errors).toContain("E-MARKUP-STATEMENT-NOT-RENDERED");
    });
  }

  test("`lift` — the fix the refusal names — renders the nested element", async () => {
    const { errors } = compileAndMount(PRE + `<div id="host">\${ if (@n > 1) { <div id="d">\${@n} \${ if (@n > 2) { lift <b>\${@n}</b> } } tail</div> } }</div>` + POST, "liftfix");
    expect(errors).toEqual([]);
    await flush();
    expect(squash(text("#d"))).toBe("33 tail");
  });

  // S464 Q24 — g-statement-markup-after-statement-text-runs-s462 (HIGH): an element on the
  // line after a statement was read into that statement's expression, and its text after
  // the first interpolation was parsed as statements — `track(@n)` RAN (base: compiled
  // clean, emitted `let k = 1 < b > b; _scrml_track_…(…)`). Now refused.
  test("refused: an element after a statement whose text would run as code", () => {
    const { errors } = compileAndMount(PRE + `<div id="host">\${ if (@u is given) { const b = 2
  let k = 1
  <b>b \${@n} track(@n) \${@n}</b> } }</div>` + POST, "after-stmt-runs");
    expect(errors).toContain("E-MARKUP-STATEMENT-NOT-RENDERED");
  });

  // S464 Q24 — §17.6.10 reaches every markup `${…}` position, so a single-element
  // `${ if }` nested inside the element of an enclosing single-element arm renders
  // (base: the inner `<b>` was dropped at exit 0 — "33 tail" rendered as "3 tail").
  test("a nested single-element `${ if }` inside an implied-lift element renders and reacts", async () => {
    const { errors } = compileAndMount(PRE + `<div id="host">\${ if (@n > 1) { <div id="d">\${@n} \${ if (@n > 2) { <b>\${@n}</b> } } tail</div> } }</div>` + POST, "nested-implied");
    expect(errors).toEqual([]);
    await flush();
    expect(squash(text("#d"))).toBe("33 tail");
    globalThis.__mtc_set("n", 2);
    await flush();
    expect(squash(text("#d"))).toBe("2 tail");
    globalThis.__mtc_set("n", 5);
    await flush();
    expect(squash(text("#d"))).toBe("55 tail");
  });

  // LOW-3: an HTML comment in the element's text is skipped; its `</p>` closes nothing.
  test("an HTML comment holding `</p>` inside the element renders as on base", async () => {
    await runCase("html-comment", `<div id="host">\${ if (@u is given) { <p id="p">\${@n} <!-- </p> --> track(@n) \${@n}</p> } }</div>`,
      "#p", (n) => `${n} track(@n) ${n}`);
  });

  // HIGH-1: a `<` comparison continued on the next line stays one expression.
  test("`return @n⏎ <input && @n > 0` is evaluated as one expression (base: OUT)", async () => {
    const src = `<program>
@n = 3
@hits = 0
function inRange(input) {
  return @n
    <input && @n > 0
}
\${ @hits = inRange(2) ? "IN" : "OUT" }
<span id="hits">\${@hits}</span>
</program>
`;
    const { errors } = compileAndMount(src, "inv1");
    expect(errors).toEqual([]);
    await flush();
    expect(text("#hits")).toBe("OUT");
  });
});
