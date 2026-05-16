import { genVar } from "./var-counter.ts";
import { splitBareExprStatements } from "./compat/parser-workarounds.js";
import { rewriteReactiveRefsAST, rewriteServerReactiveRefsAST } from "../expression-parser.ts";
import { CGError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InlineMatchArm {
  kind: "variant" | "string" | "wildcard" | "not";
  /**
   * The arm's primary test value. For single-variant arms this is the variant
   * name (e.g. `"Big"`); for pipe-alternation arms it is the FIRST alternate
   * and `tests` carries the full list (e.g. `tests = ["Big", "Fire", "Cape"]`,
   * `test = "Big"`).
   */
  test: string | null;
  /**
   * Pipe-alternation alternates for `.A | .B | .C => result` arms. When set,
   * the emitted condition uses an OR-chain (`tag === "A" || tag === "B" || ...`).
   * For singleton arms this field is omitted/null. (§18 follow-on to S83 B3.)
   */
  tests?: string[] | null;
  result: string;
}

interface SqlParams {
  /** Legacy `?N` placeholder form. Retained for callers that still build
   *  positional-bind SQL strings (e.g. emit-control-flow loop hoist). */
  sql: string;
  /** Captured `${expr}` interpolation expressions in left-to-right order. */
  params: string[];
  /** Static text segments between params. `segments.length === params.length + 1`.
   *  Used by Bun.SQL tagged-template emission. */
  segments: string[];
}

interface TemplateAttrResult {
  jsExpr: string;
  reactiveVars: Set<string>;
}

/**
 * Context threaded through every rewrite pass.
 *
 * Each field is optional — passes that don't need a field ignore it.
 * This avoids n-ary function signatures and keeps passes independently callable.
 */
export interface RewriteContext {
  /** Compiler error accumulator. Passes that emit diagnostics push here. */
  errors?: any[];
  /** Derived reactive variable names for derived-aware @-ref rewriting. */
  derivedNames?: Set<string> | null;
  /** Database variable name for SQL rewrite (server path). Default: "_scrml_sql"
   *  (Bun.SQL tag function — §44). */
  dbVar?: string;
  /**
   * When true, rewritePresenceGuard is skipped. Set by callers that know the
   * input is an expression-position arrow/function body (e.g. escape-hatch
   * emission for ArrowFunctionExpression). A statement-level presence guard
   * rewrite would turn `(x) => { body }` into `if (x !== null ...) { body }`
   * which is wrong when the arrow is a callback value. Bug C (6nz 2026-04-20).
   */
  skipPresenceGuard?: boolean;
}

/**
 * A single rewrite pass. Takes the current expression string and an optional
 * context, returns the transformed string.
 */
type RewritePass = (input: string, ctx: RewriteContext) => string;

// ---------------------------------------------------------------------------
// rewriteReactiveRefs
// ---------------------------------------------------------------------------

/**
 * Rewrite `@varName` reactive references to runtime getter calls.
 */
export function rewriteReactiveRefs(expr: string, derivedNames: Set<string> | null = null): string {
  if (!expr || typeof expr !== "string") return expr;

  const astRewrite = rewriteReactiveRefsAST(expr, derivedNames);
  if (astRewrite.ok) return astRewrite.result;

  const hasDerived = derivedNames && derivedNames.size > 0;

  const result: string[] = [];
  let inString: string | null = null;
  let i = 0;
  let segStart = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === '`') {
        const segment = expr.slice(segStart, i);
        result.push(_rewriteSegment(segment, hasDerived ? derivedNames : null));
        inString = ch;
        segStart = i;
      }
    } else {
      if (ch === '\\') {
        i++;
      } else if (ch === inString) {
        result.push(expr.slice(segStart, i + 1));
        inString = null;
        segStart = i + 1;
      }
    }
    i++;
  }

  const remaining = expr.slice(segStart);
  if (inString === null) {
    result.push(_rewriteSegment(remaining, hasDerived ? derivedNames : null));
  } else {
    result.push(remaining);
  }

  return result.join("");
}

function _rewriteSegment(segment: string, derivedNames: Set<string> | null): string {
  if (!derivedNames) {
    return segment.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, '_scrml_reactive_get("$1")');
  }
  return segment.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, (_, name: string) => {
    if (derivedNames.has(name)) {
      return `_scrml_derived_get("${name}")`;
    }
    return `_scrml_reactive_get("${name}")`;
  });
}

// ---------------------------------------------------------------------------
// extractSqlParams
// ---------------------------------------------------------------------------

/**
 * Extract `${expr}` interpolations from a SQL template literal string.
 *
 * Returns three views of the input:
 *   - `params`  — the captured `${expr}` payloads, in order
 *   - `sql`     — legacy `?N` placeholder form (kept for emit-control-flow's
 *                 dynamic IN-list emitter, which builds runtime SQL strings
 *                 then binds via `sql.unsafe(rawSql, paramArray)`)
 *   - `segments` — the static text between params; `segments.length` is
 *                  always `params.length + 1`. Used to rebuild a Bun.SQL
 *                  tagged-template literal in `buildTaggedTemplate()`.
 */
export function extractSqlParams(sqlContent: string): SqlParams {
  const params: string[] = [];
  const segments: string[] = [];
  let sql = "";
  let curSeg = "";
  let i = 0;

  while (i < sqlContent.length) {
    if (sqlContent[i] === '$' && sqlContent[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < sqlContent.length && depth > 0) {
        if (sqlContent[j] === '{') depth++;
        else if (sqlContent[j] === '}') depth--;
        if (depth > 0) j++;
      }
      const paramExpr = sqlContent.slice(i + 2, j);
      params.push(paramExpr);
      sql += `?${params.length}`;
      segments.push(curSeg);
      curSeg = "";
      i = j + 1;
    } else {
      sql += sqlContent[i];
      curSeg += sqlContent[i];
      i++;
    }
  }
  segments.push(curSeg);

  return { sql, params, segments };
}

// ---------------------------------------------------------------------------
// buildTaggedTemplate
// ---------------------------------------------------------------------------

/**
 * Build a Bun.SQL tagged-template invocation from extracted params.
 *
 *   buildTaggedTemplate("sql", ["SELECT * FROM u WHERE id = ", ""], ["id"])
 *     → "sql`SELECT * FROM u WHERE id = ${id}`"
 *
 * The template body is a raw template literal — `${param}` slots are
 * preserved as JS interpolations so Bun.SQL binds each as a positional
 * parameter (§44.5: bound, never string-interpolated).
 *
 * Static text inside `segments` may legitimately contain backticks or
 * `${` sequences if the developer wrote a quoted SQL identifier or an
 * escaped sequence. We escape both so the generated template is a
 * syntactically valid JS template literal regardless of input.
 */
export function buildTaggedTemplate(
  dbVar: string,
  segments: string[],
  params: string[],
): string {
  const escSeg = (s: string): string =>
    s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

  if (params.length === 0) {
    return `${dbVar}\`${escSeg(segments[0] ?? "")}\``;
  }
  let out = `${dbVar}\`${escSeg(segments[0] ?? "")}`;
  for (let k = 0; k < params.length; k++) {
    out += `\${${params[k]}}${escSeg(segments[k + 1] ?? "")}`;
  }
  out += "`";
  return out;
}

// ---------------------------------------------------------------------------
// rewriteSqlRefs
// ---------------------------------------------------------------------------

/**
 * Rewrite `?{`...`}.method()` and bare `?{`...`}` inline SQL blocks to
 * Bun.SQL tagged-template invocations (SPEC §44).
 *
 * Method mapping (§44.3):
 *   `.all()` (or bare `?{}`) → `await dbVar`...``         (returns Row[])
 *   `.get()` / `.first()`    → `(await dbVar`...`)[0] ?? null`  (Row | null)
 *   `.run()`                 → `await dbVar`...``         (return value unused)
 *   `.prepare()`             → E-SQL-006 compile error    (§44.3)
 *   bare `?{...}` (no chain) → `await dbVar.unsafe(SQL[, params])` (DDL paths)
 *
 * `${expr}` interpolations are preserved as JS template-literal slots
 * (Bun.SQL binds them as positional parameters per §44.5 — never string-
 * interpolated). When this rewrite runs after rewriteReactiveRefs / on
 * the server path, the param expressions may already be `_scrml_body[..]`
 * lookups; the tagged-template form works identically for both.
 *
 * §8.9.5: `.nobatch()` is a compile-time marker with no runtime effect.
 * It is stripped from both call positions before the main rewrite.
 */
