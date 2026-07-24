/* SPDX-License-Identifier: MIT
 *
 * engine-opener-effect-c1.test.js — §51.0.H Form 3 (S148, Insight 33 Fork C1)
 *
 * `effect=${...}` on the `<engine>` OPENER is a boot-only init effect: the
 * effect of the implicit init→`initial=` transition (Elm `init`+`Cmd`). It
 * runs ONCE at module-init, NOT on a later re-entry into `initial=`, and is a
 * DISTINCT slot from the per-state-child `effect=` (Form 1).
 *
 * Coverage (BRIEF Step B):
 *   §1 PARSE   — opener `effect=` populates engine-decl.openerEffect; absent → null;
 *               existing engines (no opener effect) unchanged.
 *   §2 SYM     — derived + opener effect fires E-ENGINE-EFFECT-ON-DERIVED for BOTH
 *               derived forms (legacy-source-var `derived=@x` AND inline-match
 *               `derived=match @x {...}`); non-derived opener effect → no error.
 *   §3 SYM     — `.skip` documenting the DEFERRED `.<initial>.rule` write-validation
 *               check (B15 raw-text precedent — opener effect body is raw text at
 *               SYM; the write-vs-rule check is codegen-stage future work).
 *   §4 CODEGEN — non-derived opener effect emits a module-init fire; `node --check`-
 *               clean; boot-only (body appears ONCE at module-init, NOT inside a
 *               per-arm re-entry handler); tree-shake when absent.
 *
 * The happy-dom acceptance (boots / boot-effect-runs-once / transitions out of
 * .Loading) lives in compiler/tests/browser/engine-opener-effect-c1.browser.test.js.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "fs";
import { spawnSync } from "child_process";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run BS + TAB on a source string and return the AST. */
function parse(source, filePath = "opener-effect.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return ast;
}

/** Run BS + TAB + SYM; return the SYM error codes (error-severity only). */
function symErrorCodes(source, filePath = "opener-effect.scrml") {
  const ast = parse(source, filePath);
  const sym = runSYM({ filePath, ast });
  return (sym.errors ?? [])
    .filter((e) => (e.severity ?? "error") === "error")
    .map((e) => e.code);
}

/** Walk the AST collecting every engine-decl node. */
function collectEngineDecls(ast) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.kind === "engine-decl") out.push(n);
    for (const k of ["nodes", "children", "body", "bodyChildren", "consequent", "alternate"]) {
      if (Array.isArray(n[k])) n[k].forEach(walk);
    }
  }
  (ast.nodes ?? []).forEach(walk);
  return out;
}

