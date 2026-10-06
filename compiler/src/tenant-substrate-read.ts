/**
 * §14.8.10 — W-TENANT-SUBSTRATE-SCOPED: the tenant is pinned from a tenant-scoped read.
 *
 * SPEC §14.8.10 ("The tenant key"): *"The app's login / tenant-switch code (policy)
 * resolves the active tenant … and **pins** it: `session.set("tenantId", t)`"* and
 * *"**Corollary:** the identity/grant substrate (`users` / `user_roles`) is NOT
 * tenant-scoped — you would need the tenant to read the table that tells you the
 * tenant (infinite regress)."* ("Declaration"): *"A table whose `<schema>` carries a
 * `tenant_id` column IS tenant-scoped; the column's **presence is the declaration**"*.
 *
 * The two sentences collide when the identity table carries `tenant_id`: it becomes
 * tenant-scoped, the login's read of it is filtered to the tenant active BEFORE the
 * pin — none, in a fresh session — and every login silently fails (zero rows; the
 * only signal was info-level I-TENANT-STRIP). Executed S455 / S456: `users(…,
 * tenant_id)` + `login(email)` reading users by email and pinning `u.tenant_id`
 * → `"bad"` for a seeded user.
 *
 * ⚑ THE TRIGGER IS WHAT THE AST PROVES, NOTHING WIDER. Within ONE function, a read
 * of a tenant-scoped table that is not `.acrossTenants()`, executed before that
 * function's first `session.set("tenantId", v)` (v not the literal `not`), whose
 * result DECIDES the pin — in one of two ways:
 *   1. VALUE: the read reaches the pinned value, directly or through local bindings
 *      derived from it (a `for … of` variable included). The tenant is then resolved
 *      from rows the floor has already filtered to the tenant active before the pin:
 *      with none (a login) the pin is never reached with a value; with one, it can
 *      only re-find that tenant. The corollary's regress, in every session state.
 *   2. CONDITION, IN A LOGIN: the read reaches a branch / loop / match condition (a
 *      loop's iterable included) that CONTROLS the pin — the pin is inside that
 *      statement, or the statement can `return` / `throw` / `fail` before it — AND
 *      the function also pins `userId` (it establishes the identity). Identity
 *      establishment then hinges on rows of the tenant active BEFORE it — none, or
 *      the previous identity's.
 *   A destructured binding (F3) and an `@cell` assigned in the function (F4) carry the
 *   read like any local. An org-first login that pinned the tenant earlier and re-pins it
 *   from a per-tenant users table is a legitimate design that still warns (F5): the
 *   message names that remedy (drop the redundant re-pin) instead of suppressing it.
 * Deliberately NOT charged (each is not provable from the AST):
 *   - a read that decides the tenant pin only through a condition in a function that
 *     does not pin `userId` — a tenant SWITCH may test the previous tenant's domain
 *     rows on purpose ("you have unsaved drafts"); a switch that checks a
 *     tenant-scoped GRANT table this way is broken too, but the AST cannot tell a
 *     grant table from a domain table;
 *   - a tenant-scoped read before the pin that decides nothing about it;
 *   - a read inside a nested function or lambda (it runs when called, not in order) —
 *     except a same-file helper whose RETURN value is a tenant-scoped read, which counts
 *     as that read at its call (S456 review F2; `ReadSummaries`, fixpoint, unique names);
 *   - a block-bodied arrow / function expression: the AST holds its body as raw text
 *     (`escape-hatch`), so it is not readable without re-parsing source (Rule 7) — S456
 *     review F6, a documented miss (an expression-bodied lambda IS judged);
 *   - a helper in ANOTHER file (summaries are per file);
 *     a pin in a CALLEE is not followed either (today a `session.set` reached by an
 *     in-process peer call is already E-SESSION-CONTEXT — no session there);
 *   - a login that pins only `userId` while reading a tenant-scoped `users` (an
 *     org-first flow pins the tenant in an earlier request — per-tenant user tables
 *     then work), including `scrml generate auth`'s template;
 *   - a `?{}` the AST carries only as raw text (no structured node).
 * Rule 7: every decision is made from the AST — the `sql` statement node, the
 * `sql-ref` expression node's own payload and the call/ident ExprNodes.
 *
 * Runs in the api.js TENANT-SCHEMA stage, the one place the compilation's tenant set
 * (`compilationTenantSet`) and every file's expanded AST coexist; the read is
 * classified by the floor's own `resolveTenantScoping`, so this check and the
 * lowering cannot disagree about which reads are scoped.
 */
