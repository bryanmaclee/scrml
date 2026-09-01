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
 * ⚠ THE TRAP THIS TEST ALSO PINS, because it was walked into and backed out of.
 * `collect.ts`'s `collectFunctions` has the SAME blind spot, and closing it is
 * NOT the same edit. It feeds the CLIENT function emitter, and the walk that
 * routes a `server fn` to the server bundle is blind in its own separate way —
 * so collecting branch-declared functions there emits a `server fn`'s BODY into
 * `client.js` and produces no `server.js` at all. MEASURED: with that hunk the
 * body shipped to the client; without it, it did not. A loud `ReferenceError`
 * traded for a silent server-body leak is a strictly worse trade, so
 * `collectFunctions` is deliberately NOT closed here and the leak guard below
 * is what keeps it that way.
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

  test("LEAK GUARD: a server fn in a branch never ships its body to the client", () => {
    // This is the trap `collectFunctions` sets — see the header. If someone
    // closes that walk without first closing the server-boundary routing walk,
    // THIS is what reds.
    const src = `<open> = true
<div if=@open>${D} server fn zzload() { return 41 + 1 } }<p>v ${D}zzload()}</p></div>
${ELSE_ARM}
`;
    const r = compileSource(src);
    expect(r.clientJs).not.toContain("41 + 1");
    expect(r.clientJs).not.toContain("server fn");
  });
});
