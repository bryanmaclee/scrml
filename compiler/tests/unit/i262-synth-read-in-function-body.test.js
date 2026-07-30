/**
 * i262-synth-read-in-function-body.test.js — GH #262 regression
 *
 * Bug 61 (RESOLVED S140) collapsed an EXPRESSION-position `@<compound>.<synthProp>`
 * read (isValid / errors / touched / submitted) to the dotted synth cell
 * (`_scrml_reactive_get("f.isValid")`) instead of member access on the compound
 * VALUE object (`_scrml_reactive_get("f").isValid` → `undefined`). But the fix
 * only reached the contexts that thread `synthCellKeys` — the markup-binding and
 * event-wiring emitters. A read inside a PLAIN `function` body is emitted by
 * `scheduleStatements` (emit-functions.ts), whose emit opts never carried
 * `synthCellKeys`, so a function-body read fell back to member access.
 *
 * GH #262 (adopter DanceCard): the canonical Shape-2 form's submit guard
 * `if (!@f.isValid) return` therefore read `get("f").isValid` → `undefined`,
 * `!undefined` → true, and the guard returned on EVERY call — the form could
 * never be submitted (fails closed, completely silent: the submit event fired,
 * the handler ran, preventDefault, then returned at the guard; zero network,
 * no error). Meanwhile the SAME surface in binding position
 * (`disabled=!@f.isValid`) correctly read `get("f.isValid")`.
 *
 * Fix: thread `ctx.synthCellKeys` into `scheduleStatements` -> `emitOpts` (+ the
 * two CPS/failable-body opts) so `emitMember`'s Bug-61 collapse fires in
 * function bodies too. The membership gate (`synthCellKeys.has(dotted)`) is
 * preserved, so a plain cell whose field is merely NAMED like a synth prop still
 * reads as member access (the S140 over-fire guard — asserted below).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { runTS } from "../../src/type-system.ts";
import { runRI } from "../../src/route-inference.js";
import { runCG } from "../../src/code-generator.js";
import { foldChunkAccessors } from "../helpers/chunk-scope.js";

/** Compile a full scrml source string through the front-end + codegen and
 *  return the (chunk-folded) client JS. */
function compileClient(source, filePath = "/test/i262.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const fileAST = { filePath, ...ast };
  runSYM({ filePath, ast: fileAST });
  runTS({ files: [fileAST] });
  let routeMap = { functions: new Map() };
  let depGraph = { nodes: new Map(), edges: [] };
  try {
    const ri = runRI({ files: [fileAST] });
    routeMap = ri.routeMap ?? routeMap;
    depGraph = ri.depGraph ?? depGraph;
  } catch { /* client-only form needs no route inference */ }
  const cg = runCG({ files: [fileAST], routeMap, depGraph, protectAnalysis: { views: new Map() } });
  const out = cg.outputs.get(filePath) ?? [...cg.outputs.values()][0];
  return { clientJs: foldChunkAccessors(out.clientJs), errors: cg.errors ?? [] };
}

// The GH #262 minimal repro, verbatim.
const I262_SOURCE = `<page>
  \${
      <f>
          <email req> = <input type="email"/>
      </>
      <log> = ""
      function submit() {
          if (!@f.isValid) return
          @log = "submitted"
      }
  }
  <form onsubmit=submit()>
    <input type="email" bind:value=@f.email/>
    <button type="submit" disabled=!@f.isValid>Go</button>
  </form>
  <p>\${@log}</p>
</page>`;

describe("GH #262 — synth-surface read in a function body collapses to the dotted cell", () => {
  test("the submit-guard `@f.isValid` reads the dotted synth cell, NOT member access on the group", () => {
    const { clientJs, errors } = compileClient(I262_SOURCE);
    expect(errors.filter(e => e.severity !== "warning")).toHaveLength(0);
    // The bug: `_scrml_reactive_get("f").isValid` (member access → undefined).
    expect(clientJs).not.toContain('_scrml_reactive_get("f").isValid');
    // The fix: the flat dotted synth-cell read (resolves to the derived cell).
    expect(clientJs).toContain('_scrml_reactive_get("f.isValid")');
  });

  test("expression and binding positions now emit the SAME read for `@f.isValid`", () => {
    const { clientJs } = compileClient(I262_SOURCE);
    // binding position (`disabled=!@f.isValid`) always read the dotted cell;
    // the function-body guard must now match it — no member-access form anywhere.
    const memberAccess = (clientJs.match(/_scrml_reactive_get\("f"\)\.isValid/g) || []).length;
    const dottedRead = (clientJs.match(/_scrml_reactive_get\("f\.isValid"\)/g) || []).length;
    expect(memberAccess).toBe(0);
    expect(dottedRead).toBeGreaterThanOrEqual(2); // guard + disabled= binding
  });
});

