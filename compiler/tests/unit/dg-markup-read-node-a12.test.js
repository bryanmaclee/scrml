/**
 * dg-markup-read-node-a12.test.js — A-1.2 scaffolding gate tests.
 *
 * Verifies that the `markup-read` DG node kind (Option Y, SPEC §40.9.3) is
 * correctly defined and that the A-1.2 scaffold functions behave as specified:
 *
 *   - The MarkupReadDGNode kind field is the string literal "markup-read".
 *   - createMarkupReadNode factory returns a correctly-shaped node with a
 *     unique nodeId on each call.
 *   - findOwningRenderDGNode locates the tightest enclosing render DGNode by
 *     span containment, including a nested (inner) markup block preference.
 *   - T4 (end-to-end zero-emission): was meaningful in A-1.2 when the flag was
 *     false. In A-1.3 markupContextEmitEdges is flipped to true — markup-read
 *     nodes ARE now emitted for the 4 high-frequency shapes. T4 now confirms
 *     only that compilation succeeds without fatal errors (depGraph is not
 *     exposed on the compileScrml result, so the nodes check is a no-op).
 *     Full emission coverage is in dg-markup-read-emission-a13.test.js.
 *
 * Spec authority: SPEC §40.9.3 (markup-context edge emission requirement),
 *   §31 (DG normative), §34 (error catalog).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import {
  createMarkupReadNode,
  findOwningRenderDGNode,
} from "../../src/dependency-graph.ts";
import { compileScrml } from "../../src/api.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/dg-markup-read-node-a12");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  return compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: true });
}

// ---------------------------------------------------------------------------
// T1 — node kind constant shape
// ---------------------------------------------------------------------------

describe("A-1.2: MarkupReadDGNode kind constant", () => {
  test("T1: createMarkupReadNode returns kind === 'markup-read'", () => {
    // Confirms the kind string literal is exactly what Option Y specified.
    const span = { start: 0, end: 10 };
    const { dgNode } = createMarkupReadNode(span, null, "test.scrml");
    expect(dgNode.kind).toBe("markup-read");
  });

  test("T1b: MarkupReadDGNode carries all required fields", () => {
    const span = { start: 5, end: 20 };
    const ownerScope = "src/page.scrml";
    const renderNodeId = "render::src/page.scrml::0::1";
    const { nodeId, dgNode } = createMarkupReadNode(span, renderNodeId, ownerScope);

    expect(typeof nodeId).toBe("string");
    expect(nodeId.startsWith("markup-read::")).toBe(true);
    expect(dgNode.nodeId).toBe(nodeId);
    expect(dgNode.kind).toBe("markup-read");
    expect(dgNode.sourceRenderNodeId).toBe(renderNodeId);
    expect(dgNode.ownerScope).toBe(ownerScope);
    expect(dgNode.hasLift).toBe(false);
    expect(dgNode.span).toEqual(span);
  });
});

// ---------------------------------------------------------------------------
// T2 — factory uniqueness
// ---------------------------------------------------------------------------

describe("A-1.2: createMarkupReadNode factory produces unique nodeIds", () => {
  test("T2: two calls with different spans produce distinct nodeIds", () => {
    const spanA = { start: 10, end: 20 };
    const spanB = { start: 30, end: 40 };
    const { nodeId: idA } = createMarkupReadNode(spanA, null, "test.scrml");
    const { nodeId: idB } = createMarkupReadNode(spanB, null, "test.scrml");
    expect(idA).not.toBe(idB);
  });

  test("T2b: two calls with IDENTICAL spans still produce distinct nodeIds", () => {
    // The _nodeCounter suffix guarantees uniqueness even when span and
    // ownerScope are the same — important for two interpolations on the same
    // line of source code.
    const span = { start: 42, end: 55 };
    const { nodeId: idA } = createMarkupReadNode(span, null, "same.scrml");
    const { nodeId: idB } = createMarkupReadNode(span, null, "same.scrml");
    expect(idA).not.toBe(idB);
  });
});

// ---------------------------------------------------------------------------
// T3 — findOwningRenderDGNode span resolution
// ---------------------------------------------------------------------------

describe("A-1.2: findOwningRenderDGNode span-containment logic", () => {
  // Build a minimal DGNode Map with two RenderDGNodes — an outer block and
  // an inner (nested) block — to verify tightest-match preference.
  function makeRenderNode(id, start, end) {
    return {
      kind: "render",
      nodeId: id,
      markupNodeId: id,
      hasLift: false,
      span: { start, end },
    };
  }

  function makeInterpolationNode(start, end) {
    // Represents an interpolation AST node (any node kind works here; only
    // span is used by findOwningRenderDGNode).
    return {
      kind: "bare-expr",
      span: { start, end },
    };
  }

  test("T3: returns null when nodes map is empty", () => {
    const astNode = makeInterpolationNode(5, 10);
    const result = findOwningRenderDGNode(astNode, new Map());
    expect(result).toBeNull();
  });

  test("T3b: returns null when no render node encloses the interpolation", () => {
    // Render node is at chars 0-20; interpolation is at chars 30-40 (outside).
    const dgNodes = new Map([["r1", makeRenderNode("r1", 0, 20)]]);
    const astNode = makeInterpolationNode(30, 40);
    const result = findOwningRenderDGNode(astNode, dgNodes);
    expect(result).toBeNull();
  });

  test("T3c: returns the single enclosing render node when there is only one", () => {
    // Render block 0-100; interpolation at 20-30.
    const dgNodes = new Map([["r1", makeRenderNode("r1", 0, 100)]]);
    const astNode = makeInterpolationNode(20, 30);
    const result = findOwningRenderDGNode(astNode, dgNodes);
    expect(result).toBe("r1");
  });

  test("T3d: returns the TIGHTEST (innermost) enclosing render node for nested blocks", () => {
    // Outer render: 0-200; Inner render: 50-150; Interpolation: 80-90.
    // Both outer and inner enclose the interpolation; inner is tighter.
    const dgNodes = new Map([
      ["outer", makeRenderNode("outer", 0, 200)],
      ["inner", makeRenderNode("inner", 50, 150)],
    ]);
    const astNode = makeInterpolationNode(80, 90);
    const result = findOwningRenderDGNode(astNode, dgNodes);
    expect(result).toBe("inner");
  });

  test("T3e: ignores non-render DGNode kinds (function, reactive, meta)", () => {
    // The DGNode map contains a function node and a reactive node that happen
    // to have spans that would enclose the interpolation. Neither should be
    // returned — only render-kind nodes are candidates.
    const fnNode = {
      kind: "function",
      nodeId: "fn1",
      boundary: "client",
      hasLift: false,
      span: { start: 0, end: 500 },
    };
    const reactiveNode = {
      kind: "reactive",
      nodeId: "cell1",
      varName: "counter",
      hasLift: false,
      span: { start: 0, end: 500 },
    };
    const dgNodes = new Map([
      ["fn1", fnNode],
      ["cell1", reactiveNode],
    ]);
    const astNode = makeInterpolationNode(10, 20);
    const result = findOwningRenderDGNode(astNode, dgNodes);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T4 — end-to-end: compilation invariants (A-1.2: zero markup-read nodes; A-1.3: emission active)
// ---------------------------------------------------------------------------

describe("A-1.2: end-to-end compilation invariants (A-1.3: flag now active, depGraph not exposed)", () => {
  test("T4: compilation with markup interpolations produces zero fatal errors", () => {
    // This source has three ${@x} markup reads, an if= attribute read, and
    // a bind:value= read — all the surfaces enumerated in SPEC §40.9.3 as
    // "unlifted markup reads" (256 in corpus).
    //
    // A-1.2: With markupContextEmitEdges=false (A-1.2), the DG output contained
    // no "markup-read" nodes.
    // A-1.3 UPDATE: markupContextEmitEdges is now true — the 4 high-frequency
    // shapes DO emit markup-read nodes. The nodes.size check below is a NO-OP
    // because compileScrml does not expose depGraph on its return value. Full
    // markup-read node/edge assertions are in dg-markup-read-emission-a13.test.js.
    const source = [
      "${",
      "  <counter> = 0",
      "  <label> = \"hello\"",
      "}",
      "",
      "<program>",
      "  <p>Count: ${@counter}</>",
      "  <p if=(@counter > 0)>Positive</>",
      "  <input bind:value=@label>",
      "  <p>Label is ${@label} and count is ${@counter}</>",
      "</>",
      "",
    ].join("\n");

    const result = compileSource(source, "t4-markup-interpolations.scrml");

    // A-1.2: no fatal errors expected.
    const fatalErrors = result.errors || [];
    expect(fatalErrors).toEqual([]);

    // The depGraph is available on result when the compiler exposes it.
    // If exposed, assert zero markup-read nodes.
    // If not yet exposed on result, the test confirms absence of new errors,
    // which is the behavioral-no-change requirement for A-1.2.
    if (result.depGraph && result.depGraph.nodes) {
      const markupReadNodes = [];
      for (const [, node] of result.depGraph.nodes) {
        if (node.kind === "markup-read") markupReadNodes.push(node);
      }
      expect(markupReadNodes).toHaveLength(0);
    }
    // Either path confirms A-1.2 behavioral-no-change guarantee.
  });

  test("T4b: E-DG-002 still fires correctly — no regression from scaffolding", () => {
    // If the scaffold accidentally emitted markup-read nodes as readers of
    // reactive cells, it would suppress E-DG-002 on unused cells. Verify
    // that a cell with no readers still produces the warning.
    //
    // Important: the paragraph text must NOT contain the string "@unused",
    // because the markup-sweep regex scanner credits any @varname it finds
    // in text content. This test uses plain text that does not reference the
    // cell — guaranteeing the cell remains truly unread.
    const source = [
      "${",
      "  <unused> = 42",
      "}",
      "",
      "<program>",
      "  <p>This paragraph does not reference the cell at all.</>",
      "</>",
      "",
    ].join("\n");

    const result = compileSource(source, "t4b-no-regression.scrml");
    const warnings = result.warnings || [];
    const edg002 = warnings.find(
      (w) => w.code === "E-DG-002" && /`@unused`/.test(w.message),
    );
    // E-DG-002 must still fire — the scaffold must not have credited the
    // unused cell as having a reader.
    expect(edg002).toBeDefined();
  });
});
