/**
 * @module program-role
 *
 * THE one definition of a `<program>`'s ROLE — top-level or nested (SPEC §4.12,
 * ruling user-voice-scrml.md S445 option b, extended by S445 item 1):
 *
 *   "A `<program>` is top-level if it has no `<program>` or `<page>` ancestor,
 *    whatever markup wraps it. It's nested if it has one. Wrapper `<div>`s never
 *    change a program's role."
 *
 *   S445 item 1 — the IMPLIED ancestor: "When an application program exists,
 *    every `<program>` in one of its route files (`pages/`, `routes/`) counts as
 *    nested: it's a sidecar or worker; the route file keeps inheriting the app's
 *    auth; `auth=` on it is `E-PROGRAM-NESTED-AUTH` until dpa-064 designs nested
 *    auth scopes."
 *
 * Every consumer that asks "which `<program>` is this file's top-level one?" or
 * "is this `<program>` nested?" reads it from here — the E-PROGRAM-002 count, the
 * E-PROGRAM-NESTED-AUTH / E-PROGRAM-NESTED-SESSION detectors, the program-config
 * reader (`auth=`, session, middleware, `mcp`), the file-shape / `hasProgramRoot`
 * fact, the §64 tool predicate, route inference's per-file auth declarations, the
 * auth graph and the reachability entry points. Before S445 each re-derived the
 * answer, most read only the DIRECT top-level nodes, and a `<div>`-wrapped
 * `<program auth="required">` was "top-level" to nobody and "nested" to nobody
 * (g-wrapped-program-auth-silently-dropped).
 *
 * TWO INPUTS decide a role:
 *   1. the STRUCTURAL ancestors in the file (`forEachProgramWithRole`'s walk);
 *   2. the implied application ancestor — a BUILD fact (which files are route
 *      files, and does an application program exist), which no single FileAST can
 *      compute. `stampImpliedProgramAncestors` decides it ONCE per build, after
 *      parsing and before any consumer, and records it on each FileAST
 *      (`IMPLIED_ANCESTOR_FIELD`); consumers read it back with
 *      `programRoleOptionsOf(fileAST)`. A FileAST that never passed through the
 *      stamp (a single-file unit test, the TAB's own per-file view) has no
 *      implied ancestor.
 *
 * This module decides ROLE only. It adds no placement rule: a `<program>` may
 * appear anywhere (bryan, S445 — locality of behaviour).
 *
 * TRAVERSAL. The walk descends through the `children` of markup nodes (and of
 * state nodes, whose openers can wrap markup). It does not descend into logic
 * bodies: a `<program>` is a structural element, not a value.
 */

/** A loosely-typed AST node. */
type NodeLike = Record<string, unknown>;

export type ProgramRole = "top-level" | "nested";

export interface ProgramRoleOptions {
  /**
   * True when the file's programs all have an IMPLIED `<program>` ancestor — the
   * application program — so none of them is top-level (S445 item 1: a route file
   * of a build that has an application program).
   */
  impliedAncestor?: boolean;
}

/**
 * §4.12.2 / §20.5.1 (S445 item 3) — the session attributes a NESTED `<program>` may
 * not carry (`E-PROGRAM-NESTED-SESSION`): the session cookie is application-scope.
 */
export const NESTED_SESSION_ATTRS: ReadonlySet<string> = new Set(["sessionExpiry", "session-secure"]);

/** The FileAST field the build-level stamp writes (see `stampImpliedProgramAncestors`). */
export const IMPLIED_ANCESTOR_FIELD = "programHasImpliedAncestor";

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
 * The role options recorded on a FileAST by `stampImpliedProgramAncestors`.
 * Tolerates the CE wrapper shape (`{ filePath, ast: {...} }`).
 */
export function programRoleOptionsOf(fileAST: unknown): ProgramRoleOptions {
  if (!fileAST || typeof fileAST !== "object") return {};
  const f = fileAST as NodeLike;
  const inner = f.ast as NodeLike | undefined;
  const v = f[IMPLIED_ANCESTOR_FIELD] ?? (inner && typeof inner === "object" ? inner[IMPLIED_ANCESTOR_FIELD] : undefined);
  return v === true ? { impliedAncestor: true } : {};
}

/**
 * Visit every `<program>` element under `nodes`, in document order, with its role.
 * `nodes` is a file's top-level node list (or any subtree treated as a file root).
 */
export function forEachProgramWithRole(
  nodes: unknown,
  visit: (program: NodeLike, role: ProgramRole) => void,
  opts: ProgramRoleOptions = {},
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
  walk(nodes, opts.impliedAncestor === true);
}

/** Every top-level `<program>` under `nodes`, in document order. */
export function findTopLevelPrograms(nodes: unknown, opts: ProgramRoleOptions = {}): NodeLike[] {
  const out: NodeLike[] = [];
  forEachProgramWithRole(nodes, (p, role) => {
    if (role === "top-level") out.push(p);
  }, opts);
  return out;
}

/**
 * The file's top-level `<program>` — the first one in document order — or null.
 * A file with two or more is `E-PROGRAM-002` (§40.8); consumers that need "the"
 * program read the first, and the error stops the build.
 */
export function findTopLevelProgram(nodes: unknown, opts: ProgramRoleOptions = {}): NodeLike | null {
  const all = findTopLevelPrograms(nodes, opts);
  return all.length > 0 ? all[0] : null;
}

/** True when the file declares a top-level `<program>` (the `hasProgramRoot` fact). */
export function hasTopLevelProgram(nodes: unknown, opts: ProgramRoleOptions = {}): boolean {
  return findTopLevelProgram(nodes, opts) !== null;
}

/**
 * The two BUILD facts the implied ancestor needs (S445 item 1), decided by the
 * build's route/entry owner (route inference: `programRoleBuildFacts`) so the
 * classification has ONE owner.
 */
export interface ProgramRoleBuildFacts {
  /** An application program exists in this build (§40.2). */
  applicationExists: boolean;
  /** Is this FileAST a route file of the application (not the application entry)? */
  isRouteFile: (fileAST: unknown) => boolean;
}

/**
 * S445 item 1 — record the implied application ancestor ONCE per build on every
 * FileAST (`IMPLIED_ANCESTOR_FIELD`). Runs after parsing, before PRECG.
 *
 * When an application program exists, every route file's `<program>`s are nested.
 * With NO application program (a legacy all-`<program>` `routes/` set without an
 * application entry) nothing is stamped and every file keeps its structural roles.
 */
export function stampImpliedProgramAncestors(fileASTs: unknown[], facts: ProgramRoleBuildFacts): void {
  const files = (fileASTs ?? []).filter((f): f is NodeLike => !!f && typeof f === "object");
  for (const f of files) delete f[IMPLIED_ANCESTOR_FIELD];
  if (!facts.applicationExists) return;
  for (const f of files) {
    if (facts.isRouteFile(f)) f[IMPLIED_ANCESTOR_FIELD] = true;
  }
}
