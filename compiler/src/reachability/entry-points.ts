/**
 * @module reachability/entry-points
 *
 * Entry-point enumeration for the Stage 7.6 Reachability Solver.
 *
 * S89 wave A-2.2.a — enumerates `ReachabilityEntryPoint[]` from the
 * compile unit's `FileAST[]` per the v0.3 program shape (SPEC §40.8):
 *
 *   - One entry point per `<page>` declaration (multi-page apps). This
 *     covers BOTH inline `<page>` children of an entry-file `<program>`
 *     AND standalone filesystem-routed page files (`pages/**\/foo.scrml`)
 *     whose TOP-LEVEL node is a `<page>` opener with no `<program>` root
 *     — per §40.8: "Adjacent route files (e.g. `pages/customer/loads.scrml`)
 *     declare their `<page>` openers without re-declaring `<program>`".
 *   - One entry point per entry-file `<program>` body whose body has
 *     ZERO `<page>` children (SPA shape, §40.8.1).
 *
 * **RouteMap (W2 — rs-entrypoint-routemap):** the route URL of a
 * standalone filesystem-routed page file is filesystem-inferred (no
 * `path=`/`route=` attr — §40.8 / §47.9.2 path-preserve emission). The
 * `RouteMap.pages` map (from Stage 5 RI) carries that inferred
 * `urlPattern` keyed by file path; this enumerator consults it to
 * populate the entry point's `routePath`. Without the RouteMap (e.g.
 * unit tests bypassing RI) the enumerator falls back to an explicit
 * `path=` attribute, then to null — the structural detection of a
 * top-level `<page>` node is what admits the entry point; the RouteMap
 * only supplies the URL label.
 *
 * **OQ-A2-E disposition (S89, "no synthesis on auth-redirect"):**
 * the enumerator does NOT create a synthetic entry point for the
 * auth-redirect destination. Per §40.9.9 paragraph "For viewer
 * Anonymous":
 *
 *   "the auth redirect to a login route is the analysis's output for
 *    that viewer. The login route is a separate entry point with its
 *    own playable surface."
 *
 * The login route is itself a `<page>` declaration somewhere in the
 * compile unit — Component 1 enumerates it independently. No synthesis.
 *
 * Cross-references:
 *   - SPEC.md §40.8 — v0.3 program shape (the source of truth for
 *     entry-point shapes; the "Adjacent route files" paragraph is the
 *     normative source for standalone filesystem-routed page files).
 *   - SPEC.md §40.9.2 — Component 1 normative dependency on enumeration.
 *   - SPEC.md §40.9.9 — Worked example covering SPA, multi-page,
 *     viewer-anonymous redirect.
 *   - compiler/src/route-inference.ts `RouteMap.pages` — the
 *     filesystem-derived page-route source (`urlPattern` per file path);
 *     this enumerator reads it for the `routePath` of standalone
 *     filesystem-routed page files, and reads the AST for `<program>`
 *     roots + inline `<page>` decls.
 */

import type {
  ASTNode,
  FileAST,
  MarkupNode,
} from "../types/ast.ts";
import type {
  EntryPointId,
  NodeId,
  ReachabilityEntryPoint,
} from "../types/reachability.ts";

// ---------------------------------------------------------------------------
// RouteMap boundary (duck-typed)
// ---------------------------------------------------------------------------

/**
 * The slice of `RouteMap` this enumerator consumes — the
 * filesystem-derived `pages` map keyed by file path, each carrying the
 * inferred `urlPattern`. Duck-typed at the boundary (RI's concrete
 * `RouteMap`/`PageRoute` types live upstream) so the reachability module
 * stays decoupled from route-inference internals.
 */
