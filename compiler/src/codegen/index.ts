/**
 * @module codegen/index
 *
 * Entry point for the Code Generator (CG, Stage 8).
 *
 * Orchestrates the three-phase execution model:
 *   1. Analyze — walk ASTs and collect per-file data (analyze.js)
 *   2. Plan   — populate BindingRegistry during HTML emission
 *   3. Emit   — generate HTML, CSS, server JS, and client JS (browser mode)
 *              OR library JS + server JS (library mode)
 *
 * Exports `runCG()` as the sole public entry point, plus `CGError` for
 * error handling by downstream stages.
 *
 * Mode: 'browser' (default) | 'library'
 *   browser: HTML + client IIFE JS + server JS (original behavior, unchanged)
 *   library: ES module exports JS + server JS (for stdlib / self-hosting)
 */

import { scanClassesFromHtml, getAllUsedCSS } from "../tailwind-classes.js";
import { basename } from "path";
import { SCRML_RUNTIME, RUNTIME_FILENAME } from "../runtime-template.js";
import { CGError } from "./errors.ts";
import { resetVarCounter } from "./var-counter.ts";
import { escapeHtmlAttr } from "./utils.ts";
import { generateHtml } from "./emit-html.ts";
import { generateCss } from "./emit-css.ts";
import { generateServerJs } from "./emit-server.ts";
import { setBatchLoopHoists } from "./emit-control-flow.ts";
import { drainMachineCodegenErrors, clearMachineCodegenErrors } from "./emit-machines.ts";
import { generateClientJs } from "./emit-client.js";
import { generateLibraryJs } from "./emit-library.ts";
import { BindingRegistry } from "./binding-registry.ts";
import { analyzeAll } from "./analyze.ts";
import { generateTestJs } from "./emit-test.ts";
import { generateMachineTestJs } from "./emit-machine-property-tests.ts";
import { generateWorkerJs } from "./emit-worker.ts";
import { SourceMapBuilder, appendSourceMappingUrl } from "./source-map.ts";
import { EncodingContext } from "./type-encoding.ts";
import { collectDerivedVarNames } from "./reactive-deps.ts";
import { collectTopLevelLogicStatements } from "./collect.ts";
import type { CompileContext } from "./context.ts";
import { resolveDbDriver } from "./db-driver.ts";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface CgRouteEntry {
  boundary?: string;
}

export interface CgRouteMap {
  functions: Map<string, CgRouteEntry>;
  authMiddleware?: Map<string, CgAuthMiddleware | null>;
}

export interface CgAuthMiddleware {
  csrf?: "auto" | "off";
}

export interface CgDepGraph {
  nodes: Map<string, object>;
  edges: Array<{ from: string; to: string }>;
}

export interface CgProtectAnalysis {
  views?: Map<string, object>;
}

export interface CgInput {
  files: object[];
  routeMap?: CgRouteMap;
  depGraph?: CgDepGraph;
  protectAnalysis?: CgProtectAnalysis;
  sourceMap?: boolean;
  embedRuntime?: boolean;
  mode?: "browser" | "library";
  /** When true, generate bun:test output from ~{} test blocks. */
  testMode?: boolean;
  /**
   * §51.13 — When true, generate auto-property-tests for every non-derived
   * machine declaration. Independent of testMode. Output lands on
   * `CgFileOutput.machineTestJs`.
   */
  emitMachineTests?: boolean;
  /** Enable output name encoding (§47). Default: false. */
  encoding?: boolean | {
    enabled: boolean;
    debug?: boolean;
    /** S79 audit fix A.2 — see `EncodingContext.seqCap` JSDoc. */
    __testOnly_typeEncodingSeqCap?: number;
  };
  /** Stage 7.5 BatchPlan — consumed by emit-server for Tier 1 envelopes. */
  batchPlan?: any;
  /**
   * Batch-planner errors (E-BATCH-001 / W-BATCH-001). CG uses these to
   * suppress envelope emission for handlers with composition errors.
   */
  batchPlannerErrors?: Array<{ code: string; message: string; span?: any }>;
  /**
   * Phase A1c Step C15 — MOD's `exportRegistry` map, optional. When provided,
   * codegen can identify cross-file engine mount sites (`<engineVarName/>` in
   * importer markup whose source export's category is `"engine"`) and emit
   * the §21.8 mount-position marker per SPEC §51.0.D.
   *
   * Shape: `Map<absolutePath, Map<exportName, {kind, category, isComponent}>>`.
   * Identical to the map B14 PASS 10.B consumes (`symbol-table.ts:3997-4066`).
   * Threaded into per-file `CompileContext.exportRegistry`.
   */
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>> | null;
}