export function rewriteSqlRefs(
  expr: string,
  dbVar: string = "_scrml_sql",
  errors?: any[],
): string {
  if (!expr || typeof expr !== "string") return expr;

  // §8.9.5: strip `.nobatch()` from either chain position.
  //   ?{...}.nobatch().get()  →  ?{...}.get()
  //   ?{...}.get().nobatch()  →  ?{...}.get()
  let result = expr.replace(/\.nobatch\(\)/g, "");

  result = result.replace(/\?\{`([^`]*)`\}\.(\w+)\(\)/g, (_, sqlContent: string, method: string) => {
    const { params, segments } = extractSqlParams(sqlContent);

    // §44.3: `.prepare()` is removed from Bun.SQL. Bound-statement caching
    // is handled internally — surface E-SQL-006 at compile time.
    if (method === "prepare") {
      if (errors) {
        errors.push(new CGError(
          "E-SQL-006",
          `E-SQL-006: \`.prepare()\` is removed in Bun.SQL — use bare \`?{...}\` or \`.all()\`/\`.get()\`/\`.run()\` (§44.3). Bun.SQL caches prepared statements internally.`,
          { start: 0, end: 0 },
        ));
      }
      // Emit a compile-error marker so the JS still parses (defense in depth)
      // but any runtime execution surfaces the issue immediately.
      return `(()=>{throw new Error(${JSON.stringify("E-SQL-006: .prepare() is removed in Bun.SQL (§44.3) — use .all()/.get()/.run() or bare ?{}")})})()`;
    }

    const tagged = buildTaggedTemplate(dbVar, segments, params);

    // .get() and .first() — single-row helpers (§44.3 .get() returns Row | not).
    // .first() is preserved as a back-compat alias for code emitted before §44
    // was finalized. Both produce `(await sql`...`)[0] ?? null`.
    if (method === "get" || method === "first") {
      return `(await ${tagged})[0] ?? null`;
    }

    // .all() (Row[]) and .run() (void / mutation) emit the bare await form.
    return `await ${tagged}`;
  });

  // Bare `?{`...`}` form — typically static DDL (`CREATE TABLE ...`) or a
  // dropped-value statement. Routes through `dbVar.unsafe()` so dynamically-
  // built SQL strings are accepted, with params (if any) passed as a bound
  // array (Bun.SQL binds them per §44.5).
  result = result.replace(/\?\{`([^`]*)`\}/g, (_, sqlContent: string) => {
    const { sql, params } = extractSqlParams(sqlContent);
    if (params.length === 0) {
      return `await ${dbVar}.unsafe(${JSON.stringify(sql)})`;
    }
    return `await ${dbVar}.unsafe(${JSON.stringify(sql)}, [${params.join(", ")}])`;
  });

  return result;
}

// ---------------------------------------------------------------------------
// rewriteNavigateCalls
// ---------------------------------------------------------------------------

/**
 * Rewrite `navigate(path)` calls to the runtime navigation function.
 */
export function rewriteNavigateCalls(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  return expr.replace(/\bnavigate\s*\(/g, '_scrml_navigate(');
}

// ---------------------------------------------------------------------------
// rewriteReplayCalls
// ---------------------------------------------------------------------------

/**
 * §51.14 — rewrite `replay(@target, @log)` and `replay(@target, @log, index)`
 * to the runtime primitive `_scrml_replay`. The target @-ref becomes a string
 * (the encoded var name), the log @-ref becomes a `_scrml_reactive_get(...)`
 * call (consistent with how other reactive args are passed through).
 *
 * Shapes emitted:
 *   replay(@order, @log)          → _scrml_replay("order", _scrml_reactive_get("log"))
 *   replay(@order, @log, 3)       → _scrml_replay("order", _scrml_reactive_get("log"), 3)
 *   replay(@order, @log, n * 2)   → _scrml_replay("order", _scrml_reactive_get("log"), n * 2)
 *
 * MUST run BEFORE rewriteReactiveRefs so the first arg (@target) is still a
 * raw @-ref at match time — we want its name, not its runtime value.
 *
 * Third-arg parsing is character-level (not regex) because the index
 * expression may itself contain parens / commas / method calls. We match
 * the `replay(@X, @Y` prefix with a regex, then seek the remainder with a
 * paren-balance scan.
 */
export function rewriteReplayCalls(expr: string): string {
  if (!expr || typeof expr !== "string" || !expr.includes("replay")) return expr;
  // Prefix pattern: `replay(@target, @log` with optional whitespace.
  const prefixRe = /\breplay\s*\(\s*@([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*@([A-Za-z_$][A-Za-z0-9_$]*)\s*/g;
  const out: string[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = prefixRe.exec(expr)) !== null) {
    const matchStart = m.index;
    const matchEnd = prefixRe.lastIndex;
    const targetName = m[1];
    const logName = m[2];
    // At matchEnd we expect either `)` (two-arg form) or `,` followed by an
    // index expression, then `)`. Do a paren-balance scan to find the
    // closing `)` of the replay call.
    let i = matchEnd;
    if (i >= expr.length) break;
    let replayBody = "";
    if (expr[i] === ")") {
      // Two-arg form: replay(@X, @Y)
      replayBody = `_scrml_replay("${targetName}", _scrml_reactive_get("${logName}"))`;
      i++;
    } else if (expr[i] === ",") {
      // Three-arg form: skip the comma, find the matching `)`.
      i++;
      const exprStart = i;
      let depth = 1;  // we're inside the replay( call, one level deep
      let found = -1;
      while (i < expr.length) {
        const ch = expr[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) { found = i; break; }
        }
        i++;
      }
      if (found < 0) {
        // Unbalanced parens — leave the match alone. Downstream compile will
        // surface a parse error with source context.
        out.push(expr.slice(lastIdx, matchEnd));
        lastIdx = matchEnd;
        continue;
      }
      const indexExpr = expr.slice(exprStart, found).trim();
      replayBody = `_scrml_replay("${targetName}", _scrml_reactive_get("${logName}"), ${indexExpr})`;
      i = found + 1;
    } else {
      // Unrecognized character after `replay(@X, @Y` — not a replay call we
      // can rewrite. Skip this match and let the rest of the pipeline handle
      // whatever it is.
      out.push(expr.slice(lastIdx, matchEnd));
      lastIdx = matchEnd;
      continue;
    }
    out.push(expr.slice(lastIdx, matchStart));
    out.push(replayBody);
    lastIdx = i;
    prefixRe.lastIndex = i;
  }
  out.push(expr.slice(lastIdx));
  return out.join("");
}

// ---------------------------------------------------------------------------
// rewriteWorkerRefs
// ---------------------------------------------------------------------------

/**
 * §4.12.4: Rewrite `<#name>.send(expr)` worker references to runtime worker calls.
 * Must run BEFORE rewriteInputStateRefs which would consume the `<#name>` pattern.
 */
export function rewriteWorkerRefs(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  // <#name>.send(expr) → _scrml_worker_name.send(expr)
  // Handle both compact form (<#name>) and tokenizer-spaced form (< # name >)
  if (expr.includes("<#")) {
    expr = expr.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>\s*\.\s*send\s*\(/g, '_scrml_worker_$1.send(');
  }
  if (expr.includes("< #")) {
    expr = expr.replace(/<\s*#\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*>\s*\.\s*send\s*\(/g, '_scrml_worker_$1.send(');
  }
  return expr;
}

// ---------------------------------------------------------------------------
// rewriteRequestRefs
// ---------------------------------------------------------------------------

/**
 * Rewrite `<#identifier>.loading|data|error|stale|refetch` request state references (§6.7.7).
 * Must run BEFORE rewriteInputStateRefs which would consume the `<#name>` pattern.
 */
export function rewriteRequestRefs(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  if (!expr.includes("<#")) return expr;
  return expr.replace(
    /<#([A-Za-z_$][A-Za-z0-9_$]*)>\s*\.\s*(loading|data|error|stale|refetch)/g,
    "_scrml_request_$1.$2"
  );
}

// ---------------------------------------------------------------------------
// rewriteInputStateRefs
// ---------------------------------------------------------------------------

/**
 * Rewrite `<#identifier>` input state references to runtime registry lookups (§35).
 */
export function rewriteInputStateRefs(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  return expr.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>/g, '_scrml_input_state_registry.get("$1")');
}

// ---------------------------------------------------------------------------
// rewriteBunEval
// ---------------------------------------------------------------------------

/**
 * Evaluate `bun.eval("...")` calls at compile time and replace with literal results.
 */
export function rewriteBunEval(expr: string, errors?: any[]): string {
  if (!expr || typeof expr !== "string") return expr;
  if (!expr.includes("bun") || !/\bbun\s*\.\s*eval\b/.test(expr)) return expr;

  return expr.replace(/\bbun\s*\.\s*eval\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*\)/g, (match: string, strArg: string) => {
    const code = strArg.slice(1, -1);
    try {
      const trimmedCode = code.trim();
      const fn = (trimmedCode.startsWith("return ") || trimmedCode.startsWith("return\n") || trimmedCode.startsWith("return\t"))
        ? new Function(code)
        : new Function(`return (${code})`);
      const result = fn();
      if (result === undefined) return "undefined";
      if (result === null) return "null";
      if (typeof result === "string") return JSON.stringify(result);
      if (typeof result === "number" || typeof result === "boolean") return String(result);
      return JSON.stringify(result);
    } catch (err: any) {
      if (errors) {
        errors.push({
          code: "E-EVAL-001",
          message: `E-EVAL-001: bun.eval() failed at compile time: ${err.message}. Expression: ${code}. ` +
          `Check the expression for syntax errors. bun.eval() runs during compilation, so runtime APIs are not available.`,
          severity: "error",
        });
      }
      return match;
    }
  });
}

// ---------------------------------------------------------------------------
// rewriteIsOperator
// ---------------------------------------------------------------------------

/**
 * Rewrite the scrml `is` operator for single-variant enum checks.
 */
export function rewriteIsOperator(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  // `is null` / `is undefined` — after rewriteNotKeyword converts `not` → `null`,
  // `x is not` becomes `x is null`. Rewrite to strict equality check.
  expr = expr.replace(/\bis\s+null\b/g, '=== null');
  expr = expr.replace(/\bis\s+undefined\b/g, '=== undefined');
  // Allow optional whitespace between '.' and variant name: block-splitter may emit
  // "is . Small" (space after dot). The \s* handles both "is .Small" and "is . Small".
  expr = expr.replace(/\bis\s+[A-Z][A-Za-z0-9_]*\.\s*([A-Z][A-Za-z0-9_]*)\b/g, '=== "$1"');
  expr = expr.replace(/\bis\s+\.\s*([A-Z][A-Za-z0-9_]*)\b/g, '=== "$1"');
  return expr;
}

// ---------------------------------------------------------------------------
// rewritePresenceGuard
// ---------------------------------------------------------------------------

