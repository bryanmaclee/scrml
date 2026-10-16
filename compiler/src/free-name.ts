/**
 * s466 fix round 2 — is a NAME read FREE (not bound by any enclosing scope) at a
 * point in a scrml function? The scope-aware answer for the server-only builtins
 * whose meaning depends on the name being unbound — above all `session` (§20.5):
 * a reference to it auto-escalates the enclosing function to the server, and it
 * is server-trusted identity. A parameter, a local or a lambda parameter NAMED
 * `session` is an ordinary value: `fn mk(session: string) { return session + "!" }`
 * is a pure function, and the name-matching detector used to place it on the
 * server (where it became an async peer — a false E-PARAM-DEFAULT-AWAIT in any
 * default that called it).
 *
 * One scope model: codegen/local-async-fns.ts `walkScoped` (parameters, block
 * locals, nested functions, lambda parameters) for the structured tree; the §13.2
 * acorn scope resolver (`resolveProgramReferences`) for raw text the parser keeps
 * unparsed (a block-bodied callback, a template interpolation, a `?{}` slot).
 */

import { parse as acornParse } from "acorn";
import { walkScoped } from "./codegen/local-async-fns.ts";
import { resolveProgramReferences } from "./codegen/js-async-analysis.ts";
import { liveSqlInterpolations } from "./codegen/sql-lex.ts";
import { blankLiteralTextInSource, parseScrmlTextToEstree } from "./expression-parser.ts";

/** Non-enumerable mark: this `session` ident (or raw-text node) sits where `session` is BOUND locally. */
const SESSION_BOUND_MARK = "_scrmlSessionBound";

function setMark(node: object): void {
  Object.defineProperty(node, SESSION_BOUND_MARK, { value: true, enumerable: false, configurable: true, writable: true });
}

function isMarked(node: unknown): boolean {
  return !!node && typeof node === "object" && (node as Record<string, unknown>)[SESSION_BOUND_MARK] === true;
}

/**
 * Does the raw scrml/JS text `raw` read `name` as a FREE identifier? Parsed and
 * resolved with the acorn scope model, so `(session) => session.userId` does not.
 * Unparseable text that mentions the name answers true (fail closed).
 */