describe("GH #262 — sibling shapes in function bodies collapse across the whole synth surface", () => {
  const SIBLINGS = `<page>
  \${
      <f>
          <email req> = <input type="email"/>
      </>
      <out> = ""
      function a() { @out = @f.isValid ? "v" : "x" }
      function b() { if (@f.email.isValid) @out = "e" }
      function c() { @out = @f.errors.length + "" }
  }
  <button onclick=a()>a</button>
  <p>\${@out}</p>
</page>`;

  test("ternary / per-field / call-arg synth reads all use the dotted cell", () => {
    const { clientJs } = compileClient(SIBLINGS);
    expect(clientJs).toContain('_scrml_reactive_get("f.isValid")');       // ternary, compound-level
    expect(clientJs).toContain('_scrml_reactive_get("f.email.isValid")'); // per-field (3-segment)
    expect(clientJs).toContain('_scrml_reactive_get("f.errors")');        // errors surface
    // no member-access fallback for any of them
    expect(clientJs).not.toContain('_scrml_reactive_get("f").isValid');
    expect(clientJs).not.toContain('_scrml_reactive_get("f").errors');
    expect(clientJs).not.toContain('_scrml_reactive_get("f").email');
  });
});

describe("GH #262 — `fn` shorthand + return-typed `function` bodies (bypass scheduleStatements)", () => {
  // These bodies are emitted by emitFnShortcutBody (NOT scheduleStatements), so
  // they need synthCellKeys threaded into `fnOpts` independently. Caught by the
  // adversarial under-fire review of the first cut.
  const FN_SHAPES = `<page>
  \${
      <f>
          <email req> = <input type="email"/>
      </>
      fn retTyped() -> bool { @f.isValid }
      fn perField() -> bool { @f.email.isValid }
      function isReady(): bool { @f.isValid }
  }
  <p>ok</p>
</page>`;

  test("`fn` shorthand + return-typed `function` collapse synth reads to the dotted cell", () => {
    const { clientJs } = compileClient(FN_SHAPES);
    expect(clientJs).toContain('_scrml_reactive_get("f.isValid")');
    expect(clientJs).toContain('_scrml_reactive_get("f.email.isValid")');
    expect(clientJs).not.toContain('_scrml_reactive_get("f").isValid');
    expect(clientJs).not.toContain('_scrml_reactive_get("f").email');
  });
});

describe("GH #262 — over-fire guard (S140): a plain cell with synth-named fields stays member access", () => {
  const PLAIN = `<page>
  \${
      <config> = { errors: ["boot"], isValid: false, touched: true }
      <out> = ""
      function inspect() {
          if (@config.isValid) @out = "cfg"
          @out = @config.errors.length + ""
          @out = @config.touched ? "t" : "f"
      }
  }
  <button onclick=inspect()>go</button>
  <p>\${@out}</p>
</page>`;

  test("`@config.isValid` / `.errors` / `.touched` on a NON-form cell read as member access", () => {
    const { clientJs } = compileClient(PLAIN);
    // config is a plain object cell; its fields are NOT registered synth cells,
    // so the reads must stay member access on the value object.
    expect(clientJs).toContain('_scrml_reactive_get("config").isValid');
    expect(clientJs).toContain('_scrml_reactive_get("config").errors');
    expect(clientJs).toContain('_scrml_reactive_get("config").touched');
    // and must NOT be collapsed to a (non-existent) dotted key.
    expect(clientJs).not.toContain('_scrml_reactive_get("config.isValid")');
    expect(clientJs).not.toContain('_scrml_reactive_get("config.errors")');
  });
});
