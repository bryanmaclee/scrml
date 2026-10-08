/**
 * W-SERVER-IMPORT-UNEMITTED (S208, Fix B) — cross-file server-import invariant.
 *
 * Companion to the g-pure-module-server-emit Fix A (emit-server tree-shaking).
 * Fix A prunes a CLIENT-only-used local-`.scrml` server import; this warning is
 * the cross-file defense-in-depth that catches the residual broken shapes
 * emit-server cannot see (it has no sibling-emission knowledge):
 *   (a) MISSING-FILE  — the server bundle imports `from "./X.server.js"` but
 *       X emits no `.server.js` (no server content) → runtime Cannot-find-module.
 *   (b) MISSING-EXPORT — X DOES emit a `.server.js` but did not export an
 *       imported name (a server-CALLED pure helper route-inferred into a handler:
 *       `auth.server.js` emitted `__ri_route_rolePath`, not `export const rolePath`)
 *       → runtime missing-export. **RESOLVED by ss1** (g-route-mis-inference-
 *       server-called-pure-helper): `.server.js` now ALSO emits the module's
 *       exported VALUE bindings (constants + pure fns) as native ESM exports
 *       ADDITIVELY, so a server-USED helper in an EMITTED `.server.js` no longer
 *       dangles. The MISSING-EXPORT branch consequently STOPS firing for that
 *       class (§1 below asserts the post-ss1 no-fire).
 *
 * g-const-only-module-no-server-emit (sPA ss1 item 2) — the SIBLING residual to
 * the above: the MISSING-FILE branch (a). A const-only module that exports
 * runtime VALUE bindings (constants / pure fns) and is server-imported by-name
 * now ALSO emits a minimal VALUE-ONLY `.server.js` (api.js on-import pre-pass +
 * emit-server.generateValueOnlyServerJs), so the dangling import resolves and
 * the MISSING-FILE warning STOPS firing for that class (§3 asserts the no-fire +
 * the emitted value export). The branch STILL fires for a module that is
 * server-imported by-name but has NO server-importable value export — a
 * TYPE-only / markup-component-only module (nothing to emit; the import is
 * genuinely unresolvable) — §4 uses that still-firing shape for the partition.
 *
 * The warning is non-fatal: it partitions into result.warnings (W- prefix +
 * severity:"warning"), so the build still exits 0 (per the api.js S93 partition).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
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
// §1. MISSING-EXPORT (ss1 RESOLVED) — a server-USED exported helper route-infers
//     into a handler, so the .server.js emits a route. ss1 ALSO emits
//     `export function entryLine` (the value binding) ADDITIVELY → the consumer's
//     by-name server import resolves → the warning NO LONGER fires.
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §1: server-used route-inferring helper (ss1 emits its value export)", () => {
  test("does NOT fire — the imported name IS now exported by the emitted .server.js", () => {
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
    // Pre-ss1 this FIRED (the .server.js emitted `__ri_route_entryLine`, not
    // `export function entryLine`). Post-ss1 the value export is emitted, so the
    // by-name import resolves and the warning no longer fires.
    expect(hasW(r)).toBe(false);
    // Belt-and-suspenders: log.server.js IS emitted and DOES export entryLine.
    const logServer = join(dir, "out", "log.server.js");
    expect(existsSync(logServer)).toBe(true);
    expect(readFileSync(logServer, "utf8")).toMatch(/export\s+function\s+entryLine\s*\(/);
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
// §3. MISSING-FILE RESOLVED (g-const-only-module-no-server-emit) — a const-only
//     module that exports a runtime VALUE binding, server-imported by-name, now
//     emits a minimal VALUE-ONLY `.server.js` (on-import pre-pass), so the
//     import resolves → the warning NO LONGER fires.
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §3: const-only value module used server-side (value-only .server.js emitted)", () => {
  test("does NOT fire — the const-only module now emits its value export", () => {
    const dir = join(TMP, "s3");
    fx(join(dir, "src/consts.scrml"), `\${ export const TTL = 3600 }\n`);
    const app = fx(join(dir, "src/app.scrml"), `<program db="sqlite::memory:">
\${ import { TTL } from './consts.scrml' }
<n> = 0
function loadIt() {
  const r = ?{ select 1 as n }
  return TTL
}
function go() {
  @n = loadIt()
}
<button onclick=go()>go</button>
<p>\${@n}</p>
</program>
`);
    const r = compile(dir, app);
    // The server fn returns TTL and the client writes the cell: it used to write
    // `@n` itself — E-RI-002 (§12.2), so the compile FAILED and this test read the
    // files the failed compile still wrote; since SPEC §2.2.1 (S457) it writes none.
    expect(r.errors).toEqual([]);
    // Pre-fix this FIRED (consts.scrml short-circuited to "" → no .server.js).
    // Post-fix the value-only .server.js is emitted, so the by-name server
    // import resolves and the MISSING-FILE warning no longer fires.
    expect(hasW(r)).toBe(false);
    // Belt-and-suspenders: consts.server.js IS emitted and DOES export TTL as a
    // native ESM value binding (not a type, not a route).
    const constsServer = join(dir, "out", "consts.server.js");
    expect(existsSync(constsServer)).toBe(true);
    expect(readFileSync(constsServer, "utf8")).toMatch(/export\s+const\s+TTL\s*=\s*3600\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §4. STILL-FIRING + non-fatal partition — a module that is server-imported
//     by-name but has NO server-importable VALUE export (a markup-component
//     const → no runtime value to export) genuinely dangles, so the MISSING-FILE
//     warning STILL fires; assert it partitions into result.warnings (W- prefix
//     + severity:"warning"), never result.errors.
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §4: no-value-export module still fires + non-fatal partition", () => {
  test("the code lands in result.warnings and never in result.errors", () => {
    const dir = join(TMP, "s4");
    // A markup-component const is resolved at markup-mount time, NOT a runtime
    // JS value — generateValueOnlyServerJs emits nothing for it, so the import
    // is genuinely unresolvable and the MISSING-FILE warning still fires.
    fx(join(dir, "src/comp.scrml"), `\${ export const Card = <div>card</div> }\n`);
    const app = fx(join(dir, "src/app.scrml"), `<program db="sqlite::memory:">
\${ import { Card } from './comp.scrml' }
<n> = 0
function loadIt() {
  const r = ?{ select 1 as n }
  @n = Card
}
<button onclick=loadIt()>go</button>
<p>\${@n}</p>
</program>
`);
    const r = compile(dir, app);
    expect(r.warnings.some((w) => w.code === W)).toBe(true);
    expect(r.errors.some((e) => e.code === W)).toBe(false);
    // The component module emits no .server.js (nothing server-importable).
    expect(existsSync(join(dir, "out", "comp.server.js"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5. SCOPE GUARD — a const-only module that is NOT server-imported by-name does
//     NOT get a dead value-only `.server.js` force-emitted (client-only modules
//     must not churn). The on-import pre-pass only emits for ACTUAL dangling
//     server imports.
// ---------------------------------------------------------------------------
describe("W-SERVER-IMPORT-UNEMITTED §5: client-only const module is NOT force-emitted", () => {
  test("no .server.js for a const module used only client-side", () => {
    const dir = join(TMP, "s5");
    fx(join(dir, "src/consts.scrml"), `\${ export const LABEL = "hi" }\n`);
    const app = fx(join(dir, "src/app.scrml"), `<program db="sqlite::memory:">
\${ import { LABEL } from './consts.scrml' }
<p>\${LABEL}</p>
</program>
`);
    const r = compile(dir, app);
    // No server import → no dangling → no warning AND no dead consts.server.js.
    expect(hasW(r)).toBe(false);
    expect(existsSync(join(dir, "out", "consts.server.js"))).toBe(false);
  });
});
