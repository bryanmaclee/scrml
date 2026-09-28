/**
 * @module codegen/local-async-fns
 *
 * s440-sync-callback-async-helper (SECURITY) — async coloring for NESTED helpers.
 *
 * ── THE BUG THIS CLOSES ─────────────────────────────────────────────────────────
 * Every async-colored set the emitters consult is built from FILE-SCOPE functions
 * only: `computeAsyncFnNames(fns, …)` (emit-library-shared.ts) is handed the list of
 * top-level fn nodes, and the server peer set (`serverFnNames`) is likewise the
 * top-level server fns. A function declared INSIDE another function was in none of
 * them. Its own emission still came out `async` — `case "function-decl"` in
 * emit-logic.ts adds the keyword whenever the emitted body text contains an
 * `await` — so the compiler produced an async function and then, at every call
 * site, treated the name as SYNC:
 *
 *     function go() {
 *       function inner(x) { return isOk(x) }          // isOk: a server fn
 *       const any = [1, 2, 3].some(x => inner(x))
 *     }
 *
 *   emitted
 *
 *     async function inner(x) { return await _scrml_fetch_isOk_6(x); }
 *     const any = [1, 2, 3].some((x) => inner(x));     // a Promise: always truthy
 *
 * `.some` is TRUE for every input — the accept-all shape `E-ASYNC-STDLIB-IN-SYNC-
 * CALLBACK` / `E-SERVER-FN-IN-SYNC-CALLBACK` exist to make impossible (§13.2, §34).
 * The same hole left a DIRECT `const r = inner(5)` un-awaited (r is a Promise), a
 * `.sort(inner)` comparator returning Promises, and a nested `a → b → server fn`
 * chain with `a` not even emitted async.
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────────
 * A structural pre-pass over ONE top-level function (and everything nested in it),
 * run by each emitter with that emitter's own outer async facts, BEFORE the body is
 * emitted. It resolves every identifier lexically to its nearest binding, computes
 * which nested `function` declarations are async (a fixpoint — `a` calling `b`
 * calling a server fn makes both async), and MARKS the AST:
 *
 *   - a nested `function-decl` the compiler must emit `async`   → LOCAL_ASYNC_DECL_MARK
 *   - a `call` whose callee resolves to a nested `function-decl` → LOCAL_CALLEE_MARK
 *   - an `ident` that resolves to a nested `function-decl`
 *     (a by-reference use — `.some(inner)` / `.sort(inner)`)      → LOCAL_REF_MARK
 *
 * Every consumer that asks "is this callee async?" — emit-expr's call lowering and
 * receiver wrap, the combinator detector (`callbackReachesAsync`), the fail-closed
 * drain (`collectNonAwaitableAsyncCalls`) and the nested-decl emitter — reads the
 * mark first. A nested async helper is therefore awaited in every awaitable
 * position, lifted to the async combinator in a clean-family callback exactly as a
 * file-scope helper is, and FAILS CLOSED in every position the compiler cannot
 * await (a `.sort` comparator, a sync lambda, a parameter default).
 *
 * The mark carries the ROOT of the asyncness (the server fn / stdlib call the chain
 * bottoms out in), so the diagnostic names the right code: a helper that is async
 * because it calls a peer SERVER function reports E-SERVER-FN-IN-SYNC-CALLBACK; one
 * that is async because of a Promise-returning stdlib call (or a `?{}` body on the
 * server) reports E-ASYNC-STDLIB-IN-SYNC-CALLBACK.
 *
 * Marks are recomputed (set OR deleted) on every run, so the client and server
 * emissions of the same AST each see their own facts.
 *
 * Dependency-neutral (no codegen imports) — async-combinators.ts reads the marks.
 */

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

/** Why a nested helper is async — the call its chain bottoms out in. */
export interface AsyncRoot {
  /**
   * `server` — a peer server-boundary function (→ E-SERVER-FN-IN-SYNC-CALLBACK).
   * `stdlib` — a Promise-returning stdlib/vendor export, a transitively-async local
   *            peer, or a `?{}`/foreign body (→ E-ASYNC-STDLIB-IN-SYNC-CALLBACK).
   */
  kind: "server" | "stdlib";
  /** The name of the async call at the bottom of the chain (`isOk`, `verifyPassword`). */
  via: string;
}

