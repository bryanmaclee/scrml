/**
 * @module codegen/atom-emitter
 *
 * Per-id atom emitters — wave A-4.2 (SPEC §40.9.7).
 *
 * Where `emit-client.ts:generateClientJs` is a per-FILE emitter producing
 * the full top-level browser JS for one .scrml source, the atom emitters
 * here produce SMALL, SELF-CONTAINED slices of runtime JS keyed by a
 * single DG / AST node id.
 *
 * These slices compose into the per-(entry-point, role, tier) chunk
 * payload at `route-splitter.ts:composeInitialChunk`. The composition is
 * the §40.9.7 `minimize_payload(playable_surface(E, N=0))` operator —
 * the route-splitter walks the admission set canonically, calls the
 * atom emitter per id, and concatenates.
 *
 * **Idempotency invariant (A-4.6 prerequisite):** every helper here MUST
 * produce byte-identical output for byte-identical input. Two calls with
 * the same `(node, ctx)` pair return the same string. Composition order
 * is the only run-to-run variable, and the route-splitter enforces
 * canonical order via the stratified comparator below.
 *
 * **Additive contract:** these helpers are NEW; `emit-client.ts` is NOT
 * modified by A-4.2. The per-file emitter continues to produce
 * `.client.js` exactly as it did pre-A-4.2 (byte-identity preserved).
 * The atom emitters are the chunk-side parallel emit surface that
 * `composeInitialChunk` calls. Future polish dispatches MAY fold them
 * back into `generateClientJs` to deduplicate the two emit paths; that
 * refactor is out of scope for A-4.2.
 *
 * Cross-references:
 *   - SPEC.md §40.9.7 (L17775-17793) — `initial_chunk(E)` normative.
 *   - SPEC.md §40.9.9 (L17815-17883) — worked example covered by the
 *     A-4.2 integration test at
 *     `compiler/tests/integration/initial-chunk-emission.test.js`.
 *   - SPEC.md §40.9.8 — determinism preservation; the comparator below
 *     is the canonical ordering rule.
 *   - SPEC.md §41 — vendor unit declarations consumed by
 *     `emitVendorUnitRef`.
 *   - SPEC.md §42.5 / §42.8 — emitted runtime JS uses canonical JS
 *     `null` for absence; no literal `undefined`.
 *   - `compiler/src/reachability-solver.ts` — Component 4 (post-A-2.5)
 *     uses the same stratified comparator pattern for ChunkContents Set
 *     serialization.
 */

import type { CompileContext } from "./context.ts";
import type { NodeId, VendorUnitId } from "../types/reachability.ts";

// ---------------------------------------------------------------------------
// Canonical iteration order (mirrors reachability-solver A-2.8 pattern)
// ---------------------------------------------------------------------------

/**
 * Stratified comparator: numbers sort before strings; within a stratum
 * sorting is numeric (numbers) or codepoint (strings).
 *
 * This is the §40.9.8 canonical ordering applied at chunk-composition
 * time so two builds of the same source produce byte-identical
 * `payloadJs` regardless of Map insertion-order quirks upstream.
 *
 * Mirrors `reachability-solver.ts:sortedArrayFromSet` (A-2.8) — keep the
 * two implementations behaviorally identical. If one is updated the
 * other must be updated in lockstep.
 */
export function stratifiedNodeIdCompare(a: NodeId, b: NodeId): number {
  const aIsNum = typeof a === "number";
  const bIsNum = typeof b === "number";
  if (aIsNum && !bIsNum) return -1;
  if (!aIsNum && bIsNum) return 1;
  if (aIsNum && bIsNum) {
    return (a as number) - (b as number);
  }
  // Both strings — codepoint compare via the canonical JS string
  // comparison (which is codepoint-by-codepoint per ECMA-262).
  const aStr = String(a);
  const bStr = String(b);
  if (aStr < bStr) return -1;
  if (aStr > bStr) return 1;
  return 0;
}

/**
 * Convert any `Set<NodeId>` to a canonically-ordered array.
 *
 * Used by `composeInitialChunk` to iterate admission sets in a
 * deterministic order independent of Set insertion order.
 */
export function canonicalNodeIdArray<T extends NodeId>(set: Set<T>): T[] {
  return Array.from(set).sort(stratifiedNodeIdCompare) as T[];
}

/**
 * Codepoint compare for string-keyed sets (e.g. vendor unit names).
 */
