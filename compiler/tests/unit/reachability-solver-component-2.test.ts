/**
 * Reachability Solver — Component 2 conformance suite.
 *
 * S90 wave A-2.3 — exercises `reactive_dep_closure` per SPEC §40.9.3
 * via the full `runReachabilitySolver` entry point.
 *
 * Each test constructs:
 *   1. A synthetic FileAST whose program body contains a single
 *      markup node (the component AST id under test).
 *   2. A synthetic DG containing the matching RenderDGNode, the
 *      MarkupReadDGNode intermediary, the ReactiveDGNode target(s),
 *      and the reactive-dep edge set under test.
 *
 * The DG is duck-typed at the boundary — Component 2's
 * `ReadOnlyDependencyGraph` consumes only `nodes: Map` + `edges: []`,
 * matching the dependency-graph.ts internal shape verbatim. We
 * build the DG by hand rather than round-tripping the full Stage 7
 * pipeline so the closure semantics are exercised in isolation.
 *
 * Coverage (12 scenarios per SCOPING §A-2.3):
 *   §1  Simple reactive read: component reads @x → closure includes @x.
 *   §2  Chained reads: component reads @a; @a reads @b → both admitted.
 *   §3  Validator-reads chain: component reads @x; @x's validator
 *       references @other → @other admitted.
 *   §4  Engine-derived-reads chain: derived engine cell reads
 *       @source → @source admitted.
 *   §5  Dynamic-key admission: receiver expansion semantics
 *       (current pass-through behavior; future hook lands the
 *       worst-case-union once A-1 tags dynamic-key sites).
 *   §6  Markup-read intermediary NOT in output: closure result
 *       excludes markup-read DG node ids.
 *   §7  Cycle handling: A reads B reads A (transitive); walker
 *       terminates; both admitted.
 *   §8  Multi-component input: C = {compA, compB} — closure unions
 *       both components' reads.
 *   §9  No reads: component with no reactive reads → empty closure.
 *   §10 Cross-file reactive read: component reads cell whose DG node
 *       lives in a different file's DG slice → closure includes it
 *       (DG is per-compile-unit, files share the node map).
 *   §11 Channel-cell reads: component reads a reactive cell scoped
 *       to a channel — closure includes the channel cell (DG-shape-
 *       equivalent to ordinary reactive read for Component 2).
 *   §12 Engine state-child arm-body reads: arm body references
 *       @cell via A-1.5 emission → closure includes @cell.
 *
 * Test file constructs both the FileAST AND the DG so the
 * `runReachabilitySolver` entry point is exercised end-to-end with
 * Component 2's substrate input.
 */

import { describe, test, expect } from "bun:test";
import { runReachabilitySolver } from "../../src/reachability-solver.ts";
import type {
  ASTNode,
  AttrNode,
  FileAST,
  MarkupNode,
  Span,
} from "../../src/types/ast.ts";

// ---------------------------------------------------------------------------
// Synthetic AST builders (mirrors reachability-solver-component-1.test.ts)
// ---------------------------------------------------------------------------

const SPAN: Span = { file: "t.scrml", start: 0, end: 0, line: 1, col: 1 };

let nextId = 1;
function nid(): number { return nextId++; }

function markup(tag: string, attrs: AttrNode[] = [], children: ASTNode[] = []): MarkupNode {
  return {
    id: nid(),
    span: SPAN,
    kind: "markup",
    tag,
    attrs,
    children,
    selfClosing: false,
    closerForm: `</${tag}>`,
    isComponent: false,
  };
}

function file(filePath: string, nodes: ASTNode[]): FileAST {
  return {
    filePath, nodes,
    imports: [], exports: [], components: [], typeDecls: [],
    spans: {},
    hasProgramRoot: nodes.some(n => n && (n as MarkupNode).tag === "program"),
    authConfig: null, middlewareConfig: null,
  };
}

