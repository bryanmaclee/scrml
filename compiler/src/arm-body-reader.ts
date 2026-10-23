// ---------------------------------------------------------------------------
// arm-body-reader.ts — S469 (s469-engine-effect-failable, SECURITY): the ONE parse
// of a `<match>` arm body and of an engine state-child `:`-shorthand body that
// codegen lowers from RAW TEXT.
//
// `<match>` block-form arms are lowered by `codegen/emit-match.ts buildMatchArms`
// from a re-parse of each arm's text (`parseMatchArms(armsRaw)` → `entry.bodyRaw`)
// — the native parser for a bare body, an expression parse for a `:`-shorthand
// body — not from the `armBodyChildren` copy the type system walks. An engine
// state-child `:`-shorthand body (`<B rule=.A : expr>`) is lowered the same way
// (`emitEngineBodyRenderForFile`) and was walked by nothing at all. So the copy the
// failable walk stamped (a `match` on a failable result) and the copy emitted were
// different objects: `${ match check(p) { .Denied :> "no"  _ :> "IN" } }` in an
// arm, or in a handler inside one, compared the error object as a plain value and
// a wrong password logged in; `<B : check(p) ? "IN" : "no">` was never checked.
//
// Each body is parsed here ONCE, cached on its owner (the match-block node, the
// state-child entry) under a key; the type system walks the result
// (`checkRawArmBodies`) and codegen lowers THE SAME nodes. Moved verbatim from the
// two codegen sites; behaviour unchanged except that it is shared.
// ---------------------------------------------------------------------------

import { bodyWasWalked } from "./engine-body-reader.ts";

const _cache = new WeakMap<object, Map<string, { raw: string; nodes: any[] }>>();

function cached(owner: object | null | undefined, key: string, raw: string, build: () => any[]): any[] {
  if (!owner || typeof owner !== "object") return build();
  let m = _cache.get(owner);
  if (!m) { m = new Map(); _cache.set(owner, m); }
  const hit = m.get(key);
  if (hit && hit.raw === raw) return hit.nodes;
  const nodes = build();
  m.set(key, { raw, nodes });
  return nodes;
}

function parsers(): {
  nativeParseFile: (filePath: string, src: string) => { ast: any; errors: any[] };
  splitBlocks: (f: string, s: string) => any;
  buildAST: (bs: any) => any;
  attachHandlerStatementListsInTree: (nodes: any[], filePath: string) => void;
  parseExprToNode: (raw: string, filePath: string, offset: number) => any;
  sourceHasMdElement: (s: string) => boolean;
  displayTextLiteralInner: (raw: string) => string | null;
} {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { nativeParseFile } = require("../native-parser/parse-file.js");
  const { splitBlocks } = require("./block-splitter.js");
  const { buildAST, attachHandlerStatementListsInTree } = require("./ast-builder.js");
  const { parseExprToNode } = require("./expression-parser.ts");
  const { sourceHasMdElement } = require("./md-lower.ts");
  const { displayTextLiteralInner } = require("./codegen/emit-match.ts");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { nativeParseFile, splitBlocks, buildAST, attachHandlerStatementListsInTree, parseExprToNode, sourceHasMdElement, displayTextLiteralInner };
}

/**
 * A `:`-shorthand body (`<V : body>`): a markup value (`<p>x</p>`), a §4.18.3 display-text
 * literal (`"Failed: ${why}"`), or a value expression. Returns the body's nodes (empty for an
 * empty body or a parse failure — codegen's long-standing degraded shape).
 *
 * `exprRaw` is the text the value-expression form parses (the match path parses the untrimmed
 * body, the engine path the trimmed one — kept as they were).
 */
export function readShorthandBody(
  owner: object | null | undefined, key: string,
  raw: string, synthLabel: string, filePath: string, span: unknown,
  exprRaw: string = raw,
): any[] {
  const trimmed = (raw || "").trim();
  return cached(owner, key, raw, () => {
    if (trimmed.length === 0) return [];
    const p = parsers();
    try {
      if (/^<[A-Za-z_]/.test(trimmed)) {
        // `<md>` (SPEC §67): the native parser has no `<md>` production — live route.
        const r = p.sourceHasMdElement(trimmed)
          ? p.buildAST(p.splitBlocks(synthLabel, trimmed))
          : p.nativeParseFile(synthLabel, trimmed);
        return Array.isArray(r?.ast?.nodes) ? r.ast.nodes : [];
      }
      const inner = p.displayTextLiteralInner(trimmed);
      if (inner !== null) {
        const r = p.nativeParseFile(synthLabel, inner);
        return Array.isArray(r?.ast?.nodes) ? r.ast.nodes : [];
      }
      const exprNode = p.parseExprToNode(exprRaw, filePath, 0);
      return [{ kind: "logic", body: [{ kind: "bare-expr", exprNode, expr: trimmed, span }], span }];
    } catch {
      return [];
    }
  });
}

/**
 * A `<match>` arm's BARE body (markup). An `<each>`- or `<md>`-bearing body is parsed by the
 * block splitter + AST builder (the each-block transform lives there; `viaTab: true` — codegen
 * re-stamps its each ids); any other by the native parser, with the §5.2.3 handler statement
 * lists attached (the TAB copy carries them) BEFORE the type system walks it, so the statements
 * a handler lowers are the ones walked.
 */
export function readBareArmBody(
  owner: object | null | undefined, key: string, raw: string, synthLabel: string,
): { nodes: any[]; viaTab: boolean } {
  const viaTab = /<\s*each\b/.test(raw) || parsers().sourceHasMdElement(raw);
  const nodes = cached(owner, key, raw, () => {
    const p = parsers();
    try {
      if (viaTab) {
        const r = p.buildAST(p.splitBlocks(synthLabel, raw));
        return Array.isArray(r?.ast?.nodes) ? r.ast.nodes : [];
      }
      const r = p.nativeParseFile(synthLabel, raw);
      if (!Array.isArray(r?.ast?.nodes)) return [];
      p.attachHandlerStatementListsInTree(r.ast.nodes, synthLabel);
      return r.ast.nodes;
    } catch {
      return [];
    }
  });
  return { nodes, viaTab };
}

/** The cache key of a `<match>` arm: its index in `parseMatchArms(armsRaw).arms` and variant. */
export function matchArmKey(index: number, variantName: string): string {
  return `arm:${index}:${variantName}`;
}

/**
 * S469 (hardening) — the WALKED floor for an arm / shorthand body parse: a non-empty parse the
 * type system never walked is refused (E-ERROR-002), never lowered. Returns the nodes to lower.
 */
export function walkedArmBodyOrRefuse(nodes: any[], what: string, anchor: object | null): any[] {
  if (!Array.isArray(nodes) || nodes.length === 0 || bodyWasWalked(nodes)) return nodes;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recordRefusedLowering } = require("./codegen/refused-lowering-errors.ts");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CGError } = require("./codegen/errors.ts");
  recordRefusedLowering(
    new CGError(
      "E-ERROR-002",
      `E-ERROR-002: ${what} reached codegen without being checked for unhandled failable calls ` +
      `(§19.4.3); it is not emitted. This is a compiler defect — please report it.`,
      { file: "", start: 0, end: 0, line: 1, col: 1 },
    ),
    anchor,
  );
  return [];
}
