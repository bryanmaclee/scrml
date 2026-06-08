/**
 * @module codegen/runtime-chunks
 *
 * RUNTIME_CHUNKS — named subsections of SCRML_RUNTIME for tree-shaking.
 *
 * Splits the monolithic SCRML_RUNTIME string into named chunks by searching
 * for unique section marker strings. Each chunk corresponds to a runtime
 * feature group. Chunks are assembled in `emit-client.ts` based on what the
 * compiled scrml file actually uses.
 *
 * Always-included chunks: 'core', 'scope', 'errors', 'transitions'
 * (Pre-populated in makeCompileContext() in context.ts.)
 *
 * Conditionally-included chunks: all others.
 * (Added by detectRuntimeChunks() in emit-client.ts.)
 *
 * Chunk → runtime functions:
 *   core          _scrml_state, _scrml_subscribers, _scrml_reactive_get/set/subscribe/propagate_dirty
 *   wire          _scrml_wire_decode (§57 dual-decoder, v0.3.x SPA tree-shake Phase B 3.2).
 *                 Only referenced by emitted server-fn fetch stubs
 *                 (`emit-functions.ts` + `atom-emitter.ts`). Tree-shaken when
 *                 the compile unit has no `function-decl` with `isServer:true`
 *                 AND no `use foreign:` use-decl.
 *   reset         _scrml_default_set/_fns, _scrml_init_set/_fns, _scrml_reset (§6.8)
 *   validators    14 universal-core fire functions, VALIDATOR_RUNTIME map,
 *                 _scrml_validator_fire (§55.1, C7) — inlined verbatim from
 *                 compiler/src/runtime-validators.js
 *   derived       _scrml_derived_declare/subscribe/get, flush
 *   lift          _scrml_lift
 *   scope         _scrml_cleanup_registry, _scrml_register_cleanup, _scrml_destroy_scope
 *   timers        _scrml_timer_start/stop/pause/resume/stop_scope_timers
 *   animation     _scrml_animation_frame, _scrml_cancel_animation_frames, animationFrame
 *   reconciliation _scrml_reconcile_list, _scrml_lis
 *   utilities     _scrml_deep_set, _scrml_reactive_debounced,
 *                 _scrml_reactive_throttled (S79 — §6.13 reactivity attr),
 *                 _scrml_reactivity_cancel + _scrml_reactivity_timers + _scrml_throttle_state
 *                 (S79 — per-cell timer registry; consumed by _scrml_reset for cancel-on-reset),
 *                 _scrml_reactive_explicit_set, _scrml_upload, _scrml_navigate
 *                 (S81 OQ-2 2026-05-11: `_scrml_debounce` + `_scrml_throttle`
 *                 RETIRED — imperative `debounce(fn,ms)`/`throttle(fn,ms)` keyword-
 *                 calls replaced by stdlib `scrml:time` imports. State-cell
 *                 timing still flows through the `_scrml_throttle_state` +
 *                 `_scrml_reactive_debounced`/`_scrml_reactive_throttled` path.)
 *   meta          _scrml_meta_emit, _scrml_tracking_stack, _scrml_meta_effect
 *   transitions   Transition CSS injection IIFE (scrml-fade/slide/fly animations)
 *   errors        _ScrmlError, NetworkError, ValidationError, SQLError, AuthError, etc.
 *   input         _scrml_input_keyboard/mouse/gamepad_create/destroy
 *   equality      _scrml_structural_eq
 *   deep_reactive _scrml_track, _scrml_trigger, _scrml_deep_reactive (Proxy),
 *                 _scrml_effect, _scrml_effect_static, _scrml_computed
 *   messages      _scrml_messages_inline/_registered, _scrml_messages_register,
 *                 _scrml_messages_register_inline, _scrml_message_for,
 *                 _SCRML_DEFAULT_MESSAGES, _SCRML_TAG_TO_VALIDATOR (§55.10, C10)
 *   engine        _scrml_engine_check_transition, _scrml_engine_advance,
 *                 _scrml_engine_direct_set (§51.0.F + §51.0.G, C13).
 *                 Tree-shaken when usage.engines is false.
 *   map           _scrml_fnv1a, _scrml_value_canonical, _scrml_map_* (§59
 *                 value-native maps: from_entries/get/has/get_or/insert/remove/
 *                 update/insert_all/size/keys/values/entries/sorted/sorted_by +
 *                 encode/decode + empty/clone/set_inplace/key_order internals).
 *                 Tree-shaken when the compile unit uses no map. The map ==
 *                 BRANCH lives in `equality` (_scrml_structural_eq), not here.
 *   prefetch      _scrml_prefetch_tier1 (§40.9.7 tier-1 idle prefetch, A-4.3) +
 *                 _scrml_prefetch_tier2 + _SCRML_CHUNKS manifest scaffold
 *                 (§40.9.7 tier-2 hover prefetch, A-4.4) +
 *                 _scrml_fetch_chunk(epId, role, tier) (§40.9.7 tier-N
 *                 on-demand dispatch hook, A-4.5 — structurally shipped,
 *                 never fires in v0.3 per OQ-A2-B Option a + OQ-A4-D Option a).
 *
 *                 The `prefetch` chunk groups ALL THREE prefetch/dispatch
 *                 surfaces (tier-1 idle, tier-2 hover, tier-N on-demand)
 *                 under ONE tree-shake gate. Single-marker design (A-4.4 +
 *                 A-4.5 decision): adding sibling markers would let us
 *                 tree-shake the three functions independently, but in
 *                 practice apps that use any of them almost always use
 *                 at least tier-1. Single chunk keeps the marker table
 *                 simpler.
 *
 *                 Tree-shaken when ALL of:
 *                   • no chunk has non-empty tier-1 admission
 *                   • no chunk has non-empty tier-N admission
 *                   • no `<a data-scrml-prefetch>` was emitted in any
 *                     HTML file for this compile unit (i.e. no internal
 *                     `<a href>` linked to a known route).
 *                 `detectRuntimeChunks` reads `ctx.hasPrefetchableLinks`
 *                 (A-4.4; set by `emit-html.ts`) plus per-(EP, role)
 *                 tier-1 / tier-N admission scans (A-4.3 + A-4.5);
 *                 any signal lights up the chunk.
 *                 OQ-A4-G ratification (S91): Option γ — `requestIdleCallback`
 *                 browser-side with `setTimeout(fn, 1)` Safari fallback;
 *                 Bun-runtime primitive reserved as v0.4 extension point.
 *   mount         _scrml_chunk_mount(id, tag) + _SCRML_MOUNTS registry
 *                 (§40.9.7, A-4.7). Chunk-side record-keeping for
 *                 admitted markup nodes. Activated by
 *                 detectRuntimeChunks when ANY entry-point chunk in
 *                 the file's reachability record admits a non-empty
 *                 markup-node set. Elided when no chunks emit
 *                 atom-emitter mount calls.
 *   vendor-ref    _scrml_vendor_require(unit) + _SCRML_VENDOR_REFS
 *                 registry (§41, A-4.7). Chunk-side record-keeping
 *                 for vendor-unit dependencies. Activated when ANY
 *                 entry-point chunk admits a non-empty vendorUnitNames
 *                 set. Elided when no chunks emit vendor-require calls.
 */

