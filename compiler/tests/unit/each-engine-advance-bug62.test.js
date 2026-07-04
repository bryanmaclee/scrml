/**
 * each-engine-advance-bug62.test.js — Bug 62 (S156).
 *
 * Engine `.advance(.X)` (state AND message plane) and `@engine = .X`
 * direct-write inside a Tier-1 `<each>` per-item event handler were emitted
 * RAW (neither the `@` sigil nor `.advance` lowered) → E-CODEGEN-INVALID-LOGIC
 * "Unexpected character '@'". renderTemplateAttrToJs case (2) routed the
 * handler value through `rewriteIterValueExpr` ONLY (iter-scope lowering, no
 * engine awareness).
 *
 * The fix threads the file's engine codegen ctx into the each per-item handler
 * emitter so engine transitions lower through the SAME canonical machinery the
 * non-each path uses (emit-event-wiring + emit-expr C13 arm).
 *
 * Coverage:
 *   §1 — STATE-plane `.advance(.X)` in <each> handler → _scrml_engine_advance,
 *        compile exit 0, no E-CODEGEN-INVALID-LOGIC, no raw `@`.
 *   §2 — MESSAGE-plane `.advance(.Msg(payload))` (§51.0.S.6 shape, accepts=) in
 *        a nested <each> → _scrml_engine_dispatch_message; `as`-name payload
 *        (`col`) composes with the dispatch.
 *   §3 — ASSIGN form `${@engine = .X}` in <each> handler →
 *        _scrml_engine_direct_set (write-guard path).
 *   §4 — Non-regression: a non-engine handler (`onclick=fn(@.id)`) + `class:`
 *        in an each over an engine-bearing file keeps iter-scope-only lowering.
 *   §5 — Tree-shake: an engine-free file's each handler is unaffected.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToOutputs(source, suffix = "bug62") {
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
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Extract the body of every per-item addEventListener emitted in the each
// render factory (handler bodies are where the raw-`@` defect surfaced).
function eachHandlerBodies(clientJs) {
  const out = [];
  const re = /addEventListener\([^,]+,\s*function\(event\)\s*\{([\s\S]*?)\}\);/g;
  let m;
  while ((m = re.exec(clientJs)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// §1 — STATE-plane advance
// ---------------------------------------------------------------------------

describe("bug62 §1 — STATE-plane .advance(.X) in <each> handler", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b", "c"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>
    <each in=@cols as col>
        <li onclick=@phase.advance(.Active)>${"$"}{col}</li>
    </each>
</ul>
</program>`;

  test("compiles exit 0 (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(src, "bug62-state");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("each handler lowers to _scrml_engine_advance — no raw @ or .advance survives", () => {
    const { clientJs } = compileToOutputs(src, "bug62-state");
    const bodies = eachHandlerBodies(clientJs);
    // At least one each handler body contains the lowered engine advance.
    expect(bodies.some((b) => /_scrml_engine_advance\("phase",\s*"Active"/.test(b))).toBe(true);
    // No each handler body retains the raw engine sigil / unlowered .advance.
    for (const b of bodies) {
      expect(b).not.toMatch(/@phase/);
      expect(b).not.toMatch(/\.advance\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — MESSAGE-plane advance (§51.0.S.6 shape)
// ---------------------------------------------------------------------------

describe("bug62 §2 — MESSAGE-plane .advance(.Msg(payload)) in <each>", () => {
  const src = `<program title="Drag board each (§51.0.S.6)">
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

<ul class="cols">
    <each in=@columns as col>
        <li class="col" onclick=@dragPhase.advance(.Drop(col))>${"$"}{col}</li>
    </each>
</ul>
</program>`;

  test("compiles exit 0 (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(src, "bug62-msg");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("each handler lowers to _scrml_engine_dispatch_message with the `as`-name payload", () => {
    const { clientJs } = compileToOutputs(src, "bug62-msg");
    const bodies = eachHandlerBodies(clientJs);
    // Message-plane dispatch with the Drop variant + `col` payload (the as-name).
    expect(bodies.some((b) =>
      /_scrml_engine_dispatch_message\("dragPhase",\s*\{\s*variant:\s*"Drop",\s*data:\s*\{\s*col:\s*col\s*\}/.test(b)
    )).toBe(true);
    for (const b of bodies) {
      expect(b).not.toMatch(/@dragPhase/);
      expect(b).not.toMatch(/\.advance\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — ASSIGN form `${@engine = .X}`
// ---------------------------------------------------------------------------

describe("bug62 §3 — direct-write ${@engine = .X} in <each> handler", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>
    <each in=@cols as col>
        <li onclick=${"$"}{@phase = .Active}>${"$"}{col}</li>
    </each>
</ul>
</program>`;

  test("compiles exit 0 (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(src, "bug62-assign");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("each handler lowers to _scrml_engine_direct_set (write-guard path)", () => {
    const { clientJs } = compileToOutputs(src, "bug62-assign");
    const bodies = eachHandlerBodies(clientJs);
    expect(bodies.some((b) => /_scrml_engine_direct_set\("phase",\s*"Active"/.test(b))).toBe(true);
    for (const b of bodies) expect(b).not.toMatch(/@phase\s*=/);
  });
});

// ---------------------------------------------------------------------------
// §4 — Non-regression: non-engine handler in an engine-bearing file
// ---------------------------------------------------------------------------

describe("bug62 §4 — non-engine each handler unaffected (engine present)", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    <items> = [{ id: 1, name: "a" }, { id: 2, name: "b" }]
    const remove = (id) => { @items = @items.filter((x) => x.id != id) }
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>
    <each in=@items as it>
        <li onclick=remove(@.id)>${"$"}{it.name}</li>
        <button onclick=@phase.advance(.Active)>"go"</button>
    </each>
</ul>
</program>`;

  test("non-engine handler keeps iter-scope-only lowering; engine handler still lowers", () => {
    const { errors, clientJs } = compileToOutputs(src, "bug62-mixed");
    expect(errors).toEqual([]);
    const bodies = eachHandlerBodies(clientJs);
    // The plain handler is iter-scope-lowered (remove(it.id)), NOT routed through engine machinery.
    expect(bodies.some((b) => /remove\(it\.id\)/.test(b))).toBe(true);
    // The sibling engine handler is lowered.
    expect(bodies.some((b) => /_scrml_engine_advance\("phase",\s*"Active"/.test(b))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 — Tree-shake: engine-free file each handler is byte-stable
// ---------------------------------------------------------------------------

describe("bug62 §5 — engine-free each handler unaffected (null carrier)", () => {
  const src = `<program>
${"$"}{
    <items> = [{ id: 1, name: "a" }]
    const ping = (id) => { @items = @items }
}

<ul>
    <each in=@items as it>
        <li onclick=ping(@.id)>${"$"}{it.name}</li>
    </each>
</ul>
</program>`;

  test("plain call handler with @.id arg lowers to ping(it.id); no engine helpers", () => {
    const { errors, clientJs } = compileToOutputs(src, "bug62-noeng");
    expect(errors).toEqual([]);
    const bodies = eachHandlerBodies(clientJs);
    expect(bodies.some((b) => /ping\(it\.id\)/.test(b))).toBe(true);
    expect(clientJs).not.toContain("_scrml_engine_advance");
    expect(clientJs).not.toContain("_scrml_engine_dispatch_message");
  });
});
