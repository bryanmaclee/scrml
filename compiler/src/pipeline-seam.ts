/**
 * pipeline-seam.ts — the STAGE-SUBSTITUTION SEAM for `compileScrml`.
 * change-id: s430-stage-swap (bryan S430 ruling P5).
 *
 * ═══ WHAT THIS IS FOR ═══
 *
 * A bootstrap module is DONE when a HYBRID compiler — the TS pipeline with that ONE stage swapped
 * for the bootstrap build of it — passes the full conformance suite (P5). That needs three things
 * this file provides:
 *
 *   1. A NAMED REGISTRY of every substitutable stage (`STAGE_SEAMS`), in pipeline order, each with
 *      the entry export a substitute module must provide and the signature it is called with.
 *   2. A RESOLVER (`createStageSeams`) that turns `options.stageOverrides` (and the older
 *      `options.selfHostModules`) into per-stage call targets. With NO substitution the resolver
 *      hands back the TS default function OBJECT ITSELF — no wrapper, no extra frame, no
 *      validation pass — so a compile without substitutions is byte-identical to one before the
 *      seam existed (proved by the corpus artifact differential, see the change's progress.md).
 *   3. SEAM VALIDATION at every substituted boundary: the substitute's output is checked against
 *      the stage's output contract (shape + required fields, plus the AST node invariant for every
 *      stage that produces or mutates an AST). A mismatch throws `StageSeamError` naming the stage
 *      and the FIRST divergent path. It never returns, so a malformed value can never reach the
 *      next stage.
 *
 * ═══ WHAT "THE STAGE CONTRACT" MEANS HERE ═══
 *
 * `compiler/PIPELINE.md` states the stage contracts, and it has drifted from the implementation in
 * places (TS is documented as `{ typedAst }` but returns `{ files, errors }`; CG is documented as
 * `{ outputs: FileOutput[] }` but returns a Map; BS is documented as taking a macroTable). The
 * validators below encode the contract AS THE DOWNSTREAM CONSUMERS IN api.js READ IT — the fields
 * the next stage actually dereferences — because that is the boundary a malformed value would
 * cross. Every schema was calibrated by running every stage through the seam with the TS default
 * as the "substitute" over the whole tracked corpus and the conformance suite: the TS pipeline
 * passes every validator here, so a validator failure means the substitute diverged from what TS
 * produces, not that the validator is stricter than TS.
 *
 * ═══ THE AST NODE INVARIANT ═══
 *
 * Every element of a `nodes` / `children` / `body` array reachable from a FileAST (excluding
 * `_`-prefixed compiler-private keys) is an object with a string `kind` and a `span` whose `start`
 * and `end` are numbers. Measured over the tracked corpus at the base of this change: 49,968
 * object node-array elements, zero exceptions; the one non-object exception is a `~{}` test case's
 * `body` (raw statement strings), which is checked as exactly that. PIPELINE.md's "Span loss"
 * integration failure mode is the reason it is enforced — a node without a span makes every
 * downstream diagnostic unlocatable.
 *
 * ═══ WHAT THIS DOES NOT DO ═══
 *
 * It does not compare a substitute's output to the TS stage's output. That is the job of the
 * differential (`scripts/hybrid.ts --differential`), which runs the whole pipeline both ways and
 * diffs the ARTIFACTS — a structurally valid but semantically wrong substitute passes the seam and
 * is caught by conformance and the differential. The seam's job is narrower and absolute: nothing
 * malformed crosses a stage boundary silently.
 */

// ---------------------------------------------------------------------------
// StageSeamError
// ---------------------------------------------------------------------------

export class StageSeamError extends Error {
  stage: string;
  path: string | null;
  constructor(stage: string, path: string | null, detail: string) {
    super(
      path === null
        ? `stage-seam [${stage}]: ${detail}`
        : `stage-seam [${stage}]: substitute output violates the ${stage} stage contract at \`${path}\`: ${detail}`,
    );
    this.name = "StageSeamError";
    this.stage = stage;
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// A tiny shape-checking vocabulary. Each checker returns `null` when the value conforms, or a
// `{ path, detail }` describing the FIRST divergence it found (depth-first, in key order).
// ---------------------------------------------------------------------------

type Divergence = { path: string; detail: string } | null;
type Check = (v: unknown, path: string) => Divergence;

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v instanceof Map) return `Map(${v.size})`;
  if (v instanceof Set) return `Set(${v.size})`;
  if (typeof v === "string") return `string ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v)}`;
  if (typeof v === "object") return `object {${Object.keys(v as object).slice(0, 8).join(", ")}}`;
  return `${typeof v} ${String(v)}`;
}

