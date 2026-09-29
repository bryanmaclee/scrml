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
/**
 * s441 (g-sync-local-with-async-name-treated-async) — a call / by-reference ident
 * that CERTAINLY resolves to a SYNC function declared in an enclosing scope, whose
 * NAME is also an async outer name (`function verifyPassword(a, b) { return a - b }`
 * beside an imported `verifyPassword`). The binding in scope decides, not the name:
 * the sites that FAIL CLOSED on an async name (a `.sort` comparator, a sync
 * callback) read this mark and stand down. It never removes an `await` — an awaited
 * sync value is the same value — so a wrong resolution can only cost a diagnostic in
 * a non-awaitable position, and the resolver it rests on is the block-scoped one the
 * s440 fix round (F1) hardened.
 */
export const LOCAL_SYNC_SHADOW_MARK = "_scrmlLocalSyncShadow";
/**
 * s441 (g-sync-callback-rawtext-scan-false-positives) — the scope-aware async
 * analysis of a RAW fragment (a block-body callback / template literal escape-hatch,
 * a parameter default): which async calls and async-function values it holds,
 * resolved against the scrml scope it sits in. Absent → not analysed (no annotate
 * run, or the text did not parse) — consumers fall back to their name scan.
 */
export const RAW_ASYNC_MARK = "_scrmlRawAsync";
/**
 * s441 fix round — a `call` whose bare-ident callee is BOUND by the program (a
 * local / param / nested fn in scope, or a file-scope binding per
 * `LocalAsyncAnnotateOpts.isFileBound`). Read by the fire-and-forget scheduler
 * exemptions: only the GLOBAL `setTimeout` & co. discard the callback's return.
 */
export const BOUND_CALLEE_MARK = "_scrmlBoundCallee";

const MARK_KEYS = new Set<string>([LOCAL_CALLEE_MARK, LOCAL_REF_MARK, LOCAL_ASYNC_DECL_MARK, LOCAL_SYNC_SHADOW_MARK, RAW_ASYNC_MARK, BOUND_CALLEE_MARK]);

/** Does this call / ident certainly resolve to a SYNC nested function (see LOCAL_SYNC_SHADOW_MARK)? */
export function localSyncShadowOf(node: unknown): boolean {
  return !!node && typeof node === "object" && (node as ASTNode)[LOCAL_SYNC_SHADOW_MARK] === true;
}

/** How a name resolves async-wise at a point (see js-async-analysis `ResolvedAsync`). */
export interface ResolvedAsyncName {
  root: AsyncRoot;
  /** A function declared inside the enclosing scrml function (a nested helper). */
  local: boolean;
}

/** The RAW_ASYNC_MARK payload. */
export interface RawAsyncUses {
  calls: Array<ResolvedAsyncName & { name: string }>;
  escapes: Array<ResolvedAsyncName & { name: string; position: string }>;
}

/** The scope-aware raw analysis of a raw-text node (or a param object), or null. */
export function rawAsyncUsesOf(node: unknown): RawAsyncUses | null {
  if (!node || typeof node !== "object") return null;
  const m = (node as ASTNode)[RAW_ASYNC_MARK];
  return m && typeof m === "object" ? (m as RawAsyncUses) : null;
}

/**
 * s441 (S440 F4) — an async-colored function used as a VALUE: aliased, stored in an
 * array/object, passed to a function that is not an awaited collection method,
 * returned, or read as an object. Reported as E-ASYNC-FN-ESCAPES-AS-VALUE.
 */
export interface AsyncEscapeSite extends ResolvedAsyncName {
  name: string;
  position: string;
  span: unknown;
}

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
 * The structural parent of a visited node: the owning AST node, the key it sits
 * under, and its index when that key holds an array (call `args`, array
 * `elements`, …). Arrays are transparent — an element's parent is the node that
 * owns the array.
 */
interface ParentLink {
  parent: ASTNode | null;
  key: string | null;
  index: number;
  /** The nearest enclosing span with a REAL line/col (a diagnostic anchor). */
  anchor?: unknown;
}

