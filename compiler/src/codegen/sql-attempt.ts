/**
 * §19.8.3 / §19.8.4 (S451 R11) — a HANDLED `?{}` query.
 *
 * A `?{}` query is a failable expression everywhere. When it is handled at the
 * site — by a `!{}` handler written after its terminator, or by a `match` on its
 * result — a query that FAILS TO RUN must reach the handler as a `SqlError`
 * variant, and the arm's value replaces the query's result. The driver reports
 * such a failure by throwing; this module turns that throw into the canonical
 * error envelope (`{ __scrml_error, type, variant, data }`, §19.9.1) that the
 * `!{}` / `match` lowering already discriminates on.
 *
 * "No row" is NOT a failure (§19.8.3, §19.8.4): a query that runs and matches
 * nothing returns its ordinary value (`.get()` → `not`, `.all()` → `[]`), which
 * the attempt passes through untouched.
 *
 * Only a HANDLED query is wrapped. An unhandled query is emitted exactly as
 * before (a failure throws into the route's error path — the impl#1 divergence
 * `g-impl1-sql-unhandled-outside-failable-s451`), so no other shape changes.
 *
 * Server-only. The wrapper is emitted only around a query, and a query is only
 * ever emitted into a server bundle; the helper is injected into the server
 * module on use (the same inline-on-use precedent as the protect / bool-coerce
 * helpers).
 */

import type { ExprNode } from "../types/ast.ts";
import { guardCallArmsRaw } from "../expression-parser.ts";

/** The runtime helper's name. Its presence in an emitted module triggers injection. */
export const SQL_ATTEMPT_FN = "_scrml_sql_attempt";

/**
 * The `SqlError` payload schema (§19.8.1): `QueryFailed(message: string)`,
 * `ConstraintViolation(field: string)`, `ConnectionLost`. Seeded into the
 * codegen variant registries (emit-control-flow.ts) so an arm `.QueryFailed(m)`
 * binds the `message` field, exactly as a file-local enum's arm would.
 */
export const SQL_ERROR_VARIANT_FIELDS: ReadonlyArray<readonly [string, string[]]> = [
  ["QueryFailed", ["message"]],
  ["ConstraintViolation", ["field"]],
  ["ConnectionLost", []],
];

/**
 * The `SqlError` variants a handler on a `?{}` must cover to be exhaustive
 * (E-TYPE-080 / E-TYPE-020, §19.7): §19.8.1's three, plus the variant the SPEC
 * itself adds — §8.9.4's `BatchPrepareFailed` ("surface as a single variant
 * `SqlError::BatchPrepareFailed`"). §19.8.3: "The handler is checked for
 * exhaustiveness against `SqlError` like any other `!{}` handler. Because the
 * compiler MAY add `SqlError` variants (§19.8.4) — §8.9.4's `BatchPrepareFailed`
 * is one — a `_ :>` arm keeps a handler total as the enum grows."
 */
export const SQL_ERROR_EXHAUSTIVE_VARIANTS: readonly string[] = [
  "QueryFailed", "ConstraintViolation", "ConnectionLost", "BatchPrepareFailed",
];

/**
 * The statement emitted on the branch where a handler on a failable result
 * matched NO arm (S454 fix round, F1 — FAIL CLOSED). A handler the type checker
 * accepted is exhaustive, so this branch is unreachable for every variant the
 * checker knows; if a failure the checker did not know still arrives, the error
 * is re-raised as a host error (the route's error path / the §19.6.8 backstop),
 * never yielded as the expression's value — an error envelope is a truthy
 * object, so letting it through as a value fails OPEN (`if (q() !{ … })`).
 * `resultVar` names the envelope.
 */
export function unhandledFailureThrow(resultVar: string): string {
  return `throw new _scrml_g.Error("scrml: no handler arm matched the failure " + ${resultVar}.type + "." + ${resultVar}.variant + " (§19.4.3)");`;
}

/** The SQL chain methods that can follow a `?{}` in an expression (§44.3, §8.9.5, §14.8.10). */
const SQL_CHAIN_METHODS = new Set(["all", "get", "first", "run", "prepare", "nobatch", "acrossTenants"]);

