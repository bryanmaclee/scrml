/**
 * Nested <program> Phase 4 — Worker IPC (§4.12.4)
 *
 * Tests:
 *   §A  rewriteWorkerRefs: <#name>.send(expr) → _scrml_worker_name.send(expr)
 *   §B  rewriteExpr propagates worker ref rewrite
 *   §C  Worker instantiation in client JS
 *   §D  <#name>.send() doesn't interfere with <#id> input state refs
 *   §E  tokenizeAttributes handles <#name>.send() in attribute value position
 */

import { describe, test, expect } from "bun:test";
import { rewriteWorkerRefs, rewriteExpr } from "../../src/codegen/rewrite.ts";
import { generateClientJs } from "../../src/codegen/emit-client.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { tokenizeAttributes } from "../../src/tokenizer.js";

describe("§A rewriteWorkerRefs (§4.12.4)", () => {
  test("<#calc>.send(5) → _scrml_worker_calc.send(5)", () => {
    const result = rewriteWorkerRefs("<#calc>.send(5)");
    expect(result).toBe("_scrml_worker_calc.send(5)");
  });

  test("<#heavyCompute>.send(data) with spaces", () => {
    const result = rewriteWorkerRefs("<#heavyCompute> . send ( data )");
    expect(result).toContain("_scrml_worker_heavyCompute.send(");
  });

  test("no-op when no <# pattern", () => {
    const result = rewriteWorkerRefs("x + y");
    expect(result).toBe("x + y");
  });

  test("does not rewrite <#id> without .send()", () => {
    const result = rewriteWorkerRefs("<#keyboard>");
    expect(result).toBe("<#keyboard>");
  });
});

describe("§B rewriteExpr propagates worker ref rewrite", () => {
  test("<#doubler>.send(@count) rewrites both worker ref and reactive var", () => {
    const result = rewriteExpr("<#doubler>.send(@count)");
    expect(result).toContain("_scrml_worker_doubler.send(");
    expect(result).toContain('_scrml_reactive_get("count")');
  });

  test("await <#calc>.send(5) rewrites correctly", () => {
    const result = rewriteExpr("await <#calc>.send(5)");
    expect(result).toContain("_scrml_worker_calc.send(5)");
    expect(result).toContain("await");
  });
});

describe("§C Worker instantiation in client JS", () => {
  test("workerNames produces new Worker() + .send() wrapper", () => {
    const fileAST = { filePath: "test.scrml", nodes: [], typeDecls: [] };
    const js = generateClientJs({
      filePath: "test.scrml",
      fileAST,
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectedFields: new Set(),
      authMiddleware: null,
      middlewareConfig: null,
      csrfEnabled: false,
      encodingCtx: null,
      mode: "browser",
      testMode: false,
      dbVar: "_scrml_db",
      workerNames: ["calc", "doubler"],
      errors: [],
      registry: new BindingRegistry(),
      derivedNames: new Set(),
      usedRuntimeChunks: new Set(['core', 'scope', 'errors', 'transitions']),
    });
    // `<sourceBase>.<workerName>.worker.js` — the fixture's fileAST.filePath is
    // `test.scrml`. The source-base prefix keeps two sibling pages that each
    // declare a same-named worker from colliding on one dist path (E-CG-015);
    // `api.js` writes each bundle at exactly this name.
    expect(js).toContain('new Worker("test.calc.worker.js")');
    expect(js).toContain('new Worker("test.doubler.worker.js")');
    expect(js).toContain("_scrml_worker_calc.send = function(data)");
    expect(js).toContain("_scrml_worker_doubler.send = function(data)");
    expect(js).toContain("new Promise");
    expect(js).toContain("postMessage(data)");
  });

  test("no workerNames produces no worker code", () => {
    const fileAST = { filePath: "test.scrml", nodes: [], typeDecls: [] };
    const js = generateClientJs({
      filePath: "test.scrml",
      fileAST,
      routeMap: { functions: new Map() },
      depGraph: { nodes: new Map(), edges: [] },
      protectedFields: new Set(),
      authMiddleware: null,
      middlewareConfig: null,
      csrfEnabled: false,
      encodingCtx: null,
      mode: "browser",
      testMode: false,
      dbVar: "_scrml_db",
      workerNames: [],
      errors: [],
      registry: new BindingRegistry(),
      derivedNames: new Set(),
      usedRuntimeChunks: new Set(['core', 'scope', 'errors', 'transitions']),
    });
    expect(js).not.toContain("_scrml_worker_");
    expect(js).not.toContain("new Worker");
  });
});

describe("§D <#name>.send() does not interfere with <#id> input state refs", () => {
  test("<#keyboard> still rewrites to input state registry", () => {
    const result = rewriteExpr("<#keyboard>");
    expect(result).toContain("_scrml_input_state_registry");
    expect(result).not.toContain("_scrml_worker_");
  });

  test("mixed: <#calc>.send(5) + <#keyboard> in same expression", () => {
    const result = rewriteExpr("<#calc>.send(<#keyboard>.x)");
    expect(result).toContain("_scrml_worker_calc.send(");
    expect(result).toContain("_scrml_input_state_registry");
  });
});

describe("§E tokenizeAttributes handles <#name> in attribute value position", () => {
  test("onclick=<#calc>.send(5) → ATTR_CALL with worker name and numeric arg", () => {
    const raw = "<button onclick=<#calc>.send(5)>";
    const tokens = tokenizeAttributes(raw, 0, 1, 1, "markup");
    const call = tokens.find(t => t.kind === "ATTR_CALL");
    expect(call).toBeDefined();
    const parsed = JSON.parse(call.text);
    expect(parsed.name).toBe("_scrml_worker_calc.send");
    expect(parsed.args).toBe("5");
  });

  test("onclick=<#calc>.send(@count) → ATTR_CALL preserves reactive ref in args", () => {
    const raw = "<button onclick=<#calc>.send(@count)>";
    const tokens = tokenizeAttributes(raw, 0, 1, 1, "markup");
    const call = tokens.find(t => t.kind === "ATTR_CALL");
    expect(call).toBeDefined();
    const parsed = JSON.parse(call.text);
    expect(parsed.name).toBe("_scrml_worker_calc.send");
    expect(parsed.args).toBe("@count");
  });

  test("onclick=<#heavyCompute>.send({value: 5}) → ATTR_CALL with object arg", () => {
    const raw = "<button onclick=<#heavyCompute>.send({value: 5})>";
    const tokens = tokenizeAttributes(raw, 0, 1, 1, "markup");
    const call = tokens.find(t => t.kind === "ATTR_CALL");
    expect(call).toBeDefined();
    const parsed = JSON.parse(call.text);
    expect(parsed.name).toBe("_scrml_worker_heavyCompute.send");
    expect(parsed.args).toBe("{value: 5}");
  });

  test("<#name> standalone in attribute value → ATTR_IDENT for input state ref", () => {
    const raw = "<div data-state=<#keyboard>>";
    const tokens = tokenizeAttributes(raw, 0, 1, 1, "markup");
    const ident = tokens.find(t => t.kind === "ATTR_IDENT");
    expect(ident).toBeDefined();
    expect(ident.text).toBe("_scrml_input_keyboard_");
  });

  test("<#calc>.send() does not produce an orphan ATTR_NAME 'calc'", () => {
    const raw = "<button onclick=<#calc>.send(5)>";
    const tokens = tokenizeAttributes(raw, 0, 1, 1, "markup");
    const orphanCalc = tokens.find(t => t.kind === "ATTR_NAME" && t.text === "calc");
    expect(orphanCalc).toBeUndefined();
  });
});