/** The resolution recorded on a call / ident that names a nested function. */
export interface LocalFnResolution {
  /** The nested function's name. */
  name: string;
  /** True iff the compiler emits that function `async`. */
  async: boolean;
  /** Present iff `async`. */
  root: AsyncRoot | null;
}

export const LOCAL_CALLEE_MARK = "_scrmlLocalCallee";
export const LOCAL_REF_MARK = "_scrmlLocalFnRef";
export const LOCAL_ASYNC_DECL_MARK = "_scrmlLocalAsync";

const MARK_KEYS = new Set<string>([LOCAL_CALLEE_MARK, LOCAL_REF_MARK, LOCAL_ASYNC_DECL_MARK]);

/** The nested-function resolution of a CALL node, or null when its callee is not one. */
export function localCalleeOf(node: unknown): LocalFnResolution | null {
  if (!node || typeof node !== "object") return null;
  const m = (node as ASTNode)[LOCAL_CALLEE_MARK];
  return m && typeof m === "object" ? (m as LocalFnResolution) : null;
}

/** The nested-function resolution of an IDENT node (a by-reference use), or null. */
export function localFnRefOf(node: unknown): LocalFnResolution | null {
  if (!node || typeof node !== "object") return null;
  const m = (node as ASTNode)[LOCAL_REF_MARK];
  return m && typeof m === "object" ? (m as LocalFnResolution) : null;
}

/** The async root of a nested `function-decl` the compiler must emit `async`, or null. */
export function localAsyncDeclRoot(node: unknown): AsyncRoot | null {
  if (!node || typeof node !== "object") return null;
  const m = (node as ASTNode)[LOCAL_ASYNC_DECL_MARK];
  return m && typeof m === "object" ? (m as AsyncRoot) : null;
}

// ---------------------------------------------------------------------------
// Scope model
// ---------------------------------------------------------------------------

interface Scope {
  parent: Scope | null;
  /** Nested `function` declarations bound in this scope (hoisted within it). */
  fns: Map<string, ASTNode>;
  /**
   * Every other binding this scope CERTAINLY makes: params, and `let`/`const`/`lin`/
   * tilde decls that are direct statements of the block. Only certain bindings may
   * shadow a function — a shadow decision is the fail-OPEN direction (it can demote
   * an async call to a bare one), so an uncertain one is never taken (fix round, F3).
   */
  others: Set<string>;
}

const DECL_KINDS = new Set(["let-decl", "const-decl", "tilde-decl", "lin-decl"]);

/** The leading identifier of a param entry (`"x"`, `"x:Type"`, `"x = 1"`, `{name}`). */
function paramIdent(p: unknown): string | null {
  const raw = typeof p === "string" ? p : (p && typeof p === "object" ? (p as ASTNode).name : undefined);
  if (typeof raw !== "string") return null;
  const m = raw.trim().replace(/^\.\.\./, "").match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
  return m ? m[0] : null;
}

function isFnDecl(n: ASTNode): boolean {
  return n.kind === "function-decl" && n.fromExport !== true;
}

function calleeName(call: ASTNode): string | null {
  if (typeof call.name === "string" && call.name) return call.name;
  const c = call.callee as ASTNode | undefined;
  if (c && c.kind === "ident" && typeof c.name === "string") return c.name;
  return null;
}

/** A function / lambda owner's own scope: its parameters. */
function populateScope(owner: ASTNode, scope: Scope): void {
  for (const p of (Array.isArray(owner.params) ? owner.params : [])) {
    const nm = paramIdent(p);
    if (nm) scope.others.add(nm);
  }
}

/**
 * s440 fix round (F1/F3) — a statement ARRAY is a BLOCK scope. A `function`
 * declaration inside `if (…) { … }` is visible only inside that block (strict-mode
 * / module semantics — what the compiler emits), and a `let`/`const` in a sibling
 * block shadows nothing outside it. The first draft registered every nested
 * declaration at FUNCTION scope, so `if (false) { function verifyPassword(){…} }`
 * made the REAL `verifyPassword(pw, h)` after it look like a sync local (emitted
 * unawaited — every password accepted), and a sibling-block `let inner = 5` made a
 * nested async `inner` look like a plain binding. Registering each block's DIRECT
 * statements (hoisted within the block) gives both their real extent.
 */
function populateBlock(arr: unknown[], scope: Scope): void {
  for (const c of arr) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const n = c as ASTNode;
    if (isFnDecl(n)) {
      if (typeof n.name === "string" && n.name) scope.fns.set(n.name, n);
    } else if (typeof n.kind === "string" && DECL_KINDS.has(n.kind) && typeof n.name === "string") {
      const nm = paramIdent(n.name);
      if (nm) scope.others.add(nm);
    }
  }
}

