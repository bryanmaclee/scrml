// host-import.d.ts — type declarations for host-import.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker (types follow the implementation's JSDoc). Bun ignores
// it at run time. Keep it in step with host-import.js.

export declare const MANIFEST_FILE_NAME: "scrml.toml";
export declare const HOST_IMPORT_VALUES: readonly ["disabled", "self-host-only"];
export declare const SELF_HOST_PATH_PREFIX: "stdlib/compiler/";
export declare const HOST_TAG: "host";

/** The `[capabilities] host-import` value. */
export type HostImportValue = "disabled" | "self-host-only";

/** `realpathSync`, falling back to the resolved path for a file not on disk. */
export declare function realPathOf(p: string): string;

/**
 * The manifest governing `filePath` (nearest `scrml.toml`, bounded by the
 * project's `.git` marker), or `null` when the walk reaches the filesystem root.
 */
export declare function findManifest(
  filePath: string | null | undefined,
): { projectRoot: string; manifestPath: string | null } | null;

/** Parse a manifest's `[capabilities] host-import` entry. */
export declare function parseHostImportEntry(
  manifestPath: string,
): { value: HostImportValue; error: object | null; note: string | null };

/** A file's resolved host-import capability. */
export interface HostImportCapability {
  value: HostImportValue;
  projectRoot: string | null;
  manifestPath: string | null;
  error: object | null;
  note: string | null;
}

export declare function readHostImportCapability(
  filePath: string,
  cache?: Map<string, object> | null,
): HostImportCapability;

export declare function readHostImportCapabilities(
  filePaths: Iterable<string>,
): { byFile: Map<string, HostImportCapability>; errors: object[] };

/** Is `filePath` inside the capability's allow-list? */
export declare function isHostImportPermitted(
  filePath: string,
  cap: HostImportCapability | null | undefined,
): boolean;

/** Validate every `import:host` declaration in one parsed file; returns diagnostics. */
export declare function validateHostImports(
  ast: object,
  filePath: string,
  cap: HostImportCapability | null | undefined,
): object[];

/** A host module's named-export record, read WITHOUT evaluating the module. */
export declare function scanHostModule(absPath: string): {
  ok: boolean;
  parseError: string | null;
  exports: Set<string> | null;
  imports: string[];
  error: string | null;
};
