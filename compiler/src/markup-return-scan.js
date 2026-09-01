// markup-return-scan.js — the SINGLE SOURCE for "does this fn return markup?"
//
// A nested `<each>` interp of a markup-returning fn call must MOUNT the returned
// DOM node (via the `<span data-scrml-mv>` mount-or-text wrapper, GH #161), not
// `String()` it into `[object HTMLSpanElement]`. Codegen (emit-each.ts) decides
// this per interp site from the set of markup-returning fn NAMES in scope.
//
// This module holds that detection so it is IDENTICAL in two places that must
// never drift: emit-each.ts (same-file fns) and module-resolver.js (per-module
// export classification, so an IMPORTED markup fn is flagged `returnsMarkup` on
// its export-registry entry and mounts across files exactly like a same-file
// one — residual (2) of g-each-nested-markup-interp-stringifies). MOD runs
// before codegen and is plain JS, so this is authored in JS and imported by
// both (emit-each.ts imports it as TS-imports-JS; module-resolver.js as JS).
//
// Every predicate here is FAIL-SAFE: it never returns true for a string-yielding
// shape, so the markup-fn set only ever WIDENS onto genuinely markup-returning
// fns, and the emitted mount is `instanceof Node`-guarded regardless.

/**
 * Does this expression node YIELD a markup value in VALUE position? A markup
 * literal (`markup-value`), or a ternary / match-arm whose value branches are
 * (never the test/subject — that is the discriminant, not the yielded value).
 * Positional by design: markup in an argument / closure / condition does NOT
 * flag a string-returning fn.
 */
export function exprYieldsMarkupValue(node) {
  if (!node || typeof node !== "object") return false;
  const k = node.kind;
  if (k === "markup-value") return true;
  if (k === "ternary") {
    return exprYieldsMarkupValue(node.consequent) || exprYieldsMarkupValue(node.alternate);
  }
  if (k === "match-expr") {
    const arms = Array.isArray(node.body) ? node.body : Array.isArray(node.arms) ? node.arms : [];
    for (const arm of arms) {
      if (!arm || typeof arm !== "object") continue;
      for (const vk of ["value", "result", "consequent", "body", "exprNode", "expr"]) {
        const v = arm[vk];
        if (Array.isArray(v)) {
          for (const it of v) if (exprYieldsMarkupValue(it)) return true;
        } else if (v && typeof v === "object" && exprYieldsMarkupValue(v)) {
          return true;
        }
      }
    }
    return false;
  }
  if (k === "paren" || k === "group" || k === "sequence") {
    return exprYieldsMarkupValue(node.expr ?? node.inner ?? node.body);
  }
  return false;
}

/**
 * Does this fn body carry a markup value in ANY of its `return`s? A return
 * "carries markup" when it returns a markup literal directly
 * (`return-stmt.markupNode`, kind "markup"/"markup-value"/"component") OR its
 * returned expression YIELDS a markup value in VALUE position (via the
 * POSITIONAL `exprYieldsMarkupValue`, so markup in an argument / closure /
 * condition of the returned expression does NOT falsely flag a string-returning
 * fn). Scans returns at any depth (guards / if / match arms), but does NOT
 * descend into a NESTED `function-decl` (its returns are its own).
 */
export function fnBodyReturnsMarkup(body) {
  const seen = new WeakSet();
  const scan = (n) => {
    if (!n || typeof n !== "object") return false;
    if (Array.isArray(n)) {
      for (const x of n) if (scan(x)) return true;
      return false;
    }
    if (seen.has(n)) return false;
    seen.add(n);
    if (n.kind === "function-decl") return false;
    if (n.kind === "return-stmt") {
      const mk = n.markupNode;
      if (mk && typeof mk === "object" && (mk.kind === "markup" || mk.kind === "markup-value" || mk.kind === "component")) {
        return true;
      }
      if (exprYieldsMarkupValue(n.exprNode)) return true;
    }
    for (const key of Object.keys(n)) {
      const v = n[key];
      if (v && typeof v === "object" && scan(v)) return true;
    }
    return false;
  };
  return scan(body);
}

/**
 * Body-scan sibling of `fnBodyReturnsMarkup` for the transitive step: does this
 * fn body have a `return` whose VALUE is a call to a fn already in `markupFns`
 * (or a ternary/match whose value branches are)? Reuses the interp-site
 * `interpMayYieldNode` so the "yields a node" judgment is identical at the
 * return position and the interp position. Does NOT descend a nested
 * `function-decl`.
 */
export function fnBodyReturnsCallToMarkupFn(body, markupFns) {
  const seen = new WeakSet();
  const scan = (n) => {
    if (!n || typeof n !== "object") return false;
    if (Array.isArray(n)) {
      for (const x of n) if (scan(x)) return true;
      return false;
    }
    if (seen.has(n)) return false;
    seen.add(n);
    if (n.kind === "function-decl") return false;
    if (n.kind === "return-stmt" && interpMayYieldNode(n.exprNode, markupFns)) return true;
    for (const key of Object.keys(n)) {
      const v = n[key];
      if (v && typeof v === "object" && scan(v)) return true;
    }
    return false;
  };
  return scan(body);
}

/**
 * Detection at the interp SITE: could this exprNode evaluate to a DOM node
 * because it calls a markup-returning fn? True when the node IS such a call, or
 * a ternary/match whose VALUE branches (never the test/subject) are such calls.
 * A call under `binary`/`arithmetic` (`+`) coerces to string → intentionally
 * false. Never returns true for a string-yielding shape → never over-wraps.
 */