import { resolveTenantScoping } from "./codegen/tenant-egress.ts";
import type { TenantContext } from "./codegen/tenant-egress.ts";
import { tenantTableMentioned } from "./codegen/tenant-sql-subset.ts";
import { fileDeclaresFileScopeBinding } from "./codegen/log-loc.ts";
import { collectReactiveVarNames } from "./codegen/reactive-deps.ts";

export const TENANT_SUBSTRATE_CODE = "W-TENANT-SUBSTRATE-SCOPED";

export interface TenantSubstrateDiagnostic {
  code: typeof TENANT_SUBSTRATE_CODE;
  message: string;
  span: any;
  severity: "warning";
}

/** One tenant-scoped read found before the pin, and how it decides the pin. */
interface ScopedRead { id: number; table: string; query: string; span: any; how?: "value" | "condition"; via?: string }

/** A function body this check judges: a `function-decl`, or a structured lambda (S456 F6). */
interface FnUnit { name: string; body: unknown; params: unknown[]; span: any }

/**
 * Same-file helpers whose RETURN value is a tenant-scoped read (S456 review F2:
 * `const u = findUser(email)` hid the read in a callee). name → { table }.
 */
type ReadSummaries = Map<string, { table: string }>;

/** Keys never walked: positions, compiler stamps, and raw-text mirrors of structured fields. */
function skipKey(key: string): boolean {
  return key === "span" || key === "loc" || key.startsWith("_");
}

/** The SQL text of a `sql-ref` ExprNode's own payload (`?{` `…` `}`), or null. */
function sqlRefQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^\?\{\s*`([\s\S]*)`\s*\}$/.exec(raw);
  return m ? m[1] : null;
}

/** `session.set("<key>", v)` — a §20.5.1 session pin (callee + literal key, structurally). */
function isSessionPin(n: Record<string, any>, key: string): boolean {
  if (n.kind !== "call") return false;
  const c = n.callee;
  if (!c || c.kind !== "member" || c.property !== "set") return false;
  if (!c.object || c.object.kind !== "ident" || c.object.name !== "session") return false;
  const a = n.args;
  return Array.isArray(a) && a.length >= 2 && a[0]?.kind === "lit" && a[0].litType === "string" && a[0].value === key;
}

/** The pin clears the tenant (`session.set("tenantId", not)`) — a logout, not a resolution. */
function pinClears(n: Record<string, any>): boolean {
  const v = n.args?.[1];
  return !!v && v.kind === "lit" && v.litType === "not";
}

/** Names a declaration binds (a plain name or a destructuring pattern). */
function boundNames(name: unknown, out: string[] = []): string[] {
  // A plain name, or a `DestructurePattern` (types/ast.ts, A5): an object pattern's
  // properties bind `bindName` (`{ a: ren }` binds `ren`) or nest a `pattern`; an array
  // pattern's elements bind `name` or nest a `pattern`; either may carry a `rest` name.
  // (S456 review F3: `const { id, tenant_id } = ?{…}.get()` bound nothing.)
  if (typeof name === "string") { out.push(name); return out; }
  if (!name || typeof name !== "object") return out;
  const p = name as Record<string, any>;
  for (const e of [...(Array.isArray(p.properties) ? p.properties : []), ...(Array.isArray(p.elements) ? p.elements : [])]) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.bindName === "string") out.push(e.bindName);
    else if (typeof e.name === "string") out.push(e.name);
    if (e.pattern) boundNames(e.pattern, out);
  }
  if (typeof p.rest === "string") out.push(p.rest);
  return out;
}