/**
 * Rewrite `(x) => { body }` presence guard to `if (x !== null && x !== undefined) { body }` (§42).
 *
 * Only rewrites when the ENTIRE expression is a single-identifier presence guard:
 *   ( identifier ) => { ... }
 *
 * This does NOT rewrite multi-param arrows `(x, y) => ...` or expression-body
 * arrows `x => x + 1` or inline callbacks like `.map((x) => x.value)`.
 *
 * Safe because this runs on the bare-expr string — a standalone `(x) => { body }`
 * at statement level is unambiguously a presence guard, not a value-producing arrow.
 */
export function rewritePresenceGuard(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  // Quick exit: must contain "=>" and "{"
  if (!expr.includes("=>") || !expr.includes("{")) return expr;

  const trimmed = expr.trim();
  // Match: ( identifier ) => { body }
  // The body may span multiple lines/tokens — use a brace-counting approach.
  const presenceRe = /^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>\s*\{([\s\S]*)\}\s*$/;

  const m = trimmed.match(presenceRe);
  if (!m) return expr;

  const varName = m[1];
  const body = m[2]; // raw body content (already has spaces from tokenizer)

  return `if (${varName} !== null && ${varName} !== undefined) {${body}}`;
}

// rewriteNotKeyword
// ---------------------------------------------------------------------------

/**
 * Rewrite `not` keyword and `is not` operator to JavaScript equivalents (§42).
 * Also detects E-SYNTAX-010 (`null`/`undefined` in value position) and
 * E-TYPE-042 (`== not`/`!= not`) when an errors array is provided.
 */
export function rewriteNotKeyword(expr: string, errors?: any[]): string {
  if (!expr || typeof expr !== "string") return expr;

  const hasNot = expr.includes("not");
  const hasSome = expr.includes("some");
  const hasNull = expr.includes("null");
  const hasUndefined = expr.includes("undefined");

  if (!hasNot && !hasSome && !hasNull && !hasUndefined) return expr;

  // Split on string literals to avoid rewriting inside quoted content.
  const result: string[] = [];
  let inString: string | null = null;
  let i = 0;
  let segStart = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === '`') {
        result.push(_rewriteNotSegment(expr.slice(segStart, i), errors));
        inString = ch;
        segStart = i;
      }
    } else {
      if (ch === '\\') {
        i++; // skip escaped character
      } else if (ch === inString) {
        inString = null;
        i++;
        result.push(expr.slice(segStart, i)); // preserve string literal as-is
        segStart = i;
        continue;
      }
    }
    i++;
  }
  result.push(_rewriteNotSegment(expr.slice(segStart), errors));
  return result.join("");
}

// ---------------------------------------------------------------------------
// _rewriteParenthesizedIsOp — Phase A: (expr) is not / is some / is not not
// ---------------------------------------------------------------------------
// Scans `segment` for patterns: `) is not not`, `) is some`, `) is not`
// (in that priority order). For each match, walks backwards from the `)` to
// find the matching `(` (handling nested parens). Replaces the entire
// `(expr) is X` with a temp-var form that evaluates `expr` exactly once.
//
//   (expr) is not not  →  ((__scrml_tmp_N = (expr)) != null)   [presence]
//   (expr) is some     →  ((__scrml_tmp_N = (expr)) != null)   [presence]
//   (expr) is not      →  ((__scrml_tmp_N = (expr)) == null)   [absence]
//
// Uses double-equals (== / !=) to match both null and undefined in one check.
// Only the parenthesized form is handled here. Identifier/dotted paths are
// handled by the existing regex patterns below (unchanged). §42.2.4 Phase A.
function _rewriteParenthesizedIsOp(segment: string): string {
  // Each entry: the operator suffix to search for after `)` and the op kind.
  // Order matters: check `is not not` before `is not` to avoid partial match.
  type OpDef = { suffix: string; op: "presence" | "absence" };
  const ops: OpDef[] = [
    { suffix: " is not not", op: "presence" },
    { suffix: " is some",    op: "presence" },
    { suffix: " is not",     op: "absence"  },
  ];

  for (const { suffix, op } of ops) {
    let searchFrom = 0;
    while (true) {
      // Find next occurrence of `) is X` — the closing paren of the compound
      // expression immediately before the operator keyword.
      const opIdx = segment.indexOf(')' + suffix, searchFrom);
      if (opIdx === -1) break;

      // Walk backwards from opIdx to find the matching opening paren.
      let depth = 0;
      let parenStart = -1;
      for (let k = opIdx; k >= 0; k--) {
        if (segment[k] === ')') depth++;
        else if (segment[k] === '(') {
          depth--;
          if (depth === 0) { parenStart = k; break; }
        }
      }

      if (parenStart === -1) {
        // No matching open paren found (malformed input). Skip past this match.
        searchFrom = opIdx + 1;
        continue;
      }

      // Extract the full parenthesized expression (including the outer parens).
      const parenExpr = segment.slice(parenStart, opIdx + 1); // e.g. "(regex.exec(str))"

      // Generate a unique temp var for single-evaluation guarantee (§42.2.4).
      const tmp = genVar("tmp");

      // Build the replacement: assign expr to tmp, then check tmp once.
      const cmp = op === "absence" ? "==" : "!=";
      const replacement = `((${tmp} = ${parenExpr}) ${cmp} null)`;

      // Splice the replacement into the segment.
      const fullMatch = parenExpr + suffix;
      const before = segment.slice(0, parenStart);
      const after  = segment.slice(parenStart + fullMatch.length);
      segment = before + replacement + after;

      // Advance past the replacement to avoid re-processing it.
      searchFrom = parenStart + replacement.length;
    }
  }

  return segment;
}