// ---------------------------------------------------------------------------
// Synthetic DG builders
// ---------------------------------------------------------------------------
//
// Mirrors the DGNode + DGEdge shapes in compiler/src/dependency-graph.ts.
// Build by hand so each test can exercise specific edge configurations.

type DGNode =
  | { kind: "render";       nodeId: string; markupNodeId: string; hasLift: boolean; span: Span }
  | { kind: "markup-read";  nodeId: string; sourceRenderNodeId: string | null; ownerScope: string; hasLift: boolean; span: Span }
  | { kind: "reactive";     nodeId: string; varName: string; hasLift: boolean; span: Span }
  | { kind: "function";     nodeId: string; boundary: "client" | "server"; hasLift: boolean; span: Span };

interface DGEdge { from: string; to: string; kind: string; }

interface SyntheticDG {
  nodes: Map<string, DGNode>;
  edges: DGEdge[];
}

function makeDG(): SyntheticDG {
  return { nodes: new Map(), edges: [] };
}

function renderNode(astId: number): DGNode {
  return {
    kind: "render",
    nodeId: `render:${astId}`,
    markupNodeId: String(astId),
    hasLift: false,
    span: SPAN,
  };
}

function markupReadNode(id: string, sourceRender: string | null): DGNode {
  return {
    kind: "markup-read",
    nodeId: `mr:${id}`,
    sourceRenderNodeId: sourceRender,
    ownerScope: "t.scrml",
    hasLift: false,
    span: SPAN,
  };
}

function reactiveNode(varName: string): DGNode {
  return {
    kind: "reactive",
    nodeId: `reactive:${varName}`,
    varName,
    hasLift: false,
    span: SPAN,
  };
}

function addNode(dg: SyntheticDG, node: DGNode): DGNode {
  dg.nodes.set(node.nodeId, node);
  return node;
}

function edge(dg: SyntheticDG, from: string, to: string, kind: string): void {
  dg.edges.push({ from, to, kind });
}

function runOne(files: FileAST[], depGraph: SyntheticDG | null) {
  // The RSInput type accepts any DG shape; component-2 duck-types on
  // `nodes` + `edges`. Cast through unknown to satisfy the RSInput
  // strict-typed boundary while preserving the SyntheticDG shape.
  return runReachabilitySolver({ depGraph: depGraph as unknown as never, files });
}

function firstPlan(record: ReturnType<typeof runOne>["record"]) {
  const [, rps] = record.closures.entries().next().value;
  return rps.byRole.get("_anonymous")!;
}

// ---------------------------------------------------------------------------
// §1 — Simple reactive read
// ---------------------------------------------------------------------------

