/**
 * @module codegen/chunk-namespace
 *
 * Per-compilation-unit namespace for every runtime-global token a chunk emits.
 *
 * ## Why
 *
 * Two route chunks that coexist in one live document clobber each other,
 * because two INDEPENDENT namespaces are per-unit-local at compile time but
 * process-global at run time:
 *
 *   - **N1 — numeric node ids.** `ast-builder.js`'s node-id counter restarts at
 *     0 for every compilation unit, so two routes both emit `each_9`,
 *     `_scrml_each_render_9`, `<!--scrml-each:9-->` and
 *     `_scrml_each_renderers["each_9"]`. The renderer registry is one shared
 *     object, so whichever chunk evaluates last wins — and it then renders ITS
 *     rows into the OTHER page's fence.
 *
 *   - **N2 — reactive cell keys.** The cell store is keyed by the SOURCE-LEVEL
 *     cell name, so two routes that both declare `<rows>` share one slot. This
 *     collides with no numeric coincidence at all: N1 alone is not a fix.
 *
 * Empirically proven in real Chromium with NO navigation — just the
 * `await import()` a soft-nav loader performs
 * (`docs/changes/esm-chunks/u4-premise-check/`). It is MODULE-FORMAT-AGNOSTIC:
 * ES-module scope isolates only the LEXICAL collision, while the colliding
 * state lives in the runtime, which is a singleton by necessity (a forked cell
 * store / subscriber list / rehydrator registry would break reactivity).
 *
 * ## The token (RULED, S280 — do not re-litigate)
 *
 * `fnv1aHash(distRelativeSourcePath)` — the same §47.1.3 hash function the
 * content-addressed chunk filenames use, applied to path-IDENTITY rather than
 * content. 8 chars, lowercase base36.
 *
 * Rejected, and why:
 *   - **chunk basename** — NOT unique. `pages/driver/home.scrml` and
 *     `pages/dispatch/home.scrml` would namespace identically, failing in
 *     exactly the multi-page layout that needs this most.
 *   - **build index** — unstable across incremental builds; breaks
 *     content-addressed caching.
 *   - **content hash** — answers "has this changed?", not "which unit is
 *     this?". Churns every id on any one-line edit, and risks circularity if
 *     the emitted chunk is ever hashed, since the ids live in it.
 *
 * The path is expressed relative to the build's `outputBaseDir` (the longest
 * common directory of the input set), so the token is a function of the SOURCE
 * TREE — machine-independent and reproducible, preserving the §40.9.8
 * determinism contract.
 *
 * ## Always-on (RULED, S280)
 *
 * Namespacing applies to every app, including single-page ones that can never
 * collide. Conditional namespacing would mean two emit shapes to test, and the
 * condition ("can these chunks ever coexist?") is exactly the kind of predicate
 * that is wrong at the edges.
 *
 * ## The SSR/client agreement constraint
 *
 * `<!--scrml-each:N-->` is emitted into HTML while
 * `_scrml_each_renderers["each_N"]` is registered in JS. The namespace MUST be
 * identical on both sides and stable between the SSR pass and the client emit.
 * Both sides read the SAME module-level state, established once per file in
 * `codegen/index.ts`'s per-file loop, so they cannot diverge. A scheme that
 * derived the token independently in the two emitters would break rehydration
 * silently — invisible to a grep, catchable only by execution.
 *
 * ## Cell ownership is the EXPORTER's, not the importer's
 *
 * A cross-file imported engine/cell is the SAME instance across every importing
 * file (§51.0.A / §51.0.D singleton invariant) — the mechanism is precisely
 * that all files read one shared `_scrml_state` slot under the bare source
 * name. Namespacing a cell key by the CONSUMING file would break that. So
 * `nsCell()` resolves through a per-unit owner map: a name bound by an import
 * keys under the EXPORTER's token; everything else keys under this unit's.
 */

import { fnv1aHash } from "./fnv1a-hash.ts";

/**
 * The subset of a MOD export-registry entry this module reads. Deliberately
 * structural rather than an import of `codegen/index.ts`'s
 * `CrossModuleExportRegistry` — that type is module-local there, and a wider
 * shape would drag routing-discrimination fields into a module that has no
 * business making routing decisions.
 */
interface ExportEntryShape {
  kind: string;
  category: string;
}

/** Separator between the namespace token and a numeric node id. */
const ID_SEP = "_";
/** Separator between the namespace token and a cell name. */
const CELL_SEP = "$";