type Resolved = { fn: ASTNode } | { binding: true } | null;

/** Resolve `name` from `scope` outward. `null` → not bound anywhere in this function. */
function resolve(name: string, scope: Scope | null): Resolved {
  for (let s = scope; s; s = s.parent) {
    // A `function` and a same-named `let` in ONE scope is a JS redeclaration error;
    // prefer the function (the fail-closed read: it may be async).
    const f = s.fns.get(name);
    if (f) return { fn: f };
    if (s.others.has(name)) return { binding: true };
  }
  return null;
}

/**
 * Walk every node under `root` with its lexical scope, calling `onCall` for each
 * call and `onIdent` for each ident. `root` is a scope-owning node whose scope is
 * `rootScope`. Nested `function-decl` / `lambda` nodes and statement arrays open
 * child scopes (cached in `scopes` so the fixpoint and the marking pass share them).
 */
function walkWithScopes(
  root: ASTNode,
  rootScope: Scope,
  scopes: Map<object, Scope>,
  onCall: (call: ASTNode, scope: Scope) => void,
  onIdent: (ident: ASTNode, scope: Scope) => void,
  stopAtNestedFns: boolean,
): void {
  const seen = new WeakSet<object>();
  const scopeFor = (owner: ASTNode, parent: Scope): Scope => {
    let s = scopes.get(owner);
    if (!s) {
      s = { parent, fns: new Map(), others: new Set() };
      populateScope(owner, s);
      scopes.set(owner, s);
    }
    return s;
  };
  const blockFor = (arr: unknown[], parent: Scope): Scope => {
    let s = scopes.get(arr);
    if (!s) {
      s = { parent, fns: new Map(), others: new Set() };
      populateBlock(arr, s);
      scopes.set(arr, s);
    }
    return s;
  };
  const visit = (node: unknown, scope: Scope): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      const block = blockFor(node, scope);
      for (const c of node) visit(c, block);
      return;
    }
    const n = node as ASTNode;
    if (isFnDecl(n)) {
      if (stopAtNestedFns) return;
      const inner = scopeFor(n, scope);
      // A param default is evaluated in the function's own scope.
      visit(n.params, inner);
      visit(n.body, inner);
      return;
    }
    if (n.kind === "lambda") {
      const inner = scopeFor(n, scope);
      visit(n.params, inner);
      visit(n.body, inner);
      return;
    }
    if (n.kind === "call") onCall(n, scope);
    else if (n.kind === "ident") onIdent(n, scope);
    for (const key of Object.keys(n)) {
      if (key === "span" || MARK_KEYS.has(key)) continue;
      const v = n[key];
      if (v && typeof v === "object") visit(v, scope);
    }
  };
  visit(root.params, rootScope);
  visit(root.body, rootScope);
}

export interface LocalAsyncAnnotateOpts {
  /**
   * The emitter's OUTER async facts: is the unbound (file-scope / imported) name
   * `name` async, and why? Return null for a sync name. Supplied per emission mode
   * (client: server fns + client async peers + stdlib; server: peer server fns +
   * stdlib; library/tool: the library async set + stdlib).
   */
  outerAsync: (name: string) => AsyncRoot | null;
  /**
   * Does a nested body containing a `?{}` SQL / foreign block lower to an `await`
   * in this emission? True on the server / library paths; false on the client
   * (where such a body never emits — its enclosing fn escalates to the server).
   */
  sqlIsAsync: boolean;
  /** `bodyHasForeignOrSql` — injected to keep this module dependency-neutral. */
  bodyHasSql?: (body: unknown) => boolean;
  /**
   * Is `call` a collection-method call that invokes a by-reference function
   * argument — a clean-family combinator or a `SYNC_CALLBACK_CONSUMER_METHODS`
   * member (injected: async-combinators.ts imports this module).
   */
  isByRefInvokingCall?: (call: ASTNode) => boolean;
}

/**
 * Annotate one TOP-LEVEL function (`fnNode`) and everything nested in it. Returns
 * the number of nested functions marked async (diagnostic / test aid).
 */
