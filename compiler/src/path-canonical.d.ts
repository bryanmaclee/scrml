// path-canonical.d.ts — type declarations for path-canonical.js (types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker (`bun scripts/types-gate.ts`). Bun ignores it at run
// time. If path-canonical.js gains or changes an export, update this file in the
// same commit.

/**
 * Canonicalize a filesystem path to posix (`/`) separators for use as an
 * INTERNAL key or comparison operand. Folds `\` only when `\` is the host
 * separator (Windows); a non-string input is returned unchanged.
 */
export declare function toPosix<T>(p: T): T;

/** A `Map` whose keys are canonicalized through `toPosix` on get/set/has/delete. */
export declare class PathKeyedMap<V = unknown> extends Map<string, V> {}

/** A `Set` whose values are canonicalized through `toPosix` on add/has/delete. */
export declare class PathKeyedSet extends Set<string> {}
