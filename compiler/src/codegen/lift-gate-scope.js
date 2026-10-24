// lift-gate-scope.js — which bindings a lifted `if=` / `show=` condition reads (S469,
// g-lift-gate-placement-inherits-main-staleness-s469).
//
// A lifted gate is re-evaluated by RE-RUNNING THE CODE THAT PRODUCED WHAT IT READS, under the
// runtime's read tracking. Its own tracked effect (`_scrml_effect`) is that code only when the
// condition reads nothing the surrounding render computes: cells (tracked at any call depth),
// FILE-LEVEL bindings (a re-render of the block would read their current value too), and the
// binder of the reconciled row it is built in (the effect re-resolves the live item by key).
// Anything else — a body local, a local closure, an item-derived local, an outer row's binder,
// a name declared anywhere in the block the element is built in — is a value of the render, and
// only re-running that render reads it right (emit-lift.js emitLiftGate).
//
// The decision comes from the compiler's own declaration tables, read off the file AST:
//   - FILE-LEVEL names: the top-level declarations of every outermost `${}` block (§7.6),
//     imports, type declarations.
//   - per BLOCK (the outermost `${}` block a gate is built in, or `null` when the gate's node
//     was not found in the file): its own top-level declarations (they are re-initialised by a
//     re-render of that block), and every name declared below a block's top level anywhere in
//     the file (function parameters and bodies, loop binders, nested blocks, lambda parameters,
//     match bindings).
// A condition name is CLOSED only when it is file-level and none of the above. Every other name —
// a JS global (`Math`), a name the walk cannot place — is treated as a render value: inline
// evaluation plus a re-render, or a plain list, or a refusal; each is correct, so over-reporting
// is the safe direction. A condition the walk cannot read (an opaque escape hatch, a block-bodied
// lambda, a `match` expression) answers "unknown", which is handled as reading a render value.

import * as acorn from "acorn";
import { parseExprToNode, templateInterpolationNodesAll } from "../expression-parser.ts";
import { isDestructurePattern } from "./emit-destructure-pattern.ts";

let _fileLevel = new Set();      // names declared at file level
let _nested = new Set();         // names declared below any block's top level, file-wide
let _blockTop = new WeakMap();   // markup node -> Set of its outermost block's top-level names
let _inFn = new WeakSet();       // markup nodes built inside a function / lambda body
let _blockOf = new WeakMap();    // markup node -> its outermost block's body (statement array)
let _active = false;

export function resetLiftGateScopes() {
  _fileLevel = new Set();
  _nested = new Set();
  _blockTop = new WeakMap();
  _inFn = new WeakSet();
  _blockOf = new WeakMap();
  _active = false;
}

function _addBindName(out, name) {
  if (typeof name === "string") {
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    return;
  }
  if (!name || typeof name !== "object") return;
  if (isDestructurePattern(name)) {
    _collectPatternNames(name, out);
    return;
  }
  if (typeof name.name === "string") _addBindName(out, name.name);
  if (Array.isArray(name.boundNames)) for (const b of name.boundNames) _addBindName(out, b);
  if (name.pattern) _collectPatternNames(name.pattern, out);
}

// Every identifier-shaped string in a destructuring pattern (over-collects: keys too).
function _collectPatternNames(p, out) {
  if (!p || typeof p !== "object") return;
  if (Array.isArray(p)) { for (const c of p) _collectPatternNames(c, out); return; }
  for (const k of Object.keys(p)) {
    if (k === "span" || k === "default" || k === "defaultValue") continue;
    const v = p[k];
    if (typeof v === "string") { if (/^[A-Za-z_$][\w$]*$/.test(v)) out.add(v); }
    else if (v && typeof v === "object") _collectPatternNames(v, out);
  }
}

// The identifiers a match arm / error arm pattern text binds: `.Ok(v)`, `.Circle(r, h)`, `::E e`.
function _addPatternTextNames(out, text) {
  if (typeof text !== "string") return;
  for (const m of text.matchAll(/\(([^()]*)\)/g)) {
    for (const t of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) out.add(t[0]);
  }
}

