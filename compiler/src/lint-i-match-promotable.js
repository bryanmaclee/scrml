/**
 * I-MATCH-PROMOTABLE — info-level lint that surfaces if-else chains over
 * enum-typed state cells that are mechanically promotable to a `<match>` block.
 *
 * **Status:** S66 Tier B ship. Pairs with `bun scrml promote --match`.
 *
 * **Spec:** SPEC §56. Three message shapes (per §56.3):
 *   - exhaustive (clean lift available — every variant is covered)
 *   - near-miss (concrete missing-variants list)
 *   - compound-condition (advisory; chain has `||` / `&&` / negation; not
 *     auto-promotable — separate info per §56.4)
 *
 * **Predicate matrix (S66 — full restoration):** the lint fires on chains
 * where every branch's `condExpr` is a `binary` ExprNode with `op === "is"`
 * OR `op === "=="` and right-side a leading-dot ident, with the same `@cell`
 * left across the chain. Both `is` and `==` are accepted because they're
 * structurally equivalent variant-tag checks in scrml; the dev's choice of
 * operator is style. The S66 preprocessor fix (`compiler/src/expression-parser.ts`)
 * makes `.Variant` parseable as a primary expression in any operator context,
 * which is what unblocks recognition of `@cell == .Variant` here.
 * (Earlier S66 narrowing to `is`-only was reversed after Bryan flagged the
 * structural error — see docs/changes/promotion-ergonomics/progress.md
 * "S66 narrowing reversal" entry.)
 *
 * **Pipeline placement:** runs as a post-TS pass invoked from api.js. Needs
 * `stateTypeRegistry` (built by `runTS`) plus the typed-AST. The B3 cell
 * resolution (`_resolvedStateCell` stamped on @ident expressions) provides
 * the cell record; cell.declNode.typeAnnotation gives the type name.
 *
 * **Output:** lint diagnostics in the standard shape (`{ line, column,
 * code, severity, message, ghost?, correction? }`) — fed into the
 * `allLintDiagnostics` channel by api.js.
 *
 * @module lint-i-match-promotable
 */

/**
 * Lint diagnostic shape returned to api.js.
 *
 * @typedef {{
 *   line: number,
 *   column: number,
 *   code: string,
 *   severity: "info"|"warning"|"error",
 *   message: string,
 *   ghost?: string,
 *   correction?: string,
 * }} LintDiagnostic
 */

/**
 * Walk the typed-AST and collect I-MATCH-PROMOTABLE diagnostics.
 *
 * @param {object[]} files — typed FileAST array from `runTS`
 * @param {Map<string, object>} stateTypeRegistry — type-name → ResolvedType
 * @returns {Array<LintDiagnostic & { filePath: string }>}
 */
export function runIMatchPromotable(files, _crossFileStateRegistry) {
  const diagnostics = [];
  if (!files || !Array.isArray(files)) return diagnostics;

  for (const file of files) {
    const filePath = file.filePath || "";
    // Prefer the per-file user-defined typeRegistry (S66: type-system.ts now
    // exposes it on the typed-AST). The cross-file `stateTypeRegistry` arg
    // is the per-cell type registry, which is NOT what we want — we need
    // the registry of user-declared types like `type Phase:enum = {...}`.
    const typeRegistry = file.typeRegistry;
    if (!typeRegistry) continue;

    // Build a name→typeAnnotation map for cells in this file. Walks all
    // state-decls (top-level and inside logic blocks) and records their
    // type-annotation strings. Used as a fallback when B3's
    // `_resolvedStateCell` isn't stamped on a condExpr ident.
    const cellTypeByName = collectCellTypeAnnotations(file);
    walkFileForIfChains(file, (chainHead, chainBranches) => {
      const diag = analyseChain(chainHead, chainBranches, typeRegistry, cellTypeByName);
      if (diag) {
        diagnostics.push({ ...diag, filePath });
      }
    });
  }

  return diagnostics;
}

