/**
 * GITI-036 — `equality` runtime chunk tree-shake regression (Bug-51 class:
 * compiles exit-0, silent until runtime).
 *
 * A `==` inside a DEFERRED `<match>` arm body lowers to `_scrml_structural_eq(`
 * in `*.client.js`, but the chunk that DEFINES that helper (`equality`) was
 * tree-shaken out — leaving a dangling reference that throws
 * `ReferenceError: _scrml_structural_eq is not defined` on every reactive
 * re-dispatch of that arm.
 *
 * Root cause: the `equality` chunk is gated by the AST-cached `hasEqualityExpr`
 * flag, computed at PRECG by `compute-pgo-flags.ts:detectEqualityExprPresence`
 * (looks for a `binary` `==`/`!=` NODE). But a `<match>` arm body is stored RAW
 * at TAB and only lowered to ExprNodes at CG time (`emit-match.ts` caches the
 * lowered arms on `__scrmlCachedArms`). An `<each>` nested in a markup-valued
 * ternary inside the arm forces that deferred-lowering path, so at PRECG there
 * is no `binary` node → `hasEqualityExpr === false` → chunk dropped. The CG
 * lowering still emits `_scrml_structural_eq(` → dangling reference.
 *
 * Fix (emit-client.ts): a POST-EMIT reference gate scans the emitted client
 * body (ground truth) for `_scrml_structural_eq(` and seeds the `equality`
 * chunk when present — mirroring the server path (`emit-server.ts`
 * `emitted.includes`) and the existing client `log` / `ssr` post-emit gates.
 * Reference-gated, so a `==`-free page still tree-shakes the chunk OUT.
 *
 * Test shape mirrors `value-native-map-e2e-d4.test.js` (same tree-shake bug
 * class — the `map` chunk): compile to disk, read `*.client.js` +
 * `scrml-runtime.*.js`, assert the client-reference / runtime-definition
 * PAIRING that GITI-036 broke.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "giti036-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Reproducer: `==` inside a deferred <match> arm body. The <each> nested in a
// markup-valued ternary forces the __scrmlCachedArms deferred-lowering path so
// the PRECG presence-walker misses the `==` (pre-fix: equality chunk dropped).
const SRC_WITH_EQ = `type Data:struct = { scope: string, items: string[] }
type Phase:enum = {
  Loading
  Loaded(data: Data)
}

<phase> = Phase.Loading

<div class="app">
  <match for=Phase on=@phase>
    <Loading><p>Loading</p></Loading>
    <Loaded(d)>
      \${ d.scope == "empty" && d.items.length == 0 ? <p class="muted">clean</p> : "" }

      \${ d.items.length > 0 ? <div class="list">
          <ul>
            <each in=d.items>
              <li>\${@.}</li>
            </each>
          </ul>
        </div> : "" }
    </Loaded>
  </match>
</div>`;

// Over-inclusion counter-fixture: byte-for-byte the same deferred-arm shape
// (same <match> / <each>-in-ternary structure) but with NO `==` anywhere, so
// the emitted client body references no `_scrml_structural_eq(`. The chunk MUST
// stay tree-shaken out (the seed is reference-gated, not always-on).
const SRC_NO_EQ = `type Data:struct = { scope: string, items: string[] }
type Phase:enum = {
  Loading
  Loaded(data: Data)
}

<phase> = Phase.Loading

<div class="app">
  <match for=Phase on=@phase>
    <Loading><p>Loading</p></Loading>
    <Loaded(d)>
      \${ d.items.length > 0 ? <div class="list">
          <ul>
            <each in=d.items>
              <li>\${@.}</li>
            </each>
          </ul>
        </div> : "" }
    </Loaded>
  </match>
</div>`;

function compile(src, name) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, src);
  const outDir = join(TMP, `${name}-dist`);
  const result = compileScrml({ inputFiles: [filePath], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors || []).filter((e) => e.severity == null || e.severity === "error");
  const clientJs = readFileSync(join(outDir, `${name}.client.js`), "utf8");
  const runtimeFile = readdirSync(outDir).find((f) => f.startsWith("scrml-runtime."));
  const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
  return { errors, clientJs, runtimeJs };
}

describe("GITI-036 — == in a deferred <match> arm body seeds the `equality` chunk", () => {
  let out;
  beforeAll(() => { out = compile(SRC_WITH_EQ, "witheq"); });

  test("compiles with NO codegen errors", () => {
    expect(out.errors).toEqual([]);
  });

  test("emitted client JS is syntactically valid", () => {
    expect(() => new vm.Script(out.clientJs)).not.toThrow();
  });

  test("emitted runtime JS is syntactically valid", () => {
    expect(() => new vm.Script(out.runtimeJs)).not.toThrow();
  });

  test("the `==` lowers to a `_scrml_structural_eq(` call in *.client.js", () => {
    expect(out.clientJs).toContain("_scrml_structural_eq(");
  });

  // The PAIRING that GITI-036 broke: the client REFERENCES the helper, so the
  // runtime bundle MUST DEFINE it. Pre-fix this was 0 defs -> ReferenceError.
  test("the `equality` chunk SURVIVES tree-shaking — runtime DEFINES _scrml_structural_eq", () => {
    expect(out.runtimeJs).toContain("function _scrml_structural_eq");
  });

  test("no dangling reference — every client `_scrml_structural_eq(` resolves against a runtime def", () => {
    const referenced = out.clientJs.includes("_scrml_structural_eq(");
    const defined = out.runtimeJs.includes("function _scrml_structural_eq");
    // Referenced implies defined (the invariant GITI-036 violated).
    expect(!referenced || defined).toBe(true);
  });
});

describe("GITI-036 over-inclusion guard — a `==`-free page still tree-shakes `equality` OUT", () => {
  let out;
  beforeAll(() => { out = compile(SRC_NO_EQ, "noeq"); });

  test("compiles with NO codegen errors", () => {
    expect(out.errors).toEqual([]);
  });

  test("the `==`-free client body references NO _scrml_structural_eq(", () => {
    expect(out.clientJs).not.toContain("_scrml_structural_eq(");
  });

  // The seed is reference-GATED, not always-on: no reference -> chunk dropped.
  test("the runtime bundle does NOT define _scrml_structural_eq (chunk tree-shaken)", () => {
    expect(out.runtimeJs).not.toContain("function _scrml_structural_eq");
  });
});