/**
 * Every name declared ANYWHERE inside `root` (over-collecting by construction): declarations,
 * loop binders (C-style counters included), function names and parameters, lambda parameters,
 * match / error-arm bindings, destructured names.
 */
function _collectDeclared(root, out) {
  const seen = new WeakSet();
  const visit = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    switch (n.kind) {
      case "let-decl":
      case "const-decl":
      case "lin-decl":
      case "tilde-decl":
      case "component-def":
        _addBindName(out, n.name);
        if (n.pattern) _collectPatternNames(n.pattern, out);
        break;
      case "for-stmt":
      case "for-expr": {
        _addBindName(out, n.variable);
        const it = typeof n.iterable === "string" ? n.iterable : "";
        const m = it.match(/^\(\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/);
        if (m) out.add(m[1]);
        break;
      }
      case "function-decl":
      case "lambda":
        _addBindName(out, n.name);
        for (const prm of Array.isArray(n.params) ? n.params : []) _addBindName(out, prm);
        break;
      case "match-arm-inline":
        _addPatternTextNames(out, n.test);
        break;
    }
    if (typeof n.binding === "string") _addBindName(out, n.binding);
    if (Array.isArray(n.bindings)) for (const b of n.bindings) _addBindName(out, b);
    if (typeof n.pattern === "string") _addPatternTextNames(out, n.pattern);
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(root);
}

function _topLevelDeclNames(stmt, out) {
  if (!stmt || typeof stmt !== "object") return;
  switch (stmt.kind) {
    case "let-decl":
    case "const-decl":
    case "lin-decl":
    case "tilde-decl":
    case "component-def":
    case "function-decl":
      _addBindName(out, stmt.name);
      if (stmt.pattern) _collectPatternNames(stmt.pattern, out);
      return;
    case "export-decl":
      if (typeof stmt.exportedName === "string") _addBindName(out, stmt.exportedName);
      for (const k of ["decl", "declaration", "node", "inner"]) if (stmt[k]) _topLevelDeclNames(stmt[k], out);
      return;
  }
}

/**
 * Map every markup node under `n` to `topNames` (merging when a node is reached twice), and
 * record the ones built inside a function or lambda body (`inFn`).
 */
function _mapMarkup(n, topNames, seen, inFn, blockBody) {
  if (!n || typeof n !== "object" || seen.has(n)) return;
  seen.add(n);
  if (Array.isArray(n)) { for (const c of n) _mapMarkup(c, topNames, seen, inFn, blockBody); return; }
  if (n.kind === "markup") {
    if (!_blockOf.has(n)) _blockOf.set(n, blockBody);
    const prev = _blockTop.get(n);
    if (prev && prev !== topNames) _blockTop.set(n, new Set([...prev, ...topNames]));
    else _blockTop.set(n, topNames);
    if (inFn) _inFn.add(n);
  }
  const fn = inFn || n.kind === "function-decl" || n.kind === "lambda";
  for (const k of Object.keys(n)) {
    if (k === "span") continue;
    const v = n[k];
    if (v && typeof v === "object") _mapMarkup(v, topNames, seen, fn, blockBody);
  }
}

/** True when the markup node `node` is built inside a function or lambda body. */
export function liftGateInFunction(node) {
  return !!node && _inFn.has(node);
}

/**
 * Read the file's declaration tables. Called once per file at the head of client codegen
 * (emit-client.ts generateClientJs).
 */
export function setLiftGateFileScopes(fileAST) {
  resetLiftGateScopes();
  _active = true;
  const root = fileAST && (fileAST.ast ?? fileAST);
  if (!root) return;
  for (const imp of Array.isArray(root.imports) ? root.imports : []) {
    for (const nm of Array.isArray(imp.names) ? imp.names : []) _addBindName(_fileLevel, nm);
    for (const sp of Array.isArray(imp.specifiers) ? imp.specifiers : []) _addBindName(_fileLevel, sp && sp.local);
  }
  for (const td of Array.isArray(root.typeDecls) ? root.typeDecls : []) _addBindName(_fileLevel, td && td.name);
  // The outermost `${}` blocks: a logic node not inside another logic node.
  const blocks = [];
  const seen = new WeakSet();
  const findBlocks = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) findBlocks(c); return; }
    if (n.kind === "logic") { blocks.push(n); return; }
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = n[k];
      if (v && typeof v === "object") findBlocks(v);
    }
  };
  findBlocks(root.nodes ?? []);
  for (const b of blocks) {
    const body = Array.isArray(b.body) ? b.body : [];
    const top = new Set();
    for (const st of body) _topLevelDeclNames(st, top);
    for (const nm of top) _fileLevel.add(nm);
    // Everything declared below the block's top level: walk each statement's INSIDES (a
    // top-level declaration's own name is the file-level one; its parameters / body are not).
    for (const st of body) {
      if (!st || typeof st !== "object") continue;
      for (const k of Object.keys(st)) {
        if (k === "span" || k === "name") continue;
        const v = st[k];
        if (v && typeof v === "object") _collectDeclared(v, _nested);
      }
      if (st.kind === "for-stmt" || st.kind === "for-expr" || st.kind === "lambda") _collectDeclared(st, _nested);
      if (st.kind === "function-decl") for (const prm of Array.isArray(st.params) ? st.params : []) _addBindName(_nested, prm);
    }
    _mapMarkup(b, top, new WeakSet(), false, body);
  }
}

