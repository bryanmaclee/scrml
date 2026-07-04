/**
 * Gauntlet Phase 3 — equality / null-token diagnostics.
 *
 * This module implements post-TAB checks for equality (==, !=) misuses that
 * the existing pipeline otherwise accepts silently. Each check is directly
 * traceable to a repro fixture in
 *   samples/compilation-tests/gauntlet-s19-phase3-operators/
 *
 * Checks emitted here (see docs/changes/gauntlet-s19/phase3-bugs.md):
 *
 *   E-EQ-004     — `===` / `!==` used as equality. scrml equality is always
 *                  strict, so the operator is just `==` / `!=`. (§45.7)
 *                  Note: ast-builder's `collectExpr` already emits this for
 *                  let/const initializers, but `collectIfCondition` does not;
 *                  this walker catches if-condition occurrences from the
 *                  parsed exprNode tree.
 *
 *   E-EQ-002     — `== not` / `!= not`. Use `is not` / `is not not`. (§45)
 *                  Covers if-condition paths that bypass collectExpr.
 *
 *   E-SYNTAX-042 — `null` / `undefined` keywords used in scrml source.
 *                  Per §42.7, these are not scrml tokens — use `not` for absence.
 *                  Three sub-shapes covered:
 *                    a) Equality operand:
 *                       `x == null`, `x != null`, `x == undefined`, `x != undefined`
 *                       — emitted by `checkEqNode`.
 *                    b) Bare value-position literal (W3.1, F-NULL-003):
 *                       `@x = null`, `return null`, `[null, ...]`, `{ k: null }`,
 *                       `cond ? a : null`, etc. — emitted by `checkBareNullLit`
 *                       via `forEachLitNull` walker. Excludes direct operands
 *                       of binary == / != / === / !== (those go through (a)).
 *                    c) String-template-interp inside attribute values (W3.2,
 *                       F-NULL-004): `<div class="${@x == null ? a : b}">`.
 *                       The `${...}` segments are extracted from string-literal
 *                       attribute values and re-parsed; (a) + (b) checks then
 *                       run on the resulting exprNode.
 *
 *   E-EQ-001     — `==` / `!=` between two primitive types that are not the
 *                  same (e.g. `number == bool`). scrml never coerces across
 *                  types. (§45)
 *
 *   W-EQ-001     — `==` / `!=` where either operand is declared `asIs`.
 *                  asIs defers semantics to the runtime; equality is
 *                  reference equality and rarely what the author wants. (§45)
 *
 *   E-EQ-003     — `==` / `!=` on a struct type whose shape contains a
 *                  function-typed field. Functions cannot be compared
 *                  structurally. (§45)
 *
 * All errors use the same shape as TAB/TS diagnostics — `{ code, message,
 * span, severity }` — and are collected into the compiler's global error
 * stream by the api.js driver.
 */

// W3.2 (string-template-interp null sweep): re-parse `${...}` segments inside
// markup attribute string-literal values so equality / bare-null detectors
// see the embedded expressions. Closes F-NULL-004.
import { parseExprToNode } from "./expression-parser.ts";

// ---------------------------------------------------------------------------
// Error class — matches TABError shape for uniform collection in api.js
// ---------------------------------------------------------------------------

class GauntletPhase3Error {
  constructor(code, message, span, severity = "error") {
    this.code = code;
    this.message = message;
    this.span = span;
    this.severity = severity;
    // Lift span fields into top-level error properties so the CLI formatter
    // (compiler/src/commands/compile.js formatError) can render line/col
    // and source context. Other stages (TAB, TS, RI) attach errors with
    // line/column at the top level — we mirror that shape here. Closes
    // F-NULL-002 diagnostic-quality sub-bug ("no line number") — W3.
    if (span && typeof span === "object") {
      this.filePath = span.file;
      this.file = span.file;
      this.line = span.line;
      this.column = span.col;
    }
  }
}

// ---------------------------------------------------------------------------
// Type-decl scan — find struct types whose shape contains any `fn` / arrow
// field, which forbids equality under E-EQ-003.
// ---------------------------------------------------------------------------

/**
 * Crude detector: looks for function-shaped fields in a struct body.
 * Matches patterns like `fieldName: () => ...`, `fieldName: (x) => ...`,
 * `fieldName: fn(...)`. Does not parse the type expression — a precise
 * implementation would use the type registry, but this catches the cases
 * in the Phase 3 fixtures without risking false positives on common shapes
 * (number, string, bool, arrays, unions of primitives).
 *
 * @param {string} raw — raw type body, e.g. "{ name: string, onFire: () => void }"
 * @returns {boolean}
 */
function structBodyHasFunctionField(raw) {
  if (typeof raw !== "string" || !raw) return false;
  // `(...) =>` arrow type annotation
  if (/:\s*\([^)]*\)\s*=>/.test(raw)) return true;
  // `: fn(` explicit fn type
  if (/:\s*fn\s*\(/.test(raw)) return true;
  return false;
}

