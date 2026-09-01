/**
 * W-EACH-KEY-001 — info-level lint that surfaces `<each in=@cell>` sites
 * where the per-item identity is NOT inferable (items lack a `.id` field
 * or the item type isn't an introspectable struct) AND no explicit
 * `key=expr` has been provided.
 *
 * Per S130 HU-1 Q5 ratification, the canonical key= treatment is:
 *   - Items with a `.id` field → auto-infer `key=item.id`. No diagnostic.
 *     Silent + correct.
 *   - Items without an inferable identity → fire W-EACH-KEY-001 with three
 *     legitimate causes named:
 *       (a) order-stable list (positional keying is appropriate)
 *       (b) item has stable identity in different field (e.g. `email`)
 *       (c) dev wants positional (acknowledge intent)
 *   - Adopter can override via explicit `key=expr` or suppress via
 *     `key=__index__` (canonical positional-intentional sentinel).
 *
 * `<each of=N>` form is NEVER warned — the default `key=@.` (the index
 * itself) is the structurally-correct positional key.
 *
 * Pipeline placement: runs as a post-TS pass invoked from api.js. Needs
 * access to the typed FileAST (with each-block nodes) and the per-file
 * typeRegistry (to introspect item types via the source @cell's
 * declared type — when available).
 *
 * Output shape: `{ filePath, line, column, code, severity, message }`
 * — fed into the `allLintDiagnostics` channel by api.js. Mirrors
 * lint-i-match-promotable.js's output convention.
 *
 * @module lint-w-each-key
 */

import { ifChainChildNodes } from "./ast-if-chain.js";

/**
 * Walk every each-block in the file AST.
 * @param {object} fileAST
 * @param {(eachBlock: object) => void} visit
 */
function walkEachBlocks(fileAST, visit) {
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node.kind === "each-block") {
      visit(node);
      // Recurse into bodyChildren so nested each-blocks surface too.
      if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren);
      if (Array.isArray(node.templateChildren)) walk(node.templateChildren);
      if (node.emptyChild) walk(node.emptyChild);
      return;
    }
    // §17.1.1 if-chain — an `if=`/`else-if=`/`else` chain that HAS an else arm is
    // collapsed by the TAB into an `if-chain` node whose branch bodies live under
    // `branches[].element` + `elseBranch`, NONE of the generic keys below. Without
    // this descent an `<each>` under a guarded branch was invisible to the lint and
    // W-EACH-KEY-001 never fired — and since the sibling collector fix
    // (g-each-in-if-else-chain-emits-zero-renderers) that `<each>` now compiles to a
    // REAL `_scrml_reconcile_list` with index identity, so the adopter gets wrong
    // DOM reuse on reorder/delete with no diagnostic at all. Pre-fix the missing
    // lint was inert only because the whole subtree emitted zero renderers.
    // Same shared child-shape enumerator as the six emit/DG walks.
    // (g-each-in-if-else-chain-key-lint-blind.)
    if (node.kind === "if-chain") {
      for (const branchBody of ifChainChildNodes(node)) walk(branchBody);
      return;
    }
    for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
      if (Array.isArray(node[k])) walk(node[k]);
    }
  }
  walk(fileAST.nodes ?? fileAST.ast?.nodes ?? fileAST);
}

/**
 * Heuristic: can we infer `.id` from the item type of an `in=@cell`?
 *
 * For Landing 1 baseline, the heuristic is conservative:
 *   - If the source @cell's declared type carries a struct with a
 *     `.id` field — return true (silent + correct).
 *   - If the source is an untyped array or a type we can't introspect
 *     — return false (fire the lint).
 *
 * Real type-system integration (probing the cell's declared element
 * type via cellTypeRegistry → resolveType → struct.fields lookup for
 * "id") sits behind the typeRegistry interface. When the registry isn't
 * threaded here (the common case during pipeline boot), we return false
 * and emit the lint — adopters can suppress via `key=__index__` if
 * positional is intentional.
 *
 * @param {object} eachBlock — the each-block AST node
 * @param {Map<string, object>=} cellTypeByName — name → typeAnnotation/inference
 * @param {Map<string, object>=} typeRegistry — user-declared type names
 * @returns {boolean} true if `.id` inference is supportable
 */
