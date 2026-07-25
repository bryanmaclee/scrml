/**
 * S27 — §51.11 audit completeness sweep.
 *
 * Covers two correctness gaps flagged alongside §2b G slice 1:
 *
 *   1. Timer-fired transitions now push audit entries (previously the
 *      timer invoked a bare _scrml_reactive_set, bypassing the audit
 *      clause — violating §51.11.6's "every successful transition
 *      SHALL append" rule for temporal rules).
 *   2. Chained temporal rules (A after 1s => B, B after 1s => C)
 *      re-arm automatically from the timer's expiry, producing one
 *      audit entry per hop.
 *   3. Audit entries are Object.freeze'd per §51.11.4 (the spec calls
 *      them frozen objects; codegen now enforces it).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";
import { extractUserFns } from "../../helpers/extract-user-fns.js";
import { unwrapChunkScope } from "../../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-s27-audit-timer");
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
    const clientJs = existsSync(resolve(outDir, "app.client.js"))
      ? readFileSync(resolve(outDir, "app.client.js"), "utf8")
      : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Build a sandbox that exposes _scrml_state AND the timer primitives so
 * timer-driven tests can await the pending queue to drain.
 */
function buildEnv(clientJs) {
  const userFns = extractUserFns(clientJs);
  // Closure-capture user functions into an object we can invoke from
  // outside. `new Function("return <name>()")` would create a new
  // lexical scope and not see the declarations made here.
  const userFnBindings = userFns.map(n => `${JSON.stringify(n)}: ${n}`).join(",\n    ");
  const fnBody = `
    var requestAnimationFrame = function() {};
    var cancelAnimationFrame = function() {};
    ${SCRML_RUNTIME}
    ${unwrapChunkScope(clientJs)}
    return {
      state: _scrml_state,
      userFns: {
        ${userFnBindings}
      },
      userFnNames: ${JSON.stringify(userFns)},
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(fnBody)();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

describe("S27 §51.11 — timer-fired transitions audit", () => {
  test("initial-state temporal rule fires a timer → audit entry is pushed", async () => {
    const src = `<program>
\${
  type S:enum = { Idle, Done }
  @state: M = S.Idle
  @log = []
}
< machine name=M for=S>
  .Idle after 10ms => .Done
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    // Sanity: initial state armed the timer.
    expect(env.state.state).toBe("Idle");
    // Let the 10ms timer fire; give it a generous margin.
    await sleep(40);
    expect(env.state.state).toBe("Done");
    // Timer-fired entry must have been pushed.
    expect(env.state.log).toHaveLength(1);
    expect(env.state.log[0].from).toBe("Idle");
    expect(env.state.log[0].to).toBe("Done");
    expect(env.state.log[0].rule).toBe("Idle:Done");
    expect(env.state.log[0].label).toBeNull();
    expect(typeof env.state.log[0].at).toBe("number");
  });

  test("chained temporal rules produce one audit entry per hop", async () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @state: M = S.A
  @log = []
}
< machine name=M for=S>
  .A after 10ms => .B
  .B after 10ms => .C
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    // Wait for both timers to fire (each ~10ms, plus slack).
    await sleep(60);
    expect(env.state.state).toBe("C");
    expect(env.state.log).toHaveLength(2);
    expect(env.state.log[0].rule).toBe("A:B");
    expect(env.state.log[1].rule).toBe("B:C");
    // Audit timestamps should be monotonically non-decreasing.
    expect(env.state.log[0].at).toBeLessThanOrEqual(env.state.log[1].at);
  });

  test("user-triggered transition that lands on a temporal-armed variant still cascades audits", async () => {
    const src = `<program>
\${
  type S:enum = { Idle, Running, Done }
  @state: M = S.Idle
  @log = []
  function go() { @state = S.Running }
}
< machine name=M for=S>
  .Idle => .Running
  .Running after 10ms => .Done
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    // User fires Idle → Running; transition guard arms the 10ms Running → Done timer.
    const goName = env.userFnNames.find(n => n.includes("go"));
    expect(goName).toBeTruthy();
    env.userFns[goName]();
    // Immediately after invoke, the user-driven entry is in the log.
    expect(env.state.log).toHaveLength(1);
    expect(env.state.log[0].rule).toBe("Idle:Running");
    // Wait for the temporal timer to fire.
    await sleep(40);
    expect(env.state.state).toBe("Done");
    expect(env.state.log).toHaveLength(2);
    expect(env.state.log[1].rule).toBe("Running:Done");
  });
});

describe("S27 §51.11.4 — audit entries are Object.freeze'd", () => {
  test("user-driven audit entry is frozen", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @state: M = S.A
  @log = []
  function step() { @state = S.B }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    const stepName = env.userFnNames.find(n => n.includes("step"));
    env.userFns[stepName]();
    expect(env.state.log).toHaveLength(1);
    const entry = env.state.log[0];
    expect(Object.isFrozen(entry)).toBe(true);
    // Strict-mode mutation of a frozen object throws TypeError.
    expect(() => {
      "use strict";
      entry.rule = "tampered";
    }).toThrow(TypeError);
  });

  test("timer-fired audit entry is also frozen", async () => {
    const src = `<program>
\${
  type S:enum = { Idle, Done }
  @state: M = S.Idle
  @log = []
}
< machine name=M for=S>
  .Idle after 10ms => .Done
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    await sleep(40);
    expect(env.state.log).toHaveLength(1);
    expect(Object.isFrozen(env.state.log[0])).toBe(true);
  });
});
