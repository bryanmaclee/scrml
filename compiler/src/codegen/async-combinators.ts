/**
 * @module codegen/async-combinators
 *
 * Phase-2 colorless-async — the async-callback collection-method combinator
 * transform (DD `colorless-async-boundaries-2026-07-16.md` §2 position 1, FORK 1,
 * RATIFIED S259). When a CLEAN-FAMILY collection method
 * (`some`/`every`/`find`/`findIndex`/`filter`/`map`/`forEach`/`reduce`/`flatMap`)
 * is called with an ASYNC callback (a callback whose body transitively reaches a
 * Promise-returning primitive), the compiler cannot inject `await` inside the
 * SYNC callback body a native `.method` requires — so a bare
 * `hs.some(h => verifyPassword(pw, h))` ships a truthy Promise (an accept-all
 * bug). Instead of fail-closing, `emit-expr.ts:emitCall` lowers the call to
 * `await _scrml_<method>Async(coll, cb)` where the combinator is an async-aware
 * runtime helper injected ON-USE (mirrors `_scrml_structural_eq` / `_scrml_log`).
 *
 * The combinators are SEQUENTIAL `for-await` — they preserve iteration ORDER and
 * EARLY-EXIT / short-circuit (do NOT `Promise.all`, which breaks side-effect order
 * and short-circuit semantics). Each combinator's callback-arg arity matches the
 * JS method it replaces `(element, index, collection)`.
 *
 * `.sort` with an async comparator is DELIBERATELY NOT here (DD FORK 2) — an async
 * merge-sort is O(n log n) async compares with no native reuse; it stays
 * fail-closed via the existing `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` backstop.
 *
 * Dependency-neutral (no codegen imports) so both the emit-expr lowering site and
 * the emit-library-shared fail-closed drain can share the method set + the
 * `callbackReachesAsync` detector without an import cycle.
 */

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// THE ONE ASYNC-NAME PROVIDER (Limb 1, dpa-023 · S322)
// ---------------------------------------------------------------------------

/**
 * The facts a caller supplies to `isAsyncCalleeName` / `isServerBoundaryCallee`.
 *
 * Every field is a SET the caller already holds; the provider adds no lookups of
 * its own. Which sets exist is mode-dependent (a client emission has
 * `clientAsyncFnNames`, a server emission has its sibling-peer set), so mode
 * selection is the CALLER's job — see `emit-expr.ts:asyncNameFactsOf`. The RULE
 * applied to those facts is mode-free, which is the whole point: before this
 * existed, three consumers each re-implemented the rule and one of them
 * (`collectNonAwaitableAsyncCalls`'s local closure) was missing a disjunct.
 */
export interface AsyncNameFacts {
  /**
   * Names bound by an enclosing local. A shadowed name is NEVER async — it is the
   * local, not the async fn. Absent → no shadowing information (the drain paths,
   * which walk a whole fn body and have no scope tracker).
   */
  declaredNames?: ReadonlySet<string> | null;
  /**
   * The transitively-async LOCAL peer set for this emission — `computeAsyncFnNames`'s
   * result. Client emission: `clientAsyncFnNames`. Library/tool/server-value
   * emission: `asyncFnNames`.
   */
  asyncFnNames?: ReadonlySet<string> | null;
  /**
   * SERVER-BOUNDARY fn names. Read in BOTH modes deliberately (see
   * `isServerBoundaryCallee`).
   */
  serverFnNames?: ReadonlySet<string> | null;
  /**
   * Resolves a bare callee to "a Promise-returning stdlib/vendor export". A hook
   * rather than a `(calleeMap, exportRegistry)` pair because emit-expr's resolver
   * (`isStdlibAsyncCallee`) falls back to a module-level classifier the drain paths
   * do not install — the RULE is unified here; the stdlib RESOLVER stays where it
   * already is. Absent → no stdlib classifier in scope (test harness / no imports).
   */
  isStdlibAsync?: ((name: string) => boolean) | null;
}

/**
 * Is the bare callee `name` a SERVER-BOUNDARY function here, and unshadowed?
 *
 * Deliberately MODE-FREE. `serverFnNames` names the same fns in both emissions;
 * only the LOWERING differs — server mode calls an in-process peer callable,
 * client mode calls a fetch stub the post-emit rename installs. Both are async,
 * and both must be awaited, so for the purpose of "is this name async" the two
 * modes need no distinction. (A consumer that needs the lowering distinction —
 * `isClientServerFnCall` — still applies its own `mode === "client"` guard on top;
 * it asks an IDENTITY question, not an asyncness one.)
 */