/**
 * Sibling API for `bun scrml promote --match`. Walks the typed-AST to find
 * promotable if-else chains and returns rewrite-ready descriptors. Only
 * `exhaustive`-shape chains are returned (those are the only sites the CLI
 * promotes). Near-miss / compound chains are omitted — those need human
 * action first (the lint surfaces them via `runIMatchPromotable`).
 *
 * @param {object} file — typed FileAST (with file.typeRegistry exposed)
 * @returns {Array<{
 *   chainHead: object,
 *   branches: BranchInfo[],
 *   enumName: string,
 *   variantTagsInOrder: string[],
 *   cellName: string,
 *   shape: "exhaustive"
 * }>}
 */
export function findPromotableChains(file) {
  const out = [];
  if (!file) return out;
  const typeRegistry = file.typeRegistry;
  if (!typeRegistry) return out;
  const cellTypeByName = collectCellTypeAnnotations(file);

  walkFileForIfChains(file, (chainHead, chainBranches) => {
    const result = classifyChainStructured(chainHead, chainBranches, typeRegistry, cellTypeByName);
    if (result && result.shape === "exhaustive") {
      out.push(result);
    }
  });

  return out;
}

/**
 * Like `analyseChain` but returns the structured classification (head +
 * branches + variant tags + enum) rather than the diagnostic shape. Returns
 * null if the chain is not promotable in any shape.
 */
function classifyChainStructured(chainHead, branches, typeRegistry, cellTypeByName) {
  if (branches.length < 2) return null;

  let cellIdent = null;
  let cellName = null;
  let hasCompound = false;
  let hasMixedDiscriminator = false;
  let hasNonIsForm = false;
  const variantTags = [];

  for (const b of branches) {
    const ce = b.condExpr;
    if (!ce) continue;
    if (isCompoundCondition(ce)) { hasCompound = true; continue; }
    const match = matchIsVariantPredicate(ce);
    if (!match) { hasNonIsForm = true; continue; }
    if (cellName == null) {
      cellName = match.cellName;
      cellIdent = match.idLeft;
    } else if (cellName !== match.cellName) {
      hasMixedDiscriminator = true;
    }
    if (match.variantTag) variantTags.push(match.variantTag);
  }

  if (variantTags.length === 0) return null;
  if (hasCompound || hasMixedDiscriminator || hasNonIsForm) return null;

  const enumType = resolveEnumTypeForCell(cellIdent, cellName, typeRegistry, cellTypeByName);
  if (!enumType) return null;

  const allVariants = (enumType.variants ?? []).map(v => v.name);
  const coveredSet = new Set(variantTags);
  const missing = allVariants.filter(v => !coveredSet.has(v));
  const hasTrailingElse = branches.some(b => b.trailingElse !== null);

  if (missing.length === 0) {
    return {
      chainHead,
      branches,
      enumName: enumType.name,
      variantTagsInOrder: variantTags,
      cellName,
      shape: "exhaustive",
    };
  } else if (hasTrailingElse) {
    return null;
  } else {
    return {
      chainHead,
      branches,
      enumName: enumType.name,
      variantTagsInOrder: variantTags,
      cellName,
      shape: "near-miss",
      missing,
    };
  }
}

/**
 * Walk a file's nodes looking for state-decls (top-level and nested in
 * logic blocks). Returns a Map<cellName, typeAnnotation> for cells with
 * a `:T` type annotation. The cell key is the bare name (no `@` prefix).
 *
 * @param {object} file — typed FileAST
 * @returns {Map<string, string>}
 */
function collectCellTypeAnnotations(file) {
  const map = new Map();
  const seen = new WeakSet();

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (node.kind === "state-decl" && typeof node.name === "string" && typeof node.typeAnnotation === "string") {
      map.set(node.name, node.typeAnnotation);
      // Recurse into compound children (each is itself a state-decl with own typeAnnotation)
      if (Array.isArray(node.children)) {
        for (const c of node.children) visit(c);
      }
      return;
    }

    for (const key of ["nodes", "body", "consequent", "alternate", "children",
      "components", "stateDecls", "typeDecls", "imports", "exports", "items", "arms"]) {
      const v = node[key];
      if (Array.isArray(v)) {
        for (const child of v) visit(child);
      }
    }
  }

  const root = file.ast ?? file;
  if (Array.isArray(root.nodes)) for (const n of root.nodes) visit(n);
  if (Array.isArray(root.components)) for (const c of root.components) visit(c);
  // Also try direct stateDecls if present
  if (Array.isArray(file.stateDecls)) for (const s of file.stateDecls) visit(s);
  if (Array.isArray(root.stateDecls)) for (const s of root.stateDecls) visit(s);

  return map;
}

