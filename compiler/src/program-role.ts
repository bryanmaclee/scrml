/**
 * @module program-role
 *
 * THE one definition of a `<program>`'s ROLE — top-level or nested (SPEC §4.12,
 * ruling:user-voice-scrml.md S445 option b):
 *
 *   "A `<program>` is top-level if it has no `<program>` or `<page>` ancestor,
 *    whatever markup wraps it. It's nested if it has one. Wrapper `<div>`s never
 *    change a program's role."
 *
 * Every consumer that asks "which `<program>` is this file's top-level one?" or
 * "is this `<program>` nested?" reads it from here — the E-PROGRAM-002 count, the
 * E-PROGRAM-NESTED-AUTH detector, the program-config reader (`auth=`, session,
 * middleware, `mcp`), the file-shape / `hasProgramRoot` fact, the §64 tool
 * predicate, route inference's per-file auth declarations, the auth graph and the
 * reachability entry points. Before S445 each of those re-derived the answer, and
 * most read only the DIRECT top-level nodes of the file: a `<program auth="required">`
 * wrapped in a `<div>` was "top-level" to nobody and "nested" to nobody, so its
 * `auth=` was silently dropped and its server functions answered anonymous callers
 * (g-wrapped-program-auth-silently-dropped).
 *
 * This module decides ROLE only. It adds no placement rule: a `<program>` may
 * appear anywhere (bryan, S445 — locality of behaviour: a `<div>` may want to call
 * a sidecar), and a `<program>` inside an application `<program>` stays nested
 * however much markup sits between them.
 *
 * TRAVERSAL. The walk descends through the `children` of markup nodes (and of
 * state nodes, whose openers can wrap markup) — the same structural tree the
 * pre-S445 E-PROGRAM-NESTED-AUTH detector walked. It does not descend into logic
 * bodies: a `<program>` is a structural element, not a value.
 */

/** A loosely-typed AST node. */
type NodeLike = Record<string, unknown>;

export type ProgramRole = "top-level" | "nested";

/** True when `node` is a `<program>` markup element. */
export function isProgramMarkup(node: unknown): node is NodeLike {
  if (!node || typeof node !== "object") return false;
  const n = node as NodeLike;
  return n.kind === "markup" && n.tag === "program";
}

/** True when `node` is a `<page>` markup element. */
function isPageMarkup(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as NodeLike;
  return n.kind === "markup" && n.tag === "page";
}

function structuralChildren(node: NodeLike): unknown[] | null {
  if (node.kind !== "markup" && node.kind !== "state") return null;
  return Array.isArray(node.children) ? (node.children as unknown[]) : null;
}

/**
 * Visit every `<program>` element under `nodes`, in document order, with its role.
 * `nodes` is a file's top-level node list (or any subtree treated as a file root).
 */
export function forEachProgramWithRole(
  nodes: unknown,
  visit: (program: NodeLike, role: ProgramRole) => void,
): void {
  const walk = (ns: unknown, underProgramOrPage: boolean): void => {
    if (!Array.isArray(ns)) return;
    for (const node of ns) {
      if (!node || typeof node !== "object") continue;
      const n = node as NodeLike;
      if (isProgramMarkup(n)) visit(n, underProgramOrPage ? "nested" : "top-level");
      const kids = structuralChildren(n);
      if (kids) walk(kids, underProgramOrPage || isProgramMarkup(n) || isPageMarkup(n));
    }
  };
  walk(nodes, false);
}

/** Every top-level `<program>` under `nodes`, in document order. */
export function findTopLevelPrograms(nodes: unknown): NodeLike[] {
  const out: NodeLike[] = [];
  forEachProgramWithRole(nodes, (p, role) => {
    if (role === "top-level") out.push(p);
  });
  return out;
}

/**
 * The file's top-level `<program>` — the first one in document order — or null.
 * A file with two or more is `E-PROGRAM-002` (§40.8); consumers that need "the"
 * program read the first, and the error stops the build.
 */
export function findTopLevelProgram(nodes: unknown): NodeLike | null {
  const all = findTopLevelPrograms(nodes);
  return all.length > 0 ? all[0] : null;
}

/** True when the file declares a top-level `<program>` (the `hasProgramRoot` fact). */
export function hasTopLevelProgram(nodes: unknown): boolean {
  return findTopLevelProgram(nodes) !== null;
}