function canInferIdKey(eachBlock, cellTypeByName, typeRegistry) {
  if (!eachBlock || eachBlock.iterShape !== "in") return false; // of= doesn't lint
  const inExpr = (eachBlock.inExprRaw || "").trim();
  // Extract bare `@cellName` if the source is a simple cell ref.
  const m = inExpr.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (!m) {
    // Source is a complex expression (e.g. `@items.filter(...)` or `@a.concat(@b)`).
    // We can't reliably introspect — conservative: assume non-inferable,
    // so the lint fires. Adopter overrides via key=expr if they have one.
    return false;
  }
  const cellName = m[1];
  if (!cellTypeByName) return false;
  const cellType = cellTypeByName.get(cellName);
  if (!cellType) return false;
  // For Landing 1 baseline, accept only the simple shape: the cell type
  // is an array of a struct that has an `id` field. The shape probe
  // through the type registry is best-effort — when typeRegistry lacks
  // the struct definition, we fall through to "can't infer" (lint fires).
  // Future enhancement: handle generic `T[]`, schema-derived row types,
  // tuple types, etc.
  if (typeof cellType === "string") {
    // Type annotation like `Contact[]` — look up `Contact` in typeRegistry.
    const baseName = cellType.replace(/\[\]\s*$/, "").trim();
    if (!typeRegistry || !typeRegistry.has(baseName)) return false;
    const typeDecl = typeRegistry.get(baseName);
    if (!typeDecl || typeDecl.kind !== "struct") return false;
    const fields = typeDecl.fields || typeDecl.members || [];
    if (!Array.isArray(fields)) return false;
    // Check for `id` field (case-sensitive).
    return fields.some((f) => f && (f.name === "id" || f.fieldName === "id"));
  }
  if (cellType && typeof cellType === "object" && cellType.kind === "struct") {
    const fields = cellType.fields || cellType.members || [];
    if (!Array.isArray(fields)) return false;
    return fields.some((f) => f && (f.name === "id" || f.fieldName === "id"));
  }
  return false;
}

/**
 * Collect name → typeAnnotation map for state cells in the file.
 * Walks top-level + nested state-decls and records their declared types.
 * Type annotations are returned as strings (the source text); structured
 * resolved types route through the type-system pass's stateTypeRegistry
 * (consumed via the registry param).
 *
 * @param {object} file
 * @returns {Map<string, string>}
 */
function collectCellTypeAnnotations(file) {
  const out = new Map();
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.kind === "state-decl" && typeof node.name === "string") {
      const annot = node.typeAnnotation || node.declaredType || null;
      if (typeof annot === "string") {
        out.set(node.name, annot);
      } else if (annot && typeof annot === "object") {
        out.set(node.name, annot);
      }
    }
    if (node.kind === "reactive-decl" && typeof node.name === "string") {
      const annot = node.typeAnnotation || node.declaredType || null;
      if (typeof annot === "string") {
        out.set(node.name, annot);
      }
    }
    for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
      if (Array.isArray(node[k])) walk(node[k]);
    }
  }
  walk(file.ast?.nodes ?? file.nodes ?? file);
  return out;
}

/**
 * Build the diagnostic message for a W-EACH-KEY-001 fire.
 *
 * @param {object} eachBlock
 * @returns {string}
 */
function buildEachKeyMessage(eachBlock) {
  const src = (eachBlock.inExprRaw || "").trim();
  return (
    `W-EACH-KEY-001: \`<each in=${src}>\` has no inferable per-item key — items don't expose a \`.id\` field ` +
    `and no explicit \`key=expr\` was given. Three legitimate causes: (a) order-stable list — positional keying is correct; ` +
    `(b) items carry stable identity in a different field (e.g. \`key=item.email\`); (c) positional fallback is intentional ` +
    `(suppress via \`key=__index__\`). The runtime defaults to positional keying when this lint fires.`
  );
}

/**
 * Walk the typed-AST and collect W-EACH-KEY-001 diagnostics.
 *
 * @param {object[]} files — typed FileAST array from `runTS`
 * @param {Map<string, object>=} stateTypeRegistry — per-cell type registry from TS
 * @returns {Array<{ filePath: string, line: number, column: number, code: string, severity: string, message: string }>}
 */
export function runWEachKey(files, stateTypeRegistry) {
  const diagnostics = [];
  if (!files || !Array.isArray(files)) return diagnostics;

  for (const file of files) {
    const filePath = file.filePath || "";
    const cellTypeByName = collectCellTypeAnnotations(file);
    const typeRegistry = file.typeRegistry || stateTypeRegistry || null;

    walkEachBlocks(file, (eachBlock) => {
      // Skip count-iteration form — `key=@.` is the structurally-correct
      // default for `<each of=N>`. The lint applies only to `<each in=...>`.
      if (eachBlock.iterShape !== "in") return;
      // Skip when explicit key= is present — adopter has already overridden.
      if (eachBlock.keyExprRaw) return;
      // Try to infer .id key — if supportable, silent + correct.
      if (canInferIdKey(eachBlock, cellTypeByName, typeRegistry)) return;
      // Fire the lint.
      const span = eachBlock.span || {};
      diagnostics.push({
        filePath,
        line: span.line ?? 0,
        column: span.col ?? 0,
        code: "W-EACH-KEY-001",
        severity: "info",
        message: buildEachKeyMessage(eachBlock),
      });
    });
  }

  return diagnostics;
}
