import { CGError } from "./errors.js";

/**
 * E-SQL-009 — CONCISE / CURRIED arrow-body `?{}` SQL detection (issue #12 blast
 * radius; the S215-class completion of the S220 emit-server diagnostic).
 *
 * The PRIMARY E-SQL-009 site (emit-server.ts ~:1599) catches a `?{}` SQL block
 * inside a BLOCK-body arrow / function-expression, which parses as a single
 * opaque escape-hatch whose `.raw` carries the `?{`...`}` text. That detection
 * MISSES the CONCISE-body arrow shapes — so this pass closes the gap for them:
 *
 *   S5  concise direct      const ins = (x) => ?{`…`}.run()
 *   S11 concise return      return (x) => ?{`…`}.run()
 *   S13 concise in callback [1,2,3].map(x => ?{`…`}.run())
 *   S4  curried             const f = (a) => (b) => { ?{`…`}.run() }
 *   S9  curried multi-stmt  const f = (a) => (b) => { log(a); ?{`…`}.run() }
 *
 * Detection (the single "Case B" text scan): the full source of the offending
 * arrow survives verbatim on the retained `.init` / `.expr` / `.raw` text of some
 * node, so a `?{`…` SQL opener inside a concise-body arrow region is found by
 * scanning that text — see conciseArrowBodyHasSql.
 *
 * HISTORY (Case A removal — g-detect-sql-case-a-prune, 2026-06-27). The S5/S11
 * direct-decl / return forms USED to need a second "Case A" detector: pre-ss50 the
 * live parser's `collectExpr` broke at the SQL BLOCK_REF (ast-builder.js depth-0
 * statement boundary), leaving a dangling `( x ) =>` ParseError escape-hatch and
 * the `?{}` ORPHANED as a sibling `sql` node — so the `.raw` text carried no SQL
 * signature and Case B could not see it. Case A keyed on that orphaned shape
 * (a node whose retained text ends with `=>` immediately followed by a sibling
 * `sql` node). The ss50 item-1 parser fix (commit 2fca8075, ast-builder.js)
 * SUPPRESSED that break when the last collected token is the arrow glyph `=>`, so
 * the concise `?{}` body is now captured into the SAME escape-hatch `.raw` the
 * block-body form produces. The orphaned-sibling shape is therefore no longer
 * produced; Case A was proven dead (0 fires across the full suite + corpus while
 * all of S5/S11/S13/S4/S9 fire cleanly via Case B) and removed.
 *
 * All of these otherwise leak as the generic E-CODEGEN-INVALID-LOGIC ("compiler
 * defect, please report it"). Worse, when the enclosing fn does NOT escalate to
 * server (a curried `?{}` two arrows deep — S4 — stays client), the malformed
 * fragment is emitted into the CLIENT bundle and emit-server never runs at all.
 * So this detection lives in a parser-agnostic post-AST walk wired at TAB (api.js),
 * which runs for EVERY file REGARDLESS of server-escalation, and reuses the SAME
 * E-SQL-009 message + remedy as the emit-server site.
 *
 * Braced-body arrows are intentionally NOT handled here (emit-server already
 * covers them via the escape-hatch `.raw`); the `=>`-not-followed-by-`{` concise
 * gate keeps the two sites DISJOINT (no double-fire) — see conciseArrowBodyHasSql.
 *
 * SCOPE — LIVE pipeline only. The detection reads the `.init` / `.expr` / `.raw`
 * TEXT the live (Acorn) ast-builder retains verbatim. Under `--parser=scrml-native`
 * (strictly opt-in, default null) those fields are backfilled from the mangled
 * structured exprNode and may omit the `?{`...` signature, so a concise/curried
 * SQL-in-arrow can false-NEGATIVE on the native path. That is acceptable: native
 * is the swap-grind opt-in, the live pipeline is the canonical enforcer, and issue
 * #12 is a live-pipeline bug. No crash either way (the walk is null-safe).
 */

const E_SQL_009_MESSAGE =
  "E-SQL-009: a `?{}` SQL block appears inside an arrow / lambda body, where the " +
  "compiler cannot lower it. SQL blocks are lowered at the STATEMENT level of a " +
  "server-function body; an arrow / lambda body is opaque to that pass, so the " +
  "`?{...}` would leak verbatim into the emitted JavaScript. Move the SQL into the " +
  "enclosing server function's body — e.g. replace `const ins = (x) => { ?{`...`}.run() }` " +
  "with a server function `function ins(x) { ?{`...`}.run() }` and call it — or hoist the " +
  "query to a `const` / `let` statement at the function-body level and reference the " +
  "result inside the arrow.";