/** Compile a source string through the real pipeline; return errors + client.js. */
function compileToClientJs(source, baseName = "opener-effect") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve("/tmp", `scrml-c1-${baseName}-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      clientPath,
      keepDir: tmpDir,
    };
  } finally {
    // dir cleanup happens in the node --check test by re-compiling; here we
    // leave the temp dir to the OS (the harness cleans /tmp).
    if (existsSync(tmpDir) && !globalThis.__C1_KEEP__) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Canonical non-derived flagship shape (README Stage-3 derivative).
const FLAGSHIP_SRC = `<program title="C1">
\${
  type Phase:enum = { Loading, Empty, Editing, Saving, Saved, ErrorState(msg: string) }
}
const loadTasks = () => [{ id: 1, text: "a", completed_at: not }]
<engine for=Phase initial=.Loading effect=\${
    @tasks = loadTasks()
    @phase = @tasks.length == 0 ? .Empty : .Editing
}>
  <Loading rule=(.Empty | .Editing | .ErrorState)>Loading…</>
  <Empty rule=.Saving>None.</>
  <Editing rule=.Saving>\${@tasks.length} tasks</>
  <Saving rule=(.Saved | .ErrorState)>Saving…</>
  <Saved rule=.Editing>Saved.</>
  <ErrorState msg rule=.Loading>\${msg}</>
</>
</program>`;

// Engine with NO opener effect (tree-shake + parse-unchanged baseline).
const NO_EFFECT_SRC = `<program title="C1 no-effect">
\${ type Phase:enum = { Loading, Empty } }
<engine for=Phase initial=.Loading>
  <Loading rule=.Empty>Loading…</>
  <Empty>None.</>
</>
</program>`;

// ---------------------------------------------------------------------------
// §1 — PARSE: openerEffect field
// ---------------------------------------------------------------------------

describe("C1 §1 — PARSE: opener effect= captured into engine-decl.openerEffect", () => {
  test("opener `effect=${...}` populates engine-decl.openerEffect (raw body, no ${} wrapper)", () => {
    const ast = parse(`<program>
\${ type Phase:enum = { Loading, Empty } }
<engine for=Phase initial=.Loading effect=\${ @x = 1 }>
  <Loading rule=.Empty></>
  <Empty></>
</>
</program>`);
    const engines = collectEngineDecls(ast);
    expect(engines.length).toBe(1);
    expect(engines[0].openerEffect).toBe("@x = 1");
  });

  test("multi-statement opener effect body is captured verbatim (newlines preserved)", () => {
    const ast = parse(FLAGSHIP_SRC);
    const engines = collectEngineDecls(ast);
    expect(engines.length).toBe(1);
    expect(typeof engines[0].openerEffect).toBe("string");
    expect(engines[0].openerEffect).toContain("@tasks = loadTasks()");
    expect(engines[0].openerEffect).toContain("@phase = @tasks.length == 0 ? .Empty : .Editing");
  });

  test("absent opener effect → engine-decl.openerEffect is null", () => {
    const ast = parse(NO_EFFECT_SRC);
    const engines = collectEngineDecls(ast);
    expect(engines.length).toBe(1);
    expect(engines[0].openerEffect).toBeNull();
  });

  test("existing engines (no opener effect) parse unchanged — state-children intact", () => {
    const ast = parse(NO_EFFECT_SRC);
    const engines = collectEngineDecls(ast);
    expect(engines[0].varName ?? engines[0].varNameOverride).toBeDefined();
    // The engine still parses its governedType + state-children; opener-effect
    // is a purely additive field.
    expect(engines[0].governedType).toBeDefined();
    expect(Array.isArray(engines[0].bodyChildren)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — SYM: E-ENGINE-EFFECT-ON-DERIVED (ruling iii)
// ---------------------------------------------------------------------------

describe("C1 §2 — SYM: E-ENGINE-EFFECT-ON-DERIVED on a derived opener effect", () => {
  test("legacy-source-var derived (`derived=@src`) + opener effect → E-ENGINE-EFFECT-ON-DERIVED", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty } type Src:enum = { A, B } }
<engine for=Src initial=.A>
  <A rule=.B></>
  <B rule=.A></>
</>
<engine for=Phase derived=@src effect=\${ @x = 1 }>
  <Loading></>
  <Empty></>
</>
</program>`;
    expect(symErrorCodes(src)).toContain("E-ENGINE-EFFECT-ON-DERIVED");
  });

  test("inline-match derived (`derived=match @src {...}`) + opener effect → E-ENGINE-EFFECT-ON-DERIVED", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty } type Src:enum = { A, B } }
<engine for=Src initial=.A>
  <A rule=.B></>
  <B rule=.A></>
</>
<engine for=Phase derived=match @src { .A :> .Loading, .B :> .Empty } effect=\${ @x = 1 }>
  <Loading></>
  <Empty></>
</>
</program>`;
    expect(symErrorCodes(src)).toContain("E-ENGINE-EFFECT-ON-DERIVED");
  });

  test("non-derived engine + opener effect → NO E-ENGINE-EFFECT-ON-DERIVED", () => {
    expect(symErrorCodes(FLAGSHIP_SRC)).not.toContain("E-ENGINE-EFFECT-ON-DERIVED");
  });

  test("derived engine WITHOUT opener effect → NO E-ENGINE-EFFECT-ON-DERIVED (no false-fire)", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty } type Src:enum = { A, B } }
<engine for=Src initial=.A>
  <A rule=.B></>
  <B rule=.A></>
</>
<engine for=Phase derived=@src>
  <Loading></>
  <Empty></>
</>
</program>`;
    expect(symErrorCodes(src)).not.toContain("E-ENGINE-EFFECT-ON-DERIVED");
  });
});

// ---------------------------------------------------------------------------
// §3 — SYM write-validation DEFERRED (B15 raw-text precedent)
// ---------------------------------------------------------------------------

