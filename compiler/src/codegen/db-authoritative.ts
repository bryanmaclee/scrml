/**
 * §14.8.11 DB-authoritative tier — Milestone 1 (reads-authoritative, Postgres).
 *
 * Two server-emission concerns live here:
 *   1. `appDeclaresDbAuthoritative(fileAST)` — the CONDITIONAL-ENGAGEMENT gate.
 *      True iff the app declares ≥1 `db-authoritative` `<schema>` table. When
 *      false, emit-server does NOTHING here and the server bundle is
 *      byte-identical to today (the single-ambient-handle fast path).
 *   2. `wrapPrincipalTxn(src)` — the A1/S2 HOT-PATH transform. For a
 *      db-authoritative app, every `?{}` query (emitted as `_scrml_sql.unsafe(…)`
 *      or a `_scrml_sql`…`` tagged template) runs on a RESERVED connection
 *      carrying the per-request principal: a `_scrml_sql.begin(async (tx) => …)`
 *      transaction that pins the tenant via a txn-scoped `set_config(…, true)`
 *      and drops to the bounded `scrml_app` role via `SET LOCAL ROLE`, then runs
 *      the original query on `tx`.
 *
 * Spike findings this encodes (validated vs real PG16):
 *   - `SET LOCAL` cannot be parameterized → the tenant is injected via
 *     `set_config('scrml.tenant', <pinned>, true)` (the `true` = txn-scoped →
 *     auto-resets on commit → no cross-request principal bleed under a pool).
 *   - A shared-handle statement-level BEGIN does NOT hold the principal under a
 *     pool; `sql.begin` binds ONE connection for the whole callback → the
 *     principal holds for the query.
 *   - The bounded `NOBYPASSRLS` role drop is MANDATORY (a superuser/owner
 *     BYPASSES FORCE RLS — A1 without S6 is a silent no-op).
 *
 * The pinned tenant scalar is `_scrml_active_tenant(_scrml_req)` — the SAME
 * value §14.8.10's egress floor consumes (tenant-egress.ts). Every server-fn
 * handler takes `_scrml_req` as its request parameter, so the scalar is in scope
 * at every query site. (Milestone 1 targets server-fn handler queries; SSR
 * `/__serverLoad` query wrapping — which uses a different request binding — is a
 * P1-tail follow-on.)
 */

import { parseSchemaBlock } from "../schema-differ.js";
import { DBAUTH_ROLE, DBAUTH_TENANT_GUC } from "../schema-differ.js";

/**
 * Walk a file AST for `<schema>` state blocks and report whether ANY declared
 * table carries the `db-authoritative` opt-in marker. Pure; no I/O.
 */
export function appDeclaresDbAuthoritative(fileAST: unknown): boolean {
  const seen = new WeakSet<object>();
  let found = false;

  const collectSchemaBody = (node: any): string => {
    let text = "";
    for (const c of node?.children ?? []) {
      if (c && c.kind === "text" && typeof c.value === "string") text += c.value;
    }
    return text;
  };

  const walk = (value: unknown, depth: number): void => {
    if (found || value === null || typeof value !== "object" || depth > 64) return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as Record<string, any>;
    if (node.kind === "state" && node.stateType === "schema") {
      const body = collectSchemaBody(node);
      if (body.trim().length > 0) {
        let parsed: { tables?: Array<{ dbAuthoritative?: boolean }> } = {};
        try { parsed = parseSchemaBlock(body); } catch { parsed = {}; }
        for (const t of parsed.tables ?? []) {
          if (t && t.dbAuthoritative) { found = true; return; }
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      walk(node[key], depth + 1);
    }
  };

  walk(fileAST, 0);
  return found;
}

/**
 * Extract the DESIRED `<schema>` table set from a file AST — the migration-apply
 * seam's (§14.8.11 M2) desired-state input. Walks every `<schema>` state block,
 * parses each body with `parseSchemaBlock`, and merges the tables (first
 * declaration of a name wins). Each returned table carries its `dbAuthoritative`
 * flag, so `scrml db-migrate` can drive `diffSchema({ driver: "postgres" })` (which
 * appends the S1/S6 db-authoritative DDL for a `dbAuthoritative` table). Pure; no I/O.
 *
 * This is the desired-state counterpart to the reverse-direction `readActualSchemaPg`
 * (live DB → actual): together they feed `diffSchema` the desired-vs-actual pair the
 * apply loop reconciles.
 *
 * @returns `{ tables }` in the same shape `parseSchemaBlock` yields.
 */
export function extractDesiredSchema(
  fileAST: unknown,
): { tables: Array<{ name: string; dbAuthoritative?: boolean; [k: string]: unknown }> } {
  const seen = new WeakSet<object>();
  const bodies: string[] = [];

  const collectSchemaBody = (node: any): string => {
    let text = "";
    for (const c of node?.children ?? []) {
      if (c && c.kind === "text" && typeof c.value === "string") text += c.value;
    }
    return text;
  };

  const walk = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 64) return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as Record<string, any>;
    if (node.kind === "state" && node.stateType === "schema") {
      const body = collectSchemaBody(node);
      if (body.trim().length > 0) bodies.push(body);
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key.startsWith("_")) continue;
      walk(node[key], depth + 1);
    }
  };

  walk(fileAST, 0);

  const tables: Array<{ name: string; dbAuthoritative?: boolean; [k: string]: unknown }> = [];
  const seenNames = new Set<string>();
  for (const body of bodies) {
    let parsed: { tables?: Array<{ name?: string }> } = {};
    try {
      parsed = parseSchemaBlock(body) as any;
    } catch {
      continue;
    }
    for (const t of parsed.tables ?? []) {
      if (t && typeof t.name === "string" && !seenNames.has(t.name)) {
        seenNames.add(t.name);
        tables.push(t as any);
      }
    }
  }
  return { tables };
}