function _rewriteNotSegment(segment: string, errors?: any[]): string {
  // E-TYPE-042: detect `== not` / `!= not` / `=== not` / `!== not` patterns (§42)
  if (errors) {
    const eqNotRe = /(?:===?|!==?)\s*not(?![A-Za-z0-9_$])/g;
    let eqNotMatch;
    while ((eqNotMatch = eqNotRe.exec(segment)) !== null) {
      const op = eqNotMatch[0].trim().replace(/\s*not$/, "");
      const hint = op.startsWith("!") ? "!(x is not)" : "x is not";
      errors.push({
        code: "E-TYPE-042",
        message: `E-TYPE-042: \`${op} not\` is not a valid absence check. Use \`${hint}\` instead — scrml uses \`is not\` for absence checks (§42).`,
      });
    }
  }
  // E-SYNTAX-010: detect `null` or `undefined` as standalone identifiers (§42)
  if (errors) {
    const nullRe = /(?<![A-Za-z0-9_$.])(null|undefined)(?![A-Za-z0-9_$])/g;
    let nullMatch;
    while ((nullMatch = nullRe.exec(segment)) !== null) {
      errors.push({
        code: "E-SYNTAX-010",
        message: `E-SYNTAX-010: \`${nullMatch[1]}\` is not a valid scrml value. Use \`not\` instead — scrml uses \`not\` as the unified absence value (§42).`,
      });
    }
  }
  // §42.2.4 Phase A — parenthesized-form: (expr) is not / is some / is not not.
  // Must run BEFORE identifier-only patterns — those patterns start with an
  // identifier character class and will never match a leading `)`.
  segment = _rewriteParenthesizedIsOp(segment);
  // Match `@varName is not not` or `identifier is not not` (presence check, §42).
  // MUST run before the `is not` replacement — otherwise the first `is not` consumes
  // the token and the trailing `not` becomes a stray `null`.
  segment = segment.replace(/(@?[A-Za-z_$][A-Za-z0-9_$.]*) is not not(?![A-Za-z0-9_$])/g,
    '($1 !== null && $1 !== undefined)');
  // Match `x is some` — positive presence check (§42.2.2a).
  segment = segment.replace(/(@?[A-Za-z_$][A-Za-z0-9_$.]*) is some(?![A-Za-z0-9_$])/g,
    '($1 !== null && $1 !== undefined)');
  // Match `@varName is not` or `identifier is not` or `dotted.path is not` (absence check).
  // The @-prefix is included in the capture so it is preserved in the output
  // (the @-to-reactive_get() rewrite runs after this pass).
  segment = segment.replace(/(@?[A-Za-z_$][A-Za-z0-9_$.]*) is not(?![A-Za-z0-9_$])/g,
    '($1 === null || $1 === undefined)');
  // `not (expr)` — logical negation before a parenthesized expression → `!(expr)`
  segment = segment.replace(/(?<![A-Za-z0-9_$@])not\s*\(/g, '!(');
  // §45.7 operator-form: `not <operand>` — unary boolean negation → `!<operand>`.
  // Must run BEFORE the bare-`not`-to-`null` rule below so the operator-form is
  // consumed first; otherwise the operand would be left dangling next to a
  // literal `null`, producing `null <operand>` adjacency (invalid JS).
  //
  // The operand is matched conservatively: an optional `@` sigil, identifier
  // chain (with dotted member access), AND optional bracket-indexing tail
  // (`[...]`). Function-call parentheses are NOT consumed — JS unary `!` has
  // lower precedence than function-call, so `!f(x)` parses as `!(f(x))`, which
  // is the desired semantics.
  //
  // Lookbehind `(?<![A-Za-z0-9_$@.])` ensures we don't match `not` when it is
  // a member name (`obj.not foo` would have `.` before — excluded). The `.` in
  // the lookbehind class additionally guards against matching `.not` chains.
  //
  // The standalone-value form (`@x = not`, `return not`, `f(not)`, `[a, not, b]`)
  // is NOT matched here because there is no operand-ident following `not`. It
  // falls through to the bare-`not`-to-`null` rule on the next line.
  segment = segment.replace(
    /(?<![A-Za-z0-9_$@.])not\s+(@?[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*(?:\[[^\]]*\])*)/g,
    '!$1'
  );
  // Bare `not` as a value → `null`
  segment = segment.replace(/(?<![A-Za-z0-9_$@])not(?![A-Za-z0-9_$])/g, 'null');
  return segment;
}

// ---------------------------------------------------------------------------
// parseInlineMatchArm / splitInlineArms / rewriteMatchExpr
// ---------------------------------------------------------------------------

/** Strip trailing comma from arm result (BUG: arm splitter includes separator). */
function stripTrailingComma(s: string): string {
  const t = s.trim();
  return t.endsWith(",") ? t.slice(0, -1).trim() : t;
}

function parseInlineMatchArm(text: string): InlineMatchArm | null {
  // §18 pipe-alternation arm: `.A | .B | .C => result` (or `:>`).
  // Tried BEFORE the single-variant regex so the alternation chain wins.
  // We do NOT support payload bindings on alternation arms (per §51.3.2
  // same-binding-shape rule; a binding present on any alternate falls through
  // to the single-variant regex below, which will fail to match alternation
  // and the arm is dropped — emitter handles the dropped-arm comment).
  const altMatch = text.match(
    /^\.\s*([A-Z][A-Za-z0-9_]*)((?:\s*\|\s*\.\s*[A-Z][A-Za-z0-9_]*)+)\s*(?:=>|:>)\s*([\s\S]+)$/,
  );
  if (altMatch) {
    const first = altMatch[1];
    const rest = altMatch[2]
      .split("|")
      .map(s => s.trim().replace(/^\./, "").trim())
      .filter(s => s.length > 0);
    const tests = [first, ...rest];
    return {
      kind: "variant",
      test: first,
      tests,
      result: stripTrailingComma(altMatch[3]),
    };
  }

  const newVariantMatch = text.match(/^\.\s*([A-Z][A-Za-z0-9_]*)(?:\s*\(\s*(\w+)\s*\))?\s*(?:=>|:>)\s*([\s\S]+)$/);
  if (newVariantMatch) {
    return { kind: "variant", test: newVariantMatch[1], result: stripTrailingComma(newVariantMatch[3]) };
  }

  const newDqMatch = text.match(/^"((?:[^"\\]|\\.)*)"\s*(?:=>|:>)\s*([\s\S]+)$/);
  if (newDqMatch) {
    return { kind: "string", test: `"${newDqMatch[1]}"`, result: stripTrailingComma(newDqMatch[2]) };
  }

  const newSqMatch = text.match(/^'((?:[^'\\]|\\.)*)'\s*(?:=>|:>)\s*([\s\S]+)$/);
  if (newSqMatch) {
    return { kind: "string", test: `'${newSqMatch[1]}'`, result: stripTrailingComma(newSqMatch[2]) };
  }

  // §42: `not => expr` — absence arm in inline match
  const notArmMatch = text.match(/^not\s*(?:=>|:>)\s*([\s\S]+)$/);
  if (notArmMatch) {
    return { kind: "not", test: null, result: stripTrailingComma(notArmMatch[1]) };
  }

  const newWildcardMatch = text.match(/^else\s*(?:(?:=>|:>)\s*)?([\s\S]+)$/);
  if (newWildcardMatch) {
    return { kind: "wildcard", test: null, result: stripTrailingComma(newWildcardMatch[1]) };
  }

  const legacyVariantMatch = text.match(/^::\s*(\w+)(?:\s*\(\s*(\w+)\s*\))?\s*->\s*([\s\S]+)$/);
  if (legacyVariantMatch) {
    return { kind: "variant", test: legacyVariantMatch[1], result: stripTrailingComma(legacyVariantMatch[3]) };
  }

  const legacyDqMatch = text.match(/^"((?:[^"\\]|\\.)*)"\s*->\s*([\s\S]+)$/);
  if (legacyDqMatch) {
    return { kind: "string", test: `"${legacyDqMatch[1]}"`, result: stripTrailingComma(legacyDqMatch[2]) };
  }

  const legacySqMatch = text.match(/^'((?:[^'\\]|\\.)*)'\s*->\s*([\s\S]+)$/);
  if (legacySqMatch) {
    return { kind: "string", test: `'${legacySqMatch[1]}'`, result: stripTrailingComma(legacySqMatch[2]) };
  }

  const legacyWildcardMatch = text.match(/^_\s*->\s*([\s\S]+)$/);
  if (legacyWildcardMatch) {
    return { kind: "wildcard", test: null, result: stripTrailingComma(legacyWildcardMatch[1]) };
  }

  // Bug 1 (S95) — NEW Form: `_ => expr` / `_ :> expr` — JS-style wildcard
  // alias for `else`. Mirrors parseMatchArm in emit-control-flow.ts. Keeps
  // the string-pipeline rewriteMatchExpr (used by the server-mode shim in
  // emit-expr.ts and by Pass 13 of the legacy rewrite pipeline) in parity
  // with the structured emitter.
  const newUnderscoreWildcardMatch = text.match(/^_\s*(?:=>|:>)\s*([\s\S]+)$/);
  if (newUnderscoreWildcardMatch) {
    return { kind: "wildcard", test: null, result: stripTrailingComma(newUnderscoreWildcardMatch[1]) };
  }

  // §42 presence arm: (identifier) => expr — counterpart to `not => expr`
  const presenceArmMatch = text.match(/^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*(?:=>|:>)\s*([\s\S]+)$/);
  if (presenceArmMatch) {
    return { kind: "wildcard", test: null, result: stripTrailingComma(presenceArmMatch[2]) };
  }

  return null;
}

/**
 * Split a multi-arm string on arm boundaries.
 *
 * Private version for use in splitInlineArms when inline match arms are on one
 * line without newline separators (BUG-R13-001). Same logic as splitMultiArmString
 * in emit-control-flow.ts — duplicated here to avoid cross-module coupling.
 *
 * An arm boundary is detected when we find an arm-start token at a non-string
 * position that is not a property access:
 *   - .UpperCase  (new variant arm — only when NOT preceded by identifier char)
 *   - "..." =>    (string literal arm, followed by => or ->)
 *   - '...' =>    (string literal arm, followed by => or ->)
 *   - else        (wildcard arm — when preceded by whitespace or start)
 *   - ::letter    (legacy variant arm)
 *   - _ ->        (legacy wildcard arm)
 *
 * Returns [s] when only zero or one arm boundary is found.
 */
