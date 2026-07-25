/**
 * S27 gauntlet — §51.14 replay primitive (§2b G slice 2).
 *
 * replay(@target, @log[, index]) sets a machine-bound reactive's state
 * to any point in its audit log, bypassing the transition guard
 * (§51.5), the audit push (§51.11), and arming of temporal timers
 * (§51.12). Used for replay-from-bug-report, time-travel debugging,
 * and any state reconstruction from append-logs.
 *
 * Coverage:
 *   - Codegen: replay(@x, @y[, n]) → _scrml_replay("x", _scrml_reactive_get("y"), n?)
 *   - Runtime full replay (omitted index) lands at log[last].to
 *   - Runtime partial replay with integer index
 *   - Runtime index=0 rewinds to log[0].from
 *   - Runtime index out-of-bounds throws E-REPLAY-001-RT
 *   - Replay bypasses the transition guard (can jump illegal moves)
 *   - Replay does NOT double-log (audit array length unchanged)
 *   - Replay clears any pending temporal timer
 *   - Post-replay user transitions resume normally
 *   - replay is a reserved identifier (no E-SCOPE-001)
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";
import { extractUserFns } from "../../helpers/extract-user-fns.js";
import { foldChunkNamespacing, unwrapChunkScope } from "../../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-s27-replay");
let tmpCounter = 0;

function compile(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    // RAW client JS — text-assert tests fold at their own read site; runtime
    // tests feed it to buildEnv() which unwraps the chunk scope for execution.
    const clientJs = existsSync(resolve(outDir, "app.client.js"))
      ? readFileSync(resolve(outDir, "app.client.js"), "utf8")
      : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buildEnv(clientJsRaw) {
  // BUG-6/N3: strip the per-chunk IIFE + `_scrml_cs_` cell scope so the emitted
  // user functions are top-level (extractable + callable) and the accessors key
  // BARE — this env reads `_scrml_state` by author name. A no-op on an unscoped
  // chunk. Accepts already-folded input too (unwrap is idempotent over folds).
  const clientJs = unwrapChunkScope(clientJsRaw);
  const userFns = extractUserFns(clientJs);
  const userFnBindings = userFns.map(n => `${JSON.stringify(n)}: ${n}`).join(",\n    ");
  const fnBody = `
    var requestAnimationFrame = function() {};
    var cancelAnimationFrame = function() {};
    ${SCRML_RUNTIME}
    ${clientJs}
    return {
      state: _scrml_state,
      userFns: { ${userFnBindings} },
      userFnNames: ${JSON.stringify(userFns)},
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(fnBody)();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

describe("S27 §51.14 — codegen: replay call site", () => {
  test("two-arg replay(@target, @log) emits _scrml_replay without index", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function go() { @order = S.B }
  function full() { replay(@order, @log) }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_replay("order", _scrml_reactive_get("log"))');
    // No stray `replay(` calls remain in user function bodies.
    expect(clientJs).not.toMatch(/\breplay\s*\(@/);
  });

  test("three-arg replay(@target, @log, n) emits _scrml_replay with index", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function seek(n: integer) { replay(@order, @log, n) }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_replay("order", _scrml_reactive_get("log"), n)');
  });

  test("index can be a complex expression", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function seekHalf() { replay(@order, @log, @log.length / 2) }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // The index is its own expression — @log.length / 2 rewrites to the
    // reactive-get call with member access preserved.
    expect(clientJs).toContain('_scrml_replay("order", _scrml_reactive_get("log"), _scrml_reactive_get("log").length / 2)');
  });

  test("`replay` as an identifier does not fire E-SCOPE-001", () => {
    const src = `<program>
\${
  type S:enum = { A }
  @order: M = S.A
  @log = []
  function go() { replay(@order, @log) }
}
< machine name=M for=S>
  .A => .A
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const scope001 = (errors ?? []).filter(e => e.code === "E-SCOPE-001");
    expect(scope001).toEqual([]);
  });
});

describe("S27 §51.14 — runtime behavior", () => {
  test("full replay (no index) lands at last entry's to", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @log = []
  function step1() { @order = S.B }
  function step2() { @order = S.C }
  function full() { replay(@order, @log) }
}
< machine name=M for=S>
  .A => .B
  .B => .C
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("step1"))]();
    env.userFns[env.userFnNames.find(n => n.includes("step2"))]();
    expect(env.state.order).toBe("C");
    expect(env.state.log).toHaveLength(2);
    // Rewind to A manually, then full replay should land back at C.
    env.state.order = "A";
    env.userFns[env.userFnNames.find(n => n.includes("full"))]();
    expect(env.state.order).toBe("C");
    // Audit not double-pushed.
    expect(env.state.log).toHaveLength(2);
  });

  test("partial replay lands at log[index - 1].to", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C, D }
  @order: M = S.A
  @log = []
  function advance() { @order = S.B; @order = S.C; @order = S.D }
  function seek(n: integer) { replay(@order, @log, n) }
}
< machine name=M for=S>
  .A => .B
  .B => .C
  .C => .D
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("advance"))]();
    expect(env.state.order).toBe("D");
    expect(env.state.log).toHaveLength(3);
    // Replay to state after 1st transition → B
    env.userFns[env.userFnNames.find(n => n.includes("seek"))](1);
    expect(env.state.order).toBe("B");
    // After 2nd → C
    env.userFns[env.userFnNames.find(n => n.includes("seek"))](2);
    expect(env.state.order).toBe("C");
    // After 3rd → D
    env.userFns[env.userFnNames.find(n => n.includes("seek"))](3);
    expect(env.state.order).toBe("D");
    // Audit not mutated by any seek.
    expect(env.state.log).toHaveLength(3);
  });

  test("index=0 rewinds to log[0].from (pre-first-transition)", () => {
    const src = `<program>
\${
  type S:enum = { Draft, Published }
  @post: M = S.Draft
  @log = []
  function publish() { @post = S.Published }
  function rewind() { replay(@post, @log, 0) }
}
< machine name=M for=S>
  .Draft => .Published
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("publish"))]();
    expect(env.state.post).toBe("Published");
    env.userFns[env.userFnNames.find(n => n.includes("rewind"))]();
    expect(env.state.post).toBe("Draft");
    expect(env.state.log).toHaveLength(1);
  });

  test("index=0 on empty log is a no-op", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function rewind() { replay(@order, @log, 0) }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    // No transitions have happened; log is empty.
    expect(env.state.log).toHaveLength(0);
    expect(env.state.order).toBe("A");
    env.userFns[env.userFnNames.find(n => n.includes("rewind"))]();
    expect(env.state.order).toBe("A");
    expect(env.state.log).toHaveLength(0);
  });

  test("out-of-bounds index throws E-REPLAY-001-RT", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function step() { @order = S.B }
  function badSeek(n: integer) { replay(@order, @log, n) }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("step"))]();
    // Log has 1 entry; valid indices are 0 and 1. Anything else throws.
    expect(() => env.userFns[env.userFnNames.find(n => n.includes("badSeek"))](-1)).toThrow(/E-REPLAY-001-RT/);
    expect(() => env.userFns[env.userFnNames.find(n => n.includes("badSeek"))](2)).toThrow(/E-REPLAY-001-RT/);
    expect(() => env.userFns[env.userFnNames.find(n => n.includes("badSeek"))](99)).toThrow(/E-REPLAY-001-RT/);
  });

  test("replay bypasses the transition guard (can jump normally-illegal moves)", () => {
    const src = `<program>
\${
  type S:enum = { Pending, Processing, Shipped, Delivered }
  @order: M = S.Pending
  @log = []
  function advance() {
    @order = S.Processing
    @order = S.Shipped
    @order = S.Delivered
  }
  function rewind() { replay(@order, @log, 0) }
}
< machine name=M for=S>
  .Pending => .Processing
  .Processing => .Shipped
  .Shipped => .Delivered
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("advance"))]();
    expect(env.state.order).toBe("Delivered");
    // Delivered → Pending violates the table (there's no such rule), but
    // replay must bypass the guard. If it didn't, this would throw
    // E-ENGINE-001-RT.
    env.userFns[env.userFnNames.find(n => n.includes("rewind"))]();
    expect(env.state.order).toBe("Pending");
  });

  test("post-replay user transitions resume normally from replayed state", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @log = []
  function step1() { @order = S.B }
  function step2() { @order = S.C }
  function rewind() { replay(@order, @log, 0) }
}
< machine name=M for=S>
  .A => .B
  .B => .C
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("step1"))]();
    env.userFns[env.userFnNames.find(n => n.includes("step2"))]();
    expect(env.state.order).toBe("C");
    expect(env.state.log).toHaveLength(2);
    // Rewind to Pending.
    env.userFns[env.userFnNames.find(n => n.includes("rewind"))]();
    expect(env.state.order).toBe("A");
    // A user-driven step1 from replayed state must work and audit normally.
    env.userFns[env.userFnNames.find(n => n.includes("step1"))]();
    expect(env.state.order).toBe("B");
    expect(env.state.log).toHaveLength(3);
    expect(env.state.log[2].rule).toBe("A:B");
  });
});

describe("S27 §51.14 — replay clears pending temporal timers", () => {
  test("replay cancels an armed timer; machine doesn't auto-advance from replayed state", async () => {
    const src = `<program>
\${
  type S:enum = { Idle, Done }
  @state: M = S.Idle
  @log = []
  function rewindToStart() { replay(@state, @log, 0) }
}
< machine name=M for=S>
  .Idle after 50ms => .Done
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    // Initial state armed the 50ms timer. Wait for it to fire.
    await sleep(70);
    expect(env.state.state).toBe("Done");
    expect(env.state.log).toHaveLength(1);
    // Replay back to Idle. This would normally re-arm the Idle timer via
    // a transition guard, but replay bypasses the guard. So no timer
    // should be armed. Wait longer than the original timer's interval
    // and confirm state stays at Idle.
    env.userFns[env.userFnNames.find(n => n.includes("rewindToStart"))]();
    expect(env.state.state).toBe("Idle");
    await sleep(80);
    expect(env.state.state).toBe("Idle");
    // Log unchanged by the replay.
    expect(env.state.log).toHaveLength(1);
  });
});
