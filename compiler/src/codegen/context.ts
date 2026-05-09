/**
 * @module codegen/context
 *
 * CompileContext — a single object that consolidates the ad-hoc parameters
 * threaded through every codegen emitter function.
 *
 * This is a pure refactor: the fields existed before as individual parameters;
 * now they live in one place so new features don't require signature changes.
 */

import { BindingRegistry } from "./binding-registry.ts";
import type { CGError } from "./errors.ts";
import type { EncodingContext } from "./type-encoding.ts";
import type { FileAnalysis } from "./analyze.ts";

// Re-export EncodingContext so callers only need to import from context.ts
export type { EncodingContext };

// ---------------------------------------------------------------------------
// CompileContext — the consolidated parameter bag.
// ---------------------------------------------------------------------------

export interface CompileContext {
  filePath: string;
  fileAST: any;
  routeMap: any;
  depGraph: any;
  protectedFields: Set<string>;
  authMiddleware: any | null;
  middlewareConfig: any | null;
  csrfEnabled: boolean;
  encodingCtx: EncodingContext | null;
  mode: "browser" | "library";
  testMode: boolean;
  dbVar: string;
  workerNames: string[];
  errors: CGError[];
  registry: BindingRegistry;
  derivedNames: Set<string>;
  /**
   * Pre-computed analysis for this file from the CG analysis layer.
   *
   * Populated by analyzeAll() in analyze.ts and threaded through CompileContext
   * so emitters can use cached AST data instead of re-walking the raw AST.
   * Null in tests that construct CompileContext directly without an analysis pass.
   * All emitters MUST use the fallback pattern: `ctx.analysis?.field ?? collectOriginal()`.
   */
  analysis: FileAnalysis | null;
  /**
   * Runtime chunks needed by this file's compiled output.
   *
   * Populated by `detectRuntimeChunks(fileAST)` in emit-client.ts before
   * runtime assembly. The following chunks are always included (pre-populated
   * by the factory):
   *   - 'core'        — _scrml_reactive_get/set/subscribe (used everywhere)
   *   - 'scope'       — _scrml_register_cleanup, _scrml_destroy_scope (used by timers, meta, input)
   *   - 'errors'      — built-in error classes (NetworkError, ValidationError, etc.)
   *   - 'transitions' — CSS animation injection IIFE (small, needed by any conditional display)
   *
   * All other chunks are conditionally added by detectRuntimeChunks() in
   * emit-client.ts based on AST feature usage.
   *
   * Used only in embedded-runtime mode. External mode always emits SCRML_RUNTIME.
   */
  usedRuntimeChunks: Set<string>;
  /**
   * Phase A1c Step C15 — MOD's `exportRegistry` map plumbed into codegen so
   * cross-file engine mount sites (`<engineVarName/>` in importer markup
   * resolving to an engine-category export) can be discriminated at emit time.
   *
   * Shape: `Map<absolutePath, Map<exportName, {kind, category, isComponent}>>`.
   * Mirrors the same map B14 PASS 10.B consumes in `symbol-table.ts:3997-4066`.
   * Null when no MOD result is available (test harnesses that bypass the full
   * pipeline) — codegen's cross-file mount walker short-circuits in that case.
   *
   * SPEC §21.8 + §51.0.D — cross-file engine import via `<EngineName/>`.
   */
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>> | null;
}

// ---------------------------------------------------------------------------
// Factory — creates a CompileContext with sensible defaults.
// Used by tests and internal callers that only need a subset of fields.
// ---------------------------------------------------------------------------

export function makeCompileContext(partial: Partial<CompileContext> & { fileAST: any }): CompileContext {
  return {
    filePath: partial.filePath ?? partial.fileAST?.filePath ?? "",
    fileAST: partial.fileAST,
    routeMap: partial.routeMap ?? { functions: new Map() },
    depGraph: partial.depGraph ?? { nodes: new Map(), edges: [] },
    protectedFields: partial.protectedFields ?? new Set(),
    authMiddleware: partial.authMiddleware ?? null,
    middlewareConfig: partial.middlewareConfig ?? null,
    csrfEnabled: partial.csrfEnabled ?? false,
    encodingCtx: partial.encodingCtx ?? null,
    mode: partial.mode ?? "browser",
    testMode: partial.testMode ?? false,
    dbVar: partial.dbVar ?? "_scrml_sql",
    workerNames: partial.workerNames ?? [],
    errors: partial.errors ?? [],
    registry: partial.registry ?? new BindingRegistry(),
    derivedNames: partial.derivedNames ?? new Set(),
    analysis: partial.analysis ?? null,
    // Always-included runtime chunks. Additional chunks are added by
    // detectRuntimeChunks() in emit-client.ts based on feature usage.
    //
    // 'transitions' is always included because the animation keyframes
    // are needed by any conditional display with transition directives,
    // and detecting transition usage from the AST requires inspecting
    // the binding registry which may not be populated at context creation time.
    usedRuntimeChunks: partial.usedRuntimeChunks ?? new Set(['core', 'scope', 'errors', 'transitions']),
    // C15 — MOD exportRegistry, optional. Defaults to null for tests that
    // bypass the full pipeline; the C15 cross-file mount walker short-circuits
    // when null.
    exportRegistry: partial.exportRegistry ?? null,
  };
}
