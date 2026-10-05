// schema-differ.d.ts — type declarations for schema-differ.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker (`bun scripts/types-gate.ts`). Bun ignores it at run
// time. Shapes follow the implementation (parseColumns / parseFnDecl /
// parseSharedCorePredicates) and its JSDoc.
//
// PARTIAL BY DESIGN: this declares the exports the TypeScript graph imports,
// not all ~30 exports of the 3.5k-line module (the rest are consumed only by
// JavaScript today). A `.ts` file that imports an undeclared name fails the
// types gate loudly (TS2305) — declare it here, typed from the implementation,
// in the same commit.

/** One §-shared-core column predicate: `{ name, raw, arg }` (`arg` null for bareword `req`). */
export interface SharedCorePredicate {
  name: string;
  raw: string;
  arg: string | null;
}

/** A `< schema>` DSL column (parseColumns). */
export interface SchemaColumnDecl {
  name: string;
  /** The mapped SQL type. */
  type: string;
  /** The source scrml type, lowercased. */
  scrmlType: string;
  primaryKey: boolean;
  notNull: boolean;
  unique: boolean;
  immutable: boolean;
  default: string | null;
  references: { table: string; column: string } | null;
  /** The raw snippet when a `references` clause could not be read; else null. */
  malformedReferences: string | null;
  renameFrom: string | null;
  sharedCorePredicates: SharedCorePredicate[];
}

/** A `< schema>` DSL table (`name { … }` [db-authoritative]). */
export interface SchemaTableDecl {
  name: string;
  columns: SchemaColumnDecl[];
  dbAuthoritative?: true;
}

/** A P2 SECURITY-DEFINER `fn` declaration (parseFnDecl). */
export interface SecdefFnDecl {
  name: string;
  args: Array<{ name: string; type: string }>;
  owner: string;
  /** Defaults to `"void"`. */
  returns: string;
  cap: string | null;
  isSecurityDefiner: boolean;
  body: string;
}

/**
 * Parse a `< schema>` AST node (or its raw body string) into structured table and
 * `fn` declarations. Consumers read `.tables ?? []`.
 */
export declare function parseSchemaBlock(schemaBody: string | { body?: string | null } | null | undefined): {
  tables: SchemaTableDecl[];
  fns: SecdefFnDecl[];
  gluedHeads: Array<{ name: string; kind: "qualified" | "unreadable"; prefix: string; offset: number }>;
  fnBodySpans: Array<{ fnAt: number; start: number; end: number }>;
  tableOffsets: number[];
};

/** CREATE TABLE SQL for a DSL table declaration (SQL-mirror + §39.5.8 shared-core constraints). */
export declare function generateCreateTable(table: SchemaTableDecl, driver?: "sqlite" | "postgres"): string;

/**
 * Harvest every `CREATE TABLE … (…)` in `text` into `out` (lowercased unqualified
 * table name → statement). `overwrite`: a later statement replaces an earlier one.
 */
export declare function harvestCreateTables(text: string, out: Map<string, string>, overwrite: boolean): void;

/** The raw-DDL `< schema>` form as table declarations (name + columns). */
export declare function harvestRawCreateTableDecls(
  text: string,
): Array<{ name: string; columns: Array<{ name: string; type: string; scrmlType: string }> }>;

/** First-wins harvest of the raw-DDL `< schema>` form into `out`. */
export declare function harvestRawCreateTables(text: string, out: Map<string, string>): void;

/** Every table declaration in a `< schema>` body the §14.8.10 tenant floor reads, duplicates included. */
export declare function schemaTableDeclarations(text: string): Array<{
  name: string;
  key: string;
  form: "declarative" | "raw" | "alter";
  offset: number;
  tenant: boolean;
  commented: boolean;
  columns: Array<{ name: string }>;
}>;

/** The bounded principal role the per-request A1 wrapper drops to (S6). */
export declare const DBAUTH_ROLE: "scrml_app";
/** The compiler-managed tenant-isolation policy name (S1). */
export declare const DBAUTH_POLICY: "scrml_tenant_iso";
/** The transaction-scoped GUC carrying the pinned tenant scalar (S2). */
export declare const DBAUTH_TENANT_GUC: "scrml.tenant";
/** The transaction-scoped GUC carrying the principal's capability set as JSON (S4). */
export declare const DBAUTH_CAPS_GUC: "scrml.principal.caps";