function _splitMultiArmString(s: string): string[] {
  const armStartPositions: number[] = [];
  let inString: string | null = null;
  let braceDepth = 0; // skip arm detection inside nested { } blocks
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (inString !== null) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inString) { inString = null; }
      i++;
      continue;
    }

    // Track brace depth — skip arm detection inside nested { } blocks
    if (ch === "{") { braceDepth++; i++; continue; }
    if (ch === "}") { if (braceDepth > 0) braceDepth--; i++; continue; }
    if (braceDepth > 0) { i++; continue; }

    if (/\s/.test(ch)) { i++; continue; }

    // New variant arm: .UpperCase or . UpperCase (BS adds spaces around .)
    // Only when NOT preceded by an identifier char.
    // IMPORTANT: skip whitespace before the dot. The block-splitter emits
    // "MarioState . Big" with spaces around '.'. Without skipping whitespace,
    // s[i-1] is ' ' (space), which passes !/[A-Za-z0-9_$]/.test() — incorrectly
    // treating .Big as a new arm start instead of a property access.
    if (ch === "." && i + 1 < s.length) {
      let nextNonSpace = i + 1;
      while (nextNonSpace < s.length && s[nextNonSpace] === " ") nextNonSpace++;
      if (nextNonSpace < s.length && /[A-Z]/.test(s[nextNonSpace])) {
                // An arm boundary is a .UpperCase token followed by => (or ->) at the same depth.
        // This is the only reliable signal that distinguishes arm starts from property accesses
        // in the single-line token-joined format that collectExpr produces (e.g.,
        // "MarioState . Fire . Feather => ..." — .Fire has no arrow, .Feather does).
        //
        // Strategy: look AHEAD past the variant name (and optional payload binding) to check
        // for =>. If present, it's an arm boundary. Otherwise, it's a property access result.
        // Apply the original prevCh rule ONLY when => is NOT found (property access cases like
        // "Status.InProgress .Done => ..." still need splitting at .Done).
        let nameEnd = nextNonSpace;
        while (nameEnd < s.length && /[A-Za-z0-9_]/.test(s[nameEnd])) nameEnd++;
        let afterName = nameEnd;
        while (afterName < s.length && s[afterName] === " ") afterName++;
        // Skip optional payload binding: (binding)
        if (afterName < s.length && s[afterName] === "(") {
          let pd = 1; afterName++;
          while (afterName < s.length && pd > 0) {
            if (s[afterName] === "(") pd++;
            else if (s[afterName] === ")") pd--;
            afterName++;
          }
          while (afterName < s.length && s[afterName] === " ") afterName++;
        }
        // §18 pipe-alternation lookahead: consume `\s*|\s*\.\s*UpperIdent` repetitions.
        // This lets `.A | .B | .C => result` register `.A` as the arm start.
        while (afterName < s.length && s[afterName] === "|") {
          let p = afterName + 1;
          while (p < s.length && /\s/.test(s[p])) p++;
          if (p >= s.length || s[p] !== ".") break;
          p++;
          while (p < s.length && /\s/.test(s[p])) p++;
          if (p >= s.length || !/[A-Z]/.test(s[p])) break;
          while (p < s.length && /[A-Za-z0-9_]/.test(s[p])) p++;
          while (p < s.length && /\s/.test(s[p])) p++;
          afterName = p;
        }
        const arrow2 = s.slice(afterName, afterName + 2);
        const isFollowedByArrow = arrow2 === "=>" || arrow2 === ":>" || arrow2 === "->";
        if (isFollowedByArrow) {
          // §18 pipe-alternation: when we ARE an alternate (preceding non-space
          // is `|`), do NOT register this `.` as a new arm start — the leading
          // `.A` of the chain already claimed it.
          let back = i - 1;
          while (back >= 0 && /\s/.test(s[back])) back--;
          const isAlternate = back >= 0 && s[back] === "|";
          // Definitive arm start — check original prevCh rule to avoid mid-result property accesses
          const prevCh = i > 0 ? s[i - 1] : null;
          if (!isAlternate && (prevCh === null || !/[A-Za-z0-9_$]/.test(prevCh))) {
            armStartPositions.push(i);
          }
        }
      }
      i++;
      continue;
    }

    // String literal arm: "..." => / '...' => or -> only (not bare strings in results)
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < s.length && s[j] !== q) {
        if (s[j] === "\\") j++;
        j++;
      }
      if (j < s.length) {
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k])) k++;
        const strArrow2 = s.slice(k, k + 2);
        if (strArrow2 === "=>" || strArrow2 === ":>" || strArrow2 === "->") {
          armStartPositions.push(i);
          inString = q;
          i++;
          continue;
        }
      }
      inString = q;
      i++;
      continue;
    }

    // §42 absence arm: not => (or :> or ->) — only when preceded by whitespace or start
    if (s.slice(i, i + 3) === "not" && (i + 3 >= s.length || /[\s=:\->]/.test(s[i + 3]))) {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        let k = i + 3;
        while (k < s.length && /\s/.test(s[k])) k++;
        const notArrow2 = s.slice(k, k + 2);
        if (notArrow2 === "=>" || notArrow2 === ":>" || notArrow2 === "->") {
          armStartPositions.push(i);
          i += 3;
          continue;
        }
      }
    }

    // Wildcard arm: else — only when preceded by whitespace or start-of-string
    if (s.slice(i, i + 4) === "else" && (i + 4 >= s.length || /[\s=:\->(]/.test(s[i + 4]))) {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        armStartPositions.push(i);
        i += 4;
        continue;
      }
    }

    // Legacy variant arm: ::Letter
    if (ch === ":" && i + 1 < s.length && s[i + 1] === ":" && i + 2 < s.length && /[A-Za-z_]/.test(s[i + 2])) {
      armStartPositions.push(i);
      i += 2;
      continue;
    }

    // Legacy wildcard `_ ->` AND JS-style wildcard alias `_ =>` / `_ :>`
    // (Bug 1 S95 — parity with emit-control-flow.ts:splitMultiArmString).
    // Requires the `_` to be a standalone token (preceded by start-of-string
    // or whitespace) to avoid false positives on identifier-suffix `_`.
    if (ch === "_") {
      const prevCh = i > 0 ? s[i - 1] : null;
      const isStandalone = prevCh === null || /\s/.test(prevCh);
      let k = i + 1;
      while (k < s.length && /\s/.test(s[k])) k++;
      const arrow2 = s.slice(k, k + 2);
      const isArrow = arrow2 === "->" || arrow2 === "=>" || arrow2 === ":>";
      if (isStandalone && isArrow) {
        armStartPositions.push(i);
      }
    }

    // §42 presence arm: (identifier) => — only when preceded by whitespace or start
    if (ch === "(") {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        const presenceRe = /^\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)\s*=>/;
        if (presenceRe.test(s.slice(i))) {
          armStartPositions.push(i);
        }
      }
    }

    i++;
  }

  if (armStartPositions.length <= 1) return [s];

  const result: string[] = [];
  for (let idx = 0; idx < armStartPositions.length; idx++) {
    const start = armStartPositions[idx];
    const end = idx + 1 < armStartPositions.length ? armStartPositions[idx + 1] : s.length;
    const arm = s.slice(start, end).trim();
    if (arm) result.push(arm);
  }
  return result.length > 0 ? result : [s];
}

function splitInlineArms(armsStr: string): string[] {
  // Count net brace depth change in a line, ignoring string literals.
  // Used to group continuation lines from nested match expressions.
  function braceChange(line: string): number {
    let depth = 0;
    let inStr: string | null = null;
    for (let ci = 0; ci < line.length; ci++) {
      const c = line[ci];
      if (inStr !== null) {
        if (c === '\\') { ci++; continue; }
        if (c === inStr) inStr = null;
      } else {
        if (c === '"' || c === "'" || c === '`') inStr = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
    }
    return depth;
  }

  const lines = armsStr
    .split(/\n/)
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);

  if (lines.length <= 1) {
    // Single line: try arm-boundary splitting (BUG-R13-001).
    const src = lines.length === 1 ? lines[0] : armsStr.trim();
    const byBoundary = _splitMultiArmString(src);
    return byBoundary.length > 1 ? byBoundary : lines;
  }

  // Multi-line: group continuation lines when brace depth > 0 (nested { } blocks).
  // This handles nested match expressions inside arm results.
  const groups: string[] = [];
  let current: string | null = null;
  let depth = 0;

  for (const line of lines) {
    const delta = braceChange(line);
    if (current === null) {
      current = line;
      depth = delta;
    } else if (depth > 0) {
      // Still inside nested braces — this line belongs to the current arm.
      current += '\n' + line;
      depth += delta;
    } else {
      // depth was 0 before this line: new arm starts here.
      groups.push(current);
      current = line;
      depth = delta;
    }
  }
  if (current !== null) groups.push(current);

  return groups.length > 1 ? groups : lines;
}

/**
 * Rewrite inline `match expr { ... }` expressions to a JS IIFE.
 */
export function rewriteMatchExpr(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  const matchIdx = expr.indexOf("match ");
  if (matchIdx === -1) return expr;

  const matchRegex = /\bmatch\s+([\s\S]*?)\s*\{([\s\S]*)\}\s*$/;
  const m = expr.match(matchRegex);
  if (!m) return expr;

  // Strip leading "partial " keyword from prefix (§18.18 partial match)
  const prefix = expr.slice(0, matchIdx).replace(/\bpartial\s+$/, "");
  const matchTarget = m[1].trim();
  const armsStr = m[2].trim();

  const armLines = splitInlineArms(armsStr);
  const arms: InlineMatchArm[] = [];

  for (const line of armLines) {
    const arm = parseInlineMatchArm(line);
    if (arm) arms.push(arm);
  }

  if (arms.length === 0) {
    const newCompactRegex = /\.\s*([A-Z][A-Za-z0-9_]*)\s*(?:\(\s*\w+\s*\))?\s*=>\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^.]+?)(?=\s*\.\s*[A-Z]|\s*$)/g;
    let compactMatch: RegExpExecArray | null;
    while ((compactMatch = newCompactRegex.exec(armsStr)) !== null) {
      arms.push({ kind: "variant", test: compactMatch[1], result: compactMatch[2].trim() });
    }
  }

  if (arms.length === 0) {
    const legacyRegex = /::\s*(\w+)\s*(?:\(\s*(\w+)\s*\))?\s*-\s*>\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^:]+?)(?=\s*::\s*\w|\s*$)/g;
    let legacyMatch: RegExpExecArray | null;
    while ((legacyMatch = legacyRegex.exec(armsStr)) !== null) {
      arms.push({ kind: "variant", test: legacyMatch[1], result: legacyMatch[3].trim() });
    }
  }

  if (arms.length === 0) return expr;

  const tmpVar = genVar("match");
  const lines: string[] = [];
  lines.push(`(function() {`);
  lines.push(`  const ${tmpVar} = ${matchTarget};`);

  let conditionIndex = 0;
  for (const arm of arms) {
    // Recursively rewrite nested match expressions in arm results
    const result = arm.result.includes("match ") ? rewriteMatchExpr(arm.result) : arm.result;
    if (arm.kind === "wildcard") {
      lines.push(`  else return ${result};`);
    } else {
      const kw = conditionIndex === 0 ? "if" : "else if";
      let condition: string;
      if (arm.kind === "not") {
        // §42: `not` match arm checks for absence (null or undefined)
        condition = `${tmpVar} === null || ${tmpVar} === undefined`;
      } else if (arm.kind === "variant") {
        // §18 pipe-alternation: `.A | .B | .C => result` emits OR-chain.
        // Singleton variant arms use a single equality check (unchanged path).
        if (arm.tests && arm.tests.length > 1) {
          condition = arm.tests.map(t => `${tmpVar} === "${t}"`).join(" || ");
        } else {
          condition = `${tmpVar} === "${arm.test}"`;
        }
      } else {
        condition = `${tmpVar} === ${arm.test}`;
      }
      lines.push(`  ${kw} (${condition}) return ${result};`);
      conditionIndex++;
    }
  }

  lines.push(`})()`);

  return prefix + lines.join("\n");
}

// ---------------------------------------------------------------------------
// rewriteFnKeyword
// ---------------------------------------------------------------------------

/**
 * Rewrite scrml `fn` shorthand to `function` keyword.
 */
export function rewriteFnKeyword(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  return expr.replace(/\bfn\b/g, "function");
}

// ---------------------------------------------------------------------------
// findMatchingBrace / fixBlockBody / rewriteInlineFunctionBodies
// ---------------------------------------------------------------------------

function findMatchingBrace(str: string, openPos: number): number {
  let depth = 1;
  let j = openPos + 1;
  let inStr: string | null = null;
  while (j < str.length && depth > 0) {
    const ch = str[j];
    if (inStr === null) {
      if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    } else {
      if (ch === '\\') { j++; }
      else if (ch === inStr) inStr = null;
    }
    if (depth > 0) j++;
  }
  return depth === 0 ? j : -1;
}