import { SCRML_RUNTIME } from "../runtime-template.js";

// ---------------------------------------------------------------------------
// Chunk ordering — must match the order chunks appear in SCRML_RUNTIME.
// Assembly in emit-client.ts uses this order.
// ---------------------------------------------------------------------------

export const RUNTIME_CHUNK_ORDER = [
  'core',
  'wire',
  'reset',
  'validators',
  'derived',
  'lift',
  'scope',
  'timers',
  'animation',
  'reconciliation',
  'utilities',
  'prefetch',
  'mount',
  'vendor-ref',
  'modules',
  'meta',
  'transitions',
  'errors',
  'input',
  'equality',
  'deep_reactive',
  'messages',
  'engine',
  'map',
  'log',
  // Stdlib registry chunks — inlined from compiler/runtime/stdlib/<name>.js
  // via _scrml_stdlib.<name>. Activated per-file by detectRuntimeChunks when
  // the source file imports from the matching `scrml:<name>` specifier.
  // Server-only stdlibs (store) are intentionally absent — the server path
  // continues to use the bundleStdlibForRun + rewriteStdlibImports route.
  'stdlib-auth',
  'stdlib-crypto',
  'stdlib-data',
  'stdlib-host',
] as const;

export type RuntimeChunkName = (typeof RUNTIME_CHUNK_ORDER)[number];