interface RouteMapLike {
  pages?: Map<string, { urlPattern?: string } | undefined> | undefined;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Enumerate entry points from a `FileAST[]` (+ the RI `RouteMap`).
 *
 * Algorithm:
 *
 *   1. For each file:
 *      a. Find the root `<program>` markup node, if any.
 *      b. If `<program>` is present:
 *         - Find its immediate `<page>` children. If non-empty: emit one
 *           ReachabilityEntryPoint per `<page>` child (multi-page-in-
 *           entry-file shape). If empty: emit one ReachabilityEntryPoint
 *           for the `<program>` body itself (SPA shape per §40.8.1).
 *      c. If `<program>` is absent, look for a TOP-LEVEL `<page>` node.
 *         When present, the file is a standalone filesystem-routed page
 *         file (§40.8 "Adjacent route files") — emit one `page` entry
 *         point with its filesystem-inferred URL. When absent too
 *         (modules, components, channels, models), skip the file.
 *   2. The `routePath` for a `<page>` entry point is:
 *      - the RouteMap's filesystem-inferred `urlPattern` for the file
 *        (standalone filesystem-routed pages), else
 *      - the explicit `path=` attribute when present, else
 *      - null (the consumer can cross-reference RouteMap for URLs).
 *
 * **Determinism:** entry points are emitted in file-iteration order;
 * within a file, `<page>` children are emitted in source order. The
 * caller MAY rely on this order for stable downstream output.
 *
 * **Pure:** does not mutate any input. Returns a fresh array each call.
 */
export function enumerateEntryPoints(
  files: FileAST[],
  routeMap?: RouteMapLike | unknown,
): ReachabilityEntryPoint[] {
  const out: ReachabilityEntryPoint[] = [];

  // filePath -> filesystem-inferred urlPattern (from RI's RouteMap.pages).
  const pageUrlByFile = buildPageUrlIndex(routeMap);

  for (const file of files) {
    const nodes = getTopLevelNodes(file);
    const programNode = findRootProgram(nodes);

    if (!programNode) {
      // No `<program>` root. A standalone filesystem-routed page file
      // (`pages/**`/`foo.scrml` per §40.8 "Adjacent route files ...
      // declare their `<page>` openers without re-declaring `<program>`")
      // exposes a TOP-LEVEL `<page>` node whose URL is filesystem-
      // inferred. Enumerate it as a `page` entry point; the route URL
      // comes from the RouteMap (RI §47.9.2 path-preserve inference),
      // falling back to an explicit `path=` attr, then null. Files with
      // neither a `<program>` root nor a top-level `<page>` (modules,
      // components, channels, models) are skipped.
      const topLevelPage = findRootPage(nodes);
      if (topLevelPage) {
        const routePath =
          pageUrlByFile.get(file.filePath) ?? extractPathAttr(topLevelPage);
        out.push({
          id: pageEntryId(file.filePath, 0, routePath),
          filePath: file.filePath,
          routePath,
          shape: "page",
          rootNodeId: topLevelPage.id,
        });
      }
      continue;
    }

    const pageChildren = directPageChildren(programNode);

    if (pageChildren.length === 0) {
      // SPA shape — the program body itself IS the entry point.
      out.push({
        id: spaEntryId(file.filePath),
        filePath: file.filePath,
        routePath: null,
        shape: "spa-program",
        rootNodeId: programNode.id,
      });
      continue;
    }

    // Multi-page shape — one entry point per `<page>` child.
    let pageIndex = 0;
    for (const page of pageChildren) {
      const routePath = extractPathAttr(page);
      out.push({
        id: pageEntryId(file.filePath, pageIndex, routePath),
        filePath: file.filePath,
        routePath,
        shape: "page",
        rootNodeId: page.id,
      });
      pageIndex++;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

/**
 * Build a `filePath -> urlPattern` index from the RI `RouteMap.pages`
 * map. Duck-typed at the boundary: returns an empty index when the
 * RouteMap (or its `pages` map) is absent or not a Map (e.g. unit tests
 * bypassing RI). Only string `urlPattern` values are recorded.
 */
function buildPageUrlIndex(routeMap: RouteMapLike | unknown): Map<string, string> {
  const idx = new Map<string, string>();
  const pages = (routeMap as RouteMapLike | undefined)?.pages;
  if (!pages || typeof (pages as Map<string, unknown>).forEach !== "function") {
    return idx;
  }
  (pages as Map<string, { urlPattern?: string } | undefined>).forEach(
    (route, filePath) => {
      const url = route?.urlPattern;
      if (typeof url === "string") idx.set(filePath, url);
    },
  );
  return idx;
}

/**
 * Find the first top-level `<program>` markup node in a file's node list.
 *
 * Mirrors the ast-builder convention (`compiler/src/ast-builder.js`
 * lines 10479-10492) — the canonical home of `hasProgramRoot`.
 */
function findRootProgram(nodes: ASTNode[] | undefined): MarkupNode | null {
  if (!Array.isArray(nodes)) return null;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (n.kind === "markup" && (n as MarkupNode).tag === "program") {
      return n as MarkupNode;
    }
  }
  return null;
}

/**
 * Find the first top-level `<page>` markup node in a file's node list.
 *
 * Used for standalone filesystem-routed page files (§40.8 "Adjacent
 * route files") — a routed page file's top-level node is a `<page>`
 * opener with no enclosing `<program>`. One route per file (§40.8 /
 * §47.9.2), so the first top-level `<page>` is the entry point.
 */
function findRootPage(nodes: ASTNode[] | undefined): MarkupNode | null {
  if (!Array.isArray(nodes)) return null;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (n.kind === "markup" && (n as MarkupNode).tag === "page") {
      return n as MarkupNode;
    }
  }
  return null;
}

/**
 * Resolve a file's top-level AST node list.
 *
 * Per the in-house convention (mirroring `compiler/src/api.js` lines
 * 945 + 1024), files may expose nodes either as a top-level `.nodes`
 * property OR nested under `.ast.nodes`. This helper bridges both.
 */
function getTopLevelNodes(file: FileAST): ASTNode[] {
  // Direct .nodes form (the canonical type-surface shape).
  if (Array.isArray((file as { nodes?: ASTNode[] }).nodes)) {
    return (file as { nodes: ASTNode[] }).nodes;
  }
  // Nested .ast.nodes form (some pipeline stages emit this).
  const ast = (file as unknown as { ast?: { nodes?: ASTNode[] } }).ast;
  if (ast && Array.isArray(ast.nodes)) return ast.nodes;
  return [];
}

/**
 * Find immediate `<page>` children of a `<program>` body.
 *
 * Only direct children — `<page>` nested inside another markup element
 * is not a top-level page declaration per §40.8.
 */
function directPageChildren(program: MarkupNode): MarkupNode[] {
  const out: MarkupNode[] = [];
  for (const child of program.children) {
    if (!child || typeof child !== "object") continue;
    if (child.kind === "markup" && (child as MarkupNode).tag === "page") {
      out.push(child as MarkupNode);
    }
  }
  return out;
}

/**
 * Extract a `path=` attribute string from a `<page>` markup node.
 *
 * Returns the raw path string (e.g. `/loads`) when present as a string
 * literal; returns null for absent / non-string-literal forms (the
 * filesystem-derived URL is the fallback, computed by RI).
 */
function extractPathAttr(page: MarkupNode): string | null {
  for (const attr of page.attrs) {
    if (attr.name !== "path") continue;
    if (attr.value.kind === "string-literal") return attr.value.value;
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ID construction
// ---------------------------------------------------------------------------

/**
 * Stable, deterministic id for an SPA-shape entry point.
 *
 * Format: `<filePath>#program` — file + `#program` discriminator so a
 * file that simultaneously declares a SPA program AND emits `<page>`
 * children in a sibling file does not collide.
 */
function spaEntryId(filePath: string): EntryPointId {
  return `${filePath}#program`;
}

/**
 * Stable id for a `<page>` entry point.
 *
 * When `path=` is present, encode it directly (deterministic across
 * runs). When absent, fall back to `#page-<index>` (positional).
 */
function pageEntryId(filePath: string, index: number, routePath: string | null): EntryPointId {
  if (routePath !== null) return `${filePath}#page@${routePath}`;
  return `${filePath}#page-${index}`;
}

// ---------------------------------------------------------------------------
// Re-exports (NodeId convenience)
// ---------------------------------------------------------------------------

/**
 * The DG / AST node id type — re-exported here so callers can keep
 * imports localized to the reachability/ module.
 */
export type { NodeId };
