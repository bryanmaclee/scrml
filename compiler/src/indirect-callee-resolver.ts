// ===========================================================================
// Indirect-callee resolver (adopter #284) — LOCAL, per-function-body static
// resolution of a first-class function reference reached through a binding.
//
// THE PROBLEM. A server-placed function can reach a helper through a FIRST-CLASS
// REFERENCE instead of a direct call:
//
//   const p0 = groupByJob; const p = p0; return p(rows)      // multi-hop alias
//   const t = { job: groupByJob, day: groupByDay };          // dispatch table
//   const p = t[which]; return p(rows)
//
// The shared call-graph path (`exprNodeCollectCallees` / `forEachCallInExprNode`
// / `record.callees` / `inverseCallerMap`) records ONLY a DIRECT `call.callee`
// ident, so the helper is left client-placed while the server body references an
// undefined name → a ReferenceError (an executed 500). It ALSO drives E-ROUTE-001
// and the D4 W-DEAD gate, and widening it over-escalated 72 sites at S299 — so it
// MUST NOT be widened. This resolver is the SEPARATE, precise augmentation: it
// resolves an indirect call to its real callee(s) so the caller can treat it
// EXACTLY like a direct call, without touching the shared path.
//
// THE DESIGN (sound — NOT the rejected "first-class reference edges"). Resolution
// is LOCAL to a single function body and CALL-based:
//   - `const/let x = <ident F>`  → x resolves to {F} when F is a free identifier
//     (a file-level function reference), UNRESOLVED when F is a param / body-local
//     value (shadowing).
//   - `const/let x = <alias>`    → transitive (MULTI-HOP): x inherits the alias's
//     resolution.
//   - `const/let t = { k: F, … }` → t is a TABLE; a member set + a per-static-key
//     map.
//   - `const/let p = t[…]`  (computed) → p resolves to the table's WHOLE member
//     set; `t.k` / `t["k"]` (static) → the specific member.
//   - Reassignment of x, a second declaration, or any other RHS → UNRESOLVED.
//   - SHADOWING is respected: a param or a body-local named like a file-level
//     function shadows it (mirrors route-inference's `collectServerOnlyBinding-
//     Modules` shadow set; `params` is `[{name}]` objects, not strings).
//
// A genuinely UNRESOLVED indirect call (a dynamic value — a param, a call result,
// an array of unknown provenance) is simply ABSENT from the result: the caller
// keeps its current behavior for that sub-case (fail-closed diagnostic tracked
// separately). The resolver is name-universe-AGNOSTIC — it resolves an alias to a
// set of FREE identifier names; each consumer intersects that set with its own
// function / peer name universe. This keeps the classification IDENTICAL across
// the placement pass and the two emit passes (route-inference, emit-server,
// emit-expr), so a resolvable case is never classified resolvable in one and
// unresolved in another.
// ===========================================================================

export interface IndirectResolution {
  /**
   * Local binding name → the set of FREE identifier names it may refer to. Only
   * DEFINITELY-resolved bindings appear; an unresolved binding is absent (never
   * present with an empty set). A consumer intersects each set with its own
   * function / peer name universe.
   */
  bindings: Map<string, Set<string>>;
  /**
   * Every local name that appears in CALL position `name(...)` in this body
   * (excluding nested function / lambda scopes). Intersect with `bindings` keys
   * to get the aliases actually invoked as indirect calls.
   */
  calledNames: Set<string>;
}

// Nested-scope node kinds we never descend into: their calls / decls belong to a
// DIFFERENT lexical scope, and (mirroring the shared call-graph path, which stops
// at `case "lambda"`) attributing them to THIS body would be unsound.
function isNestedScope(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  const k = node.kind;
  if (k === "function-decl" || k === "component-def" || k === "lambda") return true;
  if (
    k === "escape-hatch" &&
    (node.nativeKind === "ArrowFunctionExpression" || node.nativeKind === "FunctionExpression")
  ) return true;
  return false;
}

const DECL_KINDS = new Set(["const-decl", "let-decl", "tilde-decl"]);

/**
 * Normalize a function node's `params` into a name Set. `FunctionDeclNode.params`
 * is TYPED `string[]` but the ast-builder produces `[{name}]` objects (verified at
 * S299) — a plain `new Set(params)` would hold objects and every `.has(name)`
 * would silently return false. Handle both shapes (mirrors `collectServerOnly-
 * BindingModules`). A `name:Type` string param is split at the colon.
 */
export function fnParamNameSet(params: unknown): Set<string> {
  const out = new Set<string>();
  for (const p of (Array.isArray(params) ? params : [])) {
    if (typeof p === "string") {
      const nm = p.split(":")[0].trim();
      if (nm) out.add(nm);
    } else if (p && typeof p === "object" && typeof (p as any).name === "string") {
      out.add((p as any).name);
    }
  }
  return out;
}

/**
 * Resolve every indirectly-reached callee in a single function body.
 *
 * @param body        the function body statement array (`fnNode.body`).
 * @param paramNames  the function's parameter names (shadow set seed).
 */