function fixBlockBody(body: string): string {
  if (!body) return body;

  const hasSemicolons = /;/.test(body);
  const hasNewlines = /\n/.test(body);

  let processed = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < body.length) {
        if (body[j] === '\\') { j += 2; continue; }
        if (body[j] === ch) { j++; break; }
        j++;
      }
      processed += body.slice(i, j);
      i = j;
      continue;
    }
    if (ch === '{') {
      const closeIdx = findMatchingBrace(body, i);
      if (closeIdx > i) {
        const innerBody = body.slice(i + 1, closeIdx).trim();
        const fixedInner = fixBlockBody(innerBody);
        processed += "{ " + fixedInner + " }";
        i = closeIdx + 1;
        continue;
      }
    }
    processed += ch;
    i++;
  }

  if (!hasSemicolons && !hasNewlines) {
    const stmts = splitBareExprStatements(processed);
    if (stmts.length > 1) {
      return stmts.map((s: string) => s.trim()).filter(Boolean).join("; ");
    }
  }

  return processed;
}

/**
 * Rewrite inline function bodies to insert semicolons between merged statements.
 */
export function rewriteInlineFunctionBodies(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  const result: string[] = [];
  let i = 0;

  while (i < expr.length) {
    const funcMatch = expr.slice(i).match(/^(function\s*\([^)]*\)\s*)\{/);
    if (funcMatch) {
      result.push(expr.slice(i, i + funcMatch[1].length));
      i += funcMatch[1].length;
      if (expr[i] === '{') {
        const closeIdx = findMatchingBrace(expr, i);
        if (closeIdx > i) {
          const body = expr.slice(i + 1, closeIdx).trim();
          const fixedBody = fixBlockBody(body);
          result.push("{ ");
          result.push(fixedBody);
          result.push(" }");
          i = closeIdx + 1;
          continue;
        }
      }
    }
    result.push(expr[i]);
    i++;
  }

  return result.join("");
}

// ---------------------------------------------------------------------------
// rewriteEnumToEnum
// ---------------------------------------------------------------------------

/**
 * Rewrite `EnumType.toEnum(expr)` and `toEnum(EnumType, expr)` to runtime lookup table calls.
 *
 * §14.4.1 — Method form:   `Status.toEnum(raw)` → `(Status_toEnum[raw] ?? null)`
 * §14.4.1 — Function form: `toEnum(Status, raw)` → `(Status_toEnum[raw] ?? null)`
 *
 * Returns null (JS) on no match. In scrml source, `not` is the absence value (§42);
 * `not` compiles to null/undefined in JS. The `?? null` fallback here is correct.
 *
 * DB workflow idiom (§14.4.3): use toEnum() inside .map() on query results:
 *   @tasks = ?{`SELECT * FROM tasks`}.all().map(row => ({
 *     ...row,
 *     status: TaskStatus.toEnum(row.status) ?? row.status
 *   }))
 */
export function rewriteEnumToEnum(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  // Method form: Status.toEnum(rawValue)
  expr = expr.replace(
    /\b([A-Z][A-Za-z0-9_]*)\s*\.\s*toEnum\s*\(\s*([^)]+)\s*\)/g,
    (_, typeName: string, arg: string) => `(${typeName}_toEnum[${arg.trim()}] ?? null)`,
  );
  // Function form: toEnum(Status, rawValue)
  expr = expr.replace(
    /\btoEnum\s*\(\s*([A-Z][A-Za-z0-9_]*)\s*,\s*([^)]+)\s*\)/g,
    (_, typeName: string, arg: string) => `(${typeName}_toEnum[${arg.trim()}] ?? null)`,
  );
  return expr;
}

// ---------------------------------------------------------------------------
// rewriteEnumVariantAccess
// ---------------------------------------------------------------------------

/**
 * Rewrite value-position enum variant references to string literals.
 */
// ---------------------------------------------------------------------------
// stripTransitionsBlock
// ---------------------------------------------------------------------------

/**
 * §51.2: Strip `transitions { ... }` blocks from enum body text.
 * These are parsed by the type system but must not appear in JS output.
 */
function stripTransitionsBlock(expr: string): string {
  const idx = expr.indexOf("transitions");
  if (idx < 0) return expr;
  // Check that "transitions" is followed by whitespace+brace (not a variable name)
  const afterTransitions = expr.slice(idx + "transitions".length);
  if (!/^\s*\{/.test(afterTransitions)) return expr;
  const braceStart = expr.indexOf("{", idx + "transitions".length);
  if (braceStart < 0) return expr;
  let depth = 0;
  let i = braceStart;
  while (i < expr.length) {
    if (expr[i] === "{") depth++;
    else if (expr[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  // Remove the transitions keyword + braced block
  return expr.slice(0, idx).trimEnd() + "\n" + expr.slice(i);
}

export function rewriteEnumVariantAccess(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  // Block-splitter adds spaces around `.` — collapse `X . UpperIdent` → `X.UpperIdent`
  // so the negative lookbehind below can correctly distinguish member access (e.g.
  // `Color . Red` → `Color.Red`, kept as-is) from standalone `.VariantName`.
  // Only collapse when the property starts uppercase to avoid touching `todo . completed`.
  expr = expr.replace(/([A-Za-z0-9_$])\s+\.\s+([A-Z][A-Za-z0-9_$]*)/g, "$1.$2");

  // §14.4.2 — EnumType.variants → EnumType_variants (PascalCase identifiers only)
  expr = expr.replace(/\b([A-Z][A-Za-z0-9_]*)\s*\.\s*variants\b/g, "$1_variants");

  // §14.5 — Payload variant construction is now handled by the emitted enum
  // constructor function (see emit-client.ts:emitEnumVariantObjects).
  // `Shape.Circle(10)` stays as a function call and produces the tagged-object
  // shape `{ variant: "Circle", data: { r: 10 } }` at runtime, aligned with
  // §19.3.2 `fail` so one runtime dispatches both. No inline string rewrite is
  // applied here — the previous `{variant, value: (arg)}` rewrite mis-named the
  // payload property and couldn't carry multi-field / named-field payloads.

  // Standalone .VariantName (compact form, not preceded by identifier) → "VariantName"
  expr = expr.replace(/(?<![A-Za-z0-9_$.])\.\s*([A-Z][A-Za-z0-9_]*)\b/g, '"$1"');
  expr = expr.replace(/\b[A-Z][A-Za-z0-9_]*\s*::\s*([A-Z][A-Za-z0-9_]*)/g, '"$1"');
  expr = expr.replace(/\s*::\s*([A-Z][A-Za-z0-9_]*)/g, '"$1"');
  return expr;
}

// ---------------------------------------------------------------------------
// rewriteStructConstruction
// ---------------------------------------------------------------------------

/**
 * Rewrite `StructName { fields }` struct construction literals to plain JS objects.
 *
 * Structs are pure data (§14.3) — they compile to plain JS objects.
 * `Mario { x: 1, y: 2 }` → `{ x: 1, y: 2 }`
 *
 * Safety rules:
 * - Only matches PascalCase identifier immediately followed by `{` (optional whitespace).
 * - NOT preceded by `.` (which would be an enum member access already rewritten).
 * - NOT preceded by identifier chars (word boundary).
 * - Excludes class declarations (keyword `class` or `extends` before the name).
 *
 * This runs AFTER rewriteEnumVariantAccess, so `Foo.Bar(x)` is already gone
 * and cannot be confused with struct construction.
 */
export function rewriteStructConstruction(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  // Quick exit: no PascalCase identifier candidates
  if (!/[A-Z]/.test(expr)) return expr;

  return expr.replace(
    /(?<![.A-Za-z0-9_$])([A-Z][A-Za-z0-9_]*)\s*\{/g,
    (match: string, name: string, offset: number) => {
      // Don't rewrite class declarations: `class Foo {` or `extends Foo {`
      const before = expr.slice(Math.max(0, offset - 15), offset);
      if (/\b(?:class|extends)\s+$/.test(before)) return match;
      // Don't rewrite export/function/interface/type declarations
      if (/\b(?:function|interface|type|enum)\s+$/.test(before)) return match;
      return "{";
    }
  );
}

// ---------------------------------------------------------------------------
// rewriteEqualityOps
// ---------------------------------------------------------------------------

/**
 * Rewrite scrml equality operators to JavaScript strict equality (§45).
 */
export function rewriteEqualityOps(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  if (!expr.includes("==") && !expr.includes("!=")) return expr;

  const result: string[] = [];
  let inString: string | null = null;
  let i = 0;
  let segStart = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === '`') {
        result.push(_rewriteEqualitySegment(expr.slice(segStart, i)));
        inString = ch;
        segStart = i;
      }
    } else {
      if (ch === '\\') {
        i++;
      } else if (ch === inString) {
        inString = null;
        i++;
        result.push(expr.slice(segStart, i));
        segStart = i;
        continue;
      }
    }
    i++;
  }
  result.push(_rewriteEqualitySegment(expr.slice(segStart)));
  return result.join("");
}

function _rewriteEqualitySegment(segment: string): string {
  return segment
    .replace(/([^!=])={2}(?!=)/g, "$1===")
    .replace(/!={1}(?!=)/g, "!==");
}

// ---------------------------------------------------------------------------
// rewriteRenderKeyword — E-TYPE-071 (§14.9, §16.8)
// ---------------------------------------------------------------------------

/**
 * Detect `render` keyword in expressions that survived past CE.
 * If `render name()` or `render name(expr)` appears in a rewrite-phase expression,
 * it was NOT inside a component body (CE would have consumed it). Emit E-TYPE-071.
 * The expression is passed through unchanged — the error is diagnostic only.
 */
export function rewriteRenderKeyword(expr: string, errors?: any[]): string {
  if (!expr || typeof expr !== "string") return expr;
  if (!expr.includes("render")) return expr;

  if (errors) {
    const renderRe = /(?<![A-Za-z0-9_$])render\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let match;
    while ((match = renderRe.exec(expr)) !== null) {
      errors.push({
        code: "E-TYPE-071",
        message: `E-TYPE-071: \`render ${match[1]}(...)\` is only valid inside a component body. ` +
          `The \`render\` keyword invokes snippet-typed props and must appear inside a component ` +
          `that declares the snippet prop. Move this into a component body or remove it (§16.8).`,
      });
    }
  }
  return expr;
}

// ---------------------------------------------------------------------------
// rewriteTildeRef (§32 tilde pipeline accumulator)
// ---------------------------------------------------------------------------

/**
 * Replace standalone `~` occurrences in an expression with the current tilde
 * accumulator variable name. Called by emitLogicBody() before rewriteExpr().
 *
 * The replacement is word-boundary aware: `~` must not be preceded or
 * followed by a word character (letter, digit, underscore). The tokenizer
 * emits `~` surrounded by spaces (e.g. `~ * 2`), so a simple regex suffices.
 *
 * @param expr - the raw scrml expression string
 * @param tildeVar - the generated JS variable name (e.g. `_scrml_tilde_1`)
 * @returns the expression with `~` replaced by tildeVar
 */
export function rewriteTildeRef(expr: string, tildeVar: string): string {
  if (!expr || !tildeVar || !expr.includes("~")) return expr;
  // Replace `~` not preceded/followed by identifier chars.
  // Uses negative lookbehind/lookahead to avoid replacing inside identifiers.
  return expr.replace(/(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])/g, tildeVar);
}

// ---------------------------------------------------------------------------
// rewriteReactiveAssign
// ---------------------------------------------------------------------------

/**
 * Fix leaked reactive assignments: _scrml_reactive_get("name") = expr
 * → _scrml_reactive_set("name", expr)
 *
 * This pattern arises when rewriteReactiveRefs converts @name in LHS position
 * of an assignment expression to _scrml_reactive_get("name"), then a later
 * expression-aware pass (e.g. rewriteMatchExpr) embeds it in a return statement.
 *
 * The fix: detect assignment to reactive getter and convert to reactive setter.
 * Uses balanced-paren extraction to handle nested expressions in the RHS.
 *
 * Only operates outside string literals.
 */
export function rewriteReactiveAssign(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;
  if (!expr.includes('_scrml_reactive_get')) return expr;

  // Pattern: _scrml_reactive_get("name") = <expr>
  // where <expr> is everything up to the next ; or end of string (not inside parens).
  // We use a character-walk to handle nested expressions correctly.
  const result: string[] = [];
  let i = 0;

  while (i < expr.length) {
    // Look for _scrml_reactive_get("name") = pattern
    const getterRe = /^_scrml_reactive_get\("([^"]+)"\)\s*=(?!=)/;
    const slice = expr.slice(i);
    const m = slice.match(getterRe);

    if (m) {
      const varName = m[1];
      const afterAssign = i + m[0].length;
      // Skip whitespace after =
      let rhsStart = afterAssign;
      while (rhsStart < expr.length && /\s/.test(expr[rhsStart])) rhsStart++;
      // Walk RHS to find end (up to ; or end of string at depth 0)
      let depth = 0;
      let j = rhsStart;
      let inStr: string | null = null;
      while (j < expr.length) {
        const ch = expr[j];
        if (inStr !== null) {
          if (ch === '\\') { j += 2; continue; }
          if (ch === inStr) inStr = null;
        } else {
          if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; }
          else if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) break;
            depth--;
          }
          else if (ch === ';' && depth === 0) break;
        }
        j++;
      }
      const rhs = expr.slice(rhsStart, j).trim();
      result.push(`_scrml_reactive_set("${varName}", ${rhs})`);
      i = j;
    } else {
      // Check for string literal — skip it
      if (expr[i] === '"' || expr[i] === "'" || expr[i] === '`') {
        const q = expr[i];
        result.push(q);
        i++;
        while (i < expr.length) {
          if (expr[i] === '\\') { result.push(expr.slice(i, i + 2)); i += 2; continue; }
          result.push(expr[i]);
          if (expr[i] === q) { i++; break; }
          i++;
        }
      } else {
        result.push(expr[i]);
        i++;
      }
    }
  }

  return result.join('');
}

