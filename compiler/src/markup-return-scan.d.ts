// markup-return-scan.d.ts — type declarations for markup-return-scan.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript (module-resolver.js imports it as plain JS);
// this file only describes its exports to the TypeScript checker. Bun ignores it
// at run time. Every predicate below is fail-safe over ANY input — a non-object
// node simply answers `false` — so node parameters are `unknown`. Keep this file
// in step with markup-return-scan.js.

/** Does this expression node yield a markup value in VALUE position? */
export declare function exprYieldsMarkupValue(node: unknown): boolean;

/** Does this function body `return` a markup value (not descending into nested fns)? */
export declare function fnBodyReturnsMarkup(body: unknown): boolean;

/** Does this function body `return` a call to a fn already in `markupFns`? */
export declare function fnBodyReturnsCallToMarkupFn(
  body: unknown,
  markupFns: ReadonlySet<string> | null | undefined,
): boolean;

/** Interp-site discriminant: could this exprNode evaluate to a DOM node? */
export declare function interpMayYieldNode(
  node: unknown,
  markupFns: ReadonlySet<string> | null | undefined,
): boolean;

/** One per-file import record as read by `resolveImportedMarkupLocalNames`. */
export interface MarkupScanImport {
  absSource?: string | null;
  specifiers?: ReadonlyArray<{ imported?: unknown; local?: unknown } | null | undefined> | null;
}

/**
 * The LOCAL names a file binds to imported exports that return markup, decided
 * by `isMarkupExport(absSource, importedName)`.
 */
export declare function resolveImportedMarkupLocalNames(
  imports: ReadonlyArray<MarkupScanImport | null | undefined> | null | undefined,
  isMarkupExport: (absSource: string, importedName: string) => boolean,
): Set<string>;

/**
 * Names of the file's module-scope `function-decl`s whose body returns markup,
 * directly or transitively, optionally seeded with already-known markup fns.
 */
export declare function collectMarkupReturningFnNames(
  fileAST: unknown,
  seedMarkupFnNames?: Iterable<string> | null,
): Set<string>;