const fail = (path: string, expected: string, got: unknown): Divergence =>
  ({ path, detail: `expected ${expected}, got ${describeValue(got)}` });

const str: Check = (v, p) => (typeof v === "string" ? null : fail(p, "a string", v));
const num: Check = (v, p) => (typeof v === "number" && !Number.isNaN(v) ? null : fail(p, "a number", v));
const bool: Check = (v, p) => (typeof v === "boolean" ? null : fail(p, "a boolean", v));
const anyValue: Check = () => null;

function optional(c: Check): Check {
  return (v, p) => (v === undefined ? null : c(v, p));
}
function nullable(c: Check): Check {
  return (v, p) => (v === null || v === undefined ? null : c(v, p));
}
function oneOf(values: readonly string[]): Check {
  return (v, p) =>
    typeof v === "string" && values.includes(v) ? null : fail(p, `one of ${values.map((x) => JSON.stringify(x)).join(" | ")}`, v);
}
function obj(fields: Record<string, Check>): Check {
  return (v, p) => {
    if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Map || v instanceof Set) {
      return fail(p, `an object {${Object.keys(fields).join(", ")}}`, v);
    }
    for (const [k, c] of Object.entries(fields)) {
      const d = c((v as Record<string, unknown>)[k], `${p}.${k}`);
      if (d) return d;
    }
    return null;
  };
}
function arr(elem: Check): Check {
  return (v, p) => {
    if (!Array.isArray(v)) return fail(p, "an array", v);
    for (let i = 0; i < v.length; i++) {
      const d = elem(v[i], `${p}[${i}]`);
      if (d) return d;
    }
    return null;
  };
}
function mapOf(val: Check, key: Check = anyValue): Check {
  return (v, p) => {
    if (!(v instanceof Map)) return fail(p, "a Map", v);
    for (const [k, x] of v) {
      const label = typeof k === "string" ? JSON.stringify(k) : String(k);
      const dk = key(k, `${p}<key ${label}>`);
      if (dk) return dk;
      const d = val(x, `${p}.get(${label})`);
      if (d) return d;
    }
    return null;
  };
}
const set: Check = (v, p) => (v instanceof Set ? null : fail(p, "a Set", v));
function lazy(f: () => Check): Check {
  return (v, p) => f()(v, p);
}

// ---------------------------------------------------------------------------
// Shared contract pieces
// ---------------------------------------------------------------------------

const span = obj({ start: num, end: num });

/**
 * A compiler diagnostic as `collectErrors` (api.js) consumes it: it reads `.code` and `.message`
 * and passes everything else through. The TS pipeline's diagnostics are a mix of plain objects and
 * `Error` subclasses (BSError / TABError); both carry an own `code` string. `message` is not
 * required — `TABError` exposes it through the Error prototype chain, not an own field, and
 * `collectErrors` tolerates its absence.
 */
const diagnostic = obj({ code: str });
const diagnostics = arr(diagnostic);