// ---------------------------------------------------------------------------
// The names a condition reads
// ---------------------------------------------------------------------------

function _acornNames(raw, out) {
  // `@cell` is a cell, never a local: drop the sigil's name entirely.
  const text = String(raw ?? "").replace(/@[A-Za-z_$][\w$]*/g, "0");
  let ast;
  try {
    ast = acorn.parse(text, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  } catch {
    return false;
  }
  const walk = (node, parent, key) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Identifier") {
      const isProp = parent && (
        (parent.type === "MemberExpression" && key === "property" && !parent.computed) ||
        (parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand)
      );
      if (!isProp) out.add(node.name);
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") walk(c, node, k); }
      else if (v && typeof v.type === "string") walk(v, node, k);
    }
  };
  walk(ast, null, null);
  return true;
}

/** Collect the identifier names `node` reads into `out`; false when it cannot be read. */
function _exprNames(node, out) {
  if (node == null) return true;
  if (typeof node !== "object") return true;
  if (Array.isArray(node)) { for (const c of node) if (!_exprNames(c, out)) return false; return true; }
  switch (node.kind) {
    case "ident":
      if (typeof node.name === "string" && node.name && !node.name.startsWith("@")) out.add(node.name);
      return true;
    case "lit":
      if (node.litType === "template") return _exprNames(templateInterpolationNodesAll(node), out);
      return true;
    case "sql-ref":
    case "input-state-ref":
      return true;
    case "escape-hatch":
      return _acornNames(node.raw, out);
    case "array":
      return _exprNames(node.elements, out);
    case "object":
      for (const p of Array.isArray(node.props) ? node.props : []) {
        if (!p) continue;
        if (p.kind === "shorthand") { if (typeof p.name === "string") out.add(p.name); continue; }
        if (p.kind === "spread") { if (!_exprNames(p.argument, out)) return false; continue; }
        if (p.kind === "prop") {
          if (typeof p.key !== "string" && !_exprNames(p.key, out)) return false;
          if (!_exprNames(p.value, out)) return false;
          continue;
        }
        return false;
      }
      return true;
    case "spread":
    case "unary":
      return _exprNames(node.argument, out);
    case "binary":
      return _exprNames(node.left, out) && _exprNames(node.right, out);
    case "assign":
      return _exprNames(node.target, out) && _exprNames(node.value, out);
    case "ternary":
      return _exprNames(node.condition, out) && _exprNames(node.consequent, out) && _exprNames(node.alternate, out);
    case "member":
      return _exprNames(node.object, out);
    case "index":
      return _exprNames(node.object, out) && _exprNames(node.index, out);
    case "call":
    case "new":
      return _exprNames(node.callee, out) && _exprNames(node.args, out);
    case "cast":
      return _exprNames(node.expression, out);
    case "lambda":
      // An expression-bodied lambda: its body's reads count (its parameters are over-reported
      // as reads, the safe direction). A block body is not read here.
      if (node.body && node.body.kind === "expr") {
        for (const prm of Array.isArray(node.params) ? node.params : []) if (prm && prm.defaultValue && !_exprNames(prm.defaultValue, out)) return false;
        return _exprNames(node.body.value, out);
      }
      return false;
    default:
      return false;
  }
}

