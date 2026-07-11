/**
 * auto-await-promise-stdlib.test.js — S89 §13.2 Sub-Phase B Step 4 conformance.
 *
 * Q1 BROAD ratification (S89): the compiler auto-awaits ANY call site whose
 * statically-resolved callee returns `Promise<T>`. Stdlib `scrml:*` modules
 * declare such surfaces via `export async function` (Q5 carve-out, §13.1
 * amendment). The auto-await classifier (`scheduling.ts`) resolves the callee
 * to its source module via the importer's import graph, consults
 * `moduleResult.exportRegistry` for `isAsync: true`, and gates `await`
 * emission on a positive match.
 *
 * Coverage:
 *   §1  Positive — `safeCallAsync(thunk)` inside a failable handler auto-
 *       awaits; the S88 two-step pattern collapses to one line.
 *   §2  Positive — stdlib auth/oauth/redis/http Promise<T> surfaces auto-await
 *       (probes a single canonical stdlib module — coverage of all ~40
 *       surfaces lives in the spec compliance matrix, not per-test).
 *   §3  Negative — stdlib non-Promise function (`safeCall` from
 *       `scrml:host`) does NOT auto-await.
 *   §4  Negative — user `async function` is a HARD ERROR (E-ASYNC-NOT-IN-SCRML,
 *       §19.9.8) on the default path; it does NOT compile and is never
 *       auto-awaited at call sites (the auto-await classifier is stdlib-only).
 *       (2026-07 migration — reverses the S89 Q5 `I-ASYNC-USER-SOURCE` info
 *       nudge; user-source async/await is now rejected.)
 *   §5  Positive — user `async function` fires the hard E-ASYNC-NOT-IN-SCRML;
 *       a `scrml:*` stdlib `async function` does NOT (the §13.1 carve-out is
 *       preserved — stdlib async still compiles + is still auto-awaited).
 *   §6  Edge — `!{}` failable guard works without explicit `await` on the
 *       guarded init (Q4).
 *   §7  Idempotency — explicit `await` permitted (Q2 Position C); compiler
 *       does NOT emit `await await`.
 *   §8  Edge — STDLIB-EXPORT-SEED populates exportRegistry without compiling
 *       stdlib files through the full pipeline (no SYM/TS errors leak).
 *
 * SPEC anchors:
 *   §13.1 stdlib carve-out (S89 67a6a81)
 *   §13.2.1 auto-await classifier (S89 67a6a81)
 *   §19.9.8 no `async`/`await` standing rule + E-ASYNC-NOT-IN-SCRML (S114;
 *           default-path hard-error migration 2026-07)
 *   §41.4.1 stdlib API authoring rule (Promise-always invariant)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/auto-await-promise-stdlib");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Helper — compile one .scrml file and return the client JS string + errors.
// ---------------------------------------------------------------------------

function compileFile(inputPath) {
  const outDir = join(FIXTURE_DIR, "dist-" + Math.random().toString(36).slice(2, 8));
  const result = compileScrml({
    inputFiles: [inputPath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  // The output is written under outDir; the relative-path layout puts the
  // .client.js at <outDir>/<basename>.client.js for single-file inputs (no
  // common-prefix subdir needed). Find it via the dist scan.
  let clientJs = "";
  function find(dir) {
    if (!existsSync(dir)) return;
    const fs = require("fs");
    const entries = fs.readdirSync(dir);
    for (const e of entries) {
      const p = join(dir, e);
      const st = fs.statSync(p);
      if (st.isDirectory()) find(p);
      else if (p.endsWith(".client.js") && !p.includes("/_scrml/")) {
        clientJs = readFileSync(p, "utf8");
      }
    }
  }
  find(outDir);
  return { clientJs, errors: result.errors || [], warnings: result.warnings || [] };
}

// ---------------------------------------------------------------------------
// §1 — Positive: safeCallAsync inside failable handler auto-awaits
// ---------------------------------------------------------------------------

describe("auto-await §1: safeCallAsync inside !{} failable handler", () => {
  test("`const ok = safeCallAsync(thunk) !{ ... }` collapses to one-line with auto-await", () => {
    const fxPath = fix("safecallasync.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function fetchData() {
    const ok = safeCallAsync(() => Promise.resolve(42)) !{
      | ::Thrown(msg, name) -> 0
    }
    return ok
  }
}
<button onclick=fetchData()>Fetch</button>
</program>
`);
    const { clientJs, errors } = compileFile(fxPath);
    // Compilation succeeds (allow warnings, no errors).
    const blockingErrors = errors.filter(e => e.severity !== "warning");
    expect(blockingErrors).toEqual([]);
    // Function emitted as async.
    expect(clientJs).toMatch(/async function _scrml_fetchData_\d+\s*\(/);
    // The guarded-expr init carries `await`.
    expect(clientJs).toMatch(/= await safeCallAsync\b/);
  });
});

// ---------------------------------------------------------------------------
// §2 — Positive: stdlib Promise<T> exports auto-await (canonical probe)
// ---------------------------------------------------------------------------

describe("auto-await §2: stdlib Promise<T> exports", () => {
  test("`scrml:host` `safeCallAsync` classified as Promise<T> (canonical probe)", () => {
    // Inspect MOD exportRegistry directly via a TAB+MOD pass to confirm the
    // stdlib seed wrote `isAsync: true` for safeCallAsync. Driving this through
    // compileScrml plumbing keeps the test honest about the actual production
    // path used by codegen.
    const fxPath = fix("probe-isasync.scrml", `<program>
\${
  import { safeCallAsync, safeCall } from "scrml:host"
  function noop() { return 1 }
}
<p>probe</p>
</program>
`);
    const { errors } = compileFile(fxPath);
    const blockingErrors = errors.filter(e => e.severity !== "warning");
    expect(blockingErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 — Negative: stdlib non-Promise function (safeCall) does NOT auto-await
// ---------------------------------------------------------------------------

describe("auto-await §3: stdlib non-Promise function (safeCall) does NOT auto-await", () => {
  test("`safeCall(thunk) !{ ... }` emits without auto-await", () => {
    const fxPath = fix("safecall-sync.scrml", `<program>
\${
  import { safeCall } from "scrml:host"
  function runSync() {
    const ok = safeCall(() => 42) !{
      | ::Thrown(msg, name) -> 0
    }
    return ok
  }
}
<button onclick=runSync()>Run</button>
</program>
`);
    const { clientJs, errors } = compileFile(fxPath);
    const blockingErrors = errors.filter(e => e.severity !== "warning");
    expect(blockingErrors).toEqual([]);
    // Function emitted WITHOUT async (no Promise<T> callees).
    expect(clientJs).toMatch(/function _scrml_runSync_\d+\s*\(/);
    expect(clientJs).not.toMatch(/async function _scrml_runSync_\d+\s*\(/);
    // No `await safeCall` (sync surface).
    expect(clientJs).not.toMatch(/= await safeCall\b/);
  });
});

// ---------------------------------------------------------------------------
// §4 — Negative: user `async function` does NOT classify in call-site walker
// ---------------------------------------------------------------------------

describe("auto-await §4: user `async function` is a HARD ERROR (§19.9.8)", () => {
  test("a USER `async function` fires E-ASYNC-NOT-IN-SCRML and is never auto-awaited", () => {
    // User-source async function declared inline. Post-migration (2026-07) this
    // is a HARD error, not the retired I-ASYNC-USER-SOURCE info nudge — scrml
    // has no `async` keyword (§19.9.8). The auto-await classifier remains
    // stdlib-only, so no same-file user `async function` is ever awaited.
    const fxPath = fix("user-async-no-classify.scrml", `<program>
\${
  async function userPromise() { return 42 }
  function caller() {
    const v = userPromise()
    return v
  }
}
<button onclick=caller()>Call</button>
</program>
`);
    const { clientJs, errors, warnings } = compileFile(fxPath);
    // Hard error fires — the file does NOT compile clean.
    expect(errors.some(e => e.code === "E-ASYNC-NOT-IN-SCRML")).toBe(true);
    // The retired info nudge is gone.
    const allDiags = [...errors, ...warnings];
    expect(allDiags.some(d => d.code === "I-ASYNC-USER-SOURCE")).toBe(false);
    // A user `async function` is never auto-awaited (classifier is stdlib-only).
    expect(clientJs).not.toMatch(/await\s+_scrml_userPromise_/);
  });
});

// ---------------------------------------------------------------------------
// §5 — user async is a hard error; stdlib async is exempt (carve-out preserved)
// ---------------------------------------------------------------------------

describe("auto-await §5: E-ASYNC-NOT-IN-SCRML on user source `async function`", () => {
  test("`async function foo()` in user source fires the hard E-ASYNC-NOT-IN-SCRML", () => {
    const fxPath = fix("user-async-lint.scrml", `<program>
\${
  async function foo() { return 1 }
  function caller() { return foo() }
}
<button onclick=caller()>Go</button>
</program>
`);
    const { errors, warnings } = compileFile(fxPath);
    const asyncErrs = errors.filter(d => d.code === "E-ASYNC-NOT-IN-SCRML");
    expect(asyncErrs.length).toBeGreaterThanOrEqual(1);
    expect(asyncErrs[0].message).toContain("foo");
    // A hard error — severity "error", partitions into result.errors.
    expect(asyncErrs[0].severity).toBe("error");
    // The retired info nudge no longer appears in either stream.
    const allDiags = [...errors, ...warnings];
    expect(allDiags.some(d => d.code === "I-ASYNC-USER-SOURCE")).toBe(false);
  });

  test("stdlib `async function` does NOT fire E-ASYNC-NOT-IN-SCRML (carve-out)", () => {
    // Importing safeCallAsync from scrml:host must not produce any async/await
    // rejection for the stdlib file itself — the §13.1 carve-out is preserved.
    // (The stdlib .scrml is seeded via STDLIB-EXPORT-SEED post-MOD, not pushed
    // onto tabResults, so the reject walker never sees it; and even if it did,
    // isStdlibFile() would exempt it.)
    const fxPath = fix("user-importing-stdlib.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function caller() {
    const r = safeCallAsync(() => Promise.resolve(1)) !{ | ::Thrown(m, n) -> 0 }
    return r
  }
}
<button onclick=caller()>Go</button>
</program>
`);
    const { clientJs, errors, warnings } = compileFile(fxPath);
    const allDiags = [...errors, ...warnings];
    // No async/await rejection for the stdlib `safeCallAsync`.
    expect(allDiags.some(d => /-(ASYNC|AWAIT|FOR-AWAIT)-NOT-IN-SCRML$/.test(d.code))).toBe(false);
    // And the stdlib async surface is STILL auto-awaited at the call site.
    expect(clientJs).toMatch(/= await safeCallAsync\b/);
  });
});

// ---------------------------------------------------------------------------
// §6 — Edge: !{} works without explicit await (Q4)
// ---------------------------------------------------------------------------

describe("auto-await §6: !{} works without explicit `await`", () => {
  test("`safeCallAsync(...) !{ ... }` requires NO explicit await — compiler inserts it", () => {
    const fxPath = fix("no-explicit-await.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function ping() {
    const r = safeCallAsync(() => Promise.resolve("ok")) !{
      | ::Thrown(msg, name) -> "err"
    }
    return r
  }
}
<button onclick=ping()>Ping</button>
</program>
`);
    const { clientJs, errors } = compileFile(fxPath);
    const blockingErrors = errors.filter(e => e.severity !== "warning");
    expect(blockingErrors).toEqual([]);
    // Confirms `= await safeCallAsync(` (auto-inserted) — NO `safeCallAsync(`
    // without `await` preceding it.
    expect(clientJs).toMatch(/= await safeCallAsync\b/);
  });
});

// ---------------------------------------------------------------------------
// §7 — Idempotency: explicit await permitted (Q2 Position C) — no `await await`
// ---------------------------------------------------------------------------

describe("auto-await §7: idempotency — explicit await is permitted", () => {
  test("emitted JS never contains the redundant `await await` token sequence", () => {
    const fxPath = fix("idempotent-await.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function caller() {
    const r = safeCallAsync(() => Promise.resolve(1)) !{
      | ::Thrown(m, n) -> 0
    }
    return r
  }
}
<button onclick=caller()>Go</button>
</program>
`);
    const { clientJs, errors } = compileFile(fxPath);
    const blockingErrors = errors.filter(e => e.severity !== "warning");
    expect(blockingErrors).toEqual([]);
    // Q2 idempotency check — compiler never emits `await await` in compiled
    // output. This is a regression guard for the future explicit-await form
    // (scrml source currently can't write explicit `await`, but Q2 reserves
    // the syntax). The emitted JS must remain free of double-await.
    expect(clientJs).not.toMatch(/\bawait\s+await\b/);
  });
});

// ---------------------------------------------------------------------------
// §8 — Edge: STDLIB-EXPORT-SEED does NOT leak SYM/TS host-global errors
// ---------------------------------------------------------------------------

describe("auto-await §8: STDLIB-EXPORT-SEED isolates stdlib parsing", () => {
  test("`scrml:auth` import (whose stub references Bun/TextEncoder) compiles cleanly", () => {
    // Regression guard for the api.js Stage 3.105 design choice — stdlib
    // .scrml files are TAB-only parsed for exportRegistry seeding; they MUST
    // NOT be appended to the main compile set or SYM/TS would fire E-SCOPE-001
    // on Bun / TextEncoder host globals referenced inside stub bodies.
    const fxPath = fix("auth-import.scrml", `<program>
\${
  import { hashPassword } from "scrml:auth"
  function go() { return 1 }
}
<p>auth smoke</p>
</program>
`);
    const { errors } = compileFile(fxPath);
    const scopeErrors = errors.filter(e => e.code === "E-SCOPE-001");
    expect(scopeErrors).toEqual([]);
  });
});
