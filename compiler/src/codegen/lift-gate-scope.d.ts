// Type declarations for lift-gate-scope.js (S469, g-lift-gate-placement-inherits-main-staleness-s469).

/** Read the file's declaration tables (head of client codegen). */
export declare function setLiftGateFileScopes(fileAST: unknown): void;
/** Release them (end of the file's client codegen). */
export declare function resetLiftGateScopes(): void;
/** True when the markup node is built inside a function or lambda body. */
export declare function liftGateInFunction(node: unknown): boolean;
/** The names a lifted condition reads, or null when they cannot be read. */
export declare function liftGateConditionNames(val: unknown, rawText: string): Set<string> | null;
/** The names among `names` that are values of the render at `node` (null in → null out). */
export declare function liftGateRenderNames(names: Set<string> | null, node: unknown): Set<string> | null;
/** True when every cell the condition can read is named in it (no call, no lambda). */
export declare function liftGateCellsAllNamed(val: unknown, rawText: string): boolean;
/** The render names a lifted condition at `node` reads (null = unknown). */
export declare function liftGateReads(val: unknown, rawText: string, node: unknown): Set<string> | null;
/** The source text of a lifted condition attribute value. */
export declare function liftGateAttrRawText(val: unknown): string;
/** True when a rendering for-loop's tree holds a lifted gate its keyed row could not re-read. */
export declare function liftForTreeGatePins(forNode: unknown): boolean;
/** True when a group's top-level function may read one of the group's top-level bindings. */
export declare function liftGroupFnReadsItsBindings(stmts: unknown[]): boolean;
/** liftGroupFnReadsItsBindings for the outermost block a gate's markup node is built in. */
export declare function liftGateBlockFnReadsItsBindings(node: unknown): boolean;
/** True when a loop sits inside a markup element of a row (not among the row's roots). */
export declare function liftLoopInRowElement(loop: unknown, rowLoop: unknown): boolean;
/** True when a nested loop of a keyed row can be re-run on its own as a region. */
export declare function liftRegionSafe(loop: unknown, rowLoop: unknown): boolean;
