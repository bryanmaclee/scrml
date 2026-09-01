/**
 * W-MAP-ITERATION-ORDER — info-level lint (SPEC §59.8 / §59.11).
 *
 * Maps are UNORDERED by default, "and the language says so loudly" (§59.8).
 * Iterating a non-`@ordered` map's `.entries()` / `.keys()` / `.values()`
 * WITHOUT `.sorted()` (or `.sortedBy(fn)`) yields an UNSPECIFIED order — code
 * that depends on order should ask for it. This lint nudges the obvious case:
 * `<each in=@m.entries()>` on a non-`@ordered` map, no `.sorted()` stabilizer.
 *
 * Per §59.11 the code is INFO-level: it partitions into `result.warnings`
 * (non-fatal) — the `W-` prefix auto-routes it there (api.js info-partition).
 * It NEVER lands in `result.errors`. The message names the two ways to get
 * determinism: `.sorted()` (cheap, explicit) or the `@ordered` map affix.
 *
 * Best-effort (D4 scope): fires only on the obvious `<each in=@m.<iterMethod>()>`
 * shape where `m` is a KNOWN map cell (declared `[KeyT: ValT]` or a map-lit RHS)
 * AND the iterable does not end in `.sorted()` / `.sortedBy(...)`. Complex
 * iteration shapes (assigning `.entries()` to a let then iterating, etc.) are
 * out of scope for v1 — documented, not silent.
 *
 * Pipeline placement: post-TS pass invoked from api.js (sibling to
 * `runWEachKey`). Output shape mirrors `lint-w-each-key.js`.
 *
 * @module lint-w-map-iteration-order
 */

import { ifChainChildNodes } from "./ast-if-chain.js";

import { collectMapVarNames } from "./codegen/reactive-deps.ts";

/**
 * Walk every each-block in the file AST (mirrors lint-w-each-key.walkEachBlocks).
 * @param {object} fileAST
 * @param {(eachBlock: object) => void} visit
 */
function walkEachBlocks(fileAST, visit) {
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.kind === "each-block") {
      visit(node);
      if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren);
      if (Array.isArray(node.templateChildren)) walk(node.templateChildren);
      if (node.emptyChild) walk(node.emptyChild);
      return;
    }
    for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
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
  walk(fileAST.nodes ?? fileAST.ast?.nodes ?? fileAST);
}

/**
 * Collect the set of `@ordered` map cell names in the file — these are EXEMPT
 * from the lint (an `@ordered` map opts INTO insertion-order iteration, §59.8).
 *
 * @param {object} file
 * @returns {Set<string>}
 */
function collectOrderedMapNames(file) {
  const names = new Set();
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if ((node.kind === "state-decl" || node.kind === "reactive-decl") && typeof node.name === "string") {
      const anno = node.typeAnnotation;
      // `@ordered` is a postfix TYPE affix (§59.2) carried verbatim on the
      // annotation string. A map type ending in `@ordered` opts into order.
      if (typeof anno === "string" && anno.trim().endsWith("@ordered")) {
        names.add(node.name);
      }
    }
    for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
      if (Array.isArray(node[k])) walk(node[k]);
    }
    // §17.1.1 if-chain — SAME blind spot as `walkEachBlocks` above, SAME shared
    // enumerator, but this one is a latent FALSE POSITIVE rather than a lost
    // diagnostic, and it is worth stating why it was invisible.
    //
    // `runWMapIterationOrder` returns early on `!mapNames.has(name)`, and
    // `mapNames` comes from `collectMapVarNames` (codegen/reactive-deps.ts),
    // which carries the IDENTICAL blind spot. So a map declared inside an
    // `if=`/`else` branch never reaches the `orderedNames` consult at all, and
    // this walk's blindness is MASKED by a third instance of the same class.
    //
    // MEASURED, not reasoned: arming that mask (teaching `collectMapVarNames`
    // to descend an if-chain, temporarily) makes an `@ordered` map declared in
    // a branch lose its §59.8 exemption and FALSE-fire W-MAP-ITERATION-ORDER —
    // 0 on the lone-`if=` shape, 1 on the `if=`/`else` shape. **Closing the
    // codegen collector alone would have ARMED a cry-wolf here.** Both halves
    // of a masked pair get closed together or neither does; the codegen half
    // is filed separately (it changes EMIT and owes its own migration).
    for (const branchBody of ifChainChildNodes(node)) walk(branchBody);
  }
  walk(file.ast?.nodes ?? file.nodes ?? file);
  return names;
}

/**
 * Match `<each in=@m.<iterMethod>()>` where the iterable iterates a map view.
 * Returns the bare map name + method when the shape matches AND no `.sorted()` /
 * `.sortedBy(...)` stabilizer is present; otherwise null.
 *
 * @param {string} inExprRaw
 * @returns {{ mapName: string, method: string } | null}
 */
function matchMapIterable(inExprRaw) {
  const expr = (inExprRaw || "").trim();
  // Already stabilized — `.sorted()` / `.sortedBy(...)` anywhere → never warn.
  if (/\.sorted\s*\(/.test(expr) || /\.sortedBy\s*\(/.test(expr)) return null;
  // Shape: @<mapName>.<entries|keys|values>()  (the three unordered views).
  const m = expr.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)\.(entries|keys|values)\s*\(\s*\)\s*$/);
  if (!m) return null;
  return { mapName: m[1], method: m[2] };
}

/**
 * Build the W-MAP-ITERATION-ORDER message for a fire.
 * @param {string} mapName
 * @param {string} method
 * @returns {string}
 */
function buildMessage(mapName, method) {
  return (
    `W-MAP-ITERATION-ORDER: \`<each in=@${mapName}.${method}()>\` iterates an UNORDERED map — ` +
    `iteration order is UNSPECIFIED (§59.8). If order matters, stabilize it: add \`.sorted()\` ` +
    `(e.g. \`@${mapName}.${method}().sorted()\`) for a cheap explicit ordering, or declare the map ` +
    `\`[KeyT: ValT]@ordered\` for insertion-order iteration. If order is irrelevant here, this notice ` +
    `is informational and can be ignored.`
  );
}

/**
 * Walk the typed-AST and collect W-MAP-ITERATION-ORDER diagnostics.
 *
 * @param {object[]} files — typed FileAST array from `runTS`
 * @returns {Array<{ filePath: string, line: number, column: number, code: string, severity: string, message: string }>}
 */
export function runWMapIterationOrder(files) {
  const diagnostics = [];
  if (!files || !Array.isArray(files)) return diagnostics;

  for (const file of files) {
    const filePath = file.filePath || "";
    // Map cells in scope (declared `[K:V]` or map-lit RHS). Empty → skip file.
    const mapNames = collectMapVarNames(file.ast ?? file);
    if (!mapNames || mapNames.size === 0) continue;
    const orderedNames = collectOrderedMapNames(file);

    walkEachBlocks(file, (eachBlock) => {
      if (eachBlock.iterShape !== "in") return;
      const hit = matchMapIterable(eachBlock.inExprRaw);
      if (!hit) return;
      // Only a KNOWN map cell; an `@ordered` map is exempt (opted into order).
      if (!mapNames.has(hit.mapName)) return;
      if (orderedNames.has(hit.mapName)) return;
      const span = eachBlock.span || {};
      diagnostics.push({
        filePath,
        line: span.line ?? 0,
        column: span.col ?? 0,
        code: "W-MAP-ITERATION-ORDER",
        severity: "info",
        message: buildMessage(hit.mapName, hit.method),
      });
    });
  }

  return diagnostics;
}