/**
 * Recursive AST walker that finds every TOP-LEVEL if-stmt and gathers its
 * else-if chain into an ordered list of branches. Nested if-stmts inside
 * branch bodies are walked recursively so they get their own analysis.
 *
 * @param {object} file — FileAST
 * @param {(head: object, branches: BranchInfo[]) => void} visitor
 */
function walkFileForIfChains(file, visitor) {
  const seen = new WeakSet();

  function visitNode(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (node.kind === "if-stmt") {
      // Gather the chain. Mark the inner else-if-stmt nodes as seen so the
      // generic recursion below does not re-visit them as their own chains.
      const branches = collectChainBranches(node);
      for (const b of branches) {
        if (b.ifNode !== node) seen.add(b.ifNode);
      }
      visitor(node, branches);
      // Walk INTO each branch body for nested chains
      for (const b of branches) {
        if (Array.isArray(b.consequent)) {
          for (const child of b.consequent) visitNode(child);
        }
      }
      // Walk into trailing-else body too
      const lastBranch = branches[branches.length - 1];
      if (lastBranch && lastBranch.trailingElse && Array.isArray(lastBranch.trailingElse)) {
        for (const child of lastBranch.trailingElse) visitNode(child);
      }
      return;
    }

    // Recurse into known structural fields
    for (const key of ["nodes", "consequent", "alternate", "body", "children", "arms",
      "componentBody", "expressions", "items"]) {
      const v = node[key];
      if (Array.isArray(v)) {
        for (const child of v) visitNode(child);
      }
    }
    // Components / function-decls have body arrays inside parameters etc; recurse
    if (Array.isArray(node.components)) {
      for (const c of node.components) visitNode(c);
    }
  }

  // The typed-AST file shape exposes `ast` (the FileAST) at top-level.
  // ast.nodes is the canonical entry to walk. Older code paths may also
  // expose `nodes`/`components` directly; check both.
  const root = file.ast ?? file;
  if (root && Array.isArray(root.nodes)) {
    for (const n of root.nodes) visitNode(n);
  }
  if (root && Array.isArray(root.components)) {
    for (const c of root.components) visitNode(c);
  }
}

/**
 * @typedef {{
 *   condExpr: object | null,   // the binary `is` expression, or null for trailing else
 *   consequent: object[],
 *   ifNode: object,            // the IfStmtNode this branch came from (for span/line)
 *   trailingElse: object[]|null  // populated only on the final virtual branch when a bare else exists
 * }} BranchInfo
 */

/**
 * Walk an if-stmt chain (else-if encoded as nested if-stmt in alternate)
 * and produce an ordered branch list.
 *
 * @param {object} head — the top IfStmtNode
 * @returns {BranchInfo[]}
 */
function collectChainBranches(head) {
  const branches = [];
  let cur = head;
  while (cur && cur.kind === "if-stmt") {
    branches.push({
      condExpr: cur.condExpr ?? null,
      consequent: Array.isArray(cur.consequent) ? cur.consequent : [],
      ifNode: cur,
      trailingElse: null,
    });

    const alt = cur.alternate;
    if (Array.isArray(alt) && alt.length === 1 && alt[0] && alt[0].kind === "if-stmt") {
      cur = alt[0];
    } else if (Array.isArray(alt) && alt.length > 0) {
      // Bare trailing else: attach to the LAST collected branch
      branches[branches.length - 1].trailingElse = alt;
      break;
    } else {
      break;
    }
  }
  return branches;
}

/**
 * Classify a chain and produce a diagnostic if it qualifies. Returns null for
 * chains the lint does not fire on (most chains).
 *
 * @param {object} chainHead — the top IfStmtNode
 * @param {BranchInfo[]} branches
 * @param {Map<string, object>} stateTypeRegistry
 * @returns {LintDiagnostic | null}
 */
