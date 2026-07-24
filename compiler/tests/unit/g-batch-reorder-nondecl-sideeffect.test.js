/**
 * g-batch-reorder-nondecl-sideeffect.test.js — a client-tier side effect written
 * BETWEEN two independent server calls must NOT be reordered after both when the
 * scheduler batches them.
 *
 * Source `const a = f(); @log = "midway"; const b = g();` was emitting
 *   const [a, b] = await Promise.all([f(), g()]);
 *   _scrml_reactive_set("log", "midway");   // ← hoisted BELOW the batch
 * so a "saving…"-style indicator the developer placed between the two calls was
 * painted only after BOTH round-trips completed (or, when immediately
 * overwritten, never). The scheduler skipped (`continue`) the non-decl write and
 * kept scanning forward, pulling the later server-fetch decl into a batch seeded
 * ABOVE the write.
 *
 * SPEC §19.9.9.2 step 2: "A client-tier statement appearing between two server
 * statements forces a batch boundary." Grounded in soundness predicate S3
 * (§19.9.9.1) — the body-DG is observation, not transformation; observable
 * source order is preserved. The CPS multi-batch planner already enforces this
 * (§19.9.9.5 worked example: an intervening `@reservationShown` write closes
 * batch 0); this brings the client-side scheduler into line.
 *
 * Fix (`compiler/src/codegen/scheduling.ts:scheduleStatements`): a non-decl
 * statement is a HARD batch boundary (`break`), not a skip. Only the
 * cross-call parallelization is declined — the write stays in source order.
 * Adjacent server calls with NO intervening statement still batch. The S212
 * pure-DECL skip is unaffected (a decl is not a non-decl).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as acornParse } from "acorn";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/g-batch-reorder");

beforeAll(() => { if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compileSource(name, src) {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + name.replace(/\W/g, ""));
  compileScrml({ inputFiles: [inputPath], outputDir: outDir, write: true, log: () => {} });
  let clientJs = "";
  (function find(dir) {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) find(p);
      else if (ent.name.endsWith(".client.js")) clientJs = readFileSync(p, "utf-8");
    }
  })(outDir);
  return clientJs;
}

function fnBody(code, fnName) {
  const m = new RegExp(`async function _scrml_${fnName}_\\d+\\(`).exec(code);
  if (!m) return "";
  const start = code.indexOf("{", m.index);
  let depth = 0;
  for (let k = start; k < code.length; k++) {
    if (code[k] === "{") depth++;
    else if (code[k] === "}") { depth--; if (depth === 0) return code.slice(start, k + 1); }
  }
  return code.slice(start);
}

const SRC = `<program>
\${
  server function bump(tag) { return tag }

  // BUG shape: a reactive write BETWEEN two independent server calls.
  function caseInterleaved() {
    const a = bump("E1")
    @log = "midway"
    const b = bump("E2")
    @log = "done: " + a + b
  }

  // Control: two ADJACENT server calls (no intervening statement) — still batch.
  function caseAdjacent() {
    const a = bump("D1")
    const b = bump("D2")
    @log = "D: " + a + b
  }

  @log = ""
}
<div>\${@log}</div>
<button onclick=\${caseInterleaved()}>i</button>
<button onclick=\${caseAdjacent()}>a</button>
</program>
`;

describe("g-batch-reorder: a client side-effect between two server calls keeps source order", () => {
  const code = compileSource("reorder.scrml", SRC);

  test("emit is valid JS", () => {
    expect(() => acornParse(code, { ecmaVersion: 2024, sourceType: "module", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })).not.toThrow();
  });

  test("interleaved: the two server calls are NOT coalesced across the `@log` write", () => {
    const fn = fnBody(code, "caseInterleaved");
    expect(fn).toBeTruthy();
    // The bug: `const [a, b] = await Promise.all([...])` batching E1+E2.
    expect(fn).not.toMatch(/const \[a, b\] = await Promise\.all/);
    // Source order preserved: E1 fetch, then the "midway" write, then E2 fetch.
    const e1 = fn.indexOf('_scrml_fetch_bump_' );
    const midway = fn.indexOf('"midway"');
    const e2 = fn.lastIndexOf('_scrml_fetch_bump_');
    expect(e1).toBeGreaterThan(-1);
    expect(midway).toBeGreaterThan(e1);   // the write comes AFTER the first fetch
    expect(e2).toBeGreaterThan(midway);   // ...and the second fetch AFTER the write
  });

  test("adjacent (no-regression): two server calls with no intervening statement STILL batch", () => {
    const fn = fnBody(code, "caseAdjacent");
    expect(fn).toMatch(/const \[a, b\] = await Promise\.all\(\[/);
    expect(fn).toMatch(/_scrml_fetch_bump_\d+\("D1"\)/);
    expect(fn).toMatch(/_scrml_fetch_bump_\d+\("D2"\)/);
  });
});
