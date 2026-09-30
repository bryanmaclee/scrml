/**
 * Nested <program> Phase 3 — Worker Extraction + Separate Compilation
 *
 * Tests:
 *   §1 Worker extraction: parent AST no longer contains worker children
 *   §2 Worker JS generation: generateWorkerJs produces self.onmessage
 *   §3 send() → self.postMessage() rewrite
 *   §4 Function declarations in worker are included
 *   §5 Shared-nothing: no _scrml_reactive_get in worker JS
 *   §6 workerBundles map: CG output has workerBundles entry
 */

import { describe, test, expect } from "bun:test";
import { runCG } from "../../src/code-generator.js";
import { generateWorkerJs, rewriteWorkerSend, workerBundleFilename } from "../../src/codegen/emit-worker.ts";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeFileAST(filePath, nodes, opts = {}) {
  return {
    filePath,
    nodes,
    imports: opts.imports ?? [],
    exports: opts.exports ?? [],
    components: opts.components ?? [],
    typeDecls: opts.typeDecls ?? [],
    nodeTypes: opts.nodeTypes ?? new Map(),
    componentShapes: opts.componentShapes ?? new Map(),
    scopeChain: opts.scopeChain ?? null,
  };
}

function makeMarkupNode(tag, attrs = [], children = [], opts = {}) {
  return {
    kind: "markup",
    tag,
    attributes: attrs,
    children,
    selfClosing: opts.selfClosing ?? false,
    id: opts.id ?? 1,
    span: span(),
  };
}

function makeAttr(name, value) {
  return { name, value, span: span() };
}

function makeStringLiteral(value) {
  return { kind: "string-literal", value, span: span() };
}

function makeLogicNode(body = []) {
  return { kind: "logic", body, imports: [], exports: [], typeDecls: [], components: [], id: 99, span: span() };
}

function makeWhenMessageNode(binding, bodyRaw) {
  return { kind: "when-message", binding, bodyRaw, id: 100, span: span() };
}

function makeFunctionDecl(name, params = [], body = []) {
  return {
    kind: "function-decl",
    name,
    params,
    body,
    fnKind: "function",
    isServer: false,
    canFail: false,
    id: 101,
    span: span(),
  };
}

// ---------------------------------------------------------------------------
// §1 Worker extraction: parent AST no longer contains worker children
// ---------------------------------------------------------------------------

describe("Worker extraction", () => {
  test("nested <program name=...> is removed from parent AST after CG", () => {
    const workerProgram = makeMarkupNode("program", [
      makeAttr("name", makeStringLiteral("calc")),
    ], [
      { kind: "text", value: "worker content", id: 10, span: span() },
    ], { id: 5 });

    const parentDiv = makeMarkupNode("div", [], [
      { kind: "text", value: "hello", id: 2, span: span() },
    ], { id: 3 });

    const rootProgram = makeMarkupNode("program", [], [
      parentDiv,
      workerProgram,
    ], { id: 1 });

    const fileAST = makeFileAST("/test/app.scrml", [rootProgram]);
    const result = runCG({ files: [fileAST] });

    // The root program's children should no longer contain the worker program
    // (it was spliced out during the pre-pass)
    const rootChildren = rootProgram.children;
    const hasWorkerProgram = rootChildren.some(
      c => c.kind === "markup" && c.tag === "program" &&
        (c.attributes ?? []).some(a => a.name === "name")
    );
    expect(hasWorkerProgram).toBe(false);
    expect(rootChildren.length).toBe(1); // only parentDiv remains
  });
});

// ---------------------------------------------------------------------------
// §2 Worker JS generation: self.onmessage with binding
// ---------------------------------------------------------------------------

describe("Worker JS generation", () => {
  test("generateWorkerJs produces self.onmessage with correct binding", () => {
    const whenMsg = makeWhenMessageNode("data", "console.log(data)");
    const js = generateWorkerJs("calc", [], whenMsg);

    expect(js).toContain("// Generated worker: calc");
    expect(js).toContain("self.onmessage = function(event)");
    // Parent -> worker messages are `{ id, data }` (dpa-056 D2 wire format).
    expect(js).toContain("const _scrml_reply_to = event.data.id;");
    expect(js).toContain("var data = event.data.data;");
    expect(js).toContain("console.log(data)");
  });

  test("generateWorkerJs with no when-message produces no onmessage", () => {
    const js = generateWorkerJs("idle-worker", [], null);
    expect(js).toContain("// Generated worker: idle-worker");
    expect(js).not.toContain("self.onmessage");
  });
});

// ---------------------------------------------------------------------------
// §3 send() → self.postMessage() rewrite
// ---------------------------------------------------------------------------