export function annotateLocalAsyncFns(fnNode: unknown, opts: LocalAsyncAnnotateOpts): number {
  if (!fnNode || typeof fnNode !== "object") return 0;
  const fn = fnNode as ASTNode;
  const scopes = new Map<object, Scope>();
  const rootScope: Scope = { parent: null, fns: new Map(), others: new Set() };
  populateScope(fn, rootScope);
  scopes.set(fn, rootScope);

  // Pass 1 — build every scope and collect every nested function declaration.
  const nestedFns: ASTNode[] = [];
  walkWithScopes(fn, rootScope, scopes, () => {}, () => {}, false);
  for (const [owner] of scopes) {
    if (owner !== fn && !Array.isArray(owner) && isFnDecl(owner as ASTNode)) nestedFns.push(owner as ASTNode);
  }
  if (nestedFns.length === 0) {
    clearMarks(fn);
    return 0;
  }
  // Every nested declaration by name, wherever it sits — for the AMBIGUOUS case.
  const declsByName = new Map<string, ASTNode[]>();
  for (const d of nestedFns) {
    const nm = String(d.name);
    const list = declsByName.get(nm) ?? [];
    list.push(d);
    declsByName.set(nm, list);
  }

  // Pass 2 — per nested fn, the async TRIGGERS in its OWN body (not crossing into a
  // further-nested function, whose body is its own; lambdas ARE crossed — an async
  // call in a combinator callback is awaited in this body, and one in a sync lambda
  // fails closed regardless). A trigger is a call to, or a by-reference use of,
  // either an outer async name or another nested function.
  type Trigger = { root: AsyncRoot } | { fn: ASTNode };
  const triggers = new Map<ASTNode, Trigger[]>();
  for (const d of nestedFns) {
    const list: Trigger[] = [];
    const dScope = scopes.get(d)!;
    const consider = (name: string, scope: Scope): void => {
      const r = resolve(name, scope);
      if (r && !("fn" in r)) return; // a certain non-function local: not an async trigger
      // A SYNC nested fn that shares an async outer name carries no call-site mark,
      // so the call keeps the outer name's (awaiting) treatment — which makes THIS
      // body await. Count the outer root either way (fail closed).
      const root = opts.outerAsync(name);
      if (root) list.push({ root });
      if (r) { list.push({ fn: r.fn }); return; }
      // Unresolved, but a same-named declaration sits in a NON-enclosing block:
      // under sloppy-mode (Annex B) hoisting it could be the one called. Ambiguous
      // → count it (fail closed).
      for (const other of declsByName.get(name) ?? []) list.push({ fn: other });
    };
    walkWithScopes(
      d, dScope, scopes,
      (call, scope) => {
        const nm = calleeName(call);
        if (nm) consider(nm, scope);
        // A by-reference ARGUMENT to a collection method (`xs.some(b)` / `xs.sort(b)`):
        // the method invokes it — awaited through the async combinator (so this body
        // awaits), or failed closed. Only those calls; any other callee's handling
        // of a function argument is unknown (a scheduler discards it, a user HOF may
        // await it), so it does not make THIS body await.
        if (!opts.isByRefInvokingCall || !opts.isByRefInvokingCall(call)) return;
        for (const a of (Array.isArray(call.args) ? call.args : [])) {
          const an = a as ASTNode | null;
          if (an && an.kind === "ident" && typeof an.name === "string") consider(an.name, scope);
        }
      },
      () => {},
      true,
    );
    if (opts.sqlIsAsync && opts.bodyHasSql && opts.bodyHasSql(d.body)) {
      list.push({ root: { kind: "stdlib", via: "?{}" } });
    }
    triggers.set(d, list);
  }

  // Pass 3 — fixpoint.
  const asyncRoot = new Map<ASTNode, AsyncRoot>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of nestedFns) {
      if (asyncRoot.has(d)) continue;
      for (const t of triggers.get(d)!) {
        const r = "root" in t ? t.root : asyncRoot.get(t.fn);
        if (r) { asyncRoot.set(d, r); changed = true; break; }
      }
    }
  }

  // Pass 4 — mark. ONLY an ASYNC resolution is recorded (fix round, F1): a call that
  // resolves to a SYNC nested function carries no mark and keeps the name-based
  // treatment every other call gets. A mark can therefore only ever ADD an await or
  // a rejection — it can never demote an async outer name to a bare call, whatever
  // the resolver gets wrong. An unresolved name with an async same-named declaration
  // in a non-enclosing block (the Annex B ambiguity) is marked async too.
  const asyncResolution = (name: string, scope: Scope): LocalFnResolution | null => {
    const r = resolve(name, scope);
    if (r && "fn" in r) {
      const root = asyncRoot.get(r.fn);
      return root ? { name, async: true, root } : null;
    }
    if (r) return null;
    for (const other of declsByName.get(name) ?? []) {
      const root = asyncRoot.get(other);
      if (root) return { name, async: true, root };
    }
    return null;
  };
  for (const d of nestedFns) {
    const r = asyncRoot.get(d);
    if (r) d[LOCAL_ASYNC_DECL_MARK] = r;
    else delete d[LOCAL_ASYNC_DECL_MARK];
  }
  walkWithScopes(
    fn, rootScope, scopes,
    (call, scope) => {
      const nm = calleeName(call);
      const res = nm ? asyncResolution(nm, scope) : null;
      if (res) call[LOCAL_CALLEE_MARK] = res;
      else delete call[LOCAL_CALLEE_MARK];
    },
    (ident, scope) => {
      const res = typeof ident.name === "string" ? asyncResolution(ident.name, scope) : null;
      if (res) ident[LOCAL_REF_MARK] = res;
      else delete ident[LOCAL_REF_MARK];
    },
    false,
  );
  return asyncRoot.size;
}