// ---------------------------------------------------------------------------
// Chunk boundary markers.
//
// Each value is a short substring that appears EXACTLY ONCE in SCRML_RUNTIME
// and marks the start of the corresponding chunk. 'core' has no marker —
// it is everything before the first boundary.
//
// SYNTAX SAFETY REQUIREMENT: Each marker must be at a position where:
//   1. The previous chunk ends with syntactically complete JavaScript, AND
//   2. The new chunk starts with syntactically complete JavaScript.
//
// Safe marker types:
//   - §X.X spec references in single-line comments (// §X.X ...).
//     The split happens after the '// ' prefix which stays in the previous chunk.
//     Both chunks have valid JS: previous ends with empty comment, new starts mid-comment.
//   - 'function _name' at function declaration starts.
//     Previous chunk ends after the preceding function's closing brace.
//     New chunk starts with a complete function declaration.
//
// UNSAFE: Splitting inside a block comment (/* ... */). The opening /* would
// be in the previous chunk without a closing */, causing a syntax error.
//
// These markers were verified against runtime-template.js on 2026-04-06.
// If the runtime is restructured, update these markers accordingly.
// ---------------------------------------------------------------------------

type NonCoreChunkName = Exclude<RuntimeChunkName, 'core'>;

const CHUNK_MARKERS: Record<NonCoreChunkName, string> = {
  // §X.X section header comments — each appears exactly once, in a // comment line.
  // Split position is mid-comment-line (after '// '). Both sides are valid JS.

  // v0.3.x SPA tree-shake (Phase B 3.2) — `wire` chunk gates the §57 dual-
  // decoder (`_scrml_wire_decode`). The helper is only referenced from
  // emitted server-fn fetch stubs (emit-functions.ts + atom-emitter.ts);
  // SPA-shape compile units with zero server-fns ship without it.
  // Activated by `detectRuntimeChunks` when ANY file in the compile unit
  // contains a server `function-decl` OR a `use foreign:` use-decl.
  wire:           "§57 Wire Format dual-decoder (chunk: 'wire')",
  reset:          "§6.8 reset+default runtime (chunk: 'reset')",
  validators:     "§55.1 Validator predicate runtime catalog (chunk: 'validators')",
  derived:        '§6.6 Derived reactive runtime',
  scope:          '§6.7.3 Scope-aware cleanup registry',
  timers:         '§6.7.5 / §6.7.6 Timer and Poll runtime',
  animation:      '§6.7.7 animationFrame runtime',
  // Section marker covers BOTH §40.9.7 tier-1 idle-prefetch (A-4.3) AND
  // §40.9.7 tier-2 hover-prefetch (A-4.4). The chunk's content runs from
  // the tier-1 marker through to the next chunk's marker (`meta`); both
  // runtime functions plus the `_SCRML_CHUNKS` manifest scaffold sit in
  // that range. See chunk-catalog block above for the single-marker
  // rationale.
  prefetch:       "§40.9.7 tier-1 idle prefetch runtime (chunk: 'prefetch')",
  // A-4.7 — chunk-side mount registry. Activated when ANY entry-point
  // chunk in the file's reachability record admits a non-empty
  // markup-node admission set (i.e. atom-emitter.ts:emitComponentAtom
  // produces `_scrml_chunk_mount(...)` calls in at least one chunk).
  mount:          "§40.9.7 chunk mount registry (chunk: 'mount')",
  // A-4.7 — chunk-side vendor-unit reference registry. Activated when
  // ANY entry-point chunk in the file's reachability record admits a
  // non-empty `vendorUnitNames` set (i.e. atom-emitter.ts emits
  // `_scrml_vendor_require(...)` calls in at least one chunk).
  "vendor-ref":   "§41 vendor-unit reference registry (chunk: 'vendor-ref')",
  modules:        "§21.3 cross-file module registry (chunk: 'modules')",
  meta:           '§22.5 meta.emit() runtime',
  transitions:    'Transition CSS injection',
  errors:         '§19 Built-in error types',
  input:          '§35.1 Global input state registry',
  equality:       '§45 Structural equality',
  deep_reactive:  'Fine-grained reactivity primitives (Reactivity Phase 1)',
  messages:       "§55.10 Error message resolution runtime (chunk: 'messages')",
  engine:         "§51.0.F + §51.0.G Engine state-machine runtime hooks (chunk: 'engine')",
  // §59 Value-Native Maps — gates the _scrml_map_* helpers (+ _scrml_value_canonical
  // + _scrml_fnv1a). Activated by detectRuntimeChunks when a compile unit USES a
  // map (a `[KeyT:ValT]` cell / map literal / map method). Tree-shaken otherwise —
  // without this marker a map-using build would ReferenceError on _scrml_map_get
  // (the helpers would not be in the assembled runtime). _scrml_structural_eq's
  // map == branch lives in the always-or-equality-gated `equality` chunk, not here.
  map:            "§59 Value-Native Maps runtime (chunk: 'map')",
  // §20.6 — location-transparent log() builtin runtime. Gates `_scrml_log`
  // + the readable value-faithful renderer `_scrml_log_render`. Activated by
  // a POST-EMIT scan (emit-client.ts / emit-server.ts) when the emitted JS
  // actually contains a `_scrml_log(` call — so a SHADOWED `log` (no builtin
  // lowering) and a PRODUCTION-stripped build (log() -> 0 bytes) both omit
  // the chunk, keeping the prod bundle free of any _scrml_log reference.
  log:            "§20.6 log() location-transparent logging runtime (chunk: 'log')",

  // Function definition markers — 'function _name' starts at a line boundary.
  // Previous chunk ends after the preceding function/IIFE closing brace.
  // New chunk starts with a complete function declaration. Both sides are valid JS.
  lift:           'function _scrml_lift',
  reconciliation: 'function _scrml_reconcile_list',
  utilities:      'function _scrml_deep_set',

  // Stdlib chunk markers — each shim is emitted as `// --- chunk: stdlib-<name> ---`
  // by `_loadStdlibChunk` in runtime-template.js. Each marker appears exactly
  // once. The previous chunk's content ends with the closing `}` of the
  // preceding IIFE (or, for the FIRST stdlib, with the engine chunk's last
  // function), so the boundary is at a syntactically clean position.
  "stdlib-auth":   "--- chunk: stdlib-auth ---",
  "stdlib-crypto": "--- chunk: stdlib-crypto ---",
  "stdlib-data":   "--- chunk: stdlib-data ---",
  "stdlib-host":   "--- chunk: stdlib-host ---",
};

