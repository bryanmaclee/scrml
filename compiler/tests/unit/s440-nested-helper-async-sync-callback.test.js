/**
 * s440-nested-helper-async-sync-callback.test.js — SECURITY.
 *
 * change-id: s440-sync-callback-async-helper
 *
 * THE BUG. The fail-closed guards E-SERVER-FN-IN-SYNC-CALLBACK /
 * E-ASYNC-STDLIB-IN-SYNC-CALLBACK (§13.2, §34) were bypassed when the async call
 * was wrapped in a function declared INSIDE the enclosing function:
 *
 *     function go() {
 *       function inner(x) { return isOk(x) }         // isOk: a server fn
 *       const any = [1, 2, 3].some(x => inner(x))
 *     }
 *
 * emitted `async function inner(x) { return await _scrml_fetch_isOk(x) }` and then
 * `[1, 2, 3].some((x) => inner(x))` — a Promise per element, always truthy, so
 * `.some` was TRUE FOR EVERY INPUT (the accept-all the guards exist to prevent),
 * with no diagnostic. Root cause: every async-colored set the emitters consult
 * (`computeAsyncFnNames`, the server peer set) is built from FILE-SCOPE functions,
 * so a nested helper was emitted `async` (its body awaits) yet treated as sync at
 * every call site. The same hole left a direct `const r = inner(5)` un-awaited, a
 * `.sort(inner)` comparator comparing Promises, and a nested `inner → b → server fn`
 * chain with `inner` not even emitted async.
 *
 * THE FIX (codegen/local-async-fns.ts). A lexical pre-pass, run by every emitter
 * with its own async facts before a body is emitted, marks which nested helpers are
 * async and resolves every call / by-reference use to them. A nested async helper is
 * then treated EXACTLY as a file-scope one:
 *   - awaitable position               → awaited;
 *   - clean-family callback (`.some`/`.every`/`.find`/`.filter`/`.map`/…) → lifted to
 *     the async combinator (DD colorless-async-boundaries FORK 1) — the callback is
 *     awaited, so the reproducer is CORRECT (`false`), not rejected, matching the
 *     file-scope helper;
 *   - a position the compiler CANNOT await (`.sort` comparator — FORK 2 — a sync
 *     lambda, a parameter default, a by-reference arg to a non-combinator) → FAIL
 *     CLOSED, with the code the helper's ROOT names (peer server fn →
 *     E-SERVER-FN-IN-SYNC-CALLBACK; stdlib / `?{}` → E-ASYNC-STDLIB-IN-SYNC-CALLBACK),
 *     at a real line/col (expression spans carried a `1:1` placeholder).
 *
 * Every shape is exercised on the CLIENT (a client fn calling a server fn) AND the
 * SERVER (a server fn whose nested helper calls a peer server fn), plus the stdlib
 * root in library mode. Two EXECUTED checks run the emitted code.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/s440-nested-helper-async");

beforeAll(() => mkdirSync(FIXTURE_DIR, { recursive: true }));
afterAll(() => { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {} });

const SERVER_CODE = "E-SERVER-FN-IN-SYNC-CALLBACK";
const STDLIB_CODE = "E-ASYNC-STDLIB-IN-SYNC-CALLBACK";

let _n = 0;
function compileFile(src, mode) {
  const path = join(FIXTURE_DIR, `f${++_n}.scrml`);
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], write: false, log: () => {}, ...(mode ? { mode } : {}) });
  let clientJs = "";
  let serverJs = "";
  let libraryJs = "";
  for (const [, out] of result.outputs) {
    clientJs += out.clientJs ?? "";
    serverJs += out.serverJs ?? "";
    libraryJs += out.libraryJs ?? "";
  }
  const errors = (result.errors || []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  return { clientJs, serverJs, libraryJs, errors, codes: errors.map((e) => e.code) };
}

/** A client fn `go` whose body is `body`; `isOk` is a server fn. */
function clientApp(body) {
  return compileFile(
    `<program>\nserver function isOk(n) { return n > 100 }\nfunction go() {\n  ${body}\n  console.log("R", r)\n}\n<button onclick=go()>go</button>\n</program>\n`,
  );
}
/** A server fn `outer` whose body is `body`; `isOk` is a PEER server fn. */
function serverApp(body) {
  return compileFile(
    `<program>\nserver function isOk(n) { return n > 100 }\nserver function outer() {\n  ${body}\n  return r\n}\nfunction go() { const q = outer(); console.log(q) }\n<button onclick=go()>go</button>\n</program>\n`,
  );
}
const SIDES = [
  ["client", clientApp, (o) => o.clientJs],
  ["server", serverApp, (o) => o.serverJs],
];