export function resolveIndirectCallees(
  body: unknown,
  paramNames: Set<string>,
): IndirectResolution {
  const bindings = new Map<string, Set<string>>();
  const calledNames = new Set<string>();
  const stmts: any[] = Array.isArray(body) ? body : [];
  if (stmts.length === 0) return { bindings, calledNames };

  // ---- Pass 1: shadow set (params + every body-local decl name) + reassigned.
  // A name declared twice, or ever assigned (`x = …`), is UNRESOLVED. The shadow
  // set lets a body-local named like a file-level function shadow it.
  const shadowSet = new Set<string>(paramNames);
  const declCounts = new Map<string, number>();
  const reassigned = new Set<string>();
  const pass1 = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) pass1(c); return; }
    if (isNestedScope(node)) return;
    const k = node.kind;
    if ((DECL_KINDS.has(k) || k === "state-decl") && typeof node.name === "string") {
      shadowSet.add(node.name);
      declCounts.set(node.name, (declCounts.get(node.name) ?? 0) + 1);
    }
    if (k === "for-stmt") {
      if (typeof node.iteratorVar === "string") shadowSet.add(node.iteratorVar);
      if (typeof node.indexVar === "string") shadowSet.add(node.indexVar);
    }
    if (k === "assign" && node.target && node.target.kind === "ident"
        && typeof node.target.name === "string") {
      reassigned.add(node.target.name);
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id" || key === "_scope" || key === "_record") continue;
      pass1(node[key]);
    }
  };
  for (const s of stmts) pass1(s);
  for (const [nm, count] of declCounts) if (count > 1) reassigned.add(nm);

  // A table binding: its member set (for computed access) + per-static-key map.
  const tableBindings = new Map<string, { members: Set<string>; byKey: Map<string, Set<string>> }>();

  // Resolve an ident to the free-identifier name-set it refers to (or null =
  // UNRESOLVED). bindings FIRST (transitive / multi-hop), then the shadow set (a
  // local value / param shadows any file-level fn), else it is a free ident.
  const resolveIdentName = (name: string): Set<string> | null => {
    const alias = bindings.get(name);
    if (alias) return alias;
    if (shadowSet.has(name)) return null;
    return new Set<string>([name]);
  };
  // Resolve a value ExprNode used as a table member — only a bare ident resolves.
  const resolveValueNode = (v: any): Set<string> | null => {
    if (v && v.kind === "ident" && typeof v.name === "string") return resolveIdentName(v.name);
    return null;
  };

  // ---- Pass 2: source-order decl resolution + call-site collection. A single
  // pre-order DFS visits decls in source order (so a later alias sees an earlier
  // one — multi-hop), and records every `name(...)` call site.
  const processDecl = (name: string, init: any): void => {
    if (!init || typeof init !== "object") return;
    switch (init.kind) {
      case "ident": {
        const r = resolveIdentName(init.name);
        if (r && r.size > 0) bindings.set(name, new Set(r));
        return;
      }
      case "object": {
        const members = new Set<string>();
        const byKey = new Map<string, Set<string>>();
        for (const p of (Array.isArray(init.props) ? init.props : [])) {
          if (!p || p.kind !== "prop") continue;
          const vNames = resolveValueNode(p.value);
          if (!vNames || vNames.size === 0) continue;
          for (const n of vNames) members.add(n);
          if (typeof p.key === "string" && !p.computed) byKey.set(p.key, new Set(vNames));
        }
        if (members.size > 0) tableBindings.set(name, { members, byKey });
        return;
      }
      case "index": {
        const obj = init.object;
        if (!obj || obj.kind !== "ident") return;
        const tb = tableBindings.get(obj.name);
        if (!tb) return;
        let r: Set<string> | undefined;
        if (init.index && init.index.kind === "lit" && init.index.litType === "string") {
          r = tb.byKey.get(String(init.index.value));
        } else {
          r = tb.members; // computed / non-string-literal key → whole member set.
        }
        if (r && r.size > 0) bindings.set(name, new Set(r));
        return;
      }
      case "member": {
        const obj = init.object;
        if (!obj || obj.kind !== "ident" || typeof init.property !== "string") return;
        const tb = tableBindings.get(obj.name);
        if (!tb) return;
        const r = tb.byKey.get(init.property);
        if (r && r.size > 0) bindings.set(name, new Set(r));
        return;
      }
      default:
        return; // any other RHS → UNRESOLVED.
    }
  };

  const pass2 = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) pass2(c); return; }
    if (isNestedScope(node)) return;
    const k = node.kind;
    if (DECL_KINDS.has(k) && typeof node.name === "string" && !reassigned.has(node.name)) {
      processDecl(node.name, node.initExpr);
      // Fall through to recurse — a call in the init (`const t = p(rows)`) is a
      // call site that must still be collected below.
    }
    if (k === "call" && node.callee && node.callee.kind === "ident"
        && typeof node.callee.name === "string") {
      calledNames.add(node.callee.name);
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id" || key === "_scope" || key === "_record") continue;
      pass2(node[key]);
    }
  };
  for (const s of stmts) pass2(s);

  // Drop any binding whose name was reassigned (defensive — pass 2 already skips
  // building them, but a table member could have aliased one).
  for (const nm of reassigned) { bindings.delete(nm); tableBindings.delete(nm); }

  return { bindings, calledNames };
}

/**
 * The set of free-identifier callee names reached through an INDIRECT call in
 * this body: for every alias actually invoked as `alias(...)`, its resolution.
 */
export function indirectResolvedCallees(res: IndirectResolution): Set<string> {
  const out = new Set<string>();
  for (const name of res.calledNames) {
    const s = res.bindings.get(name);
    if (s) for (const n of s) out.add(n);
  }
  return out;
}

/**
 * The set of local ALIAS names in this body that (per resolution) refer to at
 * least one member of `targetNames` — e.g. the peer names, so an emit pass can
 * `await`-lower `alias(...)`. Shadow-aware by construction (the resolver already
 * excluded shadowed / reassigned names from `bindings`).
 */
export function aliasNamesResolvingTo(
  res: IndirectResolution,
  targetNames: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const [alias, names] of res.bindings) {
    for (const n of names) {
      if (targetNames.has(n)) { out.add(alias); break; }
    }
  }
  return out;
}