const DECL_KINDS = new Set(["const-decl", "let-decl", "tilde-decl", "lin-decl"]);
const NESTED_FN_KINDS = new Set(["function-decl", "lambda"]);

const EXIT_KINDS = new Set(["return-stmt", "throw-stmt", "fail-expr"]);

/** Can this statement leave the enclosing function (a `return` / `throw` / `fail`, not in a nested function)? */
function exitsWithin(node: unknown): boolean {
  const seen = new WeakSet<object>();
  const walk = (n: unknown): boolean => {
    if (!n || typeof n !== "object" || seen.has(n as object)) return false;
    seen.add(n as object);
    if (Array.isArray(n)) return n.some(walk);
    const o = n as Record<string, any>;
    if (NESTED_FN_KINDS.has(o.kind)) return false;
    if (EXIT_KINDS.has(o.kind)) return true;
    for (const k in o) if (!skipKey(k) && walk(o[k])) return true;
    return false;
  };
  return walk(node);
}

/** Does this function bind `session` itself (a param or a local), shadowing the builtin? */
function shadowsSession(fn: Record<string, any>): boolean {
  for (const p of fn.params ?? []) {
    const nm = typeof p === "string" ? p.split(/[:=\s]/)[0] : p?.name;
    if (nm === "session") return true;
  }
  let found = false;
  const seen = new WeakSet<object>();
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    const o = n as Record<string, any>;
    if (NESTED_FN_KINDS.has(o.kind)) return;
    if (DECL_KINDS.has(o.kind) && boundNames(o.name).includes("session")) { found = true; return; }
    for (const k in o) if (!skipKey(k)) walk(o[k]);
  };
  walk(fn.body);
  return found;
}

/**
 * Walk ONE function body in evaluation order. Mode `"pin"`: up to its first tenant pin,
 * returning the reads that decide the pin (empty when the function does not pin the
 * tenant). Mode `"returns"`: the whole body, returning the reads its `return` values
 * depend on (for `ReadSummaries`). A call to a same-file helper in `summaries` counts as
 * a read of the helper's table at the call site.
 */