const NESTED = "function inner(x) { return isOk(x) }";

// ---------------------------------------------------------------------------
// (1) THE REPRODUCER — a nested helper inside a clean-family callback is now
//     awaited through the async combinator (it was a bare always-truthy Promise).
// ---------------------------------------------------------------------------
describe("nested helper in a clean-family callback → async combinator (no longer an always-truthy Promise)", () => {
  for (const [side, compile, jsOf] of SIDES) {
    for (const m of ["some", "every", "find", "filter", "map"]) {
      test(`${side}: .${m}(x => inner(x)) is lifted and awaited`, () => {
        const o = compile(`${NESTED}\n  const r = [1, 2, 3].${m}(x => inner(x))`);
        expect(o.codes).toEqual([]);
        const js = jsOf(o);
        expect(js).toMatch(/async function inner\(x\)/);
        expect(js).toContain(`await _scrml_${m}Async([1, 2, 3], async (x) => await inner(x))`);
        // The pre-fix bug shape must be gone.
        expect(js).not.toContain(`[1, 2, 3].${m}((x) => inner(x))`);
      });
    }
    test(`${side}: by-reference .some(inner) is lifted`, () => {
      const o = compile(`${NESTED}\n  const r = [1, 2, 3].some(inner)`);
      expect(o.codes).toEqual([]);
      expect(jsOf(o)).toContain("await _scrml_someAsync([1, 2, 3], inner)");
    });
    test(`${side}: a helper used BEFORE its declaration (hoisting) is still lifted`, () => {
      const o = compile(`const r = [1, 2, 3].some(x => inner(x))\n  ${NESTED}`);
      expect(o.codes).toEqual([]);
      expect(jsOf(o)).toContain("await _scrml_someAsync([1, 2, 3], async (x) => await inner(x))");
    });
  }
});

// ---------------------------------------------------------------------------
// (2) awaitable positions — a direct call to a nested async helper is awaited
//     (it was a bare Promise: `r.field` read `undefined`).
// ---------------------------------------------------------------------------
describe("nested async helper in an awaitable position is awaited", () => {
  for (const [side, compile, jsOf] of SIDES) {
    test(`${side}: const r = inner(500) → await inner(500)`, () => {
      const o = compile(`${NESTED}\n  const r = inner(500)`);
      expect(o.codes).toEqual([]);
      expect(jsOf(o)).toContain("const r = await inner(500);");
    });
    test(`${side}: a receiver use is paren-wrapped — (await inner(500)).toString()`, () => {
      const o = compile(`${NESTED}\n  const r = inner(500).toString()`);
      expect(o.codes).toEqual([]);
      expect(jsOf(o)).toContain("(await inner(500)).toString()");
    });
    test(`${side}: TRANSITIVE nested chain inner → b → server fn — both async, both awaited`, () => {
      const o = compile(`function b(x) { return isOk(x) }\n  function inner(x) { return b(x) }\n  const r = inner(500)`);
      expect(o.codes).toEqual([]);
      const js = jsOf(o);
      expect(js).toMatch(/async function b\(x\)/);
      expect(js).toMatch(/async function inner\(x\)/);
      expect(js).toContain("return await b(x);");
      expect(js).toContain("const r = await inner(500);");
    });
  }
});

// ---------------------------------------------------------------------------
// (3) positions the compiler CANNOT await → FAIL CLOSED, peer-server-fn code,
//     real line (not 1:1).
// ---------------------------------------------------------------------------
describe("nested async helper where `await` is impossible → E-SERVER-FN-IN-SYNC-CALLBACK", () => {
  const cases = [
    ["`.sort` comparator (DD FORK 2)", `${NESTED}\n  const r = [3, 1, 2].sort((a, c) => inner(a) ? -1 : 1)`, 5],
    ["by-reference `.sort(inner)`", `${NESTED}\n  const r = [3, 1, 2].sort(inner)`, 5],
    ["a sync lambda calling the helper", `${NESTED}\n  const f = (x) => inner(x)\n  const r = f(1)`, 5],
    ["TRANSITIVE chain in a `.sort` comparator", `function b(x) { return isOk(x) }\n  function inner(x) { return b(x) }\n  const r = [3, 1, 2].sort((a, c) => inner(a) ? -1 : 1)`, 6],
    ["a nested fn's parameter default", `${NESTED}\n  function g(y = inner(1)) { return y }\n  const r = g()`, 5],
  ];
  for (const [side, compile] of SIDES) {
    for (const [label, body, line] of cases) {
      test(`${side}: ${label}`, () => {
        const o = compile(body);
        expect(o.codes).toContain(SERVER_CODE);
        expect(o.codes).not.toContain(STDLIB_CODE);
        const e = o.errors.find((x) => x.code === SERVER_CODE);
        expect(e.span.line).toBe(line);
      });
    }
  }
  test("the message names the helper AND the server fn it is async through", () => {
    const o = clientApp(`${NESTED}\n  const r = [3, 1, 2].sort((a, c) => inner(a) ? -1 : 1)`);
    const e = o.errors.find((x) => x.code === SERVER_CODE);
    expect(e.message).toContain("`inner`");
    expect(e.message).toContain("`isOk`");
  });
});