/**
 * POSIX-normalize a path and express it relative to `outputBaseDir`.
 *
 * `outputBaseDir` is `computeOutputBaseDir(inputFiles)` — the longest common
 * directory of the compile's input set (for a single input, its dirname). The
 * result is therefore a SOURCE-TREE-relative path: stable across machines and
 * checkouts, unique per compilation unit within a build by construction.
 *
 * Falls back to the bare filename when no base dir is available (synthetic
 * unit-test ASTs, single-file in-memory compiles).
 */
export function distRelativeSourcePath(
  sourcePath: string,
  outputBaseDir: string | null | undefined,
): string {
  const posix = String(sourcePath ?? "").replace(/\\/g, "/");
  if (!posix) return "";
  const base = outputBaseDir ? String(outputBaseDir).replace(/\\/g, "/").replace(/\/+$/, "") : "";
  if (base && posix.startsWith(base + "/")) return posix.slice(base.length + 1);
  if (base && posix === base) return posix;
  // Not under the base dir (or no base dir) — fall back to the last segment.
  const slash = posix.lastIndexOf("/");
  return slash === -1 ? posix : posix.slice(slash + 1);
}

/**
 * The namespace token for one compilation unit: 8-char lowercase base36
 * FNV-1a of its dist-relative source path.
 */
export function chunkNamespaceToken(
  sourcePath: string,
  outputBaseDir: string | null | undefined,
): string {
  const rel = distRelativeSourcePath(sourcePath, outputBaseDir);
  return rel ? fnv1aHash(rel) : "";
}

/** Per-compilation-unit namespace state. */
export interface ChunkNamespaceState {
  /** This unit's 8-char token, or "" when unknown (synthetic AST / unit test). */
  token: string;
  /**
   * Cell names this unit does NOT own, mapped to their fully-resolved key in
   * the shared store (`<exporterToken>$<exportedName>`). Populated from the
   * unit's import bindings × the MOD export registry.
   */
  cellOwners: Map<string, string>;
}

/** The empty state — emits exactly the pre-namespacing token shapes. */
function emptyState(): ChunkNamespaceState {
  return { token: "", cellOwners: new Map() };
}

let _state: ChunkNamespaceState = emptyState();

/**
 * Install `state` for the duration of `fn`, restoring the previous state
 * afterwards. Save-and-restore (rather than a bare setter) so a nested emit of
 * another unit's AST — the memoized cross-file dependency walk does this —
 * cannot leave the outer unit emitting under the inner unit's token.
 */
export function withChunkNamespace<T>(state: ChunkNamespaceState, fn: () => T): T {
  const prev = _state;
  _state = state;
  try {
    return fn();
  } finally {
    _state = prev;
  }
}

/** Install `state` until the next install/reset. Used by the per-file loop. */
export function setChunkNamespaceState(state: ChunkNamespaceState): void {
  _state = state;
}

/** Reset to the empty (un-namespaced) state. */
export function resetChunkNamespaceState(): void {
  _state = emptyState();
}

/** The active unit's token, or "" when none is installed. */
export function currentChunkNamespace(): string {
  return _state.token;
}

/**
 * Namespace a node id for use in an emitted identifier, registry key or HTML
 * marker: `24` → `"a1b2c3d4_24"`.
 *
 * The result is a valid JS identifier FRAGMENT (base36 is `[0-9a-z]`), so every
 * `X_${id}` / `X:${id}` / `X["X_${id}"]` emission site namespaces by pure
 * substitution. With no active namespace it returns the bare id, so synthetic
 * unit tests see today's output unchanged.
 */
export function nsId(id: number | string): string {
  return _state.token ? `${_state.token}${ID_SEP}${id}` : String(id);
}

/**
 * Namespace a reactive-cell store key: `"rows"` → `"a1b2c3d4$rows"`.
 *
 * DOTTED keys (`"form.name.isValid"` — the §6.3.2 structural-compound walk)
 * namespace their ROOT only, so the runtime's dotted delegation still splits on
 * `.` and finds `a1b2c3d4$form` then walks `.name.isValid`. The separator is
 * `$` precisely because it is not `.` and cannot perturb that split.
 *
 * A name bound by an import resolves to the EXPORTER's key, preserving the
 * §51.0.A/§51.0.D cross-file singleton invariant.
 */
export function nsCell(name: string): string {
  const raw = String(name ?? "");
  if (!raw) return raw;
  const dot = raw.indexOf(".");
  const root = dot === -1 ? raw : raw.slice(0, dot);
  const rest = dot === -1 ? "" : raw.slice(dot);
  const owned = _state.cellOwners.get(root);
  if (owned) return owned + rest;
  if (!_state.token) return raw;
  return `${_state.token}${CELL_SEP}${root}${rest}`;
}