export function isServerBoundaryCallee(name: string, facts: AsyncNameFacts): boolean {
  if (facts.declaredNames != null && facts.declaredNames.has(name)) return false;
  return facts.serverFnNames != null && facts.serverFnNames.has(name);
}

/**
 * **Is the bare callee `name` async in this emission?** The single source of truth.
 *
 * ── WHY THIS EXISTS (dpa-023 Limb 1) ────────────────────────────────────────────
 * Three consumers asked this question and one answered differently for a CLIENT
 * SERVER FN:
 *
 *   `emit-expr.ts combinatorIsAsyncName`  → yes (four hand-written disjuncts)
 *   `emit-expr.ts isClientServerFnCall`   → yes (its own `serverFnNames` test)
 *   `emit-library-shared.ts` drain-local  → **NO**
 *
 * The drain's closure derived its answer from `computeAsyncFnNames`, which treats
 * `serverFnNames` as a SEED TRIGGER — `callsServerFn(callees)` colours the CALLER
 * async and never admits the CALLEE to the result set. So `loadRows` was async to
 * the emitter and sync to the fail-closed drain, in the same compilation. The
 * consequence was not a wrong emission but a MISSING one: the drain could not see
 * a client server-fn call stranded in a raw escape-hatch, a template `.raw` body,
 * or a fn-signature parameter default, so those leaked with zero diagnostics.
 *
 * The fix is a subtraction: the rule lives here once, and the drain is handed the
 * `serverFnNames` fact it never had.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────
 * A name is async iff, and it is checked in this order:
 *   0. it is NOT shadowed by an enclosing local — a shadowed name is the local;
 *   1. it resolves to a Promise-returning stdlib/vendor export, OR
 *   2. it is a server-boundary fn (both modes — `isServerBoundaryCallee`), OR
 *   3. it is in the transitively-async local peer set.
 *
 * These are exactly the three async surfaces the expression auto-await already
 * awaits. There is no fourth.
 */
export function isAsyncCalleeName(name: string, facts: AsyncNameFacts): boolean {
  if (facts.declaredNames != null && facts.declaredNames.has(name)) return false;
  if (facts.isStdlibAsync != null && facts.isStdlibAsync(name)) return true;
  if (isServerBoundaryCallee(name, facts)) return true;
  return facts.asyncFnNames != null && facts.asyncFnNames.has(name);
}

/**
 * The CLEAN FAMILY — collection methods whose async-callback form lowers to a
 * sequential-`for-await` combinator (order + early-exit preserved). `.sort` is
 * DELIBERATELY absent (fail-closed, DD FORK 2). Emission order for the on-use
 * helper block (stable, readable).
 */
export const ASYNC_COMBINATOR_METHOD_ORDER = [
  "some",
  "every",
  "find",
  "findIndex",
  "filter",
  "map",
  "forEach",
  "reduce",
  "flatMap",
] as const;

export const ASYNC_COMBINATOR_METHODS: ReadonlySet<string> = new Set(ASYNC_COMBINATOR_METHOD_ORDER);

/**
 * The KNOWN-DISCARD-HOF set (S279) — global callables that STRUCTURALLY DISCARD
 * their callback's return value. A fire-and-forget timer / scheduler runs the
 * callback for its side effects and throws the return away, so the value-coercion
 * hazard the `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` backstop guards (a bare Promise
 * coerced as a truthy value → accept-all bug) is UNREACHABLE here. When such a
 * call is passed an async callback, the compiler MIRRORS the combinator lowering:
 * re-emit the callback lambda ASYNC so its inner async call auto-awaits INSIDE the
 * async callback. The HOF call itself is NOT awaited — `setTimeout` returns a timer
 * id, not a Promise. This is the fail-OPEN sibling of the combinator transform: a
 * discard context is provably safe, so an async callback compiles clean instead of
 * hitting the backstop with a nonsensical "hoist into a `for` loop" remedy.
 *
 * SCOPE: only a BARE-IDENT global call matches (`setTimeout(cb, 0)`), never a
 * member method (`obj.setTimeout(cb)` / `scheduler.setTimeout(cb)`) — a member
 * receiver is a user object whose discard semantics the compiler cannot verify, so
 * it stays fail-closed (mirrors the deferred user-HOF Case 2). A local of the same
 * name that shadows the global is likewise NOT matched (checked at the call site
 * against `declaredNames`).
 */
export const KNOWN_DISCARD_HOF: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
]);