// ---------------------------------------------------------------------------
// Visitor Pattern — Pass Arrays and Runner
// ---------------------------------------------------------------------------

/**
 * Pass ordering rationale for client expressions:
 *
 *  Pass 1: rewritePresenceGuard     — converts (x) => { body } guard syntax before `is not` patterns
 *  Pass 2: rewriteNotKeyword        — rewrites `is not`, `is not not`, bare `not`; needs @x intact
 *  Pass 3: rewriteRenderKeyword     — diagnostic only; no transformation, safe anywhere early
 *  Pass 4: rewriteBunEval           — compile-time eval; independent of other rewrites
 *  Pass 5: rewriteWorkerRefs        — <#name>.send() before rewriteInputStateRefs consumes <#name>
 *  Pass 6: rewriteRequestRefs       — <#name>.loading|data|... before rewriteInputStateRefs
 *  Pass 7: rewriteInputStateRefs    — <#name> → registry lookup; must run after worker+request refs
 *  Pass 8: rewriteSqlRefs           — ?{`...`} SQL blocks; independent of reactive refs
 *  Pass 9: rewriteEnumToEnum        — Type.toEnum(x); independent, before reactive refs
 * Pass 10: rewriteReactiveRefs      — @var → _scrml_reactive_get; must run after `is not` stabilized
 * Pass 10.5: rewriteReactiveAssign  — fix @var = expr leaked to getter LHS: reactive_get(x)= → reactive_set(x,)
 * Pass 11: rewriteNavigateCalls     — navigate() → _scrml_navigate; independent
 * Pass 12: rewriteIsOperator        — `is Enum.Variant` → === "Variant"; after reactive refs
 * Pass 13: rewriteMatchExpr         — inline match {...}; after is-operator, recursive
 * Pass 14: rewriteEnumVariantAccess — Enum.Variant, .Variant; must run before struct construction
 * Pass 15: rewriteStructConstruction — Name { fields } → { fields }; after enum variants consumed
 * Pass 16: rewriteFnKeyword         — fn → function; structural, before inline body fixup
 * Pass 17: rewriteInlineFunctionBodies — insert semicolons in merged function bodies
 * Pass 18: rewriteEqualityOps       — == → ===, != → !==; outermost to avoid false matches
 *
 * Server passes omit rewriteRenderKeyword, rewriteBunEval, and rewriteEqualityOps.
 * Server pass 7 uses rewriteServerReactiveRefs instead of rewriteReactiveRefs.
 * Server passes reorder SQL and reactive refs: server-reactive runs before SQL (not after).
 * Server pass 8.5 re-runs rewriteServerReactiveRefs after SQL to catch @var references that
 *   were inside backtick strings during pass 7 (skipped) but exposed as plain identifiers
 *   in the argList after rewriteSqlRefs extracts them from SQL template params.
 */

/**
 * Execute a flat array of rewrite passes over an input string using reduce.
 * Each pass receives the accumulated string and the shared context.
 */
function runPasses(input: string, passes: RewritePass[], ctx: RewriteContext): string {
  return passes.reduce((s, pass) => pass(s, ctx), input);
}

// ---------------------------------------------------------------------------
// Client pass definitions
// ---------------------------------------------------------------------------

/**
 * All client-side rewrite passes in execution order.
 * These are used by rewriteExpr and rewriteExprWithDerived.
 */
const clientPasses: RewritePass[] = [
  // Pass 1
  (s, ctx) => ctx.skipPresenceGuard ? s : rewritePresenceGuard(s),
  // Pass 2
  (s, ctx) => rewriteNotKeyword(s, ctx.errors),
  // Pass 3
  (s, ctx) => rewriteRenderKeyword(s, ctx.errors),
  // Pass 4
  (s, ctx) => rewriteBunEval(s, ctx.errors),
  // Pass 5
  (s, _ctx) => rewriteWorkerRefs(s),
  // Pass 6
  (s, _ctx) => rewriteRequestRefs(s),
  // Pass 7
  (s, _ctx) => rewriteInputStateRefs(s),
  // Pass 8
  (s, ctx) => rewriteSqlRefs(s, "_scrml_sql", ctx.errors),
  // Pass 9
  (s, _ctx) => rewriteEnumToEnum(s),
  // Pass 9.5: early struct construction strip — ensures `@var` inside `Type { ...@var }` is
  // visible to rewriteReactiveRefs (the AST parser chokes on `Identifier {` prefix).
  (s, _ctx) => rewriteStructConstruction(s),
  // Pass 9.7: §51.14 replay primitive — rewrite `replay(@target, @log[, n])` →
  // `_scrml_replay("target", _scrml_reactive_get("log"), n?)`. MUST run
  // before rewriteReactiveRefs so the first @-ref is still literal at
  // match time (we want its name as a string, not its runtime value).
  (s, _ctx) => rewriteReplayCalls(s),
  // Pass 10: derivedNames-aware reactive ref rewrite
  (s, ctx) => rewriteReactiveRefs(s, ctx.derivedNames ?? null),
  // Pass 10.5: fix leaked reactive assignments (reactive getter on LHS of =)
  // @mario = expr → after pass 10: _scrml_reactive_get("mario") = expr → reactive_set
  (s, _ctx) => rewriteReactiveAssign(s),
  // Pass 11
  (s, _ctx) => rewriteNavigateCalls(s),
  // Pass 12
  (s, _ctx) => rewriteIsOperator(s),
  // Pass 13
  (s, _ctx) => rewriteMatchExpr(s),
  // Pass 13.5: strip transitions {} blocks from enum bodies (§51.2)
  (s, _ctx) => stripTransitionsBlock(s),
  // Pass 14
  (s, _ctx) => rewriteEnumVariantAccess(s),
  // Pass 15
  (s, _ctx) => rewriteStructConstruction(s),
  // Pass 16
  (s, _ctx) => rewriteFnKeyword(s),
  // Pass 17
  (s, _ctx) => rewriteInlineFunctionBodies(s),
  // Pass 18
  (s, _ctx) => rewriteEqualityOps(s),
];