/**
 * True iff `argText` (the raw argument text of a `_scrml_sql.unsafe(...)` call)
 * is a transaction-control / session-control statement — BEGIN / COMMIT /
 * ROLLBACK / SET / SAVEPOINT / RELEASE / START / ABORT / END. Those are NOT
 * queries and must NOT be individually wrapped in a principal txn (they either
 * are the §8.9.2 write-envelope's own transaction control — P2 write-authority
 * territory — or are our OWN injected `SET LOCAL ROLE`).
 */
function isTxnControlUnsafe(argText: string): boolean {
  return /["'`]\s*(BEGIN|COMMIT|ROLLBACK|SET|SAVEPOINT|RELEASE|START|ABORT|END)\b/i.test(argText);
}

/**
 * Given `src` and the index of a template-literal opening backtick, return the
 * index one past the matching closing backtick, tracking `${...}` interpolation
 * (which may itself contain nested template literals / braces / strings).
 * Returns -1 if unterminated.
 */
function templateLiteralEnd(src: string, backtickIdx: number): number {
  let i = backtickIdx + 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") return i + 1;
    if (c === "$" && src[i + 1] === "{") {
      // Skip a balanced `${ ... }` interpolation (brace-depth aware, and aware
      // of nested strings / template literals inside it).
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const d = src[i];
        if (d === "\\") { i += 2; continue; }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        else if (d === "`") { i = templateLiteralEnd(src, i); if (i === -1) return -1; continue; }
        else if (d === '"' || d === "'") { i = stringLiteralEnd(src, i); if (i === -1) return -1; continue; }
        i++;
      }
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Given `src` and the index of a `"` or `'` opening quote, return the index one
 * past the matching closing quote (escape-aware). Returns -1 if unterminated.
 */
function stringLiteralEnd(src: string, quoteIdx: number): number {
  const q = src[quoteIdx];
  let i = quoteIdx + 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === q) return i + 1;
    i++;
  }
  return -1;
}

/**
 * Given `src` and the index of an opening `(`, return the index one past the
 * matching `)`, tracking nested parens + strings + template literals. Returns
 * -1 if unbalanced.
 */
