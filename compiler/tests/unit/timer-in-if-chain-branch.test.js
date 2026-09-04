/**
 * <timer>/<poll> lifecycle wiring inside an if-chain branch — g-timer-in-if-chain-branch-never-starts.
 *
 * Filed S393-bryan (MED, RELAYED, untraced). Traced + fixed S400-peter.
 *
 * Symptom (before fix): a `<timer>` declared inside an `if=`/`else` CHAIN branch
 * was never started — `_scrml_timer_start` count 0 on the chain shape vs 1 on the
 * lone-`if=` oracle. Root: `classifyMarkupNodes` (emit-reactive-wiring.ts, the
 * single-pass lifecycle/reactive-wiring walk) recursed `node.children` but an
 * `if-chain` node keeps its branch bodies under `branches[].element` +
 * `elseBranch` (§17.1.1 collapse), so the timer inside a branch was never
 * discovered. The same if-chain-descent blind-spot class as
 * g-if-chain-descent-missing-in-residual-walks — closed the same way, by routing
 * the walk through the shared `ifChainChildNodes` enumerator.
 *
 * Deterministic: counts `_scrml_timer_start` in the emitted client JS against the
 * lone-`if=` parity oracle (adding a `<div else>` sibling is the one-variable
 * discriminator that collapses the chain).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "timer-if-chain-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Count `_scrml_timer_start` occurrences in the emitted client JS for `markup`.
function timerStarts(name, markup) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, `<page>
\${
    <t> = 0
    <o> = true
}
${markup}
<p>\${@t}</p>
</page>`);
  const outDir = join(dir, "dist");
  const result = compileScrml({ inputFiles: [fp], write: true, outputDir: outDir, mode: "app", log: () => {} });
  expect((result.errors || []).map(e => e.code)).toEqual([]);
  let js = "";
  for (const f of readdirSync(outDir).filter(x => x.endsWith(".client.js"))) js += readFileSync(join(outDir, f), "utf8");
  return (js.match(/_scrml_timer_start/g) || []).length;
}

const TIMER = `<timer interval=1000>\${ @t = @t + 1 }</timer>`;

describe("<timer> inside an if-chain branch starts (g-timer-in-if-chain-branch-never-starts)", () => {
  test("lone if= (the parity oracle) starts the timer", () => {
    expect(timerStarts("lone", `<div><section if=@o>${TIMER}</section></div>`)).toBe(1);
  });

  test("if=/else CHAIN branch starts the timer (was 0, now at parity with the oracle)", () => {
    expect(timerStarts("chain", `<div><section if=@o>${TIMER}</section><section else><p>x</p></section></div>`)).toBe(1);
  });

  test("a plain top-level timer is unaffected (the ifChainChildNodes no-op path)", () => {
    expect(timerStarts("plain", `<div>${TIMER}</div>`)).toBe(1);
  });
});
