// ast-builder.d.ts — type declarations for ast-builder.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker (`bun scripts/types-gate.ts`). Bun ignores it at run
// time.
//
// PARTIAL BY DESIGN: this declares the exports the TypeScript graph imports
// (plus `TABError` / `runTAB`, which those signatures reference), not every
// export of the 23k-line module. `mountBodyExprNode`, `safeParseExprToNodeGlobal`
// and `assertBodyTopCoverage` are consumed only by JavaScript today. A `.ts` file
// that imports an undeclared name fails the types gate loudly (TS2305) — declare
// it here, typed from the implementation, in the same commit.

import type { Block, Token } from "./tokenizer.ts";
import type { FileAST, LogicStatement, Span, TABErrorInfo } from "./types/ast.ts";

/** Tag name → canonical-placement sentence, for the §4.15 misplaced-structural-element diagnostic. */
export declare const STRUCTURAL_ELEMENT_PLACEMENT: Readonly<Record<string, string>>;

/** §65 element names reserved as CSS identifiers (`theme`, `defaults`). */
export declare const RESERVED_CSS_ELEMENT_IDENTIFIERS: Set<string>;

/** A TAB-stage diagnostic. `severity` is set after construction for warnings / infos. */
export declare class TABError extends Error {
  constructor(code: string, message: string, span: Span);
  code: string;
  tabSpan: Span;
  severity?: "error" | "warning" | "info";
}
export default TABError;

/**
 * Parse a token stream into logic statements. `errors` receives TABError entries
 * (the array is pushed to); `counter` is the shared node-id counter.
 */
export declare function parseLogicBody(
  tokens: Token[],
  filePath: string,
  childBlocks: Block[],
  parentBlock: { type: string },
  counter: { next: number },
  errors: Array<TABError | TABErrorInfo>,
  blockContext?: string,
): LogicStatement[];

/**
 * §19.4.3 — the statement view of an event-handler attribute value, for checking
 * only; `null` when there is nothing to check (unparseable, callable or opaque).
 */
export declare function parseHandlerStatementsForCheck(value: unknown, filePath: string): LogicStatement[] | null;

/** Attach handler statement lists to an already-built markup tree (mutates it in place). */
export declare function attachHandlerStatementListsInTree(
  nodes: unknown,
  filePath: string,
  options?: { synthesizeExprNode?: boolean },
): void;

/** Build a FileAST from Block Splitter output. */
export declare function buildAST(
  bsOutput: { filePath: string; blocks: Block[] },
  tokenizerOverrides?: unknown,
): { filePath: string; ast: FileAST; errors: TABError[] };

/** Pipeline-contract alias of `buildAST`. */
export declare function runTAB(input: { filePath: string; blocks: Block[] }): { filePath: string; ast: FileAST; errors: TABError[] };
