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

/**
 * The A1/S2 transform. Rewrites every `_scrml_sql` (or scoped `_scrml_sql_<n>`)
 * QUERY expression in `src` into a principal-scoped `.begin(...)` transaction.
 * Transaction-control `.unsafe("BEGIN"/"COMMIT"/…)` calls, the module-level
 * `const _scrml_sql = new SQL(...)` declaration, and any non-query reference are
 * left untouched. Idempotent-safe: the injected wrapper runs queries on `tx`
 * (never `_scrml_sql`), so a re-scan finds no new `_scrml_sql` query site.
 *
 * @param src the assembled server-module text
 * @returns the transformed text
 */
export function wrapPrincipalTxn(src: string): string {
  const HANDLE = "_scrml_sql";
  let out = "";
  let i = 0;
  const n = src.length;

  while (i < n) {
    const idx = src.indexOf(HANDLE, i);
    if (idx === -1) { out += src.slice(i); break; }
    out += src.slice(i, idx);

    // Confirm a standalone handle identifier (`_scrml_sql` or `_scrml_sql_<n>`),
    // not a substring of a longer identifier and not preceded by an ident char.
    const before = idx > 0 ? src[idx - 1] : "";
    let j = idx + HANDLE.length;
    if (src[j] === "_") {
      let k = j + 1;
      while (k < n && /[0-9]/.test(src[k])) k++;
      if (k > j + 1) j = k;
    }
    const ident = src.slice(idx, j);
    if (before && IDENT_CHAR.test(before)) { out += ident; i = j; continue; }
    if (j < n && IDENT_CHAR.test(src[j])) { out += ident; i = j; continue; }

    // Classify what follows the handle.
    let exprEnd = -1;
    const next = src[j];
    if (next === "`") {
      // Tagged-template query: `_scrml_sql`…``
      const end = templateLiteralEnd(src, j);
      if (end !== -1) exprEnd = end;
    } else if (next === ".") {
      const rest = src.slice(j);
      const m = /^\.unsafe\s*\(/.exec(rest);
      if (m) {
        const parenOpen = j + m[0].length - 1;
        const parenEnd = matchingParenEnd(src, parenOpen);
        if (parenEnd !== -1) {
          const argText = src.slice(parenOpen + 1, parenEnd - 1);
          if (!isTxnControlUnsafe(argText)) exprEnd = parenEnd;
        }
      }
    }

    if (exprEnd === -1) { out += ident; i = j; continue; }

    // Wrap [idx, exprEnd) — the whole `_scrml_sql`…query — in a principal txn.
    const exprText = src.slice(idx, exprEnd);
    const innerOnTx = "tx" + exprText.slice(ident.length);
    const lineStart = src.lastIndexOf("\n", idx) + 1;
    const indent = (src.slice(lineStart, idx).match(/^\s*/) || [""])[0];
    const b = indent + "  ";
    const wrapped =
      `${ident}.begin(async (tx) => {\n` +
      `${b}await tx\`SELECT set_config('${DBAUTH_TENANT_GUC}', ` +
      "${_scrml_active_tenant(_scrml_req)}, true)`;\n" +
      `${b}await tx.unsafe("SET LOCAL ROLE ${DBAUTH_ROLE}");\n` +
      `${b}return await ${innerOnTx};\n` +
      `${indent}})`;
    out += wrapped;
    i = exprEnd;
  }

  return out;
}