/**
 * Is `node` a BARE-IDENT call to a KNOWN-DISCARD-HOF global with at least one
 * lambda argument whose body reaches an async call? True → emit-expr re-emits that
 * lambda async, and the fail-closed drain must walk the callback body as AWAITABLE
 * (the inner async call becomes an awaited async-callback body, not a leak). Shared
 * by the emit site and the drain so they cannot drift on which calls are exempted.
 * A MEMBER callee (`obj.setTimeout`) never matches — discard semantics are only
 * known for the globals.
 */
export function isKnownDiscardHofCall(
  node: unknown,
  isAsyncName: (name: string) => boolean,
): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as ASTNode;
  if (n.kind !== "call" || n.optional) return false;
  const callee = n.callee as ASTNode | undefined;
  if (!callee || callee.kind !== "ident" || typeof callee.name !== "string") return false;
  if (!KNOWN_DISCARD_HOF.has(callee.name)) return false;
  const args = n.args as unknown[] | undefined;
  if (!Array.isArray(args) || args.length < 1) return false;
  return args.some(
    (a) => (a as ASTNode | undefined)?.kind === "lambda" && callbackReachesAsync(a, isAsyncName),
  );
}

/**
 * Structural detector — does the callback argument of a collection method reach
 * an async call? Two accepted shapes:
 *   - a LAMBDA `fn(x) => …` / `(x) => …`: walk its body's `call` nodes (minus the
 *     lambda's own params, which shadow) and ask `isAsyncName` for each callee.
 *   - a bare IDENT `coll.some(isValid)`: the referenced fn is itself the callback,
 *     so it is async iff `isAsyncName(name)`.
 *
 * The `isAsyncName` predicate is still a PARAMETER (this module stays free of
 * codegen imports), but every caller now supplies the SAME implementation —
 * `isAsyncCalleeName` above, applied to that caller's `AsyncNameFacts`.
 *
 * CORRECTION (Limb 1, dpa-023): this comment previously claimed the two injectors
 * "agree on which callbacks are async". They did not. emit-expr fed
 * `isStdlibAsyncCallee ∪ serverFnNames ∪ clientAsyncFnNames`; emit-library-shared
 * fed `asyncFnNames ∪ isPromiseReturningStdlibFn` — with NO server-fn term at all,
 * because `computeAsyncFnNames` never admits a server fn to its result set. They
 * agreed on the stdlib callee only, which is the case the sentence was written
 * about. Both now route through the one provider, so the claim is true by
 * construction rather than by coincidence.
 */
export function callbackReachesAsync(
  cbNode: unknown,
  isAsyncName: (name: string) => boolean,
): boolean {
  if (!cbNode || typeof cbNode !== "object") return false;
  const cb = cbNode as ASTNode;
  if (cb.kind === "ident" && typeof cb.name === "string") {
    return isAsyncName(cb.name);
  }
  if (cb.kind !== "lambda") return false;
  const shadow = new Set<string>();
  const params = Array.isArray(cb.params) ? cb.params : [];
  for (const p of params) {
    const nm = (p as { name?: unknown })?.name;
    if (typeof nm === "string" && nm.length > 0) shadow.add(nm);
  }
  let found = false;
  const walk = (node: unknown): void => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    const n = node as ASTNode;
    if (n.kind === "call") {
      const callee = n.callee as ASTNode | undefined;
      const nm = (typeof n.name === "string" ? n.name : undefined)
        ?? ((callee && callee.kind === "ident" && typeof callee.name === "string") ? callee.name : undefined);
      if (typeof nm === "string" && !shadow.has(nm) && isAsyncName(nm)) { found = true; return; }
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(cb.body);
  return found;
}

/**
 * Is `node` a clean-family collection-method call whose FIRST argument is an
 * async callback? True → the emit lowers it to the combinator AND the fail-closed
 * drain must exempt the callback lambda (the async call inside it becomes an
 * awaited combinator-callback body, not an un-awaitable leak). Shared by both so
 * they cannot drift on which calls are transformed.
 */
export function isAsyncCombinatorCall(
  node: unknown,
  isAsyncName: (name: string) => boolean,
): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as ASTNode;
  if (n.kind !== "call") return false;
  const callee = n.callee as ASTNode | undefined;
  if (!callee || callee.kind !== "member" || callee.optional) return false;
  if (typeof callee.property !== "string" || !ASYNC_COMBINATOR_METHODS.has(callee.property)) return false;
  const args = n.args as unknown[] | undefined;
  if (!Array.isArray(args) || args.length < 1) return false;
  return callbackReachesAsync(args[0], isAsyncName);
}