/** The AST node invariant (see file header). Cycle-safe; skips `_`-prefixed private keys. */
function astNodes(): Check {
  return (v, p) => walkAst(v, p, new Set(), true); // the list itself is a node slot
}
function walkAst(v: unknown, p: string, seen: Set<unknown>, isNodeSlot: boolean, isTestCase = false): Divergence {
  if (!v || typeof v !== "object") {
    return isNodeSlot ? fail(p, "an AST node {kind, span}", v) : null;
  }
  if (seen.has(v)) return null;
  seen.add(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const d = walkAst(v[i], `${p}[${i}]`, seen, isNodeSlot, isTestCase);
      if (d) return d;
    }
    return null;
  }
  if (v instanceof Map || v instanceof Set) return null;
  const o = v as Record<string, unknown>;
  if (isNodeSlot) {
    if (typeof o.kind !== "string") return fail(`${p}.kind`, "a string (every AST node has a kind)", o.kind);
    const ds = span(o.span, `${p}.span`);
    if (ds) return { path: ds.path, detail: `${ds.detail} (AST node kind ${JSON.stringify(o.kind)} — PIPELINE.md "Span loss")` };
  }
  for (const k of Object.keys(o)) {
    if (k.startsWith("_")) continue;
    const child = o[k];
    // The one measured exception to the node invariant: a `~{}` test case record
    // (`testGroup.tests[i]`, ast-builder.js parseTestBody) keeps its `body` as the raw
    // statement STRINGS (`"assert x == 1"`), not nodes. It is checked as exactly that.
    if (isTestCase && k === "body") {
      const d = arr(str)(child, `${p}.body`);
      if (d) return { path: d.path, detail: `${d.detail} (a ~{} test case's body is its raw statement strings)` };
      continue;
    }
    const slot = (k === "nodes" || k === "children" || k === "body") && Array.isArray(child);
    const d = walkAst(child, `${p}.${k}`, seen, slot, k === "tests" && Array.isArray(child));
    if (d) return d;
  }
  return null;
}

/** PIPELINE.md Stage 3 FileAST — the fields MOD / NR / CE / TS / CG read. */
const fileAst = obj({
  filePath: str,
  nodes: (v, p) => arr(anyValue)(v, p) ?? astNodes()(v, p),
  imports: arr(anyValue),
  exports: arr(anyValue),
  components: arr(anyValue),
  typeDecls: arr(anyValue),
});

/** A per-file result carrying a FileAST (`tabResult` / CE file / TS file / META file). */
const fileWithAst = obj({ filePath: str, ast: fileAst });

/**
 * Stage 2 Block, recursive. `name` / `closerForm` are optional per BS.
 *
 * The `type` vocabulary is the one block-splitter.js EMITS (every `pushBraceContext(...)` kind plus
 * the literal `type:` sites), not PIPELINE.md's table: the doc omits `"test"` (`~{}`) and
 * `"foreign"` (`_{}`), and block-splitter.js's own header omits `"foreign"`. Found by the S430
 * calibration run (TS-through-its-own-seam over the corpus). A substitute emitting a type outside
 * this set is feeding TAB a block kind TAB has no case for.
 */
const BLOCK_TYPES = [
  "markup", "state", "logic", "sql", "css", "error-effect", "meta", "test", "foreign", "text", "comment",
] as const;
const block: Check = lazy(() =>
  obj({
    type: oneOf(BLOCK_TYPES),
    raw: str,
    span,
    depth: num,
    children: arr(block),
  }),
);

/**
 * CG per-file output record — `CgFileOutput` in codegen/index.ts: `sourceFile` plus text artifact
 * slots that are each a string, null, or absent, and an optional `workerBundles` Map of strings.
 */
