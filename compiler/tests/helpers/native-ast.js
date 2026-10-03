// native-ast.js — direct access to the native parser's FileAST for tests.
//
// S449 (item 6 = (b)): compiler/native-parser is a FROZEN component of impl#1.
// impl#1 calls `nativeParseFile` in production to re-parse component bodies
// (component-expander.ts), `^{}` meta emit (meta-eval.ts) and `<match>` arm
// markup (emit-match.ts / emit-engine.ts), then hands the resulting nodes to
// the same downstream stages as the default parser's. The full-pipeline
// `--parser=scrml-native` flag is retired, so tests that guarded a native
// bridge fix by compiling a whole file under that flag now assert on the
// native tree directly — the function impl#1 actually calls.
//
// `liveAst` gives the default parser's tree for the same source, for tests
// that use it as a fixed-input oracle (the two trees are expected to agree on
// the field under test, not everywhere).

import { nativeParseFile } from "../../native-parser/parse-file.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

/** `nativeParseFile` result `{ ast, errors }` for `source`. */
export function nativeAst(source, filePath = "/native-ast/case.scrml") {
  return nativeParseFile(filePath, source);
}

/** The default parser's `{ ast, errors }` for `source`. */
export function liveAst(source, filePath = "/native-ast/case.scrml") {
  return buildAST(splitBlocks(filePath, source));
}

/** Every object under `root` (depth-first, pre-order) for which `pred` holds. */
export function findNodes(root, pred, out = []) {
  if (Array.isArray(root)) {
    for (const n of root) findNodes(n, pred, out);
    return out;
  }
  if (root && typeof root === "object") {
    if (pred(root)) out.push(root);
    for (const v of Object.values(root)) findNodes(v, pred, out);
  }
  return out;
}

/** A JSON-clean copy of `value` without `span` / `id` fields (positions differ between parsers). */
export function withoutPositions(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => (k === "span" || k === "id" ? undefined : v)));
}

/** Error-severity diagnostics only. */
export function errorsOf(result) {
  return (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
}