/**
 * Walk every node under `root` with its lexical scope, calling `onCall` for each
 * call and `onIdent` for each ident (with its structural parent). `onNode`, when
 * given, sees every non-array node. `root` is a scope-owning node whose scope is
 * `rootScope`. Nested `function-decl` / `lambda` nodes and statement arrays open
 * child scopes (cached in `scopes` so the fixpoint and the marking pass share them).
 */
function walkWithScopes(
  root: ASTNode,
  rootScope: Scope,
  scopes: Map<object, Scope>,
  onCall: (call: ASTNode, scope: Scope) => void,
  onIdent: (ident: ASTNode, scope: Scope, link: ParentLink) => void,
  stopAtNestedFns: boolean,
  onNode?: (node: ASTNode, scope: Scope, link: ParentLink) => void,
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
  const visit = (node: unknown, scope: Scope, link: ParentLink): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      const block = blockFor(node, scope);
      for (let i = 0; i < node.length; i++) visit(node[i], block, { parent: link.parent, key: link.key, index: i, anchor: link.anchor });
      return;
    }
    const n = node as ASTNode;
    const anchor = hasRealPosition(n.span) ? n.span : link.anchor;
    if (onNode) onNode(n, scope, link);
    if (isFnDecl(n)) {
      if (stopAtNestedFns) return;
      const inner = scopeFor(n, scope);
      // A param default is evaluated in the function's own scope.
      visit(n.params, inner, { parent: n, key: "params", index: -1, anchor });
      visit(n.body, inner, { parent: n, key: "body", index: -1, anchor });
      return;
    }
    if (n.kind === "lambda") {
      const inner = scopeFor(n, scope);
      visit(n.params, inner, { parent: n, key: "params", index: -1, anchor });
      visit(n.body, inner, { parent: n, key: "body", index: -1, anchor });
      return;
    }
    if (n.kind === "call") onCall(n, scope);
    else if (n.kind === "ident") onIdent(n, scope, link);
    for (const key of Object.keys(n)) {
      if (key === "span" || MARK_KEYS.has(key)) continue;
      const v = n[key];
      if (v && typeof v === "object") visit(v, scope, { parent: n, key, index: -1, anchor });
    }
  };
  const rootAnchor = hasRealPosition(root.span) ? root.span : undefined;
  visit(root.params, rootScope, { parent: root, key: "params", index: -1, anchor: rootAnchor });
  visit(root.body, rootScope, { parent: root, key: "body", index: -1, anchor: rootAnchor });
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
  /**
   * s441 (S440 F4) — what may a call do with an async-colored function passed as
   * argument `index`? `allowed`: the first argument of an awaited collection method
   * (`.some`/`.filter`/… — lifted to the async combinator) or an argument of a
   * fire-and-forget scheduler (`setTimeout` — it discards the return); `own-code`: a
   * sync consumer that already fails closed (`.sort(inner)`); `escape`: anything else.
   * Absent → every argument is an escape. Injected (async-combinators imports this module).
   */
  fnArgRole?: (call: ASTNode, index: number) => "allowed" | "own-code" | "escape";
  /**
   * s441 (FP1) — the scope-aware raw-fragment analyser (js-async-analysis
   * `analyzeRawJsFragment`), injected to keep this module dependency-neutral.
   */
  analyzeRaw?: (raw: string, resolveFree: ((name: string) => ResolvedAsyncName | null) & { isBound?: (name: string) => boolean }) => RawAsyncUses | null;
  /** s441 (S440 F4) — sink for every async-colored function used as a value. */
  escapes?: AsyncEscapeSite[];
  /**
   * s441 (S440 F4) — the outer names that are async-colored for the ESCAPE rule,
   * when narrower than `outerAsync` (the await facts). The server emitter awaits
   * every in-process peer, including a plain helper that route inference placed on
   * the server only because a server fn references it; that helper is not an
   * async-colored function in the ruling's sense (a server fn, an async stdlib
   * function, or a helper that calls one), so it may be aliased. Absent →
   * `outerAsync`.
   */
  escapeOuterAsync?: (name: string) => AsyncRoot | null;
  /**
   * s441 fix round — does the FILE bind `name` (file-scope fn / top-level decl /
   * import)? A bare callee bound here or in an enclosing scope is marked
   * BOUND_CALLEE_MARK — it is not the global scheduler of the same name.
   */
  isFileBound?: (name: string) => boolean;
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
  // s441 — no early return when there are no nested functions: the escape check
  // (S440 F4), the sync-shadow marks and the raw-fragment analysis apply to every
  // function body, nested helpers or not.
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
      // A SYNC nested fn that shares an async outer name keeps its awaits (a sync-
      // shadow mark only stands down a fail-closed site, never an `await`), so the
      // call may still await in THIS body. Count the outer root either way (fail closed).
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
        // of a function argument is unknown (a scheduler discards it; S440 F4 makes
        // every other value use a compile error), so it does not make THIS body await.
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

  // Pass 4 — mark. An ASYNC resolution is recorded on the call / ident (fix round,
  // F1): the mark adds an await or a rejection. A resolution to a SYNC nested
  // function is recorded ONLY as the sync-shadow mark (s441, FP2), which the
  // fail-closed sites read and nothing else — an async outer name is never demoted
  // to a bare call. An unresolved name with an async same-named declaration in a
  // non-enclosing block (the Annex B ambiguity) is marked async too.
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
  const isSyncShadow = (name: string, scope: Scope): boolean => {
    const r = resolve(name, scope);
    return !!r && "fn" in r && !asyncRoot.has(r.fn);
  };
  // s441 — is `name`, at this point, an async-colored function (and why)? The
  // binding in scope decides; a free name asks the emitter's outer facts.
  const resolveAsyncAt = (name: string, scope: Scope): ResolvedAsyncName | null => {
    const local = asyncResolution(name, scope);
    if (local && local.root) return { root: local.root, local: true };
    if (resolve(name, scope)) return null;
    const outer = opts.outerAsync(name);
    return outer ? { root: outer, local: false } : null;
  };
  const escapeSink = opts.escapes ?? null;
  const escapeOuter = opts.escapeOuterAsync ?? opts.outerAsync;
  const reportEscape = (name: string, res: ResolvedAsyncName, position: string, span: unknown): void => {
    if (!escapeSink) return;
    if (!res.local && !escapeOuter(name)) return;
    escapeSink.push({ name, root: res.root, local: res.local, position, span });
  };
  // The RAW fragments this function emits verbatim — analysed with the scope they
  // sit in (s441, FP1). The analysis result rides on the node for the drains.
  const markRaw = (holder: ASTNode, raw: string, scope: Scope, span: unknown): void => {
    if (!opts.analyzeRaw) { delete holder[RAW_ASYNC_MARK]; return; }
    const resolveFree = Object.assign((nm: string) => resolveAsyncAt(nm, scope), {
      isBound: (nm: string): boolean => !!resolve(nm, scope) || !!(opts.isFileBound && opts.isFileBound(nm)),
    });
    const uses = opts.analyzeRaw(raw, resolveFree);
    if (!uses) { delete holder[RAW_ASYNC_MARK]; return; }
    holder[RAW_ASYNC_MARK] = uses;
    for (const e of uses.escapes) reportEscape(e.name, e, e.position, span);
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
      if (!res && nm && isSyncShadow(nm, scope)) call[LOCAL_SYNC_SHADOW_MARK] = true;
      else delete call[LOCAL_SYNC_SHADOW_MARK];
      const _bare = (call.callee as ASTNode | undefined)?.kind === "ident" ? calleeName(call) : null;
      if (_bare && (resolve(_bare, scope) || (opts.isFileBound && opts.isFileBound(_bare)))) call[BOUND_CALLEE_MARK] = true;
      else delete call[BOUND_CALLEE_MARK];
    },
    (ident, scope, link) => {
      const nm = typeof ident.name === "string" ? ident.name : null;
      const res = nm ? asyncResolution(nm, scope) : null;
      if (res) ident[LOCAL_REF_MARK] = res;
      else delete ident[LOCAL_REF_MARK];
      if (!res && nm && isSyncShadow(nm, scope)) ident[LOCAL_SYNC_SHADOW_MARK] = true;
      else delete ident[LOCAL_SYNC_SHADOW_MARK];
      // s441 (S440 F4) — an async-colored function used as a VALUE.
      if (!nm || !escapeSink) return;
      const asyncRes = resolveAsyncAt(nm, scope);
      if (!asyncRes) return;
      const position = valuePositionOf(link, opts.fnArgRole);
      if (position) reportEscape(nm, asyncRes, position, anchorDiagnosticSpan(ident.span, link.anchor));
    },
    false,
    (node, scope, link) => {
      // A `{ m }` shorthand property stores the binding `m` as a value.
      if (node.kind === "shorthand" && typeof node.name === "string" && escapeSink) {
        const asyncRes = resolveAsyncAt(node.name, scope);
        if (asyncRes) reportEscape(node.name, asyncRes, "stored in an object", anchorDiagnosticSpan(node.span, link.anchor));
      }
      // Raw fragments: a block-body callback / raw expression, a template literal.
      if ((node.kind === "escape-hatch" || (node.kind === "lit" && node.litType === "template")) &&
          typeof node.raw === "string") {
        markRaw(node, node.raw, scope, anchorDiagnosticSpan(node.span, link.anchor));
      }
      // A parameter's text default (spliced verbatim by `paramSignature`).
      if (link.key === "params" && typeof node.defaultValue === "string" && node.defaultValue.trim() !== "") {
        markRaw(node, node.defaultValue, scope, anchorDiagnosticSpan(node.span, link.anchor));
      }
    },
  );
  return asyncRoot.size;
}

