/**
 * @module reachability/component-1
 *
 * Component 1 — `initially_rendered_components(entry_point)` per SPEC
 * §40.9.2.
 *
 * S89 wave A-2.2.d — wires the entry-point enumerator + gate classifier
 * + worst-case-union admission into a single per-entry-point operator.
 *
 * For each `ReachabilityEntryPoint`, walks the entry-point's root
 * markup tree and collects component-rendering node ids into a single
 * `Set<NodeId>`. Per §40.9.2 normative classification:
 *
 *   - Unconditional children (no gate, or closed-form-true `if=`) → admit.
 *   - Closed-form-false `if=` → drop.
 *   - Runtime-only gates (runtime `if=`, `<details>`, `<auth>` placeholder,
 *     non-foldable `<match on=>`) → worst-case-union: admit ALL branches.
 *
 * "Component-rendering nodes" at this wave: any markup node descendant
 * (per `MarkupNode.kind === "markup"`). The discrimination between
 * "user component call site" vs "HTML builtin" lives further down the
 * pipeline (Component 5 vendor units, Component 2 reactive cells); for
 * Component 1 we capture the full markup spine the entry-point will
 * initially render. Downstream components consume this set as the
 * `C` argument to their respective operators.
 *
 * **Determinism:** AST walk is depth-first, source-order. Set
 * iteration is insertion-ordered (Map/Set semantics).
 *
 * **Conservative:** when a gate is runtime-only we admit BOTH arms.
 * §40.9.2's worst-case-union over-includes; under-inclusion is the
 * disallowed failure mode.
 *
 * Cross-references:
 *   - SPEC.md §40.9.2 — normative semantics.
 *   - SPEC.md §40.9.9 — worked example covering Dashboard's `<details>`
 *     admission.
 *   - ./entry-points.ts — `enumerateEntryPoints`.
 *   - ./gate-classifier.ts — `detectGate` + `classifyGate`.
 *   - ../codegen/constant-folder.ts — `partiallyEvaluateExpr`.
 */

import type { ASTNode, FileAST, MarkupNode } from "../types/ast.ts";
import type {
  EntryPointId,
  NodeId,
  ReachabilityEntryPoint,
} from "../types/reachability.ts";
import type { ConstFoldEnv } from "../codegen/constant-folder.ts";
import { classifyGate, detectGate } from "./gate-classifier.ts";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Per-entry-point initial-render component set.
 *
 * Keyed by `EntryPointId` so downstream components (A-2.3..A-2.6) can
 * fan out the per-component closure work.
 */
export type InitiallyRenderedComponents = Map<EntryPointId, Set<NodeId>>;

/**
 * Compute Component 1's output for the full compile unit.
 *
 * For each enumerated entry point, walks its root markup tree and
 * collects markup-rendering node ids per §40.9.2 + §40.9.9.
 *
 * Pure: does not mutate inputs.
 */
export function computeInitiallyRenderedComponents(
  entryPoints: ReachabilityEntryPoint[],
  files: FileAST[],
  env: ConstFoldEnv,
): InitiallyRenderedComponents {
  const out: InitiallyRenderedComponents = new Map();

  // Build a fast filePath → FileAST index so we can resolve each entry
  // point's root markup without re-scanning the files array.
  const byFile = new Map<string, FileAST>();
  for (const f of files) byFile.set(f.filePath, f);

  for (const ep of entryPoints) {
    const file = byFile.get(ep.filePath);
    if (!file) {
      out.set(ep.id, new Set());
      continue;
    }
    const topLevel = getTopLevelNodes(file);
    const root = findNodeById(topLevel, ep.rootNodeId);
    const collected = new Set<NodeId>();
    if (root) {
      walkAndCollect(root, env, collected);
    }
    out.set(ep.id, collected);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Walk a single subtree, classify each gate, and collect markup ids.
 *
 * The top-level entry-point root (`<program>` body or `<page>` body)
 * is NOT itself recorded — only its descendants are "initially
 * rendered" per §40.9.2.
 *
 * Children iteration order is source-order; this is observable via
 * Set insertion semantics.
 */
function walkAndCollect(root: ASTNode, env: ConstFoldEnv, acc: Set<NodeId>): void {
  // Walk the root's children — the root itself is the entry-point
  // body (program or page), not a "component". Both <program> and
  // <page> are MarkupNodes — their children is the initially-rendered
  // surface.
  if (!root || typeof root !== "object" || root.kind !== "markup") return;
  const m = root as MarkupNode;
  for (const child of m.children) {
    visit(child, env, acc);
  }
}

/**
 * Visit a single AST node — classify its gate, and either admit
 * (full descendant walk), drop (skip), or worst-case-admit (descend
 * but unconditionally admit all gated branches).
 */
function visit(node: ASTNode, env: ConstFoldEnv, acc: Set<NodeId>): void {
  if (!node || typeof node !== "object") return;
  // §40.9.2 (S221 W2 ruling) — non-rendering state/scope wrappers are
  // TRANSPARENT to Component-1's first-render descent. A `<db src>`
  // connection-scope block (kind:"state") instantiates a CONNECTION, not
  // a rendered component; the components that paint on first render are
  // its markup children. Descend through such a wrapper to reach the
  // render surface (a leaf state-decl with no markup children descends to
  // nothing — harmless). Stopping at the wrapper left every db-backed
  // page's closure empty — the gap §40.9.2 normatively excludes.
  if ((node as { kind?: string }).kind === "state") {
    const sm = node as unknown as { children?: ASTNode[] };
    if (Array.isArray(sm.children)) {
      for (const child of sm.children) visit(child, env, acc);
    }
    return;
  }
  if (node.kind !== "markup") return;

  const m = node as MarkupNode;
  const gate = detectGate(m);
  const cls = classifyGate(gate, env);

  if (cls === "out") {
    // Closed-form-false — drop the whole subtree.
    return;
  }

  // Both "in" and "worst-case" admit this node.
  acc.add(m.id);

  // Recurse into children. For "in" / "worst-case" the descend rule is
  // the same — we admit all descendant markup, letting each
  // descendant's own gate run through `visit` recursively. The
  // distinction between "in" and "worst-case" lives in the parent
  // classification; from this node's perspective we conservatively
  // walk its entire markup spine.
  for (const child of m.children) {
    visit(child, env, acc);
  }
}

/**
 * Find a node by `id` in a forest of AST nodes.
 *
 * Used to resolve the entry-point's `rootNodeId` to its concrete node
 * in the file's `nodes` array. Walks markup children only — the
 * entry-point root is always a markup node (`<program>` or `<page>`).
 */
function findNodeById(nodes: ASTNode[], id: NodeId): ASTNode | null {
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if ((n as { id?: NodeId }).id === id) return n;
    if (n.kind === "markup") {
      const m = n as MarkupNode;
      const sub = findNodeById(m.children, id);
      if (sub) return sub;
    }
  }
  return null;
}

/**
 * Resolve a file's top-level AST node list.
 *
 * Mirrors the helper in `./entry-points.ts` — `FileAST` may expose
 * nodes either as a top-level `.nodes` property OR nested under
 * `.ast.nodes` depending on which pipeline stage produced the value.
 */
function getTopLevelNodes(file: FileAST): ASTNode[] {
  if (Array.isArray((file as { nodes?: ASTNode[] }).nodes)) {
    return (file as { nodes: ASTNode[] }).nodes;
  }
  const ast = (file as unknown as { ast?: { nodes?: ASTNode[] } }).ast;
  if (ast && Array.isArray(ast.nodes)) return ast.nodes;
  return [];
}