// ---------------------------------------------------------------------------
// (4) code choice + span for an ARROW-bound helper (already fail-closed at the
//     definition — a sync lambda body — but the client reported the STDLIB code
//     for a peer server fn, at 1:1).
// ---------------------------------------------------------------------------
describe("arrow-bound helper `const inner = (x) => isOk(x)` — peer-server-fn code at the real line", () => {
  for (const [side, compile] of SIDES) {
    test(`${side}: E-SERVER-FN-IN-SYNC-CALLBACK at line 4, exactly once`, () => {
      const o = compile("const inner = (x) => isOk(x)\n  const r = [1, 2, 3].some(x => inner(x))");
      expect(o.codes).toEqual([SERVER_CODE]);
      expect(o.errors[0].span.line).toBe(4);
    });
  }
});

// ---------------------------------------------------------------------------
// (5) by-reference to a non-combinator — the FILE-SCOPE form was silent too.
// ---------------------------------------------------------------------------
describe("an async function passed BY REFERENCE to `.sort` fails closed (file-scope too)", () => {
  for (const [side, compile] of SIDES) {
    test(`${side}: [..].sort(isOk)`, () => {
      const o = compile("const r = [3, 1, 2].sort(isOk)");
      expect(o.codes).toContain(SERVER_CODE);
    });
  }
  for (const [side, compile] of SIDES) {
    test(`${side}: nested helper by reference to .findLast (no async combinator) fails closed`, () => {
      const o = compile(`${NESTED}\n  const r = [1, 2, 3].findLast(inner)`);
      expect(o.codes).toContain(SERVER_CODE);
    });
  }
  test("a fire-and-forget scheduler by reference is NOT rejected (it discards the result)", () => {
    const o = clientApp(`${NESTED}\n  setTimeout(inner, 10)\n  const r = 1`);
    expect(o.codes).toEqual([]);
  });
  // A user higher-order function may AWAIT the function it is handed (flogence's
  // `runGatedAgentic(cwd, id, runLane)` drives the thunk with a foreign
  // `await run()`), and the compiler cannot see which — so passing an async helper
  // to one is NOT rejected (found by the s440 corpus measure: a first draft that
  // flagged every by-reference argument refused that correct program).
  test("an async helper passed by reference to a user HOF is NOT rejected", () => {
    const o = compileFile(`<program>
server function isOk(n) { return n > 100 }
function drive(run) { return run(5) }
function go() {
  ${NESTED}
  const r = drive(inner)
  console.log(r)
}
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).not.toContain(SERVER_CODE);
    expect(o.codes).not.toContain(STDLIB_CODE);
  });
});

// ---------------------------------------------------------------------------
// (6) negative controls — sync nested helpers are untouched.
// ---------------------------------------------------------------------------
describe("negative controls", () => {
  for (const [side, compile, jsOf] of SIDES) {
    test(`${side}: a SYNC nested helper in .some / .sort stays native, no diagnostic`, () => {
      const o = compile("function inner(x) { return x > 1 }\n  const a = [1, 2, 3].some(x => inner(x))\n  const r = [3, 1, 2].sort((p, q) => inner(p) ? -1 : 1)");
      expect(o.codes).toEqual([]);
      const js = jsOf(o);
      expect(js).toMatch(/[^c] function inner\(x\)|^function inner\(x\)/m);
      expect(js).not.toMatch(/async function inner/);
      expect(js).toContain("[1, 2, 3].some((x) => inner(x))");
      expect(js).not.toContain("_scrml_someAsync");
    });
  }
  // CLIENT only: on the server a nested fn named like a peer server fn trips the
  // pre-existing E-CG-016 bundle-name collision (unchanged by s440).
  // Fix round (F1): a call resolving to a SYNC nested fn is never DEMOTED below the
  // treatment its name gets — a wrong shadow decision was the fail-open direction.
  // A same-named sync local therefore keeps the async outer name's treatment
  // (awaited / lifted: harmless on a sync value), and compiles clean.
  test("client: a SYNC nested helper SHADOWING the server fn's name compiles clean (never demoted)", () => {
    const o = clientApp("function isOk(x) { return x > 1 }\n  const r = [1, 2, 3].some(x => isOk(x))");
    expect(o.codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (7) STDLIB root — a nested helper async through `verifyPassword` (the original
//     accept-every-password shape, wrapped one level deeper).
// ---------------------------------------------------------------------------
describe("stdlib-rooted nested helper (scrml:auth verifyPassword)", () => {
  const lib = (body) => compileFile(`\${
  import { verifyPassword } from "scrml:auth"
  export function check(pw, hs) {
    function inner(h) { return verifyPassword(pw, h) }
    ${body}
  }
}
`, "library");
  const web = (body) => compileFile(`<program>
\${
  import { verifyPassword } from 'scrml:auth'
}
server function check(pw, hs) {
  function inner(h) { return verifyPassword(pw, h) }
  ${body}
}
function go() { const q = check("a", ["x"]); console.log(q) }
<button onclick=go()>go</button>
</program>
`);
  for (const [label, compile, jsOf] of [["library", lib, (o) => o.libraryJs], ["server", web, (o) => o.serverJs]]) {
    test(`${label}: hs.some(h => inner(h)) is lifted — NOT an accept-all`, () => {
      const o = compile("return hs.some(h => inner(h))");
      expect(o.codes).toEqual([]);
      expect(jsOf(o)).toContain("await _scrml_someAsync(hs, async (h) => await inner(h))");
    });
    test(`${label}: hs.sort(...inner...) fails closed with the STDLIB code`, () => {
      const o = compile("return hs.sort((a, b) => inner(a) ? -1 : 1)");
      expect(o.codes).toContain(STDLIB_CODE);
      expect(o.codes).not.toContain(SERVER_CODE);
      const e = o.errors.find((x) => x.code === STDLIB_CODE);
      expect(e.message).toContain("`verifyPassword(…)`");
    });
    test(`${label}: hs.sort(inner) by reference fails closed`, () => {
      const o = compile("return hs.sort(inner)");
      expect(o.codes).toContain(STDLIB_CODE);
    });
  }
});

// ---------------------------------------------------------------------------
// (7b) FIX ROUND — block scope + fail-closed shadowing (F1, F3) and server
//      block-body callbacks / templates (F2).
// ---------------------------------------------------------------------------
describe("fix round — F1: a block-scoped declaration never shadows the async name OUTSIDE its block", () => {
  const src = (core) => `<program>
\${
  import { verifyPassword } from 'scrml:auth'
}
server function login(pw, hash) {
  if (false) { function verifyPassword(a, b) { return false } }
  ${core}
}
function go() { const q = login("x", "y"); console.log(q) }
<button onclick=go()>go</button>
</program>
`;
  test("server: `if (verifyPassword(pw, hash))` after the block is AWAITED (the first draft left it bare)", () => {
    const o = compileFile(src(`if (verifyPassword(pw, hash)) { return "accepted" }\n  return "rejected"`));
    expect(o.codes).toEqual([]);
    expect(o.serverJs).toContain("if (await verifyPassword(pw, hash))");
    expect(o.serverJs).not.toMatch(/if \(verifyPassword\(pw, hash\)\)/);
  });
  test("server: `.some(p => verifyPassword(p, hash))` after the block is lifted + awaited", () => {
    const o = compileFile(src(`return ["x", pw].some(p => verifyPassword(p, hash)) ? "accepted" : "rejected"`));
    expect(o.codes).toEqual([]);
    expect(o.serverJs).toContain("await verifyPassword(p, hash)");
  });
  test("server: a helper `m` calling the real verifyPassword is async — its `.sort` use fails closed", () => {
    const o = compileFile(src(`function m(p) { return verifyPassword(p, hash) }\n  return [pw].sort((a, b) => m(a) ? -1 : 1)`));
    expect(o.codes).toContain(STDLIB_CODE);
  });
});

describe("fix round — F3: a sibling-block `let` does not hide a nested async helper", () => {
  for (const [side, compile, jsOf] of SIDES) {
    test(`${side}: \`if (true) { let inner = 5 }\` + inner(x) in .some → lifted, not bare`, () => {
      const o = compile(`${NESTED}\n  if (true) { let inner = 5 }\n  const r = [1, 2, 3].some(x => inner(x))`);
      expect(o.codes).toEqual([]);
      expect(jsOf(o)).toContain("await _scrml_someAsync([1, 2, 3], async (x) => await inner(x))");
    });
    test(`${side}: ... and in .sort → fails closed`, () => {
      const o = compile(`${NESTED}\n  if (true) { let inner = 5 }\n  const r = [3, 1, 2].sort((a, c) => inner(a) ? -1 : 1)`);
      expect(o.codes).toContain(SERVER_CODE);
    });
  }
});

describe("fix round — F2: SERVER block-body callbacks and template interpolations fail closed", () => {
  const cases = [
    ["block-body .some", `${NESTED}\n  const r = [1, 2, 3].some(x => { return inner(x) })`],
    ["block-body .forEach with if", `${NESTED}\n  let r = false;\n  [1, 2, 3].forEach(x => { if (inner(x)) { r = true } })`],
    ["block-body .some with if", `${NESTED}\n  const r = [1, 2, 3].some(x => { if (inner(x)) { return true } return false })`],
    ["template interpolation", `${NESTED}\n  const s = \`\${inner(1)}\`\n  const r = s == "false" ? false : true`],
  ];
  for (const [label, body] of cases) {
    test(`server: ${label}`, () => {
      const o = serverApp(body);
      expect(o.codes).toContain(SERVER_CODE);
    });
  }
  test("server: stdlib-rooted helper in a block-body .some → the STDLIB code", () => {
    const o = compileFile(`<program>
\${
  import { verifyPassword } from 'scrml:auth'
}
server function check(pw, hashes) {
  function m(h) { return verifyPassword(pw, h) }
  const r = hashes.some(h => { return m(h) })
  return r ? "accepted" : "rejected"
}
function go() { const q = check("x", ["a"]); console.log(q) }
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toContain(STDLIB_CODE);
  });
});

// ---------------------------------------------------------------------------
// (8) EXECUTED — run the emitted code. The reproducer answers `false`, not `true`.
// ---------------------------------------------------------------------------
describe("EXECUTED — the reproducer's `.some` answers false", () => {
  test("client: the emitted go() logs `false` for isOk ≡ false (pre-fix: `true`)", async () => {
    const o = compileFile(`<program>
server function isOk(n) { return n > 100 }
function go() {
  function inner(x) { return isOk(x) }
  const any = [1, 2, 3].some(x => inner(x))
  console.log("R", any)
}
<button onclick=go()>go</button>
</program>
`);
    expect(o.codes).toEqual([]);
    const js = o.clientJs;
    // The go fn ends at the first column-0 `}` followed by a blank line (the nested
    // helper's own closing brace is also at column 0, but not followed by one).
    const goSrc = js.match(/async function _scrml_go_\d+\(\) \{[\s\S]*?\n\}\n\n/);
    const someSrc = js.match(/async function _scrml_someAsync\(coll, cb\) \{[\s\S]*?\n\}\n/);
    const stub = js.match(/_scrml_fetch_isOk_\d+/);
    expect(goSrc && someSrc && stub).toBeTruthy();
    const logged = [];
    const run = new Function(
      "console", stub[0],
      `${someSrc[0]}\n${goSrc[0]}\nreturn ${goSrc[0].match(/_scrml_go_\d+/)[0]}();`,
    );
    // The server fn resolves a JSON boolean; every Promise was truthy pre-fix.
    await run({ log: (...a) => logged.push(a) }, async (n) => n > 100);
    expect(logged).toEqual([["R", false]]);
  });

  test("library: a nested async helper in .some / .filter computes the right values", async () => {
    const dir = join(FIXTURE_DIR, "e2e");
    mkdirSync(dir, { recursive: true });
    const srcPath = join(dir, "nested.scrml");
    writeFileSync(srcPath, `\${
  import { safeCallAsync } from "scrml:host"
  export function anyBig(nums) {
    function big(n) { return safeCallAsync(() => n > 100) }
    return nums.some(n => big(n))
  }
  export function bigOnes(nums) {
    function big(n) { return safeCallAsync(() => n > 2) }
    return nums.filter(n => big(n))
  }
}
`);
    const outDir = join(dir, "out");
    const res = compileScrml({ inputFiles: [srcPath], outputDir: outDir, write: true, log: () => {} });
    const codes = (res.errors || []).filter((e) => e.severity === "error").map((e) => e.code);
    expect(codes).toEqual([]);
    const mod = await import(join(outDir, "nested.js"));
    expect(await mod.anyBig([1, 2, 3])).toBe(false);
    expect(await mod.bigOnes([1, 2, 3, 4])).toEqual([3, 4]);
  });
});
