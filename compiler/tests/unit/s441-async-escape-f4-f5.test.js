/**
 * s441-async-escape-f4-f5.test.js — SECURITY.
 *
 * change-id: s441-async-escape-f4-f5
 *
 * Two accept-all holes where a Promise reached a synchronous consumer un-awaited
 * (a Promise is always truthy, so an authorization check passes for every input),
 * and the two fail-closed false positives the previous fix (#1139) introduced.
 *
 *   F5  g-server-call-in-inline-handler-condition-unawaited — an inline / block
 *       event handler or an `on mount` block never reached the function-body
 *       pipeline that awaits server calls: `onclick=${ if (isOk(1)) {…} }` emitted
 *       `if (isOk(1))`; `on mount` left `.some(x => isOk(x))` and a nested helper
 *       wrapping a server call bare. Fixed by analysing the emitted handler / mount
 *       text with acorn (codegen/js-async-analysis.ts) against the client's async
 *       facts: await where legal (the handler becomes `async`), lift clean-family
 *       callbacks to the awaited combinator, fail closed where `await` is impossible.
 *
 *   F4  g-async-helper-escaping-as-a-value-accept-all — RULED S440 (F4): an
 *       async-colored function used as a VALUE (aliased, stored in an array/object,
 *       passed to a user HOF / `Array.from`, returned, read as an object) is a
 *       compile error, E-ASYNC-FN-ESCAPES-AS-VALUE (§13.2, §34). Only the awaited
 *       collection methods may take it (plus a fire-and-forget scheduler, which
 *       discards the return, and `typeof`).
 *
 *   FP1 g-sync-callback-rawtext-scan-false-positives — the server raw-text scan of a
 *       block-body callback matched names in STRINGS, MEMBER calls, template TEXT,
 *       and another function's own sync `m`. Now a scope-aware acorn walk.
 *
 *   FP2 g-sync-local-with-async-name-treated-async — a SYNC nested function sharing
 *       an async name (`function verifyPassword(a, b) { return a - b }`) failed the
 *       build when passed to `.sort`. The binding in scope decides now.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeRawJsFragment, colorAsyncFunctionExpr, colorAsyncStatements, fnTextHasOwnAwait, bodyTextHasOwnAwait, unanalyzableHandlerUses, colorActiveHandler, setActiveClientAsync } from "../../src/codegen/js-async-analysis.ts";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/s441-async-escape-f4-f5");

beforeAll(() => mkdirSync(FIXTURE_DIR, { recursive: true }));
afterAll(() => { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {} });

const ESCAPE = "E-ASYNC-FN-ESCAPES-AS-VALUE";
const SERVER_CODE = "E-SERVER-FN-IN-SYNC-CALLBACK";
const STDLIB_CODE = "E-ASYNC-STDLIB-IN-SYNC-CALLBACK";

let _n = 0;
function compileFile(src) {
  const path = join(FIXTURE_DIR, `f${++_n}.scrml`);
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], write: false, log: () => {} });
  let clientJs = "";
  let serverJs = "";
  for (const [, out] of result.outputs) {
    clientJs += out.clientJs ?? "";
    serverJs += out.serverJs ?? "";
  }
  const errors = (result.errors || []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
  return { clientJs, serverJs, errors, codes: errors.map((e) => e.code) };
}

/** The emitted handler function texts, in source order. */
function handlers(js) {
  return [...js.matchAll(/"_scrml_attr_on[a-z]+_\d+": ((?:async )?(?:function\(event\)|\([^)]*\) =>|[a-z]+ =>)[\s\S]*?)\n?,\n(?=\s*"_scrml_attr_|\s*\};)/g)].map((m) => m[1]);
}

const AUTH_IMPORT = "${\n  import { verifyPassword } from 'scrml:auth'\n}\n";

// ---------------------------------------------------------------------------
// F5 — inline / block handlers
// ---------------------------------------------------------------------------
describe("F5 — a server call in an inline / block handler is awaited", () => {
  const app = (attr) => compileFile(`<program>
<v> = "unset"
<xs> = [1, 2, 3]
server function isOk(n) { return n > 100 }
function m(n) { return isOk(n) }
<p>\${@v}</p>
<button ${attr}>go</button>
</program>
`);

  test("`onclick=${ if (isOk(1)) {…} }` → an async handler that awaits the condition", () => {
    const o = app(`onclick=\${ if (isOk(1)) { @v = "yes" } else { @v = "no" } }`);
    expect(o.codes).toEqual([]);
    const h = handlers(o.clientJs)[0];
    expect(h).toMatch(/^async function\(event\)/);
    expect(h).toMatch(/if \(await _scrml_fetch_isOk_\d+\(1\)\)/);
  });

  test("block form `onclick={ if (isOk(1)) {…} }` → awaited too", () => {
    const o = app(`onclick={ if (isOk(1)) { @v = "yes" } else { @v = "no" } }`);
    expect(o.codes).toEqual([]);
    expect(handlers(o.clientJs)[0]).toMatch(/if \(await _scrml_fetch_isOk_\d+\(1\)\)/);
  });

  test("ternary / && / || / == / while / template / destructuring default — every operand awaited", () => {
    for (const [attr, pat] of [
      [`onclick=\${ @v = isOk(1) ? "a" : "b" }`, /await _scrml_fetch_isOk_\d+\(1\) \?/],
      [`onclick=\${ if (isOk(1) && true) { @v = "a" } }`, /if \(await _scrml_fetch_isOk_\d+\(1\) &&/],
      [`onclick=\${ if (isOk(1) || false) { @v = "a" } }`, /if \(await _scrml_fetch_isOk_\d+\(1\) \|\|/],
      [`onclick=\${ if (isOk(1) == true) { @v = "a" } }`, /if \(await _scrml_fetch_isOk_\d+\(1\) ===/],
      [`onclick={ let i = 0; while (isOk(i)) { i = i + 1 } }`, /while \(await _scrml_fetch_isOk_\d+\(i\)\)/],
      [`onclick=\${ @v = \`t \${isOk(1)}\` }`, /\$\{await _scrml_fetch_isOk_\d+\(1\)\}/],
      [`onclick={ const { a = isOk(1) } = {}; @v = a }`, /a = await _scrml_fetch_isOk_\d+/],
    ]) {
      const o = app(attr);
      expect(o.codes).toEqual([]);
      expect(handlers(o.clientJs)[0]).toMatch(pat);
    }
  });

  test("a transitively-async CLIENT helper is awaited in a handler condition", () => {
    const o = app(`onclick=\${ if (m(1)) { @v = "yes" } }`);
    expect(o.codes).toEqual([]);
    expect(handlers(o.clientJs)[0]).toMatch(/if \(await _scrml_m_\d+\(1\)\)/);
  });

  test("a clean-family callback in a handler is lifted to the awaited combinator", () => {
    const o = app(`onclick={ const ys = @xs.filter(x => isOk(x)); @v = "n" + ys.length }`);
    expect(o.codes).toEqual([]);
    expect(handlers(o.clientJs)[0]).toMatch(/await _scrml_filterAsync\(_scrml_cs_reactive_get\("xs"\), async \(?x\)? => await _scrml_fetch_isOk_\d+\(x\)\)/);
    expect(o.clientJs).toContain("async function _scrml_filterAsync(coll, cb)");
  });

  test("a server call the handler cannot await (a `.sort` comparator) fails closed", () => {
    const o = app(`onclick={ const s = [...@xs].sort((a, b) => isOk(a) ? 1 : -1); @v = "n" + s.length }`);
    expect(o.codes).toContain(SERVER_CODE);
  });

  test("regression: `@v = isOk(1)` keeps its reactive-set lift and a SYNC handler", () => {
    const o = app(`onclick=\${ @v = isOk(1) }`);
    expect(o.codes).toEqual([]);
    const h = handlers(o.clientJs)[0];
    expect(h).toMatch(/^function\(event\)/);
    expect(h).not.toContain("await await");
  });

  test("regression: a handler with no async call is byte-for-byte sync", () => {
    const o = app(`onclick=\${ @v = "plain" }`);
    expect(o.codes).toEqual([]);
    expect(handlers(o.clientJs)[0]).toMatch(/^function\(event\)/);
  });

  test("EXECUTED — the awaited handler takes the DENY branch when the server says false", async () => {
    const o = app(`onclick=\${ if (isOk(1)) { @v = "accepted" } else { @v = "rejected" } }`);
    expect(o.codes).toEqual([]);
    const h = handlers(o.clientJs)[0];
    const stub = h.match(/_scrml_fetch_isOk_\d+/)[0];
    const set = [];
    const fn = new Function(stub, "_scrml_cs_reactive_set", `return (${h});`)(
      async (n) => n > 100,
      (k, v) => set.push([k, v]),
    );
    await fn({});
    expect(set).toEqual([["v", "rejected"]]);
  });
});

// ---------------------------------------------------------------------------
// F5 — per-element handlers: `<each>` rows and `lift` (built as text, deep in
// call chains with no compile context — colored under the active client emission)
// ---------------------------------------------------------------------------
describe("F5 — `<each>` row and `lift` handlers", () => {
  test("an `<each>` row handler awaits its server-call condition", () => {
    const o = compileFile(`<program>
<v> = "unset"
<xs> = [1, 2, 3]
server function isOk(n) { return n > 100 }
<ul>
  <each in=@xs as x>
    <li><button onclick=\${ if (isOk(x)) { @v = "yes" } else { @v = "no" } }>\${x}</button></li>
  </each>
</ul>
</program>
`);
    expect(o.codes).toEqual([]);
    expect(o.clientJs).toMatch(/addEventListener\("click", async function\(event\) \{[^\n]*if \(await _scrml_fetch_isOk_\d+\(x\)\)/);
  });

  test("a `lift` handler awaits its server-call condition", () => {
    const o = compileFile(`<program>
<v> = "unset"
<xs> = [1, 2, 3]
server function isOk(n) { return n > 100 }
<ul>
\${ for (x of @xs) {
  lift <li><button onclick=\${ if (isOk(x)) { @v = "yes" } else { @v = "no" } }>b</button></li>
} }
</ul>
</program>
`);
    expect(o.codes).toEqual([]);
    expect(o.clientJs).toMatch(/addEventListener\("click", async function\(event\)/);
    expect(o.clientJs).toMatch(/if \(await _scrml_fetch_isOk_\d+\(x\)\)/);
    expect(o.clientJs).not.toMatch(/if \(_scrml_fetch_isOk_\d+\(x\)\)/);
  });

  test("an awaiting lift handler inside a match arm does NOT make the arm IIFE async (it belongs to the handler)", () => {
    // Regression found by the snippet gate (docs/tutorial-snippets/05-signup-form):
    // the match IIFE decided async-ness from a token scan, counted the handler's
    // own `await`, and stranded `await (async function() {…})()` in a sync effect.
    const o = compileFile(`<program>
type Phase:enum = { Editing, Done }
<engine for=Phase initial=.Editing>
  <Editing rule=.Done></>
  <Done rule=.Editing></>
</>
server function save(n) { return n > 1 }
function submit() {
  save(2)
  @phase = Phase.Done
}
\${ match @phase {
  .Editing :> { lift <form onsubmit=submit()><button>go</button></form> }
  .Done :> { lift <p>done</p> }
} }
</program>
`);
    expect(o.codes).toEqual([]);
    expect(o.clientJs).not.toMatch(/await \(async function\(\) \{/);
    expect(o.clientJs).toMatch(/addEventListener\("submit", async function\(event\)/);
  });

  test("an async fn used as a value in a row handler is E-ASYNC-FN-ESCAPES-AS-VALUE", () => {
    const o = compileFile(`<program>
<v> = "unset"
<xs> = [1, 2, 3]
server function isOk(n) { return n > 100 }
function decide(f, x) { return f(x) ? "a" : "r" }
<ul>
  <each in=@xs as x>
    <li><button onclick=\${ @v = decide(isOk, x) }>\${x}</button></li>
  </each>
</ul>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
  });
});

// ---------------------------------------------------------------------------
// F5 — `on mount`
// ---------------------------------------------------------------------------
describe("F5 — `on mount` bodies", () => {
  const mount = (body) => compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
function m(n) { return isOk(n) }
on mount {
${body}
}
<p>\${@v}</p>
</program>
`);
  const mountBlock = (js) => {
    const i = js.indexOf("`on mount` — async scope");
    return i < 0 ? "" : js.slice(i, js.indexOf('_scrml_error_boundary_log("on mount"', i));
  };

  test("`.some(x => isOk(x))` is lifted to the awaited combinator", () => {
    const o = mount(`  const any = [1, 2, 3].some(x => isOk(x))\n  @v = any ? "a" : "b"`);
    expect(o.codes).toEqual([]);
    expect(mountBlock(o.clientJs)).toMatch(/const any = await _scrml_someAsync\(\[1, 2, 3\], async \(?x\)? => await _scrml_fetch_isOk_\d+\(x\)\)/);
  });

  test("a nested helper wrapping a server call is emitted async and awaited", () => {
    const o = mount(`  function inner(x) { return isOk(x) }\n  if (inner(1)) { @v = "a" } else { @v = "b" }`);
    expect(o.codes).toEqual([]);
    const b = mountBlock(o.clientJs);
    expect(b).toMatch(/async function inner\s*\(\s*x\s*\)/);
    expect(b).toMatch(/if \(await inner\(1\)\)/);
  });

  test("a transitively-async client fn in a mount condition is awaited (pre-fix: bare)", () => {
    const o = mount(`  if (m(2)) { @v = "a" }`);
    expect(o.codes).toEqual([]);
    expect(mountBlock(o.clientJs)).toMatch(/if \(await _scrml_m_\d+\(2\)\)/);
  });

  test("an async fn used as a value in a mount body is E-ASYNC-FN-ESCAPES-AS-VALUE", () => {
    const o = mount(`  const g = isOk\n  @v = g(1) ? "a" : "b"`);
    expect(o.codes).toContain(ESCAPE);
  });

  test("regression: a mount body with no async call keeps its synchronous shape", () => {
    const o = mount(`  @v = "plain"`);
    expect(o.codes).toEqual([]);
    expect(o.clientJs).not.toContain("`on mount` — async scope");
  });
});

// ---------------------------------------------------------------------------
// F4 — async-colored functions may not escape as values
// ---------------------------------------------------------------------------
describe("F4 — E-ASYNC-FN-ESCAPES-AS-VALUE", () => {
  // A nested helper `m` inside a SERVER fn wraps scrml:auth verifyPassword.
  const serverNested = (body) => compileFile(`<program>
${AUTH_IMPORT}<v> = "unset"
server function check(pw, hash) {
  function m(h) { return verifyPassword(pw, h) }
  ${body}
}
function go() { @v = check("wrong", "h") }
<button onclick=go()>go</button>
</program>
`);
  // A CLIENT fn using a client helper `m` that calls a server fn.
  const clientHelper = (body) => compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
function m(n) { return isOk(n) }
function decide() {
  ${body}
}
function go() { @v = decide() }
<button onclick=go()>go</button>
</program>
`);

  const ESCAPES = [
    ["alias", `const g = m\n  return g(hash) ? "a" : "r"`, "aliased"],
    ["object field", `const o = {f: m}\n  return o.f(hash) ? "a" : "r"`, "stored in an object"],
    ["object shorthand", `const o = {m}\n  return o.m(hash) ? "a" : "r"`, "stored in an object"],
    ["array element", `const fs = [m]\n  return fs[0](hash) ? "a" : "r"`, "stored in an array"],
    ["user HOF", `function drive(f) { return f(hash) }\n  return drive(m) ? "a" : "r"`, "passed as an argument to `drive`"],
    ["Array.from", `const rs = Array.from([hash], m)\n  return rs[0] ? "a" : "r"`, "passed as an argument to `Array.from`"],
    ["returned", `function pick() { return m }\n  return pick()(hash) ? "a" : "r"`, "returned as a value"],
    [".call", `return m.call(null, hash) ? "a" : "r"`, "used as an object"],
  ];

  for (const [label, body, position] of ESCAPES) {
    test(`server nested helper — ${label} → ${ESCAPE}`, () => {
      const o = serverNested(body);
      expect(o.codes).toContain(ESCAPE);
      const e = o.errors.find((x) => x.code === ESCAPE);
      expect(e.message).toContain("`m`");
      expect(e.message).toContain("verifyPassword");
      expect(e.message).toContain(position);
      // A real source position, not the 1:1 expression placeholder.
      expect(e.span.line).toBeGreaterThan(1);
    });
    test(`client async helper — ${label} → ${ESCAPE}`, () => {
      const o = clientHelper(body.replaceAll("hash", "1"));
      expect(o.codes).toContain(ESCAPE);
    });
  }

  test("a server fn referenced as a value on the SERVER (escalated caller) → escape", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
function decide() {
  function drive(f) { return f(1) }
  return drive(isOk) ? "a" : "r"
}
function go() { @v = decide() }
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
  });

  test("an async fn in an inline handler, passed to a user HOF → escape", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
function drive(f) { return f(1) }
<button onclick=\${ @v = drive(isOk) ? "a" : "b" }>go</button>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
  });

  test("a top-level logic declaration storing a server fn is an escape", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
\${
  const checks = [isOk]
}
function go() { @v = checks[0](1) ? "accepted" : "rejected" }
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
    expect(o.errors.find((e) => e.code === ESCAPE).message).toContain("stored in an array");
  });

  test("an escape inside a server BLOCK-BODY callback (raw text) is caught too", () => {
    const o = serverNested(`const r = [hash].map(h => { const fs = [m]; return fs.length })\n  return r.length ? "a" : "r"`);
    expect(o.codes).toContain(ESCAPE);
  });

  // ── NOT escapes ─────────────────────────────────────────────────────────────
  const ALLOWED = [
    ["a direct call", `return m(hash) ? "a" : "r"`],
    ["the first argument of .some (awaited combinator)", `return [hash].some(m) ? "a" : "r"`],
    ["the first argument of .filter", `return [hash].filter(m).length ? "a" : "r"`],
    ["a fire-and-forget scheduler", `setTimeout(m, 10)\n  return "a"`],
    ["typeof", `return typeof m`],
  ];
  for (const [label, body] of ALLOWED) {
    test(`not an escape: ${label}`, () => {
      const o = serverNested(body);
      expect(o.codes).not.toContain(ESCAPE);
      expect(o.codes).toEqual([]);
    });
  }

  test("not an escape: a sync consumer keeps its OWN fail-closed code (`.sort(m)`)", () => {
    const o = serverNested(`return [hash].sort(m).length ? "a" : "r"`);
    expect(o.codes).toContain(STDLIB_CODE);
    expect(o.codes).not.toContain(ESCAPE);
  });

  test("not an escape: a SYNC helper aliased / stored / passed", () => {
    const o = compileFile(`<program>
server function check(n) {
  function twice(x) { return x * 2 }
  const g = twice
  const t = { d: twice }
  function drive(f) { return f(n) }
  return g(n) + t.d(n) + drive(twice)
}
<button onclick=\${ check(1) }>go</button>
</program>
`);
    expect(o.codes).toEqual([]);
  });

  test("not an escape: a plain helper route inference placed on the server (#284 dispatch)", () => {
    const o = compileFile(`<program>
\${
  function doubleIt(n) { return n * 2 }
  server function dispatchPlain(n, which) {
    const t = { d: doubleIt }
    return \`v \${t[which](n)}\`
  }
}
<div>P</div>
</program>
`);
    expect(o.codes).toEqual([]);
  });

  test("a shadowing param named like the async fn is not an escape", () => {
    const o = serverNested(`function use(m) { return [m] }\n  return use(1).length ? "a" : "r"`);
    expect(o.codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F4 EXECUTED — real scrml:auth hashing: the sanctioned form rejects a wrong password.
// ---------------------------------------------------------------------------
describe("F4 EXECUTED — real hashing through the sanctioned combinator", () => {
  test("`hashes.some(m)` with a nested verifyPassword helper: wrong → rejected, right → accepted", async () => {
    const dir = join(FIXTURE_DIR, "exec-f4");
    mkdirSync(dir, { recursive: true });
    const srcPath = join(dir, "app.scrml");
    writeFileSync(srcPath, `<program>
${AUTH_IMPORT}<v> = "unset"
server function check(pw, hash) {
  function m(h) { return verifyPassword(pw, h) }
  return [hash].some(m) ? "accepted" : "rejected"
}
function go() { @v = check("wrong", "h") }
<button onclick=go()>go</button>
</program>
`);
    const outDir = join(dir, "out");
    const res = compileScrml({ inputFiles: [srcPath], outputDir: outDir, write: true, log: () => {} });
    expect((res.errors || []).filter((e) => e.severity === "error").map((e) => e.code)).toEqual([]);
    const serverFile = readdirSync(outDir).find((f) => f.endsWith(".server.js"));
    const mod = await import(join(outDir, serverFile));
    const auth = await import(join(outDir, "_scrml", "auth.js"));
    const hash = await auth.hashPassword("right");
    const route = mod.routes.find((r) => /__ri_route_check_/.test(r.path));
    // A duck-typed request: under the full suite a DOM shim may own the global
    // `Request`, and a browser Request drops the forbidden `Cookie` header.
    const hdr = { "content-type": "application/json", cookie: "scrml_csrf=t", "x-csrf-token": "t" };
    const ask = async (pw) => {
      const r = await route.handler({
        url: "http://localhost" + route.path,
        method: "POST",
        headers: { get: (k) => hdr[String(k).toLowerCase()] ?? null },
        json: async () => ({ pw, hash }),
      });
      return JSON.parse(await r.text());
    };
    expect(await ask("wrong")).toBe("rejected");
    expect(await ask("right")).toBe("accepted");
  });
});

// ---------------------------------------------------------------------------
// FP1 — the raw block-body scan is scope / string / member aware
// ---------------------------------------------------------------------------
describe("FP1 — no false E-ASYNC-STDLIB-IN-SYNC-CALLBACK from raw text", () => {
  const server = (extra) => compileFile(`<program>
${AUTH_IMPORT}<out> = ""
server function check(pw, hash) {
  function m(h) { return verifyPassword(pw, h) }
  const ok = m(hash)
  ${extra}
}
function go() { @out = check("x", "y") }
<button onclick=go()>go</button>
</program>
`);

  test('a string `"m(" + x` in a block-body callback', () => {
    const o = server(`const ls = [1, 2].map(x => { return "m(" + x })\n  return ok ? ls.join(",") : "no"`);
    expect(o.codes).toEqual([]);
  });
  test("a member call `o.m(x)` in a block-body callback", () => {
    const o = server(`const o = { m: (x) => x + 1 }\n  const ys = [1, 2].map(x => { return o.m(x) })\n  return ok ? ys.join(",") : "no"`);
    expect(o.codes).toEqual([]);
  });
  test("template TEXT `call m(${pw})`", () => {
    const o = server("const msg = `call m(${pw})`\n  return ok ? msg : \"no\"");
    expect(o.codes).toEqual([]);
  });
  test("a local shadowing `m` inside the callback", () => {
    const o = server(`const ys = [1, 2].map(x => { const m = (y) => y; return m(x) })\n  return ok ? ys.join(",") : "no"`);
    expect(o.codes).toEqual([]);
  });
  test("a DIFFERENT server fn's own sync `m`", () => {
    const o = compileFile(`<program>
${AUTH_IMPORT}<out> = ""
server function check(pw, hash) {
  function m(h) { return verifyPassword(pw, h) }
  return m(hash) ? "yes" : "no"
}
server function label(xs) {
  function m(x) { return x + 1 }
  const ys = xs.map(x => { return m(x) })
  return ys.join(",")
}
function go() { @out = check("x", "y") + label([1, 2]) }
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toEqual([]);
  });

  test("still fails closed: the async `m(h)` called in a block-body callback", () => {
    const o = server(`const r = [hash].some(h => { return m(h) })\n  return r ? "a" : "r"`);
    expect(o.codes).toContain(STDLIB_CODE);
  });
  test("still fails closed: a template interpolation `${m(hash)}`", () => {
    const o = server("return `r ${m(hash)}`");
    expect(o.codes).toContain(STDLIB_CODE);
  });
  test("still fails closed: a direct verifyPassword in a block-body callback", () => {
    const o = server(`const r = [hash].some(h => { return verifyPassword(pw, h) })\n  return r ? "a" : "r"`);
    expect(o.codes).toContain(STDLIB_CODE);
  });
});

// ---------------------------------------------------------------------------
// FP2 — the binding in scope decides, not the name
// ---------------------------------------------------------------------------
describe("FP2 — a SYNC local sharing an async name", () => {
  const src = (body) => compileFile(`<program>
${AUTH_IMPORT}<out> = ""
server function check(pw, hash) {
  const ok = verifyPassword(pw, hash)
  return ok ? "yes" : "no"
}
server function ranked(xs) {
  ${body}
}
function go() { @out = check("x", "y") + ranked([3, 1, 2]) }
<button onclick=go()>go</button>
</program>
`);

  test("`.sort(verifyPassword)` with a sync local verifyPassword compiles", () => {
    const o = src(`function verifyPassword(a, b) { return a - b }\n  return xs.sort(verifyPassword).join(",")`);
    expect(o.codes).toEqual([]);
    expect(o.serverJs).toMatch(/xs\.sort\(verifyPassword\)/);
  });

  test("`.sort((a, b) => verifyPassword(a, b))` with a sync local compiles", () => {
    const o = src(`function verifyPassword(a, b) { return a - b }\n  return xs.sort((a, b) => verifyPassword(a, b)).join(",")`);
    expect(o.codes).toEqual([]);
  });

  test("F1 guard: a sync verifyPassword in a NON-enclosing block does not demote the import", () => {
    const o = src(`if (false) { function verifyPassword(a, b) { return a - b } }\n  return xs.sort(verifyPassword).join(",")`);
    expect(o.codes).toContain(STDLIB_CODE);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND (review:S441-f4f5-review)
// ---------------------------------------------------------------------------
describe("fix round 1 — a program-bound scheduler name is not the global scheduler", () => {
  const serverNested = (decl, use) => compileFile(`<program>
${AUTH_IMPORT}<v> = "unset"
server function check(pw, hash) {
  function m(h) { return verifyPassword(pw, h) }
  ${decl}
  return ${use} ? "accepted" : "rejected"
}
function go() { @v = check("wrong", "h") }
<button onclick=go()>go</button>
</program>
`);
  for (const nm of ["setTimeout", "queueMicrotask", "requestAnimationFrame"]) {
    test(`a LOCAL \`function ${nm}(f)\` handed an async fn → ${ESCAPE}`, () => {
      const o = serverNested(`function ${nm}(f) { return f(hash) }`, `${nm}(m)`);
      expect(o.codes).toContain(ESCAPE);
    });
  }
  test("a local scheduler given the async stdlib fn directly (`setTimeout(verifyPassword, pw, hash)`) → escape", () => {
    const o = serverNested(`function setTimeout(f, a, b) { return f(a, b) }`, `setTimeout(verifyPassword, pw, hash)`);
    expect(o.codes).toContain(ESCAPE);
  });
  test("a FILE-SCOPE `function setTimeout` (client) → escape", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
function m(n) { return isOk(n) }
function setTimeout(f) { return f(1) }
function decide() { return setTimeout(m) ? "accepted" : "rejected" }
function go() { @v = decide() }
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
  });
  test("a handler-local scheduler → escape", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
<button onclick=\${ function setTimeout(f) { return f(1) } @v = setTimeout(isOk) ? "a" : "r" }>go</button>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
  });
  test("a local scheduler given an async LAMBDA → the call in the lambda fails closed (no async lift)", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
function decide() {
  function setTimeout(f) { return f() }
  return setTimeout(() => isOk(1)) ? "accepted" : "rejected"
}
function go() { @v = decide() }
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toContain(SERVER_CODE);
  });
  for (const [label, decl, use] of [
    ["object destructuring", "const { setTimeout } = { setTimeout: (f) => f(hash) }", "setTimeout(m)"],
    ["array destructuring", "const [setTimeout] = [(f) => f(hash)]", "setTimeout(m)"],
    ["nested/default destructuring", "const { a: { setTimeout = (f) => f(hash) } = {} } = {}", "setTimeout(m)"],
    ["an arrow parameter", "const run = (setTimeout) => setTimeout(m)", "run((f) => f(hash))"],
    ["`= globalThis` (conservative: withdrawn)", "const { setTimeout } = globalThis", "setTimeout(m)"],
  ]) {
    test(`round 3 (N1): a scheduler name bound by ${label} → escape`, () => {
      const o = serverNested(decl, use);
      expect(o.codes).toContain(ESCAPE);
    });
  }
  test("round 3 (N1): a `for…of` binding named setTimeout → escape", () => {
    const o = compileFile(`<program>
${AUTH_IMPORT}<v> = "unset"
server function check(pw, hash) {
  function m(h) { return verifyPassword(pw, h) }
  for (const setTimeout of [(f) => f(hash)]) { return setTimeout(m) ? "a" : "r" }
  return "r"
}
function go() { @v = check("wrong", "h") }
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
  });
  test("round 3 (N1): a destructured scheduler inside a handler → escape", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
<button onclick=\${ const { setTimeout } = { setTimeout: (f) => f(1) }; @v = setTimeout(isOk) ? "a" : "r" }>go</button>
</program>
`);
    expect(o.codes).toContain(ESCAPE);
  });
  test("round 3 (N1 corpus regression): a COMMENT mentioning setTimeout does not withdraw the exemption", () => {
    // flogence/src/app.scrml: `// the poll setInterval handle` + `setTimeout(() => hydrate(), 0)`.
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
<t> = 0   // the setTimeout handle /* and setInterval */
function hydrate() { @v = isOk(1) ? "a" : "r" }
function go() {
  setTimeout(() => hydrate(), 0)
}
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toEqual([]);
  });
  test("control: the GLOBAL setTimeout still takes an async fn / callback", () => {
    const o = serverNested(`setTimeout(m, 10)`, `true`);
    expect(o.codes).toEqual([]);
  });
});

describe("fix round 2 — event control after the first await", () => {
  const app = (attr) => compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
${attr}
</program>
`);
  test("`preventDefault()` after an awaited call → E-EVENT-CONTROL-AFTER-AWAIT", () => {
    const o = app(`<form onsubmit=\${ @v = isOk(1) ? "a" : "r"; event.preventDefault() }><button>s</button></form>`);
    expect(o.codes).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
    expect(o.errors.find((e) => e.code === "E-EVENT-CONTROL-AFTER-AWAIT").message).toContain("preventDefault");
  });
  test("`stopPropagation()` after an awaited call → error", () => {
    const o = app(`<div><button onclick=\${ @v = isOk(1) ? "a" : "r"; event.stopPropagation() }>b</button></div>`);
    expect(o.codes).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
  });
  test("a CONDITIONAL preventDefault in the branch of an awaited test → error (not auto-hoisted)", () => {
    const o = app(`<a href="/x" onclick=\${ if (isOk(1)) { @v = "a" } else { event.preventDefault(); @v = "r" } }>l</a>`);
    expect(o.codes).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
  });
  test("control: preventDefault BEFORE the first await compiles and runs synchronously", () => {
    const o = app(`<form onsubmit=\${ event.preventDefault(); @v = isOk(1) ? "a" : "r" }><button>s</button></form>`);
    expect(o.codes).toEqual([]);
    expect(handlers(o.clientJs)[0]).toMatch(/^async function\(event\) \{ event\.preventDefault\(\);/);
  });
  test("round 3 (N2): a `const ev = event` alias after the await → error", () => {
    const o = app(`<form onsubmit=\${ const ev = event; @v = isOk(1) ? "a" : "r"; ev.preventDefault() }><button>s</button></form>`);
    expect(o.codes).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
  });
  test("round 3 (N2): `event[\"preventDefault\"]()` after the await → error", () => {
    const o = app(`<form onsubmit=\${ @v = isOk(1) ? "a" : "r"; event["preventDefault"]() }><button>s</button></form>`);
    expect(o.codes).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
  });
  test("round 3 (N2): a closure that calls preventDefault, invoked after the await → error", () => {
    const o = app(`<form onsubmit=\${ const stop = () => event.preventDefault(); @v = isOk(1) ? "a" : "r"; stop() }><button>s</button></form>`);
    expect(o.codes).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
  });
  test("round 3 (N3): an inner `(event) => event.preventDefault()` parameter is not the handler's event", () => {
    const o = app(`<form onsubmit=\${ @v = isOk(1) ? "a" : "r"; const objs = [{ preventDefault: () => 0 }]; objs.forEach((event) => event.preventDefault()) }><button>s</button></form>`);
    expect(o.codes).toEqual([]);
  });
  test("round 3 (N3): a block-local `const event` is not the handler's event", () => {
    const o = app(`<form onsubmit=\${ @v = isOk(1) ? "a" : "r"; if (true) { const event = { preventDefault: () => 0 }; event.preventDefault() } }><button>s</button></form>`);
    expect(o.codes).toEqual([]);
  });
  test("control: a handler with no await may call preventDefault anywhere", () => {
    const o = app(`<form onsubmit=\${ @v = "x"; event.preventDefault() }><button>s</button></form>`);
    expect(o.codes).toEqual([]);
  });
});

describe("fix round 3 — `.then` / `.catch` / `.finally` on an awaited call", () => {
  for (const m of ["then", "catch", "finally"]) {
    test(`handler: \`isOk(1).${m}(…)\` → E-ASYNC-CALL-PROMISE-METHOD`, () => {
      const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
<button onclick=\${ isOk(1).${m}((r) => { @v = "x" }) }>go</button>
</program>
`);
      expect(o.codes).toContain("E-ASYNC-CALL-PROMISE-METHOD");
      expect(o.errors.find((e) => e.code === "E-ASYNC-CALL-PROMISE-METHOD").message).toContain(`.${m}`);
    });
  }
  test("on mount: `isOk(2).then(…)` → error", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return n > 100 }
on mount {
  isOk(2).then((r) => { @v = "m" })
}
</program>
`);
    expect(o.codes).toContain("E-ASYNC-CALL-PROMISE-METHOD");
  });
  test("control: a member read that is not a Promise method (`isOk(1).ok`) is awaited, no error", () => {
    const o = compileFile(`<program>
<v> = "unset"
server function isOk(n) { return { ok: n > 100 } }
<button onclick=\${ @v = isOk(1).ok ? "a" : "r" }>go</button>
</program>
`);
    expect(o.codes).toEqual([]);
  });
});

describe("fix round 4 — an unanalysable handler fails closed", () => {
  const facts = (n) => (n === "isOk" ? { root: { kind: "server", via: "isOk" }, local: false } : null);
  test("unparseable text that names an async fn → reported", () => {
    const u = unanalyzableHandlerUses(`function(event) { if (isOk(1) { go() } }`, facts);
    expect(u.unanalyzable.map((x) => x.name)).toEqual(["isOk"]);
  });
  test("unparseable text with no async name → nothing", () => {
    expect(unanalyzableHandlerUses(`function(event) { if (x { go() } }`, facts)).toBeNull();
  });
  test("parseable text (a bare reference / non-function expression) is not this case", () => {
    expect(unanalyzableHandlerUses(`isOk`, facts)).toBeNull();
  });
  test("colorActiveHandler reports it under the active client emission", () => {
    const reported = [];
    const prev = setActiveClientAsync({ resolveFree: facts, report: (u) => reported.push(u) });
    try {
      const out = colorActiveHandler(`function(event) { if (isOk(1) { go() } }`);
      expect(out).toBe(`function(event) { if (isOk(1) { go() } }`);
    } finally { setActiveClientAsync(prev); }
    expect(reported.length).toBe(1);
    expect(reported[0].unanalyzable[0].name).toBe("isOk");
  });
});

// ---------------------------------------------------------------------------
// js-async-analysis — the text analyser itself
// ---------------------------------------------------------------------------
describe("js-async-analysis", () => {
  const facts = (n) =>
    n === "isOk" ? { root: { kind: "server", via: "isOk" }, local: false }
      : n === "m" ? { root: { kind: "stdlib", via: "verifyPassword" }, local: true }
        : null;

  test("raw: strings, members, template text and shadowing are not calls", () => {
    expect(analyzeRawJsFragment(`x => { return "m(" + x }`, facts).calls).toEqual([]);
    expect(analyzeRawJsFragment(`x => { return o.m(x) }`, facts).calls).toEqual([]);
    expect(analyzeRawJsFragment("`call m(${pw})`", facts).calls).toEqual([]);
    expect(analyzeRawJsFragment(`x => { const m = (y) => y; return m(x) }`, facts).calls).toEqual([]);
    expect(analyzeRawJsFragment(`x => { function m(y) { return y } return m(x) }`, facts).calls).toEqual([]);
  });

  test("raw: a real call / escape is reported", () => {
    expect(analyzeRawJsFragment(`h => { return m(h) }`, facts).calls.map((c) => c.name)).toEqual(["m"]);
    expect(analyzeRawJsFragment("`r ${m(pw)}`", facts).calls.map((c) => c.name)).toEqual(["m"]);
    expect(analyzeRawJsFragment(`h => drive(m)`, facts).escapes.map((e) => e.name)).toEqual(["m"]);
  });

  test("raw: an unparseable fragment returns null (callers fall back, fail closed)", () => {
    expect(analyzeRawJsFragment(`h => { return m(h`, facts)).toBeNull();
  });

  test("function expr: paren-correct await for a tight tail, deeper edits nest correctly", () => {
    const r = colorAsyncFunctionExpr(`function(e) { const t = isOk(1).ok; return a(b)(isOk(2)) }`, facts);
    expect(r.code).toBe(`async function(e) { const t = (await isOk(1)).ok; return a(b)(await isOk(2)) }`);
  });

  test("function expr: a combinator chained on a lifted combinator keeps its receiver parenthesized", () => {
    const r = colorAsyncFunctionExpr(`function(e) { const r = xs.filter(x => isOk(x)).map(x => x + 1); }`, facts);
    expect(r.code).toBe(`async function(e) { const r = (await _scrml_filterAsync(xs, async x => await isOk(x))).map(x => x + 1); }`);
  });

  test("statements: nested helpers color transitively (a → b → isOk)", () => {
    const r = colorAsyncStatements(`function a() { return b() }\nfunction b() { return isOk(1) }\nif (a()) go()`, facts);
    expect(r.rootAsync).toBe(true);
    expect(r.code).toBe(`async function a() { return await b() }\nasync function b() { return await isOk(1) }\nif (await a()) go()`);
  });

  test("statements: an async call in a sync callback that is not liftable is reported", () => {
    const r = colorAsyncStatements(`const s = xs.sort((a, b) => isOk(a) ? 1 : -1)`, facts);
    expect(r.calls.map((c) => c.name)).toEqual(["isOk"]);
  });

  test("own-level await: an await inside a nested function does not count", () => {
    expect(fnTextHasOwnAwait(`function() { el.addEventListener("x", async function(e) { await go() }) }`)).toBe(false);
    expect(fnTextHasOwnAwait(`(async function() { const r = await go(); })()`)).toBe(true);
    expect(bodyTextHasOwnAwait(`for await (const x of xs) { f(x) }`)).toBe(true);
    expect(bodyTextHasOwnAwait(`const f = async () => { await g() }`)).toBe(false);
    expect(fnTextHasOwnAwait(`function( { `)).toBeNull();
  });

  test("statements: a scheduler callback that reaches async is made async, not reported", () => {
    const r = colorAsyncStatements(`setTimeout(() => { if (isOk(1)) go() }, 10)`, facts);
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(`setTimeout(async () => { if (await isOk(1)) go() }, 10)`);
  });
});
