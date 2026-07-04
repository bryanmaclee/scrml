/**
 * lift-engine-advance-bug65.test.js — Bug 65 (S157).
 *
 * Tier-0 SIBLING of Bug 62 (the Tier-1 `<each>` fix in emit-each.ts). A lifted
 * event handler inside a `${ for (…) { lift <el on…=@engine.advance(.X)> } }`
 * body was lowered through `emitExprField` with NO engine codegen ctx, so the
 * call resolved against the bare reactive cell:
 *
 *     _scrml_reactive_get("phase").advance("Active")
 *
 * `_scrml_reactive_get("phase")` returns the engine's bare variant STRING (no
 * `.advance` method) → TypeError on click. Compile exits 0 AND `node --check`
 * passes — a SILENT miscompile (distinct from Bug 62's loud E-CODEGEN-INVALID-LOGIC).
 *
 * The fix threads the file's engine codegen ctx (built ONCE via the SHARED
 * `buildEachEngineCtx` / re-packed by `buildLiftEngineCtxFromExtras`) down to
 * the lifted-handler emitters and routes engine references through the SAME
 * canonical machinery the each path uses (`emitEngineHandlerBody`).
 *
 * Coverage (mirrors each-engine-advance-bug62.test.js, Tier-0 form):
 *   §1 — STATE-plane `.advance(.X)` in `${for…lift}` handler → _scrml_engine_advance,
 *        compile exit 0, no raw `@phase`/`.advance`, node --check clean.
 *   §2 — MESSAGE-plane `.advance(.Drop(col))` (§51.0.S.6, accepts=) in a
 *        `${for…lift}` → _scrml_engine_dispatch_message; the `col` iter-var
 *        payload composes with the dispatch.
 *   §3 — ASSIGN form `${@engine = .X}` in a `${for…lift}` handler →
 *        _scrml_engine_direct_set (write-guard path).
 *   §4 — Non-regression: a non-engine handler (`onclick=ping(it)`) in a
 *        `${for…lift}` over an engine-bearing file is NOT routed through engine
 *        machinery (no engine helper injected for it).
 *   §5 — Tree-shake: an engine-free `${for…lift}` file emits NO engine helpers
 *        (null carrier → byte-identical pre-fix).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";

function compileToOutputs(source, suffix = "bug65") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs, clientPath };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Extract the body of every per-item addEventListener emitted in the lift
// factory (handler bodies are where the silent-miscompile defect surfaced).
function liftHandlerBodies(clientJs) {
  const out = [];
  const re = /addEventListener\([^,]+,\s*function\(event\)\s*\{([\s\S]*?)\}\);/g;
  let m;
  while ((m = re.exec(clientJs)) !== null) out.push(m[1]);
  return out;
}

// node --check on the emitted client.js — the load-bearing assertion: Bug 65 is
// node --check-CLEAN, so an emit-string-only test would miss it. We assert the
// LOWERING is correct AND the artifact PARSES. Use the real `node` binary
// (parse-only) — NOT `process.execPath`, which is `bun` under the test runner
// and `bun --check` EVALUATES the module (runtime globals are undefined → false
// negative). Mirrors the established `execFileSync("node", ["--check", …])`
// pattern (e.g. not-return-statement-glue.test.js).
function nodeCheck(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const f = resolve("/tmp", `scrml-bug65-check-${uniq}.js`);
  writeFileSync(f, source);
  try {
    execFileSync("node", ["--check", f], { stdio: "pipe" });
    return { ok: true, err: "" };
  } catch (e) {
    return { ok: false, err: String(e?.stderr ?? e) };
  } finally {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — STATE-plane advance
// ---------------------------------------------------------------------------

describe("bug65 §1 — STATE-plane .advance(.X) in ${for…lift} handler", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b", "c"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>${"$"}{ for (col of @cols) { lift <li onclick=@phase.advance(.Active)>${"$"}{col}</li> } }</ul>
</program>`;

  test("compiles exit 0 (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(src, "bug65-state");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("lift handler lowers to _scrml_engine_advance — no raw @phase or .advance survives", () => {
    const { clientJs } = compileToOutputs(src, "bug65-state");
    const bodies = liftHandlerBodies(clientJs);
    expect(bodies.some((b) => /_scrml_engine_advance\("phase",\s*"Active"/.test(b))).toBe(true);
    for (const b of bodies) {
      expect(b).not.toMatch(/@phase/);
      expect(b).not.toMatch(/\.advance\(/);
    }
    // No handler resolves .advance against the bare reactive cell string.
    expect(clientJs).not.toMatch(/_scrml_reactive_get\("phase"\)\.advance/);
  });

  test("emitted client.js passes node --check (silent-miscompile canary)", () => {
    const { clientJs } = compileToOutputs(src, "bug65-state");
    const { ok, err } = nodeCheck(clientJs);
    expect(ok).toBe(true);
    if (!ok) throw new Error(err);
  });
});

// ---------------------------------------------------------------------------
// §2 — MESSAGE-plane advance (§51.0.S.6 shape, accepts=)
// ---------------------------------------------------------------------------

describe("bug65 §2 — MESSAGE-plane .advance(.Drop(col)) in ${for…lift}", () => {
  const src = `<program title="Drag board for-lift (§51.0.S.6)">
${"$"}{
  type DragPhase:enum = { Idle, Dragging(id: number) }
  type DragMsg:enum   = { Start(id: number), Drop(col: string), End }
}

<tasks> = [{ id: 1, col: "todo" }]
<columns>: string[] = ["todo", "doing", "done"]

const taskMovedTo = (tasks, id, col) => tasks.map((t) => t.id == id ? { id: t.id, col: col } : t)

<engine for=DragPhase initial=.Idle accepts=DragMsg>
  <Idle rule=.Dragging>
    | .Start(id) :> .Dragging(id)
    | _          :> @dragPhase
  </>
  <Dragging(id) rule=.Idle>
    | .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }
    | .End       :> .Idle
    | _          :> @dragPhase
  </>
</>

<ul class="cols">${"$"}{ for (col of @columns) { lift <li class="col" onclick=@dragPhase.advance(.Drop(col))>${"$"}{col}</li> } }</ul>
</program>`;

  test("compiles exit 0 (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(src, "bug65-msg");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("lift handler lowers to _scrml_engine_dispatch_message with the `col` iter-var payload", () => {
    const { clientJs } = compileToOutputs(src, "bug65-msg");
    const bodies = liftHandlerBodies(clientJs);
    expect(bodies.some((b) =>
      /_scrml_engine_dispatch_message\("dragPhase",\s*\{\s*variant:\s*"Drop",\s*data:\s*\{\s*col:\s*col\s*\}/.test(b)
    )).toBe(true);
    for (const b of bodies) {
      expect(b).not.toMatch(/@dragPhase/);
      expect(b).not.toMatch(/\.advance\(/);
    }
  });

  test("emitted client.js passes node --check", () => {
    const { clientJs } = compileToOutputs(src, "bug65-msg");
    const { ok, err } = nodeCheck(clientJs);
    expect(ok).toBe(true);
    if (!ok) throw new Error(err);
  });
});

// ---------------------------------------------------------------------------
// §3 — ASSIGN form `${@engine = .X}`
// ---------------------------------------------------------------------------

describe("bug65 §3 — direct-write ${@engine = .X} in ${for…lift} handler", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>${"$"}{ for (col of @cols) { lift <li onclick=${"$"}{@phase = .Active}>${"$"}{col}</li> } }</ul>
</program>`;

  test("compiles exit 0 (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(src, "bug65-assign");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("lift handler lowers to _scrml_engine_direct_set (write-guard path)", () => {
    const { clientJs } = compileToOutputs(src, "bug65-assign");
    const bodies = liftHandlerBodies(clientJs);
    expect(bodies.some((b) => /_scrml_engine_direct_set\("phase",\s*"Active"/.test(b))).toBe(true);
    for (const b of bodies) expect(b).not.toMatch(/@phase\s*=/);
  });

  test("emitted client.js passes node --check", () => {
    const { clientJs } = compileToOutputs(src, "bug65-assign");
    const { ok, err } = nodeCheck(clientJs);
    expect(ok).toBe(true);
    if (!ok) throw new Error(err);
  });
});

// ---------------------------------------------------------------------------
// §4 — Non-regression: non-engine handler in an engine-bearing file
// ---------------------------------------------------------------------------

describe("bug65 §4 — non-engine ${for…lift} handler unaffected (engine present)", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    <items>: string[] = ["a", "b"]
    const ping = (name) => { @items = @items }
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>${"$"}{ for (it of @items) { lift <li onclick=ping(it)>${"$"}{it}</li> } }</ul>
</program>`;

  test("non-engine handler keeps plain-call lowering; NO engine machinery injected for it", () => {
    const { errors, clientJs } = compileToOutputs(src, "bug65-mixed");
    expect(errors).toEqual([]);
    const bodies = liftHandlerBodies(clientJs);
    // The plain handler stays a direct call — NOT routed through engine machinery.
    expect(bodies.some((b) => /ping\(it\)/.test(b))).toBe(true);
    for (const b of bodies) {
      expect(b).not.toMatch(/_scrml_engine_advance/);
      expect(b).not.toMatch(/_scrml_engine_dispatch_message/);
      expect(b).not.toMatch(/_scrml_engine_direct_set/);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — Tree-shake: engine-free ${for…lift} handler is byte-stable
// ---------------------------------------------------------------------------

describe("bug65 §5 — engine-free ${for…lift} handler unaffected (null carrier)", () => {
  const src = `<program>
${"$"}{
    <items>: string[] = ["a", "b"]
    const ping = (name) => { @items = @items }
}

<ul>${"$"}{ for (it of @items) { lift <li onclick=ping(it)>${"$"}{it}</li> } }</ul>
</program>`;

  test("plain call handler lowers to ping(it); ZERO engine helpers anywhere in the file", () => {
    const { errors, clientJs } = compileToOutputs(src, "bug65-noeng");
    expect(errors).toEqual([]);
    const bodies = liftHandlerBodies(clientJs);
    expect(bodies.some((b) => /ping\(it\)/.test(b))).toBe(true);
    expect(clientJs).not.toContain("_scrml_engine_advance");
    expect(clientJs).not.toContain("_scrml_engine_dispatch_message");
    expect(clientJs).not.toContain("_scrml_engine_direct_set");
  });

  test("emitted client.js passes node --check", () => {
    const { clientJs } = compileToOutputs(src, "bug65-noeng");
    const { ok, err } = nodeCheck(clientJs);
    expect(ok).toBe(true);
    if (!ok) throw new Error(err);
  });
});