describe("C1 §3 — DEFERRED: opener-effect write checked against .<initial>.rule", () => {
  // §51.0.H Form 3 normative semantics: a `@<engineVar> = .X` write inside the
  // opener effect is statically validated against `.<initial>.rule` (the from-
  // state of the implicit init→initial edge is the initial= variant). The opener
  // effect body is captured as RAW TEXT at SYM (engine-decl.openerEffect), so the
  // write-vs-rule static check has no walkable statement list at the SYM stage —
  // it is DEFERRED, matching the B15 raw-text precedent for state-child bodies.
  // When the check lands, this `.skip` becomes the active assertion: an illegal
  // boot-effect transition (e.g. `@phase = .Saved` where .Saved ∉ .Loading.rule)
  // SHALL fire the engine invalid-transition diagnostic.
  test("illegal boot-effect transition (target ∉ .<initial>.rule) fires invalid-transition", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty, Saved } }
<engine for=Phase initial=.Loading effect=\${ @phase = .Saved }>
  <Loading rule=.Empty></>
  <Empty rule=.Saved></>
  <Saved></>
</>
</program>`;
    // .Saved is NOT in .Loading.rule (.Loading rule=.Empty) — illegal boot write.
    const codes = symErrorCodes(src);
    expect(codes.some((c) => /INVALID-TRANSITION|ENGINE-INVALID/.test(c))).toBe(true);
  });

  // ss2 item 1 — fire-site #11 active cases (§51.0.H Form 3 boot-write validation).

  test("legal boot write (target ∈ single .<initial>.rule) passes — no INVALID-TRANSITION", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty, Saved } }
<engine for=Phase initial=.Loading effect=\${ @phase = .Empty }>
  <Loading rule=.Empty></>
  <Empty rule=.Saved></>
  <Saved></>
</>
</program>`;
    // .Empty IS in .Loading.rule (.Loading rule=.Empty) — legal boot write.
    expect(symErrorCodes(src)).not.toContain("E-ENGINE-INVALID-TRANSITION");
  });

  test("multi-target initial rule, LEGAL boot target → no fire", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty, Editing, Saved } }
<engine for=Phase initial=.Loading effect=\${ @phase = .Editing }>
  <Loading rule=(.Empty | .Editing)></>
  <Empty rule=.Saved></>
  <Editing rule=.Saved></>
  <Saved></>
</>
</program>`;
    // .Editing IS in .Loading.rule=(.Empty | .Editing) — legal.
    expect(symErrorCodes(src)).not.toContain("E-ENGINE-INVALID-TRANSITION");
  });

  test("multi-target initial rule, ILLEGAL boot target → fires INVALID-TRANSITION", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty, Editing, Saved } }
<engine for=Phase initial=.Loading effect=\${ @phase = .Saved }>
  <Loading rule=(.Empty | .Editing)></>
  <Empty rule=.Saved></>
  <Editing rule=.Saved></>
  <Saved></>
</>
</program>`;
    // .Saved is NOT in .Loading.rule=(.Empty | .Editing) — illegal.
    expect(symErrorCodes(src)).toContain("E-ENGINE-INVALID-TRANSITION");
  });

  test("self-write to the initial variant is a NO-OP → no INVALID-TRANSITION fire", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty } }
<engine for=Phase initial=.Loading effect=\${ @phase = .Loading }>
  <Loading rule=.Empty></>
  <Empty></>
</>
</program>`;
    // @phase = .Loading from the boot effect re-enters the initial variant —
    // idempotent no-op per §51.0.F; must NOT fire even though .Loading ∉ its
    // own rule (.Loading rule=.Empty).
    expect(symErrorCodes(src)).not.toContain("E-ENGINE-INVALID-TRANSITION");
  });

  test("derived engine with an illegal-looking boot write fires ONLY E-ENGINE-EFFECT-ON-DERIVED (no boot-write double-fire / no crash)", () => {
    const src = `<program>
\${ type Phase:enum = { Loading, Empty, Saved } type Src:enum = { A, B } }
<engine for=Src initial=.A>
  <A rule=.B></>
  <B rule=.A></>
</>
<engine for=Phase derived=@src effect=\${ @phase = .Saved }>
  <Loading rule=.Empty></>
  <Empty rule=.Saved></>
  <Saved></>