/**
 * Collect struct type names that contain a function-typed field.
 * @param {object} ast — FileAST
 * @returns {Set<string>}
 */
function collectStructTypesWithFnField(ast) {
  const out = new Set();
  if (!ast) return out;
  const topNodes = ast.nodes ?? [];
  const typeDecls = ast.typeDecls ?? [];

  function visitTypeDecl(td) {
    if (!td) return;
    if (td.typeKind !== "struct") return;
    if (structBodyHasFunctionField(td.raw ?? "")) {
      out.add(td.name);
    }
  }

  for (const td of typeDecls) visitTypeDecl(td);

  // type-decls can also live as inline children of ${ } logic blocks.
  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "type-decl") visitTypeDecl(n);
      if (Array.isArray(n.body))     walk(n.body);
      if (Array.isArray(n.children)) walk(n.children);
      if (Array.isArray(n.then))     walk(n.then);
      if (Array.isArray(n.else))     walk(n.else);
      if (Array.isArray(n.consequent)) walk(n.consequent);
      if (Array.isArray(n.alternate)) walk(n.alternate);
    }
  }
  walk(topNodes);
  return out;
}

// ---------------------------------------------------------------------------
// Binding collection — name → { primType, typeAnnotation } for simple inits.
// ---------------------------------------------------------------------------

/**
 * Classify a parsed expression node's primitive type for cross-type equality
 * detection. Only confident categories are returned; unknown returns null.
 *
 * @param {object|null|undefined} node — ExprNode
 * @returns {"number"|"string"|"bool"|"not"|"null"|"undefined"|null}
 */
function litKindOf(node) {
  if (!node || typeof node !== "object") return null;
  if (node.kind === "lit") {
    if (node.litType === "number") return "number";
    if (node.litType === "string") return "string";
    if (node.litType === "template") return "string";
    if (node.litType === "bool") return "bool";
    // §42 absence canon (S90 M-7C-D-12 Track 1): all parser sites manufacture
    // `litType: "not"`. User-source forbidden tokens are discriminated via the
    // `raw` field — `raw: "null"` / `raw: "undefined"` signal forbidden source
    // tokens; everything else is canonical scrml absence.
    if (node.litType === "not") {
      if (node.raw === "null") return "null";
      if (node.raw === "undefined") return "undefined";
      return "not";
    }
    // Legacy: pre-S90 AST snapshots may still carry the deprecated litType
    // variants directly. Recognize them so a stale AST still fires E-SYNTAX-042.
    if (node.litType === "null") return "null";
    if (node.litType === "undefined") return "undefined";
    return null;
  }
  // Negative numeric literal: unary `-` on numeric lit
  if (node.kind === "unary" && node.op === "-" && node.argument?.kind === "lit" && node.argument.litType === "number") {
    return "number";
  }
  return null;
}

/**
 * Parse a scrml type annotation string and classify the declared type.
 * Returns null for anything we don't recognize.
 *
 * @param {string|null|undefined} annot
 * @param {Set<string>} structFnSet — struct names known to contain fn fields
 * @returns {{primType: "number"|"string"|"bool"|"asIs"|null, typeName: string|null, containsFnStruct: boolean}|null}
 */
function classifyTypeAnnotation(annot, structFnSet) {
  if (!annot || typeof annot !== "string") return null;
  // Strip leading `:` and whitespace if still attached.
  let s = annot.trim();
  if (s.startsWith(":")) s = s.slice(1).trim();
  // Drop predicate suffix `Type(pred)` — we only care about the head.
  const parenIdx = s.indexOf("(");
  const head = (parenIdx === -1 ? s : s.slice(0, parenIdx)).trim();
  // Union head like `string | not` → pick the first member.
  const firstMember = head.split("|")[0].trim();
  const name = firstMember;
  if (name === "number") return { primType: "number", typeName: "number", containsFnStruct: false };
  if (name === "string") return { primType: "string", typeName: "string", containsFnStruct: false };
  if (name === "bool")   return { primType: "bool",   typeName: "bool",   containsFnStruct: false };
  if (name === "asIs")   return { primType: "asIs",   typeName: "asIs",   containsFnStruct: false };
  if (structFnSet.has(name)) {
    return { primType: null, typeName: name, containsFnStruct: true };
  }
  if (name && /^[A-Z]/.test(name)) {
    return { primType: null, typeName: name, containsFnStruct: false };
  }
  return null;
}