export function rawReadsFreeName(raw: string, name: string): boolean {
  if (typeof raw !== "string" || !raw) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(?<![@\\w$.])${esc}\\b`).test(blankLiteralTextInSource(raw))) return false;
  const ast = parseScrmlTextToEstree(raw, false) ?? parseScrmlTextToEstree(raw, true);
  if (!ast) return true;
  const a = ast as unknown as { type?: string };
  const program = a.type === "Program"
    ? ast
    : ({ type: "Program", sourceType: "module", body: [{ type: "ExpressionStatement", expression: ast }] } as unknown as typeof ast);
  for (const [id, binding] of resolveProgramReferences(program as never)) {
    if ((id as { name?: unknown }).name === name && binding === undefined) return true;
  }
  return false;
}

/**
 * Does EMITTED JavaScript `js` read `name` as a free identifier? For codegen's
 * text-level readers (the cookie-session wrap / binding of a route handler):
 * `(session) => session.userId` binds its own `session`. Text that does not parse
 * returns null — the caller keeps its text test (fail closed).
 */
export function jsTextReadsFreeName(js: string, name: string): boolean | null {
  let program: unknown;
  try {
    program = acornParse(js, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch {
    return null;
  }
  for (const [id, binding] of resolveProgramReferences(program as never)) {
    if ((id as { name?: unknown }).name === name && binding === undefined) return true;
  }
  return false;
}

/** The raw text a node holds unparsed, as the list of code fragments to resolve. */
function rawFragmentsOf(node: Record<string, unknown>): string[] {
  if (node.kind === "escape-hatch" && typeof node.raw === "string") return [node.raw];
  if (node.kind === "lit" && node.litType === "template" && typeof node.raw === "string") return [node.raw];
  if (node.kind === "sql") {
    const out: string[] = [];
    for (const f of ["query", "body"] as const) {
      const q = node[f];
      if (typeof q === "string") for (const i of liveSqlInterpolations(q)) out.push(i.expr);
    }
    return out;
  }
  return [];
}

/**
 * Mark, in a function's tree, every `session` reference that is BOUND locally (and
 * every raw-text node sitting where `session` is bound). Run once per function
 * before route inference reads the tree; idempotent (marks are only ever set).
 */
export function markLocallyBoundSession(fnNode: unknown): void {
  if (!fnNode || typeof fnNode !== "object") return;
  walkScoped(fnNode as { params?: unknown; body?: unknown }, (n, isBound) => {
    if (!isBound("session")) return;
    if ((n.kind === "ident" && n.name === "session") || rawFragmentsOf(n as Record<string, unknown>).length > 0) setMark(n);
  });
}

/**
 * Does this expression read the FREE `session` builtin? Structured idents use the
 * marks `markLocallyBoundSession` set; raw text is resolved with acorn. With no
 * parsed tree, the text itself is resolved (fail closed when unparseable).
 */
export function exprReadsFreeSession(exprNode: unknown, exprString: string | null): boolean {
  if (!exprNode || typeof exprNode !== "object") {
    return typeof exprString === "string" ? rawReadsFreeName(exprString, "session") : false;
  }
  let hit = false;
  const seen = new WeakSet<object>();
  const visit = (n: unknown): void => {
    if (hit || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    const r = n as Record<string, unknown>;
    if (r.kind === "ident" && r.name === "session") { if (!isMarked(r)) hit = true; return; }
    if (!isMarked(r)) {
      for (const frag of rawFragmentsOf(r)) if (rawReadsFreeName(frag, "session")) { hit = true; return; }
    }
    for (const k of Object.keys(r)) if (k !== "span") visit(r[k]);
  };
  visit(exprNode);
  return hit;
}

/**
 * A server-trusted identity read in a parameter default, scope-aware: the
 * `session.*` builtin (member or index, `session` free), the ambient
 * `@currentUser`, and — for a default evaluated in the BROWSER (a CPS-split
 * function's client part) — the `@session` projection too. `defaultExpr` is the
 * parsed default; `params` the function's parameters (they are in scope for it).
 * Returns the read as written (`session.userId`, `@currentUser`, …), or null.
 */
export function identityReadInDefault(
  defaultExpr: unknown,
  params: unknown,
  opts: { currentUserAmbient: boolean; sessionProjection: boolean },
): string | null {
  return identityReadIn({ params, body: [defaultExpr] }, opts);
}

/** The identity read in `owner` (a function's params + body, or a default wrapped as one). */
function identityReadIn(
  owner: { params?: unknown; body?: unknown },
  opts: { currentUserAmbient: boolean; sessionProjection: boolean },
): string | null {
  let hit: string | null = null;
  walkScoped(owner, (n, isBound, link) => {
    if (hit !== null) return;
    const r = n as Record<string, unknown>;
    if (r.kind === "ident" && r.name === "session" && !isBound("session")) {
      const parent = link.parent as Record<string, unknown> | null;
      const isObject = parent && (parent.kind === "member" || parent.kind === "index") && link.key === "object";
      hit = isObject && parent.kind === "member" && typeof parent.property === "string" ? `session.${parent.property}` : "session";
      return;
    }
    if (r.kind === "ident" && r.name === "@currentUser" && opts.currentUserAmbient) { hit = "@currentUser"; return; }
    if (r.kind === "ident" && r.name === "@session" && opts.sessionProjection) {
      const parent = link.parent as Record<string, unknown> | null;
      hit = parent && parent.kind === "member" && link.key === "object" && typeof parent.property === "string" ? `@session.${parent.property}` : "@session";
      return;
    }
    if (!isBound("session")) {
      for (const frag of rawFragmentsOf(r)) if (rawReadsFreeName(frag, "session")) { hit = "session"; return; }
    }
  });
  return hit;
}


/**
 * What a NAME read in a default refers to, for the identity check (s466 fix
 * rounds 5–6; binding-provenance.ts supplies the union of everything that gives
 * the name a value):
 *   - `null` — not a binding of the compilation the check follows (a builtin, a
 *     parameter of an enclosing function, a JS / `scrml:` import);
 *   - `{ owners }` — every value source of the name (a function's params + body,
 *     a `const` / `let` initialiser, an assignment's right-hand side, a cell's
 *     initialiser), each scanned as if inlined;
 *   - `serverCell` — the name is a §52 server-authority cell (`<x server>`): its
 *     value is server-resolved, so a default reading it is an identity read;
 *   - `unresolved` — a binding whose provenance cannot be followed (an import from
 *     a module outside the compilation, a name assigned in raw text). ANY reference
 *     to it fails closed — a value passed along (`pick(h)`), read (`me`), spread,
 *     destructured or called alike.
 */
export type IdentityNameResolution =
  | null
  | {
      owners: Array<{ params?: unknown; body?: unknown }>;
      serverCell?: string | null;
      unresolved?: string | null;
    };

export interface IdentityRead {
  /** The identity read as written (`session.userId`, `@session.userId`, `@acct`), or the unresolved name. */
  read: string;
  /** The binding the read was reached through (the first one the default names), or null. */
  via: string | null;
  /** The default references a binding whose provenance cannot be followed. */
  unresolved: boolean;
  /** Why the provenance cannot be followed (when `unresolved`). */
  why?: string;
}

/** Free names (cells included) a raw fragment reads; unparseable text → every identifier token (over-collects). */
function rawFreeNames(raw: string): string[] {
  const ast = parseScrmlTextToEstree(raw, false) ?? parseScrmlTextToEstree(raw, true);
  if (!ast) {
    const out: string[] = [];
    const re = /(?<![.\w$])@?[A-Za-z_$][\w$]*/g;
    let m: RegExpExecArray | null;
    const text = blankLiteralTextInSource(raw);
    while ((m = re.exec(text)) !== null) out.push(m[0]);
    return out;
  }
  const a = ast as unknown as { type?: string };
  const program = a.type === "Program"
    ? ast
    : ({ type: "Program", sourceType: "module", body: [{ type: "ExpressionStatement", expression: ast }] } as unknown as typeof ast);
  const out: string[] = [];
  for (const [id, binding] of resolveProgramReferences(program as never)) {
    const nm = (id as { name?: unknown }).name;
    if (typeof nm === "string" && binding === undefined) out.push(nm);
  }
  return out;
}

/**
 * `identityReadInDefault`, following EVERY binding the default references (s466
 * fix round 6). With `const getU = () => @session.userId`, `const me =
 * @session.userId`, `let h = …; pick(h)`, `const o = { u: @session.userId }`,
 * `const m = @session` — the defaults `getU()`, `me`, `pick(h)`, `o.u`,
 * `m.userId` are the same identity read as `@session.userId`. A name is followed
 * by REFERENCE, not by use: a function value passed along may be invoked by the
 * callee, a value read may carry the identity, so every free reference is
 * followed into every value source of the name, transitively; a reference to a
 * binding whose provenance cannot be followed fails closed.
 */
export function identityReadInDefaultDeep(
  defaultExpr: unknown,
  params: unknown,
  opts: {
    currentUserAmbient: boolean;
    sessionProjection: boolean;
    /**
     * Does `@session` count in a FOLLOWED binding? Inside a helper the read is not
     * the default's own server context: on the server every `@name` lowering reads
     * the request body, so `@session` there is client-claimed identity too. True
     * unless a file-scope `<session>` cell owns the name.
     */
    helperSessionProjection: boolean;
    resolveName: (name: string) => IdentityNameResolution;
  },
): IdentityRead | null {
  const visited = new Set<string>();
  const scan = (owner: { params?: unknown; body?: unknown }, via: string | null): IdentityRead | null => {
    const direct = identityReadIn(owner, {
      currentUserAmbient: opts.currentUserAmbient,
      sessionProjection: via === null ? opts.sessionProjection : opts.helperSessionProjection,
    });
    if (direct !== null) return { read: direct, via, unresolved: false };
    let hit: IdentityRead | null = null;
    const follow = (name: string): void => {
      if (hit !== null) return;
      if (name === "session" || name === "@session" || name === "@currentUser") return;
      if (visited.has(name)) return;
      visited.add(name);
      const res = opts.resolveName(name);
      if (res === null) return;
      if (res.serverCell) { hit = { read: res.serverCell, via: via ?? (name === res.serverCell ? null : name), unresolved: false }; return; }
      if (res.unresolved) { hit = { read: name, via: via ?? name, unresolved: true, why: res.unresolved }; return; }
      for (const o of res.owners) {
        const sub = scan(o, via ?? name);
        if (sub !== null) { hit = sub; return; }
      }
    };
    walkScoped(owner, (n, isBound) => {
      if (hit !== null) return;
      const r = n as Record<string, unknown>;
      if (r.kind === "ident" && typeof r.name === "string") {
        if (!r.name.startsWith("@") && isBound(r.name)) return;
        follow(r.name);
        return;
      }
      for (const frag of rawFragmentsOf(r)) {
        for (const nm of rawFreeNames(frag)) {
          if (!nm.startsWith("@") && isBound(nm)) continue;
          follow(nm);
          if (hit !== null) return;
        }
      }
    });
    return hit;
  };
  return scan({ params, body: [defaultExpr] }, null);
}
