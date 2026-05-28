/**
 * bug-56-cps-scheduler-tdz-and-non-decl.test.js — regression test for Bug 56:
 * two distinct CPS scheduler bugs that produced runtime-broken emit despite
 * `node --check` passing.
 *
 * Filed S139 by PA during the dashboard restructure investigation; root-cause
 * found in `compiler/src/codegen/scheduling.ts:scheduleStatements`.
 *
 * Bug 56-A (TDZ on body-DG reads not respected):
 *   The scheduler computed inter-statement dependency sets using ONLY the
 *   module-level `awaits` edges from `depGraph`. The module DG does NOT see
 *   local-scope reads (e.g. `const x = serverFn(); @y = x.field;` — the second
 *   statement reads `x` declared in the first). Without the body-DG fold-in,
 *   both statements got grouped into a single Promise.all batch, where stmt 2's
 *   expression `x.field` was evaluated BEFORE the await destructure bound
 *   `x` — a temporal dead zone violation (ReferenceError at runtime).
 *
 * Bug 56-B (non-decl statements shoved into Promise.all entries):
 *   The scheduler's else-branch pushed the WHOLE emit string of non-decl
 *   statements (e.g. `_scrml_reactive_set("a", asyncFn())`) into a Promise.all
 *   entry. That call expression evaluates synchronously when the array literal
 *   is built — `asyncFn()` returns a Promise, `_scrml_reactive_set` gets the
 *   Promise (not the resolved value), and the reactive cell holds a Promise
 *   object instead of the awaited result.
 *
 * Both bugs ONLY surfaced in `node --check`-clean emit — the JS parses fine.
 * The bugs were only detectable by inspecting the emitted call shape vs the
 * intended semantics. The dashboard's `refresh()` was the adopter-visible
 * reproducer.
 *
 * Fix: scheduling.ts now (1) folds in body-DG edges (reads/writes/awaits/
 * invalidates) per SPEC §19.9.9.1 so local-scope deps force batch boundaries,
 * and (2) restricts multi-stmt Promise.all groups to let-decl / const-decl
 * shapes only (non-decl statements always emit sequentially).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/bug-56");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileSource(name, src) {
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + Math.random().toString(36).slice(2, 8));
  compileScrml({
    inputFiles: [inputPath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  let clientJs = "";
  function findClient(dir) {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) findClient(p);
      else if (ent.name.endsWith(".client.js")) clientJs = readFileSync(p, "utf-8");
    }
  }
  findClient(outDir);
  return clientJs;
}

// ---------------------------------------------------------------------------
// §1: Bug 56-A — body-DG reads edge forces batch boundary (no TDZ)
// ---------------------------------------------------------------------------

describe("Bug 56-A §1: local-scope reads dep forces sequential await (no Promise.all TDZ)", () => {
  test("const x = serverFn(); @cell = x.field — emits sequential await, not Promise.all TDZ", () => {
    const src = `<program>

import { readFileSync, existsSync } from 'scrml:fs'

<head> = ""

function readHead() {
    if (!existsSync(".git/HEAD")) return ""
    return readFileSync(".git/HEAD").trim()
}

function refresh() {
    const sha = readHead()
    @head = sha.slice(0, 8)
}

<button onclick=refresh()>refresh</button>

</program>
`;
    const code = compileSource("bug-56-a-tdz.scrml", src);
    // Sequential: const sha = await fetch(); _scrml_reactive_set("head", sha.slice(0,8));
    expect(code).toMatch(/const sha = await _scrml_fetch_readHead/);
    expect(code).toMatch(/_scrml_reactive_set\("head", sha\.slice\(0, 8\)\)/);
    // Negative: the broken Promise.all shape with `sha` read inside an entry
    // BEFORE the destructure binds it must NOT appear.
    expect(code).not.toMatch(/Promise\.all\(\[[^\]]*sha\.slice/);
  });

  test("multi-call chain: server-call result used by next const-decl", () => {
    const src = `<program>

import { readFileSync, existsSync } from 'scrml:fs'

<a> = ""
<b> = 0

function readVal() {
    if (existsSync(".git/HEAD")) return readFileSync(".git/HEAD").trim()
    return ""
}

function update() {
    const raw = readVal()
    const len = raw.length
    @a = raw
    @b = len
}

<button onclick=update()>go</button>

</program>
`;
    const code = compileSource("bug-56-a-chain.scrml", src);
    // raw must be a sequential await (server call). len reads raw → separate batch.
    expect(code).toMatch(/const raw = await _scrml_fetch_readVal/);
    expect(code).toMatch(/const len = raw\.length/);
    // No Promise.all shoving raw and len together.
    expect(code).not.toMatch(/Promise\.all\(\[[^\]]*raw\.length/);
  });
});

// ---------------------------------------------------------------------------
// §2: Bug 56-B — non-decl statements never join multi-stmt Promise.all groups
// ---------------------------------------------------------------------------

describe("Bug 56-B §2: non-decl statements emit sequentially, not inside Promise.all entries", () => {
  test("@cell = asyncFn() emits as standalone _scrml_reactive_set, not as Promise.all entry", () => {
    const src = `<program>

import { existsSync, readFileSync } from 'scrml:fs'

<a> = ""
<b> = ""

function readA() {
    if (existsSync(".git/HEAD")) return readFileSync(".git/HEAD").trim()
    return ""
}

function readB() {
    return "static"
}

function go() {
    @a = readA()
    @b = readB()
}

<button onclick=go()>go</button>

</program>
`;
    const code = compileSource("bug-56-b-non-decl.scrml", src);
    // Two reactive writes must NOT be coalesced into a Promise.all that shoves
    // _scrml_reactive_set call expressions as array entries (Bug 56-B).
    expect(code).not.toMatch(/Promise\.all\(\[[^\]]*_scrml_reactive_set\("a"[^\]]*_scrml_reactive_set\("b"/);
  });

  test("const-decl + reactive-write: only the const-decls get Promise.all'd; reactive writes follow sequentially", () => {
    const src = `<program>

import { readFileSync, existsSync } from 'scrml:fs'

<head> = ""
<tail> = ""

function rA() { if (existsSync(".git/HEAD")) return readFileSync(".git/HEAD").trim(); return "" }
function rB() { if (existsSync(".git/HEAD")) return readFileSync(".git/HEAD").trim(); return "" }

function refresh() {
    const a = rA()
    const b = rB()
    @head = a
    @tail = b
}

<button onclick=refresh()>r</button>

</program>
`;
    const code = compileSource("bug-56-b-mixed.scrml", src);
    // a and b are independent const-decls with async RHS — these MAY group.
    expect(code).toMatch(/const \[a, b\] = await Promise\.all\(\[/);
    // The reactive writes (@head = a, @tail = b) must come AFTER the Promise.all.
    expect(code).toMatch(/_scrml_reactive_set\("head", a\)/);
    expect(code).toMatch(/_scrml_reactive_set\("tail", b\)/);
  });
});

// ---------------------------------------------------------------------------
// §3: Composition — Bug 56-A and 56-B together (the dashboard refresh() shape)
// ---------------------------------------------------------------------------

describe("Bug 56 §3: composition — dashboard-shape refresh() emits correctly end-to-end", () => {
  test("the canonical dashboard refresh() pattern compiles to race-free, TDZ-free emit", () => {
    const src = `<program>

import { readFileSync, existsSync } from 'scrml:fs'

<head> = ""
<rows> = []
<loaded> = false

function readHead() {
    if (!existsSync(".git/HEAD")) return ""
    return readFileSync(".git/HEAD").trim()
}

function loadRows() {
    return [{ name: "01" }, { name: "02" }]
}

function refresh() {
    const currentSha = readHead()
    const items      = loadRows()
    @head    = currentSha == "" ? "" : currentSha.slice(0, 8)
    @rows    = items
    @loaded  = true
}

<button onclick=refresh()>refresh</button>

</program>
`;
    const code = compileSource("bug-56-composition.scrml", src);
    // Two independent const-decls → Promise.all batch.
    expect(code).toMatch(/const \[currentSha, items\] = await Promise\.all\(\[/);
    // Three reactive writes follow sequentially after destructure.
    expect(code).toMatch(/_scrml_reactive_set\("head"/);
    expect(code).toMatch(/_scrml_reactive_set\("rows", items\)/);
    expect(code).toMatch(/_scrml_reactive_set\("loaded", true\)/);
    // Negative: no broken shapes. Use `[^\]]` to scope to inside the
    // Promise.all([...]) brackets (`]` can't appear in the entry list — the
    // entries are call expressions / identifiers, never bracket-balanced).
    // (a) reactive_set call inside Promise.all entries
    expect(code).not.toMatch(/Promise\.all\(\[[^\]]*_scrml_reactive_set\(/);
    // (b) currentSha read before destructure binds it
    expect(code).not.toMatch(/Promise\.all\(\[[^\]]*currentSha\.slice/);
  });
});
