// attribute-registry.d.ts — type declarations for attribute-registry.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker. Bun ignores it at run time. Keep it in step with
// attribute-registry.js.

/** One attribute's schema entry (the return shape of attribute-registry.js `attrSpec`). */
export interface AttrSpec {
  supportsInterpolation: boolean;
  allowedValues: string[] | null;
  allowSubvalueColon: boolean;
}

/** A scrml-special element's attribute schema. */
export interface ElementAttrSchema {
  allowedAttrs: Map<string, AttrSpec>;
}

/** Look up an element's attribute schema by tag name (case-insensitive); `null` if unregistered. */
export declare function getElementAttrSchema(tagName: unknown): ElementAttrSchema | null;

/** All registered scrml-special element names (lowercased). */
export declare function getRegisteredElementNames(): string[];

/** Is this an open-ended attribute form (`bind:` / `on:` / `class:` / `data-` / `onclick` …) VP-1 skips? */
export declare function isOpenAttrPrefix(attrName: unknown): boolean;
