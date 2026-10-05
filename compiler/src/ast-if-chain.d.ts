// ast-if-chain.d.ts — type declarations for ast-if-chain.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker (`bun scripts/types-gate.ts`). Bun ignores it at run
// time. If ast-if-chain.js gains or changes an export, update this file in the
// same commit — the types gate goes red on a TS consumer that imports an
// undeclared name.

import type { ASTNode } from "./types/ast.ts";

/**
 * Child markup nodes of a §17.1.1 `if-chain` node, in source order: every
 * branch's `element`, then the `elseBranch`. Any non-`if-chain` input (including
 * a falsy or non-object value) yields `[]`. Never contains a falsy entry.
 */
export declare function ifChainChildNodes(node: unknown): ASTNode[];
