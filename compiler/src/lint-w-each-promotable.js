/**
 * W-EACH-PROMOTABLE — info-level lint that surfaces `${ for (let x of @cell)
 * { lift <markup/>... } }` Tier-0 iteration sites that are mechanically
 * promotable to the Tier-1 `<each in=@cell>...<markup/>...</each>`
 * structural form (SPEC §17.X NEW per S130 HU-1).
 *
 * **Status:** S130 HU-1 iteration Landing 1. Pairs with `bun scrml
 * promote --each` (Landing 3 — separate dispatch).
 *
 * **Spec:** SPEC §17.X (NEW for S130 HU-1 — Landing 2 adds the SPEC
 * subsection). The lint message names the legitimate cause AND points
 * at the structural `<each>` form as the promotion target.
 *
 * **Pipeline placement:** runs as a post-TS pass invoked from api.js.
 * Mirrors I-MATCH-PROMOTABLE / I-FN-PROMOTABLE placement. Non-fatal —
 * diagnostics flow into the `allLintDiagnostics` channel.
 *
 * **Fire conditions (Landing 1 baseline — conservative):**
 * The lint fires when ALL of:
 *   1. The site is a `for-stmt` AST node inside a logic context
 *      (`${...}`) that lives inside a markup parent — typical
 *      `${ for (...) { lift <markup/> } }` shape.
 *   2. The for-stmt's iterable is a single reactive cell ref (`@cellName`).
 *      Complex iterables (`@items.filter(...)`, `myFunc(@x)`) qualify too,
 *      since they remain reactive-equivalent, but are conservative.
 *   3. The for-stmt's body contains at least one `lift-expr` child —
 *      the dominant `for/of + lift` intent per gauntlet R10 data
 *      (82% of corpus for/of sites pair with lift).
 *
 * Sites NOT covered:
 *   - `for/of` without `lift` (pure logic iteration — outside iteration
 *     surface scope).
 *   - C-style `for (let i = 0; ...; ...)` loops (Landing 1 baseline
 *     covers the `for-of/in` form; C-style → `<each of=N>` mapping
 *     is a future extension).
 *   - COMPILER-GENERATED iteration (`_tableForSynth`-marked for-stmts). A
 *     `<tableFor for=T rows=@x>` expands (in the TS pass) to an equivalent
 *     `for (row of @x) { lift <tr/> }` carrying `_tableForSynth: true`
 *     (emit-table-for.ts). That iteration is synthesized by the compiler,
 *     NOT authored by the adopter, so promoting it to `<each>` would suggest
 *     rewriting code the adopter never wrote — and tableFor IS already the
 *     canonical declarative form for type-driven rows (§41.16). The lint
 *     skips any `_tableForSynth`-marked for-stmt (S184
 *     g-ghost-lint-canonical-form-false-positive Fix B).
 *
 * @module lint-w-each-promotable
 */

import { ifChainChildNodes } from "./ast-if-chain.js";

/**
 * Walk every for-stmt in the file AST and visit it.
 * @param {object} file
 * @param {(forStmt: object) => void} visit
 */
function walkForStmts(file, visit) {
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.kind === "for-stmt" || node.kind === "for-loop") {
      visit(node);
    }
    for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren", "consequent", "alternate", "components"]) {
      if (Array.isArray(node[k])) walk(node[k]);
    }
    // §17.1.1 if-chain — an `if=`/`else-if=`/`else` chain WITH an else arm is
    // collapsed by `collapseIfChains` into `{kind:"if-chain", branches:[{condition,
    // element}], elseBranch}`. Neither field is in the container list above, and
    // `branches` holds RECORDS rather than nodes, so listing it there would not
    // help either. Child SHAPE via `ifChainChildNodes` (ast-if-chain.js) — the one
    // module that owns this fact — so the next branch-carrying field is added in
    // ONE place. A lone `if=` is never collapsed, which is why adding a `<div
    // else>` sibling was the only variable between firing and silence.
    for (const branchBody of ifChainChildNodes(node)) walk(branchBody);
  }
  walk(file.ast?.nodes ?? file.nodes ?? file);
  if (file.ast?.components) walk(file.ast.components);
  if (file.components) walk(file.components);
}

/**
 * Does this for-stmt's iterable look like a reactive @cell ref?
 * Conservative check — direct iterable strings starting with `@`,
 * or iterExpr ExprNodes whose top has `@`-prefixed leaf.
 *
 * @param {object} forStmt
 * @returns {boolean}
 */
function iterableIsReactiveCell(forStmt) {
  if (!forStmt) return false;
  // Match `( ... of @cellName )` shape against the raw iterable string.
  const it = forStmt.iterable;
  if (typeof it === "string" && /@[A-Za-z_$]/.test(it)) return true;
  // Probe iterExpr structured form.
  const ie = forStmt.iterExpr;
  if (ie && typeof ie === "object") {
    // Probe by traversal — any nested ident starting with `@` qualifies.
    let found = false;
    function dfs(n) {
      if (found) return;
      if (!n || typeof n !== "object") return;
      if (typeof n.name === "string" && n.name.startsWith("@")) { found = true; return; }
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) { for (const e of v) dfs(e); }
        else if (v && typeof v === "object") dfs(v);
      }
    }
    dfs(ie);
    if (found) return true;
  }
  return false;
}

