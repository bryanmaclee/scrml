/**
 * g-if-chain-branch-cell-never-wired.test.js
 *
 * THE CODEGEN HALF of the §17.1.1 if-chain descent class — the one that made
 * the TS/SYM half unsafe to ship alone, and the reason both land together.
 *
 * THE DEFECT. A state cell declared inside an `if=`/`else` branch was never
 * INITIALIZED and its reads were never SUBSCRIBED. Two independent walks, both
 * with zero occurrences of `if-chain`:
 *
 *   - `codegen/reactive-deps.ts` — THIRTEEN collectors, each descending
 *     `children` / `body` / `consequent` / `alternate` / `arms` and none of them
 *     `branches[].element` / `elseBranch`. Cost: the reads were not wired to an
 *     effect, so the value never updated.
 *   - `codegen/collect.ts` `collectTopLevelLogicStatements` — descends only
 *     `node.children`. Cost: the `${ <n> = 7 }` was never collected as a
 *     top-level statement, so NO `_scrml_cs_reactive_set` / `_scrml_cs_init_set`
 *     was emitted at all. The cell did not exist at runtime.
 *
 * MEASURED on one source in two wrappers whose only difference is a `<div else>`
 * sibling (`collapseIfChains` collapses only a chain that HAS an else arm, which
 * is why that sibling is the whole variable):
 *
 *   |                    | init_set | reactive_set | reactive_get | effect |
 *   |--------------------|----------|--------------|--------------|--------|
 *   | lone `if=` oracle  |    1     |      1       |      4       |   2    |
 *   | `if=`/`else` BEFORE |    0     |      0       |      2       |   0    |
 *   | `if=`/`else` AFTER  |    1     |      1       |      4       |   2    |
 *
 * Exit 0 and zero diagnostics in every column. A blank render, silently.
 *
 * WHY THIS COULD NOT BE DEFERRED. The false `E-STATE-UNDECLARED` that the TS
 * half removes was the LAST diagnostic standing in front of this. Removing it
 * alone converts a LOUD failure into a SILENT one and widens this defect's
 * reachable set from "read inside the branch" to "read or write anywhere in the
 * file". The accepting half is right — SPEC §6.1.1 + the §6.1.2 Read bullet say
 * so — but it is only right WITH this.
 *
 * ⚠ THE TRAP THIS TEST PINS, because it was walked into and backed out of once
 * before it was closed properly. `collect.ts`'s `collectFunctions` had the SAME
 * blind spot, and closing it is NOT the same edit. `analyze.ts` hands its result
 * to BOTH the client function emitter (`emit-functions.ts`) and the server
 * emitter (`emit-server.ts`) — but the client emitter omits a `server fn` body
 * ONLY because route inference claimed the function as an endpoint, and RI's own
 * walk (`route-inference.ts` `collectFileFunctions`) was blind to this same
 * shape. So collecting branch-declared functions on the codegen side ALONE
 * emitted the `server fn`'s BODY into `client.js` and produced no `server.js`
 * at all. A loud `ReferenceError` traded for a silent server-body leak is a
 * strictly worse trade.
 *
 * BOTH walks are now closed, ROUTING FIRST, and this is the three-way control
 * that decided the landing order (`41 + 1` = the server fn's body):
 *
 *   |                                  | body in client | server.js bytes |
 *   |----------------------------------|----------------|-----------------|
 *   | base (neither walk)              |       0        |        0        |
 *   | codegen half ALONE (the trap)    |       1        |        0        |
 *   | RI half ALONE                    |       0        |        0        |
 *   | BOTH (shipped)                   |       0        |      2308       |
 *   | lone-`if=` oracle                |       0        |      2308       |
 *
 * The leak guard below is what keeps the two halves together. It is written to
 * RED against the codegen-half-alone column — verified by re-applying exactly
 * that hunk and running this file — and it asserts the POSITIVE limb too,
 * because an absence-only guard is also satisfied by the base column, where the
 * function vanished entirely.
 *
 * VALUE-asserting (R26): compiles real .scrml end-to-end and asserts on the
 * EMITTED artifact, because the defect is invisible in the diagnostic stream by
 * construction — every column above is exit 0.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";

const D = "$" + "{";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ifchain-wiring-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source, "utf8");
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    return {
      clientJs: out.clientJs ?? "",
      serverJs: out.serverJs ?? "",
      errors: r.errors ?? [],
      warnings: r.warnings ?? [],
      lints: r.lintDiagnostics ?? [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const count = (hay, needle) => hay.split(needle).length - 1;

// Strip ALL whitespace before asserting on emitted-code SHAPE.
//
// ⚠ WHY: `expect(clientJs).not.toContain("41 + 1")` — this guard's original and
// only biting assertion — is whitespace-SENSITIVE. An emitter that spaced the
// same leaked body as `41+1`, or wrapped it across a line, passed it while
// leaking. A guard that a formatting change can silence is not a guard.
const squash = (s) => s.replace(/\s+/g, "");

// The declaration under test, plus a read INSIDE the branch and one OUTSIDE it.
const DECL_BRANCH = `<div if=@open>${D} <n>: number = 7 }<p>in ${D}@n}</p></div>`;
const ELSE_ARM = `<div else><p>c</p></div>`;
const OUTER_READ = `<p>out ${D}@n}</p>`;

const loneIfSrc = `<open> = true\n${DECL_BRANCH}\n${OUTER_READ}\n`;
const ifElseSrc = `<open> = true\n${DECL_BRANCH}\n${ELSE_ARM}\n${OUTER_READ}\n`;

describe("g-if-chain-branch-cell-never-wired", () => {
  test("a cell declared in an if=/else branch is INITIALIZED", () => {
    const r = compileSource(ifElseSrc);
    expect(r.errors.length).toBe(0);
    expect(count(r.clientJs, '_scrml_cs_reactive_set("n"')).toBe(1);
    expect(count(r.clientJs, '_scrml_cs_init_set("n"')).toBe(1);
  });

  test("its reads are SUBSCRIBED, not one-shot", () => {
    const r = compileSource(ifElseSrc);
    // `_scrml_effect(...)` is the subscription wrapper. Pre-fix the reads were
    // bare `_scrml_render_value` calls with no effect around them, so the cell
    // rendered once (as undefined) and never updated again.
    expect(r.clientJs).toContain("_scrml_effect(");
    expect(count(r.clientJs, '_scrml_cs_reactive_get("n")')).toBeGreaterThan(2);
  });

  test("PARITY: every wiring count matches the lone-if= oracle exactly", () => {
    // The lone `if=` is never collapsed by `collapseIfChains`, so it is the
    // shape whose behaviour was always correct. The ONLY difference between the
    // two sources is the `<div else>` sibling.
    const lone = compileSource(loneIfSrc);
    const chain = compileSource(ifElseSrc);
    for (const marker of [
      '_scrml_cs_reactive_set("n"',
      '_scrml_cs_init_set("n"',
      '_scrml_cs_reactive_get("n")',
    ]) {
      expect(count(chain.clientJs, marker)).toBe(count(lone.clientJs, marker));
    }
  });

  // A `server fn` DECLARED INSIDE a branch, called from that branch's markup.
  const SERVER_FN_SRC = `<open> = true
<div if=@open>${D} server fn zzload() { return 41 + 1 } }<p>v ${D}zzload()}</p></div>
${ELSE_ARM}
`;

  test("LEAK GUARD: a server fn in a branch never ships its body to the client", () => {
    // This is the trap `collectFunctions` set — see the header. If someone
    // re-opens the codegen half without the server-boundary routing walk, THIS
    // is what reds. Verified to red against exactly that hunk.
    const r = compileSource(SERVER_FN_SRC);
    expect(r.errors.length).toBe(0);

    // (a) THE BODY. Whitespace-normalized: the leak shipped
    // `function _scrml_zzload_7() { return 41 + 1; }` verbatim into client.js,
    // and `41+1` must not survive any reformatting of that.
    expect(squash(r.clientJs)).not.toContain("41+1");

    // (b) THE DEFINITION. Every `function …zzload…` the client is allowed to
    // define is the generated FETCH STUB (`_scrml_fetch_zzload_N`) that POSTs to
    // the route. A definition WITHOUT `fetch` in its name is the server body
    // inlined — the leak shape — and stays caught even if the body itself is
    // constant-folded or rewritten past assertion (a).
    const clientZzloadDefs = [...r.clientJs.matchAll(/function\s+([A-Za-z0-9_$]*zzload[A-Za-z0-9_$]*)\s*\(/g)]
      .map((m) => m[1]);
    expect(clientZzloadDefs.every((n) => n.includes("fetch"))).toBe(true);

    // (c) THE HANDLER PRELUDE. Route-handler machinery is server-only material;
    // none of it may appear in a client bundle.
    // (Replaces the ORIGINAL `not.toContain("server fn")` assertion, which was
    // VACUOUS — emitted JS never contains the scrml source keyword regardless of
    // where the body lands, so it could not fail for any input.)
    for (const serverOnlyMarker of ["_scrml_handler_", "_scrml_validate_csrf", "Set-Cookie"]) {
      expect(r.clientJs).not.toContain(serverOnlyMarker);
    }

    // (d) THE POSITIVE LIMB — without it, (a)-(c) are ALSO satisfied by the base
    // column of the header table, where the function vanished from every bundle
    // and the page threw `ReferenceError`. "Absent from the client" only means
    // something once the function is PRESENT on the server.
    expect(r.serverJs.length).toBeGreaterThan(0);
    expect(squash(r.serverJs)).toContain("41+1");
    expect(r.serverJs).toContain("zzload");
  });

  test("ROUTING PARITY: the branch-declared server fn routes exactly like the lone-if= oracle", () => {
    // Same source in the two wrappers whose only difference is the `<div else>`
    // sibling — the discriminator that makes `collapseIfChains` fire.
    const loneSrc = SERVER_FN_SRC.replace(ELSE_ARM + "\n", "");
    // ⛑ ANTI-TAUTOLOGY GUARD. `String.replace` NO-OPS SILENTLY if `ELSE_ARM +
    // "\n"` stops being a literal substring of `SERVER_FN_SRC` — a trailing
    // space, a reflow of the template, an attribute added to ELSE_ARM. Without
    // this line `loneSrc === SERVER_FN_SRC`, the test compiles the SAME source
    // twice, and every assertion below passes trivially with the chain-vs-oracle
    // discriminator gone. A gate that cannot fail is indistinguishable from a
    // gate that never fails.
    expect(loneSrc).not.toBe(SERVER_FN_SRC);
    const lone = compileSource(loneSrc);
    const chain = compileSource(SERVER_FN_SRC);

    expect(lone.errors.length).toBe(0);
    expect(chain.errors.length).toBe(0);

    // The oracle emits a server bundle; so must the chain.
    expect(lone.serverJs.length).toBeGreaterThan(0);
    expect(chain.serverJs.length).toBeGreaterThan(0);
    // NB: byte-length EQUALITY between the two bundles is deliberately NOT
    // asserted. The chain source carries an extra `<div else>` node, which
    // shifts the node-id counter (this file's own Phase-2 note records
    // `_scrml_helper_5` vs `_scrml_helper_8`). Equality holds today only because
    // no node id happens to reach `server.js`; the first change that stamps one
    // into a server artifact would red this test with no defect behind it. The
    // per-marker count loop below carries the real signal.

    // Route identity, handler, and body all match.
    for (const marker of ["_scrml_handler_zzload_1", "/_scrml/__ri_route_zzload_1", "41 + 1"]) {
      expect(chain.serverJs).toContain(marker);
      expect(count(chain.serverJs, marker)).toBe(count(lone.serverJs, marker));
    }

    // And the client side calls it the same way in both: through a fetch stub.
    expect(chain.clientJs).toContain("/_scrml/__ri_route_zzload_1");
    expect(squash(chain.clientJs)).not.toContain("41+1");
    expect(squash(lone.clientJs)).not.toContain("41+1");
  });

  test("a plain function declared in an if=/else branch is DEFINED and called by name", () => {
    // The client-side half of the same class: with `collectFunctions` blind, the
    // chain emitted ZERO definitions and four BARE `helper()` call sites —
    // `ReferenceError` at exit 0 with zero diagnostics. The lone-`if=` oracle
    // emitted one mangled definition and four mangled calls.
    const decl = `<div if=@open>${D} function zzhelper() { return 1 } }<p>a ${D}zzhelper()}</p><p>b ${D}zzhelper()}</p></div>`;
    const chain = compileSource(`<open> = true\n${decl}\n${ELSE_ARM}\n`);
    const lone = compileSource(`<open> = true\n${decl}\n`);

    expect(chain.errors.length).toBe(0);

    const defs = (js) => (js.match(/function\s+_scrml_zzhelper_\d+\s*\(/g) ?? []).length;
    const mangledCalls = (js) => (js.match(/_scrml_zzhelper_\d+\s*\(\s*\)/g) ?? []).length;
    // A call site the emitter never resolved to a definition ships as the raw
    // source name — that is the `ReferenceError`.
    const bareCalls = (js) => (js.match(/(?<![\w$])zzhelper\s*\(/g) ?? []).length;

    expect(defs(chain.clientJs)).toBe(1);
    expect(bareCalls(chain.clientJs)).toBe(0);
    // Definition + 4 calls (2 module-init statements + 2 render-value sites),
    // byte-for-byte the oracle's counts.
    expect(defs(chain.clientJs)).toBe(defs(lone.clientJs));
    expect(mangledCalls(chain.clientJs)).toBe(mangledCalls(lone.clientJs));
    expect(bareCalls(lone.clientJs)).toBe(0);
  });
});