</>
</program>`;
    const codes = symErrorCodes(src);
    // Derived opener effect: E-ENGINE-EFFECT-ON-DERIVED owns this; the boot-write
    // validation MUST be skipped on derived engines (no double-fire).
    expect(codes).toContain("E-ENGINE-EFFECT-ON-DERIVED");
    expect(codes).not.toContain("E-ENGINE-INVALID-TRANSITION");
  });
});

// ---------------------------------------------------------------------------
// §4 — CODEGEN: module-init fire, boot-only, node-check clean, tree-shake
// ---------------------------------------------------------------------------

describe("C1 §4 — CODEGEN: opener effect lowers to a boot-only module-init fire", () => {
  test("non-derived flagship compiles with zero errors", () => {
    const { errors } = compileToClientJs(FLAGSHIP_SRC, "flagship");
    expect(errors).toEqual([]);
  });

  test("emits the §51.0.H Form 3 opener-effect block at module scope (not in a render/wire fn)", () => {
    const { clientJs } = compileToClientJs(FLAGSHIP_SRC, "flagship");
    expect(clientJs).toContain("engine opener effect= boot-init effects");
    expect(clientJs).toContain("§51.0.H Form 3 opener effect= (boot-only init effect): phase");
  });

  test("the boot effect body calls loadTasks() ONCE at module-init (not inside a per-arm handler)", () => {
    const { clientJs } = compileToClientJs(FLAGSHIP_SRC, "flagship");
    // The opener-effect IIFE block.
    const blockStart = clientJs.indexOf("engine opener effect= boot-init effects");
    expect(blockStart).toBeGreaterThan(-1);
    const block = clientJs.slice(blockStart);
    // loadTasks() appears in the boot block.
    expect(block).toContain("loadTasks()");
    // Boot-only invariant: EVERY loadTasks() occurrence is at module-init (the
    // reactive_set + its init-thunk sidecar), NONE inside a per-arm re-entry
    // wire/render handler. The per-fn walk below proves the negative; here we
    // assert the boot block owns the call.
    expect(block).toContain(`_scrml_reactive_set("tasks", loadTasks())`);
    // The boot call is NOT inside any `_scrml_engine_phase_wire_` /
    // `_scrml_engine_phase_render_` function body.
    for (const fnPrefix of ["_scrml_engine_phase_wire_", "_scrml_engine_phase_render_"]) {
      // None of the render/wire fns may contain the loadTasks() boot call.
      // (Walk every such fn occurrence.)
      let from = 0;
      while (true) {
        const fnAt = clientJs.indexOf(`function ${fnPrefix}`, from);
        if (fnAt < 0) break;
        const bodyEnd = clientJs.indexOf("\n}", fnAt);
        const fnBody = clientJs.slice(fnAt, bodyEnd < 0 ? undefined : bodyEnd);
        expect(fnBody).not.toContain("loadTasks()");
        from = fnAt + 1;
      }
    }
  });

  test("cross-variant boot write `@phase = …` lowers to _scrml_engine_direct_set (engine-aware, not bare reactive_set)", () => {
    const { clientJs } = compileToClientJs(FLAGSHIP_SRC, "flagship");
    const blockStart = clientJs.indexOf("engine opener effect= boot-init effects");
    const block = clientJs.slice(blockStart);
    // The boot write routes through the engine transition machinery (rule= /
    // watchdog / hooks), proving emitLogicBody ran with engineBindings threaded.
    expect(block).toContain('_scrml_engine_direct_set("phase"');
    expect(block).toContain("__scrml_engine_phase_transitions");
  });

  test("emitted client.js is `node --check`-clean", () => {
    globalThis.__C1_KEEP__ = true;
    const { clientPath, keepDir } = compileToClientJs(FLAGSHIP_SRC, "flagship-nodecheck");
    try {
      expect(existsSync(clientPath)).toBe(true);
      const res = spawnSync("node", ["--check", clientPath], { encoding: "utf8" });
      expect(res.status).toBe(0);
    } finally {
      globalThis.__C1_KEEP__ = false;
      if (existsSync(keepDir)) rmSync(keepDir, { recursive: true, force: true });
    }
  });

  test("tree-shake: engine with NO opener effect emits ZERO opener-effect code", () => {
    const { clientJs, errors } = compileToClientJs(NO_EFFECT_SRC, "no-effect");
    expect(errors).toEqual([]);
    expect(clientJs).not.toContain("engine opener effect= boot-init effects");
    expect(clientJs).not.toContain("§51.0.H Form 3 opener effect=");
  });
});