/**
 * s441 (S440 F4) — where does an ident that names an async-colored function sit,
 * as a VALUE? `null` when the position is not a value use: the callee of a call
 * (awaited / failed closed by the call machinery), an assignment target, or an
 * argument the call sanctions (`fnArgRole`: the first argument of an awaited
 * collection method, an argument of a fire-and-forget scheduler, or a sync
 * consumer with its own fail-closed code).
 */
function valuePositionOf(
  link: ParentLink,
  fnArgRole?: (call: ASTNode, index: number) => "allowed" | "own-code" | "escape",
): string | null {
  const p = link.parent;
  if (!p) return "used as a value";
  const kind = p.kind as string | undefined;
  switch (kind) {
    case "call": {
      if (link.key === "callee") return null;
      if (link.key === "args") {
        const role = fnArgRole ? fnArgRole(p, link.index) : "escape";
        if (role !== "escape") return null;
        const callee = p.callee as ASTNode | undefined;
        const calleeText = calleeTextOf(callee);
        return calleeText ? `passed as an argument to \`${calleeText}\`` : "passed as an argument";
      }
      return "used as a value";
    }
    case "new":
      if (link.key === "callee") return "constructed with `new`";
      return "passed as an argument to a constructor";
    case "member":
    case "index":
      return link.key === "object" ? "used as an object (a member read or `.call`/`.bind`)" : "used as a value";
    case "array": return "stored in an array";
    case "prop": return "stored in an object";
    case "spread": return "spread as a value";
    case "assign": return link.key === "target" ? null : "assigned to a variable or property";
    case "unary":
      // `typeof m` inspects the value without calling it — nothing can await wrong.
      if ((p as { op?: unknown }).op === "typeof") return null;
      return "used as an operand";
    case "ternary":
    case "binary":
      return "used as an operand";
    case "expr": return "returned as a value"; // a lambda's concise body
    case "return-stmt": return "returned as a value";
    case "let-decl":
    case "const-decl":
    case "tilde-decl":
    case "lin-decl":
    case "state-decl":
      return "aliased by a variable declaration";
    default: return "used as a value";
  }
}

/** A short source-like rendering of a callee (`drive`, `Array.from`), or null. */
function calleeTextOf(callee: ASTNode | undefined): string | null {
  if (!callee) return null;
  if (callee.kind === "ident" && typeof callee.name === "string") return callee.name;
  if (callee.kind === "member" && typeof callee.property === "string") {
    const obj = calleeTextOf(callee.object as ASTNode | undefined);
    return obj ? `${obj}.${callee.property}` : `….${callee.property}`;
  }
  return null;
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