export function canonicalVendorUnitArray(set: Set<VendorUnitId>): VendorUnitId[] {
  return Array.from(set).sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// AST helpers — node lookup by id
// ---------------------------------------------------------------------------

/** Loosely-typed AST node. */
type LooseNode = Record<string, unknown> & { id?: NodeId; kind?: string; children?: LooseNode[]; body?: LooseNode[] };

/**
 * Locate a node by `id` in a FileAST. Walks the full tree (markup
 * children + logic body) until the id is found or the tree is
 * exhausted. Returns `null` when no match.
 *
 * This is pure and stateless — safe to call repeatedly during chunk
 * composition.
 */
export function findNodeById(fileAST: unknown, targetId: NodeId): LooseNode | null {
  const ast = (fileAST as { ast?: { nodes?: LooseNode[] } })?.ast;
  const rootNodes: LooseNode[] = Array.isArray(ast?.nodes)
    ? (ast!.nodes as LooseNode[])
    : Array.isArray((fileAST as { nodes?: LooseNode[] })?.nodes)
      ? ((fileAST as { nodes: LooseNode[] }).nodes)
      : [];

  function visit(nodes: LooseNode[]): LooseNode | null {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.id === targetId) return n;
      if (Array.isArray(n.children)) {
        const sub = visit(n.children);
        if (sub) return sub;
      }
      if (Array.isArray(n.body)) {
        const sub = visit(n.body as LooseNode[]);
        if (sub) return sub;
      }
    }
    return null;
  }

  return visit(rootNodes);
}

// ---------------------------------------------------------------------------
// Atom — reactive cell init (one `<name> = expr` / `@name = expr` decl)
// ---------------------------------------------------------------------------

/**
 * Emit the runtime registration for a single reactive cell.
 *
 * Output: a single readable JS line registering the cell's initial value
 * with `SCRML_RUNTIME._scrml_reactive_set`. The initializer is the
 * cell's `initExpr` lowered to JS (a literal, an identifier, or a
 * pre-existing identifier reference for derived cells).
 *
 * For the §40.9.9 worked example:
 *   `<count> = 0`  →  `_scrml_reactive_set("count", 0);`
 *   `<user> = ^server fetchUser()`  →  shape lowering is deferred to
 *     the server-fn stub; the cell init is a placeholder
 *     `_scrml_reactive_set("user", null);` which the server-fn fetch
 *     resolves at mount time.
 *
 * **Idempotency:** the output is a pure function of the node's static
 * fields (`name`, `initExpr` form, `shape`); calling twice with the
 * same node returns the same string.
 *
 * **`null` for absence (§42.5/§42.8):** when no init expression is
 * present OR the init is server-resolved, the emitted JS literal is
 * `null` (canonical JS absence), NEVER `undefined` (forbidden per
 * W-CG-UNDEFINED-INTERPOLATION).
 *
 * @param stateDecl A `ReactiveDeclNode` (`kind: "state-decl"`) AST node.
 * @param _ctx The per-file CompileContext (reserved for future use —
 *   e.g. derived-cell dependency resolution; unused at A-4.2).
 * @returns A single-line JS string ending with `;\n`, or an empty
 *   string when the node is not a state-decl (defensive caller guard).
 */
export function emitReactiveCellAtom(
  stateDecl: LooseNode,
  _ctx: CompileContext,
): string {
  if (!stateDecl || typeof stateDecl !== "object") return "";
  if (stateDecl.kind !== "state-decl") return "";
  const name = stateDecl.name as string | undefined;
  if (typeof name !== "string" || name === "") return "";

  // Quote-safe JSON-encode the name so it round-trips at any name.
  const nameLit = JSON.stringify(name);

  // Determine the initial-value literal. Three cases:
  //   1. `initExpr` is a literal number/string/boolean — lower directly.
  //   2. `initExpr` is `not` / null-shape — emit `null` (canonical JS
  //      absence per §42.5/§42.8).
  //   3. `initExpr` is a complex expression — defer to the per-file
  //      emitter. Atom emits `null` placeholder.
  //
  // The conservative shape: emit `null` whenever the init is not a
  // trivially-static literal. Real expression evaluation lives in the
  // per-file emitter; the chunk's atom is the registration only.
  //
  // LitExpr `kind` is `"lit"` (per `types/ast.ts:1497`). The `value`
  // field carries the interpreted runtime value (number / string /
  // boolean / null). `null` value covers both `not` litType (canonical)
  // and the deprecated `null` / `undefined` litTypes (defensive shape).
  const initExpr = stateDecl.initExpr as { kind?: string; value?: unknown } | undefined | null;
  let initJs = "null";
  if (initExpr && typeof initExpr === "object") {
    if (initExpr.kind === "lit") {
      const v = initExpr.value;
      if (typeof v === "number" || typeof v === "boolean") {
        initJs = String(v);
      } else if (typeof v === "string") {
        initJs = JSON.stringify(v);
      } else if (v === null) {
        // `not` lowers to `null` (canonical JS absence per §42.5/§42.8).
        initJs = "null";
      }
    }
    // Other ExprNode kinds (binary, call, ident, ...) lower to `null`
    // here — the real init lands via the per-file emitter's reactive-
    // wiring pass. A-4.2's chunk atom is the BARE registration; full
    // expression lowering inside the chunk is A-4.6+ scope.
  }

  return `_scrml_reactive_set(${nameLit}, ${initJs});\n`;
}