export interface SqlQueryExprShape {
  /** The query's source text, `?{`…`}`. */
  raw: string;
  /** The chain in source order — `?{…}.nobatch().get()` → [nobatch, get]. */
  chain: Array<{ method: string; args: ExprNode[] }>;
}

/**
 * Is `node` exactly an expression-position `?{}` query — a `sql-ref` carrying
 * its source (`raw`), optionally followed by a chain of SQL methods
 * (`.all()` / `.get()` / `.run()` / `.nobatch()` / `.acrossTenants()`)? Returns
 * the query's raw text and chain, or null for anything else (including a query
 * that is only PART of a larger expression, e.g. `?{…}.get().name`).
 */
export function sqlQueryExprShape(node: ExprNode | null | undefined): SqlQueryExprShape | null {
  if (!node) return null;
  const chain: Array<{ method: string; args: ExprNode[] }> = [];
  let cur: ExprNode = node;
  while (cur.kind === "call") {
    const callee = cur.callee;
    if (!callee || callee.kind !== "member" || callee.optional || cur.optional) return null;
    if (!SQL_CHAIN_METHODS.has(callee.property)) return null;
    chain.unshift({ method: callee.property, args: cur.args as ExprNode[] });
    cur = callee.object;
  }
  if (cur.kind !== "sql-ref" || typeof cur.raw !== "string" || !cur.raw.startsWith("?{")) return null;
  return { raw: cur.raw, chain };
}

/** A `?{}` query found as the leftmost operand of a handled expression. */
export interface SqlQueryHead {
  /** The query (its raw source and SQL chain). */
  shape: SqlQueryExprShape;
  /** The sub-node of the expression that IS the query (`sql-ref` + SQL chain). */
  query: ExprNode;
}

/**
 * §19.8.3 / §44.3 (S465, s462 fix round 1) — the `?{}` query a handled
 * expression starts from: the expression itself when it is exactly a query
 * (`?{…}.get()`), or the query that is its LEFTMOST operand
 * (`?{…}.get().name`, `?{…}.all().length`, `?{…}.get() is not`,
 * `?{…}.all().map(f)`), reached through the operand that JS evaluates FIRST —
 * a member / index object, a callee, a binary operator's left side, a ternary's
 * condition, a cast, a non-update unary's argument. Returns null when the
 * expression does not start from a query.
 *
 * SPEC §44.3: "the `?{}` is a failable expression in every context" — a tail
 * (`.name`, `.length`, …) applies to the query's SUCCESS value; it does not stop
 * the query from being the thing a `!{}` handles. So a handler on
 * `?{…}.get().name` handles the query's failure exactly as a handler on
 * `?{…}.get()` does (attempt-wrapped, E-TYPE-080 against `SqlError`), and on
 * success the tail runs on the row.
 */
export function sqlQueryHeadOfExpr(node: ExprNode | null | undefined): SqlQueryHead | null {
  let cur: ExprNode | null | undefined = node;
  for (let steps = 0; cur && steps < 10000; steps++) {
    const shape = sqlQueryExprShape(cur);
    if (shape) return { shape, query: cur };
    switch (cur.kind) {
      case "member": cur = cur.object; break;
      case "index": cur = cur.object; break;
      case "call": cur = cur.callee; break;
      case "binary": cur = cur.left; break;
      case "ternary": cur = cur.condition; break;
      case "cast": cur = cur.expression; break;
      case "unary":
        if (cur.op === "++" || cur.op === "--" || cur.op === "delete") return null;
        cur = cur.argument;
        break;
      default: return null;
    }
  }
  return null;
}

/**
 * The expression `node` with its leftmost query (`head.query`, found by
 * `sqlQueryHeadOfExpr`) replaced by `replacement` — the spine nodes down to the
 * query are shallow-copied, nothing else is touched. Used to apply a handled
 * query's tail to the query's success value (bound to a temporary).
 */