/**
 * `nsCell` applied to an already-JSON-quoted key. Convenience for the emission
 * sites that build `_scrml_reactive_get(${JSON.stringify(name)})`.
 */
export function nsCellLiteral(name: string): string {
  return JSON.stringify(nsCell(name));
}

/**
 * Recover the author-facing cell name from a namespaced key. The inverse of
 * `nsCell` for diagnostics, devtools labels and error-boundary messages, which
 * must show `rows` and never `a1b2c3d4$rows`.
 */
export function stripCellNamespace(key: string): string {
  const raw = String(key ?? "");
  const sep = raw.indexOf(CELL_SEP);
  if (sep !== 8) return raw; // tokens are exactly 8 chars
  const token = raw.slice(0, sep);
  return /^[0-9a-z]{8}$/.test(token) ? raw.slice(sep + 1) : raw;
}

/**
 * Build the per-unit state for `fileAST`.
 *
 * `importBindings` lives on the SYM-attached scope, which hangs off the INNER
 * `ast` for the wrapper-shaped `fileAST` codegen carries (`fileAST.ast._scope`)
 * — mirroring the same wrapper-vs-inner fallback `collectCrossFileEngineMounts`
 * needs. `exportRegistry` is keyed by the exporter's ABSOLUTE path, which is
 * also what `importBindings.sourcePath` resolves to once run through the module
 * resolver; both key shapes are tried, as unit-test harnesses build the
 * registry with relative keys.
 */
export function buildChunkNamespaceState(
  fileAST: unknown,
  outputBaseDir: string | null | undefined,
  exportRegistry?: Map<string, Map<string, ExportEntryShape>> | null,
): ChunkNamespaceState {
  const filePath = (fileAST as { filePath?: string } | null)?.filePath ?? "";
  const token = chunkNamespaceToken(filePath, outputBaseDir);
  const cellOwners = new Map<string, string>();

  const scope =
    (fileAST as { _scope?: unknown } | null)?._scope ??
    (fileAST as { ast?: { _scope?: unknown } } | null)?.ast?._scope ??
    null;
  const importBindings = (scope as { importBindings?: Map<string, { exportedName?: string; sourcePath?: string }> } | null)
    ?.importBindings;

  if (importBindings && importBindings.size > 0 && exportRegistry) {
    for (const [localName, binding] of importBindings) {
      const sourcePath = binding?.sourcePath;
      if (typeof sourcePath !== "string" || !sourcePath) continue;
      const exportedName = binding?.exportedName ?? localName;
      const resolved = resolveExporterPath(sourcePath, filePath, exportRegistry);
      if (!resolved) continue;
      const entry = exportRegistry.get(resolved)?.get(exportedName);
      // Only STATEFUL exports live in the shared cell store. A pure `fn` or a
      // `type` export is a lexical binding and never keys the store.
      if (!entry || !isCellBackedCategory(entry.category, entry.kind)) continue;
      const exporterToken = chunkNamespaceToken(resolved, outputBaseDir);
      if (!exporterToken) continue;
      cellOwners.set(localName, `${exporterToken}${CELL_SEP}${exportedName}`);
    }
  }

  return { token, cellOwners };
}

/**
 * Which export categories are backed by a `_scrml_state` cell slot. Kept
 * deliberately narrow: a category that is NOT cell-backed must not enter the
 * owner map, or an ordinary imported `fn` name would shadow a same-named local
 * cell's key.
 */
function isCellBackedCategory(category: string, kind: string): boolean {
  return (
    category === "engine" ||
    category === "cell" ||
    category === "reactive" ||
    category === "state" ||
    kind === "engine" ||
    kind === "cell"
  );
}

/**
 * Resolve an import's literal `sourcePath` to the key `exportRegistry` uses.
 * Tries the literal first (unit-test harnesses key relatively), then the
 * module-resolver's absolute form (the production shape).
 */
function resolveExporterPath(
  sourcePath: string,
  importerPath: string,
  exportRegistry: Map<string, Map<string, unknown>>,
): string | null {
  if (exportRegistry.has(sourcePath)) return sourcePath;
  if ((sourcePath.startsWith("./") || sourcePath.startsWith("../")) && importerPath) {
    try {
      // Lazy require — keeps this module's static import surface to the hash
      // primitive alone (it is also the shape the self-host rewrite wants).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { resolveModulePath } = require("../module-resolver.js");
      const abs: string = resolveModulePath(sourcePath, importerPath);
      if (exportRegistry.has(abs)) return abs;
    } catch {
      // resolver unavailable — fall through
    }
  }
  return null;
}