function matchingParenEnd(src: string, openIdx: number): number {
  let i = openIdx;
  const n = src.length;
  let depth = 0;
  while (i < n) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === '"' || c === "'") { i = stringLiteralEnd(src, i); if (i === -1) return -1; continue; }
    if (c === "`") { i = templateLiteralEnd(src, i); if (i === -1) return -1; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return -1;
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const HANDLE = "_scrml_sql";
const REQ_PARAM = "_scrml_req";

/** True iff `word` sits at `src[at]` as a standalone identifier (word-boundary). */
function matchesWordAt(src: string, at: number, word: string): boolean {
  if (!src.startsWith(word, at)) return false;
  if (at > 0 && IDENT_CHAR.test(src[at - 1])) return false;
  const after = src[at + word.length];
  if (after !== undefined && IDENT_CHAR.test(after)) return false;
  return true;
}

/**
 * From `afterKeyword` (just past the `function` keyword), skip an optional `*`
 * generator marker + an optional name, then read the `( … )` parameter list.
 * Returns `{ hasReq, paramsEnd }` (paramsEnd = index one past the closing `)`),
 * or null if no param list is found.
 */
function parseFunctionParams(src: string, afterKeyword: number): { hasReq: boolean; paramsEnd: number } | null {
  let i = afterKeyword;
  const n = src.length;
  while (i < n && /\s/.test(src[i])) i++;
  if (src[i] === "*") { i++; while (i < n && /\s/.test(src[i])) i++; } // generator
  while (i < n && IDENT_CHAR.test(src[i])) i++; // optional name
  while (i < n && /\s/.test(src[i])) i++;
  if (src[i] !== "(") return null;
  const parenEnd = matchingParenEnd(src, i);
  if (parenEnd === -1) return null;
  const params = src.slice(i + 1, parenEnd - 1);
  return { hasReq: new RegExp(`\\b${REQ_PARAM}\\b`).test(params), paramsEnd: parenEnd };
}

/**
 * Given the index of an arrow `=>`, back-scan its parameter list and report
 * whether it binds `_scrml_req`. Handles both `( … ) =>` and a single-ident
 * `x =>` form.
 */
function arrowParamsHaveReq(src: string, arrowIdx: number): boolean {
  let i = arrowIdx - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 0) return false;
  if (src[i] === ")") {
    // Back-match to the opening `(`.
    let depth = 0;
    for (let k = i; k >= 0; k--) {
      const ch = src[k];
      if (ch === ")") depth++;
      else if (ch === "(") { depth--; if (depth === 0) return new RegExp(`\\b${REQ_PARAM}\\b`).test(src.slice(k + 1, i)); }
    }
    return false;
  }
  // Single-identifier param (`x =>`): read it backward.
  let end = i + 1;
  while (i >= 0 && IDENT_CHAR.test(src[i])) i--;
  return src.slice(i + 1, end) === REQ_PARAM;
}

/**
 * The A1/S2 transform — SCOPE-AWARE. Rewrites a `_scrml_sql` (or scoped
 * `_scrml_sql_<n>`) QUERY expression into a principal-scoped `.begin(...)`
 * transaction ONLY when the query site is lexically inside a function that has
 * `_scrml_req` in scope (its own param, or an enclosing function's — closure).
 *
 * This is load-bearing for correctness, not a nicety: the compiler emits
 * MODULE-LEVEL infra helpers that also use `_scrml_sql` — the `_scrml_idempotency_*`
 * shadow-table functions (`_scrml_idempotency_ensure_table` / `_lookup` / `_store`)
 * take NO `_scrml_req`. Those are bookkeeping queries against `_scrml_idempotency_keys`,
 * NOT tenant-principal queries: wrapping them would (a) inject `_scrml_active_tenant(
 * _scrml_req)` where `_scrml_req` is undefined → runtime ReferenceError, and (b) drop
 * them to the bounded `scrml_app` role (no grant, no CREATE TABLE) → failure. They
 * MUST stay on the ambient handle / base role. Tracking the `_scrml_req` scope (not
 * a name-blacklist) keeps the next infra helper safe too.
 *
 * Transaction-control `.unsafe("BEGIN"/…)` calls and the module-level
 * `const _scrml_sql = new SQL(...)` declaration are never wrapped. Strings,
 * template literals, and comments are skipped so a `_scrml_sql` mention there is
 * never mistaken for a query site.
 *
 * @param src the assembled server-module text
 * @returns the transformed text
 */