function decidingReads(fn: FnUnit, ctx: TenantContext, summaries: ReadSummaries, mode: "pin" | "returns" = "pin"): ScopedRead[] {
  const reads: ScopedRead[] = [];
  const returned = new Set<number>();
  const env = new Map<string, Set<number>>();
  const byValue = new Set<number>();
  const byCondition = new Set<number>();
  const across = new WeakSet<object>();
  let pinned = false;
  let stmtSpan: any = fn.span;
  const seen = new WeakSet<object>();

  const register = (query: string | null, isAcross: boolean, span: any): Set<number> => {
    if (query === null || isAcross) return new Set();
    const s = resolveTenantScoping(query, ctx);
    if (s === null || (s.kind !== "read" && s.kind !== "unresolvable")) return new Set();
    const table = s.kind === "read"
      ? s.table
      : (tenantTableMentioned(query, (n) => ctx.tenantScopedTables.has(n), ctx.tenantScopedTables) ?? "a tenant-scoped table");
    const id = reads.length;
    reads.push({ id, table, query, span });
    return new Set([id]);
  };
  const decide = (into: Set<number>, deps: Set<number>): void => { for (const d of deps) into.add(d); };
  const union = (a: Set<number>, b: Set<number>): Set<number> => { for (const x of b) a.add(x); return a; };

  const walk = (node: unknown): Set<number> => {
    const deps = new Set<number>();
    if (pinned || !node || typeof node !== "object") return deps;
    if (Array.isArray(node)) {
      for (const c of node) { union(deps, walk(c)); if (pinned) break; }
      return deps;
    }
    if (seen.has(node as object)) return deps;
    seen.add(node as object);
    const n = node as Record<string, any>;
    if (NESTED_FN_KINDS.has(n.kind)) return deps;          // runs when called, not here
    const outerSpan = stmtSpan;
    if (typeof n.id === "number" && n.span && typeof n.span.line === "number") stmtSpan = n.span;
    try {
      // A `?{}` statement / initializer node: the query and its chain, structurally.
      if (n.kind === "sql" && typeof n.query === "string") {
        const chain: any[] = Array.isArray(n.chainedCalls) ? n.chainedCalls : [];
        return register(n.query, chain.some((c) => c && c.method === "acrossTenants"), stmtSpan);
      }
      if (n.kind === "sql-ref") return register(sqlRefQuery(n.raw), across.has(n), stmtSpan);
      if (n.kind === "call" && n.callee?.kind === "ident" && typeof n.callee.name === "string" &&
        summaries.has(n.callee.name) && !env.has(n.callee.name)) {
        // A helper that returns a tenant-scoped read: the read runs here, at the call.
        const own = new Set<number>();
        for (const a of Array.isArray(n.args) ? n.args : []) union(own, walk(a));
        const id = reads.length;
        reads.push({ id, table: summaries.get(n.callee.name)!.table, query: `${n.callee.name}(…)`, span: stmtSpan, via: n.callee.name });
        own.add(id);
        return own;
      }
      if (n.kind === "call") {
        // `?{…}.acrossTenants()…` — mark the query this chain is rooted in.
        if (n.callee?.kind === "member" && n.callee.property === "acrossTenants") {
          let cur = n.callee.object;
          while (cur && (cur.kind === "call" || cur.kind === "member")) cur = cur.kind === "call" ? cur.callee : cur.object;
          if (cur && cur.kind === "sql-ref") across.add(cur);
        }
        if (mode === "pin" && isSessionPin(n, "tenantId") && !pinClears(n)) {
          decide(byValue, walk(n.args[1]));
          pinned = true;
          return deps;
        }
      }
      if (n.kind === "ident" && typeof n.name === "string") return new Set(env.get(n.name) ?? []);
      // A condition (an `if` / `while` / `match` / `switch` test, a loop's iterable or
      // C-style test) DECIDES the pin when the pin is inside the statement it controls,
      // or when that statement can leave the function before the pin (a `return` /
      // `throw` / `fail` in it). A condition that only guards unrelated work does not.
      const cond = new Set<number>();
      for (const k of ["condExpr", "headerExpr", "iterExpr"]) {
        if (n[k] && typeof n[k] === "object") union(cond, walk(n[k]));
      }
      if (n.cStyleParts && typeof n.cStyleParts === "object") {
        union(deps, walk(n.cStyleParts.initExpr));
        union(cond, walk(n.cStyleParts.condExpr));
      }
      union(deps, cond);
      // `for (const r of <rows>)` binds the loop variable to the rows it iterates.
      if (n.kind === "for-stmt" && n.variable) for (const nm of boundNames(n.variable)) env.set(nm, new Set(cond));
      for (const k in n) {
        if (skipKey(k) || k === "condExpr" || k === "headerExpr" || k === "iterExpr" || k === "cStyleParts") continue;
        union(deps, walk(n[k]));
        if (pinned) break;
      }
      if (cond.size > 0 && (pinned || exitsWithin(n))) decide(byCondition, cond);
      if (DECL_KINDS.has(n.kind)) {
        for (const nm of boundNames(n.name)) env.set(nm, new Set(deps));
        return new Set();
      }
      // `@cur = <expr>` inside the function (a `state-decl`): later reads spell it `@cur`
      // (S456 review F4: a read stored in a cell, then pinned from `@cur.tenant_id`).
      if (n.kind === "state-decl" && typeof n.name === "string") {
        env.set("@" + n.name, union(new Set(env.get("@" + n.name) ?? []), deps));
        return new Set();
      }
      if (mode === "returns" && n.kind === "return-stmt") union(returned, deps);
      // `x = <expr>` re-binds a local
      if (n.kind === "assign" && n.target?.kind === "ident" && typeof n.target.name === "string") {
        env.set(n.target.name, union(new Set(env.get(n.target.name) ?? []), deps));
      }
      return deps;
    } finally {
      stmtSpan = outerSpan;
    }
  };
  const top = walk(fn.body);
  if (mode === "returns" && !Array.isArray(fn.body)) union(returned, top);   // an expression-bodied lambda returns its body
  if (mode === "returns") return reads.filter((r) => returned.has(r.id));
  if (!pinned) return [];
  // The CONDITION limb only in a function that also establishes the identity (a login).
  const login = pinsUserId(fn);
  const out: ScopedRead[] = [];
  for (const r of reads) {
    if (byValue.has(r.id)) out.push({ ...r, how: "value" });
    else if (login && byCondition.has(r.id)) out.push({ ...r, how: "condition" });
  }
  return out;
}