/**
 * Walk the AST top-to-bottom collecting a name → binding-info map. Bindings
 * from inner scopes are NOT correctly scoped out — this walker is an
 * intentional best-effort: the Phase 3 fixtures all declare equality operands
 * at the same scope (same ${ } block) as the `if (...)` they appear in, so a
 * flat map is sufficient. A nested shadowing case will resolve to the
 * innermost seen binding (last-write-wins).
 *
 * Recognized binding shapes:
 *   let / const / state-decl with literal init   → inferred from init
 *   let / const / state-decl with typeAnnotation → classified from annot
 *
 * @param {object} ast
 * @param {Set<string>} structFnSet
 * @returns {Map<string, { primType: string|null, typeName: string|null, containsFnStruct: boolean, annot: string|null }>}
 */
function collectBindings(ast, structFnSet) {
  const out = new Map();
  if (!ast) return out;
  const topNodes = ast.nodes ?? [];

  function recordBinding(node) {
    if (!node || !node.name) return;
    const name = node.name;
    const annot = typeof node.typeAnnotation === "string" ? node.typeAnnotation : null;
    let primType = null;
    let typeName = null;
    let containsFnStruct = false;

    // Prefer declared type annotation.
    const classified = classifyTypeAnnotation(annot, structFnSet);
    if (classified) {
      primType = classified.primType;
      typeName = classified.typeName;
      containsFnStruct = classified.containsFnStruct;
    }

    // Fall back to inference from literal initializer.
    if (!primType && !typeName) {
      const litKind = litKindOf(node.initExpr);
      if (litKind === "number" || litKind === "string" || litKind === "bool") {
        primType = litKind;
        typeName = litKind;
      }
    }

    out.set(name, { primType, typeName, containsFnStruct, annot });
  }

  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "let-decl" || n.kind === "const-decl" || n.kind === "state-decl") {
        recordBinding(n);
      }
      if (Array.isArray(n.body))       walk(n.body);
      if (Array.isArray(n.children))   walk(n.children);
      if (Array.isArray(n.then))       walk(n.then);
      if (Array.isArray(n.else))       walk(n.else);
      if (Array.isArray(n.consequent)) walk(n.consequent);
      if (Array.isArray(n.alternate)) walk(n.alternate);
      if (Array.isArray(n.arms)) {
        for (const arm of n.arms) if (arm && Array.isArray(arm.body)) walk(arm.body);
      }
    }
  }
  walk(topNodes);
  return out;
}

// ---------------------------------------------------------------------------
// Expression-node walk — finds binary ==/!=/===/!== anywhere in the tree.
// ---------------------------------------------------------------------------

/**
 * Metadata fields we never recurse into. These are leaves or non-ExprNode
 * metadata: walking them produces no equality binaries.
 *
 * NOTE: "value" is NOT in this set unconditionally. On `kind: "lit"` the
 * `value` field is a primitive scalar (skipped via inline check below).
 * On other kinds (e.g. `kind: "prop"` for object-literal entries, or
 * `kind: "assign"` for assignment RHS) `value` IS an ExprNode child and
 * MUST be recursed into.
 */
const SKIP_KEYS = new Set([
  "span",          // source location metadata
  "kind",          // discriminant
  "op",            // operator string
  "name",          // identifier name string
  "raw",           // literal raw text
  "litType",       // literal subtype string
  "nativeKind",    // escape-hatch sub-kind discriminator string
  "fnStyle",       // lambda style discriminator
  "isAsync",       // lambda async flag
  "computed",      // member/index flag
  "optional",      // member/index optional flag
]);

/**
 * Generic ExprNode descent: visits every object/array-valued field except
 * metadata, calling `onEq` on every binary `==`/`!=`/`===`/`!==` node.
 *
 * Replaces the prior hard-coded JS-AST key list (`test`, `arguments`,
 * `properties`), which missed scrml-AST keys (`condition`, `args`, `props`,
 * `subject`, `rawArms`, `body`, `index`). The hard-coded list silently
 * skipped these subtrees, allowing `== null` / `!= null` to slip past the
 * detector when nested inside ternary conditions, call arguments, object
 * properties, etc.
 *
 * Closes the walker-incompleteness half of F-NULL-001 + F-NULL-002 paired
 * fix (W3 — 2026-04-30; diagnosis at
 * docs/changes/f-null-001-002/diagnosis.md).
 *
 * @param {object|null|undefined} node
 * @param {(eqNode: object) => void} onEq — called for every binary eq node
 */
function forEachEqualityBinary(node, onEq) {
  if (!node || typeof node !== "object") return;
  if (node.kind === "binary" &&
      (node.op === "==" || node.op === "!=" || node.op === "===" || node.op === "!==")) {
    onEq(node);
  }
  for (const [key, child] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue;
    // On `kind: "lit"`, the `value` field is a primitive scalar — never
    // an ExprNode. Skip to prevent walking primitive numbers/strings/etc.
    if (key === "value" && node.kind === "lit") continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object") forEachEqualityBinary(item, onEq);
      }
    } else if (child && typeof child === "object") {
      forEachEqualityBinary(child, onEq);
    }
  }
}