export function interpMayYieldNode(node, markupFns) {
  if (!node || typeof node !== "object" || !markupFns || markupFns.size === 0) return false;
  const k = node.kind;
  if (k === "call") {
    const callee = node.callee;
    const name = callee && callee.kind === "ident" ? callee.name : undefined;
    return typeof name === "string" && markupFns.has(name);
  }
  if (k === "ternary") {
    return interpMayYieldNode(node.consequent, markupFns) || interpMayYieldNode(node.alternate, markupFns);
  }
  // g-each-value-form-if-markup-fn-call-branch-stringifies — a §17.6 value-form
  // `if cond { badge(x) } else { badge(y) }` interp lowers (emit-each
  // `_eachValueFormIfRaw`) to the SAME ternary the twin ternary form produces,
  // but the if-stmt carries no `exprNode` at the interp site so this discriminant
  // never saw it → the each-interp emitter picked the String() text path and the
  // returned DOM node stringified to `[object HTMLSpanElement]`. Recurse the
  // branch bodies (a bare-expr's `exprNode` is the branch value; `alternate` may
  // be a nested if-stmt for an else-if cascade), so a value-form-if whose branch
  // CALLS a markup-returning fn is recognized as markup-capable — exactly like
  // the ternary. A non-markup branch set still returns false (text path, unchanged).
  if (k === "if-stmt") {
    const branches = [];
    const c = node.consequent ?? node.body;
    if (c != null) branches.push(c);
    if (node.alternate != null) branches.push(node.alternate);
    for (const br of branches) {
      const arr = Array.isArray(br) ? br : [br];
      for (const s of arr) {
        if (!s || typeof s !== "object") continue;
        if (s.kind === "if-stmt") { if (interpMayYieldNode(s, markupFns)) return true; continue; }
        const en = s.exprNode ?? s;
        if (interpMayYieldNode(en, markupFns)) return true;
      }
    }
    return false;
  }
  if (k === "match-expr") {
    const arms = Array.isArray(node.body) ? node.body : Array.isArray(node.arms) ? node.arms : [];
    for (const arm of arms) {
      if (!arm || typeof arm !== "object") continue;
      for (const vk of ["value", "result", "consequent", "body", "exprNode", "expr"]) {
        const v = arm[vk];
        if (Array.isArray(v)) {
          for (const it of v) if (interpMayYieldNode(it, markupFns)) return true;
        } else if (v && typeof v === "object" && interpMayYieldNode(v, markupFns)) {
          return true;
        }
      }
    }
    return false;
  }
  return false;
}

/**
 * Resolve a file's import specifiers to the set of LOCAL names bound to an
 * imported export that returns markup. The markup test is supplied as
 * `isMarkupExport(absSource, importedName) -> boolean` so the SAME iteration
 * serves both consumers that must classify identically: codegen (against
 * `ctx.exportRegistry`) and module-resolver's cross-module fixpoint (against the
 * graph export records). `imports` is the per-file import list (each entry:
 * `{ absSource, specifiers: [{ imported, local }] }`). Namespace/default imports
 * carry no named specifiers and simply contribute nothing (fail-safe).
 */
export function resolveImportedMarkupLocalNames(imports, isMarkupExport) {
  const out = new Set();
  for (const imp of imports ?? []) {
    const absSource = imp && imp.absSource;
    if (!absSource) continue;
    for (const s of imp.specifiers ?? []) {
      if (!s || typeof s.imported !== "string" || typeof s.local !== "string") continue;
      if (isMarkupExport(absSource, s.imported)) out.add(s.local);
    }
  }
  return out;
}

/**
 * Collect the names of `function-decl`s in `fileAST` whose body returns markup
 * (directly or transitively). Optionally seed the set with names already known
 * to be markup-returning (e.g. IMPORTED markup fns resolved via the export
 * registry) BEFORE the fixpoint, so a same-file `fn wrap(n){ return badge(n) }`
 * that wraps an imported `badge` still closes. Walks the whole AST (mirrors how
 * `collectMapVarNames` derives its set once per file).
 */
export function collectMarkupReturningFnNames(fileAST, seedMarkupFnNames = null) {
  const out = new Set(seedMarkupFnNames ?? []);
  const named = [];
  const visited = new WeakSet();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    if (node.kind === "function-decl" && typeof node.name === "string" && node.name) {
      named.push({ name: node.name, body: node.body });
      if (fnBodyReturnsMarkup(node.body)) out.add(node.name);
      // Do NOT recurse into a fn's body: a NESTED `fn X` is a scoped local, not
      // a module-scope callable, so it must not enter the name-keyed set (else a
      // nested markup `fn badge` would falsely flag a same-named string-returning
      // top-level export, over-wrapping its interps). `fnBodyReturnsMarkup` above
      // already scans this body for its OWN returns and stops at nested fns.
      return;
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(fileAST);
  // Transitive fixpoint: a fn whose return YIELDS a call to an already-known
  // markup fn is itself markup-returning. Iterate to a fixpoint so a chain
  // (wrap2→wrap→badge) — same-file or seeded from an imported markup fn —
  // closes fully. Fail-safe: the same positional `interpMayYieldNode` used at
  // the interp site never returns true for a string-yielding shape.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, body } of named) {
      if (out.has(name)) continue;
      if (fnBodyReturnsCallToMarkupFn(body, out)) { out.add(name); changed = true; }
    }
  }
  return out;
}