export function replaceSqlQueryHead(node: ExprNode, query: ExprNode, replacement: ExprNode): ExprNode {
  if (node === query) return replacement;
  const n = node as any;
  switch (node.kind) {
    case "member":
    case "index": return { ...n, object: replaceSqlQueryHead(n.object, query, replacement) };
    case "call": return { ...n, callee: replaceSqlQueryHead(n.callee, query, replacement) };
    case "binary": return { ...n, left: replaceSqlQueryHead(n.left, query, replacement) };
    case "ternary": return { ...n, condition: replaceSqlQueryHead(n.condition, query, replacement) };
    case "cast": return { ...n, expression: replaceSqlQueryHead(n.expression, query, replacement) };
    case "unary": return { ...n, argument: replaceSqlQueryHead(n.argument, query, replacement) };
    default: return node;
  }
}

/** The `sql-ref` at the bottom of a query node (`?{…}` under its SQL chain). */
function sqlRefOfQuery(query: ExprNode): ExprNode {
  let cur: ExprNode = query;
  while (cur.kind === "call" && cur.callee && cur.callee.kind === "member") cur = cur.callee.object;
  return cur;
}

/**
 * S465 (s462 fix round 2) — every `?{}` query (`sql-ref`) that evaluating `node`
 * runs, in source order: not one inside a nested function (a lambda / an
 * escape-hatch function — its own body, run when it is called) and not one in
 * the operand of a nested expression-position `!{}` (that handler covers it).
 */
export function sqlRefsOfExpr(node: ExprNode | null | undefined): ExprNode[] {
  const out: ExprNode[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    const o = v as Record<string, unknown>;
    if (o.kind === "sql-ref") {
      if (typeof o.raw === "string" && o.raw.startsWith("?{")) out.push(o as unknown as ExprNode);
      return;
    }
    if (o.kind === "lambda" || o.kind === "escape-hatch") return;
    if (o.kind === "call" && guardCallArmsRaw(o as unknown as ExprNode) !== null) return;
    for (const [k, x] of Object.entries(o)) if (k !== "span") visit(x);
  };
  visit(node);
  return out;
}

/**
 * §19.8.3 item 1 (S465, s462 fix round 2) — the queries a `!{}` handler on
 * `operand` does NOT cover. §19.8.3: "A `!{}` handler on the query — written
 * after the terminator (`.get()`, `.all()`, `.run()`)" handles THAT query; a
 * handler covers the one query that is its operand or its operand's leftmost
 * operand (`sqlQueryHeadOfExpr` — the tail runs on the success value). Any other
 * query the operand evaluates — one that is not leftmost (`"x" + ?{…}.get().name`,
 * `wrap(?{…}.get())`) or a second one (`?{A}.get().name + ?{B}.get().name`,
 * `?{A}.get() ?? ?{B}.get()`) — is not handled by it. Empty when the handler
 * covers every query (or the operand holds none).
 */
export function sqlQueriesNotCoveredByHandler(operand: ExprNode | null | undefined): ExprNode[] {
  const refs = sqlRefsOfExpr(operand);
  if (refs.length === 0) return refs;
  const head = sqlQueryHeadOfExpr(operand);
  const headRef = head ? sqlRefOfQuery(head.query) : null;
  return refs.filter((r) => r !== headRef);
}

/**
 * The global names a §52.6.5 Pattern C tail may read: the pure, server-defined
 * built-in namespaces and value names. Everything else a tail names must be
 * bound inside the tail (an arrow parameter).
 */
const PATTERN_C_SERVER_SAFE_GLOBALS: ReadonlySet<string> = new Set([
  "Math", "JSON", "Object", "Array", "Number", "String", "Boolean",
  "undefined", "NaN", "Infinity",
]);