function analyseChain(chainHead, branches, typeRegistry, cellTypeByName) {
  if (branches.length < 2) return null;  // 1-branch chains aren't worth promoting

  // Phase 1: identify the leading-cell ident. Must be a uniform `binary op=is`
  // shape across all branches that have a condExpr. If any branch has compound
  // condition (logical-and/or, unary-not, ternary, etc.) we either skip or
  // emit a compound-condition advisory (for the case where the SHAPE looks
  // promotable but conditions are mixed-compound).
  let cellIdent = null;
  let cellName = null;
  let hasCompound = false;
  let hasMixedDiscriminator = false;
  let hasNonIsForm = false;
  const variantTags = [];

  for (const b of branches) {
    const ce = b.condExpr;
    if (!ce) continue;  // skip trailing-else; handled separately

    if (isCompoundCondition(ce)) {
      hasCompound = true;
      continue;
    }

    const match = matchIsVariantPredicate(ce);
    if (!match) {
      hasNonIsForm = true;
      continue;
    }

    if (cellName == null) {
      cellName = match.cellName;
      cellIdent = match.idLeft;  // may be null for escape-hatch path
    } else if (cellName !== match.cellName) {
      hasMixedDiscriminator = true;
    }
    if (match.variantTag) variantTags.push(match.variantTag);
  }

  // No structured `is` predicates found in the entire chain → not our concern.
  if (variantTags.length === 0) return null;

  // Compound-condition advisory: chain HAS `is`-form branches but ALSO has
  // compound branches mixed in. §56.4 — emit info, do not auto-promote.
  if (hasCompound) {
    return makeCompoundDiag(chainHead);
  }

  // Mixed-discriminator: chain has `is`-form branches but on different cells.
  // §56.2 #3 — does NOT fire I-MATCH-PROMOTABLE.
  if (hasMixedDiscriminator) return null;

  // Non-is forms (e.g., `if (x > 5)` mixed with `is`-form): not a clean
  // promotable site. Don't fire.
  if (hasNonIsForm) return null;

  // Resolve cell type. Try B3's `_resolvedStateCell` stamp first; fall back
  // to the file-scoped cell-name → typeAnnotation map.
  const enumType = resolveEnumTypeForCell(cellIdent, cellName, typeRegistry, cellTypeByName);
  if (!enumType) return null;  // cell is not enum-typed; not our concern

  // Compute coverage.
  const allVariants = (enumType.variants ?? []).map(v => v.name);
  const allSet = new Set(allVariants);
  const coveredSet = new Set(variantTags);
  const missing = allVariants.filter(v => !coveredSet.has(v));
  const hasTrailingElse = branches.some(b => b.trailingElse !== null);

  if (missing.length === 0) {
    return makeExhaustiveDiag(chainHead, enumType.name, allVariants, cellName);
  } else if (hasTrailingElse) {
    // Chain with bare-else covering remaining variants. CLI cannot promote
    // mechanically (the else body would need to be split per missing variant
    // OR remain as a wildcard arm). Don't fire — user has handled it.
    return null;
  } else {
    return makeNearMissDiag(chainHead, enumType.name, allVariants, missing, cellName);
  }
}

/**
 * True if expr is a variant-tag-check predicate over a state cell.
 *
 * Recognized predicate forms (S66 — restored full predicate matrix after
 * narrowing-error reversal):
 *   - `@cell is .Variant`     → binary op="is"  right=ident(.X)
 *   - `@cell == .Variant`     → binary op="=="  right=ident(.X)
 *   - `@cell.is(.Variant)`    → call shape (escape-hatch fallback for now)
 *
 * Both `is` and `==` are accepted as variant-tag checks because they are
 * structurally equivalent in scrml — both ask "does this enum value have
 * variant tag X?". The dev's choice of operator reflects style; the lint
 * (and rewrite) treats them as the same predicate shape.
 *
 * Handles two AST representations:
 *   1. Structured `binary op=is|==` (the canonical post-S66-preprocessor path)
 *   2. `escape-hatch` with `raw` text matching the canonical pattern
 *      (block-form parser may emit escape-hatch in some contexts)
 *
 * Returns null if not a match; otherwise `{ cellName, variantTag, idLeft }`
 * (cellName includes the `@` prefix; variantTag has no leading `.`).
 */
