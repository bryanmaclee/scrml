/**
 * colorless-async-discard-hof.test.js — S279 KNOWN-DISCARD-HOF over-fire fix.
 *
 * COLORLESS ASYNC (S259) auto-awaits async calls where `await` is legal, and for
 * clean-family collection methods lowers an async callback to `await
 * _scrml_<method>Async(...)`. `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` is the fail-closed
 * backstop for an async call in a value-coercion position the compiler can neither
 * await nor lower.
 *
 * The backstop OVER-FIRED on fire-and-forget scheduler callbacks —
 * `setTimeout(() => hydrate(), 0)` where `hydrate` is async — because the timer
 * STRUCTURALLY DISCARDS the callback's return, so the coercion hazard is
 * UNREACHABLE, yet the sync lambda hit the backstop. The fix mirrors the combinator
 * lowering for a KNOWN-DISCARD-HOF set (`setTimeout`/`setInterval`/`setImmediate`/
 * `queueMicrotask`/`requestAnimationFrame`/`requestIdleCallback`): re-emit the
 * async callback lambda ASYNC so its inner async call auto-awaits INSIDE the async
 * callback. The HOF call itself is NOT awaited (a timer id, not a Promise). Only
 * BARE-IDENT global calls match — a member `obj.setTimeout` stays fail-closed.
 *
 * Case 2 (an async thunk passed to a USER higher-order fn NOT in the discard set)
 * MUST still fail closed — the compiler can't verify a user HOF awaits its callback.
 *
 * Coverage:
 *   (1) setTimeout/setInterval async callback → clean, callback async, inner call
 *       awaited INSIDE the callback (NOT on the timer). node --check clean.
 *   (2) all six KNOWN-DISCARD-HOFs compile clean with an async callback.
 *   (3) CLIENT mode: same discard-HOF lowering on the browser path.
 *   (4) NEGATIVE controls unchanged: `.filter` async predicate still lowers to the
 *       combinator; a param-default async call still fires the backstop; a USER HOF
 *       (Case 2) still fires; a member `obj.setTimeout` still fires.
 *   (5) sync callback in a discard HOF is byte-stable (no async wrap).
 *
 * SPEC / authority: §13.1 stdlib carve-out · §13.2 auto-await · §34
 * E-ASYNC-STDLIB-IN-SYNC-CALLBACK; DD colorless-async-boundaries; bryan-ruled S279.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { KNOWN_DISCARD_HOF } from "../../src/codegen/async-combinators.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/colorless-async-discard-hof");

beforeAll(() => mkdirSync(FIXTURE_DIR, { recursive: true }));
afterAll(() => { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {} });

const CODE = "E-ASYNC-STDLIB-IN-SYNC-CALLBACK";

/** Compile a `${}` server-block fixture in library mode; return { js, codes }. */
function compileLib(name, src) {
  const path = join(FIXTURE_DIR, name + ".scrml");
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], mode: "library", write: false, log: () => {} });
  let js = "";
  for (const [fp, out] of result.outputs) {
    if (fp.endsWith(`${name}.scrml`)) { js = out.libraryJs ?? ""; break; }
  }
  const codes = (result.errors || [])
    .filter((e) => e.severity !== "warning" && e.severity !== "info")
    .map((e) => e.code);
  return { js, codes };
}

/** Compile a `<program>` fixture (auto-detected app mode); return the requested field. */
function compileApp(name, src, field) {
  const path = join(FIXTURE_DIR, name + ".scrml");
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], write: false, log: () => {} });
  let js = "";
  for (const [fp, out] of result.outputs) {
    if (fp.endsWith(`${name}.scrml`)) { js = out[field] ?? ""; break; }
  }
  const codes = (result.errors || [])
    .filter((e) => e.severity !== "warning" && e.severity !== "info")
    .map((e) => e.code);
  return { js, codes };
}

/** `node --check` the emitted JS — a real syntax gate, not a grep. Throws on a
 *  parse error (a codegen miscompile is otherwise silent). */
