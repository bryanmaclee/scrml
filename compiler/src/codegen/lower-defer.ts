/**
 * `defer` lowering — SPEC §19.16.6 (S430 P3 stage 1; round 4: the defer STACK).
 *
 * A `defer` statement registers its deferred body against the ENCLOSING BLOCK;
 * every registered body runs exactly once on every exit from that block, LIFO
 * (§19.16.2). The lowering gives each block that contains a `defer` its own
 * stack and wraps the WHOLE block — unchanged, in place — in a host
 * `try { … } finally { … }`:
 *
 *     const _scrml_defers_N = [];
 *     try {
 *       a;
 *       _scrml_defers_N.push(() => { D1 });   // `defer D1`, at its position
 *       b;
 *       _scrml_defers_N.push(() => { D2 });   // `defer D2`
 *       c;
 *     } finally {
 *       // run every registered closure, last-registered first; a host error in
 *       // one does not stop the others — the first such error is rethrown after
 *     }
 *
 * Nothing moves across a boundary: every declaration stays in its original
 * block, so function hoisting, `let`/`const` scoping and TDZ are exactly what
 * they are without the `defer`. "Not reached ⇒ not registered" holds because an
 * unreached `defer` never pushed; LIFO holds because the runner walks the stack
 * backwards; "evaluated at exit" holds because the deferred statement is a
 * closure body, run by the `finally`; a `return` value is computed before the
 * `finally` runs. A loop body is its own block, so each iteration has its own
 * stack instance and its defers run at that iteration's exit.
 *
 * The lowered block is a `try-stmt` carrying `deferLowered: true` (NOT a
 * scrml-source try — E-TRY-NOT-IN-SCRML is a parse-time rule and never sees
 * it) and `deferStack` (the stack's name, minted at emission). Each `defer-stmt`
 * stays IN PLACE as a registration marker (`lowered: true`); its deferred
 * statements move to `finallyNode.body` (`deferStart` / `deferCount` index
 * them), so every codegen walker that already understands try-stmt
 * (reactive-deps, usage analysis, async colouring, the auto-await injector)
 * still sees each deferred statement exactly once. `emitLogicNode` routes the
 * flag to `emitDeferScope` (emit-control-flow.ts).
 *
 * ⚑ BODY-SPLIT (CPS, §19.9.9 / §19.16.5): the TOP-LEVEL statement list of a
 * CPS-split function is NOT restructured here — route inference addressed it
 * by statement INDEX. The CPS client wrappers (emit-functions.ts) use the same
 * stack: it is declared and its `try` opened at the TOP of the wrapper body,
 * each top-level `defer` pushes at its position in the sequential walk, and the
 * `finally` closes after the walk — after the LAST batch's `await` and the last
 * client continuation. Nested lists inside a split function are lowered here as
 * usual. A server-tier deferred body in a split function is rejected upstream
 * (E-DEFER-SERVER-IN-SPLIT), so a server batch never contains a `defer-stmt`.
 *
 * The pass mutates statement arrays IN PLACE (splice) so any other holder of
 * the same array sees the lowered list. It is idempotent.
 *
 * @module lower-defer
 */

type Node = Record<string, unknown> & { kind?: string; span?: unknown };

/** Is this the compiler-lowered form of a `defer` block (not a source try)? */
export function isDeferLoweredTry(node: unknown): boolean {
  return !!node && typeof node === "object" &&
    (node as Node).kind === "try-stmt" && (node as Node).deferLowered === true;
}

const isDeferStmt = (s: unknown): boolean =>
  !!s && typeof s === "object" && (s as Node).kind === "defer-stmt" && (s as Node).lowered !== true;

/**
 * Lower one statement list that contains `defer` statements: the whole list
 * becomes the body of ONE `try-stmt{deferLowered}`; each `defer-stmt` becomes
 * an in-place registration marker whose deferred statements move to the
 * try-stmt's `finallyNode.body`. Returns the new list contents (the caller
 * splices them into the original array).
 */
export function lowerDeferList(list: unknown[]): unknown[] {
  if (!list.some(isDeferStmt)) return list;
  const deferred: unknown[] = [];
  let firstDefer: Node | null = null;
  const body = list.map((s) => {
    if (!isDeferStmt(s)) return s;
    const d = s as Node;
    if (!firstDefer) firstDefer = d;
    const stmts = Array.isArray(d.body) ? (d.body as unknown[]) : [];
    const marker: Node = {
      id: d.id,
      kind: "defer-stmt",
      lowered: true,
      blockForm: d.blockForm === true,
      deferStart: deferred.length,
      deferCount: stmts.length,
      span: d.span,
    };
    deferred.push(...stmts);
    return marker;
  });
  const tryNode: Node = {
    id: (firstDefer as Node | null)?.id,
    kind: "try-stmt",
    header: "",
    body,
    finallyNode: { header: "", body: deferred },
    deferLowered: true,
    span: (firstDefer as Node | null)?.span,
  };
  return [tryNode];
}

/**
 * Lower every `defer-stmt` reachable from `root`, EXCEPT the top-level body of
 * the function nodes in `skipTopLevelOf` (the CPS-split functions — see the
 * module docstring). Nested lists inside a skipped body are still lowered.
 */
export function lowerDefers(root: unknown, skipTopLevelOf: Set<unknown>): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      if (node.some(isDeferStmt)) {
        const lowered = lowerDeferList(node);
        node.splice(0, node.length, ...lowered);
      }
      return;
    }
    const n = node as Node;
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "parent") continue;
      const v = n[key];
      if (key === "body" && Array.isArray(v) && skipTopLevelOf.has(n)) {
        // Split-function top level: descend into each statement, but do NOT
        // restructure the list itself (its indices are the CPS split's contract).
        seen.add(v);
        for (const c of v) visit(c);
        continue;
      }
      visit(v);
    }
  };
  visit(root);
}

/** Does this statement list contain a (not-yet-lowered) `defer-stmt`? */
export function listHasDefer(list: unknown): boolean {
  return Array.isArray(list) && list.some(isDeferStmt);
}