function matchIsVariantPredicate(expr) {
  if (!expr) return null;

  // Path 1: structured binary node — `is` OR `==` over leading-dot ident RHS
  if (expr.kind === "binary" && (expr.op === "is" || expr.op === "==") &&
      expr.left && expr.left.kind === "ident" &&
      expr.right && expr.right.kind === "ident" &&
      typeof expr.right.name === "string" && expr.right.name.startsWith(".")) {
    return { cellName: expr.left.name, variantTag: expr.right.name.slice(1), idLeft: expr.left };
  }

  // Path 2: escape-hatch with raw text. Accept both `is` and `==` operator
  // tokens. (Post-S66 preprocessor fix the structured path covers most cases,
  // but block-form-parsed conditions can still arrive as escape-hatch.)
  if (expr.kind === "escape-hatch" && typeof expr.raw === "string") {
    // Normalize spacing — parser may emit "( @phase is . Idle )"
    const normalized = expr.raw.replace(/\s+/g, " ").replace(/\.\s+/g, ".").trim();
    // Strip outer parens (one level) for matching
    const inner = normalized.startsWith("(") && normalized.endsWith(")")
      ? normalized.slice(1, -1).trim()
      : normalized;
    // Pattern: `@cell (is|==) .Variant`. Bare cell name (no @) accepted for
    // expression contexts; the cell-type lookup will fail if unsupported.
    const m = /^(@?[A-Za-z_$][A-Za-z0-9_$.]*)\s+(is|==)\s+\.([A-Z][A-Za-z0-9_]*)$/.exec(inner);
    if (m) {
      return { cellName: m[1], variantTag: m[3], idLeft: null };
    }
  }

  return null;
}

function isBareIsVariant(expr) {
  return matchIsVariantPredicate(expr) !== null;
}