function _textNames(raw, out) {
  const text = String(raw ?? "").trim();
  if (!text) return true;
  let node;
  try {
    node = parseExprToNode(text, "<lift-gate>", 0);
  } catch {
    return false;
  }
  return _exprNames(node, out);
}

/**
 * The names a lifted condition reads, or `null` when they cannot be read. `val` is the
 * attribute value (markup AST); `rawText` the source text the string-parsed paths have.
 */
export function liftGateConditionNames(val, rawText) {
  const out = new Set();
  let ok;
  if (val && typeof val === "object") {
    switch (val.kind) {
      case "variable-ref": {
        const nm = String(val.name ?? "").trim();
        ok = true;
        if (nm && !nm.startsWith("@")) ok = _textNames(nm, out);
        break;
      }
      case "expr":
        ok = val.exprNode ? _exprNames(val.exprNode, out) : _textNames(val.raw, out);
        break;
      case "call-ref":
        ok = _textNames(val.name, out);
        if (ok && Array.isArray(val.argExprNodes)) ok = _exprNames(val.argExprNodes, out);
        else if (ok) for (const a of Array.isArray(val.args) ? val.args : []) { if (!_textNames(a, out)) { ok = false; break; } }
        break;
      case "string-literal":
        ok = _textNames(rawText, out);
        break;
      default:
        ok = _textNames(rawText, out);
    }
  } else {
    ok = _textNames(rawText, out);
  }
  return ok ? out : null;
}

/**
 * The names among `names` that are NOT closed for a gate built at `node`: anything but a
 * file-level binding that no block re-initialises and nothing below a block's top level declares.
 * `null` in → `null` out (unknown). When the file's tables were never read, every name counts.
 */
export function liftGateRenderNames(names, node) {
  if (names === null) return null;
  const top = node ? _blockTop.get(node) : undefined;
  const out = new Set();
  for (const nm of names) {
    if (!_active || !_fileLevel.has(nm) || _nested.has(nm)) { out.add(nm); continue; }
    // A gate whose node the walk never placed may sit in any block: every block's own
    // top-level names count.
    if (top === undefined || top.has(nm)) out.add(nm);
  }
  return out;
}

/**
 * True when every cell the condition can read is NAMED in it: the condition parses to
 * operators, literals, names and member / index reads only — no call, `new`, lambda, or
 * anything the walk cannot read — so a subscription to each `@cell` it names sees every
 * change it can depend on.
 */
export function liftGateCellsAllNamed(val, rawText) {
  let node = null;
  if (val && typeof val === "object" && val.kind === "expr" && val.exprNode) node = val.exprNode;
  else if (val && typeof val === "object" && val.kind === "call-ref") return false;
  else if (val && typeof val === "object" && val.kind === "variable-ref") return true;
  else {
    const text = String(rawText ?? "").trim();
    if (!text) return true;
    try { node = parseExprToNode(text, "<lift-gate>", 0); } catch { return false; }
  }
  const ok = (n) => {
    if (n == null || typeof n !== "object") return true;
    if (Array.isArray(n)) return n.every(ok);
    switch (n.kind) {
      case "ident": return true;
      case "lit": return n.litType !== "template";
      case "unary": return ok(n.argument);
      case "binary": return ok(n.left) && ok(n.right);
      case "ternary": return ok(n.condition) && ok(n.consequent) && ok(n.alternate);
      case "member": return ok(n.object);
      case "index": return ok(n.object) && ok(n.index);
      case "cast": return ok(n.expression);
      case "array": return ok(n.elements);
      default: return false;
    }
  };
  return ok(node);
}