function nodeCheck(name, js) {
  const path = join(FIXTURE_DIR, name + ".mjs");
  writeFileSync(path, js);
  execFileSync("node", ["--check", path], { stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// (1) setTimeout / setInterval — the core over-fire repro, now clean
// ---------------------------------------------------------------------------
describe("fire-and-forget scheduler with an async callback compiles clean (S279)", () => {
  const cases = [
    ["setTimeout", "setTimeout(() => verifyPassword(pw, h), 0)"],
    ["setInterval", "setInterval(() => verifyPassword(pw, h), 1000)"],
  ];
  for (const [hof, expr] of cases) {
    test(`${hof}(() => asyncFn(), n) → no ${CODE}; callback async + inner awaited INSIDE`, () => {
      const { js, codes } = compileLib(`d-${hof.toLowerCase()}`, `\${
  import { verifyPassword } from "scrml:auth"
  export function schedule(pw, h) { ${expr} }
}
`);
      // The over-fire is gone.
      expect(codes).not.toContain(CODE);
      // The callback is re-emitted ASYNC and the inner async call auto-awaits INSIDE it.
      const m = js.match(new RegExp(`${hof}\\(([^\\n]*?), \\d+\\)`));
      expect(m).not.toBeNull();
      const callSite = m[0];
      expect(callSite).toContain("async () =>");
      expect(callSite).toContain("await verifyPassword(pw, h)");
      // The HOF call ITSELF is NOT awaited — a timer id, not a Promise.
      expect(js).not.toMatch(new RegExp(`await\\s+${hof}\\(`));
      // No doubled await from re-emission.
      expect(js).not.toMatch(/\bawait\s+await\b/);
      // The emitted module is syntactically valid JS.
      nodeCheck(`d-${hof.toLowerCase()}`, js);
    });
  }
});

// ---------------------------------------------------------------------------
// (2) the full KNOWN-DISCARD-HOF set compiles clean
// ---------------------------------------------------------------------------
describe("every KNOWN-DISCARD-HOF accepts an async callback (no over-fire)", () => {
  // These take the callback as arg 0; a numeric delay/deadline arg is optional.
  const withDelay = new Set(["setTimeout", "setInterval"]);
  for (const hof of KNOWN_DISCARD_HOF) {
    test(`${hof} — async callback lowers to async, no ${CODE}`, () => {
      const argTail = withDelay.has(hof) ? ", 0" : "";
      const { js, codes } = compileLib(`set-${hof.toLowerCase()}`, `\${
  import { verifyPassword } from "scrml:auth"
  export function schedule(pw, h) { ${hof}(() => verifyPassword(pw, h)${argTail}) }
}
`);
      expect(codes).not.toContain(CODE);
      expect(js).toContain(`${hof}(async () => await verifyPassword(pw, h)`);
    });
  }
});

// ---------------------------------------------------------------------------
// (3) CLIENT mode — the discard set applies on the browser path too
// ---------------------------------------------------------------------------
describe("CLIENT mode — setTimeout async callback lowers on the browser path", () => {
  test("client fn scheduling an async peer via setTimeout compiles clean", () => {
    const { js, codes } = compileApp("d-client", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function tick(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(m) -> ({ ok: false }) }
    return r.ok
  }
  function schedule(obj) { setTimeout(() => tick(obj), 1000) }
}
<button onclick=schedule(window)>Go</button>
</program>
`, "clientJs");
    expect(codes).not.toContain(CODE);
    // Async callback, inner peer call awaited INSIDE the callback, timer not awaited.
    expect(js).toMatch(/setTimeout\(async \(\) => await _scrml_tick_\d+\(obj\), 1000\)/);
    expect(js).not.toMatch(/await\s+setTimeout\(/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
    nodeCheck("d-client", js);
  });
});

// ---------------------------------------------------------------------------
// (4) NEGATIVE CONTROLS — the backstop still fires where the value IS consumed
// ---------------------------------------------------------------------------
describe("negative controls unchanged (backstop still guards real coercion)", () => {
  test(".filter async predicate STILL lowers to the async combinator (not a discard HOF)", () => {
    const { js, codes } = compileLib("nc-filter", `\${
  import { verifyPassword } from "scrml:auth"
  export function f(pw, hs) { return hs.filter(h => verifyPassword(pw, h)) }
}
`);
    expect(codes).not.toContain(CODE);
    expect(js).toContain("await _scrml_filterAsync(hs, async (h) => await verifyPassword(pw, h)");
    expect(js).toContain("async function _scrml_filterAsync(coll, cb)");
  });

  test("an async call in a PARAMETER DEFAULT still fires (value-consuming, un-awaitable)", () => {
    const { codes } = compileLib("nc-paramdefault", `\${
  import { verifyPassword } from "scrml:auth"
  export function f(pw, h, x = verifyPassword(pw, h)) { return x }
}
`);
    expect(codes).toContain(CODE);
  });

  test("Case 2 — an async thunk to a USER HOF (not in the discard set) still fires", () => {
    const { codes } = compileLib("nc-userhof", `\${
  import { verifyPassword } from "scrml:auth"
  function runGated(cb) { return cb() }
  export function f(pw, h) { return runGated(() => verifyPassword(pw, h)) }
}
`);
    expect(codes).toContain(CODE);
  });

  test("a MEMBER `obj.setTimeout` is NOT a known-discard global — still fires", () => {
    const { codes } = compileLib("nc-member", `\${
  import { verifyPassword } from "scrml:auth"
  export function f(obj, pw, h) { return obj.setTimeout(() => verifyPassword(pw, h), 0) }
}
`);
    expect(codes).toContain(CODE);
  });
});

// ---------------------------------------------------------------------------
// (5) sync callback in a discard HOF — the common case is byte-stable
// ---------------------------------------------------------------------------
describe("sync callback in a discard HOF stays byte-stable (no async wrap)", () => {
  test("setTimeout with a SYNC callback is unchanged (no async, no await)", () => {
    const { js, codes } = compileLib("d-sync", `\${
  export function schedule() { setTimeout(() => log("tick"), 0) }
}
`);
    expect(codes).not.toContain(CODE);
    // No async wrapping introduced for a sync callback.
    expect(js).not.toMatch(/setTimeout\(async /);
    expect(js).not.toMatch(/await\s+setTimeout\(/);
  });
});