// The SQL `?{`…` opener signature — FP-safe: a `?{` immediately followed (modulo
// whitespace) by a backtick template open. A ternary-object (`cond ? {a:1} : b`)
// has no backtick, so it is not matched. Mirrors the emit-server site's signature.
const SQL_OPENER_RE = /\?\{\s*`/;

/**
 * Does `text` contain a CONCISE-body arrow (`=>` NOT followed by `{`) whose body
 * region (bounded by bracket depth from the `=>`) contains a `?{`…` SQL opener?
 * A braced-body arrow (`=> {`) is skipped — the emit-server site owns that shape.
 */
export function conciseArrowBodyHasSql(text: string): boolean {
  const n = text.length;
  for (let i = 0; i + 1 < n; i++) {
    // Locate a `=>` arrow operator (`>=` has `>` first, so it never matches).
    if (text[i] !== "=" || text[i + 1] !== ">") continue;
    let j = i + 2;
    while (j < n && /\s/.test(text[j]!)) j++;
    if (text[j] === "{") continue; // braced body — emit-server handles it
    // Concise body: scan from `j` tracking bracket depth (local to this arrow).
    // The body ends when a closing bracket drops below the arrow's start depth,
    // or a `,` / `;` separator is reached at depth 0 (curried inner arrows keep
    // their own `{…}` at depth > 0, so an inner `;` does not end the outer body).
    let depth = 0;
    for (let k = j; k < n; k++) {
      const c = text[k];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      } else if ((c === "," || c === ";") && depth === 0) break;
      else if (c === "?" && text[k + 1] === "{") {
        // A `?{` AT this position — confirm it is a SQL opener (`?{` + optional
        // whitespace + a backtick) ANCHORED at `k`. A bare `SQL_OPENER_RE.test`
        // over `text.slice(k)` would search the WHOLE remainder, so a non-opener
        // `?{` here (e.g. a tight ternary `x?{a:1}`) could spuriously match a real
        // opener LATER in the text, possibly past this body's extent — false-fire.
        let m = k + 2;
        while (m < n && /\s/.test(text[m]!)) m++;
        if (text[m] === "`") return true;
        // Not an opener: keep scanning the body (the depth bookkeeping for the
        // `{` / `}` of an object literal here is handled by the bracket arms above
        // on the next iterations, since we did not consume past `?`).
      }
    }
  }
  return false;
}

// The expression TEXT a statement node retained from parsing (the live ast-builder
// stores the reconstructed RHS / value text on `init` / `expr` / `raw`).
function textOf(node: any): string {
  if (typeof node?.init === "string" && node.init.length) return node.init;
  if (typeof node?.expr === "string" && node.expr.length) return node.expr;
  if (typeof node?.raw === "string" && node.raw.length) return node.raw;
  return "";
}

/**
 * Walk a FileAST and fire E-SQL-009 for every `?{}` SQL block inside a CONCISE
 * arrow body. Runs at TAB (api.js), independent of server-escalation and of the
 * native-vs-live parser (pure post-AST text inspection).
 */
export function detectSqlInConciseArrowBody(fileAST: any, filePath: string): CGError[] {
  const errors: CGError[] = [];
  const seen = new WeakSet<object>();
  const firedSpans = new Set<string>();

  const fire = (span: any): void => {
    const sp = (span ?? {}) as { file?: string; start?: number; end?: number; line?: number; col?: number };
    const key = `${sp.start ?? 0}:${sp.end ?? 0}`;
    if (firedSpans.has(key)) return;
    firedSpans.add(key);
    errors.push(new CGError(
      "E-SQL-009",
      E_SQL_009_MESSAGE,
      { file: filePath ?? sp.file ?? "", start: sp.start ?? 0, end: sp.end ?? 0, line: sp.line ?? 1, col: sp.col ?? 1 },
      "error",
    ));
  };

  const walk = (n: any): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);

    // A concise-body arrow with a `?{`…` SQL opener in this node's retained text
    // — covers every shape: concise-direct (`const ins = (x) => ?{}`), concise-
    // return (`return (x) => ?{}`), concise-in-callback (`.map(x => ?{})`), and
    // curried (`(a) => (b) => { ?{} }`). The orphaned-sibling shape Case A used to
    // catch no longer exists post-ss50 (commit 2fca8075); see the file header.
    const t = textOf(n);
    if (t.indexOf("=>") !== -1 && SQL_OPENER_RE.test(t) && conciseArrowBodyHasSql(t)) {
      fire(n.span);
    }

    for (const k in n) {
      const v = (n as any)[k];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) walk(v[i]);
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  };

  for (const node of (fileAST?.nodes ?? [])) walk(node);
  return errors;
}