/** Does this function pin `userId` (`session.set("userId", v)`, v not `not`) — establish an identity? */
function pinsUserId(fn: Record<string, any>): boolean {
  let found = false;
  const seen = new WeakSet<object>();
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    const o = n as Record<string, any>;
    if (NESTED_FN_KINDS.has(o.kind)) return;
    if (isSessionPin(o, "userId") && !pinClears(o)) { found = true; return; }
    for (const k in o) if (!skipKey(k)) walk(o[k]);
  };
  walk(fn.body);
  return found;
}

/**
 * Every function body in a file AST (nested ones included; each judged on its own body):
 * `function-decl`s, and STRUCTURED lambdas — an expression-bodied arrow, or a block body
 * when one is structured (`{ kind: "block", stmts }`). A block-bodied arrow is an
 * `escape-hatch` (raw text) in this AST (expression-parser.ts: "we cannot fully convert
 * block statements") — not readable here without re-parsing source text (Rule 7), so it is
 * not judged (S456 review F6, a documented miss). A lambda is named by the declaration it
 * initializes (`const go = (…) => …`), else `<lambda>`.
 */
function functionsOf(fileAST: unknown): FnUnit[] {
  const out: FnUnit[] = [];
  const seen = new WeakSet<object>();
  // `stmtSpan`: the nearest enclosing STATEMENT span (an expression's span is relative to
  // its own text — a lambda is reported at the statement that holds it).
  const walk = (n: unknown, declName: string | null, stmtSpan: any): void => {
    if (!n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c, null, stmtSpan); return; }
    const o = n as Record<string, any>;
    const here = typeof o.id === "number" && o.span && typeof o.span.line === "number" ? o.span : stmtSpan;
    if (o.kind === "function-decl" && Array.isArray(o.body)) {
      out.push({ name: typeof o.name === "string" ? o.name : "<anonymous>", body: o.body, params: o.params ?? [], span: here });
    } else if (o.kind === "lambda" && o.body && typeof o.body === "object") {
      const body = o.body.kind === "block" ? o.body.stmts : o.body.kind === "expr" ? o.body.value : null;
      if (body) out.push({ name: declName ?? "<lambda>", body, params: o.params ?? [], span: here });
    }
    const name = DECL_KINDS.has(o.kind) && typeof o.name === "string" ? o.name : null;
    for (const k in o) if (!skipKey(k)) walk(o[k], name, here);
  };
  const root = (fileAST as any)?.ast ?? fileAST;
  walk((root as any)?.nodes ?? (fileAST as any)?.nodes ?? [], null, undefined);
  return out;
}