/**
 * Does the for-stmt body contain at least one lift-expr?
 *
 * @param {object} forStmt
 * @returns {boolean}
 */
function bodyHasLift(forStmt) {
  if (!forStmt || !Array.isArray(forStmt.body)) return false;
  const seen = new WeakSet();
  function check(stmts) {
    for (const s of stmts) {
      if (!s || typeof s !== "object" || seen.has(s)) continue;
      seen.add(s);
      if (s.kind === "lift-expr") return true;
      // Recurse into if-stmts, blocks etc.
      if (Array.isArray(s.body) && check(s.body)) return true;
      if (Array.isArray(s.consequent) && check(s.consequent)) return true;
      if (Array.isArray(s.alternate) && check(s.alternate)) return true;
    }
    return false;
  }
  return check(forStmt.body);
}

/**
 * Extract the source `@cellName` string from the iterable, when single-cell.
 * Returns null for complex iterables.
 *
 * @param {object} forStmt
 * @returns {string | null}
 */
function extractSourceCellName(forStmt) {
  const it = forStmt.iterable;
  if (typeof it === "string") {
    // ast-builder strips the for-of wrapping; iterable is typically just
    // the iter-expr text (e.g. `@contacts`). Also tolerate the older
    // wrapped shape `(let x of @cell)` defensively.
    const direct = it.match(/^\s*@([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    if (direct) return direct[1];
    const wrapped = it.match(/of\s+@([A-Za-z_$][A-Za-z0-9_$]*)\s*\)?\s*$/);
    if (wrapped) return wrapped[1];
  }
  // Structured iterExpr — bare ident shape `{ kind: "ident", name: "@cell" }`.
  const ie = forStmt.iterExpr;
  if (ie && typeof ie === "object" && ie.kind === "ident" && typeof ie.name === "string") {
    const m = ie.name.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extract the loop variable name (string form, post-destructure-flatten).
 *
 * @param {object} forStmt
 * @returns {string}
 */
function extractLoopVarName(forStmt) {
  if (typeof forStmt.variable === "string") return forStmt.variable;
  if (forStmt.variable && typeof forStmt.variable === "object" && typeof forStmt.variable.name === "string") {
    return forStmt.variable.name;
  }
  return "item";
}

/**
 * Build the W-EACH-PROMOTABLE diagnostic message. Names the suggested
 * mechanical promotion target (`<each in=@cell as item>...</each>`) and
 * cross-refs the CLI helper.
 *
 * @param {object} forStmt
 * @returns {string}
 */
function buildMessage(forStmt) {
  const cell = extractSourceCellName(forStmt);
  const varName = extractLoopVarName(forStmt);
  const target = cell
    ? `\`<each in=@${cell} as ${varName}>...</each>\``
    : `\`<each>\` (the Tier-1 structural iteration form)`;
  return (
    `W-EACH-PROMOTABLE: \`\${{ for (...) { lift ... } }}\` is the Tier-0 iteration form. ` +
    `Promote to ${target} for discoverability, composition with the \`<empty>\` ` +
    `sub-element + inferred \`key=\`, and the canonical iteration shape per S130 HU-1. ` +
    `Run \`bun scrml promote --each <file>[:line]\` to lift mechanically. The Tier-0 form ` +
    `continues to compile; the lint is informational only.`
  );
}

/**
 * Walk the typed-AST and collect W-EACH-PROMOTABLE diagnostics.
 *
 * @param {object[]} files — typed FileAST array from `runTS`
 * @returns {Array<{ filePath: string, line: number, column: number, code: string, severity: string, message: string }>}
 */
export function runWEachPromotable(files) {
  const diagnostics = [];
  if (!files || !Array.isArray(files)) return diagnostics;

  for (const file of files) {
    const filePath = file.filePath || "";
    walkForStmts(file, (forStmt) => {
      // Compiler-generated iteration is NOT adopter-authored — never promote it.
      // `<tableFor>` expands to a `_tableForSynth`-marked for-stmt (emit-table-for.ts);
      // suggesting an `<each>` rewrite there would target code the adopter never
      // wrote (and tableFor is already the canonical declarative form, §41.16).
      if (forStmt._tableForSynth) return;
      if (!iterableIsReactiveCell(forStmt)) return;
      if (!bodyHasLift(forStmt)) return;
      const span = forStmt.span || {};
      diagnostics.push({
        filePath,
        line: span.line ?? 0,
        column: span.col ?? 0,
        code: "W-EACH-PROMOTABLE",
        severity: "info",
        message: buildMessage(forStmt),
      });
    });
  }

  return diagnostics;
}