export interface CgFileOutput {
  sourceFile: string;
  serverJs?: string | null;
  clientJs?: string | null;
  libraryJs?: string | null;
  html?: string | null;
  css?: string | null;
  /** Generated bun:test JS output from ~{} test blocks (testMode only). */
  testJs?: string | null;
  /** §51.13 generated machine property-test JS (emitMachineTests only). */
  machineTestJs?: string | null;
  /** Worker JS bundles keyed by worker name (§4.12.4). */
  workerBundles?: Map<string, string>;
  clientJsMap?: string;
  serverJsMap?: string;
}

export interface CgOutput {
  outputs: Map<string, CgFileOutput>;
  errors: CGError[];
  runtimeJs?: string | null;
  runtimeFilename?: string;
}

/**
 * Run the Code Generator (CG, Stage 8).
 */
export function runCG(input: CgInput): CgOutput {
  const {
    files,
    routeMap,
    depGraph,
    protectAnalysis,
    embedRuntime = false,
    sourceMap = false,
    mode = "browser",
    testMode = false,
    emitMachineTests = false,
    encoding: encodingInput = false,
    batchPlan = null,
    batchPlannerErrors = [],
    exportRegistry: exportRegistryInput = null,
  } = input;

  // Resolve encoding configuration (§47)
  const encodingOpts = typeof encodingInput === "object"
    ? encodingInput
    : { enabled: encodingInput ?? false };

  resetVarCounter();

  // §51.5.1 (S28 slice 3) — clear the machine-codegen error buffer before
  // this compile. Entries accumulated during emitTransitionGuard are drained
  // into `errors` after the per-file loop finishes.
  clearMachineCodegenErrors();

  const outputs = new Map<string, CgFileOutput>();
  const errors: CGError[] = [];

  // Validate inputs
  if (!files || files.length === 0) {
    return { outputs, errors };
  }

  const safeRouteMap: CgRouteMap = routeMap ?? { functions: new Map() };
  const safeDepGraph: CgDepGraph = depGraph ?? { nodes: new Map(), edges: [] };

  // §8.10 Tier 2 — register LoopHoist map keyed by for-stmt node id so
  // emit-control-flow can rewrite matched loops at emission time.
  if (batchPlan && Array.isArray((batchPlan as any).loopHoists) && (batchPlan as any).loopHoists.length > 0) {
    const map = new Map<string | number, any>();
    for (const h of (batchPlan as any).loopHoists) {
      if (h && h.loopNode != null) map.set(h.loopNode, h);
    }
    setBatchLoopHoists(map);
  } else {
    setBatchLoopHoists(null);
  }

  // Analysis pass: collect all data from AST before emission begins.
  const { fileAnalyses, protectedFields } = analyzeAll({
    files,
    routeMap: safeRouteMap,
    depGraph: safeDepGraph,
    protectAnalysis,
  });

  // Validate dependency graph edges reference known node IDs
  if (safeDepGraph.nodes && safeDepGraph.edges) {
    for (const edge of safeDepGraph.edges) {
      if (!safeDepGraph.nodes.has(edge.from)) {
        errors.push(new CGError(
          "E-CG-003",
          `E-CG-003: Internal: dependency graph references unknown source node '${edge.from}'. This is likely a compiler bug — please report it with your .scrml file.`,
          { file: "", start: 0, end: 0, line: 0, col: 0 },
        ));
      }
      if (!safeDepGraph.nodes.has(edge.to)) {
        errors.push(new CGError(
          "E-CG-003",
          `E-CG-003: Internal: dependency graph references unknown target node '${edge.to}'. This is likely a compiler bug — please report it with your .scrml file.`,
          { file: "", start: 0, end: 0, line: 0, col: 0 },
        ));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Worker extraction pre-pass (§4.12.4): find nested <program name="...">
  // nodes, extract them from parent ASTs, and compile as separate bundles.
  // ---------------------------------------------------------------------------
  const workerBundlesPerFile = new Map<string, Map<string, string>>();

  for (const fileAST of files) {
    const filePath = (fileAST as any).filePath as string;
    const nodes: any[] = (fileAST as any).ast?.nodes ?? (fileAST as any).nodes ?? [];

    interface WorkerDef {
      name: string;
      children: any[];
      whenMessage: any | null;
    }

    const workerDefs = new Map<string, WorkerDef>();

    function extractWorkerPrograms(parentChildren: any[]): void {
      for (let i = parentChildren.length - 1; i >= 0; i--) {
        const node = parentChildren[i];
        if (!node || typeof node !== "object") continue;

        if (node.kind === "markup" && node.tag === "program") {
          const attrs: any[] = node.attributes ?? node.attrs ?? [];
          const nameAttr = attrs.find((a: any) => a.name === "name");
          if (nameAttr) {
            const nameVal = nameAttr.value;
            let workerName: string | null = null;
            if (nameVal?.kind === "string-literal") {
              workerName = nameVal.value;
            } else if (nameVal?.kind === "variable-ref") {
              workerName = (nameVal.name ?? "").replace(/^@/, "");
            }
            if (workerName) {
              const children: any[] = node.children ?? [];
              let whenMessage: any | null = null;
              for (const child of children) {
                if (child?.kind === "logic") {
                  for (const stmt of (child.body ?? [])) {
                    if (stmt?.kind === "when-message") {
                      whenMessage = stmt;
                      break;
                    }
                  }
                }
                if (whenMessage) break;
              }
              workerDefs.set(workerName, { name: workerName, children, whenMessage });
              parentChildren.splice(i, 1);
              continue;
            }
          }
        }

        if (node.kind === "markup" && (node.children?.length > 0)) {
          extractWorkerPrograms(node.children);
        }
      }
    }

    // §40.7 documentary-attrs-on-nested-program detection (Phase A1a, 2026-05-05).
    // Walk all <program> nodes; the FIRST top-level <program> is the document
    // root (its documentary attrs emit head metadata in the head-emission pass
    // below). Any deeper <program> with one of the five documentary attrs
    // (title, description, version, author, license) emits W-PROGRAM-TITLE-NESTED.
    // Runs BEFORE extractWorkerPrograms() so worker-program nodes are still in
    // tree and discoverable.
    const DOC_ATTR_NAMES = ["title", "description", "version", "author", "license"];
    function detectNestedDocAttrs(parentChildren: any[], depth: number): void {
      for (const node of parentChildren) {
        if (!node || typeof node !== "object") continue;
        if (node.kind === "markup" && node.tag === "program") {
          if (depth >= 1) {
            // Nested <program> — check for documentary attrs
            const attrs: any[] = node.attributes ?? node.attrs ?? [];
            const offending = attrs.filter((a: any) =>
              DOC_ATTR_NAMES.includes(a.name) &&
              a.value && a.value.kind === "string-literal" &&
              typeof a.value.value === "string" && a.value.value !== ""
            );
            for (const a of offending) {
              const span = (a.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 0, col: 0 });
              errors.push(new CGError(
                "W-PROGRAM-TITLE-NESTED",
                `W-PROGRAM-TITLE-NESTED: Documentary attribute \`${a.name}=\` on a nested ` +
                `<program> has no effect — workers have no DOM <head>. Move \`${a.name}=\` to ` +
                `the top-level <program> or remove it. (§40.7)`,
                { file: filePath, start: span.start ?? 0, end: span.end ?? 0, line: span.line ?? 0, col: span.col ?? 0 },
                "warning",
              ));
            }
          }
          // Recurse into nested program children at the next depth
          if (Array.isArray(node.children)) {
            detectNestedDocAttrs(node.children, depth + 1);
          }
          continue;
        }
        if (node.kind === "markup" && Array.isArray(node.children) && node.children.length > 0) {
          detectNestedDocAttrs(node.children, depth);
        }
      }
    }
    detectNestedDocAttrs(nodes, 0);

    extractWorkerPrograms(nodes);

    if (workerDefs.size > 0) {
      const bundles = new Map<string, string>();
      for (const [name, def] of workerDefs) {
        bundles.set(name, generateWorkerJs(name, def.children, def.whenMessage));
      }
      workerBundlesPerFile.set(filePath, bundles);
    }

    // §4.12.6: DB scope annotation — tag children of <program db="..."> with _dbScope.
    // §44.2: classify the db= URI into a driver kind (sqlite | postgres | mysql).
    // Unsupported prefixes (e.g. mongodb://) emit E-SQL-005 at compile time.
    let dbScopeCounter = 0;
    function annotateDbScopes(parentChildren: any[]): void {
      for (const node of parentChildren) {
        if (!node || typeof node !== "object") continue;
        if (node.kind === "markup" && node.tag === "program") {
          const attrs: any[] = node.attributes ?? node.attrs ?? [];
          const dbAttr = attrs.find((a: any) => a.name === "db");
          const nameAttr = attrs.find((a: any) => a.name === "name");
          if (dbAttr && !nameAttr) {
            // Scoped DB context — tag all children with the scoped DB variable
            const dbVal = dbAttr.value?.value ?? dbAttr.value?.name ?? "";
            const scopedDbVar = `_scrml_sql_${++dbScopeCounter}`;
            // §44.2 driver resolution — emit E-SQL-005 on unsupported prefix.
            // On error we still annotate the scope (with driver=sqlite default)
            // so downstream codegen does not crash; the user sees the diagnostic.
            const driverResult = resolveDbDriver(dbVal);
            let driver: "sqlite" | "postgres" | "mysql" = "sqlite";
            if (driverResult.ok) {
              driver = driverResult.info.driver;
            } else {
              const span = (dbAttr.span ?? (node as any).span ?? { file: filePath, start: 0, end: 0, line: 0, col: 0 });
              errors.push(new CGError(
                driverResult.error.code,
                driverResult.error.message,
                { file: filePath, start: span.start ?? 0, end: span.end ?? 0, line: span.line ?? 0, col: span.col ?? 0 },
              ));
            }
            (node as any)._dbScope = { dbVar: scopedDbVar, connectionString: dbVal, driver };
            // Tag all descendant logic/sql nodes
            function tagDescendants(children: any[]): void {
              for (const child of children) {
                if (!child) continue;
                (child as any)._dbVar = scopedDbVar;
                if (child.children) tagDescendants(child.children);
                if (child.body && Array.isArray(child.body)) {
                  for (const stmt of child.body) {
                    if (stmt) (stmt as any)._dbVar = scopedDbVar;
                  }
                }
              }
            }
            tagDescendants(node.children ?? []);
          }
        }
        if (node.kind === "markup" && node.children?.length > 0) {
          annotateDbScopes(node.children);
        }
      }
    }
    annotateDbScopes(nodes);
  }

  // Process each file
  for (const fileAST of files) {
    const filePath = (fileAST as any).filePath as string;
    const analysis = fileAnalyses.get(filePath);
    const nodes: object[] = analysis ? (analysis as any).nodes : [];

    // Check for unknown types in nodeTypes
    if ((fileAST as any).nodeTypes) {
      for (const [nodeId, type] of (fileAST as any).nodeTypes as Map<string, any>) {
        if (type && type.kind === "unknown") {
          errors.push(new CGError(
            "E-CG-001",
            `E-CG-001: Internal: node '${nodeId}' has an unrecognized type. ` +
            `This is likely a compiler bug — please report it with your .scrml file.`,
            { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
      }
    }

    // Resolve auth middleware for this file (from RI output)
    const authMW = safeRouteMap.authMiddleware?.get(filePath) ?? null;
    // Resolve §39 middleware config from AST (compiler-auto tier)
    const middlewareCfg = (fileAST as any).middlewareConfig ?? null;

    // ---------------------------------------------------------------------------
    // Generate server JS — emitted in both browser and library mode.
    // ---------------------------------------------------------------------------
    let serverJs: string | null = generateServerJs(fileAST, safeRouteMap, errors, authMW, middlewareCfg, batchPlan, batchPlannerErrors) || null;

    // ---------------------------------------------------------------------------
    // Generate CSS — emitted in both modes.
    // ---------------------------------------------------------------------------
    const userCss: string = generateCss(nodes, analysis?.cssBlocks) || "";

    // ---------------------------------------------------------------------------
    // LIBRARY MODE — emit ES module exports, skip HTML and browser client JS
    // ---------------------------------------------------------------------------
    if (mode === "library") {
      const libCtx: CompileContext = {
        filePath,
        fileAST,
        routeMap: safeRouteMap,
        depGraph: safeDepGraph,
        protectedFields,
        authMiddleware: authMW,
        middlewareConfig: middlewareCfg,
        csrfEnabled: false,
        encodingCtx: null,
        mode,
        testMode,
        dbVar: "_scrml_sql",
        workerNames: [],
        errors,
        registry: new BindingRegistry(),
        derivedNames: collectDerivedVarNames(fileAST),
        analysis: analysis ?? null,
      };
      const libraryJs: string | null = generateLibraryJs(libCtx) || null;

      const css: string | null = userCss || null;

      let serverJsMap: string | null = null;
      const base = basename(filePath, ".scrml");
      if (sourceMap) {
        const sourceBasename = `${base}.scrml`;
        if (serverJs) {
          const serverMapFile = `${base}.server.js.map`;
          const serverMapBuilder = new SourceMapBuilder(sourceBasename);
          const serverLines = serverJs.split("\n");
          for (let i = 0; i < serverLines.length; i++) {
            serverMapBuilder.addMapping(i, 0, 0);
          }
          serverJsMap = serverMapBuilder.generate(`${base}.server.js`);
          serverJs = appendSourceMappingUrl(serverJs, serverMapFile);
        }
      }

      const fileWorkerBundles = workerBundlesPerFile.get(filePath);
      const libOutput: CgFileOutput = {
        sourceFile: filePath,
        libraryJs,
        serverJs,
        css,
        ...(fileWorkerBundles && { workerBundles: fileWorkerBundles }),
        ...(serverJsMap !== null && { serverJsMap }),
      };
      outputs.set(filePath, libOutput);
      continue;
    }

    // ---------------------------------------------------------------------------
    // BROWSER MODE (default) — HTML + client IIFE JS + server JS
    // ---------------------------------------------------------------------------

    const hasServerFns = [...safeRouteMap.functions.entries()].some(
      ([id, route]) => id.startsWith(filePath + "::") && route.boundary === "server"
    );
    const csrfEnabled = authMW !== null ? authMW.csrf === "auto" : hasServerFns;

    const registry = new BindingRegistry();

    const fileWorkerNames = workerBundlesPerFile.has(filePath)
      ? [...workerBundlesPerFile.get(filePath)!.keys()]
      : [];

    // Construct CompileContext early so all emitters can use it.
    // encodingCtx starts null and is set after HTML gen.
    const compileCtx: CompileContext = {
      filePath,
      fileAST,
      routeMap: safeRouteMap,
      depGraph: safeDepGraph,
      protectedFields,
      authMiddleware: authMW,
      middlewareConfig: middlewareCfg,
      csrfEnabled,
      encodingCtx: null,
      mode,
      testMode,
      dbVar: "_scrml_sql",
      workerNames: fileWorkerNames,
      errors,
      registry,
      derivedNames: collectDerivedVarNames(fileAST),
      analysis: analysis ?? null,
      usedRuntimeChunks: new Set(['core', 'scope', 'errors', 'transitions']),
      // C15 — propagate MOD exportRegistry per-file so emit-engine.ts can
      // discriminate cross-file engine mount sites from local components / HTML.
      exportRegistry: exportRegistryInput,
    };

    const hasMarkup = (analysis as any)?.markupNodes?.length > 0;
    // Bug R18: After meta-eval, emit() may replace meta blocks with text nodes
    // that have no sibling markup. Check for any renderable content, not just
    // markup nodes.
    const hasRenderableContent = hasMarkup || nodes.some((n: any) =>
      n && typeof n === "object" && (
        (n.kind === "text" && typeof n.value === "string" && n.value.trim() !== "") ||
        (n.kind === "text" && typeof n.text === "string" && n.text.trim() !== "") ||
        n.kind === "state" ||
        n.kind === "if-chain" ||
        // Phase A10 (S78, 2026-05-10) — engine-decl emits a mount slot at
        // its source position when its body has any non-empty arm; gate
        // HTML generation on engine-only files too. emit-html.ts:emitNode
        // dispatches engine-decl to emit-engine.ts:emitEngineMountHtml.
        n.kind === "engine-decl"
      )
    );
    const htmlBody: string | null = hasRenderableContent
      ? generateHtml(nodes, compileCtx)
      : null;

    let tailwindCss = "";
    if (htmlBody) {
      const usedClasses = scanClassesFromHtml(htmlBody);
      tailwindCss = getAllUsedCSS(usedClasses);
    }

    const cssParts: string[] = [];
    if (userCss) cssParts.push(userCss);
    if (tailwindCss) cssParts.push(tailwindCss);
    const css: string | null = cssParts.length > 0 ? cssParts.join("\n") : null;

    // Create per-file EncodingContext (§47) and set it on the compile context
    const encodingCtx = new EncodingContext({
      enabled: encodingOpts.enabled,
      debug: encodingOpts.debug,
      __testOnly_typeEncodingSeqCap:
        (encodingOpts as { __testOnly_typeEncodingSeqCap?: number })
          .__testOnly_typeEncodingSeqCap,
    });
    compileCtx.encodingCtx = encodingCtx;

    // Register reactive variables with the encoding context
    if (encodingCtx.enabled) {
      const topLevelLogic = analysis?.topLevelLogic ?? collectTopLevelLogicStatements(fileAST);
      for (const stmt of topLevelLogic) {
        if ((stmt as any).kind === "state-decl" && (stmt as any).name) {
          const type = (fileAST as any).nodeTypes?.get((stmt as any).name) ?? { kind: "asIs", constraint: null };
          encodingCtx.register((stmt as any).name, type);
        }
      }
    }

    const clientJsRaw: string | null = generateClientJs(compileCtx) || null;

    let clientJs: string | null = clientJsRaw;
    if (clientJsRaw && !embedRuntime) {
      const runtimeEnd = clientJsRaw.indexOf("\n// --- end scrml reactive runtime ---");
      if (runtimeEnd !== -1) {
        const afterRuntime = clientJsRaw.substring(
          runtimeEnd + "\n// --- end scrml reactive runtime ---".length
        );
        clientJs = `// Requires: ${RUNTIME_FILENAME}\n` + afterRuntime;
      } else {
        const runtimeStart = clientJsRaw.indexOf("// --- scrml reactive runtime ---");
        if (runtimeStart !== -1) {
          const navigateEnd = clientJsRaw.indexOf("function _scrml_navigate(path) {");
          if (navigateEnd !== -1) {
            const closeBrace = clientJsRaw.indexOf("}\n", navigateEnd + 30);
            if (closeBrace !== -1) {
              const before = clientJsRaw.substring(0, runtimeStart);
              const after = clientJsRaw.substring(closeBrace + 2);
              clientJs = before + `// Requires: ${RUNTIME_FILENAME}\n` + after;
            }
          }
        }
      }
    }

    const base = basename(filePath, ".scrml");

    // §40.7 — extract documentary attributes from the top-level <program>
    // (Phase A1a, 2026-05-05). The five attributes (title, description,
    // version, author, license) emit standard HTML head tags. Empty-string
    // values are treated as absent. Non-string-literal values are silently
    // ignored — head metadata is static, not reactive.
    const topLevelProgram = (nodes as any[]).find(
      (n: any) => n && n.kind === "markup" && n.tag === "program",
    );
    function getDocAttr(name: string): string | null {
      if (!topLevelProgram) return null;
      const attrs: any[] = topLevelProgram.attributes ?? topLevelProgram.attrs ?? [];
      const a = attrs.find((x: any) => x.name === name);
      if (!a || !a.value) return null;
      if (a.value.kind !== "string-literal") return null;
      const v = a.value.value;
      if (typeof v !== "string" || v === "") return null;
      return v;
    }
    const docTitle = getDocAttr("title");
    const docDescription = getDocAttr("description");
    const docVersion = getDocAttr("version");
    const docAuthor = getDocAttr("author");
    const docLicense = getDocAttr("license");

    // Detect author-written <title> in the source — any <title> markup node
    // anywhere under the top-level <program>. When present, it suppresses
    // both the documentary title= AND the default basename <title>.
    function hasAuthorTitle(children: any[] | undefined): boolean {
      if (!Array.isArray(children)) return false;
      for (const c of children) {
        if (!c || typeof c !== "object") continue;
        if (c.kind === "markup" && c.tag === "title") return true;
        if (c.kind === "markup" && Array.isArray(c.children) && hasAuthorTitle(c.children)) return true;
        // The top-level <program>'s children are the document body — recurse
        // through state nodes too (state-typed openers that wrap markup).
        if (c.kind === "state" && Array.isArray(c.children) && hasAuthorTitle(c.children)) return true;
      }
      return false;
    }
    const authorTitlePresent = topLevelProgram
      ? hasAuthorTitle(topLevelProgram.children)
      : hasAuthorTitle(nodes as any[]);

    let html: string | null = null;
    if (htmlBody) {
      const docParts: string[] = [];
      docParts.push("<!DOCTYPE html>");
      docParts.push("<html lang=\"en\">");
      docParts.push("<head>");
      docParts.push("  <meta charset=\"UTF-8\">");
      docParts.push("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
      // <title> emission rule (§40.7):
      //   1. Author-written <title> → no compiler-emitted <title>
      //      (the author <title> renders via htmlBody itself)
      //   2. Documentary title= and no author <title> → emit documentary <title>
      //   3. Neither → fall back to default basename <title>
      if (!authorTitlePresent) {
        if (docTitle !== null) {
          docParts.push(`  <title>${escapeHtmlAttr(docTitle)}</title>`);
        } else {
          docParts.push(`  <title>${escapeHtmlAttr(base)}</title>`);
        }
      }
      // Documentary <meta> tags (§40.7) — fixed emission order.
      if (docDescription !== null) {
        docParts.push(`  <meta name="description" content="${escapeHtmlAttr(docDescription)}">`);
      }
      if (docVersion !== null) {
        docParts.push(`  <meta name="application-version" content="${escapeHtmlAttr(docVersion)}">`);
      }
      if (docAuthor !== null) {
        docParts.push(`  <meta name="author" content="${escapeHtmlAttr(docAuthor)}">`);
      }
      if (docLicense !== null) {
        docParts.push(`  <meta name="license" content="${escapeHtmlAttr(docLicense)}">`);
      }
      if (css) {
        docParts.push(`  <link rel="stylesheet" href="${base}.css">`);
      }
      docParts.push("</head>");
      docParts.push("<body>");
      docParts.push(htmlBody);
      if (clientJs && !embedRuntime) {
        docParts.push(`<script src="${RUNTIME_FILENAME}"></script>`);
      }
      if (clientJs) {
        docParts.push(`<script src="${base}.client.js"></script>`);
      }
      docParts.push("</body>");
      docParts.push("</html>");
      html = docParts.join("\n");
    }

    let clientJsMap: string | null = null;
    let serverJsMap: string | null = null;

    if (sourceMap) {
      const sourceBasename = `${base}.scrml`;

      if (clientJs) {
        const clientMapFile = `${base}.client.js.map`;
        const clientMapBuilder = new SourceMapBuilder(sourceBasename);
        const clientLines = clientJs.split("\n");
        for (let i = 0; i < clientLines.length; i++) {
          clientMapBuilder.addMapping(i, 0, 0);
        }
        clientJsMap = clientMapBuilder.generate(`${base}.client.js`);
        clientJs = appendSourceMappingUrl(clientJs, clientMapFile);
      }

      if (serverJs) {
        const serverMapFile = `${base}.server.js.map`;
        const serverMapBuilder = new SourceMapBuilder(sourceBasename);
        const serverLines = serverJs.split("\n");
        for (let i = 0; i < serverLines.length; i++) {
          serverMapBuilder.addMapping(i, 0, 0);
        }
        serverJsMap = serverMapBuilder.generate(`${base}.server.js`);
        serverJs = appendSourceMappingUrl(serverJs, serverMapFile);
      }
    }

    // Generate test JS when testMode is enabled
    //
    // Phase A6-4 (SPEC §19.12.7) — collect same-file server-fn names so
    // emit-test.ts can emit E-TEST-006 thrower stubs for unbound server-fns
    // called inside `~{}` test blocks. Walk the file's fn nodes and pick out
    // those whose route entry has `boundary === "server"`.
    const sameFileServerFnNames: string[] = [];
    if (testMode) {
      const fnNodes: any[] = (analysis as any)?.fnNodes ?? [];
      for (const fnNode of fnNodes) {
        const span = fnNode?.span;
        if (!span || typeof span.start !== "number") continue;
        const fnNodeId = `${filePath}::${span.start}`;
        const route = safeRouteMap.functions.get(fnNodeId);
        if (!route || route.boundary !== "server") continue;
        const fnName = fnNode.name;
        if (typeof fnName === "string" && fnName !== "anon" && fnName !== "") {
          sameFileServerFnNames.push(fnName);
        }
      }
    }
    const testJs: string | null = testMode
      ? generateTestJs(filePath, (analysis as any)?.testGroups ?? [], [], sameFileServerFnNames) ?? null
      : null;

    // §51.13 — auto-generated machine property tests.
    let machineTestJs: string | null = null;
    if (emitMachineTests) {
      const machineRegistry = (fileAST as any).machineRegistry as Map<string, any> | undefined;
      const initialVariants = new Map<string, string>();
      function walkForMachineInitials(children: any[]): void {
        if (!Array.isArray(children)) return;
        for (const child of children) {
          if (!child || typeof child !== "object") continue;
          if (child.kind === "state-decl" && child.machineBinding && child.initialValue) {
            const iv = child.initialValue;
            const variant =
              (iv.kind === "variant-literal" && typeof iv.variant === "string") ? iv.variant :
              (iv.kind === "enum-variant" && typeof iv.variant === "string") ? iv.variant :
              null;
            if (variant) initialVariants.set(child.machineBinding, variant);
          }
          if (Array.isArray(child.children)) walkForMachineInitials(child.children);
          if (Array.isArray(child.body)) walkForMachineInitials(child.body);
        }
      }
      walkForMachineInitials(nodes);
      machineTestJs = generateMachineTestJs(filePath, machineRegistry ?? null, initialVariants);
    }

    const fileWorkerBundles = workerBundlesPerFile.get(filePath);
    const browserOutput: CgFileOutput = {
      sourceFile: filePath,
      html,
      css,
      clientJs,
      serverJs,
      ...(testJs !== null && { testJs }),
      ...(machineTestJs !== null && { machineTestJs }),
      ...(fileWorkerBundles && { workerBundles: fileWorkerBundles }),
      ...(clientJsMap !== null && { clientJsMap }),
      ...(serverJsMap !== null && { serverJsMap }),
    };
    outputs.set(filePath, browserOutput);
  }

  const runtimeJs = embedRuntime ? null : SCRML_RUNTIME;

  // §51.5.1 (S28 slice 3) — drain E-ENGINE-001 compile errors accumulated
  // by emit-machines during this compile.
  const machineErrors = drainMachineCodegenErrors();
  if (machineErrors.length > 0) errors.push(...machineErrors);

  // Reset the Tier 2 hoist singleton so a subsequent compile in the same
  // process (persistent server, test harness) starts clean.
  setBatchLoopHoists(null);

  return { outputs, errors, runtimeJs, runtimeFilename: RUNTIME_FILENAME };
}

export { CGError } from "./errors.ts";
