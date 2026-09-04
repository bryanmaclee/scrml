/**
 * W-DEAD-FUNCTION arrow/callback reachability — g-dead-function-misses-arrow-callback-bodies.
 *
 * Filed: S280 (scrml-site adopter lint triage), MED. PA-reproduced then on `2e7a32e3`.
 * Verified SILENTLY FIXED and RESOLVED S400-peter on HEAD `8f459481` by execution across
 * the class (fixing commit not pinned — an intervening caller-reachability improvement
 * between `2e7a32e3` and HEAD closed it). This file is the committed guard so it cannot
 * silently regress.
 *
 * Symptom (before fix): the caller-reachability walk behind W-DEAD-FUNCTION did not look
 * inside arrow-function / callback bodies for call sites, so a live `fn` called ONLY from
 * inside `.then((r) => …)` / `.map(cb)` / `.sort((a,b) => …)` — the ordinary shape for
 * fetch-driven client code — was reported as having "no callers" (an advisory false
 * positive; the function still survived in the emitted client JS). A same-named export
 * anywhere in the project masked it, which is why it read as random.
 *
 * The guard asserts BOTH directions: the false positives are gone AND genuine dead code
 * still fires (the S299 lesson: an over-widened caller set suppresses TRUE positives).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "wdead-arrow-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Returns the set of function names flagged W-DEAD-FUNCTION for a <page> whose logic
// block is `body`. W-DEAD is a non-fatal warning (result.warnings stream).
function deadNames(name, body) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, `<page>\n\${\n${body}\n}\n<div>\${@out}</div>\n</page>`);
  const result = compileScrml({ inputFiles: [filePath], mode: "app", write: false, log: () => {} });
  const all = [...(result.errors || []), ...(result.warnings || []), ...(result.lintDiagnostics || [])];
  return all
    .filter(e => e.code === "W-DEAD-FUNCTION")
    .map(d => (d.message || "").match(/`(\w+)`/)?.[1])
    .filter(Boolean);
}

describe("W-DEAD-FUNCTION reachability descends into arrow/callback bodies (g-dead-function-misses-arrow-callback-bodies)", () => {
  test("fn called only inside a .then() arrow is NOT dead", () => {
    const dead = deadNames("then", `function parseIt(r){ return r * 2 }
function load(){ return Promise.resolve(3).then((r) => parseIt(r)) }
const <out> = load()`);
    expect(dead).not.toContain("parseIt");
  });

  test("fn passed as a bare callback to .map() is NOT dead", () => {
    const dead = deadNames("map", `function dbl(x){ return x * 2 }
function go(xs){ return xs.map(dbl) }
const <out> = go([1, 2])`);
    expect(dead).not.toContain("dbl");
  });

  test("fn called only inside a nested (3-deep) arrow is NOT dead", () => {
    const dead = deadNames("deep", `function leaf(x){ return x + 1 }
function m(l){ return l.map(a => l.map(b => leaf(a) + leaf(b))) }
const <out> = m([1, 2])`);
    expect(dead).not.toContain("leaf");
  });

  test("fn referenced as a bare VALUE (setTimeout arg) is NOT dead", () => {
    // Case 2 from the aM repro: a bare function reference is a real use.
    const filePath = join(TMP, "value.scrml");
    writeFileSync(filePath, `<page>
\${
  <tick> = 0
  function usedAsValue(){ @tick = @tick + 1 }
  function arm(){ setTimeout(usedAsValue, 10) }
}
<button onclick=arm()>arm</button>
<div>\${@tick}</div>
</page>`);
    const result = compileScrml({ inputFiles: [filePath], mode: "app", write: false, log: () => {} });
    const dead = [...(result.errors || []), ...(result.warnings || []), ...(result.lintDiagnostics || [])]
      .filter(e => e.code === "W-DEAD-FUNCTION")
      .map(d => (d.message || "").match(/`(\w+)`/)?.[1]);
    expect(dead).not.toContain("usedAsValue");
  });

  // ── The other direction: the fix must NOT over-suppress genuine dead code (S299) ──

  test("a genuinely uncalled function STILL fires W-DEAD-FUNCTION", () => {
    const dead = deadNames("genuine", `function reallyDead(x){ return x + 9 }
function live(){ return 1 }
const <out> = live()`);
    expect(dead).toContain("reallyDead");
  });

  test("a function whose name appears ONLY inside a string literal is NOT a caller", () => {
    const dead = deadNames("strname", `function ghost(){ return 1 }
function live(){ return "ghost()" }
const <out> = live()`);
    expect(dead).toContain("ghost");
  });
});