// ---------------------------------------------------------------------------
// Atom — server-fn fetch stub (one `server function NAME(...) { ... }`)
// ---------------------------------------------------------------------------

/**
 * Emit a minimal client-side fetch stub for a single server function.
 *
 * The stub posts the function's call-site args to the server route as a
 * JSON body and returns the parsed JSON response (decoded via the §57
 * wire-format dual-decoder `_scrml_wire_decode`). The chunk atom is a
 * SIMPLIFIED form of the full `emit-functions.ts:emitFunctions` output
 * — no CSRF retry, no idempotency-key bookkeeping, no CPS split. These
 * lower-level concerns lift into the chunk via a future A-4.6 polish
 * that gates on per-fn route metadata; at A-4.2 the stub is the simple
 * shape.
 *
 * **Wire-format compliance (§57):** the stub calls `_scrml_wire_decode`
 * on the parsed JSON body so `T | not` returns landing as the canonical
 * absence envelope `{__scrml_absent: true}` decode to JS `null`.
 *
 * @param fnNode A `function-decl` AST node carrying `name`, `params`.
 * @param route The RouteMap entry for this fn (path + method).
 * @param _ctx Per-file CompileContext (reserved).
 * @returns A multi-line JS string (function declaration + trailing
 *   newline), or empty string if the node lacks required fields.
 */
export interface RouteInfo {
  path: string;
  method: string;
}