/**
 * W3.1 — bare-null-literal walker.
 *
 * Visits every absence-literal whose source-token provenance is the forbidden
 * scrml keyword `null` or `undefined` (and `ident{ name: "null" | "undefined" }`)
 * reachable from the given expression tree, calling `onLitNull` for each.
 * Closes F-NULL-003: bare `null` / `undefined` literals in value position
 * (declaration init, return expression, object property value, array element,
 * ternary branch, etc.) silently passed the existing detector, which only
 * inspected operands of binary `==`/`!=` comparisons.
 *
 * §42 absence canon (S90 M-7C-D-12 Track 1): after Track 1 migration, all
 * parser sites manufacture `lit{ litType: "not" }`. User-source forbidden
 * tokens are discriminated by the `raw` field:
 *   - `litType: "not", raw: "null"`      → user wrote `null`     → fire E-SYNTAX-042
 *   - `litType: "not", raw: "undefined"` → user wrote `undefined`→ fire E-SYNTAX-042
 *   - `litType: "not", raw: "not"` / `""` → canonical scrml absence or empty
 *     placeholder; do NOT fire
 *
 * Legacy fall-through: pre-S90 AST snapshots / external builders may still
 * carry `litType: "null"` / `litType: "undefined"` directly. Those are still
 * recognized as forbidden so a stale AST does not silently bypass the lint.
 *
 * To avoid double-emit with `checkEqNode`, this walker SKIPS lit-null /
 * ident-null nodes that are direct `left` or `right` operands of a binary
 * `==` / `!=` / `===` / `!==`. Those positions are already handled by
 * `checkEqNode` via E-SYNTAX-042 (sub-shape (a) in the file header).
 *
 * Subtree-suppression rationale: the suppression applies only to the DIRECT
 * lit-null operand of a binary-eq. A null buried deeper in the eq's operand
 * (e.g. `f(null) == 1`) is still a value-position use of `null` and IS
 * flagged here.
 *
 * Per §42.7 (W3 amendment): the rejection of `null` / `undefined` SHALL
 * apply uniformly across **every** scrml source position. W3 closed the
 * comparison-operand path; W3.1 closes the bare value-position path.
 *
 * @param {object|null|undefined} node
 * @param {(litNode: object) => void} onLitNull — called for every bare null/undef
 */
function isForbiddenAbsenceLit(node) {
  if (!node || node.kind !== "lit") return false;
  // S90 canon: `litType:"not"` + raw discriminates source-token provenance.
  if (node.litType === "not" && (node.raw === "null" || node.raw === "undefined")) {
    return true;
  }
  // Legacy: pre-S90 deprecated litType variants.
  if (node.litType === "null" || node.litType === "undefined") return true;
  return false;
}

function forEachLitNull(node, onLitNull) {
  if (!node || typeof node !== "object") return;

  // Bare `null` / `undefined` source-token literal — fire and stop (it's a leaf).
  if (node.kind === "lit" && isForbiddenAbsenceLit(node)) {
    onLitNull(node);
    return;
  }

  // Bare `null` / `undefined` keyword surfaced as an identifier (the JS
  // parser may emit either; mirrors classifyOperand's treatment).
  if (node.kind === "ident" && (node.name === "null" || node.name === "undefined")) {
    onLitNull(node);
    return;
  }

  // Detect binary equality / is-* operators at this node — their direct
  // lit-null / ident-null operands are SYNTHETIC (the expression-parser
  // generates `right: lit{ litType:"not", raw:"not" }` for `is not` /
  // `is some` / `is not not`) OR are handled by checkEqNode (for == / != /
  // === / !==). Either way, they must be skipped here to avoid spurious
  // E-SYNTAX-042 emits on perfectly valid scrml source like `if (x is not)`.
  const isEq = node.kind === "binary" &&
    (node.op === "==" || node.op === "!=" || node.op === "===" || node.op === "!==");
  const isAbsenceOp = node.kind === "binary" &&
    (node.op === "is-not" || node.op === "is-some" || node.op === "is-not-not");

  for (const [key, child] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue;
    // On `kind: "lit"`, the `value` field is a primitive scalar (skip).
    if (key === "value" && node.kind === "lit") continue;

    // Skip direct lit-null / ident-null operands of binary-eq or absence
    // ops. (eq: handled by checkEqNode. absence: synthesized by parser —
    // not real source tokens.)
    const isDirectSuppressedOperand =
      (isEq || isAbsenceOp) && (key === "left" || key === "right") &&
      child && typeof child === "object" &&
      ((child.kind === "lit" && isForbiddenAbsenceLit(child)) ||
       (child.kind === "ident" && (child.name === "null" || child.name === "undefined")));
    if (isDirectSuppressedOperand) continue;

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object") forEachLitNull(item, onLitNull);
      }
    } else if (child && typeof child === "object") {
      forEachLitNull(child, onLitNull);
    }
  }
}