// ---------------------------------------------------------------------------
// buildRuntimeChunks — splits SCRML_RUNTIME into named chunk strings.
// ---------------------------------------------------------------------------

function buildRuntimeChunks(): Record<RuntimeChunkName, string> {
  // Locate each chunk boundary in SCRML_RUNTIME
  const positions: Array<{ name: NonCoreChunkName; idx: number }> = [];

  for (const [name, marker] of Object.entries(CHUNK_MARKERS) as Array<[NonCoreChunkName, string]>) {
    const idx = SCRML_RUNTIME.indexOf(marker);
    if (idx === -1) {
      // Warn but don't crash — a missing marker means the chunk falls back to
      // the previous chunk boundary, and the runtime still works (just not tree-shaken).
      // This should never happen unless runtime-template.js was edited without
      // updating CHUNK_MARKERS.
      if (typeof console !== "undefined") {
        console.warn(`[scrml runtime-chunks] Marker not found for chunk "${name}": "${marker}". Tree-shaking will be disabled for this chunk.`);
      }
      continue;
    }

    // v0.3.x SPA tree-shake Phase B (2026-05-15) — back the chunk start up
    // to include the line-comment prefix for markers that fall mid-line
    // inside a `// ...` line comment. Pre-Phase-B, the splitter docs
    // claimed "the '// ' prefix stays in the previous chunk" — that worked
    // when the previous chunk was always included (shared-runtime path)
    // but breaks the moment an adjacent chunk gets tree-shaken: the next
    // included chunk then opens with a bare marker token (e.g. `§X.X` or
    // `Transition`) which is a JS syntax error. By absorbing the `// `
    // into THIS chunk's start, each chunk's content is self-contained as
    // valid JS regardless of which neighbours are included or omitted.
    //
    // Function-name markers (`'function _scrml_lift'`, etc.) start at a
    // function-declaration boundary already and need no shift; we detect
    // them by checking the start of the marker text.
    let chunkStart = idx;
    if (!marker.startsWith("function ")) {
      // Walk backward to the start of THIS line, then search forward for
      // the line's `//` prefix. The line layout is uniformly
      // `// <decoration>? <marker> ...`, where decoration may be empty
      // (`// §X.X ...`) or contain dashes (`// --- Transition CSS ...`).
      // Absorbing the line-comment prefix into THIS chunk's start makes
      // each chunk's content self-contained as valid JS regardless of
      // which neighbours are included or omitted.
      let lineStart = idx;
      while (lineStart > 0 && SCRML_RUNTIME[lineStart - 1] !== "\n") lineStart--;
      const slashSlashIdx = SCRML_RUNTIME.indexOf("//", lineStart);
      if (slashSlashIdx !== -1 && slashSlashIdx < idx) {
        chunkStart = slashSlashIdx;
      }
    }
    positions.push({ name, idx: chunkStart });
  }

  // Sort by ascending position
  positions.sort((a, b) => a.idx - b.idx);

  const chunks: Partial<Record<RuntimeChunkName, string>> = {};

  // 'core' is everything before the first boundary
  chunks.core = positions.length > 0
    ? SCRML_RUNTIME.slice(0, positions[0].idx)
    : SCRML_RUNTIME;

  // Each subsequent chunk runs from its marker start to the next marker's start
  for (let i = 0; i < positions.length; i++) {
    const chunkStart = positions[i].idx;
    const chunkEnd = i + 1 < positions.length ? positions[i + 1].idx : SCRML_RUNTIME.length;
    chunks[positions[i].name] = SCRML_RUNTIME.slice(chunkStart, chunkEnd);
  }

  // Fill in any chunks that had missing markers with empty string
  // so downstream code doesn't crash on undefined access.
  for (const name of RUNTIME_CHUNK_ORDER) {
    if (chunks[name] === undefined) {
      chunks[name] = '';
    }
  }

  return chunks as Record<RuntimeChunkName, string>;
}