/** True if expr involves a logical operator, negation, or compound shape. */
function isCompoundCondition(expr) {
  if (!expr) return false;
  if (expr.kind === "logical") return true;
  if (expr.kind === "unary" && expr.op === "!") return true;
  // a binary `&&` / `||` could be encoded as `binary` with logical op
  if (expr.kind === "binary" && (expr.op === "&&" || expr.op === "||")) return true;
  if (expr.kind === "ternary") return true;
  // escape-hatch with raw text: detect `||` / `&&` / leading `!` outside
  // string literals. Quick approximation — false positives for these tokens
  // inside strings are vanishingly rare in if-condition position.
  if (expr.kind === "escape-hatch" && typeof expr.raw === "string") {
    const r = expr.raw;
    // Quick token-bounded check (the parser inserts spaces around operators).
    if (/(?<![\w])(\|\||&&)(?![\w])/.test(r)) return true;
    // Leading `!` (unary not). Match `!(` or `! ` or `!@` at start (after optional paren).
    if (/^\s*\(?\s*!\s*[\w@(]/.test(r)) return true;
  }
  return false;
}

function identName(node) {
  return node && node.kind === "ident" ? node.name : null;
}

function stripDotPrefix(name) {
  if (typeof name !== "string") return null;
  return name.startsWith(".") ? name.slice(1) : name;
}

/**
 * Resolve a cell-ident expression to its declared EnumType (if any).
 *
 * Tries two paths in order:
 *   1. B3's `_resolvedStateCell` annotation stamped on the IdentExpr →
 *      record.declNode.typeAnnotation → typeRegistry lookup.
 *   2. Fall back to the file-scoped cell-name → typeAnnotation map
 *      (collected by `collectCellTypeAnnotations`). The cell's `@`-prefix
 *      is stripped before lookup; bare cell names key the map.
 */
function resolveEnumTypeForCell(cellIdent, cellName, typeRegistry, cellTypeByName) {
  let typeName = null;

  // Path 1: B3 stamp
  if (cellIdent) {
    const record = cellIdent._resolvedStateCell;
    if (record && record.declNode && typeof record.declNode.typeAnnotation === "string") {
      typeName = record.declNode.typeAnnotation;
    }
  }

  // Path 2: file-scoped fallback
  if (!typeName && cellTypeByName && typeof cellName === "string") {
    const bare = cellName.startsWith("@") ? cellName.slice(1) : cellName;
    const fromMap = cellTypeByName.get(bare);
    if (typeof fromMap === "string") typeName = fromMap;
  }

  if (!typeName) return null;
  // Strip generic params if present (e.g., "Maybe<T>" → "Maybe").
  const baseName = typeName.split(/[<\s(]/)[0].trim();
  const t = typeRegistry.get(baseName);
  if (!t || t.kind !== "enum") return null;
  return t;
}

// ---------------------------------------------------------------------------
// Diagnostic builders
// ---------------------------------------------------------------------------

function spanLineCol(node) {
  // Prefer condExpr.span on the chain head's first branch; fall back to the
  // node's own span/line/col fields. The IfStmtNode has a BaseNode `span`
  // shape with file/start/end/line/col.
  if (node.span && typeof node.span.line === "number") {
    return { line: node.span.line, column: node.span.col ?? 1 };
  }
  if (typeof node.line === "number") {
    return { line: node.line, column: node.col ?? node.column ?? 1 };
  }
  return { line: 1, column: 1 };
}

function makeExhaustiveDiag(chainHead, enumName, allVariants, cellName) {
  const { line, column } = spanLineCol(chainHead);
  const cellLabel = cellName ?? "<cell>";
  const variantList = allVariants.map(v => `.${v}`).join(", ");
  const message =
    `Line ${line}: I-MATCH-PROMOTABLE — this if-else chain on \`${cellLabel}\` exhaustively ` +
    `covers ${enumName} (${variantList}). Run \`bun scrml promote --match <file>:${line}\` ` +
    `to mechanically lift the chain to a \`<match>\` block. See SPEC §56.`;
  return {
    line,
    column,
    code: "I-MATCH-PROMOTABLE",
    severity: "info",
    shape: "exhaustive",
    enumName,
    cellName: cellLabel,
    missing: [],
    message,
    ghost: `if-else over enum-typed @${cellLabel}: Phase`,
    correction: `<match for=${enumName} on=@${cellLabel}> ... </>`,
  };
}

function makeNearMissDiag(chainHead, enumName, allVariants, missing, cellName) {
  const { line, column } = spanLineCol(chainHead);
  const cellLabel = cellName ?? "<cell>";
  const covered = allVariants.filter(v => !missing.includes(v));
  const coveredList = covered.map(v => `.${v}`).join(", ");
  const missingList = missing.map(v => `.${v}`).join(", ");
  const message =
    `Line ${line}: I-MATCH-PROMOTABLE — this if-else chain on \`${cellLabel}\` covers ` +
    `${enumName} partially (${coveredList}). Missing ${missingList}. Add the missing ` +
    `arm${missing.length > 1 ? "s" : ""}, then run \`bun scrml promote --match <file>:${line}\` ` +
    `to convert. Once promoted, the compiler will catch any future variant-add at the ` +
    `\`<match>\` site automatically. See SPEC §56.`;
  return {
    line,
    column,
    code: "I-MATCH-PROMOTABLE",
    severity: "info",
    shape: "near-miss",
    enumName,
    cellName: cellLabel,
    missing,
    message,
    ghost: `if-else over enum-typed @${cellLabel} (incomplete coverage)`,
    correction: `add ${missingList} arm${missing.length > 1 ? "s" : ""}, then promote to <match>`,
  };
}

function makeCompoundDiag(chainHead) {
  const { line, column } = spanLineCol(chainHead);
  const message =
    `Line ${line}: I-MATCH-PROMOTABLE — this if-else chain has at least one branch with a ` +
    `compound condition (\`||\` / \`&&\` / negation). \`bun scrml promote --match\` cannot ` +
    `auto-promote compound-condition branches. Consider splitting them into separate arms ` +
    `with shared body, or using a guard pattern. See SPEC §56.4.`;
  return {
    line,
    column,
    code: "I-MATCH-PROMOTABLE",
    severity: "info",
    shape: "compound",
    message,
    ghost: `if-else over enum cell with compound branches`,
    correction: `split compound branches before promoting`,
  };
}