/** Remove every mark under `fn` (a function with no nested declarations). */
function clearMarks(fn: ASTNode): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const c of node) visit(c); return; }
    const n = node as ASTNode;
    for (const k of MARK_KEYS) if (k in n) delete n[k];
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(fn.params);
  visit(fn.body);
}

/**
 * The names of the nested functions a top-level body CALLS DIRECTLY (outside any
 * further-nested function), paired with the callees of those functions' own bodies,
 * transitively. Used by `computeAsyncFnNames`'s guarded (library) walk, which does
 * not descend into nested function bodies: an enclosing function that CALLS an async
 * nested helper awaits it, so it is itself async even though the async call lives in
 * the helper's body. Resolution is by name within `body` (the guarded walk has no
 * scope tracker either).
 */
export function calleesThroughDirectlyCalledNestedFns(
  body: unknown,
  collectDirectCallees: (node: unknown, out: Set<string>) => void,
): Set<string> {
  const out = new Set<string>();
  const nested = new Map<string, ASTNode>();
  const seen = new WeakSet<object>();
  const gather = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const c of node) gather(c); return; }
    const n = node as ASTNode;
    if (isFnDecl(n) && typeof n.name === "string" && n.name && !nested.has(n.name)) nested.set(n.name, n);
    for (const key of Object.keys(n)) {
      if (key === "span" || MARK_KEYS.has(key)) continue;
      const v = n[key];
      if (v && typeof v === "object") gather(v);
    }
  };
  gather(body);
  if (nested.size === 0) return out;
  const direct = new Set<string>();
  collectDirectCallees(body, direct);
  const queue = [...direct].filter((n) => nested.has(n));
  const done = new Set<string>();
  while (queue.length > 0) {
    const nm = queue.pop()!;
    if (done.has(nm)) continue;
    done.add(nm);
    const inner = new Set<string>();
    collectDirectCallees(nested.get(nm)!.body, inner);
    for (const c of inner) {
      out.add(c);
      if (nested.has(c) && !done.has(c)) queue.push(c);
    }
  }
  return out;
}

/**
 * s440 — does `span` carry a REAL source position? Expression-parser spans
 * (expression-parser.ts) are built with a placeholder `line: 1, col: 1` and a
 * block-relative offset, so a diagnostic anchored on a call INSIDE a lambda pointed
 * at `1:1` of the file. Statement spans from the ast-builder carry the real
 * line/col.
 */
function hasRealPosition(span: unknown): boolean {
  if (!span || typeof span !== "object") return false;
  const sp = span as { line?: unknown; col?: unknown };
  return typeof sp.line === "number" && typeof sp.col === "number" && !(sp.line === 1 && sp.col === 1);
}

/**
 * s440 — the span to report a sync-callback site at: the call's own span when it
 * carries a real position, else the nearest enclosing statement's span (the
 * emit-side `ctx.stmtSpan`, or the drain's walk anchor). A diagnostic that points
 * at `1:1` does not locate the defect it names.
 */
export function anchorDiagnosticSpan(span: unknown, anchor: unknown): unknown {
  if (hasRealPosition(span)) return span;
  if (hasRealPosition(anchor)) return anchor;
  return span ?? anchor;
}