export function emitServerFnStubAtom(
  fnNode: LooseNode,
  route: RouteInfo,
  _ctx: CompileContext,
): string {
  if (!fnNode || typeof fnNode !== "object") return "";
  if (fnNode.kind !== "function-decl") return "";
  const name = fnNode.name as string | undefined;
  if (typeof name !== "string" || name === "") return "";
  if (!route || typeof route !== "object") return "";
  if (typeof route.path !== "string" || typeof route.method !== "string") return "";

  const params = Array.isArray(fnNode.params) ? (fnNode.params as unknown[]) : [];
  // Reuse the per-file emitter's param-name extraction shape: strings get
  // their `:Type` suffix stripped; structured params expose `.name`.
  const paramNames: string[] = params.map((p, i) => {
    if (typeof p === "string") return p.split(":")[0].trim();
    if (p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string") {
      return (p as { name: string }).name;
    }
    return `_scrml_arg_${i}`;
  });

  const stubFnName = `_scrml_fetch_${name}`;
  const pathLit = JSON.stringify(route.path);
  const methodLit = JSON.stringify(route.method);

  // Compose body literal for non-GET methods; GET passes args via the
  // URL query string per the per-file emitter convention. For A-4.2 we
  // mirror the simple POST shape (matches most server-fn boundaries in
  // the worked example).
  const isBodyless = route.method === "GET" || route.method === "HEAD";

  const lines: string[] = [];
  lines.push(`async function ${stubFnName}(${paramNames.join(", ")}) {`);
  if (isBodyless) {
    lines.push(`  const _scrml_resp = await _scrml_g.fetch(${pathLit}, { method: ${methodLit} });`);
  } else {
    lines.push(`  const _scrml_body = _scrml_g.JSON.stringify({`);
    for (const p of paramNames) {
      lines.push(`    ${JSON.stringify(p)}: ${p},`);
    }
    lines.push(`  });`);
    lines.push(`  const _scrml_resp = await _scrml_g.fetch(${pathLit}, {`);
    lines.push(`    method: ${methodLit},`);
    lines.push(`    headers: { "Content-Type": "application/json" },`);
    lines.push(`    body: _scrml_body,`);
    lines.push(`  });`);
  }
  lines.push(`  const _scrml_data = await _scrml_resp.json();`);
  lines.push(`  return _scrml_wire_decode(_scrml_data);`);
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Atom — vendor unit reference (one `use vendor:NAME` per §41)
// ---------------------------------------------------------------------------

/**
 * Emit the import line for a vendor unit referenced by the chunk.
 *
 * Per §41 vendor units are declared via `use vendor:NAME` (or
 * `import { ... } from "vendor:NAME"`); the compiler runtime resolves
 * the `vendor:` prefix at module-link time. The chunk-side atom emits
 * the same import statement so the chunk has the unit in scope when
 * other atoms reference it.
 *
 * The atom is intentionally a NAMESPACE import — `import * as
 * _scrml_vendor_NAME from "vendor:NAME"` — so the chunk doesn't need to
 * know which specific names the per-component atoms reference. This is
 * a small extra byte cost (the bundler removes unused fields at the
 * `vendor:NAME` module level if the bundler tree-shakes that surface).
 *
 * Identifier-safety: the vendor unit name may contain characters that
 * are not valid JS identifiers (`/`, `-`, etc.). The atom emits a
 * sanitized binding name (`/` → `_`, `-` → `_`).
 *
 * @param unitName Vendor unit name (e.g. `"cm6"`, `"lodash-es"`).
 * @param _fileAST Reserved — future polish may consult the file's
 *   declared vendor-unit set to surface a hard error if the chunk
 *   references a unit not declared anywhere in the compile unit.
 * @returns A single-line `import * as ... from "vendor:NAME";\n`.
 */
export function emitVendorUnitRef(
  unitName: VendorUnitId,
  _fileAST?: unknown,
): string {
  if (typeof unitName !== "string" || unitName === "") return "";
  const safeBinding = unitName.replace(/[^A-Za-z0-9_$]/g, "_");
  const specifier = JSON.stringify(`vendor:${unitName}`);
  return `import * as _scrml_vendor_${safeBinding} from ${specifier};\n`;
}

// ---------------------------------------------------------------------------
// Atom — component mount marker (one admitted markup nodeId)
// ---------------------------------------------------------------------------

/**
 * Emit a runtime mount marker for one admitted markup node.
 *
 * At A-4.2 this is a small mount-record line of the shape:
 *
 *   `_scrml_chunk_mount(NID, "tag", { /* attr summary *\/ });`
 *
 * The marker tells the runtime "this markup node was admitted to the
 * chunk." For the §40.9.9 worked example the marker captures the
 * structural skeleton of the playable surface. Real DOM-tree
 * construction lives in the per-file `.html` output (the HTML emitter
 * renders the static markup tree); the chunk atom records the per-node
 * runtime presence so role-variance is observable at the chunk-payload
 * level.
 *
 * Future sub-phases (A-4.3 / A-4.4 / A-4.7) refine this with per-tier
 * event-wiring + per-route HTML augmentation. The mount-marker shape is
 * deliberately minimal at A-4.2 so the byte-budget for the integration
 * test is small and the determinism contract is easy to validate.
 *
 * **Tag literal:** the mount marker emits the markup tag as a JS string
 * literal so role-variance manifests as a TEXT-level diff (Driver's
 * chunk omits `_scrml_chunk_mount(N, "auth", ...)` for the Admin gate
 * subtree; Admin's chunk includes it).
 *
 * **Mount-fn runtime:** the `_scrml_chunk_mount` helper is provided by
 * SCRML_RUNTIME starting at v0.3 alongside the existing
 * `_scrml_reactive_set`. It records per-chunk admission for
 * adopter-facing debug surfaces and runtime instrumentation. The
 * helper is a no-op at runtime unless instrumentation is enabled (zero
 * production overhead per §47 / §40.9.7).
 *
 * @param markupNodeId The admitted markup node's stable AST id.
 * @param ctx The per-file CompileContext for the file containing the
 *   admitted node.
 * @returns A single-line JS string, or empty when the id doesn't
 *   resolve to a markup node in `ctx.fileAST`.
 */
export function emitComponentAtom(
  markupNodeId: NodeId,
  ctx: CompileContext,
): string {
  if (markupNodeId === null || markupNodeId === undefined) return "";
  const node = findNodeById(ctx.fileAST, markupNodeId);
  if (!node) return "";
  if (node.kind !== "markup") return "";
  const tag = typeof node.tag === "string" ? node.tag : "";
  if (tag === "") return "";

  // Idempotent: same (id, tag) → same line. The node id is canonical
  // (assigned by the AST builder; stable across same-source compiles
  // per the AST-CONTRACTS-AND-DECOMPOSITION §1 guarantees).
  const idLit = typeof markupNodeId === "number"
    ? String(markupNodeId)
    : JSON.stringify(String(markupNodeId));
  const tagLit = JSON.stringify(tag);
  return `_scrml_chunk_mount(${idLit}, ${tagLit});\n`;
}