/**
 * §52.6.5 Pattern C (S465, s462 fix round 2) — the query a `<x server>`
 * initializer EXPRESSION loads as the cell's mount load, or null when the
 * initializer is not that shape. SPEC §52.6.5: "When the RHS of a `<var server>`
 * declaration is an inline `?{}` query, that `?{}` IS the cell's mount load. The
 * compiler emits a `/__serverLoad/<var>` route that runs the query
 * server-side". The route runs the whole initializer server-side, where only the
 * server scope exists; so the initializer qualifies only when
 *   - the query is its LEFTMOST operand (`?{…}.get().name`, `?{…}.all().length`,
 *     `?{…}.all().map(u => u.name)`) — the RHS starts as the query; and
 *   - its tail is CLOSED over a known-server-safe set: literals, the parameters
 *     of arrow functions written in the tail (plain names — a destructured or
 *     defaulted parameter is not accepted), property names, and the pure built-in
 *     namespaces above. It reads no `@cell` (a client cell, `@currentUser` —
 *     classified here from the tree, never from text), no other query, no
 *     file-scope name (a client or server function, a `const`), and it does not
 *     assign, construct, or run a statement body.
 * Every other initializer that holds a query is NOT Pattern C: it stays on the
 * path it took before (the callable loader) — `wrap(?{…}.get())`,
 * `?{…}.all().filter(u => u.id == @sel)`, `?{…}.all().map(u => fmt(u))`.
 */
export function patternCQueryOfInit(init: ExprNode | null | undefined): SqlQueryHead | null {
  const head = sqlQueryHeadOfExpr(init);
  if (!head) return null;
  const headRef = sqlRefOfQuery(head.query);
  const isPlainName = (s: unknown): boolean => typeof s === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
  const closed = (n: unknown, bound: ReadonlySet<string>): boolean => {
    if (!n || typeof n !== "object") return false;
    const e = n as Record<string, any>;
    switch (e.kind) {
      case "sql-ref": return n === headRef;
      case "lit": return true;
      case "ident": {
        const name = String(e.name ?? "");
        if (name.startsWith("@")) return false;
        return bound.has(name) || PATTERN_C_SERVER_SAFE_GLOBALS.has(name);
      }
      case "member": return closed(e.object, bound);
      case "index": return closed(e.object, bound) && closed(e.index, bound);
      case "call":
        return closed(e.callee, bound) && (e.args as unknown[]).every((a) => closed(a, bound));
      case "binary": return closed(e.left, bound) && closed(e.right, bound);
      case "unary":
        if (e.op === "++" || e.op === "--" || e.op === "delete" || e.op === "await") return false;
        return closed(e.argument, bound);
      case "ternary": return closed(e.condition, bound) && closed(e.consequent, bound) && closed(e.alternate, bound);
      case "cast": return closed(e.expression, bound);
      case "spread": return closed(e.argument, bound);
      case "array": return (e.elements as unknown[]).every((x) => x === null || closed(x, bound));
      case "object":
        return (e.props as Array<Record<string, any>>).every((p) => {
          if (p.kind === "shorthand") return bound.has(p.name) || PATTERN_C_SERVER_SAFE_GLOBALS.has(p.name);
          if (p.kind === "spread") return closed(p.argument, bound);
          return (!p.computed || closed(p.key, bound)) && closed(p.value, bound);
        });
      case "lambda": {
        if (e.isAsync || !e.body || e.body.kind !== "expr") return false;
        const inner = new Set(bound);
        for (const p of e.params as Array<Record<string, any>>) {
          if (!isPlainName(p.name) || p.boundNames || p.defaultValue) return false;
          inner.add(p.name);
        }
        return closed(e.body.value, inner);
      }
      default: return false;
    }
  };
  return closed(init, new Set()) ? head : null;
}

/**
 * §19.8.3 (S455) — the `?{}` query that a STATEMENT-level `!{}` handler guards.
 *
 * A `!{}` written after a statement is parsed as
 * `guarded-expr { guardedNode: <the statement>, arms }`: the WHOLE statement is
 * wrapped, not the query. So a handled query is the same statement an unhandled
 * one is (`@c = ?{…}.get()` is a `state-decl` carrying `sqlNode`, `lift ?{…}` is
 * a `lift-expr` over `{ kind: "sql", node }`, `?{…}.run()` is a bare `sql`
 * statement), one level down. Every analysis that classifies statements by kind
 * must see that inner statement exactly as it sees the unhandled one — the
 * handler adds a failure path and changes nothing else (placement, purity, the
 * client/server split, protect, batching).
 *
 * Returns the guarded statement's query node (a structured `sql` node) — or
 * `"expr"` for an expression-position query that is the whole operand or its leftmost operand
 * (`const r = (?{…}.get()) !{…}`) — or null when the guard does not handle a
 * `?{}` (a guarded CALL, which keeps its own semantics).
 */