/** The render names of a lifted condition at `node` (null = unknown). */
export function liftGateReads(val, rawText, node) {
  return liftGateRenderNames(liftGateConditionNames(val, rawText), node);
}

/**
 * True when one of the group's top-level `function` declarations may read one of the group's
 * top-level bindings. Such a function is hoisted to chunk scope (§7.6), so it reads the binding at
 * chunk scope — which only exists while the group runs ONCE there. Making the group a re-render
 * effect moves the binding inside the effect and the call throws (known-gaps M1a). Over-reports: any
 * identifier-shaped token of the function equal to a binding name counts.
 */
export function liftGroupFnReadsItsBindings(stmts) {
  const body = Array.isArray(stmts) ? stmts : [];
  return _blockFnReadsItsBindings(body);
}

/** liftGroupFnReadsItsBindings for the outermost block a gate's markup node is built in. */
export function liftGateBlockFnReadsItsBindings(node) {
  const body = node ? _blockOf.get(node) : undefined;
  return body ? _blockFnReadsItsBindings(body) : false;
}

function _blockFnReadsItsBindings(body) {
  const names = new Set();
  for (const st of body) {
    if (!st || typeof st !== "object" || st.kind === "function-decl") continue;
    _topLevelDeclNames(st, names);
  }
  if (names.size === 0) return false;
  for (const st of body) {
    if (!st || st.kind !== "function-decl") continue;
    const text = JSON.stringify(st, (k, v) => (k === "span" ? undefined : v));
    for (const t of text.matchAll(/[A-Za-z_$][\w$]*/g)) if (names.has(t[0])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Keyed rows: a row is built ONCE per key, so a gate in it may read only what its own
// effect re-reads right — closed names and the row's binder. A loop whose tree holds any
// other gate is lowered as the plain loop, which the enclosing render re-runs.
// ---------------------------------------------------------------------------

/** The source text of a lifted condition attribute value (mirrors emit-lift liftConditionValue). */
export function liftGateAttrRawText(val) {
  if (!val || typeof val !== "object") return typeof val === "string" ? val : "";
  switch (val.kind) {
    case "variable-ref": return String(val.name ?? "");
    case "expr": return String(val.raw ?? "");
    case "call-ref": return `${val.name}(${(val.args || []).join(", ")})`;
    case "string-literal": {
      const q = String(val.value ?? "").trim();
      const interp = /^\$\{([\s\S]*)\}$/.exec(q);
      return interp ? interp[1].trim() : q;
    }
    default: return "";
  }
}

function _blockDeclNames(arr) {
  const out = new Set();
  for (const st of Array.isArray(arr) ? arr : []) _topLevelDeclNames(st, out);
  return out;
}

function _forBinderSet(n) {
  const out = new Set();
  _addBindName(out, n.variable);
  const it = typeof n.iterable === "string" ? n.iterable : "";
  const m = it.match(/^\(\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/);
  if (m) out.add(m[1]);
  return out;
}

/**
 * True when the tree of the rendering `for … lift` loop `forNode` holds a lifted `if=` / `show=`
 * its keyed row could not re-read right: the condition reads a render name other than the
 * binder of the loop whose row it is built in. Such a loop is lowered as the plain loop (the
 * caller holds non-keyed mode for its nested loops), which the enclosing render re-runs.
 *
 * The row a gate is built in is the innermost KEYED loop around it. A nested loop counts as
 * keyed when its iterable names a cell. When that prediction is wrong the gate's emission
 * refuses it (emit-lift.js _emitLiftGate) — it is never left stale.
 */
/** Every identifier a subtree reads or names (over-collecting: binders included). */
function _subtreeNames(root, out) {
  const seen = new WeakSet();
  const visit = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if (n.kind === "ident" && typeof n.name === "string" && !n.name.startsWith("@")) out.add(n.name);
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = n[k];
      if (typeof v === "string" && (k === "raw" || k === "expr" || k === "iterable" || k === "init" || k === "value" || k === "name" || k === "variable")) {
        for (const t of v.replace(/@[A-Za-z_$][\w$]*/g, " ").matchAll(/[A-Za-z_$][\w$]*/g)) out.add(t[0]);
      } else if (v && typeof v === "object") visit(v);
    }
  };
  visit(root);
  return out;
}

/**
 * True when the nested loop `loop`, inside the keyed row of `rowLoop`, can be re-run on its own (a
 * REGION, emit-lift.js emitForStmtWithContainer): everything it reads that the file declares
 * below a block's top level, or that a block re-initialises, is declared inside `loop` itself or is
 * the row's binder (re-resolved live). A value the row's render computes outside the loop would be
 * read late by a re-run, so such a loop is not a region (the row is lowered plain instead).
 */
/**
 * True when `loop` sits inside a markup ELEMENT of `rowLoop`'s row (`lift <div>${ for … }</div>`), not
 * among the row's roots. A region's nodes must live inside one element of the row: the reconciler
 * records a row's ROOT nodes (`_scrml_group` / `_scrml_group_of`, the group head's key and owner
 * scope) when the row is built and moves / removes exactly those, so a region that rebuilt roots would
 * put revoked content back on a reorder (review of b192c63de) and drop the head that carries the key.
 * Structural: decided by the row body's shape, the element ancestry of the loop node.
 */
export function liftLoopInRowElement(loop, rowLoop) {
  let found = null;
  const seen = new WeakSet();
  const visit = (n, inElement) => {
    if (found !== null || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (n === loop) { found = inElement; return; }
    if (Array.isArray(n)) { for (const c of n) visit(c, inElement); return; }
    const el = inElement || (n.kind === "markup" && typeof n.tag === "string" && n.tag !== "");
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v, el);
    }
  };
  visit(Array.isArray(rowLoop && rowLoop.body) ? rowLoop.body : [], false);
  return found === true;
}

export function liftRegionSafe(loop, rowLoop) {
  if (!loop || !rowLoop) return false;
  if (!liftLoopInRowElement(loop, rowLoop)) return false;
  // A `while` body's lift goes to the ambient target, not the region's (g-while-lift-in-reconciled-
  // row-escapes-the-row-s469): no region holds it.
  if (JSON.stringify(loop, (k, v) => (k === "span" ? undefined : v)).includes('"kind":"while-stmt"')) return false;
  const own = new Set();
  _collectDeclared(loop, own);
  for (const b of _forBinderSet(rowLoop)) own.add(b);
  const rowDecl = new Set();
  _collectDeclared(Array.isArray(rowLoop.body) ? rowLoop.body : [], rowDecl);
  const read = _subtreeNames(loop, new Set());
  for (const nm of read) {
    if (own.has(nm)) continue;
    if (rowDecl.has(nm) || _nested.has(nm)) return false;
    if (_fileLevel.has(nm) && !_regionTopOk(nm, loop)) return false;
  }
  return true;
}
function _regionTopOk(nm, loop) {
  // A name a block declares at its top level is file-level unless that block is the one the loop
  // is built in (a re-render of THAT block re-initialises it). Find any markup node of the loop.
  let top;
  const seen = new WeakSet();
  const find = (n) => {
    if (top !== undefined || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) find(c); return; }
    if (n.kind === "markup" && _blockTop.has(n)) { top = _blockTop.get(n); return; }
    for (const k of Object.keys(n)) { if (k !== "span" && n[k] && typeof n[k] === "object") find(n[k]); }
  };
  find(loop);
  return top !== undefined && !top.has(nm);
}