describe("§1 simple reactive read", () => {
  test("component reads @x → closure includes @x", () => {
    const compM = markup("h1");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t1.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("x-at-h1", r.nodeId));
    const rx = addNode(dg, reactiveNode("x"));
    edge(dg, mr.nodeId, rx.nodeId, "reads");

    const { record, errors } = runOne([f], dg);
    expect(errors).toEqual([]);
    const plan = firstPlan(record);
    expect(plan.initialChunk.reactiveCellNodeIds.has(rx.nodeId)).toBe(true);
    expect(plan.initialChunk.reactiveCellNodeIds.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §2 — Chained reads: component reads @a; @a derived from @b
// ---------------------------------------------------------------------------

describe("§2 chained reads (A reads B; B reads C)", () => {
  test("component reads @a; @a reads @b; @b reads @c → all three admitted", () => {
    const compM = markup("h1");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t2.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("a-at-h1", r.nodeId));
    const ra = addNode(dg, reactiveNode("a"));
    const rb = addNode(dg, reactiveNode("b"));
    const rc = addNode(dg, reactiveNode("c"));
    edge(dg, mr.nodeId, ra.nodeId, "reads");
    edge(dg, ra.nodeId, rb.nodeId, "reads");
    edge(dg, rb.nodeId, rc.nodeId, "reads");

    const plan = firstPlan(runOne([f], dg).record);
    const ids = plan.initialChunk.reactiveCellNodeIds;
    expect(ids.has(ra.nodeId)).toBe(true);
    expect(ids.has(rb.nodeId)).toBe(true);
    expect(ids.has(rc.nodeId)).toBe(true);
    expect(ids.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §3 — Validator-reads chain
// ---------------------------------------------------------------------------

describe("§3 validator-reads chain", () => {
  test("component reads @form; @form has validator-reads to @rule → @rule admitted", () => {
    const compM = markup("form");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t3.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("form-at-form", r.nodeId));
    const rForm = addNode(dg, reactiveNode("form"));
    const rRule = addNode(dg, reactiveNode("rule"));
    edge(dg, mr.nodeId, rForm.nodeId, "reads");
    edge(dg, rForm.nodeId, rRule.nodeId, "validator-reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rForm.nodeId)).toBe(true);
    expect(ids.has(rRule.nodeId)).toBe(true);
    expect(ids.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4 — Engine-derived-reads chain
// ---------------------------------------------------------------------------

describe("§4 engine-derived-reads chain", () => {
  test("component reads engine derived cell; engine-derived-reads to @source → @source admitted", () => {
    const compM = markup("div");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t4.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("engine-at-div", r.nodeId));
    const rEngine = addNode(dg, reactiveNode("engineCell"));
    const rSource = addNode(dg, reactiveNode("source"));
    edge(dg, mr.nodeId, rEngine.nodeId, "reads");
    edge(dg, rEngine.nodeId, rSource.nodeId, "engine-derived-reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rEngine.nodeId)).toBe(true);
    expect(ids.has(rSource.nodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 — Dynamic-key admission semantics
// ---------------------------------------------------------------------------

describe("§5 dynamic-key receiver admission semantics", () => {
  test("named target alone is admitted today (pass-through hook)", () => {
    // The current implementation's expandDynamicKeyReceiver is a
    // pass-through: today's DG has no dynamic-key flag (the §40.9.3
    // runtime-only catalog is empirically empty in the 61-file
    // ceiling-remeasurement corpus). When A-1 begins tagging
    // dynamic-key sites this test will be UPGRADED to assert the
    // sibling-expansion behavior; until then we assert the floor.
    const compM = markup("p");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t5.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("obj-at-p", r.nodeId));
    const rObj = addNode(dg, reactiveNode("obj"));
    const rSibling = addNode(dg, reactiveNode("sibling"));
    edge(dg, mr.nodeId, rObj.nodeId, "reads");
    // No edge from @obj to @sibling — @sibling is admitted only when
    // dynamic-key receiver expansion fires. Today it does not.

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rObj.nodeId)).toBe(true);
    expect(ids.has(rSibling.nodeId)).toBe(false);
  });

  test("dynamic-key worst-case admission via explicit DG edges (recovery-shape parity)", () => {
    // §40.9.3 normative: dynamic-key access admits the entire
    // receiver to the closure (worst-case union over keys). When A-1
    // tags dynamic-key sites, the recovery emits edges to every
    // sibling of the receiver — this test pre-validates the closure
    // shape that the future tagging will rely on by constructing
    // the recovery edges directly. The walker's behavior on the
    // expanded edge set is the contract Component 2 exposes today.
    const compM = markup("p");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t5b.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("obj-at-p", r.nodeId));
    const rObj = addNode(dg, reactiveNode("obj"));
    const rObjKey1 = addNode(dg, reactiveNode("obj.k1"));
    const rObjKey2 = addNode(dg, reactiveNode("obj.k2"));
    // Recovery edges: receiver @obj transitively reads every key.
    edge(dg, mr.nodeId, rObj.nodeId, "reads");
    edge(dg, rObj.nodeId, rObjKey1.nodeId, "reads");
    edge(dg, rObj.nodeId, rObjKey2.nodeId, "reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rObj.nodeId)).toBe(true);
    expect(ids.has(rObjKey1.nodeId)).toBe(true);
    expect(ids.has(rObjKey2.nodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — Markup-read intermediary NOT in output
// ---------------------------------------------------------------------------

describe("§6 markup-read intermediary excluded from output", () => {
  test("closure does NOT contain markup-read DG node ids", () => {
    const compM = markup("h1");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t6.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("x-at-h1", r.nodeId));
    const rx = addNode(dg, reactiveNode("x"));
    edge(dg, mr.nodeId, rx.nodeId, "reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(mr.nodeId)).toBe(false);
    expect(ids.has(r.nodeId)).toBe(false);
    // The reactive node IS in the closure — sanity floor.
    expect(ids.has(rx.nodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 — Cycle handling
// ---------------------------------------------------------------------------

describe("§7 cycle handling (A reads B reads A transitively)", () => {
  test("3-cycle terminates and admits all three nodes", () => {
    const compM = markup("h1");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t7.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("a-at-h1", r.nodeId));
    const ra = addNode(dg, reactiveNode("a"));
    const rb = addNode(dg, reactiveNode("b"));
    const rc = addNode(dg, reactiveNode("c"));
    edge(dg, mr.nodeId, ra.nodeId, "reads");
    edge(dg, ra.nodeId, rb.nodeId, "reads");
    edge(dg, rb.nodeId, rc.nodeId, "reads");
    edge(dg, rc.nodeId, ra.nodeId, "reads"); // cycle back to a

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.size).toBe(3);
    expect(ids.has(ra.nodeId)).toBe(true);
    expect(ids.has(rb.nodeId)).toBe(true);
    expect(ids.has(rc.nodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8 — Multi-component input
// ---------------------------------------------------------------------------

describe("§8 multi-component input → union of reads", () => {
  test("two components in C — closure unions their reads", () => {
    const compA = markup("section");
    const compB = markup("aside");
    const program = markup("program", [], [compA, compB]);
    const f = file("/abs/t8.scrml", [program]);

    const dg = makeDG();
    const rA = addNode(dg, renderNode(compA.id));
    const rB = addNode(dg, renderNode(compB.id));
    const mrA = addNode(dg, markupReadNode("x-at-A", rA.nodeId));
    const mrB = addNode(dg, markupReadNode("y-at-B", rB.nodeId));
    const rx = addNode(dg, reactiveNode("x"));
    const ry = addNode(dg, reactiveNode("y"));
    edge(dg, mrA.nodeId, rx.nodeId, "reads");
    edge(dg, mrB.nodeId, ry.nodeId, "reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rx.nodeId)).toBe(true);
    expect(ids.has(ry.nodeId)).toBe(true);
    expect(ids.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §9 — No reads
// ---------------------------------------------------------------------------

describe("§9 component with no reactive reads", () => {
  test("empty markup-read set → empty reactive closure", () => {
    const compM = markup("hr");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t9.scrml", [program]);

    const dg = makeDG();
    // RenderDGNode is present, but no markup-read intermediary
    // points to it — the component has no markup-context reactive
    // reads.
    addNode(dg, renderNode(compM.id));

    const plan = firstPlan(runOne([f], dg).record);
    expect(plan.initialChunk.reactiveCellNodeIds.size).toBe(0);
    // The component itself is still in the markup-id set per Component 1.
    expect(plan.initialChunk.componentNodeIds.has(compM.id)).toBe(true);
  });

  test("absent DG (null) → empty reactive closure but Component 1 result preserved", () => {
    const compM = markup("hr");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t9b.scrml", [program]);

    const plan = firstPlan(runOne([f], null).record);
    expect(plan.initialChunk.reactiveCellNodeIds.size).toBe(0);
    expect(plan.initialChunk.componentNodeIds.has(compM.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10 — Cross-file reactive read (compile-unit DG)
// ---------------------------------------------------------------------------

describe("§10 cross-file reactive read", () => {
  test("component in file A reads a reactive cell whose DG node was emitted from file B's compile slice", () => {
    // The Stage 7 DG is per-compile-unit: every file's reactive
    // nodes share the same `nodes` map. A markup-read in file A can
    // legally target a reactive node whose decl span lives in file B
    // (e.g. an imported reactive cell). Component 2 walks the DG
    // without consulting file membership — the closure is sound by
    // construction.
    const compM = markup("h1");
    const programA = markup("program", [], [compM]);
    const fA = file("/abs/a.scrml", [programA]);
    // File B is a module-style file (no <program>); its FileAST is
    // not the entry-point source, but the DG node lives in the
    // compile-unit-wide map.
    const fB = file("/abs/b.scrml", [markup("div")]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("imported-at-h1", r.nodeId));
    // The imported reactive cell — span notionally in b.scrml but
    // the DG-side test only cares about the nodeId membership.
    const rImported = addNode(dg, reactiveNode("importedCell"));
    edge(dg, mr.nodeId, rImported.nodeId, "reads");

    const ids = firstPlan(runOne([fA, fB], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rImported.nodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §11 — Channel-cell reads
// ---------------------------------------------------------------------------

describe("§11 channel-cell reads", () => {
  test("component reads a channel-scoped reactive cell — DG-shape-equivalent", () => {
    // From Component 2's perspective, channel-scoped reactive cells
    // are ordinary ReactiveDGNodes (they carry varName, hasLift,
    // span — no channel-specific discrimination in the DG node
    // shape). The closure walk treats them identically.
    const compM = markup("nav");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t11.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("channelCell-at-nav", r.nodeId));
    const rChannel = addNode(dg, reactiveNode("channel.message"));
    edge(dg, mr.nodeId, rChannel.nodeId, "reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rChannel.nodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §12 — Engine state-child arm-body reads (A-1.5 emission shape)
// ---------------------------------------------------------------------------

describe("§12 engine state-child arm-body reads", () => {
  test("arm body references @cell via A-1.5 — closure admits @cell", () => {
    // A-1.5 (S88/S89) extended markup-read emission to engine
    // state-child bodies + onTransition / onTimeout / onIdle. From
    // Component 2's perspective the markup-read DG node has the
    // same shape — sourceRenderNodeId references the engine's
    // enclosing render block.
    const engineMarkup = markup("engine");
    const compM = markup("div", [], [engineMarkup]);
    const program = markup("program", [], [compM]);
    const f = file("/abs/t12.scrml", [program]);

    const dg = makeDG();
    // Render node for the outer markup spine — the engine's
    // arm-body emission anchors here per A-1.5.
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("cell-at-arm", r.nodeId));
    const rCell = addNode(dg, reactiveNode("cell"));
    edge(dg, mr.nodeId, rCell.nodeId, "reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rCell.nodeId)).toBe(true);
  });

  test("derived reactive cell admitted via reads-chain mirrors A-1.5 engine derived-cell emission", () => {
    // An engine derived cell read from markup admits the engine cell
    // AND its engine-derived-reads target (the source @cell).
    const compM = markup("section");
    const program = markup("program", [], [compM]);
    const f = file("/abs/t12b.scrml", [program]);

    const dg = makeDG();
    const r = addNode(dg, renderNode(compM.id));
    const mr = addNode(dg, markupReadNode("derived-at-section", r.nodeId));
    const rDerived = addNode(dg, reactiveNode("engineDerived"));
    const rSource = addNode(dg, reactiveNode("source"));
    edge(dg, mr.nodeId, rDerived.nodeId, "reads");
    edge(dg, rDerived.nodeId, rSource.nodeId, "engine-derived-reads");

    const ids = firstPlan(runOne([f], dg).record).initialChunk.reactiveCellNodeIds;
    expect(ids.has(rDerived.nodeId)).toBe(true);
    expect(ids.has(rSource.nodeId)).toBe(true);
  });
});