// ---------------------------------------------------------------------------
// The nine runtime combinators — READABLE JS, sequential for-await, order +
// early-exit preserved. Injected ON-USE (a bundle that never lowers an async
// callback carries NONE of these). Callback arity mirrors the native method:
// `cb(element, index, collection)`.
// ---------------------------------------------------------------------------
const COMBINATOR_SRC: Record<string, string> = {
  some: [
    "async function _scrml_someAsync(coll, cb) {",
    "  for (const [i, x] of coll.entries()) {",
    "    if (await cb(x, i, coll)) return true;",
    "  }",
    "  return false;",
    "}",
  ].join("\n"),
  every: [
    "async function _scrml_everyAsync(coll, cb) {",
    "  for (const [i, x] of coll.entries()) {",
    "    if (!(await cb(x, i, coll))) return false;",
    "  }",
    "  return true;",
    "}",
  ].join("\n"),
  find: [
    "async function _scrml_findAsync(coll, cb) {",
    "  for (const [i, x] of coll.entries()) {",
    "    if (await cb(x, i, coll)) return x;",
    "  }",
    "  return undefined;",
    "}",
  ].join("\n"),
  findIndex: [
    "async function _scrml_findIndexAsync(coll, cb) {",
    "  for (const [i, x] of coll.entries()) {",
    "    if (await cb(x, i, coll)) return i;",
    "  }",
    "  return -1;",
    "}",
  ].join("\n"),
  filter: [
    "async function _scrml_filterAsync(coll, cb) {",
    "  const out = [];",
    "  for (const [i, x] of coll.entries()) {",
    "    if (await cb(x, i, coll)) out.push(x);",
    "  }",
    "  return out;",
    "}",
  ].join("\n"),
  map: [
    "async function _scrml_mapAsync(coll, cb) {",
    "  const out = [];",
    "  for (const [i, x] of coll.entries()) {",
    "    out.push(await cb(x, i, coll));",
    "  }",
    "  return out;",
    "}",
  ].join("\n"),
  forEach: [
    "async function _scrml_forEachAsync(coll, cb) {",
    "  for (const [i, x] of coll.entries()) {",
    "    await cb(x, i, coll);",
    "  }",
    "}",
  ].join("\n"),
  // Honors BOTH JS reduce forms. No-init (rest empty): the first element seeds
  // the accumulator and the callback starts at index 1. With-init (rest[0]):
  // acc = init and iteration starts at 0. An empty collection with no init
  // matches native `Array.prototype.reduce` and throws a TypeError.
  reduce: [
    "async function _scrml_reduceAsync(coll, cb, ...init) {",
    "  let acc;",
    "  let start;",
    "  if (init.length > 0) {",
    "    acc = init[0];",
    "    start = 0;",
    "  } else {",
    "    if (coll.length === 0) {",
    "      throw new TypeError(\"Reduce of empty array with no initial value\");",
    "    }",
    "    acc = coll[0];",
    "    start = 1;",
    "  }",
    "  for (let i = start; i < coll.length; i++) {",
    "    acc = await cb(acc, coll[i], i, coll);",
    "  }",
    "  return acc;",
    "}",
  ].join("\n"),
  flatMap: [
    "async function _scrml_flatMapAsync(coll, cb) {",
    "  const out = [];",
    "  for (const [i, x] of coll.entries()) {",
    "    const r = await cb(x, i, coll);",
    "    if (Array.isArray(r)) out.push(...r);",
    "    else out.push(r);",
    "  }",
    "  return out;",
    "}",
  ].join("\n"),
};

/**
 * Return the ON-USE helper block for every combinator whose call signature
 * (`_scrml_<method>Async(`) survives in `emitted`, or "" when none is used. The
 * caller injects the block at its own post-header boundary (`injectAfterHeader`),
 * so a bundle carries only the combinators it actually calls.
 */
export function asyncCombinatorHelperBlock(emitted: string): string {
  const blocks: string[] = [];
  for (const m of ASYNC_COMBINATOR_METHOD_ORDER) {
    if (emitted.includes(`_scrml_${m}Async(`)) blocks.push(COMBINATOR_SRC[m]);
  }
  if (blocks.length === 0) return "";
  return (
    "\n// --- Phase-2 colorless-async collection combinators " +
    "(sequential for-await; iteration order + early-exit preserved) ---\n" +
    blocks.join("\n\n") +
    "\n"
  );
}
