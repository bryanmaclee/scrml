/**
 * engine-onIdle-watchdog.test.js — A5-6 §51.0.R unit tests
 *
 * Tests the engine-wide event-timeout watchdog (`<onIdle>`) per SPEC §51.0.R
 * (S77 amendment). Watchdog is armed at module-init, RESET on every successful
 * transition (any `_scrml_engine_direct_set` / `_scrml_engine_advance` commit),
 * fires after N ms of silence.
 *
 * Coverage:
 *   §A5-6.1  Parser: scanForOnIdleEntries extracts after= + to= correctly
 *   §A5-6.2  Typer: PASS 11 fires E-IDLE-DUPLICATE on multiple <onIdle>
 *   §A5-6.3  Typer: PASS 11 fires E-IDLE-INVALID-VARIANT on unknown to= variant
 *   §A5-6.4  Typer: PASS 11 fires E-IDLE-MISPLACED on <onIdle> inside state-child
 *   §A5-6.5  Codegen: emit watchdog config const (literal form)
 *   §A5-6.6  Codegen: emit watchdog config const (computed form with ${expr})
 *   §A5-6.7  Codegen: tree-shake — no const emitted when no <onIdle>
 *   §A5-6.8  Codegen: initial-arm at module-init via _scrml_engine_arm_idle_watchdog
 *   §A5-6.9  Codegen: direct-write call sites pass watchdog as 5th arg (timers null)
 *   §A5-6.10 Runtime: helpers exist in runtime template
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { scanForOnIdleEntries } from "../../src/engine-statechild-parser.ts";
import { compileScrml } from "../../src/api.js";
import { unNamespaceEngineNames } from "../helpers/chunk-scope.js";

function compileToClientJs(source, suffix = "onIdle") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs: unNamespaceEngineNames(clientJs) };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §A5-6.1 — Parser: scanForOnIdleEntries
// ---------------------------------------------------------------------------

describe("A5-6 §A5-6.1 — scanForOnIdleEntries parser", () => {
  test("literal after= and dotted to=", () => {
    const entries = scanForOnIdleEntries(`<onIdle after=5m to=.Idle/>`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ after: "5m", to: "Idle" });
  });

  test("computed ${expr}<unit> after=", () => {
    const entries = scanForOnIdleEntries(`<onIdle after=\${@delay}s to=.Idle/>`);
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toBe("${@delay}s");
    expect(entries[0].to).toBe("Idle");
  });

  test("multiple entries captured for typer to validate", () => {
    const entries = scanForOnIdleEntries(
      `<onIdle after=5m to=.Idle/>\n<onIdle after=10m to=.Stale/>`,
    );
    expect(entries).toHaveLength(2);
  });

  test("no <onIdle> → empty array", () => {
    expect(scanForOnIdleEntries(``)).toEqual([]);
    expect(scanForOnIdleEntries(`<onTimeout after=30s to=.X/>`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §A5-6.2-4 — Typer: diagnostics
// ---------------------------------------------------------------------------

describe("A5-6 §A5-6.2 — E-IDLE-DUPLICATE", () => {
  test("two <onIdle> in one engine fires E-IDLE-DUPLICATE", () => {
    const src = `\${
  type Phase:enum = { Active, Idle }
}
<engine for=Phase initial=.Active>
  <Active rule=.Idle></>
  <Idle></>
  <onIdle after=5m to=.Idle/>
  <onIdle after=10m to=.Idle/>
</>`;
    const { errors } = compileToClientJs(src, "dup");
    const dup = errors.filter(e => e.code === "E-IDLE-DUPLICATE");
    expect(dup.length).toBeGreaterThanOrEqual(1);
  });
});

describe("A5-6 §A5-6.3 — E-IDLE-INVALID-VARIANT", () => {
  test("to= references variant not in engine's enum fires E-IDLE-INVALID-VARIANT", () => {
    const src = `\${
  type Phase:enum = { Active, Idle }
}
<engine for=Phase initial=.Active>
  <Active rule=.Idle></>
  <Idle></>
  <onIdle after=5m to=.Nonexistent/>
</>`;
    const { errors } = compileToClientJs(src, "invvar");
    const inv = errors.filter(e => e.code === "E-IDLE-INVALID-VARIANT");
    expect(inv.length).toBeGreaterThanOrEqual(1);
  });
});

describe("A5-6 §A5-6.4 — E-IDLE-MISPLACED", () => {
  test("<onIdle> inside a state-child body fires E-IDLE-MISPLACED", () => {
    const src = `\${
  type Phase:enum = { Active, Idle }
}
<engine for=Phase initial=.Active>
  <Active rule=.Idle>
    <onIdle after=5m to=.Idle/>
  </>
  <Idle></>
</>`;
    const { errors } = compileToClientJs(src, "misplaced");
    const mis = errors.filter(e => e.code === "E-IDLE-MISPLACED");
    expect(mis.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §A5-6.5-9 — Codegen
// ---------------------------------------------------------------------------

describe("A5-6 §A5-6.5 — codegen literal form", () => {
  test("literal `after=5m` emits Object.freeze({ ms: 300000, target: 'Idle' })", () => {
    const src = `\${
  type Phase:enum = { Active, Idle }
}
<engine for=Phase initial=.Active>
  <Active rule=.Idle></>
  <Idle></>
  <onIdle after=5m to=.Idle/>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "lit");
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("__scrml_engine_phase_idle");
    expect(clientJs).toMatch(/ms:\s*300000/);
    expect(clientJs).toMatch(/target:\s*"Idle"/);
  });
});

describe("A5-6 §A5-6.6 — codegen computed form", () => {
  test("computed `after=${@delay}s` emits IIFE-style msExpr arrow-fn", () => {
    const src = `\${
  type Phase:enum = { Active, Idle }
  @delay = 60
}
<engine for=Phase initial=.Active>
  <Active rule=.Idle></>
  <Idle></>
  <onIdle after=\${@delay}s to=.Idle/>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "cmp");
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("__scrml_engine_phase_idle");
    expect(clientJs).toContain("msExpr: function()");
    expect(clientJs).toContain('_scrml_reactive_get("delay")');
    // Unit multiplier for `s` is 1000.
    expect(clientJs).toContain("* 1000");
  });
});

describe("A5-6 §A5-6.7 — tree-shake when no <onIdle>", () => {
  test("engine without <onIdle> emits no _idle const", () => {
    const src = `\${
  type Phase:enum = { Active, Idle }
}
<engine for=Phase initial=.Active>
  <Active rule=.Idle></>
  <Idle></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "shake");
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    expect(clientJs).not.toContain("__scrml_engine_phase_idle");
    expect(clientJs).not.toContain("_scrml_engine_arm_idle_watchdog");
  });
});

describe("A5-6 §A5-6.8 — initial-arm at module-init", () => {
  test("arm-watchdog call emitted after reactive wiring", () => {
    const src = `\${
  type Phase:enum = { Active, Idle }
}
<engine for=Phase initial=.Active>
  <Active rule=.Idle></>
  <Idle></>
  <onIdle after=5m to=.Idle/>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "init");
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain(
      `_scrml_engine_arm_idle_watchdog("phase", __scrml_engine_phase_idle, __scrml_engine_phase_transitions);`,
    );
  });
});

describe("A5-6 §A5-6.9 — direct-write call sites pass watchdog as 5th arg", () => {
  test("engine without <onTimeout> but with <onIdle>: timersTable=null, idleEntry=watchdog", () => {
    // Use Phase.Working qualified to avoid B20 bare-variant-in-assignment ambiguity.
    const src = `\${
  type Phase:enum = { Active, Working, Idle }
  function start() { @phase = Phase.Working }
}
<engine for=Phase initial=.Active>
  <Active rule=.Working></>
  <Working rule=.Idle></>
  <Idle></>
  <onIdle after=10s to=.Idle/>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "ds");
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    // direct_set 5-arg form: ("name", value, transitions, null, __scrml_engine_phase_idle)
    expect(clientJs).toContain(
      `_scrml_engine_direct_set("phase", Phase.Working, __scrml_engine_phase_transitions, null, __scrml_engine_phase_idle);`,
    );
  });
});

// ---------------------------------------------------------------------------
// §A5-6.10 — Runtime helpers exist
// ---------------------------------------------------------------------------

describe("A5-6 §A5-6.10 — runtime helpers in template", () => {
  test("_scrml_engine_arm_idle_watchdog + _scrml_engine_reset_idle_watchdog defined", () => {
    const fs = require("fs");
    const rt = fs.readFileSync(
      require.resolve("../../src/runtime-template.js"),
      "utf8",
    );
    expect(rt).toContain("function _scrml_engine_arm_idle_watchdog(");
    expect(rt).toContain("function _scrml_engine_reset_idle_watchdog(");
    // Reset is called in both _scrml_engine_direct_set + _scrml_engine_advance.
    expect(rt).toMatch(/_scrml_engine_reset_idle_watchdog\(varName,\s*idleEntry,\s*table\)/);
  });
});
