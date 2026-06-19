/**
 * W-SERVER-IMPORT-UNEMITTED (S208, Fix B) — cross-file server-import invariant.
 *
 * Companion to the g-pure-module-server-emit Fix A (emit-server tree-shaking).
 * Fix A prunes a CLIENT-only-used local-`.scrml` server import; this warning is
 * the cross-file defense-in-depth that catches the residual broken shapes
 * emit-server cannot see (it has no sibling-emission knowledge):
 *   (a) MISSING-FILE  — the server bundle imports `from "./X.server.js"` but
 *       X emits no `.server.js` (no server content) → runtime Cannot-find-module.
 *   (b) MISSING-EXPORT — X DOES emit a `.server.js` but does not export an
 *       imported name (a server-CALLED pure helper route-infers into a handler:
 *       `auth.server.js` emits `__ri_route_rolePath`, not `export const rolePath`)
 *       → runtime missing-export.
 *
 * The warning is non-fatal: it partitions into result.warnings (W- prefix +
 * severity:"warning"), so the build still exits 0 (per the api.js S93 partition).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "w-server-import-unemitted-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function fx(absPath, source) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, source);
  return absPath;
}
const W = "W-SERVER-IMPORT-UNEMITTED";
function compile(dir, entry) {
  const outDir = join(dir, "out");
  return compileScrml({ inputFiles: [entry], outputDir: outDir, write: true, log: () => {} });
}
const hasW = (r) => r.warnings.some((w) => w.code === W);

// ---------------------------------------------------------------------------
// §1. MISSING-EXPORT — a server-USED exported helper route-infers into a handler,
//     so the .server.js emits a route, not the value export → warning.
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §1: server-used helper that route-infers (missing export)", () => {
  test("fires when the imported name is not exported by the emitted .server.js", () => {
    const dir = join(TMP, "s1");
    fx(join(dir, "src/log.scrml"), `\${ export function entryLine(msg) { return "[" + msg + "]" } }\n`);
    const app = fx(join(dir, "src/app.scrml"), `<program db="sqlite::memory:">
\${ import { entryLine } from './log.scrml' }
<out> = ""
function loadIt() {
  const r = ?{ select 1 as n }
  @out = entryLine("x")
}
<button onclick=loadIt()>go</button>
<p>\${@out}</p>
</program>
`);
    const r = compile(dir, app);
    expect(hasW(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2. Client-only import → Fix A prunes it → the warning does NOT false-fire.
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §2: client-only import does not false-fire (Fix A pruned it)", () => {
  test("no warning when the pure import is used client-side only", () => {
    const dir = join(TMP, "s2");
    fx(join(dir, "src/log.scrml"), `\${ export function entryLine(msg) { return "[" + msg + "]" } }\n`);
    const app = fx(join(dir, "src/app.scrml"), `<program db="sqlite::memory:">
\${ import { entryLine } from './log.scrml' }
function loadCount() { return ?{ select 1 as n } }
<button onclick=loadCount()>go</button>
<p>\${entryLine("client")}</p>
</program>
`);
    const r = compile(dir, app);
    expect(hasW(r)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3. MISSING-FILE — a const-only module (no server content) used server-side:
//     no .server.js is emitted for it, but the import survives → warning.
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §3: const-only module used server-side (missing file)", () => {
  test("fires when the imported module emits no .server.js", () => {
    const dir = join(TMP, "s3");
    fx(join(dir, "src/consts.scrml"), `\${ export const TTL = 3600 }\n`);
    const app = fx(join(dir, "src/app.scrml"), `<program db="sqlite::memory:">
\${ import { TTL } from './consts.scrml' }
<n> = 0
function loadIt() {
  const r = ?{ select 1 as n }
  @n = TTL
}
<button onclick=loadIt()>go</button>
<p>\${@n}</p>
</program>
`);
    const r = compile(dir, app);
    expect(hasW(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4. Partition — the warning is non-fatal (result.warnings, NOT result.errors).
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §4: non-fatal partition", () => {
  test("the code lands in result.warnings and never in result.errors", () => {
    const dir = join(TMP, "s4");
    fx(join(dir, "src/log.scrml"), `\${ export function entryLine(msg) { return "[" + msg + "]" } }\n`);
    const app = fx(join(dir, "src/app.scrml"), `<program db="sqlite::memory:">
\${ import { entryLine } from './log.scrml' }
<out> = ""
function loadIt() {
  const r = ?{ select 1 as n }
  @out = entryLine("x")
}
<button onclick=loadIt()>go</button>
<p>\${@out}</p>
</program>
`);
    const r = compile(dir, app);
    expect(r.warnings.some((w) => w.code === W)).toBe(true);
    expect(r.errors.some((e) => e.code === W)).toBe(false);
  });
});