// ---------------------------------------------------------------------------
// Operand classification — resolve an operand to its type info.
// ---------------------------------------------------------------------------

function classifyOperand(operand, bindings) {
  if (!operand || typeof operand !== "object") return { kind: "unknown" };
  const lit = litKindOf(operand);
  if (lit) return { kind: "lit", primType: lit };
  if (operand.kind === "ident" && typeof operand.name === "string") {
    // Bare `undefined` / `null` keywords may surface as plain idents from the
    // underlying JS parser — `undefined` is an ordinary identifier in JS, and
    // some expression-parser paths emit `null` as an ident as well. Treat
    // these as the forbidden `== null` / `== undefined` operand regardless
    // of whether the name is also bound locally (the bare-keyword case is
    // overwhelmingly more common and matches §45 semantics).
    if (operand.name === "undefined") return { kind: "lit", primType: "undefined" };
    if (operand.name === "null")      return { kind: "lit", primType: "null" };
    const info = bindings.get(operand.name);
    if (info) return { kind: "binding", name: operand.name, info };
  }
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Span helpers — pick the best span available on an exprNode.
// ---------------------------------------------------------------------------

function spanFromExprNode(exprNode, fallback, filePath) {
  // ExprNode spans (from expression-parser.ts) carry source-relative
  // start/end (via baseOffset threading) but NOT source-relative
  // line/col — see spanFromEstree(), which hard-codes line:1, col:1
  // because the parser does not recompute line/col from the offset.
  // The AST-node fallback (e.g. if-stmt.span) DOES carry correct
  // source line/col. Therefore we prefer ExprNode for start/end (most
  // precise byte range) and fallback for line/col (correct line).
  // Closes F-NULL-002 diagnostic-quality sub-bug — W3.
  const sp = exprNode?.span;
  if (sp && typeof sp === "object") {
    return {
      file: filePath,
      start: sp.start ?? 0,
      end: sp.end ?? 0,
      line: fallback?.line ?? sp.line ?? 1,
      col: fallback?.col ?? sp.col ?? 1,
    };
  }
  if (fallback) {
    return {
      file: filePath,
      start: fallback.start ?? 0,
      end: fallback.end ?? 0,
      line: fallback.line ?? 1,
      col: fallback.col ?? 1,
    };
  }
  return { file: filePath, start: 0, end: 0, line: 1, col: 1 };
}

// ---------------------------------------------------------------------------
// The eq-node check — dispatches E-EQ-001 / E-EQ-003 / E-EQ-004 /
// E-SYNTAX-042 / E-EQ-002 / W-EQ-001.
// ---------------------------------------------------------------------------

function checkEqNode(eqNode, bindings, structFnSet, fallbackSpan, filePath, errors) {
  const span = spanFromExprNode(eqNode, fallbackSpan, filePath);

  // E-EQ-004 — strict-equality operator used.
  if (eqNode.op === "===" || eqNode.op === "!==") {
    const replacement = eqNode.op === "===" ? "==" : "!=";
    errors.push(new GauntletPhase3Error(
      "E-EQ-004",
      `E-EQ-004: \`${eqNode.op}\` is not a valid scrml operator. Use \`${replacement}\` instead — scrml equality is always strict, so \`${replacement}\` is the only form (§45.7).`,
      span,
    ));
    return;
  }

  // From here op is `==` or `!=`. Classify each operand.
  const left = classifyOperand(eqNode.left, bindings);
  const right = classifyOperand(eqNode.right, bindings);

  // E-SYNTAX-042 — `== null` / `== undefined`.
  const isNullLit = (o) => o.kind === "lit" && (o.primType === "null" || o.primType === "undefined");
  if (isNullLit(left) || isNullLit(right)) {
    const tok = (left.kind === "lit" && (left.primType === "null" || left.primType === "undefined"))
      ? left.primType
      : right.primType;
    const suggestion = eqNode.op === "=="
      ? `\`x is not\` (checks for absence) or \`x is some\` for presence`
      : `\`x is some\` (checks for presence) or \`x is not\` for absence`;
    errors.push(new GauntletPhase3Error(
      "E-SYNTAX-042",
      `E-SYNTAX-042: \`${tok}\` is not a scrml token — scrml uses \`not\` for absence (§42). ` +
      `Replace \`${eqNode.op} ${tok}\` with ${suggestion}.`,
      span,
    ));
    return;
  }

  // E-EQ-002 — `== not` / `!= not`.
  const isNotLit = (o) => o.kind === "lit" && o.primType === "not";
  if (isNotLit(left) || isNotLit(right)) {
    const replacement = eqNode.op === "==" ? "is not" : "is not not";
    errors.push(new GauntletPhase3Error(
      "E-EQ-002",
      `E-EQ-002: \`${eqNode.op} not\` is not valid — use \`${replacement}\` to check for absence (§45).`,
      span,
    ));
    return;
  }

  // Gather operand type names.
  const typeOfSide = (o) => {
    if (o.kind === "lit") return { primType: o.primType, typeName: o.primType, containsFnStruct: false, annot: null };
    if (o.kind === "binding") return o.info;
    return null;
  };
  const lt = typeOfSide(left);
  const rt = typeOfSide(right);

  // E-EQ-003 — either operand is a struct type with a function-typed field.
  if ((lt && lt.containsFnStruct) || (rt && rt.containsFnStruct)) {
    const which = lt && lt.containsFnStruct ? lt.typeName : rt.typeName;
    errors.push(new GauntletPhase3Error(
      "E-EQ-003",
      `E-EQ-003: cannot compare values of struct type \`${which}\` with \`${eqNode.op}\` — the struct contains a function-typed field, and functions have no structural equality (§45). ` +
      `Compare the specific data fields instead (e.g. \`a.name ${eqNode.op} b.name\`).`,
      span,
    ));
    return;
  }

  // W-EQ-001 — either operand is declared `asIs`.
  if ((lt && lt.primType === "asIs") || (rt && rt.primType === "asIs")) {
    const whichSide = lt && lt.primType === "asIs" ? (left.name ?? "left") : (right.name ?? "right");
    errors.push(new GauntletPhase3Error(
      "W-EQ-001",
      `W-EQ-001: \`${eqNode.op}\` on \`asIs\` value \`${whichSide}\` falls back to reference equality, which is rarely what authors want (§45). ` +
      `Narrow \`${whichSide}\` to a concrete type before comparing, or compare specific fields.`,
      span,
      "warning",
    ));
    return;
  }

  // E-EQ-001 — cross-type primitive equality.
  if (lt && rt && lt.primType && rt.primType &&
      lt.primType !== rt.primType &&
      lt.primType !== "asIs" && rt.primType !== "asIs") {
    errors.push(new GauntletPhase3Error(
      "E-EQ-001",
      `E-EQ-001: cannot compare \`${lt.primType}\` with \`${rt.primType}\` using \`${eqNode.op}\` — scrml never coerces across types (§45). ` +
      `Convert one side explicitly (e.g. \`toString\`, \`toNumber\`) before comparing.`,
      span,
    ));
    return;
  }
}

// ---------------------------------------------------------------------------
// W3.1 bare-null-literal emit + W3.2 string-template-interp segment extractor
// ---------------------------------------------------------------------------

/**
 * Emit E-SYNTAX-042 for a bare lit-null / lit-undefined / ident-null /
 * ident-undefined node detected in value position.
 *
 * Closes F-NULL-003 (W3.1): `null` / `undefined` SHALL NOT appear in any
 * scrml source position, not just as comparison operands (§42.7).
 *
 * @param {object} litNode
 * @param {object} fallbackSpan — AST-node span (preferred for line/col)
 * @param {string} filePath
 * @param {Array} errors
 */
function checkBareNullLit(litNode, fallbackSpan, filePath, errors) {
  // Identify the offending token text — `null`, `undefined`, etc.
  // §42 absence canon (S90 M-7C-D-12 Track 1): post-migration the lit node
  // is `litType:"not"` with the user-source token preserved in `raw`. The
  // legacy `litType:"null"`/"undefined"` paths are also recognized for
  // pre-S90 AST snapshots.
  let tok;
  if (litNode.kind === "lit") {
    if (litNode.litType === "not") {
      tok = litNode.raw === "undefined" ? "undefined" : "null";
    } else {
      tok = litNode.litType === "null" ? "null" : "undefined";
    }
  } else {
    tok = litNode.name; // ident
  }
  const span = spanFromExprNode(litNode, fallbackSpan, filePath);
  errors.push(new GauntletPhase3Error(
    "E-SYNTAX-042",
    `E-SYNTAX-042: \`${tok}\` is not a scrml token — scrml uses \`not\` for absence (§42.7). ` +
    `In value position, replace \`${tok}\` with \`not\` (e.g. \`@x = not\`, \`return not\`, ` +
    `\`{ field: not }\`). For absence checks, use \`x is not\` / \`x is some\`.`,
    span,
  ));
}

/**
 * Extract `${...}` interpolation segments from a string-literal attribute
 * value's raw text. Returns an array of `{ text, offset }` where `text` is
 * the inner expression source (without the surrounding `${` and `}`) and
 * `offset` is the start byte offset of `text` within `raw` (so callers can
 * translate parse errors back to source positions if desired).
 *
 * Closes the parsing half of F-NULL-004 (W3.2). The tactical option (b) per
 * dispatch brief: localized re-parse of `${...}` segments inside attribute
 * string-literal values, rather than upgrading the AST to a structured
 * alternation of literal-text + expression nodes.
 *
 * Brace nesting: handles nested braces inside an interpolation (e.g.
 * `${{ a: 1 }}`) by counting `{` / `}` after the opening `${`. Strings and
 * template literals inside the interpolation are NOT specially handled —
 * the segments fall back to the parser, which will correctly parse them.
 *
 * @param {string} raw — full string-literal value (no surrounding quotes)
 * @returns {Array<{ text: string, offset: number }>}
 */
function extractTemplateInterpSegments(raw) {
  if (typeof raw !== "string" || !raw) return [];
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const idx = raw.indexOf("${", i);
    if (idx === -1) break;
    // Skip escaped `\${` — uncommon in attributes but defensive.
    if (idx > 0 && raw[idx - 1] === "\\") {
      i = idx + 2;
      continue;
    }
    const inner = idx + 2;
    let depth = 1;
    let j = inner;
    while (j < raw.length && depth > 0) {
      const ch = raw[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) break; // unbalanced — give up
    out.push({ text: raw.slice(inner, j), offset: inner });
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// AST walker — dispatch checkEqNode + checkBareNullLit over every expression
// site in the AST. Also re-parses `${...}` segments inside string-literal
// attribute values (W3.2) so embedded expressions are not silently bypassed.
// ---------------------------------------------------------------------------

function walkAst(ast, bindings, structFnSet, filePath, errors) {
  if (!ast) return;
  const topNodes = ast.nodes ?? [];

  function inspectExprNode(exprNode, fallbackSpan) {
    if (!exprNode) return;
    // Sub-shape (a): equality-operand null + cross-type / asIs / fn-struct.
    forEachEqualityBinary(exprNode, (eqNode) => {
      checkEqNode(eqNode, bindings, structFnSet, fallbackSpan, filePath, errors);
    });
    // Sub-shape (b): bare-null literal in value position (W3.1, F-NULL-003).
    forEachLitNull(exprNode, (litNode) => {
      checkBareNullLit(litNode, fallbackSpan, filePath, errors);
    });
  }

  /**
   * Inspect every exprNode embedded in a markup-node attribute. Closes the
   * F-NULL-002 silent-pass gap (W3) and the F-NULL-004 string-literal gap
   * (W3.2): previously markup `attrs[*].value.exprNode` was never visited,
   * AND attributes with `kind: "string-literal"` containing `${...}`
   * interpolation were preserved as raw text and never parsed.
   *
   * Per ast-builder.js, an attribute `value` may carry expressions in:
   *   - `kind: "expr"`         — `if=(...)` or `={...}` brace expressions
   *                              → `value.exprNode`
   *   - `kind: "variable-ref"` — `if=@var` or `data=foo`
   *                              → `value.exprNode`
   *   - `kind: "call-ref"`     — `onclick=fn(arg, arg)`
   *                              → `value.argExprNodes` (array)
   *   - `kind: "props-block"`  — `props={...}` typed props (no exprNode)
   *   - `kind: "string-literal"` — `class="literal text ${expr} more"`
   *                                W3.2: extract `${...}` segments and
   *                                re-parse each as an expression for the
   *                                detector to inspect.
   *   - `kind: "absent"`       — boolean attr presence (no exprNode)
   *
   * The attribute's own `value.span` is preferred as the fallback for the
   * emit, so the diagnostic points at the attribute position.
   */
  function inspectAttrs(attrs) {
    if (!Array.isArray(attrs)) return;
    for (const attr of attrs) {
      if (!attr || typeof attr !== "object") continue;
      const v = attr.value;
      if (!v || typeof v !== "object") continue;
      const fb = v.span ?? attr.span;
      if (v.exprNode) inspectExprNode(v.exprNode, fb);
      if (Array.isArray(v.argExprNodes)) {
        for (const arg of v.argExprNodes) inspectExprNode(arg, fb);
      }
      // W3.2 — string-literal attribute value with `${...}` interpolations.
      // The raw value text is preserved unparsed; extract each segment,
      // parse it as an expression, and inspect via the same path as a
      // proper exprNode would take. Closes F-NULL-004.
      if (v.kind === "string-literal" && typeof v.value === "string") {
        const segments = extractTemplateInterpSegments(v.value);
        for (const seg of segments) {
          if (!seg.text || !seg.text.trim()) continue;
          let segExpr = null;
          try {
            // parseExprToNode wants an offset; we don't have a precise
            // source offset for the segment (the v.span covers the whole
            // attribute value), so pass 0 and let the diagnostic fall back
            // to the attribute span via spanFromExprNode's fallback path.
            segExpr = parseExprToNode(seg.text, filePath, 0);
          } catch (_e) {
            // Parse failure — silently skip; downstream stages will report
            // any real syntax error in the attribute. We just want to look
            // for null tokens here.
            continue;
          }
          if (segExpr) inspectExprNode(segExpr, fb);
        }
      }
    }
  }

  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;

      // Every AST node shape that carries a parsed expression tree.
      if (n.condExpr)  inspectExprNode(n.condExpr,  n.span);
      if (n.initExpr)  inspectExprNode(n.initExpr,  n.span);
      if (n.exprNode)  inspectExprNode(n.exprNode,  n.span);
      if (n.argsExpr)  inspectExprNode(n.argsExpr,  n.span);

      // F-NULL-002 fix: markup-node attributes carry their own exprNodes.
      if (Array.isArray(n.attrs)) inspectAttrs(n.attrs);

      // Recurse into every child container we might see.
      if (Array.isArray(n.body))       walk(n.body);
      if (Array.isArray(n.children))   walk(n.children);
      if (Array.isArray(n.defChildren)) walk(n.defChildren);
      if (Array.isArray(n.then))       walk(n.then);
      if (Array.isArray(n.else))       walk(n.else);
      if (Array.isArray(n.consequent)) walk(n.consequent);
      if (Array.isArray(n.alternate))  walk(n.alternate);
      if (Array.isArray(n.arms)) {
        for (const arm of n.arms) if (arm && Array.isArray(arm.body)) walk(arm.body);
      }
    }
  }
  walk(topNodes);
}


// ---------------------------------------------------------------------------
// E-EQ-005 (§45.5, S237) — `is <value>` reject harvest.
// ---------------------------------------------------------------------------

/**
 * Harvest every ExprNode stamped `_isValueRhsOnIs` by the expression-parser
 * lowering choke-point (parseExprToNode → preprocessForAcorn → rewriteIsPredicates)
 * and emit E-EQ-005 once per stamped node. A value RHS on `is` — a literal
 * (`x is 0`, `x is "text"`, `x is true`) or a value-expression (`x is @other`) —
 * is NOT valid: `is` is the absence / variant-discrimination keyword
 * (`is not` / `is some` / `is .Variant`), not a value-equality operator
 * (limit-the-primitive, §14.1.1). The mirror of E-EQ-002 (`x == not` → `x is not`).
 * Resolution: use `==` (`x == 0`).
 *
 * Runs at the §45 equality stage (GCP3) — BEFORE dependency-graph (E-DG-002)
 * and codegen (E-CODEGEN-INVALID-LOGIC), so the clean "use `==`" diagnostic replaces
 * the misleading mis-lowering the old silent path produced. A generic structural
 * walk (mirrors type-system.harvestNotPrefixNegation) covers ALL expression
 * positions (if / while / ${} / derived-RHS / && / attr / match arm); a
 * visited-set guards cycles and a span-key set dedups aliased nodes.
 *
 * @param {object} ast — the file AST (tabResult.ast)
 * @param {string} filePath
 * @param {Array} errors
 */
function harvestValueRhsOnIs(ast, filePath, errors) {
  if (!ast) return;
  const seen = new WeakSet();
  const firedSpans = new Set();

  function fire(span) {
    const s = (span && typeof span === "object")
      ? span
      : { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    const key = `${s.file ?? filePath}:${s.start ?? 0}:${s.end ?? 0}`;
    if (firedSpans.has(key)) return;
    firedSpans.add(key);
    errors.push(new GauntletPhase3Error(
      "E-EQ-005",
      "E-EQ-005: `is <value>` is not valid — `is` is the absence / variant keyword " +
      "(`x is not` / `x is some` / `x is .Variant`), not a value-equality operator (§45.5). " +
      "Use `==` for value equality (e.g. `x == 0`). Mirror of E-EQ-002 (`x == not` → `x is not`).",
      { file: filePath, start: s.start ?? 0, end: s.end ?? 0, line: s.line ?? 1, col: s.col ?? 1 },
    ));
  }

  function visit(v) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (seen.has(v)) return;
    seen.add(v);
    if (v._isValueRhsOnIs === true && typeof v.kind === "string") {
      fire(v.span);
    }
    for (const k in v) {
      if (k === "_isValueRhsOnIs") continue;
      visit(v[k]);
    }
  }

  visit(ast.nodes ?? []);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run all Phase 3 equality-diagnostic checks for a single file.
 * Returns a new array of errors to be merged into the compiler's global
 * stream.
 *
 * @param {{ filePath: string, ast: object }} tabResult
 * @returns {GauntletPhase3Error[]}
 */
export function runGauntletPhase3EqChecks(tabResult) {
  const errors = [];
  const filePath = tabResult?.filePath ?? "<unknown>";
  const ast = tabResult?.ast;
  if (!ast) return errors;

  const structFnSet = collectStructTypesWithFnField(ast);
  const bindings = collectBindings(ast, structFnSet);
  walkAst(ast, bindings, structFnSet, filePath, errors);

  // E-EQ-005 (§45.5, S237) — reject `is <value>` (steer to `==`).
  harvestValueRhsOnIs(ast, filePath, errors);

  return errors;
}

export { GauntletPhase3Error };