describe("send() → _scrml_reply(_scrml_reply_to, …) rewrite", () => {
  test("send(result) replies to the message being handled", () => {
    expect(rewriteWorkerSend("send(result)")).toBe("_scrml_reply(_scrml_reply_to, result)");
  });

  test("send ( result ) with spaces", () => {
    expect(rewriteWorkerSend("send ( result )")).toBe("_scrml_reply(_scrml_reply_to, result )");
  });

  test("send() with no argument has no dangling comma", () => {
    expect(rewriteWorkerSend("send()")).toBe("_scrml_reply(_scrml_reply_to)");
  });

  test("resend(x) is NOT rewritten", () => {
    expect(rewriteWorkerSend("resend(x)")).toBe("resend(x)");
  });

  test("a method call socket.send(x) is NOT rewritten", () => {
    expect(rewriteWorkerSend("socket.send(x)")).toBe("socket.send(x)");
  });

  test("multiple send calls are all rewritten", () => {
    expect(rewriteWorkerSend("send(a); send(b)"))
      .toBe("_scrml_reply(_scrml_reply_to, a); _scrml_reply(_scrml_reply_to, b)");
  });

  test("in generateWorkerJs body, send() is rewritten and _scrml_reply is defined", () => {
    const whenMsg = makeWhenMessageNode("n", "let r = n * 2\nsend(r)");
    const js = generateWorkerJs("doubler", [], whenMsg);
    expect(js).toContain("_scrml_reply(_scrml_reply_to, r)");
    expect(js).toContain("function _scrml_reply(replyTo, data) {");
    expect(js).toContain("self.postMessage({ replyTo: replyTo, data: data });");
    expect(js).not.toMatch(/(?<![\w$.])send\s*\(/);
  });
});

describe("worker bundle filename", () => {
  test("is <page>-<name>.worker.js", () => {
    expect(workerBundleFilename("/app/pages/tools/calc.scrml", "dbl")).toBe("calc-dbl.worker.js");
  });

  test("a worker named `server` / `sqlite` stays out of the §47.13 denied classes", () => {
    expect(workerBundleFilename("app.scrml", "server")).not.toContain(".server.");
    expect(workerBundleFilename("app.scrml", "sqlite")).not.toContain(".sqlite");
  });
});

// ---------------------------------------------------------------------------
// §4 Function declarations in worker are included
// ---------------------------------------------------------------------------

describe("Function declarations in worker", () => {
  test("function-decl inside worker logic block is emitted", () => {
    const fnDecl = makeFunctionDecl("fib", ["n"], [
      { kind: "bare-expr", expr: "n <= 1 ? n : fib(n - 1) + fib(n - 2)", id: 102, span: span() },
    ]);
    const logicNode = makeLogicNode([fnDecl]);
    const whenMsg = makeWhenMessageNode("n", "send(fib(n))");

    const js = generateWorkerJs("fib-worker", [logicNode], whenMsg);
    expect(js).toContain("function fib(n)");
    expect(js).toContain("self.onmessage");
  });
});

// ---------------------------------------------------------------------------
// §5 Shared-nothing: no reactive runtime in worker JS
// ---------------------------------------------------------------------------

describe("Shared-nothing isolation", () => {
  test("worker JS does not contain _scrml_reactive_get", () => {
    const whenMsg = makeWhenMessageNode("data", "send(data + 1)");
    const js = generateWorkerJs("pure-worker", [], whenMsg);
    expect(js).not.toContain("_scrml_reactive_get");
    expect(js).not.toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// §6 workerBundles map: CG output has entry for worker name
// ---------------------------------------------------------------------------

describe("workerBundles in CG output", () => {
  test("CG output includes workerBundles with worker name key", () => {
    const whenMsg = makeWhenMessageNode("payload", "send(payload.toUpperCase())");
    const logicNode = makeLogicNode([whenMsg]);

    const workerProgram = makeMarkupNode("program", [
      makeAttr("name", makeStringLiteral("uppercaser")),
    ], [logicNode], { id: 5 });

    const rootProgram = makeMarkupNode("program", [], [
      makeMarkupNode("div", [], [
        { kind: "text", value: "hello", id: 20, span: span() },
      ], { id: 3 }),
      workerProgram,
    ], { id: 1 });

    const fileAST = makeFileAST("/test/app.scrml", [rootProgram]);
    const result = runCG({ files: [fileAST] });
    const output = result.outputs.get("/test/app.scrml");

    expect(output).toBeDefined();
    expect(output.workerBundles).toBeDefined();
    expect(output.workerBundles).toBeInstanceOf(Map);
    expect(output.workerBundles.has("uppercaser")).toBe(true);

    const workerJs = output.workerBundles.get("uppercaser");
    expect(workerJs).toContain("self.onmessage");
    expect(workerJs).toContain("var payload = event.data.data");
    expect(workerJs).toContain("_scrml_reply(_scrml_reply_to, payload.toUpperCase())");
  });

  test("worker HTML is not emitted into parent output", () => {
    const workerProgram = makeMarkupNode("program", [
      makeAttr("name", makeStringLiteral("hidden-worker")),
    ], [
      { kind: "text", value: "SHOULD NOT APPEAR", id: 10, span: span() },
    ], { id: 5 });

    const rootProgram = makeMarkupNode("program", [], [
      makeMarkupNode("p", [], [
        { kind: "text", value: "visible", id: 20, span: span() },
      ], { id: 3 }),
      workerProgram,
    ], { id: 1 });

    const fileAST = makeFileAST("/test/app.scrml", [rootProgram]);
    const result = runCG({ files: [fileAST] });
    const output = result.outputs.get("/test/app.scrml");

    expect(output.html).toContain("visible");
    expect(output.html).not.toContain("SHOULD NOT APPEAR");
  });
});
