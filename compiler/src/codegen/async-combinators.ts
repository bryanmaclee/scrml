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
 * Structural detector — does the callback argument of a collection method reach
 * an async call? Two accepted shapes:
 *   - a LAMBDA `fn(x) => …` / `(x) => …`: walk its body's `call` nodes (minus the
 *     lambda's own params, which shadow) and ask `isAsyncName` for each callee.
 *   - a bare IDENT `coll.some(isValid)`: the referenced fn is itself the callback,
 *     so it is async iff `isAsyncName(name)`.
 *
 * The `isAsyncName` predicate is INJECTED by the caller so the two consumers stay
 * on their own async source-of-truth without this module importing either:
 *   - emit-expr.ts feeds `isStdlibAsyncCallee` ∪ serverFnNames ∪ clientAsyncFnNames,
 *   - emit-library-shared.ts feeds `asyncFnNames` ∪ `isPromiseReturningStdlibFn`.
 * Both resolve the flagship stdlib-async callee identically, so the lowering site
 * and the fail-closed drain agree on which callbacks are async.
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