export function wrapPrincipalTxn(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  // Brace-scope stack of `reqInScope` flags. Index 0 = module scope (no req).
  const scope: boolean[] = [false];
  // reqInScope the NEXT `{` should push (set by a function/arrow header); null =
  // the next `{` inherits the current scope (object literal / control block).
  let pending: boolean | null = null;
  const top = () => scope[scope.length - 1];

  while (i < n) {
    const c = src[i];

    // A pending function/arrow scope is consumed ONLY by the immediately
    // following `{`. If a non-ws / non-comment token intervenes (an arrow with an
    // EXPRESSION body, `=> expr`), the pending scope never opens — drop it.
    if (pending !== null && !/\s/.test(c) && c !== "{" &&
        !(c === "/" && (src[i + 1] === "/" || src[i + 1] === "*"))) {
      pending = null;
    }

    // Line comment.
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      out += src.slice(i, end); i = end; continue;
    }
    // Block comment.
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      out += src.slice(i, end); i = end; continue;
    }
    // String literal.
    if (c === '"' || c === "'") {
      const e = stringLiteralEnd(src, i);
      const end = e === -1 ? n : e;
      out += src.slice(i, end); i = end; continue;
    }

    // `_scrml_sql` handle — classified BEFORE the bare-template branch so a
    // `_scrml_sql`…`` tagged template is treated as a query, not a skip.
    if (matchesWordAt(src, i, HANDLE)) {
      let j = i + HANDLE.length;
      if (src[j] === "_") {
        let k = j + 1;
        while (k < n && /[0-9]/.test(src[k])) k++;
        if (k > j + 1) j = k; // scoped `_scrml_sql_<n>`
      }
      const ident = src.slice(i, j);

      let exprEnd = -1;
      const next = src[j];
      if (next === "`") {
        const end = templateLiteralEnd(src, j);
        if (end !== -1) exprEnd = end;
      } else if (next === ".") {
        const m = /^\.unsafe\s*\(/.exec(src.slice(j));
        if (m) {
          const parenOpen = j + m[0].length - 1;
          const parenEnd = matchingParenEnd(src, parenOpen);
          if (parenEnd !== -1 && !isTxnControlUnsafe(src.slice(parenOpen + 1, parenEnd - 1))) {
            exprEnd = parenEnd;
          }
        }
      }

      // Wrap ONLY a genuine query site that is inside a `_scrml_req` scope.
      if (exprEnd !== -1 && top()) {
        const exprText = src.slice(i, exprEnd);
        const innerOnTx = "tx" + exprText.slice(ident.length);
        const lineStart = src.lastIndexOf("\n", i) + 1;
        const indent = (src.slice(lineStart, i).match(/^\s*/) || [""])[0];
        const b = indent + "  ";
        out +=
          `${ident}.begin(async (tx) => {\n` +
          `${b}await tx\`SELECT set_config('${DBAUTH_TENANT_GUC}', ` +
          "${_scrml_active_tenant(_scrml_req)}, true)`;\n" +
          `${b}await tx.unsafe("SET LOCAL ROLE ${DBAUTH_ROLE}");\n` +
          `${b}return await ${innerOnTx};\n` +
          `${indent}})`;
        i = exprEnd;
        continue;
      }
      // Not a query, or not in a req scope (module-level infra) → emit the handle
      // verbatim; the following template/parens are handled by the normal scan.
      out += ident; i = j; continue;
    }

    // Bare template literal (not `_scrml_sql`-tagged) — skip its content so its
    // `${}` braces never perturb the scope stack.
    if (c === "`") {
      const e = templateLiteralEnd(src, i);
      const end = e === -1 ? n : e;
      out += src.slice(i, end); i = end; continue;
    }

    // `function` header — the next `{` opens a new scope carrying its params
    // (plus closure over the current scope).
    if (matchesWordAt(src, i, "function")) {
      const parsed = parseFunctionParams(src, i + "function".length);
      if (parsed) {
        pending = parsed.hasReq || top();
        out += src.slice(i, parsed.paramsEnd); i = parsed.paramsEnd; continue;
      }
    }
    // Arrow header — its params precede `=>`; closure over the current scope.
    if (c === "=" && src[i + 1] === ">") {
      pending = arrowParamsHaveReq(src, i) || top();
      out += "=>"; i += 2; continue;
    }

    // Brace bookkeeping.
    if (c === "{") {
      scope.push(pending === null ? top() : pending);
      pending = null;
      out += c; i++; continue;
    }
    if (c === "}") {
      if (scope.length > 1) scope.pop();
      out += c; i++; continue;
    }

    out += c; i++;
  }

  return out;
}
