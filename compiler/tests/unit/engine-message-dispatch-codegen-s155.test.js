/* SPDX-License-Identifier: MIT
 *
 * Unit — #14 event-payload-transition (Approach E), CODEGEN batch (S155 batch 3).
 *
 * Codegen-STRING coverage for §51.0.S message dispatch lowering. These assert
 * the SHAPE of the emitted client JS (the message-arm dispatch table, the
 * `.advance(.Msg)` → `_scrml_engine_dispatch_message` plane routing, the arm-
 * body effect + target lowering, both payload planes in scope). The OBSERVABLE
 * runtime semantics (effect runs / transition happens / onIdle reset) are
 * covered by the happy-dom canary `engine-message-dispatch-s155.browser.test.js`
 * (emit-string-only tests mask runtime miscompiles — S140/S152 trap).
 *
 * Pipeline: splitBlocks → buildAST → runSYM → generateClientJs (the live path
 * that populates `messageArms` via parseEngineStateChildren + resolves
 * `accepts=` / messageVariants via SYM PASS 11).
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateClientJs } from "../../src/codegen/emit-client.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

function runUpToSYM(source, filePath = "msg-codegen.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  return { ast, sym };
}

function makeTestCtx(fileAST) {
  return makeCompileContext({
    filePath: fileAST.filePath ?? "msg-codegen.scrml",
    fileAST,
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectedFields: new Map(),
    authMiddleware: null,
    middlewareConfig: null,
    csrfEnabled: false,
    encodingCtx: null,
    mode: "browser",
    testMode: true,
    dbVar: "_scrml_db",
    workerNames: [],
    errors: [],
    registry: new BindingRegistry(),
    derivedNames: new Set(),
    analysis: null,
    usedRuntimeChunks: new Set(["core", "scope", "errors", "transitions"]),
  });
}

function emitClient(source) {
  const { ast, sym } = runUpToSYM(source);
  const errors = sym.errors.filter((e) => (e.severity ?? "error") === "error");
  const fileAST = {
    filePath: "msg-codegen.scrml",
    ast,
    machineDecls: ast.machineDecls,
    nodes: ast.nodes,
    typeDecls: ast.typeDecls,
  };
  const js = generateClientJs(makeTestCtx(fileAST));
  return { js, errors };
}

// Full `compileScrml` path — wires event handlers (the unit makeTestCtx does
// NOT fully wire `<button onclick=…>` handlers, so the `.advance` PLANE routing
// at markup-attribute handler sites must be observed through the real compile).
function compileFullClient(source, baseName = "msg-route") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve("/tmp", "scrml-msg-route", `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      js: foldChunkNamespacing(existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// The §51.0.S.6 worked example, made exhaustive per §51.0.S.2.4 via the
// canonical `| _ :> @<engineVar>` ignore-the-rest escape hatch (the spec's
// own §51.0.S.6 partial-arm example illustrates the SHAPE; a compilable program
// must be exhaustive or carry a wildcard).
const WORKED = `<program title="Drag S6">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
  type DragMsg:enum   = { Start(id: number), Drop(col: string), End }
}
const taskMovedTo = (tasks, id, col) => tasks
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
<ul ondrop=@dragPhase.advance(.Drop("c1"))>
  <li ondragstart=@dragPhase.advance(.Start(7)) ondragend=@dragPhase.advance(.End)>drag</li>
</ul>
</program>`;

describe("§51.0.S codegen — message-arm dispatch table emission", () => {
  test("compiles the worked example with no errors", () => {
    const { errors } = emitClient(WORKED);
    expect(errors).toEqual([]);
  });

  test("emits the per-engine message-arm dispatch table const", () => {
    const { js } = emitClient(WORKED);
    expect(js).toContain("const __scrml_engine_dragPhase_msg_arms = Object.freeze({");
  });

  test("the table is keyed by from-state tag, then message-variant tag", () => {
    const { js } = emitClient(WORKED);
    // Idle.Start arm + Dragging.Drop / Dragging.End arms.
    expect(js).toMatch(/"Idle":\s*\{/);
    expect(js).toMatch(/"Dragging":\s*\{/);
    expect(js).toMatch(/"Start":\s*function/);
    expect(js).toMatch(/"Drop":\s*function/);
    expect(js).toMatch(/"End":\s*function/);
  });

  test("the wildcard arm is keyed `_` (§51.0.S.2.4 ignore-the-rest)", () => {
    const { js } = emitClient(WORKED);
    expect(js).toMatch(/"_":\s*function/);
  });

  test("arm fn binds message payload from _msgData (§18.7)", () => {
    const { js } = emitClient(WORKED);
    // .Drop(col) → message-payload binding col from _msgData.
    expect(js).toContain('var col = _msgData ? _msgData["col"] : null;');
  });

  test("arm fn binds state payload from _stateData (§51.0.B.1)", () => {
    const { js } = emitClient(WORKED);
    // .Dragging(id) state binding → id from _stateData (in scope for the
    // (Dragging × Drop) / (Dragging × End) arms).
    expect(js).toContain('var id = _stateData ? _stateData["id"] : null;');
  });

  test("arm body effect lowers to _scrml_reactive_set, NOT a re-declaration", () => {
    const { js } = emitClient(WORKED);
    // The (Dragging × Drop) arm runs `@tasks = taskMovedTo(...)`.
    expect(js).toContain('_scrml_reactive_set("tasks", taskMovedTo(');
    // insideFunctionBody=true suppresses the _scrml_init_set reset-thunk so the
    // arm body is a clean reassignment, not a declaration site.
    expect(js).not.toContain('_scrml_init_set("tasks"');
  });

  test("arm fn returns the resolved target (unit + payload-bearing)", () => {
    const { js } = emitClient(WORKED);
    // .Start(id) :> .Dragging(id) → payload-bearing target tagged-object.
    expect(js).toContain('return { variant: "Dragging", data: { id: id } };');
    // .Drop :> .Idle and .End :> .Idle → bare-string unit target.
    expect(js).toContain('return "Idle";');
    // wildcard `| _ :> @dragPhase` → stay in current (self-target).
    expect(js).toContain('return _scrml_reactive_get("dragPhase");');
  });
});

describe("§51.0.S codegen — .advance plane routing (§51.0.G.1 stamp)", () => {
  test("message-plane .advance routes to _scrml_engine_dispatch_message", () => {
    const { js, errors } = compileFullClient(WORKED, "drag-route");
    expect(errors).toEqual([]);
    expect(js).toContain("_scrml_engine_dispatch_message(\"dragPhase\",");
  });

  test("the dispatch call passes the msg-arm table + the transition table", () => {
    const { js, errors } = compileFullClient(WORKED, "drag-route");
    expect(errors).toEqual([]);
    expect(js).toMatch(
      /_scrml_engine_dispatch_message\("dragPhase",[^;]*__scrml_engine_dragPhase_msg_arms,\s*__scrml_engine_dragPhase_transitions\)/,
    );
  });

  test("the dispatched message variant is lowered to its runtime value", () => {
    const { js, errors } = compileFullClient(WORKED, "drag-route");
    expect(errors).toEqual([]);
    // .Drop("c1") → { variant: "Drop", data: { col: "c1" } }
    expect(js).toContain('{ variant: "Drop", data: { col: "c1" } }');
    // .Start(7) → { variant: "Start", data: { id: 7 } }
    expect(js).toContain('{ variant: "Start", data: { id: 7 } }');
    // .End → bare string "End" (unit message variant)
    expect(js).toMatch(/_scrml_engine_dispatch_message\("dragPhase",\s*"End"/);
  });

  test("a STATE-plane .advance still routes to _scrml_engine_advance", () => {
    const stateAdvance = `<program>
\${ type Phase:enum = { Idle, Busy } type Msg:enum = { Go } }
<engine for=Phase initial=.Idle accepts=Msg>
  <Idle rule=.Busy>
    | .Go :> .Busy
  </>
  <Busy rule=.Idle></>
</>
<button onclick=@phase.advance(.Busy)>go</button>
</program>`;
    const { js, errors } = compileFullClient(stateAdvance);
    expect(errors).toEqual([]);
    // .advance(.Busy) is a STATE variant (Phase), NOT a message (Msg) — state plane.
    expect(js).toContain('_scrml_engine_advance("phase", "Busy"');
    // It must NOT route through the message dispatcher.
    expect(js).not.toMatch(/_scrml_engine_dispatch_message\("phase",\s*"Busy"/);
  });

  test("an engine with NO accepts= never emits a msg-arm table or dispatch", () => {
    const noAccepts = `<program>
\${ type Phase:enum = { Idle, Busy } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Busy></>
  <Busy rule=.Idle></>
</>
<button onclick=@phase.advance(.Busy)>go</button>
</program>`;
    const { js, errors } = compileFullClient(noAccepts);
    expect(errors).toEqual([]);
    expect(js).not.toContain("__scrml_engine_phase_msg_arms");
    expect(js).not.toContain("_scrml_engine_dispatch_message");
    expect(js).toContain('_scrml_engine_advance("phase", "Busy"');
  });
});

describe("§51.0.S.2.7 codegen — static arm-target rule= validation", () => {
  test("a STATIC arm target not in the from-state rule= → E-ENGINE-INVALID-TRANSITION (compile-time)", () => {
    const illegal = `<program>
\${ type S:enum = { A, B, C } type M:enum = { Jump } }
<engine for=S initial=.A accepts=M>
  <A rule=.B>
    | .Jump :> { @x = 1; .C }
  </>
  <B rule=.A></>
  <C rule=.A></>
</>
</program>`;
    const { errors } = compileFullClient(illegal, "arm-illegal");
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("E-ENGINE-INVALID-TRANSITION");
  });

  test("a STATIC bare-target arm in the from-state rule= compiles clean", () => {
    const legal = `<program>
\${ type S:enum = { A, B } type M:enum = { Go } }
<engine for=S initial=.A accepts=M>
  <A rule=.B>
    | .Go :> .B
  </>
  <B rule=.A></>
</>
</program>`;
    const { errors } = compileFullClient(legal, "arm-legal");
    expect(errors.map((e) => e.code)).not.toContain("E-ENGINE-INVALID-TRANSITION");
  });

  test("a self-target arm (`| _ :> @engineVar`) is always legal (§51.0.F.1 no-op)", () => {
    const selfTarget = `<program>
\${ type S:enum = { A, B } type M:enum = { Go, Skip } }
<engine for=S initial=.A accepts=M>
  <A rule=.B>
    | .Go   :> .B
    | .Skip :> @s
  </>
  <B rule=.A></>
</>
</program>`;
    const { errors } = compileFullClient(selfTarget, "arm-self");
    expect(errors.map((e) => e.code)).not.toContain("E-ENGINE-INVALID-TRANSITION");
  });

  test("a COMPUTED arm target is NOT statically checked (runtime leg per §51.0.S.2.7)", () => {
    // pickBad() resolves at runtime — the static compile-time leg must NOT fire
    // (it only acts on a literal `.Variant` final). The runtime rule= check is
    // covered by the happy-dom canary.
    const computed = `<program>
\${ type S:enum = { A, B, C } type M:enum = { Jump } }
<bad> = "C"
const pickBad = () => @bad
<engine for=S initial=.A accepts=M>
  <A rule=.B>
    | .Jump :> { @x = 1; pickBad() }
  </>
  <B rule=.A></>
  <C rule=.A></>
</>
</program>`;
    const { errors } = compileFullClient(computed, "arm-computed");
    expect(errors.map((e) => e.code)).not.toContain("E-ENGINE-INVALID-TRANSITION");
  });
});

describe("§51.0.S codegen — render body excludes the arm source", () => {
  test("the message-arm syntax does NOT leak into the rendered HTML string", () => {
    const { js } = emitClient(WORKED);
    // The arm source `| .Start(id) :> .Dragging(id)` must never appear inside a
    // render-fn return string (the body-render path strips the arm region).
    expect(js).not.toContain(":>");
    expect(js).not.toContain("| .Start");
    expect(js).not.toContain("| .Drop");
  });
});