export function liftForTreeGatePins(forNode) {
  let pinned = false;
  const scopes = []; // { names: Set, loop: for-node | null, fn: boolean }
  const resolve = (name) => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].names.has(name)) return i;
    return -1;
  };
  const gate = (val, node) => {
    const reads = liftGateReads(val, liftGateAttrRawText(val), node);
    if (reads === null) { pinned = true; return; }
    if (reads.size === 0) return;
    // A gate in a loop nested DIRECTLY in this row whose reads are all declared inside that loop:
    // that loop is lowered as a re-runnable REGION of the row (it pins itself; liftRegionSafe), so
    // this row stays keyed.
    {
      let li = -1;
      for (let i = scopes.length - 1; i > 0; i--) if (scopes[i].loop) { li = i; break; }
      if (li > 0 && !scopes.slice(1, li).some((s) => s.loop || s.fn) && !scopes.slice(li).some((s) => s.fn) &&
          [...reads].every((nm) => resolve(nm) >= li) &&
          liftForTreeGatePins(scopes[li].loop) && liftRegionSafe(scopes[li].loop, forNode)) return;
    }
    if (reads.size > 1) { pinned = true; return; }
    const [b] = reads;
    const j = resolve(b);
    if (j < 0 || !scopes[j].loop) { pinned = true; return; }
    for (let i = j + 1; i < scopes.length; i++) if (scopes[i].fn) { pinned = true; return; }
    const loop = scopes[j].loop;
    if (loop === forNode) return;
    // A nested loop's binder: the gate is in THAT loop's row only if that loop is keyed. Only a
    // loop whose iterable names a cell is counted (every emitter keys it); one keyed through an
    // enclosing row's item or a function (emit-lift's S288 path) is not — over-pinning is the
    // safe direction (the plain loop is correct, only not keyed).
    const text = typeof loop.iterable === "string" ? loop.iterable : "";
    if (!/@[A-Za-z_$]/.test(text)) pinned = true;
  };
  const visitBlock = (arr) => {
    scopes.push({ names: _blockDeclNames(arr), loop: null, fn: false });
    for (const c of arr) visit(c);
    scopes.pop();
  };
  const visit = (n) => {
    if (pinned || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { visitBlock(n); return; }
    switch (n.kind) {
      case "lift-expr":
        // A lift whose markup reached the AST as TEXT (the tokenized `< li … >` expression form the
        // string-parsed emitter lowers) has no attribute nodes to read: any `if=` / `show=` in it
        // pins the loop (over-pinning is the safe direction).
        if (n.expr && n.expr.kind !== "markup" && /(?:^|[^\w$.-])(?:if|show)\s*=/.test(JSON.stringify(n.expr))) { pinned = true; return; }
        break;
      case "html-fragment":
      case "bare-expr":
        // The fragments of a consolidated lift body (emit-lift.js hasFragmentedLiftBody) — likewise.
        if (/[<>]/.test(JSON.stringify(n)) && /(?:^|[^\w$.-])(?:if|show)\s*=/.test(JSON.stringify(n))) { pinned = true; return; }
        break;
      case "tilde-decl":
        // An attribute token misparsed as a keywordless declaration (`if = …` inside a fragment).
        if (n.name === "if" || n.name === "show") { pinned = true; return; }
        break;
      case "markup":
        for (const a of Array.isArray(n.attrs) ? n.attrs : []) {
          if (a && (a.name === "if" || a.name === "show")) gate(a.value, n);
          if (pinned) return;
        }
        if (Array.isArray(n.children)) visitBlock(n.children);
        if (n.node && typeof n.node === "object") visit(n.node); // a lift-expr's `{ kind: "markup", node }`
        return;
      case "for-stmt":
      case "for-expr":
        scopes.push({ names: _forBinderSet(n), loop: n, fn: false });
        visitBlock(Array.isArray(n.body) ? n.body : []);
        scopes.pop();
        return;
      case "function-decl":
      case "lambda": {
        const ps = new Set();
        for (const prm of Array.isArray(n.params) ? n.params : []) _addBindName(ps, prm);
        scopes.push({ names: ps, loop: null, fn: true });
        for (const k of Object.keys(n)) {
          if (k === "span" || k === "params") continue;
          const v = n[k];
          if (v && typeof v === "object") visit(v);
        }
        scopes.pop();
        return;
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
  };
  scopes.push({ names: _forBinderSet(forNode), loop: forNode, fn: false });
  visitBlock(Array.isArray(forNode.body) ? forNode.body : []);
  return pinned;
}
