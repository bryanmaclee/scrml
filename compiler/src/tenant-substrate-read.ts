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
 * result DECIDES the pin: the read sits in the pin's value or in a branch / loop /
 * match condition evaluated before the pin, directly or through local bindings
 * derived from it. Such a pin is decided by rows the floor has already filtered to
 * the tenant active before the pin — with none (a login) the read returns zero rows;
 * with one, only that tenant's rows — which is exactly the corollary's regress, in
 * every session state. Deliberately NOT charged (each is not provable from the AST):
 *   - a tenant-scoped read before the pin whose result does not reach the pin or a
 *     condition before it (a tenant switch that reads the previous tenant's domain
 *     rows on purpose is legitimate);
 *   - a read inside a nested function or lambda (it runs when called, not in order);
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

/** One tenant-scoped read found before the pin. */
interface ScopedRead { id: number; table: string; query: string; span: any }

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

/** `session.set("tenantId", v)` — the §20.5.1 pin (callee + literal key, structurally). */
function isTenantPin(n: Record<string, any>): boolean {
  if (n.kind !== "call") return false;
  const c = n.callee;
  if (!c || c.kind !== "member" || c.property !== "set") return false;
  if (!c.object || c.object.kind !== "ident" || c.object.name !== "session") return false;
  const a = n.args;
  return Array.isArray(a) && a.length >= 2 && a[0]?.kind === "lit" && a[0].litType === "string" && a[0].value === "tenantId";
}

/** The pin clears the tenant (`session.set("tenantId", not)`) — a logout, not a resolution. */
function pinClears(n: Record<string, any>): boolean {
  const v = n.args?.[1];
  return !!v && v.kind === "lit" && v.litType === "not";
}

/** Names a declaration binds (a plain name or a destructuring pattern). */
function boundNames(name: unknown, out: string[] = []): string[] {
  if (typeof name === "string") { out.push(name); return out; }
  if (!name || typeof name !== "object") return out;
  const p = name as Record<string, any>;
  for (const k of ["elements", "properties", "fields", "items"]) {
    if (Array.isArray(p[k])) for (const e of p[k]) {
      if (typeof e === "string") out.push(e);
      else if (e && typeof e === "object") {
        if (typeof e.local === "string") out.push(e.local);
        else if (typeof e.alias === "string") out.push(e.alias);
        else if (typeof e.name === "string") out.push(e.name);
        else boundNames(e.pattern ?? e.value ?? e.name, out);
      }
    }
  }
  if (typeof p.rest === "string") out.push(p.rest);
  return out;
}

const DECL_KINDS = new Set(["const-decl", "let-decl", "tilde-decl", "lin-decl"]);
const NESTED_FN_KINDS = new Set(["function-decl", "lambda"]);

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
 * Walk ONE function body in evaluation order up to its first tenant pin. Returns the
 * reads that decide the pin (empty when the function does not pin the tenant).
 */
function decidingReads(fn: Record<string, any>, ctx: TenantContext): ScopedRead[] {
  const reads: ScopedRead[] = [];
  const env = new Map<string, Set<number>>();
  const deciding = new Set<number>();
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
  const decide = (deps: Set<number>): void => { for (const d of deps) deciding.add(d); };
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
      if (n.kind === "call") {
        // `?{…}.acrossTenants()…` — mark the query this chain is rooted in.
        if (n.callee?.kind === "member" && n.callee.property === "acrossTenants") {
          let cur = n.callee.object;
          while (cur && (cur.kind === "call" || cur.kind === "member")) cur = cur.kind === "call" ? cur.callee : cur.object;
          if (cur && cur.kind === "sql-ref") across.add(cur);
        }
        if (isTenantPin(n) && !pinClears(n)) {
          decide(walk(n.args[1]));
          pinned = true;
          return deps;
        }
      }
      if (n.kind === "ident" && typeof n.name === "string") return new Set(env.get(n.name) ?? []);
      // A condition evaluated before the pin decides whether (and with what) it runs.
      for (const k of ["condExpr", "headerExpr"]) {
        if (n[k] && typeof n[k] === "object") decide(union(deps, walk(n[k])));
      }
      if (n.cStyleParts && typeof n.cStyleParts === "object") {
        union(deps, walk(n.cStyleParts.initExpr));
        decide(union(deps, walk(n.cStyleParts.condExpr)));
      }
      for (const k in n) {
        if (skipKey(k) || k === "condExpr" || k === "headerExpr" || k === "cStyleParts") continue;
        union(deps, walk(n[k]));
        if (pinned) break;
      }
      if (DECL_KINDS.has(n.kind)) {
        for (const nm of boundNames(n.name)) env.set(nm, new Set(deps));
        return new Set();
      }
      // `x = <expr>` re-binds a local
      if (n.kind === "assign" && n.target?.kind === "ident" && typeof n.target.name === "string") {
        env.set(n.target.name, union(new Set(env.get(n.target.name) ?? []), deps));
      }
      return deps;
    } finally {
      stmtSpan = outerSpan;
    }
  };
  walk(fn.body);
  return pinned ? reads.filter((r) => deciding.has(r.id)) : [];
}

/** Every function declaration in a file AST (nested ones included; each judged on its own body). */
function functionsOf(fileAST: unknown): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  const seen = new WeakSet<object>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    const o = n as Record<string, any>;
    if (o.kind === "function-decl" && Array.isArray(o.body)) out.push(o);
    for (const k in o) if (!skipKey(k)) walk(o[k]);
  };
  const root = (fileAST as any)?.ast ?? fileAST;
  walk((root as any)?.nodes ?? (fileAST as any)?.nodes ?? []);
  return out;
}

/** The warning text: the corollary, the observed effect, and the two fixes. */
export function tenantSubstrateMessage(fnName: string, table: string, line: number | null): string {
  const at = line !== null ? ` (line ${line})` : "";
  return (
    `${TENANT_SUBSTRATE_CODE}: \`${fnName}()\` pins the tenant (\`session.set("tenantId", …)\`) on the result of a ` +
    `read of \`${table}\`${at}, and \`${table}\` is tenant-scoped — it carries a \`tenant_id\` column, and the ` +
    `column's presence is the declaration (§14.8.10). The read runs BEFORE the pin, so the floor filters it to the ` +
    `tenant active before the pin: with none pinned yet (a login) it returns zero rows and the pin is never reached ` +
    `with a value; with one pinned it sees only that tenant's rows. §14.8.10 corollary: the identity/grant ` +
    `substrate (\`users\` / \`user_roles\`) is NOT tenant-scoped — you would need the tenant to read the table that ` +
    `tells you the tenant (infinite regress). Fix: drop \`tenant_id\` from \`${table}\` (the table the tenant is ` +
    `resolved from is not a domain table), or read it with \`.acrossTenants()\`. (See SPEC §14.8.10.)`
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
  for (const fn of functionsOf(fileAST)) {
    if (shadowsSession(fn)) continue;
    const name = typeof fn.name === "string" ? fn.name : "<anonymous>";
    for (const r of decidingReads(fn, ctx)) {
      const line = r.span && typeof r.span.line === "number" ? r.span.line : null;
      out.push({ code: TENANT_SUBSTRATE_CODE, message: tenantSubstrateMessage(name, r.table, line), span: r.span ?? fn.span, severity: "warning" });
    }
  }
  return out;
}