export const RUNTIME_CHUNKS: Record<RuntimeChunkName, string> = buildRuntimeChunks();

// ---------------------------------------------------------------------------
// CHUNK_DEPENDENCIES — declarative cross-chunk dependency edges.
//
// 6nz Bug P (S124, 2026-05-23): a function in chunk A may call a function in
// chunk B. If A is included but B is tree-shaken, the resulting runtime has
// an unresolved reference and crashes at first invocation. This table
// records the edges so `applyChunkDependencies` can transitively pull
// dependent chunks before assembly.
//
// Maintenance: when a new cross-chunk call is added to runtime-template.js,
// add the edge here. The audit shape is: for each function in chunk A's
// body, list every `_scrml_*` call whose definition lives in a chunk other
// than A. If that other chunk is conditional and A is always-included (or
// transitively reachable from an always-included chunk), the edge MUST be
// recorded here.
//
// Edges as of S124:
//
//   scope → {timers, animation}
//     `_scrml_destroy_scope` (scope chunk, always-included) calls
//     `_scrml_stop_scope_timers` (timers chunk) and
//     `_scrml_cancel_animation_frames` (animation chunk). When a compile
//     unit had no timer/animation-frame usage, both target chunks were
//     tree-shaken and `_scrml_destroy_scope` crashed on first scope
//     teardown — symptom: `ReferenceError: _scrml_stop_scope_timers is
//     not defined` on every reactive scope cleanup, killing all
//     subsequent reactive effects (6nz Bug P, every adopter app).
//
// Forward note: declaring an edge here makes the target chunk effectively
// always-included whenever the source is. For `scope → timers/animation`
// this is correct (scope is unconditionally seeded — see context.ts:211 —
// so the conditional gates on timers/animation in detectRuntimeChunks
// become moot for chunk-set composition, though they remain useful as
// documentation of which features pull the chunk for non-transitive
// reasons). For future edges where the source is itself conditional, the
// closure logic correctly propagates only when the source actually fires.
// ---------------------------------------------------------------------------

export const CHUNK_DEPENDENCIES: Partial<Record<RuntimeChunkName, RuntimeChunkName[]>> = {
  scope: ['timers', 'animation'],
};

// Pulls all transitive chunk dependencies into the set in place. Returns
// the set for chaining. Safe to call repeatedly (idempotent). Called once
// at the end of `detectRuntimeChunks` (emit-client.ts) before chunk-set
// consumption.
export function applyChunkDependencies(chunks: Set<string>): Set<string> {
  // Fixed-point iteration — current dep set is shallow (max depth 1) but
  // the loop tolerates future deeper chains without re-engineering.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [src, deps] of Object.entries(CHUNK_DEPENDENCIES)) {
      if (!chunks.has(src) || !deps) continue;
      for (const dep of deps) {
        if (!chunks.has(dep)) {
          chunks.add(dep);
          changed = true;
        }
      }
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// assembleRuntime — produce the runtime string from a set of chunk names.
//
// Chunks are assembled in RUNTIME_CHUNK_ORDER so the output is always in the
// correct dependency order regardless of the order chunks were registered.
// ---------------------------------------------------------------------------

export function assembleRuntime(chunkNames: Set<string>): string {
  return RUNTIME_CHUNK_ORDER
    .filter(name => chunkNames.has(name))
    .map(name => RUNTIME_CHUNKS[name] ?? '')
    .join('');
}