// ---------------------------------------------------------------------------
// Server pass definitions
// ---------------------------------------------------------------------------

/**
 * All server-side rewrite passes in execution order.
 * Used by rewriteServerExpr.
 *
 * Differences from client passes:
 * - No rewriteRenderKeyword (server code has no render calls)
 * - No rewriteBunEval (compile-time eval not needed on server path)
 * - No rewriteEqualityOps (server emitter handles equality separately)
 * - Uses rewriteServerReactiveRefs instead of rewriteReactiveRefs
 * - rewriteServerReactiveRefs runs BEFORE rewriteSqlRefs (different ordering from client)
 * - rewriteSqlRefs uses ctx.dbVar for the database variable name
 */
const serverPasses: RewritePass[] = [
  // Pass 1
  (s, ctx) => ctx.skipPresenceGuard ? s : rewritePresenceGuard(s),
  // Pass 2
  (s, _ctx) => rewriteNotKeyword(s),
  // Pass 3
  (s, _ctx) => rewriteWorkerRefs(s),
  // Pass 4
  (s, _ctx) => rewriteRequestRefs(s),
  // Pass 5
  (s, _ctx) => rewriteInputStateRefs(s),
  // Pass 6
  (s, _ctx) => rewriteEnumToEnum(s),
  // Pass 6.5: early struct construction strip (same reason as client pass 9.5)
  (s, _ctx) => rewriteStructConstruction(s),
  // Pass 7: server-side reactive refs (different from client rewriteReactiveRefs)
  (s, _ctx) => rewriteServerReactiveRefs(s),
  // Pass 8: SQL with server dbVar
  (s, ctx) => rewriteSqlRefs(s, ctx.dbVar ?? "_scrml_sql", ctx.errors),
  // Pass 8.5: re-run server reactive refs to catch @var that rewriteSqlRefs exposed.
  // rewriteSqlRefs extracts @var from SQL template params (${@var}) into plain JS argList
  // positions. Those @var were inside backtick strings during pass 7 and were skipped.
  // Running rewriteServerReactiveRefs again here rewrites them before they reach the output.
  (s, _ctx) => rewriteServerReactiveRefs(s),
  // Pass 9
  (s, _ctx) => rewriteNavigateCalls(s),
  // Pass 10
  (s, _ctx) => rewriteIsOperator(s),
  // Pass 11
  (s, _ctx) => rewriteMatchExpr(s),
  // Pass 11.5: strip transitions {} blocks from enum bodies (§51.2)
  (s, _ctx) => stripTransitionsBlock(s),
  // Pass 12
  (s, _ctx) => rewriteEnumVariantAccess(s),
  // Pass 13
  (s, _ctx) => rewriteStructConstruction(s),
  // Pass 14
  (s, _ctx) => rewriteFnKeyword(s),
  // Pass 15
  (s, _ctx) => rewriteInlineFunctionBodies(s),
];

// ---------------------------------------------------------------------------
// rewriteExpr (main entry point)
// ---------------------------------------------------------------------------

/**
 * Apply all client expression rewrites in sequence (no derived-name awareness).
 *
 * Pass ordering is defined in clientPasses above. Key constraints:
 * - rewritePresenceGuard and rewriteNotKeyword run BEFORE rewriteReactiveRefs
 *   (patterns like `@x is not` need @x intact — after reactive rewrite it becomes
 *   _scrml_reactive_get("x") which `is not` regex can't match)
 * - rewriteStructConstruction runs AFTER rewriteEnumVariantAccess so that
 *   `Foo.Bar(x)` is already rewritten before struct construction stripping touches it
 * - rewriteWorkerRefs and rewriteRequestRefs run BEFORE rewriteInputStateRefs
 *   (all three consume <#name> patterns; worker/request refs must claim theirs first)
 */
export function rewriteExpr(expr: string, errors?: any[]): string {
  return runPasses(expr, clientPasses, { errors });
}

/**
 * rewriteExpr variant that skips rewritePresenceGuard. Use when the input
 * is known to be an expression-position arrow/function body (e.g. escape-hatch
 * emission for ArrowFunctionExpression with BlockStatement body). Bug C
 * (6nz 2026-04-20): a callback arrow like `(x) => { @count = @count + x }`
 * otherwise matches the presence-guard regex and gets turned into
 * `if (x !== null && x !== undefined) { ... }` at the call-arg site.
 */
export function rewriteExprArrowBody(expr: string, errors?: any[]): string {
  return runPasses(expr, clientPasses, { errors, skipPresenceGuard: true });
}

/** Server-side variant of rewriteExprArrowBody. */
export function rewriteServerExprArrowBody(expr: string, dbVar?: string): string {
  return runPasses(expr, serverPasses, { dbVar, skipPresenceGuard: true });
}

// ---------------------------------------------------------------------------
// rewriteExprWithDerived
// ---------------------------------------------------------------------------

/**
 * Apply all client expression rewrites with derived-name awareness (§6.6).
 *
 * When derivedNames is provided and non-empty, @varName references to derived
 * variables are rewritten to _scrml_derived_get("name") instead of
 * _scrml_reactive_get("name"). All other passes are identical to rewriteExpr.
 *
 * Note: this variant does not thread errors — callers that need both derived
 * awareness and error reporting should call rewriteExpr with errors after
 * pre-processing with rewriteNotKeyword/rewritePresenceGuard manually.
 */
export function rewriteExprWithDerived(expr: string, derivedNames: Set<string> | null): string {
  if (!derivedNames || derivedNames.size === 0) return rewriteExpr(expr);
  return runPasses(expr, clientPasses, { derivedNames });
}

// ---------------------------------------------------------------------------
// rewriteServerReactiveRefs / rewriteServerExpr / serverRewriteEmitted
// ---------------------------------------------------------------------------

/**
 * Rewrite `@varName` reactive references to server-side request body lookups.
 */
export function rewriteServerReactiveRefs(expr: string): string {
  if (!expr || typeof expr !== "string") return expr;

  const astRewrite = rewriteServerReactiveRefsAST(expr);
  if (astRewrite.ok) return astRewrite.result;

  const result: string[] = [];
  let inString: string | null = null;
  let i = 0;
  let segStart = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === '`') {
        const segment = expr.slice(segStart, i);
        result.push(segment.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, '_scrml_body["$1"]'));
        inString = ch;
        segStart = i;
      }
    } else {
      if (ch === '\\') {
        i++;
      } else if (ch === inString) {
        result.push(expr.slice(segStart, i + 1));
        inString = null;
        segStart = i + 1;
      }
    }
    i++;
  }

  const remaining = expr.slice(segStart);
  if (inString === null) {
    result.push(remaining.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, '_scrml_body["$1"]'));
  } else {
    result.push(remaining);
  }

  return result.join("");
}

/**
 * Apply all expression rewrites for server handler context.
 *
 * Pass ordering is defined in serverPasses above. Key differences from client:
 * - No rewriteEqualityOps, rewriteRenderKeyword, or rewriteBunEval
 * - Uses rewriteServerReactiveRefs (maps @var to request body) instead of rewriteReactiveRefs
 * - rewriteServerReactiveRefs runs BEFORE rewriteSqlRefs (opposite of client ordering)
 * - dbVar is threaded via context for the SQL pass
 */
export function rewriteServerExpr(expr: string, dbVar: string = "_scrml_sql"): string {
  return runPasses(expr, serverPasses, { dbVar });
}

/**
 * Post-process emitted JS code for server handler context.
 */
export function serverRewriteEmitted(code: string): string {
  if (!code) return code;
  return code
    .replace(/_scrml_reactive_get\("([^"]+)"\)/g, '_scrml_body["$1"]')
    .replace(/_scrml_derived_get\("([^"]+)"\)/g, '_scrml_body["$1"]');
}

// ---------------------------------------------------------------------------
// hasTemplateInterpolation / rewriteTemplateAttrValue
// ---------------------------------------------------------------------------

/**
 * Check whether a string attribute value contains template literal interpolations.
 */
export function hasTemplateInterpolation(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  return /\$\{/.test(value);
}

/**
 * Rewrite a string attribute value containing `${...}` interpolations into
 * a JS template literal expression.
 */
export function rewriteTemplateAttrValue(value: string): TemplateAttrResult {
  const reactiveVars = new Set<string>();

  let result = "`";
  let i = 0;

  while (i < value.length) {
    if (value[i] === '$' && value[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < value.length && depth > 0) {
        if (value[j] === '{') depth++;
        else if (value[j] === '}') depth--;
        if (depth > 0) j++;
      }
      const interiorExpr = value.slice(i + 2, j);

      const rewrittenExpr = interiorExpr.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, (_, name: string) => {
        reactiveVars.add(name);
        return `_scrml_reactive_get("${name}")`;
      });

      result += `\${${rewrittenExpr}}`;
      i = j + 1;
    } else if (value[i] === '`') {
      result += '\\`';
      i++;
    } else if (value[i] === '\\' && i + 1 < value.length) {
      result += value[i] + value[i + 1];
      i += 2;
    } else {
      result += value[i];
      i++;
    }
  }

  result += "`";

  return { jsExpr: result, reactiveVars };
}