const CG_TEXT_FIELDS = [
  "html", "css", "clientJs", "serverJs", "libraryJs", "toolJs", "testJs", "machineTestJs",
  "clientJsMap", "serverJsMap",
] as const;
const cgFileOutput: Check = (v, p) => {
  const d0 = obj({ sourceFile: str, workerBundles: optional(mapOf(str, str)) })(v, p);
  if (d0) return d0;
  const o = v as Record<string, unknown>;
  for (const k of CG_TEXT_FIELDS) {
    const x = o[k];
    if (x !== undefined && x !== null && typeof x !== "string") return fail(`${p}.${k}`, "a string, null, or absent", x);
  }
  return null;
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The input a validator may re-check. Stages that MUTATE upstream ASTs in place (PRECG, NR, TC,
 * SYM, META-EVAL) hand the validator the files they were given, so a substitute that corrupts an
 * AST in place is caught at its own boundary rather than three stages later.
 */
export type SeamArgs = unknown[];

export interface StageSeam {
  /** Stage name as used by `--swap <NAME>=…` and `stageOverrides` keys. */
  name: string;
  /** The TS implementation's module, relative to compiler/src (the stage's default). */
  tsModule: string;
  /** PIPELINE.md stage number / label this seam sits at. */
  pipeline: string;
  /** Named export a substitute module must provide (or `default`). */
  entry: string;
  /** Call signature, for humans and for the runner's `--list`. */
  signature: string;
  /** Legacy `selfHostModules` key that also substitutes this stage, if any. */
  selfHostKey?: string;
  /** Output contract. */
  output: Check;
  /** Optional post-call re-check of mutated inputs. */
  mutated?: (args: SeamArgs) => Divergence;
  /**
   * Places OUTSIDE the pipeline's own call to this stage that invoke the TS implementation
   * directly, and therefore still run TS even when the stage is substituted (see
   * PARSE_REENTRY_FILES). Empty/absent means the pipeline call is the only call.
   */
  reentry?: readonly string[];
}

/**
 * ⚠ THE KNOWN LIMIT OF A BS / TAB SWAP. Seven files re-enter the TS block splitter / AST builder
 * directly — re-parsing a synthesized snippet mid-stage — instead of going through the pipeline's
 * BS / TAB call. A hybrid with BS or TAB substituted still parses THOSE snippets with TS, so its
 * FileASTs are of mixed provenance. Every other stage has exactly one caller (api.js).
 * Measured at the base of s430-stage-swap by `\b(splitBlocks|buildAST|runBlockSplitter)\(` over
 * compiler/src, excluding comments, the definitions, TAB's own internal recursion
 * (ast-builder.js / block-splitter.js) and the CLI-only `commands/`. Pinned by
 * compiler/tests/integration/hybrid-stage-swap.test.js so a NEW re-entry site cannot land unseen.
 * Routing these through the seam is a design decision (a compile-scoped parse capability threaded
 * into CE / TS / CG) that must precede gating a BS or TAB bootstrap module.
 */
export const PARSE_REENTRY_FILES: readonly string[] = [
  "compiler/src/api.js",                        // STDLIB-EXPORT-SEED: _parseStdlibExports
  "compiler/src/component-expander.ts",
  "compiler/src/type-system.ts",
  "compiler/src/codegen/emit-engine.ts",
  "compiler/src/codegen/emit-error-boundary.ts",
  "compiler/src/codegen/emit-logic.ts",
  "compiler/src/codegen/emit-match.ts",
];

const recheckFiles = (label: string, pick: (args: SeamArgs) => unknown): ((args: SeamArgs) => Divergence) =>
  (args) => arr(obj({ ast: fileAst }))(pick(args), label);

export const STAGE_SEAMS: readonly StageSeam[] = [
  {
    name: "LINT-GHOST", tsModule: "./lint-ghost-patterns.js", pipeline: "pre-BS lint", entry: "lintGhostPatterns",
    signature: "(source, filePath) -> LintDiagnostic[]", output: diagnostics,
  },
  {
    name: "BS", tsModule: "./block-splitter.js", pipeline: "Stage 2", entry: "splitBlocks", selfHostKey: "splitBlocks",
    signature: "(filePath, source) -> { filePath, blocks, errors }",
    reentry: PARSE_REENTRY_FILES,
    output: obj({ filePath: str, blocks: arr(block), errors: optional(diagnostics) }),
  },
  {
    name: "BS-LINT-RAW-INTERP", tsModule: "./lint-w-interp-in-raw-content.js", pipeline: "Stage 2.5", entry: "runWInterpInRawContent",
    signature: "(bsResults) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "BS-LINT-INPUT-STATE", tsModule: "./lint-w-input-state-markup-nonreactive.js", pipeline: "Stage 2.5b", entry: "runWInputStateMarkupNonreactive",
    signature: "(bsResults) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "BS-LINT-STMT-FORM", tsModule: "./lint-e-state-block-statement-form.js", pipeline: "Stage 2.5c", entry: "runEStateBlockStatementForm",
    signature: "(bsResults) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "TAB", tsModule: "./ast-builder.js", pipeline: "Stage 3", entry: "buildAST", selfHostKey: "buildAST",
    signature: "(bsResult, tokenizerOverride|null) -> { filePath, ast: FileAST, errors }",
    reentry: PARSE_REENTRY_FILES,
    output: obj({ filePath: optional(str), ast: fileAst, errors: diagnostics }),
  },
  {
    name: "PRECG", tsModule: "./precg.ts", pipeline: "Stage 3.004", entry: "runPRECG",
    signature: "(fileAST) -> void   (stamps has*/authConfig/middlewareConfig/fileShape/mcpConfig in place)",
    output: anyValue,
    mutated: (args) => fileAst(args[0], "fileAST"),
  },
  {
    name: "GCP1", tsModule: "./gauntlet-phase1-checks.js", pipeline: "Stage 3.005", entry: "runGauntletPhase1Checks",
    signature: "(bsResult, tabResult) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "GCP3", tsModule: "./gauntlet-phase3-eq-checks.js", pipeline: "Stage 3.006", entry: "runGauntletPhase3EqChecks",
    signature: "(tabResult) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "LINT-TRY-CATCH", tsModule: "./validators/lint-try-catch.ts", pipeline: "Stage 3.007", entry: "runTryCatchLint",
    signature: "(fileAST) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "REJECT-ASYNC-AWAIT", tsModule: "./validators/lint-async-user-source.ts", pipeline: "Stage 3.008", entry: "runAsyncAwaitReject",
    signature: "(fileAST) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "MOD", tsModule: "./module-resolver.js", pipeline: "Stage 3.1", entry: "resolveModules", selfHostKey: "resolveModules",
    signature: "(tabResults) -> { compilationOrder, exportRegistry, importGraph, errors }",
    output: obj({
      compilationOrder: arr(str),
      exportRegistry: mapOf(mapOf(obj({ kind: str }), str), str),
      importGraph: mapOf(obj({ imports: arr(anyValue), exports: arr(anyValue) }), str),
      errors: diagnostics,
    }),
  },
  {
    name: "NR", tsModule: "./name-resolver.ts", pipeline: "Stage 3.05", entry: "runNRBatch",
    signature: "(files, exportRegistry, importGraph) -> { errors }[]   (stamps resolvedKind/resolvedCategory in place)",
    output: arr(obj({ errors: diagnostics })),
    mutated: recheckFiles("files", (a) => a[0]),
  },
  {
    name: "TC", tsModule: "./tag-canonicalizer.ts", pipeline: "Stage 3.055", entry: "runTCBatch",
    signature: "(files) -> { filePath, rewrites }[]   (canonicalizes tags in place)",
    output: arr(obj({ filePath: str, rewrites: arr(anyValue) })),
    mutated: recheckFiles("files", (a) => a[0]),
  },
  {
    name: "SYM", tsModule: "./symbol-table.ts", pipeline: "Stage 3.06", entry: "runSYMBatch",
    signature: "(files, exportRegistry) -> { errors, stats }[]   (attaches _record/_scope in place)",
    output: arr(obj({ errors: diagnostics, stats: obj({ totalRecords: num, totalScopes: num }) })),
    mutated: recheckFiles("files", (a) => a[0]),
  },
  {
    name: "CE", tsModule: "./component-expander.ts", pipeline: "Stage 3.2", entry: "runCE",
    signature: "({ files, exportRegistry, fileASTMap, importGraph }) -> { files, errors }",
    output: obj({ files: arr(fileWithAst), errors: diagnostics }),
  },
  {
    name: "VP-2", tsModule: "./validators/post-ce-invariant.ts", pipeline: "Stage 3.3", entry: "runPostCEInvariant",
    signature: "({ files }) -> { errors }", output: obj({ errors: diagnostics }),
  },
  {
    name: "VP-3", tsModule: "./validators/attribute-interpolation.ts", pipeline: "Stage 3.3", entry: "runAttributeInterpolation",
    signature: "({ files }) -> { errors }", output: obj({ errors: diagnostics }),
  },
  {
    name: "VP-1", tsModule: "./validators/attribute-allowlist.ts", pipeline: "Stage 3.3", entry: "runAttributeAllowlist",
    signature: "({ files }) -> { errors }", output: obj({ errors: diagnostics }),
  },
  {
    name: "CSS-CONFLICT", tsModule: "./codegen/css-conflict-check.ts", pipeline: "Stage 3.4", entry: "checkCssConflicts",
    signature: "(ceFile) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "PA", tsModule: "./protect-analyzer.ts", pipeline: "Stage 4", entry: "runPA", selfHostKey: "runPA",
    signature: "({ files }) -> { protectAnalysis, errors }",
    output: obj({ protectAnalysis: obj({ views: mapOf(anyValue) }), errors: diagnostics }),
  },
  {
    name: "RI", tsModule: "./route-inference.ts", pipeline: "Stage 5", entry: "runRI", selfHostKey: "runRI",
    signature: "({ files, protectAnalysis }) -> { routeMap, errors }",
    output: obj({
      routeMap: obj({
        // "middleware" is the handle() boundary (route-inference.ts FunctionRoute.boundary);
        // PIPELINE.md Stage 5 documents only client | server — doc drift, found by calibration.
        functions: mapOf(obj({ boundary: oneOf(["client", "server", "middleware"]) }), str),
        pages: mapOf(anyValue),
        authMiddleware: mapOf(anyValue),
      }),
      errors: diagnostics,
    }),
  },
  {
    name: "MC", tsModule: "./monotonicity-analyzer.ts", pipeline: "Stage 5.5", entry: "analyzeMonotonicity",
    signature: "(routeMap, fnNodes, functionIndex) -> { verdicts, diagnostics }",
    output: obj({
      verdicts: mapOf(oneOf(["monotone", "non-monotone", "machine-intrinsic"]), str),
      diagnostics: arr(anyValue),
    }),
  },
  {
    name: "TS", tsModule: "./type-system.ts", pipeline: "Stage 6", entry: "runTS", selfHostKey: "runTS",
    signature: "({ files, protectAnalysis, routeMap, importedTypesByFile }) -> { files, errors, stateTypeRegistry }",
    output: obj({ files: arr(fileWithAst), errors: diagnostics, stateTypeRegistry: optional(mapOf(anyValue)) }),
  },
  {
    name: "LINT-MATCH-PROMOTABLE", tsModule: "./lint-i-match-promotable.js", pipeline: "Stage 6.4", entry: "runIMatchPromotable",
    signature: "(tsFiles, stateTypeRegistry) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "LINT-FN-PROMOTABLE", tsModule: "./lint-i-fn-promotable.js", pipeline: "Stage 6.4b", entry: "runIFnPromotable",
    signature: "(tsFiles, stateTypeRegistry, inferredServerKeys) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "LINT-EACH-PROMOTABLE", tsModule: "./lint-w-each-promotable.js", pipeline: "Stage 6.4c", entry: "runWEachPromotable",
    signature: "(tsFiles) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "LINT-EACH-KEY", tsModule: "./lint-w-each-key.js", pipeline: "Stage 6.4d", entry: "runWEachKey",
    signature: "(tsFiles, stateTypeRegistry) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "LINT-MAP-ITERATION-ORDER", tsModule: "./lint-w-map-iteration-order.js", pipeline: "Stage 6.4e", entry: "runWMapIterationOrder",
    signature: "(tsFiles) -> Diagnostic[]", output: diagnostics,
  },
  {
    name: "META-CHECK", tsModule: "./meta-checker.ts", pipeline: "Stage 6.5 (MC sub-pass)", entry: "runMetaChecker", selfHostKey: "runMetaChecker",
    signature: "({ files }) -> { errors }", output: obj({ errors: diagnostics }),
  },
  {
    name: "META-EVAL", tsModule: "./meta-eval.ts", pipeline: "Stage 6.5 (ME sub-pass)", entry: "runMetaEval",
    signature: "({ files }) -> { errors }   (splices ^{} emit() results into the ASTs in place)",
    output: obj({ errors: diagnostics }),
    mutated: (args) => arr(obj({ ast: fileAst }))((args[0] as { files?: unknown })?.files, "input.files"),
  },
  {
    name: "DG", tsModule: "./dependency-graph.ts", pipeline: "Stage 7", entry: "runDG", selfHostKey: "runDG",
    signature: "({ files, routeMap, debugPerf, log }) -> { depGraph, errors }",
    output: obj({
      depGraph: obj({
        nodes: mapOf(obj({ kind: str }), str),
        edges: arr(obj({ from: str, to: str, kind: str })),
      }),
      errors: diagnostics,
    }),
  },
  {
    name: "BP", tsModule: "./batch-planner.ts", pipeline: "Stage 7.5", entry: "runBatchPlanner",
    signature: "({ files, depGraph, routeMap, protectAnalysis }) -> { batchPlan, errors }",
    output: obj({
      batchPlan: obj({ coalescedHandlers: mapOf(anyValue), loopHoists: arr(anyValue), nobatchSites: set }),
      errors: diagnostics,
    }),
  },
  {
    name: "AG", tsModule: "./auth-graph.ts", pipeline: "Stage 7.55", entry: "runAuthGraph", selfHostKey: "runAuthGraph",
    signature: "(files, routeMap) -> { graph, errors }",
    output: obj({ graph: obj({ gates: mapOf(anyValue) }), errors: diagnostics }),
  },
  {
    name: "RS", tsModule: "./reachability-solver.ts", pipeline: "Stage 7.6", entry: "runReachabilitySolver",
    signature: "({ depGraph, routeMap, batchPlan, files, authGraph, debugPerf, log }) -> { record, errors }",
    output: obj({ record: obj({ closures: mapOf(anyValue) }), errors: diagnostics }),
  },
  {
    name: "CG", tsModule: "./code-generator.js", pipeline: "Stage 8", entry: "runCG", selfHostKey: "runCG",
    signature: "({ files, routeMap, depGraph, protectAnalysis, batchPlan, … }) -> { outputs: Map<source, FileOutput>, errors }",
    output: obj({ outputs: mapOf(cgFileOutput, str), errors: diagnostics }),
  },
];

const SEAM_BY_NAME: ReadonlyMap<string, StageSeam> = new Map(STAGE_SEAMS.map((s) => [s.name, s]));
const SEAM_BY_SELF_HOST_KEY: ReadonlyMap<string, StageSeam> = new Map(
  STAGE_SEAMS.filter((s) => s.selfHostKey).map((s) => [s.selfHostKey as string, s]),
);
/**
 * `selfHostModules` keys that are NOT stage substitutions and keep their pre-seam meaning:
 * `tokenizer` is a TAB sub-component (passed into `buildAST`), `bpp` is the legacy
 * parser-workarounds override (`setBPPOverrides`).
 */
const SELF_HOST_NON_STAGE_KEYS = new Set(["tokenizer", "bpp"]);

export function stageSeam(name: string): StageSeam | undefined {
  return SEAM_BY_NAME.get(name);
}

/**
 * Validate a value against a stage's output contract. Returns the first divergence or null.
 * Exported for the runner and the tests; `createStageSeams` is the pipeline's user.
 */
export function checkStageOutput(name: string, value: unknown): Divergence {
  const seam = SEAM_BY_NAME.get(name);
  if (!seam) throw new StageSeamError(name, null, `unknown stage (known: ${STAGE_SEAMS.map((s) => s.name).join(", ")})`);
  return seam.output(value, "result");
}

/**
 * Pull a stage's entry function out of a substitute module (or accept a bare function).
 * Loud on every failure: an unknown stage, a module missing the entry export, a non-function.
 */
export function resolveSubstitute(name: string, sub: unknown): (...args: unknown[]) => unknown {
  const seam = SEAM_BY_NAME.get(name);
  if (!seam) {
    throw new StageSeamError(name, null, `unknown stage name. Substitutable stages: ${STAGE_SEAMS.map((s) => s.name).join(", ")}`);
  }
  if (typeof sub === "function") return sub as (...args: unknown[]) => unknown;
  if (sub && typeof sub === "object") {
    const m = sub as Record<string, unknown>;
    const fn = m[seam.entry] ?? m.default;
    if (typeof fn === "function") return fn as (...args: unknown[]) => unknown;
    throw new StageSeamError(
      name, null,
      `substitute module exports no \`${seam.entry}\` (nor a default function). Exports present: ${Object.keys(m).join(", ") || "(none)"}`,
    );
  }
  throw new StageSeamError(name, null, `substitute must be a module object or a function, got ${describeValue(sub)}`);
}

/**
 * Wrap a substitute so every call is validated. A throw from the substitute is re-thrown as a
 * StageSeamError naming the stage (the original is kept as `cause`); a contract violation is
 * thrown with the first divergent path.
 */
function guard(seam: StageSeam, fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  const guarded = function (this: unknown, ...args: unknown[]) {
    let out: unknown;
    try {
      out = fn.apply(this, args);
    } catch (e) {
      if (e instanceof StageSeamError) throw e;
      const err = new StageSeamError(seam.name, null, `substitute threw: ${(e as Error)?.stack ?? String(e)}`);
      (err as Error & { cause?: unknown }).cause = e;
      throw err;
    }
    if (out && typeof (out as { then?: unknown }).then === "function") {
      throw new StageSeamError(seam.name, "result", "expected a synchronous return value, got a Promise (the pipeline is synchronous)");
    }
    const d = seam.output(out, "result");
    if (d) throw new StageSeamError(seam.name, d.path, d.detail);
    if (seam.mutated) {
      const dm = seam.mutated(args);
      if (dm) throw new StageSeamError(seam.name, dm.path, `${dm.detail} (input mutated in place by the substitute)`);
    }
    return out;
  };
  Object.defineProperty(guarded, "name", { value: `seam(${seam.name})` });
  return guarded;
}

export interface StageSeams {
  /** True when at least one stage is substituted. */
  readonly active: boolean;
  /** Names of the substituted stages, pipeline order. */
  readonly substituted: readonly string[];
  /**
   * The call target for a stage. With no substitution for `name`, returns `defaultFn` itself
   * (identity — the no-substitution pipeline is untouched). With one, returns the validated
   * substitute.
   */
  pick<F extends (...args: any[]) => any>(name: string, defaultFn: F): F;
  /** True when `name` is substituted. */
  has(name: string): boolean;
}

/**
 * Build the per-compile seam table from `options.stageOverrides` and the legacy
 * `options.selfHostModules`.
 *
 * `stageOverrides`: `{ [STAGE_NAME]: moduleObject | function }`. Unknown names throw.
 * `selfHostModules`: the pre-seam `{ splitBlocks, buildAST, runPA, … }` object — each key that
 *   names a stage entry is routed through the SAME validated seam; `tokenizer` / `bpp` keep their
 *   pre-seam handling in api.js. A stage given by both is ambiguous and throws.
 */
export function createStageSeams(stageOverrides: unknown, selfHostModules: unknown): StageSeams {
  const table = new Map<string, (...args: unknown[]) => unknown>();

  if (stageOverrides !== null && stageOverrides !== undefined) {
    if (typeof stageOverrides !== "object" || Array.isArray(stageOverrides)) {
      throw new StageSeamError("*", null, `options.stageOverrides must be an object keyed by stage name, got ${describeValue(stageOverrides)}`);
    }
    for (const [name, sub] of Object.entries(stageOverrides as Record<string, unknown>)) {
      if (sub === undefined || sub === null) continue;
      const seam = SEAM_BY_NAME.get(name);
      const fn = resolveSubstitute(name, sub);
      table.set(name, guard(seam as StageSeam, fn));
    }
  }

  if (selfHostModules && typeof selfHostModules === "object") {
    for (const [key, sub] of Object.entries(selfHostModules as Record<string, unknown>)) {
      if (sub === undefined || sub === null || SELF_HOST_NON_STAGE_KEYS.has(key)) continue;
      const seam = SEAM_BY_SELF_HOST_KEY.get(key);
      if (!seam) continue; // unknown legacy keys were silently ignored pre-seam; unchanged
      if (table.has(seam.name)) {
        throw new StageSeamError(seam.name, null, `substituted twice — by options.stageOverrides.${seam.name} AND options.selfHostModules.${key}`);
      }
      if (typeof sub !== "function") {
        throw new StageSeamError(seam.name, null, `options.selfHostModules.${key} must be a function, got ${describeValue(sub)}`);
      }
      table.set(seam.name, guard(seam, sub as (...args: unknown[]) => unknown));
    }
  }

  const substituted = STAGE_SEAMS.map((s) => s.name).filter((n) => table.has(n));
  return {
    active: table.size > 0,
    substituted,
    has: (name) => table.has(name),
    pick<F extends (...args: any[]) => any>(name: string, defaultFn: F): F {
      if (!SEAM_BY_NAME.has(name)) {
        // A pick() for an unregistered name is a compiler bug, not a user error — fail at once.
        throw new StageSeamError(name, null, "api.js picked a stage the seam registry does not know");
      }
      const sub = table.get(name);
      return (sub ?? defaultFn) as F;
    },
  };
}