/**
 * `ReadSummaries` for one file: every NAMED function whose return value is a tenant-scoped
 * read, directly or through another summarized helper — iterated to a fixpoint (bounded by
 * the number of functions). A name declared twice is not summarized (which one a call
 * reaches is not decided here).
 */
function readSummaries(fns: FnUnit[], ctx: TenantContext): ReadSummaries {
  const summaries: ReadSummaries = new Map();
  const counts = new Map<string, number>();
  for (const f of fns) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
  const named = fns.filter((f) => !f.name.startsWith("<") && counts.get(f.name) === 1 && !shadowsSession(f));
  for (let round = 0; round <= named.length; round++) {
    let changed = false;
    for (const f of named) {
      if (summaries.has(f.name)) continue;
      const r = decidingReads(f, ctx, summaries, "returns");
      if (r.length > 0) { summaries.set(f.name, { table: r[0].table }); changed = true; }
    }
    if (!changed) break;
  }
  return summaries;
}

/** The warning text: the corollary, the observed effect, and the two fixes. */
export function tenantSubstrateMessage(fnName: string, table: string, line: number | null, how: "value" | "condition" = "value", via?: string): string {
  const at = (via ? ` (through \`${via}()\`)` : "") + (line !== null ? ` (line ${line})` : "");
  const what = how === "value"
    ? `pins the tenant (\`session.set("tenantId", …)\`) on the result of a read of \`${table}\`${at}`
    : `establishes a login (\`session.set("userId", …)\` and \`session.set("tenantId", …)\`) behind a condition on ` +
      `a read of \`${table}\`${at}`;
  return (
    `${TENANT_SUBSTRATE_CODE}: \`${fnName}()\` ${what}, and \`${table}\` is tenant-scoped — it carries a \`tenant_id\` ` +
    `column, and the column's presence is the declaration (§14.8.10). The read runs BEFORE the pin, so the floor ` +
    `filters it to the tenant active before the pin: with none pinned yet (a login) it returns zero rows` +
    (how === "value" ? " and the pin is never reached with a value" : ", so the login never succeeds") +
    `; with one pinned it sees only that tenant's rows. §14.8.10 corollary: the identity/grant ` +
    `substrate (\`users\` / \`user_roles\`) is NOT tenant-scoped — you would need the tenant to read the table that ` +
    `tells you the tenant (infinite regress). Fix: drop \`tenant_id\` from \`${table}\` (the table the tenant is ` +
    `resolved from is not a domain table), or read it with \`.acrossTenants()\` — or, if the tenant is already pinned ` +
    `earlier in the request (an org-first login), drop the redundant re-pin. (See SPEC §14.8.10.)`
  );
}

/**
 * The W-TENANT-SUBSTRATE-SCOPED warnings for one file, against the compilation's
 * tenant context (`buildTenantContext(…, compilationTenantSet(…))`). Empty when no
 * table is tenant-scoped or the file shadows the `session` builtin.
 */
export function fileTenantSubstrateReads(fileAST: unknown, ctx: TenantContext): TenantSubstrateDiagnostic[] {
  if (!ctx || ctx.tenantScopedTables.size === 0) return [];
  if (fileDeclaresFileScopeBinding(fileAST, "session")) return [];
  try { if (collectReactiveVarNames(fileAST as any).has("session")) return []; } catch { /* no reactive census → no shadow */ }
  const out: TenantSubstrateDiagnostic[] = [];
  const fns = functionsOf(fileAST);
  const summaries = readSummaries(fns, ctx);
  for (const fn of fns) {
    if (shadowsSession(fn)) continue;
    for (const r of decidingReads(fn, ctx, summaries)) {
      const line = r.span && typeof r.span.line === "number" ? r.span.line : null;
      out.push({ code: TENANT_SUBSTRATE_CODE, message: tenantSubstrateMessage(fn.name, r.table, line, r.how ?? "value", r.via), span: r.span ?? fn.span, severity: "warning" });
    }
  }
  return out;
}