export function handledSqlOfGuardedNode(guardedNode: unknown): Record<string, unknown> | "expr" | null {
  if (!guardedNode || typeof guardedNode !== "object") return null;
  const g = guardedNode as Record<string, any>;
  if (g.kind === "sql") return g;
  if (g.sqlNode && typeof g.sqlNode === "object" && g.sqlNode.kind === "sql") return g.sqlNode;
  if (g.kind === "lift-expr" && g.expr && g.expr.kind === "sql" && g.expr.node && g.expr.node.kind === "sql") return g.expr.node;
  // S465 — also a query that is the LEFTMOST operand (`const n = ?{…}.get().name !{…}`):
  // the tail applies to the success value; the query is still what is handled.
  if (sqlQueryHeadOfExpr((g.initExpr ?? g.exprNode) as ExprNode | undefined) !== null) return "expr";
  return null;
}

/**
 * The statement a `!{}` on a `?{}` guards, when `node` is such a guard
 * (`guarded-expr` whose guarded statement holds the handled query); else null.
 * The one normalization the statement-classifying consumers share (S455).
 */
export function handledSqlGuardInner(node: unknown): Record<string, any> | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, any>;
  if (n.kind !== "guarded-expr" || !n.guardedNode || typeof n.guardedNode !== "object") return null;
  return handledSqlOfGuardedNode(n.guardedNode) !== null ? n.guardedNode : null;
}

/**
 * The server-bundle runtime helper. Injected into a server module IFF the module
 * references `_scrml_sql_attempt(`. Readable on purpose: an adopter debugging a
 * handled query lands here.
 */
export const SERVER_SQL_ATTEMPT_HELPER: string = [
  "",
  "// --- §19.8.3 (S451 R11): a ?{} query handled by !{} or match (compiler-generated) ---",
  "// A query that FAILS TO RUN becomes a SqlError value that the handler's arms match on,",
  "// instead of a throw. A query that runs and matches no row is not a failure: its value",
  "// (not / []) passes through unchanged. `args` (the query's parameters) were evaluated",
  "// by the caller and `then` (row shaping, tenant / protect wrappers) runs after the",
  "// try, so ONLY the driver call is attempted: a host error in a parameter, or a floor",
  "// refusal, keeps its own identity instead of becoming QueryFailed.",
  "async function _scrml_sql_attempt(run, args, then) {",
  "  let rows;",
  "  try {",
  "    rows = await run(args);",
  "  } catch (err) {",
  "    return _scrml_sql_error(err);",
  "  }",
  "  return then(rows);",
  "}",
  "// Map a driver error to a SqlError variant (§19.8.1): QueryFailed(message),",
  "// ConstraintViolation(field), ConnectionLost.",
  "function _scrml_sql_error(err) {",
  "  const message = _scrml_g.String((err && err.message) || err);",
  "  const code = _scrml_g.String((err && (err.code ?? err.errno)) ?? \"\");",
  "  if (/CONSTRAINT/i.test(code) || /^23\\d{3}$/.test(code) || /constraint failed/i.test(message)) {",
  "    const m = /constraint failed: ([\\w.]+)/i.exec(message);",
  "    const field = m ? m[1].split(\".\").pop() : _scrml_g.String((err && (err.column ?? err.constraint)) ?? \"\");",
  "    return { __scrml_error: true, type: \"SqlError\", variant: \"ConstraintViolation\", data: { field } };",
  "  }",
  "  if (/ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|CONNECTION_CLOSED/i.test(code) || /^08\\d{3}$/.test(code) ||",
  "      /connection (?:closed|lost|refused|terminated)/i.test(message)) {",
  "    return { __scrml_error: true, type: \"SqlError\", variant: \"ConnectionLost\", data: null };",
  "  }",
  "  return { __scrml_error: true, type: \"SqlError\", variant: \"QueryFailed\", data: { message } };",
  "}",
].join("\n");
