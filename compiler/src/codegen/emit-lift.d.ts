// emit-lift.d.ts — type declarations for emit-lift.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker (`bun scripts/types-gate.ts`). Bun ignores it at run
// time. If emit-lift.js gains or changes an export, update this file in the same
// commit — the types gate goes red on a TS consumer that imports an undeclared
// name.

import type { EachEngineCtx } from "./emit-each.ts";
import type { CGError } from "./errors.ts";
import type { FunctionBodyRegistry } from "./reactive-deps.ts";

// ---------------------------------------------------------------------------
// Module-level emission stacks (codegen is synchronous + single-threaded)
// ---------------------------------------------------------------------------

/** A Tier-0 keyed-reconcile context (the return of `buildLiftReconcileCtx`). */
export interface LiftReconcileCtx {
  wrapperVar: string;
  keyVar: string;
  iterVar: string;
  /** Item-derived local decls replayed per item (see scanItemDerivedLocals). */
  itemDerivedLocals: Array<{ bindNames: string[]; node: object; init: string }>;
  /** The single markup root of the per-item body, when there is exactly one. */
  soleRootMarkupNode: object | null;
  itemRootMarkupNodes: object[];
}

export declare function pushLiftReconcileCtx(ctx: LiftReconcileCtx): void;
export declare function popLiftReconcileCtx(): void;

export declare function pushLiftScopeNames(set: Set<string> | null | undefined): void;
export declare function popLiftScopeNames(): void;
/** A fresh block-scoped copy of the innermost pushed scope (empty when none). */
export declare function liftScopeNamesCopy(): Set<string>;

export declare function pushLiftNonKeyed(): void;
export declare function popLiftNonKeyed(): void;
export declare function liftNonKeyedActive(): boolean;

/** Restore every emit-lift module stack / counter to its initial value (head of every runCG). */
export declare function resetLiftModuleState(): void;

/** Build a reconcile ctx (call BEFORE pushing it — the item-local scan reads the ancestor stack). */
export declare function buildLiftReconcileCtx(
  wrapperVar: string,
  keyVar: string,
  iterVar: string,
  body: unknown,
): LiftReconcileCtx;

export declare function pushLiftRequestIds(set: Set<string> | null | undefined): void;
export declare function popLiftRequestIds(): void;

// ---------------------------------------------------------------------------
// Handler wraps / engine carrier
// ---------------------------------------------------------------------------

export declare function maybeWrapLiftPerItemHandler(handlerBody: string): string;
/** The wrapper body, or `null` when no wrap applies. */
export declare function maybeWrapLiftCallableHandler(arrowText: string): string | null;

/** The engine-context extras `buildLiftEngineCtxFromExtras` re-packs (all optional). */
export interface LiftEngineExtras {
  engineVarNames?: Set<string> | null;
  engineBindings?: Map<string, unknown> | null;
  enginesWithHooks?: Set<string> | null;
  enginesWithOnTimeout?: Set<string> | null;
  enginesWithIdleWatchdog?: Set<string> | null;
  enginesWithInternalRules?: Set<string> | null;
  enginesWithHistory?: Set<string> | null;
  enginesWithMessageArms?: Set<string> | null;
  engineMessageVariants?: Map<string, Set<string>> | null;
}

/** The EachEngineCtx carrier, or `null` when the file declares no engine. */
export declare function buildLiftEngineCtxFromExtras(
  extras: LiftEngineExtras | null | undefined,
): EachEngineCtx | null;

/** Parse lift content text; pushes `{ type, value }` items into `parts`. */
export declare function parseLiftContentParts(
  text: string,
  parts: Array<{ type: "text" | "expr"; value: string }>,
): void;

// ---------------------------------------------------------------------------
// Markup → DOM-building JS
// ---------------------------------------------------------------------------

/** Emit createElement lines for a markup node into `lines`; returns the root element's variable name. */
export declare function emitCreateElementFromMarkup(
  node: object,
  lines: string[],
  engineCtx?: EachEngineCtx | null,
  scopeVar?: string | null,
): string;

/** A markup VALUE as an IIFE expression that returns the built node. */
export declare function emitMarkupValueExpr(
  node: object,
  engineCtx?: EachEngineCtx | null,
  scopeVar?: string | null,
): string;

export declare function hasFragmentedLiftBody(body: unknown[] | null | undefined): boolean;

// ---------------------------------------------------------------------------
// for-loop binder analysis
// ---------------------------------------------------------------------------

export declare function forLiftTreeHasImpureLoop(
  forNode: unknown,
  outerDeclared: Set<string> | null | undefined,
): boolean;
export declare function forLoopWritesItsBinder(forNode: unknown): boolean;
/** A COPY of `names` with the loop's binder(s) added when the body writes them; else `names` itself. */
export declare function withLoopBinders<T extends Set<string> | null | undefined>(
  names: T,
  forNode: unknown,
): T | Set<string>;
export declare function loopBodyDeclaredNames<T extends Set<string> | null | undefined>(
  names: T,
  forNode: unknown,
  bodyIsRender: boolean,
): T | Set<string>;
export declare function forHeadKeyword(forNode: unknown): "let" | "const";
/** Push E-CODEGEN-INVALID-LOGIC for a rendering loop that writes a non-`let` binder. */
export declare function checkLoopBinderWrites(fileAST: unknown, errors: CGError[]): void;
/** The names a for-of head binds (`[]` for a C-style head). */
export declare function forBinderNames(forNode: unknown): string[];

// ---------------------------------------------------------------------------
// Lift emission entry points
// ---------------------------------------------------------------------------

/** Options the lift emitters read (the rest of a spread caller opts object passes through). */
export interface LiftEmitOpts {
  /** When set, emit `containerVar.appendChild(factory())` instead of `_scrml_lift(factory)`. */
  containerVar?: string;
  continueBehavior?: "continue" | "return";
  declaredNames?: Set<string> | null;
  directReturn?: boolean;
  engineCtx?: EachEngineCtx | null;
  scopeVar?: string | null;
  fnBodyRegistry?: FunctionBodyRegistry | null;
}

export declare function emitForStmtWithContainer(forNode: object, containerElVar: string, opts?: LiftEmitOpts): string;
export declare function emitIfStmtWithContainer(ifNode: object, containerElVar: string, opts?: LiftEmitOpts): string;
export declare function emitConsolidatedLift(body: unknown[], opts?: LiftEmitOpts): string;
export declare function emitLiftExpr(node: object, opts?: LiftEmitOpts): string;
