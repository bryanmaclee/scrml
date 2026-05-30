import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/**
 * Phase A1c Step C7 — pull the validator predicate runtime catalog into
 * SCRML_RUNTIME at module-load time. The validator runtime is authored as a
 * standalone ESM module (compiler/src/runtime-validators.js) so C6's tests can
 * import its functions directly. The compiled client runtime (the SCRML_RUNTIME
 * string emitted alongside every .client.js) needs the SAME functions inlined
 * as plain JavaScript so the runner emitted by C7 codegen can call them.
 *
 * Strategy: read the validator-runtime source verbatim and strip the leading
 * `export ` keyword from each top-level declaration. The result is plain JS
 * suitable for inlining inside the runtime template literal. This keeps
 * `runtime-validators.js` as the single source-of-truth — there is no
 * duplication; the chunk content is the live module's source bytes (sans
 * `export `).
 *
 * The `^export ` regex strip is safe — every `export` in `runtime-validators.js`
 * appears at column 0 (verified by grep at S73 land).
 */
const __runtime_template_dir = dirname(fileURLToPath(import.meta.url));
const _VALIDATOR_RUNTIME_SOURCE = readFileSync(
  join(__runtime_template_dir, "runtime-validators.js"),
  "utf8",
).replace(/^export /gm, "");

/**
 * Stdlib shim loader. Reads a hand-written `compiler/runtime/stdlib/<name>.js`
 * shim, strips `export ` prefixes, collects the exported names, and produces
 * a runtime chunk string that registers the names on `_scrml_stdlib.<name>`.
 *
 * The emitted shape is an IIFE so the inlined function declarations stay
 * scoped — they don't pollute the global classic-script namespace.
 *
 * Mirrors the validator-runtime pattern (line 23-27 above): the on-disk
 * shim file is the single source of truth. Server-emit consumes it via
 * `compileScrml`'s `bundleStdlibForRun` (copies the file into
 * `<outputDir>/_scrml/<name>.js`); client-emit consumes it through this
 * inline path so the browser does not see a bare `import { x } from
 * "scrml:NAME"` (which fails — see Bug 18, S95).
 *
 * Const-named export support: a shim may export non-function bindings via
 * `export const Name = ...`. The loader collects both forms.
 */
function _loadStdlibChunk(name) {
  const shimPath = join(__runtime_template_dir, "../runtime/stdlib", `${name}.js`);
  const source = readFileSync(shimPath, "utf8");
  const exportedNames = [];
  const fnRe = /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = fnRe.exec(source)) !== null) exportedNames.push(m[2]);
  const constRe = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = constRe.exec(source)) !== null) exportedNames.push(m[1]);
  // Strip `export ` from top-level declarations AND any top-level `import ...`
  // statements. Inlining a shim inside an IIFE for the classic-script runtime
  // disallows ES-module syntax; functions that referenced an imported symbol
  // (e.g. \`bun:sqlite\`'s Database) will throw at first call in the browser,
  // which mirrors today's loud-failure pattern for server-only stdlib paths
  // reaching client emission.
  const stripped = source
    .replace(/^export /gm, "")
    .replace(/^import[\s\S]*?;[ \t]*$\n?/gm, "");
  return (
    `// --- chunk: stdlib-${name} ---\n` +
    `_scrml_stdlib.${name} = (function() {\n` +
    stripped + "\n" +
    `  return { ${exportedNames.join(", ")} };\n` +
    `})();\n`
  );
}

// Inline a stdlib chunk for each shim that ships in compiler/runtime/stdlib/.
// `store` is intentionally excluded — its shim is a bun:sqlite wrapper with
// no browser-callable surface; client-side use is meaningless. Server-side
// access continues through the `bundleStdlibForRun` path (api.js) which
// copies the shim to `<outputDir>/_scrml/store.js`.
const _STDLIB_AUTH_CHUNK   = _loadStdlibChunk("auth");
const _STDLIB_CRYPTO_CHUNK = _loadStdlibChunk("crypto");
const _STDLIB_DATA_CHUNK   = _loadStdlibChunk("data");
const _STDLIB_HOST_CHUNK   = _loadStdlibChunk("host");

/**
 * scrml reactive runtime — shared runtime library.
 *
 * This module exports the runtime source as a string constant. The code generator
 * uses it in two modes:
 *
 *   1. External mode (default): The runtime is written once to `dist/scrml-runtime.js`.
 *      Each `.client.js` file starts with `// Requires: scrml-runtime.js` and does NOT
 *      embed the runtime. The HTML document wrapper includes a `<script>` tag for the
 *      runtime BEFORE the app script.
 *
 *   2. Embedded mode (`--embed-runtime`): The runtime is inlined at the top of every
 *      `.client.js` file. This is the legacy behavior, useful for single-file distribution.
 *
 * To modify the runtime, edit the SCRML_RUNTIME string below. All compiled output
 * shares this single source of truth.
 *
 * §6.6 implementation notes:
 *   - _scrml_derived_declare(name, fn) — registers derived node, marks dirty for initial eval
 *   - _scrml_derived_subscribe(derived, upstream) — registers dirty-propagation edge
 *   - _scrml_derived_get(name) — lazy pull: if dirty, re-evaluate + cache + clear flag; return cached
 *   - flush() — synchronous re-evaluation of all dirty derived nodes
 *   - _scrml_reactive_set now propagates dirty flags to downstream derived nodes (eager, synchronous)
 *   - _scrml_reactive_derived is RETIRED. Calling it will throw to fail loudly.
 *   - _scrml_reactive_subscribe now returns an unsubscribe function (() => void).
 *
 * §6.7.5/§6.7.6 implementation notes (timer/poll):
 *   - _scrml_timer_start(scopeId, timerId, intervalMs, bodyFn) — start interval timer
 *   - _scrml_timer_stop(scopeId, timerId) — stop (clearInterval)
 *   - _scrml_timer_pause(scopeId, timerId) — pause (suspend interval, preserve handle)
 *   - _scrml_timer_resume(scopeId, timerId) — resume (restart interval from now)
 *   - _scrml_destroy_scope now also cancels timers for that scope
 *
 * §6.7.7 implementation notes (animationFrame):
 *   - animationFrame(fn) — schedule fn via requestAnimationFrame, scope-registered
 *   - _scrml_animation_frame(fn) — internal implementation
 *   - _scrml_cancel_animation_frames(scopeId) — cancel all pending rAF for a scope
 *   - _scrml_destroy_scope now also cancels animation frames for that scope
 *
 * §22.5 meta.emit() runtime:
 *   - _scrml_meta_emit(scopeId, htmlString) — insert HTML at the ^{} block's placeholder position
 *
 * §22.5 meta reactive effects (4-argument form per SPEC §22.5):
 *   - _scrml_meta_effect(scopeId, fn, capturedBindings, typeRegistry)
 *     Run fn as a reactive effect. Auto-tracks @variable reads via a tracking stack.
 *     capturedBindings — frozen object with lexical bindings at ^{} breakout point.
 *     meta.types — { reflect(name) } accessor wrapping typeRegistry.
 *     Backward compatible: 2-argument calls still work (bindings/types default to null).
 *     Infinite loop guard: MAX_RUNS = 100. Scope cleanup registered with _scrml_register_cleanup.
 */

export const SCRML_RUNTIME = `// --- scrml reactive runtime ---
const _scrml_state = {};
const _scrml_subscribers = {};
// S103 Phase 3 select-row chip-away (Candidate A) — value-indexed sub-registry
// parallel to _scrml_subscribers. Predicate-shape binds emitted by emit-lift.js
// register here under their static valueKey (the constant they compare the cell
// to). At write time _scrml_reactive_set fires only the OLD-value bucket and
// the NEW-value bucket — O(2) per write instead of O(N) over all rows.
// Shape: { [name]: { [valueKey]: [fn, ...] } }
// TDZ-safe: declared next to _scrml_subscribers since state-decl substrates
// may write to cells during module-init before the helper functions resolve.
const _scrml_value_indexed_subscribers = {};
// scrml: stdlib registry — populated by per-stdlib chunks (see end of runtime).
// Client-emitted code rewrites \`import { x } from "scrml:NAME"\` to
// \`const { x } = _scrml_stdlib.NAME;\` (browser cannot resolve bare specifiers).
const _scrml_stdlib = {};

// ---------------------------------------------------------------------------
// P1.B — Per-op runtime instrumentation (SCOPING §2.2, S103).
//
// Gated on \`globalThis.__SCRML_DEBUG_PERF\`. When the flag is unset (the
// production path), \`__SCRML_PERF\` is null and every \`if (__SCRML_PERF)\`
// branch below collapses to a predictable null-check the JIT inlines away.
// When set, the runtime accumulates per-category ms + call counts and emits a
// breakdown via \`_scrml_perf_dump()\` on demand (or \`_scrml_perf_reset()\`
// between benchmark iterations).
//
// Categories tracked:
//   reactive_get        every _scrml_reactive_get call
//   reactive_set        every _scrml_reactive_set call (incl. timing-wrapped)
//   reconcile_list      every _scrml_reconcile_list call (keyed list diff)
//   notify_subscribers  the subscriber-fan-out loop inside _scrml_reactive_set
//   dom_write           DOM mutation calls inside _scrml_reconcile_list
//                       (appendChild / insertBefore / removeChild /
//                       replaceChildren)
//   effect_scheduling   reactive-effect re-runs (_scrml_trigger + _scrml_effect
//                       body)
//
// Verify zero-overhead empirically against AC1: warm-run delta < 1ms on a
// representative TodoMVC op.
const __SCRML_PERF = (typeof globalThis !== "undefined" && globalThis.__SCRML_DEBUG_PERF)
  ? {
      reactive_get:         { ms: 0, count: 0 },
      reactive_set:         { ms: 0, count: 0 },
      reconcile_list:       { ms: 0, count: 0 },
      notify_subscribers:   { ms: 0, count: 0 },
      notify_value_indexed: { ms: 0, count: 0 },
      dom_write:            { ms: 0, count: 0 },
      effect_scheduling:    { ms: 0, count: 0 },
    }
  : null;
const __SCRML_PERF_NOW = (typeof performance !== "undefined" && performance.now)
  ? function () { return performance.now(); }
  : function () { return Date.now(); };
function _scrml_perf_reset() {
  if (!__SCRML_PERF) return;
  for (const k in __SCRML_PERF) {
    __SCRML_PERF[k].ms = 0;
    __SCRML_PERF[k].count = 0;
  }
}
function _scrml_perf_snapshot() {
  if (!__SCRML_PERF) return null;
  const out = {};
  for (const k in __SCRML_PERF) {
    const c = __SCRML_PERF[k].count;
    const ms = __SCRML_PERF[k].ms;
    out[k] = { ms: ms, count: c, avgMs: c > 0 ? ms / c : 0 };
  }
  return out;
}
function _scrml_perf_dump(label) {
  if (!__SCRML_PERF) return;
  const snap = _scrml_perf_snapshot();
  const tag = label ? " [" + label + "]" : "";
  for (const k in snap) {
    const s = snap[k];
    if (s.count === 0) continue;
    console.log(
      "[SCRML-RUNTIME]" + tag + " " + k + ": " +
      s.ms.toFixed(3) + " (" + s.count + " calls, " +
      s.avgMs.toFixed(4) + " avg-ms-per-call)"
    );
  }
}
if (typeof globalThis !== "undefined") {
  globalThis._scrml_perf_reset = _scrml_perf_reset;
  globalThis._scrml_perf_snapshot = _scrml_perf_snapshot;
  globalThis._scrml_perf_dump = _scrml_perf_dump;
}

// S79 / §6.13 reactivity attribute registries — hoisted to module top to
// avoid TDZ when _scrml_reactive_set (called early during module-init by
// state-decl substrates) consults them. Implementations of the helpers
// that READ these registries live further down in the utilities chunk.
const _scrml_reactivity_timers = Object.create(null);
const _scrml_reactivity_rules = Object.create(null);
const _scrml_reactivity_bypass = Object.create(null);
const _scrml_throttle_state = Object.create(null);

// --- derived reactive state (§6.6) ---
// _scrml_derived_fns: name → () => value  (evaluation function for each derived node)
// _scrml_derived_cache: name → cached value
// _scrml_derived_dirty: name → boolean  (true = needs re-evaluation on next read)
// _scrml_derived_downstreams: upstream_name → Set of derived names  (dirty propagation edges)
const _scrml_derived_fns = {};
const _scrml_derived_cache = {};
const _scrml_derived_dirty = {};
const _scrml_derived_downstreams = {};

// --- default= storage (§6.8) ---
// _scrml_default_fns: name → () => default-value
// Registered by _scrml_default_set at module-init alongside the cell
// declaration. Read by reset(@cell) lowering (C5) to materialize the default
// when reset is invoked. Per SPEC §6.8.1 the default is the EXPRESSION (not
// a snapshot), so the closure is re-evaluated each reset.
//
// Parallel map (separate from _scrml_state / _scrml_derived_fns) so the
// existing reactive registries keep their shape stability.
//
// NOTE: this declaration LIVES in the 'core' chunk (no marker) so file-init
// _scrml_default_set(...) calls always resolve. The runtime helper that
// USES this map (_scrml_reset) lives in the 'reset' chunk further down.
const _scrml_default_fns = {};
function _scrml_default_set(name, fn) {
  _scrml_default_fns[name] = fn;
}

// --- init-thunk storage (§6.8 — C5) ---
// _scrml_init_fns: name -> () => init-value
// Registered by _scrml_init_set at module-init for each Shape 1 / Shape 2
// state-cell that does NOT carry a "default" attribute.
//
// Same chunk policy as _scrml_default_fns: declaration lives in 'core' so
// file-init _scrml_init_set(...) calls always resolve. The using helper
// (_scrml_reset) lives in 'reset' and is tree-shaken when no reset(@cell)
// occurs in the source.
const _scrml_init_fns = {};
function _scrml_init_set(name, fn) {
  _scrml_init_fns[name] = fn;
}

// --- machine temporal transitions (§51.12) ---
// _scrml_machine_timers: encodedVarName → timeout id for the currently-armed
// temporal transition. Transition-guard codegen clears any existing timer on
// state commit and arms a new one if the destination variant has outgoing
// temporal rules. Re-entering the same variant clears and re-arms (reset
// semantics per the deep-dive default).
const _scrml_machine_timers = {};
function _scrml_machine_clear_timer(name) {
  const id = _scrml_machine_timers[name];
  if (id !== undefined) {
    clearTimeout(id);
    delete _scrml_machine_timers[name];
  }
}
function _scrml_machine_arm_timer(name, ms, target, meta) {
  // meta (optional): { fromVariant, label, auditTarget, rulesJson, setterFn, getterName }
  //   fromVariant — the .From of the temporal rule being armed (used to
  //     build the audit 'rule' key on expiry: fromVariant + ":" + target).
  //   label — the rule's guard label if any, else null. Temporal rules
  //     currently do not take 'given' clauses, so this is conventionally
  //     null; the slot exists so a future temporal+guard syntax can slot
  //     straight in.
  //   auditTarget — the encoded reactive-var name of the machine's audit
  //     target (the 'audit @log' clause in the machine body), else null.
  //   rulesJson — the serialized temporal-rule list so the timer can
  //     re-arm on the downstream variant. Chained temporal rules
  //     (A after 1s => B, B after 1s => C) must continue automatically
  //     without the user driving transitions.
  //   setterFn  — A5-4 (§51.0.M onTimeout): an optional callback invoked
  //     INSTEAD of the bare _scrml_reactive_set(name, target) at expiry.
  //     Engine onTimeout codegen passes a function that routes the write
  //     through the engine's rule= contract guard (the engine helper in
  //     the 'engine' chunk; see §51.0.F + §51.0.G). When absent (the
  //     legacy machine path), the original _scrml_reactive_set write is
  //     used.
  //   getterName — A5-4: the encoded reactive-var name to read for the
  //     __prev audit entry. Defaults to name. Currently unused — reserved
  //     so a future shape (e.g., audit-target read) can opt out.
  //
  // S27 (§51.11): timer-fired transitions now push audit entries and
  // re-arm downstream temporal rules. Previously the timer invoked a
  // bare _scrml_reactive_set, bypassing both the audit clause and the
  // per-transition re-arm logic. This violated §51.11.6 "every
  // successful transition SHALL append" for temporal rules.
  _scrml_machine_clear_timer(name);
  _scrml_machine_timers[name] = setTimeout(function () {
    delete _scrml_machine_timers[name];
    const __prev = _scrml_reactive_get(name);
    if (meta && typeof meta.setterFn === "function") {
      // A5-4: engine-aware setter (routes through the engine's contract
      // guard so the rule= contract check fires; throws
      // E-ENGINE-INVALID-TRANSITION if the timer target violates the
      // contract — defensive, the compile-time check in A5-3 should already
      // have caught this).
      meta.setterFn(target);
    } else {
      _scrml_reactive_set(name, target);
    }
    if (meta && meta.auditTarget) {
      const entry = Object.freeze({
        from: __prev,
        to: target,
        at: Date.now(),
        rule: meta.fromVariant + ":" + target,
        label: meta.label != null ? meta.label : null,
      });
      _scrml_reactive_set(
        meta.auditTarget,
        (_scrml_reactive_get(meta.auditTarget) || []).concat([entry])
      );
    }
    if (meta && meta.rulesJson) {
      _scrml_machine_arm_initial(name, meta.rulesJson, meta.auditTarget);
    }
  }, ms);
}
function _scrml_machine_arm_initial(name, rulesJson, auditTarget) {
  // Called once per machine-bound reactive after its initial _scrml_reactive_set,
  // and also re-invoked from _scrml_machine_arm_timer's expiry path so that
  // chained temporal rules auto-advance. Inspects the current variant and arms
  // the first matching temporal rule, if any.
  //
  // auditTarget (optional, added S27) propagates the machine's audit target
  // through the re-arm cascade so chained temporal transitions keep auditing.
  const val = _scrml_reactive_get(name);
  const variant = (val != null && typeof val === "object" && val.variant != null) ? val.variant : val;
  const rules = JSON.parse(rulesJson);
  for (const r of rules) {
    if (r.from === variant) {
      const meta = {
        fromVariant: r.from,
        label: r.label != null ? r.label : null,
        auditTarget: auditTarget != null ? auditTarget : null,
        rulesJson: rulesJson,
      };
      _scrml_machine_arm_timer(name, r.afterMs, r.to, meta);
      return;
    }
  }
}

// --- §51.14 replay primitive ---
// _scrml_replay(name, log, endIdx?) jumps the machine-bound reactive 'name'
// to the state recorded at index endIdx of the audit array 'log'. Bypasses
// the transition guard (§51.5) and the audit push (§51.11), clears any
// pending temporal timer (§51.12), and emits a standard _scrml_reactive_set
// so subscribers, derived propagation, and effects all fire normally.
//
// Semantics (per SPEC.md §51.14.3):
//   - endIdx > 0         → state lands at log[endIdx - 1].to
//   - endIdx == 0        → state lands at log[0].from (or no-op if empty)
//   - endIdx undefined   → state lands at log[log.length - 1].to (full replay)
//   - endIdx < 0 or > length → throws E-REPLAY-001-RT
function _scrml_replay(name, log, endIdx) {
  const n = (endIdx != null) ? endIdx : log.length;
  if (n < 0 || n > log.length) {
    throw new Error("E-REPLAY-001-RT: replay index " + n +
      " out of bounds for log of length " + log.length +
      ". Index SHALL be in the range [0, log.length].");
  }
  _scrml_machine_clear_timer(name);
  if (n === 0) {
    if (log.length === 0) return;  // empty-log no-op (nothing to replay)
    _scrml_reactive_set(name, log[0].from);
    return;
  }
  _scrml_reactive_set(name, log[n - 1].to);
}

function _scrml_reactive_get(name) {
  if (__SCRML_PERF) {
    const __t0 = __SCRML_PERF_NOW();
    // Bridge with _scrml_effect auto-tracking: record _scrml_state[name] as a dependency
    if (typeof _scrml_track === "function") _scrml_track(_scrml_state, name);
    let __r;
    if (_scrml_derived_fns[name]) __r = _scrml_derived_get(name);
    else __r = _scrml_state[name];
    __SCRML_PERF.reactive_get.ms += __SCRML_PERF_NOW() - __t0;
    __SCRML_PERF.reactive_get.count++;
    return __r;
  }
  // Bridge with _scrml_effect auto-tracking: record _scrml_state[name] as a dependency
  if (typeof _scrml_track === "function") _scrml_track(_scrml_state, name);
  // Derived reactives are stored in _scrml_derived_cache, not _scrml_state.
  // Delegate to _scrml_derived_get for lazy re-evaluation when dirty.
  if (_scrml_derived_fns[name]) return _scrml_derived_get(name);
  return _scrml_state[name];
}

function _scrml_reactive_set(name, value) {
  const __t_set_top = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
  // S79 / §6.13 — when a reactivity rule is registered for the cell, route
  // the write through the timing wrapper. Guarded so cells without a rule
  // (the common case) take zero overhead beyond a single property lookup.
  // The bypass-flag avoids infinite recursion (the timer helpers eventually
  // call back into _scrml_reactive_set with the resolved value).
  if (typeof _scrml_reactivity_rules === "object" && _scrml_reactivity_rules[name] && !_scrml_reactivity_bypass[name]) {
    const rule = _scrml_reactivity_rules[name];
    _scrml_reactivity_bypass[name] = true;
    try {
      if (rule.kind === "debounced") {
        _scrml_reactive_debounced(name, function () { return value; }, rule.ms);
      } else if (rule.kind === "throttled") {
        _scrml_reactive_throttled(name, function () { return value; }, rule.ms);
      } else {
        // Unknown rule kind — defensive: fall through to immediate set.
        const __oldValue_def = _scrml_state[name];
        _scrml_state[name] = value;
        const dirtied = _scrml_propagate_dirty(name);
        if (_scrml_subscribers[name]) {
          const __t_sub = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
          for (const fn of _scrml_subscribers[name]) {
            try { fn(value); } catch(e) { console.error("scrml subscriber error:", e); }
          }
          if (__SCRML_PERF) {
            __SCRML_PERF.notify_subscribers.ms += __SCRML_PERF_NOW() - __t_sub;
            __SCRML_PERF.notify_subscribers.count++;
          }
        }
        // S103 Phase 3 select-row chip-away — value-indexed fan-out
        if (_scrml_value_indexed_subscribers[name]) {
          const __t_vi = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
          _scrml_notify_value_indexed(name, __oldValue_def, value);
          if (__SCRML_PERF) {
            __SCRML_PERF.notify_value_indexed.ms += __SCRML_PERF_NOW() - __t_vi;
            __SCRML_PERF.notify_value_indexed.count++;
          }
        }
        if (typeof _scrml_trigger === "function") _scrml_trigger(_scrml_state, name);
        if (dirtied && dirtied.length > 0 && typeof _scrml_trigger === "function") {
          for (const derived of dirtied) _scrml_trigger(_scrml_state, derived);
        }
      }
    } finally {
      _scrml_reactivity_bypass[name] = false;
    }
    if (__SCRML_PERF) {
      __SCRML_PERF.reactive_set.ms += __SCRML_PERF_NOW() - __t_set_top;
      __SCRML_PERF.reactive_set.count++;
    }
    return value;
  }
  // S103 Phase 3 select-row chip-away — capture OLD value BEFORE the write
  // so value-indexed dispatch can fan out the OLD-value bucket alongside the
  // NEW-value bucket. Cheap read; never null-throws because _scrml_state is
  // a plain object initialized at runtime-template load.
  const __oldValue = _scrml_state[name];
  _scrml_state[name] = value;
  // §6.6.3 Phase 2: eagerly propagate dirty flags to all downstream derived nodes
  // before subscribers fire and before this call returns. Synchronous, no re-evaluation.
  const dirtied = _scrml_propagate_dirty(name);
  if (_scrml_subscribers[name]) {
    const __t_sub = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
    for (const fn of _scrml_subscribers[name]) {
      try { fn(value); } catch(e) { console.error("scrml subscriber error:", e); }
    }
    if (__SCRML_PERF) {
      __SCRML_PERF.notify_subscribers.ms += __SCRML_PERF_NOW() - __t_sub;
      __SCRML_PERF.notify_subscribers.count++;
    }
  }
  // S103 Phase 3 select-row chip-away — value-indexed fan-out. Fires only the
  // OLD-value bucket + NEW-value bucket; predicate-shape binds emitted by
  // emit-lift.js register here instead of the LEGACY _scrml_subscribers when
  // detectPredicateShapeBind matches. O(2) per write instead of O(N) over all
  // rows.
  if (_scrml_value_indexed_subscribers[name]) {
    const __t_vi = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
    _scrml_notify_value_indexed(name, __oldValue, value);
    if (__SCRML_PERF) {
      __SCRML_PERF.notify_value_indexed.ms += __SCRML_PERF_NOW() - __t_vi;
      __SCRML_PERF.notify_value_indexed.count++;
    }
  }
  // Bridge with _scrml_effect auto-tracking: fire effects tracking _scrml_state[name]
  if (typeof _scrml_trigger === "function") _scrml_trigger(_scrml_state, name);
  // Also trigger effects for derived nodes that were dirtied — they need to
  // re-evaluate and update any DOM bindings that read them.
  if (dirtied && dirtied.length > 0 && typeof _scrml_trigger === "function") {
    for (const derived of dirtied) {
      _scrml_trigger(_scrml_state, derived);
    }
  }
  if (__SCRML_PERF) {
    __SCRML_PERF.reactive_set.ms += __SCRML_PERF_NOW() - __t_set_top;
    __SCRML_PERF.reactive_set.count++;
  }
  return value;
}

// S79 / §6.13 — _scrml_reactivity_bypass is declared at the top of the
// runtime (next to _scrml_state) for TDZ safety; the bypass map short-
// circuits the timing wrapper when the timer helper itself calls back
// into _scrml_reactive_set, avoiding infinite recursion.

/**
 * Propagate dirty flags from a written upstream name to all downstream derived nodes.
 * Also propagates transitively: if A → B → C, writing A dirties B and C.
 * Uses iterative BFS to avoid stack overflow on deep chains.
 * @param {string} name — the upstream variable name that was just written
 */
function _scrml_propagate_dirty(name) {
  const queue = [name];
  const visited = new Set();
  const dirtied = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const downstreams = _scrml_derived_downstreams[current];
    if (downstreams) {
      for (const derived of downstreams) {
        if (!_scrml_derived_dirty[derived]) {
          _scrml_derived_dirty[derived] = true;
          dirtied.push(derived);
          // Also propagate from this derived node to its downstreams
          queue.push(derived);
        }
      }
    }
  }
  return dirtied;
}

/**
 * Subscribe fn to reactive changes for name.
 * Returns an unsubscribe function that, when called, removes fn from the subscriber list.
 * Required by _scrml_meta_effect for dependency cleanup between re-runs.
 *
 * @param {string} name — reactive variable name (without @ prefix)
 * @param {function} fn — subscriber callback, called with (newValue) on each set
 * @returns {() => void} unsubscribe function
 */
function _scrml_reactive_subscribe(name, fn) {
  if (!_scrml_subscribers[name]) _scrml_subscribers[name] = [];
  _scrml_subscribers[name].push(fn);
  return () => {
    const subs = _scrml_subscribers[name];
    if (subs) {
      const idx = subs.indexOf(fn);
      if (idx !== -1) subs.splice(idx, 1);
    }
  };
}

// S103 Phase 3 select-row chip-away — value-indexed subscription.
//
// Derive a stable property-key string for a primitive valueKey. The key must
// distinguish "5" from 5 and "true" from true so the wrong bucket never gets
// fired. JSON-style type prefixing is sufficient for the supported scope
// (string / number / boolean / null / undefined).
//
// Non-primitive values (objects, arrays, functions) MUST NOT reach here —
// the codegen detector rejects shapes that could yield a non-primitive
// valueKey at registration time. Defensive fallback uses String(v) so the
// runtime never throws, but the registration is effectively useless because
// object identity isn't stable across closures.
function _scrml_value_indexed_key(v) {
  if (v === null || v === undefined) return "\\u0000n";
  const t = typeof v;
  if (t === "string") return "s:" + v;
  if (t === "number") return "n:" + v;
  if (t === "boolean") return v ? "b:1" : "b:0";
  // Defensive fallback — not a supported registration path.
  return "x:" + String(v);
}

/**
 * Register fn under (name, valueKey) so it only fires when _scrml_reactive_set
 * for 'name' touches the OLD-value === valueKey OR the NEW-value === valueKey
 * bucket. Mirrors _scrml_reactive_subscribe's unsubscribe-closure shape.
 *
 * @param {string} name — reactive variable name (without @ prefix)
 * @param {string|number|boolean|null|undefined} valueKey — the constant the
 *     bind expression compares the cell to; must be a primitive that survives
 *     _scrml_value_indexed_key() stable derivation
 * @param {function} fn — subscriber callback, called with (newValue) when the
 *     bucket fires (same shape as _scrml_reactive_subscribe)
 * @returns {() => void} unsubscribe function
 */
function _scrml_reactive_subscribe_when(name, valueKey, fn) {
  const key = _scrml_value_indexed_key(valueKey);
  let nameMap = _scrml_value_indexed_subscribers[name];
  if (!nameMap) {
    nameMap = {};
    _scrml_value_indexed_subscribers[name] = nameMap;
  }
  let bucket = nameMap[key];
  if (!bucket) {
    bucket = [];
    nameMap[key] = bucket;
  }
  bucket.push(fn);
  return () => {
    const nm = _scrml_value_indexed_subscribers[name];
    if (!nm) return;
    const b = nm[key];
    if (!b) return;
    const idx = b.indexOf(fn);
    if (idx !== -1) b.splice(idx, 1);
    if (b.length === 0) delete nm[key];
  };
}

// Fire the OLD-value bucket + NEW-value bucket for 'name' (predicate-shape
// dispatch). Called from _scrml_reactive_set after the LEGACY fan-out.
// Bucket entries fire in registration order. Each fn is invoked with
// (newValue) for shape parity with the LEGACY callback contract — note that
// for OLD-bucket subscribers, the predicate result was previously true and
// has now flipped to false (the row that WAS editing is no longer editing).
// The subscriber recomputes its full predicate from current cell state on
// each call so the (newValue) argument is informational, not load-bearing.
function _scrml_notify_value_indexed(name, oldValue, newValue) {
  const nameMap = _scrml_value_indexed_subscribers[name];
  if (!nameMap) return;
  const oldKey = _scrml_value_indexed_key(oldValue);
  const newKey = _scrml_value_indexed_key(newValue);
  const oldBucket = nameMap[oldKey];
  if (oldBucket) {
    // Snapshot length to avoid disturbance from subscribers that mutate the
    // bucket during fire (e.g. via unsubscribe).
    const len = oldBucket.length;
    for (let i = 0; i < len; i++) {
      const fn = oldBucket[i];
      if (!fn) continue;
      try { fn(newValue); } catch(e) { console.error("scrml value-indexed subscriber error:", e); }
    }
  }
  // Skip the new bucket when keys collide (no-op write) — fires the same
  // subscribers twice otherwise.
  if (newKey !== oldKey) {
    const newBucket = nameMap[newKey];
    if (newBucket) {
      const len = newBucket.length;
      for (let i = 0; i < len; i++) {
        const fn = newBucket[i];
        if (!fn) continue;
        try { fn(newValue); } catch(e) { console.error("scrml value-indexed subscriber error:", e); }
      }
    }
  }
}

/**
 * RETIRED: _scrml_reactive_derived was the non-conformant stub from before §6.6.
 * It evaluated once at declaration time and registered no subscriptions.
 * It is superseded by _scrml_derived_declare + _scrml_derived_subscribe per §6.6.7.
 * Any compiled output calling this function was produced by an old compiler and must
 * be recompiled.
 */
function _scrml_reactive_derived(name, fn) {
  throw new Error(
    "scrml runtime: _scrml_reactive_derived is retired (§6.6). " +
    "Recompile this file with the current compiler to use _scrml_derived_declare."
  );
}

// ---------------------------------------------------------------------------
// §57 Wire Format dual-decoder (chunk: 'wire')
// ---------------------------------------------------------------------------
// --- §57 Wire Format dual-decoder (M-7C-D-12 Track 2) ---
// Accepts BOTH the canonical envelope { __scrml_absent: true } (encoder
// always emits this) AND raw JSON null (legacy / pre-v0.3 / foreign-client).
// Both lower to scrml \`not\` (JS null per §42.5 / §42.8). Any other value
// passes through unchanged. Dual-decoder retires at v1.0 (OQ-4 (a)).
//
// v0.3.x SPA tree-shake (Phase B 3.2): the dual-decoder moved out of
// 'core' into the dedicated 'wire' chunk so SPA-shape compile units
// (no server-fns + no \`use foreign:\` use-decls) ship without it.
// Activated by \`emit-client.ts:detectRuntimeChunks\` when ANY file in
// the compile unit contains a server \`function-decl\` OR a \`use foreign:\`
// use-decl. The chunk-side reference sites are the server-fn fetch
// stubs emitted by \`emit-functions.ts\` and \`atom-emitter.ts\`.
function _scrml_wire_decode(value) {
  if (value === null) return null;
  if (value !== null && typeof value === "object" && value.__scrml_absent === true) return null;
  return value;
}

// ---------------------------------------------------------------------------
// §6.8 reset+default runtime (chunk: 'reset')
// ---------------------------------------------------------------------------

// _scrml_reset(name) — SPEC §6.8.2 reset(@cell) keyword runtime.
//
// Three target shapes (per SPEC §6.8.2 lines 4848-4853):
//   - reset(@cell)            top-level cell or compound child by direct name
//   - reset(@compound)        whole compound (walks every child, declaration order)
//   - reset(@compound.field)  single compound child by qualified path (multi-level OK)
//
// Codegen passes the cell's encoded storage key (the same key used by
// _scrml_reactive_set / _scrml_default_set / _scrml_init_set). This helper
// consults the registries to decide:
//
//   1. Default thunk wins: if _scrml_default_fns[name] exists, evaluate it
//      and write the result via _scrml_reactive_set. (§6.8.2 line 4857.)
//   2. Otherwise init thunk: if _scrml_init_fns[name] exists, evaluate it
//      and write the result. (§6.8.1 line 4831.)
//   3. Otherwise compound walk: if neither thunk exists, treat name as a
//      compound parent and recursively reset every registered cell whose
//      key starts with name + dot. ECMAScript object-key-iteration order
//      preserves insertion order, and codegen registers compound children
//      in declaration order, so the walk respects §6.8.2 line 4863's
//      declaration-order requirement.
//   4. Otherwise no-op (defensive: unknown name, e.g. a future engine cell
//      whose B22 didn't reject — silent rather than throwing).
function _scrml_reset(name) {
  // S79 / §6.13 — cancel any pending debounced/throttled timer for this cell
  // BEFORE applying the reset value. The cancel-then-apply ordering ensures
  // a freshly-reset value isn't subsequently overwritten by an in-flight
  // debounced/throttled write. Guard the call so reset() on cells without
  // reactivity attributes (the common case) is a no-op + zero allocation.
  if (typeof _scrml_reactivity_cancel === "function") {
    _scrml_reactivity_cancel(name);
  }
  // Also clear any held throttle pending value so a delayed trailing-fire
  // (currently armed timer cancelled above) doesn't reappear on the next
  // throttled write within the window.
  if (typeof _scrml_throttle_state === "object" && _scrml_throttle_state[name]) {
    _scrml_throttle_state[name].pending = null;
  }
  // Default thunk wins per §6.8.2 line 4857.
  if (typeof _scrml_default_fns[name] === "function") {
    _scrml_reactive_set(name, _scrml_default_fns[name]());
    return;
  }
  // Otherwise re-evaluate init thunk per §6.8.1 line 4831.
  if (typeof _scrml_init_fns[name] === "function") {
    _scrml_reactive_set(name, _scrml_init_fns[name]());
    return;
  }
  // Otherwise: treat as a compound parent — walk every registered child
  // (key starts with name followed by a dot). Iteration order is insertion
  // order per ECMAScript 2015+ semantics; codegen emits children in
  // declaration order so this respects §6.8.2 line 4863.
  const prefix = name + ".";
  // Collect first to avoid mutation-during-iteration concerns when a child
  // reset writes through _scrml_reactive_set and triggers subscribers.
  const childKeys = [];
  for (const k of Object.keys(_scrml_init_fns)) {
    if (k.indexOf(prefix) === 0) childKeys.push(k);
  }
  for (const k of Object.keys(_scrml_default_fns)) {
    if (k.indexOf(prefix) === 0 && childKeys.indexOf(k) === -1) childKeys.push(k);
  }
  for (const k of childKeys) {
    _scrml_reset(k);
  }
  // No children + no thunk -> silent no-op (defensive).
}

// ---------------------------------------------------------------------------
// §55.1 Validator predicate runtime catalog (chunk: 'validators')
// ---------------------------------------------------------------------------
// The 14 universal-core validator predicates per SPEC §55.1 — same fire
// functions exported by compiler/src/runtime-validators.js (C6 land), inlined
// here verbatim (sans \`export\` keywords) for the compiled client runtime.
// C7's per-cell validator runner emits calls into _scrml_validator_fire below.
//
// Chunk-detection trigger: any state-decl whose validators[] array is
// non-empty (see emit-client.ts:detectRuntimeChunks). When no validators are
// declared in the source file, this chunk is tree-shaken out entirely.
${_VALIDATOR_RUNTIME_SOURCE}
// _scrml_validator_fire — thin alias matching the C7 codegen call shape.
// Distinct name from \`fireValidator\` so the runtime export surface is clearly
// scoped to the runtime (and so the C7 emitted code isn't tightly coupled to
// the C6 module's internal naming).
function _scrml_validator_fire(name, value, ...args) {
  return fireValidator(name, value, ...args);
}

// ---------------------------------------------------------------------------
// §6.6 Derived reactive runtime
// ---------------------------------------------------------------------------

/**
 * Register a derived reactive node.
 * Marks the node dirty so its first read triggers evaluation (§6.6.3 initial eval).
 *
 * @param {string} name — the derived value name (without @ prefix)
 * @param {() => *} fn — the evaluation function; reads upstream _scrml_reactive_get / _scrml_derived_get calls
 */
function _scrml_derived_declare(name, fn) {
  _scrml_derived_fns[name] = fn;
  _scrml_derived_cache[name] = undefined;
  _scrml_derived_dirty[name] = true; // §6.6.3: initial state is dirty
}

/**
 * Register a dirty-propagation edge: when upstream is written, derived is marked dirty.
 * Called once per upstream @variable reference in the derived expression at startup.
 *
 * @param {string} derived — the derived value name
 * @param {string} upstream — the upstream @variable name (or upstream derived name)
 */
function _scrml_derived_subscribe(derived, upstream) {
  if (!_scrml_derived_downstreams[upstream]) {
    _scrml_derived_downstreams[upstream] = new Set();
  }
  _scrml_derived_downstreams[upstream].add(derived);
}

/**
 * Read a derived reactive value. Implements lazy pull with dirty flags (§6.6.3 Phase 3).
 *
 * - If dirty: clear flag (before eval, per §6.6.4 re-entrance prevention), re-evaluate,
 *   cache, return cached value.
 * - If clean: return cached value immediately without re-evaluation.
 *
 * @param {string} name — the derived value name
 * @returns {*} the (possibly freshly evaluated) value
 */
function _scrml_derived_get(name) {
  // Bug 1 fix-D (S88 dispatch — 14-mario): track the derived name itself as
  // a dependency on the current effect. Without this, if the derived was
  // already evaluated (dirty=false) before the effect's first run, the body
  // path below short-circuits and the inner fn() never runs — meaning the
  // derived's upstream @-refs are never tracked AND the derived name itself
  // is never tracked. Result: an effect like
  //   _scrml_effect(() => el.textContent = _scrml_derived_get("marioName"));
  // ends up with EMPTY deps and never re-runs when marioState writes fire.
  //
  // _scrml_propagate_dirty already fires _scrml_trigger(_scrml_state, derived)
  // for each dirtied derived; tracking the derived name here completes the
  // contract so trigger has effects to wake. (Reactive cells already track
  // via _scrml_reactive_get; this closes the parity gap for derived cells.)
  if (typeof _scrml_track === "function") _scrml_track(_scrml_state, name);
  if (_scrml_derived_dirty[name]) {
    // §6.6.4: clear dirty flag BEFORE evaluating to prevent re-entrant re-evaluation
    _scrml_derived_dirty[name] = false;
    const fn = _scrml_derived_fns[name];
    if (fn) {
      _scrml_derived_cache[name] = fn();
    }
  }
  return _scrml_derived_cache[name];
}

/**
 * flush() — synchronous re-evaluation of all dirty derived nodes (§6.6.5).
 *
 * Forces all dirty derived nodes to re-evaluate immediately, before returning.
 * After flush() returns: all dirty flags are cleared and all cached values reflect
 * the most recent upstream writes.
 *
 * Uses lazy pull semantics: calls _scrml_derived_get on each dirty node, which
 * recursively pulls its dirty dependencies first. This naturally handles derived-of-derived
 * chains and diamond dependencies without requiring topological sort.
 *
 * Valid inside any logic context (\${} blocks) and any function body.
 * NOT valid inside a derived expression (E-REACTIVE-004 — checked at compile time).
 */
function flush() {
  // Collect all currently dirty names before iterating (snapshot).
  // New dirtiness caused by evaluation is handled by the recursive lazy pull
  // inside _scrml_derived_get — those nodes will be evaluated when read.
  const dirtyNames = Object.keys(_scrml_derived_dirty).filter(k => _scrml_derived_dirty[k]);
  for (const name of dirtyNames) {
    _scrml_derived_get(name);
  }
}

/**
 * Lift a DOM element (or factory function) into the nearest lift target.
 *
 * Accepts:
 *   _scrml_lift(factory)   — factory is () => Element, called to create the element
 *   _scrml_lift(element)   — element is a pre-created DOM node (for backward compat)
 *
 * The element is appended to the nearest [data-scrml-lift-target] ancestor, or
 * document.body as a fallback.
 */
let _scrml_lift_target = null;
function _scrml_lift(factoryOrElement) {
  const container = _scrml_lift_target || document.querySelector("[data-scrml-lift-target]") || document.body;
  const el = typeof factoryOrElement === "function" ? factoryOrElement() : factoryOrElement;
  if (el) container.appendChild(el);
}

// ---------------------------------------------------------------------------
// §6.7.3 Scope-aware cleanup registry
// ---------------------------------------------------------------------------

const _scrml_cleanup_registry = new Map();

function _scrml_register_cleanup(fn, scopeId) {
  if (!scopeId) { window.addEventListener("beforeunload", fn); return; }
  if (!_scrml_cleanup_registry.has(scopeId)) _scrml_cleanup_registry.set(scopeId, []);
  _scrml_cleanup_registry.get(scopeId).push(fn);
}

function _scrml_destroy_scope(scopeId) {
  // Step 1: Run cleanup callbacks in LIFO order (§6.7.3)
  const callbacks = _scrml_cleanup_registry.get(scopeId) || [];
  for (let i = callbacks.length - 1; i >= 0; i--) callbacks[i]();
  _scrml_cleanup_registry.delete(scopeId);

  // Step 2: Stop all timers for this scope (§6.7.2, step 2)
  _scrml_stop_scope_timers(scopeId);

  // Step 4: Cancel all pending animation frames for this scope (§6.7.2, step 4)
  _scrml_cancel_animation_frames(scopeId);
}

// ---------------------------------------------------------------------------
// §6.7.2 / §17.1 if= mount/unmount runtime (Phase 2 of if/show split)
//
// _scrml_create_scope:        fresh scopeId for a mount cycle
// _scrml_mount_template:      clone <template id="..."> content, insert before
//                             a marker comment, return the mounted root node
// _scrml_unmount_scope:       destroy scope (LIFO cleanup, stop timers, cancel
//                             rAF) AND remove the mounted root from the DOM
//
// On each false → true transition of an if= condition, a fresh scope is
// created and the template is cloned and mounted. On each true → false,
// the scope is destroyed and the DOM nodes are removed. This satisfies
// SPEC §6.7.2 (scope-as-lifecycle-boundary, depth-first teardown, LIFO
// cleanup, remount re-runs bare expressions).
// ---------------------------------------------------------------------------

let _scrml_scope_counter = 0;

function _scrml_create_scope() {
  return "if_" + (++_scrml_scope_counter);
}

/**
 * Find the comment marker matching \`scrml-if-marker:N (HTML comment)\` in the document.
 * Returns the Comment node, or null if not found.
 *
 * Implementation: a TreeWalker over comment nodes is the cheapest scan when
 * the marker count is small. For larger documents the markers can be looked
 * up via a compile-time-emitted Map; deferred to a later sub-phase.
 */
function _scrml_find_if_marker(markerId) {
  const needle = "scrml-if-marker:" + markerId;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.trim() === needle) return node;
  }
  return null;
}

/**
 * Mount: clone the template content, insert it before the marker
 * comment, and return the inserted root element.
 *
 * The caller is responsible for running any per-mount wiring (event
 * listeners, reactive subscriptions, lifecycle bare-expressions) under the
 * given scopeId. This function does only the DOM insertion; wiring is the
 * compile-time-emitted controller's job.
 *
 * @param {string} markerId — N from scrml-if-marker:N marker comment
 * @param {string} templateId — id of the template element holding the source
 * @returns {HTMLElement|null} — the mounted root element, or null on failure
 */
function _scrml_mount_template(markerId, templateId) {
  const marker = _scrml_find_if_marker(markerId);
  if (!marker || !marker.parentNode) return null;
  const tpl = document.getElementById(templateId);
  if (!tpl || !(tpl.content instanceof DocumentFragment)) return null;
  const fragment = tpl.content.cloneNode(true);
  // The mounted root is the first element child of the cloned fragment.
  // The compile-time emitter is responsible for wrapping the if= element
  // as the sole element child of the <template>.
  const root = fragment.firstElementChild;
  marker.parentNode.insertBefore(fragment, marker);
  return root;
}

/**
 * Unmount: destroy the scope (cleanup LIFO, stop timers, cancel rAF) and
 * remove the mounted root from the DOM.
 *
 * @param {HTMLElement|null} root — node returned by _scrml_mount_template
 * @param {string} scopeId — scope to destroy
 */
function _scrml_unmount_scope(root, scopeId) {
  if (scopeId) _scrml_destroy_scope(scopeId);
  if (root && root.parentNode) root.parentNode.removeChild(root);
}

// ---------------------------------------------------------------------------
// §6.7.5 / §6.7.6 Timer and Poll runtime
// ---------------------------------------------------------------------------

/**
 * Timer registry: scopeId → Map<timerId, { handle, intervalMs, bodyFn, paused }>
 * - handle: the setInterval return value (null when paused)
 * - paused: true when the timer is suspended
 */
const _scrml_timer_registry = new Map();

/**
 * Start an interval timer and register it under scopeId + timerId.
 * Called at element mount time from compiled output.
 *
 * Phase 2 async tick strategy (SPEC-ISSUE-012 safe default):
 *   Queue ticks — if a tick is in-flight, the next tick waits until it completes.
 *
 * @param {string} scopeId — compile-time generated scope identifier
 * @param {string} timerId — compile-time generated or user-supplied id
 * @param {number} intervalMs — tick interval in milliseconds (must be > 0)
 * @param {function} bodyFn — function to call on each tick
 */
function _scrml_timer_start(scopeId, timerId, intervalMs, bodyFn) {
  if (!_scrml_timer_registry.has(scopeId)) {
    _scrml_timer_registry.set(scopeId, new Map());
  }
  const scopeTimers = _scrml_timer_registry.get(scopeId);

  // If a timer with this ID already exists in this scope, stop it first
  if (scopeTimers.has(timerId)) {
    _scrml_timer_stop(scopeId, timerId);
  }

  let tickInFlight = false;

  async function tick() {
    // Queue tick: skip if previous async tick still running
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const result = bodyFn();
      // If bodyFn returns a Promise (async server call), await it
      if (result && typeof result.then === "function") {
        await result;
      }
    } catch (e) {
      console.error("scrml timer tick error:", e);
    } finally {
      tickInFlight = false;
    }
  }

  const handle = setInterval(tick, intervalMs);

  scopeTimers.set(timerId, { handle, intervalMs, bodyFn, paused: false, tickInFlight: false });
}

/**
 * Stop a timer (clearInterval) and remove it from the registry.
 *
 * @param {string} scopeId
 * @param {string} timerId
 */
function _scrml_timer_stop(scopeId, timerId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  const entry = scopeTimers.get(timerId);
  if (!entry) return;
  if (entry.handle !== null) clearInterval(entry.handle);
  scopeTimers.delete(timerId);
  if (scopeTimers.size === 0) _scrml_timer_registry.delete(scopeId);
}

/**
 * Pause a timer (stop the interval but keep the registry entry for resume).
 * In-flight async ticks complete before the timer is considered paused (§EC-3).
 *
 * @param {string} scopeId
 * @param {string} timerId
 */
function _scrml_timer_pause(scopeId, timerId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  const entry = scopeTimers.get(timerId);
  if (!entry || entry.paused) return;
  if (entry.handle !== null) clearInterval(entry.handle);
  entry.handle = null;
  entry.paused = true;
}

/**
 * Resume a paused timer. The interval restarts from the moment of resumption
 * (§6.7.5: "does not fire immediately on resume").
 *
 * @param {string} scopeId
 * @param {string} timerId
 */
function _scrml_timer_resume(scopeId, timerId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  const entry = scopeTimers.get(timerId);
  if (!entry || !entry.paused) return;

  let tickInFlight = false;

  async function tick() {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const result = entry.bodyFn();
      if (result && typeof result.then === "function") await result;
    } catch (e) {
      console.error("scrml timer tick error:", e);
    } finally {
      tickInFlight = false;
    }
  }

  entry.handle = setInterval(tick, entry.intervalMs);
  entry.paused = false;
}

/**
 * Stop all timers for a given scope (called by _scrml_destroy_scope, step 2).
 *
 * @param {string} scopeId
 */
function _scrml_stop_scope_timers(scopeId) {
  const scopeTimers = _scrml_timer_registry.get(scopeId);
  if (!scopeTimers) return;
  for (const [, entry] of scopeTimers) {
    if (entry.handle !== null) clearInterval(entry.handle);
  }
  _scrml_timer_registry.delete(scopeId);
}

// ---------------------------------------------------------------------------
// §6.7.7 animationFrame runtime
// ---------------------------------------------------------------------------

/**
 * Animation frame registry: scopeId → Set<requestId>
 * Tracks pending rAF handles for scope-aware cancellation on destroy.
 */
const _scrml_raf_registry = new Map();

/**
 * Schedule fn via requestAnimationFrame, registering the handle for scope teardown.
 *
 * animationFrame callbacks are NOT reactive subscribers (§6.7.7). Reads of
 * @variables inside the callback return the current value at frame time and
 * do NOT create reactive subscriptions.
 *
 * The global-accessible \`animationFrame\` function (defined below) delegates to this.
 *
 * @param {function} fn — the frame callback
 * @param {string} [scopeId] — optional scope for cancellation; if absent, global scope
 * @returns {number} the requestAnimationFrame handle
 */
function _scrml_animation_frame(fn, scopeId) {
  const rafId = requestAnimationFrame(fn);
  if (scopeId) {
    if (!_scrml_raf_registry.has(scopeId)) {
      _scrml_raf_registry.set(scopeId, new Set());
    }
    _scrml_raf_registry.get(scopeId).add(rafId);
  }
  return rafId;
}

/**
 * Cancel all pending animation frames for a given scope.
 * Called by _scrml_destroy_scope (step 4).
 *
 * @param {string} scopeId
 */
function _scrml_cancel_animation_frames(scopeId) {
  const rafIds = _scrml_raf_registry.get(scopeId);
  if (!rafIds) return;
  for (const rafId of rafIds) {
    cancelAnimationFrame(rafId);
  }
  _scrml_raf_registry.delete(scopeId);
}

/**
 * animationFrame(fn) — compiler-recognized built-in (§6.7.7).
 *
 * Schedules fn via requestAnimationFrame. When called from compiled scrml code,
 * this function is called directly (since animationFrame is in the KEYWORDS set,
 * compiled output contains \`animationFrame(fn)\` which calls this runtime function).
 *
 * NOTE: This function does NOT register @variable reactive subscriptions for reads
 * inside the callback. That is by design — animation loops run on frame timing,
 * not on reactive change events.
 *
 * @param {function} fn — the frame callback
 * @returns {number} the requestAnimationFrame handle
 */
function animationFrame(fn) {
  return _scrml_animation_frame(fn);
}

/**
 * Keyed DOM reconciliation for reactive for/lift loops (§6.5 optimization).
 *
 * Instead of clearing innerHTML and rebuilding all children on every reactive
 * update, this function diffs by key: reuses existing DOM nodes for items that
 * are still present, only creates nodes for new items, and removes nodes for
 * deleted items.
 *
 * @param {HTMLElement} container — the wrapper div that holds the list items
 * @param {Array} newItems — the new array of items to render
 * @param {function} keyFn — (item, index) => key — extracts a stable key from each item
 * @param {function} createFn — (item, index) => HTMLElement — creates a DOM node for a new item
 */
function _scrml_reconcile_list(container, newItems, keyFn, createFn) {
  const __t_rec_top = __SCRML_PERF ? __SCRML_PERF_NOW() : 0;
  // Fast path: clear all — avoid iterating old nodes one by one
  if (newItems.length === 0) {
    if (__SCRML_PERF) {
      const __t_dw = __SCRML_PERF_NOW();
      container.replaceChildren();
      __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
      __SCRML_PERF.dom_write.count++;
      __SCRML_PERF.reconcile_list.ms += __SCRML_PERF_NOW() - __t_rec_top;
      __SCRML_PERF.reconcile_list.count++;
      return;
    }
    container.replaceChildren();
    return;
  }

  // Pause dependency tracking for the rest of this function.
  // The list effect only needs to depend on the array itself (already tracked
  // by the _scrml_reactive_get("todos") call in the render function).
  // Without this, every item.id access through the Proxy adds a tracked dep,
  // causing O(n) subscription cleanup/rebuild on every update.
  const wasPaused = _scrml_tracking_paused;
  _scrml_tracking_paused = true;

  try {

  const oldNodes = new Map();
  for (const child of [...container.childNodes]) {
    const key = child._scrml_key;
    if (key !== undefined) oldNodes.set(key, child);
  }

  // Fast path: bulk create from empty — skip diffing, append directly
  if (oldNodes.size === 0) {
    if (__SCRML_PERF) {
      for (let i = 0; i < newItems.length; i++) {
        const node = createFn(newItems[i], i);
        if (!node) continue; // createFn returned undefined (filtered item)
        node._scrml_key = keyFn(newItems[i], i);
        const __t_dw = __SCRML_PERF_NOW();
        container.appendChild(node);
        __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
        __SCRML_PERF.dom_write.count++;
      }
      return;
    }
    for (let i = 0; i < newItems.length; i++) {
      const node = createFn(newItems[i], i);
      if (!node) continue; // createFn returned undefined (filtered item)
      node._scrml_key = keyFn(newItems[i], i);
      container.appendChild(node);
    }
    return;
  }

  // Fast path B2 (S106 — same keys in same order): partial-update happy path.
  // When in-place mutations (e.g. toggling .completed on existing rows) leave
  // the key sequence unchanged, skip the LIS pipeline entirely. Per-row effects
  // fire separately via _scrml_prop_subscribers; this function only needs to
  // confirm DOM ordering matches and bail.
  // Single forward pass; bails on first mismatch; allocates nothing on hit.
  if (newItems.length === oldNodes.size) {
    let i = 0;
    let sameOrder = true;
    for (const child of container.childNodes) {
      if (child._scrml_key === undefined) continue;
      if (i >= newItems.length) { sameOrder = false; break; }
      if (keyFn(newItems[i], i) !== child._scrml_key) { sameOrder = false; break; }
      i++;
    }
    if (sameOrder && i === newItems.length) {
      // All keys match in order — no LIS, no DOM moves. (finally block bumps perf.)
      return;
    }
  }

  const newLen = newItems.length;
  const newKeys = new Array(newLen);
  for (let i = 0; i < newLen; i++) newKeys[i] = keyFn(newItems[i], i);

  const newKeySet = new Set(newKeys);
  // Remove nodes whose keys are no longer present
  if (__SCRML_PERF) {
    for (const [key, node] of oldNodes) {
      if (!newKeySet.has(key)) {
        const __t_dw = __SCRML_PERF_NOW();
        container.removeChild(node);
        __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
        __SCRML_PERF.dom_write.count++;
      }
    }
  } else {
    for (const [key, node] of oldNodes) {
      if (!newKeySet.has(key)) container.removeChild(node);
    }
  }

  // Build old key→position map for LIS computation
  const oldKeyPos = new Map();
  let pos = 0;
  for (const child of [...container.childNodes]) {
    if (child._scrml_key !== undefined) oldKeyPos.set(child._scrml_key, pos++);
  }

  // Build the desired node array and compute old positions for existing nodes
  const newNodes = new Array(newLen);
  const oldPositions = new Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const key = newKeys[i];
    let node = oldNodes.get(key);
    if (!node) {
      node = createFn(newItems[i], i);
      if (!node) { oldPositions[i] = -2; newNodes[i] = null; continue; } // filtered item
      node._scrml_key = key;
      oldPositions[i] = -1; // new node, no old position
    } else {
      oldPositions[i] = oldKeyPos.get(key) ?? -1;
    }
    newNodes[i] = node;
  }

  // Compute Longest Increasing Subsequence of old positions.
  // Nodes in the LIS are already in correct relative order — don't move them.
  // Only move nodes NOT in the LIS.
  const lisIndices = _scrml_lis(oldPositions);
  const inLIS = new Set(lisIndices);

  // Place nodes: iterate in reverse so insertBefore targets are stable
  let nextSibling = null;
  if (__SCRML_PERF) {
    for (let i = newLen - 1; i >= 0; i--) {
      const node = newNodes[i];
      if (!node) continue; // filtered item (createFn returned undefined)
      if (!inLIS.has(i)) {
        const __t_dw = __SCRML_PERF_NOW();
        container.insertBefore(node, nextSibling);
        __SCRML_PERF.dom_write.ms += __SCRML_PERF_NOW() - __t_dw;
        __SCRML_PERF.dom_write.count++;
      }
      nextSibling = node;
    }
  } else {
    for (let i = newLen - 1; i >= 0; i--) {
      const node = newNodes[i];
      if (!node) continue; // filtered item (createFn returned undefined)
      if (!inLIS.has(i)) {
        container.insertBefore(node, nextSibling);
      }
      nextSibling = node;
    }
  }

  } finally {
    _scrml_tracking_paused = wasPaused;
    if (__SCRML_PERF) {
      __SCRML_PERF.reconcile_list.ms += __SCRML_PERF_NOW() - __t_rec_top;
      __SCRML_PERF.reconcile_list.count++;
    }
  }
}

/**
 * Compute the indices of the Longest Increasing Subsequence.
 * Used by reconcile_list to minimize DOM moves.
 * Ignores -1 values (new nodes with no old position).
 *
 * @param {number[]} arr — array of old positions
 * @returns {number[]} — indices into arr that form the LIS
 */
function _scrml_lis(arr) {
  const len = arr.length;
  if (len === 0) return [];

  // tails[i] = index in arr of smallest tail element for increasing subseq of length i+1
  const tails = [];
  // pred[i] = index of predecessor of arr[i] in the LIS
  const pred = new Array(len);

  for (let i = 0; i < len; i++) {
    if (arr[i] === -1) continue; // skip new nodes

    // Binary search for the position where arr[i] should go
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < arr[i]) lo = mid + 1; else hi = mid;
    }

    if (lo > 0) pred[i] = tails[lo - 1];
    tails[lo] = i;
  }

  // Reconstruct the LIS indices
  const result = new Array(tails.length);
  let k = tails[tails.length - 1];
  for (let i = result.length - 1; i >= 0; i--) {
    result[i] = k;
    k = pred[k];
  }
  return result;
}

function _scrml_deep_set(obj, path, value) {
  if (!path || path.length === 0) return value;
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  let current = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    current[key] = Array.isArray(current[key]) ? [...current[key]] : { ...current[key] };
    current = current[key];
  }
  current[path[path.length - 1]] = value;
  return result;
}

// S81 OQ-2 (2026-05-11): _scrml_debounce + _scrml_throttle RETIRED. These
// helpers supported the imperative debounce(fn, ms) / throttle(fn, ms)
// keyword-call form, which is itself retired. Adopters use stdlib
// scrml:time.debounce / scrml:time.throttle (regular function calls,
// shipped at stdlib/time/index.scrml). State-cell timing uses the SPEC
// section 6.13 attribute form ([x debounced=Nms]) which is served by the
// _scrml_throttle_state + _scrml_reactivity_* helpers below — NOT by the
// retired plain debounce/throttle helpers.

// ---------------------------------------------------------------------------
// §6.13 Reactivity attributes — debounced= / throttled= runtime helpers
// ---------------------------------------------------------------------------
//
// Registries (_scrml_reactivity_timers, _scrml_reactivity_rules,
// _scrml_reactivity_bypass, _scrml_throttle_state) live near the top of
// the runtime (next to _scrml_state / _scrml_subscribers) so
// _scrml_reactive_set can consult them during module-init without TDZ
// faults. The helper functions below READ those registries.
//
// _scrml_reactivity_register is the declarative registration API used by
// the state-decl substrate emitter — codegen emits one call per cell that
// carries debounced= or throttled=, and subsequent direct
// _scrml_reactive_set calls route through the timing wrapper without
// requiring per-assign-site rewrites.
function _scrml_reactivity_register(name, kind, ms) {
  _scrml_reactivity_rules[name] = { kind, ms };
}

// Cancel any pending debounced/throttled timer for the named cell. Called from:
//   - _scrml_reactive_debounced (each new write — coalesce)
//   - _scrml_reactive_throttled (when scheduling a trailing-fire after the
//     window expires; the leading-fire is immediate and doesn't arm)
//   - _scrml_reset (§6.13 normative cancel-on-reset)
function _scrml_reactivity_cancel(name) {
  const handle = _scrml_reactivity_timers[name];
  if (handle === undefined) return;
  clearTimeout(handle);
  delete _scrml_reactivity_timers[name];
}

// _scrml_reactive_debounced(name, valueFn, ms) — SPEC §6.13.1.
//
// Each call arms a timer for ms milliseconds. Re-armed if a new write lands
// within the window (the previous timer is cancelled; the new one starts).
// On timer expiry the value-thunk is evaluated and the result is written
// through _scrml_reactive_set, firing all downstream subscribers + derived
// recompute on the debounced schedule.
//
// ms may be a number (literal-form DURATION) OR a function returning a
// number (computed-form expr-with-unit lowering — mirror A5-5 codegen
// pattern). Negative / NaN runtime values clamp to 0 (matches
// parseAfterDuration runtime semantics for the computed form).
function _scrml_reactive_debounced(name, valueFn, ms) {
  _scrml_reactivity_cancel(name);
  let delay = typeof ms === "function" ? ms() : ms;
  if (typeof delay !== "number" || !isFinite(delay) || delay < 0) delay = 0;
  delay = Math.round(delay);
  const handle = setTimeout(function () {
    delete _scrml_reactivity_timers[name];
    _scrml_reactive_set(name, valueFn());
  }, delay);
  _scrml_reactivity_timers[name] = handle;
}

// _scrml_reactive_throttled(name, valueFn, ms) — SPEC §6.13.2.
//
// Standard leading+trailing throttle. The first write in any quiescent
// window emits immediately; subsequent writes within ms of the last emit
// are suppressed but the most recent suppressed value-thunk is held; at
// window-end a single trailing fire emits with the held thunk.
//
// Per-cell scheduling state lives in _scrml_throttle_state[name]:
//   { lastEmit: number, pending: valueFn | null }
// _scrml_reactivity_timers[name] holds the trailing-fire timer handle (so
// _scrml_reset can cancel it via _scrml_reactivity_cancel).
// _scrml_throttle_state declared at module top for TDZ safety.
function _scrml_reactive_throttled(name, valueFn, ms) {
  let delay = typeof ms === "function" ? ms() : ms;
  if (typeof delay !== "number" || !isFinite(delay) || delay < 0) delay = 0;
  delay = Math.round(delay);
  const now = Date.now();
  let st = _scrml_throttle_state[name];
  if (!st) {
    st = { lastEmit: 0, pending: null };
    _scrml_throttle_state[name] = st;
  }
  const sinceLast = now - st.lastEmit;
  if (sinceLast >= delay) {
    // Outside the window — leading-fire immediately.
    st.lastEmit = now;
    st.pending = null;
    _scrml_reactivity_cancel(name);
    _scrml_reactive_set(name, valueFn());
    return;
  }
  // Inside the window — hold the most recent thunk + arm trailing-fire.
  st.pending = valueFn;
  if (_scrml_reactivity_timers[name] === undefined) {
    const remaining = delay - sinceLast;
    const handle = setTimeout(function () {
      delete _scrml_reactivity_timers[name];
      const stNow = _scrml_throttle_state[name];
      if (!stNow || stNow.pending === null) return;
      const thunk = stNow.pending;
      stNow.pending = null;
      stNow.lastEmit = Date.now();
      _scrml_reactive_set(name, thunk());
    }, remaining);
    _scrml_reactivity_timers[name] = handle;
  }
}

function _scrml_reactive_explicit_set(...args) {
  // Explicit reactive set with path
  if (args.length >= 3) {
    const [obj, path, value] = args;
    const parts = typeof path === "string" ? path.split(".") : path;
    _scrml_reactive_set(obj, _scrml_deep_set(_scrml_reactive_get(obj), parts, value));
  }
}

function _scrml_upload(file, url) {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(url, { method: "POST", body: formData }).then(r => r.json());
}

function _scrml_navigate(path) {
  window.location.href = path;
}

// ---------------------------------------------------------------------------
// §40.9.7 tier-1 idle prefetch runtime (chunk: 'prefetch')
// ---------------------------------------------------------------------------
//
// Per SPEC §40.9.7: "prefetch_tier_1(E) SHALL be idle-prefetched after
// initial render. The implementation SHOULD use \`requestIdleCallback\`
// (or the equivalent Bun-runtime primitive) to schedule the prefetch."
//
// OQ-A4-G ratification (S91): Option γ — \`requestIdleCallback\` browser-
// side with a \`setTimeout(fn, 1)\` Safari fallback (Safari still lacks
// \`requestIdleCallback\` support as of 2026). The Bun-runtime primitive
// named in the SPEC's SHOULD clause does NOT exist in Bun 1.2.x as of
// S91 — reserved as a v0.4 extension point.
//
// Called from the initial chunk's IIFE tail when the (EP, role)'s
// ChunkPlan.prefetchTier1 admits a non-empty set. The codegen
// route-splitter only emits the call when the tier-1 admission set is
// non-empty AND a real CompileContext is threaded through; the empty-
// admission case skips the call entirely (and this whole runtime
// section is tree-shaken from SCRML_RUNTIME via the \`prefetch\` chunk
// marker in \`runtime-chunks.ts\`).
//
// Implementation uses \`<link rel="prefetch">\` for browser-cache
// friendliness — once the chunk is in the HTTP cache, the actual
// \`<script>\` activation on traversal is a cache hit. Browsers that
// don't honor \`rel="prefetch"\` fall back to whatever they do for
// unknown link types (a no-op); no fetch error or runtime exception
// propagates.

function _scrml_prefetch_tier1(chunkUrl) {
  if (typeof document === "undefined") return;
  const schedule = typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : function (fn) { return setTimeout(fn, 1); };
  schedule(function () {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "script";
    link.href = chunkUrl;
    document.head.appendChild(link);
  });
}

// ---------------------------------------------------------------------------
// §40.9.7 prefetch runtime — chunk: 'prefetch'
// Hosts BOTH:
//   • _scrml_prefetch_tier2 (A-4.4) — cross-route hover-prefetch
//   • _scrml_fetch_chunk    (A-4.5) — tier-N (N>=3) on-demand dispatch
// ---------------------------------------------------------------------------
//
// Per SPEC §40.9.7:
//   • "prefetch_tier_2(E) SHALL be hover-prefetched (link-hover for
//      routes, focus-or-hover for interactive components)."
//   • "prefetch_tier_N(E) for N >= 3 SHALL be fetched on-demand when
//      the user actually traverses into the deep-interaction surface."
//
// Per SCOPING §3.4 (A-4 per-route artifact splitter) the §40.9.7 tier-2
// semantics has two distinct shapes:
//   1. Cross-route hover prefetch (DOMINANT) — \`<a href="/other-route">\`
//      hovered → fetch \`/other-route\`'s initial chunk for the viewer's
//      live role.
//   2. Intra-route deep-interaction prefetch — empty in v0.3 per RS
//      A-2.5 floor; structurally supported.
//
// \`_scrml_prefetch_tier2(routePath, role)\` implements case (1).
// \`_scrml_fetch_chunk(epId, role, tier)\` (A-4.5) is the tier-N dispatch
// surface; never fires in v0.3 per OQ-A2-B Option a + OQ-A4-D Option a,
// structural scaffolding for v0.4+.

// _SCRML_CHUNKS — per-app chunks.json manifest mirror.
//
// A-4.4 ships the placeholder scaffold (\`Object.create(null)\` to avoid
// prototype-pollution surprises). A-4.6 populates real chunk URLs at
// HTML emission time (a \`<script>\` tag in the initial HTML payload
// writes \`window._SCRML_CHUNKS = { ... }\` before any chunk script loads).
//
// Shape (after A-4.6 populates it):
//
//   _SCRML_CHUNKS["/loads"]["Driver"] = {
//     initial: "/loads/Driver.initial.abc12345.js",
//     tier1:   "/loads/Driver.tier1.def67890.js",
//   }
var _SCRML_CHUNKS = (typeof _SCRML_CHUNKS !== "undefined")
  ? _SCRML_CHUNKS
  : Object.create(null);

function _scrml_prefetch_tier2(routePath, role) {
  if (typeof document === "undefined") return;
  if (typeof routePath !== "string" || routePath === "") return;
  if (typeof role !== "string" || role === "") return;
  // Defensive: pre-A-4.6 \`_SCRML_CHUNKS\` is the empty scaffold.
  var byRoute = _SCRML_CHUNKS[routePath];
  if (!byRoute) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        "[scrml] _scrml_prefetch_tier2: no chunk manifest entry for route \\"" +
        routePath + "\\" (skipping prefetch — A-4.6 will populate _SCRML_CHUNKS)"
      );
    }
    return;
  }
  var byRole = byRoute[role];
  if (!byRole || typeof byRole.initial !== "string") {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        "[scrml] _scrml_prefetch_tier2: no chunk for route=\\"" + routePath +
        "\\" role=\\"" + role + "\\" (skipping prefetch)"
      );
    }
    return;
  }
  var link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "script";
  link.href = byRole.initial;
  document.head.appendChild(link);
}

// _scrml_fetch_chunk (A-4.5) — tier-N on-demand dispatch. Returns a
// \`Promise<string>\` resolving to the chunk's source bytes when the
// (epId, role, tier) tuple is registered in _SCRML_CHUNKS (A-4.6
// populates real entries). Returns JS \`null\` when the tuple is not
// registered. Per scrml's canonical absence (§42.5 / §42.8) emitted-
// runtime JS represents scrml \`not\` as JS \`null\`; adopters MUST null-
// check before chaining \`.then(...)\`. Structurally complete BUT never
// fires in v0.3 because RS emits empty tier-N admission sets. When RS
// extends to N>=3 in v0.4+, the codegen route-splitter will emit call
// sites referencing this function — no runtime-template.js change
// required at that point.

function _scrml_fetch_chunk(epId, role, tier) {
  var manifest = (typeof _SCRML_CHUNKS !== "undefined") ? _SCRML_CHUNKS : {};
  var entry = manifest[epId] && manifest[epId][role] && manifest[epId][role][tier];
  if (!entry) return null;
  return fetch(entry).then(function (r) { return r.text(); });
}

// ---------------------------------------------------------------------------
// §40.9.7 chunk mount registry (chunk: 'mount')
// ---------------------------------------------------------------------------
//
// Called from the per-(EP, role, tier) chunk file's IIFE for every admitted
// markup node (atom-emitter.ts:emitComponentAtom). Records the per-chunk
// admission set on the global \`_SCRML_MOUNTS\` registry for adopter-debug
// surfaces and downstream runtime instrumentation.
//
// In v0.3 the actual DOM-tree construction is performed by the per-file
// \`.html\` payload (\`emit-html.ts\` renders the static markup tree directly).
// This helper is the chunk-side record-keeping pair: it observes which
// markup nodes belong to the chunk so adopter tooling (debug overlays,
// reachability inspectors) can map chunk → admitted markup. The helper is
// intentionally a no-op-friendly shape (assignment only; no DOM mutation,
// no event dispatch) so adopters pay zero production overhead per §40.9.7
// SHOULD on chunk-side instrumentation cost.
//
// Tree-shake (chunk: 'mount'): when no chunks are emitted for the compile
// unit (the dominant pre-A-4 case), the atom-emitter produces no
// \`_scrml_chunk_mount(...)\` references and \`detectRuntimeChunks\` does NOT
// add 'mount' to \`ctx.usedRuntimeChunks\`. The helper is elided from
// per-file embed-mode runtimes; in full-runtime mode (\`scrml-runtime.js\`)
// it ships unconditionally.

var _SCRML_MOUNTS = (typeof _SCRML_MOUNTS !== "undefined")
  ? _SCRML_MOUNTS
  : Object.create(null);

function _scrml_chunk_mount(id, tag) {
  _SCRML_MOUNTS[id] = tag;
}

// ---------------------------------------------------------------------------
// §41 vendor-unit reference registry (chunk: 'vendor-ref')
// ---------------------------------------------------------------------------
//
// Called from the per-chunk IIFE for every \`use vendor:NAME\` reference in
// the chunk's admission set (atom-emitter.ts:emitVendorUnitRef + the chunk
// composition \`_scrml_vendor_require\` call site in route-splitter.ts).
// Records the chunk's vendor-unit dependencies on \`_SCRML_VENDOR_REFS\` so
// adopter bundler-side tooling can introspect cross-chunk vendor sharing.
//
// In v0.3 this is record-keeping only — the actual vendor-unit script
// inclusion happens via the per-route HTML's \`<script>\` ordering (the
// per-route HTML emitter resolves vendor units to script tags before the
// chunk \`<script>\`s load). When a future v0.4+ extension lands runtime-
// resolved vendor-unit loading, this helper can grow a real
// \`window["vendor:" + unit]\` lookup; until then it is the chunk-side
// record-keeping pair.
//
// Tree-shake (chunk: 'vendor-ref'): same gate as 'mount' — when no chunk
// emits any \`_scrml_vendor_require(...)\` call, this helper is elided from
// per-file embed-mode runtimes. \`detectRuntimeChunks\` activates the chunk
// when ANY entry-point chunk in the file's reachability record admits a
// non-empty \`vendorUnitNames\` set.

var _SCRML_VENDOR_REFS = (typeof _SCRML_VENDOR_REFS !== "undefined")
  ? _SCRML_VENDOR_REFS
  : Object.create(null);

function _scrml_vendor_require(unit) {
  _SCRML_VENDOR_REFS[unit] = true;
}

// ---------------------------------------------------------------------------
// §22.5 meta.emit() runtime — insert HTML at a ^{} block's DOM position
// ---------------------------------------------------------------------------

/**
 * Insert HTML content at the position of a ^{} meta block in the DOM.
 *
 * The compiler emits a placeholder element for every ^{} block that appears in
 * markup context: <span data-scrml-meta="scopeId"></span>. When meta.emit()
 * is called at runtime, this function finds that placeholder and replaces its
 * inner content with the provided HTML string.
 *
 * Calling meta.emit() multiple times replaces the previous content each time.
 * This is intentional — the placeholder span is the container for the emitted
 * content, and each call is a full update of that container.
 *
 * @param {string} scopeId — the meta block scope ID (e.g. _scrml_meta_1)
 * @param {string} htmlString — the HTML string to insert
 */
function _scrml_meta_emit(scopeId, htmlString) {
  if (typeof document === "undefined") return;
  const placeholder = document.querySelector('[data-scrml-meta="' + scopeId + '"]');
  if (placeholder) {
    placeholder.innerHTML = htmlString;
  } else {
    // Fallback: if no placeholder found (e.g. meta block not in markup context),
    // append a new element to the document body with the scopeId marker.
    const el = document.createElement("span");
    el.setAttribute("data-scrml-meta", scopeId);
    el.innerHTML = htmlString;
    document.body.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// §22.6 meta reactive effects — auto-tracking reactive ^{} blocks (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Tracking context stack for _scrml_meta_effect.
 *
 * Each entry is a Set<string> of variable names read during the current effect run.
 * The stack supports nested effects: each effect pushes/pops its own tracking Set.
 * Inner effects do not pollute outer effect dependency sets.
 */
const _scrml_tracking_stack = [];

/**
 * Run fn as a reactive effect for the given scopeId.
 *
 * Auto-tracking strategy: temporarily replace globalThis._scrml_reactive_get with
 * a tracking version that records every variable name read during fn's execution.
 * After fn returns, subscribe to all tracked variables. On any change, re-run fn
 * (first unsubscribing from previous dependencies, running cleanup, then re-tracking).
 *
 * This approach is chosen over Proxy because _scrml_reactive_get is already a
 * function call in all compiled output — no need to intercept property access.
 *
 * Key design properties:
 *   - Scope isolation: fn receives a fresh meta object on each run
 *   - Cleanup: meta.cleanup(fn) callbacks fire before each re-run and on scope destroy
 *   - Infinite loop guard: MAX_RUNS = 100 (matches Vue 3 / React limit)
 *   - Run counter resets on external reactive trigger (not self-caused)
 *   - Final scope cleanup registered with _scrml_register_cleanup for _scrml_destroy_scope
 *
 * @param {string} scopeId — the meta block's stable scope ID (e.g. "_scrml_meta_1")
 * @param {function} fn — the effect body function, receives a meta API object
 * @param {object|null} capturedBindings — frozen object of lexical bindings at ^{} breakout point
 * @param {object|null} typeRegistry — plain object mapping type names to reflection data
 */
function _scrml_meta_effect(scopeId, fn, capturedBindings, typeRegistry) {
  let cleanupFns = [];
  let currentDeps = new Set();
  let unsubscribers = [];
  let isRunning = false;
  let runCount = 0;
  // S79 audit fix (hardcoded-thresholds A.1): infinite-loop guard cap is
  // overridable via globalThis.__scrml_max_meta_runs. Adopters with complex
  // derived graphs may set this higher (e.g. 1000) before the scrml runtime
  // loads. Tests use a small value (e.g. 5) to exercise the bail path
  // without authoring 101-cycle reactive fixtures. Default 100 (Stripe-
  // shape sensible bound -- big enough to avoid false positives on real
  // reactive cycles, small enough to detect a runaway loop within a few
  // seconds of wall-clock).
  var _scrml_runtime_max_runs = (typeof globalThis !== "undefined" &&
    typeof globalThis.__scrml_max_meta_runs === "number" &&
    globalThis.__scrml_max_meta_runs > 0)
    ? globalThis.__scrml_max_meta_runs
    : 100;
  const MAX_RUNS = _scrml_runtime_max_runs; // infinite loop guard (overridable; see globalThis.__scrml_max_meta_runs)

  function trackingGet(name) {
    // Record dependency if we are inside a tracking context
    if (_scrml_tracking_stack.length > 0) {
      _scrml_tracking_stack[_scrml_tracking_stack.length - 1].add(name);
    }
    return _scrml_state[name];
  }

  function runEffect() {
    if (isRunning) return; // prevent re-entrant execution
    isRunning = true;
    runCount++;
    if (runCount > MAX_RUNS) {
      console.error("[scrml] meta effect " + scopeId + " exceeded " + MAX_RUNS + " re-runs — possible infinite loop");
      isRunning = false;
      return;
    }

    // Run cleanup callbacks from the previous execution (LIFO order)
    for (let i = cleanupFns.length - 1; i >= 0; i--) {
      try { cleanupFns[i](); } catch(e) { console.error("[scrml] meta effect cleanup error:", e); }
    }
    cleanupFns = [];

    // Unsubscribe from all dependencies tracked during the previous run
    for (const unsub of unsubscribers) {
      try { unsub(); } catch(e) {}
    }
    unsubscribers = [];

    // Start dependency tracking for this run
    const newDeps = new Set();
    _scrml_tracking_stack.push(newDeps);

    // Temporarily replace globalThis._scrml_reactive_get with the tracking version.
    // This transparently intercepts ALL @variable reads inside fn, including those
    // inside helper functions called from fn, because compiled output always calls
    // _scrml_reactive_get by name (rewritten from @var at compile time).
    const savedGet = (typeof globalThis !== "undefined" && globalThis._scrml_reactive_get)
      ? globalThis._scrml_reactive_get
      : null;
    if (typeof globalThis !== "undefined") {
      globalThis._scrml_reactive_get = trackingGet;
    }

    // Build the meta API object for this run.
    // meta.cleanup() collects cleanup callbacks for the current run (not scope-level).
    // meta.get uses trackingGet so reads inside fn body are auto-tracked.
    const meta = {
      get: trackingGet,
      set: _scrml_reactive_set,
      subscribe: _scrml_reactive_subscribe,
      emit: function(htmlString) { _scrml_meta_emit(scopeId, htmlString); },
      cleanup: function(cleanupFn) { cleanupFns.push(cleanupFn); },
      scopeId: scopeId,
      bindings: capturedBindings != null ? capturedBindings : null,
      types: {
        reflect: function(name) {
          if (!name || typeof name !== "string") return null;
          if (typeRegistry == null) return null;
          const entry = typeRegistry[name];
          return entry != null ? entry : null;
        }
      },
    };

    try {
      fn(meta);
    } catch(e) {
      console.error("[scrml] meta effect error in " + scopeId + ":", e);
    } finally {
      // Restore the original get function
      if (typeof globalThis !== "undefined") {
        if (savedGet !== null) {
          globalThis._scrml_reactive_get = savedGet;
        } else {
          // savedGet was null, meaning _scrml_reactive_get wasn't on globalThis before.
          // Leave the tracking version since _scrml_reactive_get is defined at module level
          // (not on globalThis) in most environments. The tracking version still returns
          // correct values since it reads _scrml_state directly.
        }
      }
      _scrml_tracking_stack.pop();
      isRunning = false;
    }

    // Subscribe to all variables read during this run
    currentDeps = newDeps;
    for (const dep of currentDeps) {
      const unsub = _scrml_reactive_subscribe(dep, function() {
        // Reset run counter on external reactive trigger (new change, not self-caused)
        runCount = 0;
        runEffect();
      });
      if (typeof unsub === "function") unsubscribers.push(unsub);
    }
  }

  // Register scope-level cleanup: runs when _scrml_destroy_scope(scopeId) is called.
  // Fires all accumulated per-run cleanups and unsubscribes all reactive dependencies.
  _scrml_register_cleanup(function() {
    for (let i = cleanupFns.length - 1; i >= 0; i--) {
      try { cleanupFns[i](); } catch(e) { console.error("[scrml] meta effect final cleanup error:", e); }
    }
    cleanupFns = [];
    for (const unsub of unsubscribers) {
      try { unsub(); } catch(e) {}
    }
    unsubscribers = [];
  }, scopeId);

  // Initial run
  runEffect();
}


// --- Transition CSS injection (§38 transition directives) ---
// Inject transition keyframes and classes into the document head once.
(function() {
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = [
    "@keyframes scrml-fade-in { from { opacity: 0 } to { opacity: 1 } }",
    "@keyframes scrml-fade-out { from { opacity: 1 } to { opacity: 0 } }",
    ".scrml-enter-fade { animation: scrml-fade-in 300ms ease }",
    ".scrml-exit-fade { animation: scrml-fade-out 300ms ease }",
    "@keyframes scrml-slide-in { from { transform: translateY(-20px); opacity: 0 } to { transform: none; opacity: 1 } }",
    "@keyframes scrml-slide-out { from { transform: none; opacity: 1 } to { transform: translateY(-20px); opacity: 0 } }",
    ".scrml-enter-slide { animation: scrml-slide-in 300ms ease }",
    ".scrml-exit-slide { animation: scrml-slide-out 300ms ease }",
    "@keyframes scrml-fly-in { from { transform: translateX(-100%); opacity: 0 } to { transform: none; opacity: 1 } }",
    "@keyframes scrml-fly-out { from { transform: none; opacity: 1 } to { transform: translateX(100%); opacity: 0 } }",
    ".scrml-enter-fly { animation: scrml-fly-in 300ms ease }",
    ".scrml-exit-fly { animation: scrml-fly-out 300ms ease }",
  ].join("\\n");
  document.head.appendChild(style);
})();

// --- §19 Built-in error types ---
// Each error type is a class extending Error with .type and .cause fields.
// The .type field stores the type name as a string for serialization and
// arm pattern matching across the server/client boundary.

class _ScrmlError extends Error {
  constructor(message, opts) {
    super(message ?? "An error occurred");
    this.cause = opts?.cause ?? null;
    // .name and .type set by subclass
  }
}

class NetworkError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "NetworkError";
    this.type = "NetworkError";
  }
}

class ValidationError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ValidationError";
    this.type = "ValidationError";
  }
}

class SQLError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "SQLError";
    this.type = "SQLError";
  }
}

class AuthError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "AuthError";
    this.type = "AuthError";
  }
}

class TimeoutError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "TimeoutError";
    this.type = "TimeoutError";
  }
}

class ParseError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ParseError";
    this.type = "ParseError";
  }
}

class NotFoundError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "NotFoundError";
    this.type = "NotFoundError";
  }
}

class ConflictError extends _ScrmlError {
  constructor(message, opts) {
    super(message, opts);
    this.name = "ConflictError";
    this.type = "ConflictError";
  }
}

// ---------------------------------------------------------------------------
// §19.6 / §19.6.8 — errorBoundary runtime support.
//
// The compiler emits the per-binding catch + variant-dispatch inline (see
// emit-event-wiring.ts); this helper provides the loud, non-swallowing logging
// the §19.6.8 B5 backstop requires. It NEVER throws and NEVER hides the error —
// it only reports. The decision to render fallback / re-propagate is made by
// the emitted dispatch, not here.
// ---------------------------------------------------------------------------

function _scrml_error_boundary_log(boundaryId, err) {
  if (typeof console === "undefined") return;
  // A typed scrml '!'-error envelope { __scrml_error, type, variant, data } vs.
  // a host throw — report both shapes loudly with the boundary id for context.
  if (err && typeof err === "object" && err.__scrml_error) {
    if (typeof console.error === "function") {
      console.error(
        "[scrml errorBoundary " + boundaryId + "] caught error variant " +
        (err.type || "Error") + "::" + (err.variant || "?"),
        err,
      );
    }
  } else {
    if (typeof console.error === "function") {
      console.error(
        "[scrml errorBoundary " + boundaryId + "] caught non-! runtime error (host backstop, §19.6.8)",
        err,
      );
    }
  }
}

// §19.6.8 B3 — wrap an uncaught typed error variant (no 'renders', no
// 'fallback') into a host Error so the throw propagates to the nearest
// enclosing boundary's host-JS backstop (inner-catches-first, §19.6.4). The
// wrapped Error carries the original envelope on '.scrmlError' so a debugger /
// log sees the variant. E-ERROR-005 (§19.6.6) makes this path statically
// unreachable for well-typed code; it exists only as the runtime tail of the
// C-hybrid model when an enclosing boundary CAN render the variant.
function _scrml_error_boundary_uncaught(envelope) {
  var msg = "scrml errorBoundary: error variant " +
    ((envelope && envelope.type) || "Error") + "::" +
    ((envelope && envelope.variant) || "?") +
    " has no 'renders' clause and the boundary has no 'fallback' (propagating, §19.6.8 B3)";
  var e = new Error(msg);
  e.scrmlError = envelope;
  return e;
}

// ---------------------------------------------------------------------------
// §35.1 Global input state registry — maps user-supplied id → state object
// ---------------------------------------------------------------------------

const _scrml_input_state_registry = new Map();

// ---------------------------------------------------------------------------
// §35.2 Keyboard input runtime
// ---------------------------------------------------------------------------

const _scrml_input_keyboard_registry = new Map();

function _scrml_input_keyboard_create(id, scopeId) {
  const pressedSet = new Set();
  const justPressedSet = new Set();
  const justReleasedSet = new Set();
  const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
  let lastKey = null;

  function keydownFn(e) {
    const key = e.key;
    if (!pressedSet.has(key)) {
      justPressedSet.add(key);
    }
    pressedSet.add(key);
    modifiers.shift = e.shiftKey;
    modifiers.ctrl = e.ctrlKey;
    modifiers.alt = e.altKey;
    modifiers.meta = e.metaKey;
    lastKey = key;
  }

  function keyupFn(e) {
    const key = e.key;
    pressedSet.delete(key);
    justReleasedSet.add(key);
    modifiers.shift = e.shiftKey;
    modifiers.ctrl = e.ctrlKey;
    modifiers.alt = e.altKey;
    modifiers.meta = e.metaKey;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", keydownFn);
    document.addEventListener("keyup", keyupFn);
  }

  const state = {
    pressed: (key) => pressedSet.has(key),
    justPressed: (key) => justPressedSet.has(key),
    justReleased: (key) => justReleasedSet.has(key),
    get modifiers() { return { ...modifiers }; },
    get lastKey() { return lastKey; },
    _clearFrameState() { justPressedSet.clear(); justReleasedSet.clear(); },
    _keydownFn: keydownFn,
    _keyupFn: keyupFn,
  };

  if (!_scrml_input_keyboard_registry.has(scopeId)) {
    _scrml_input_keyboard_registry.set(scopeId, new Map());
  }
  _scrml_input_keyboard_registry.get(scopeId).set(id, state);
  _scrml_input_state_registry.set(id, state);

  return state;
}

function _scrml_input_keyboard_destroy(id, scopeId) {
  const scopeMap = _scrml_input_keyboard_registry.get(scopeId);
  if (!scopeMap) return;
  const state = scopeMap.get(id);
  if (!state) return;
  if (typeof document !== "undefined") {
    document.removeEventListener("keydown", state._keydownFn);
    document.removeEventListener("keyup", state._keyupFn);
  }
  scopeMap.delete(id);
  if (scopeMap.size === 0) _scrml_input_keyboard_registry.delete(scopeId);
  _scrml_input_state_registry.delete(id);
}

// ---------------------------------------------------------------------------
// §35.3 Mouse input runtime
// ---------------------------------------------------------------------------

const _scrml_input_mouse_registry = new Map();

function _scrml_input_mouse_create(id, scopeId, targetFn) {
  let x = 0, y = 0, buttons = 0, wheel = 0;

  function mousemoveFn(e) { x = e.clientX; y = e.clientY; }
  function mousedownFn(e) { buttons = e.buttons; }
  function mouseupFn(e) { buttons = e.buttons; }
  function wheelfn(e) { wheel += e.deltaY; }

  const target = (targetFn ? targetFn() : null) || (typeof document !== "undefined" ? document : null);

  if (target) {
    target.addEventListener("mousemove", mousemoveFn);
    target.addEventListener("mousedown", mousedownFn);
    target.addEventListener("mouseup", mouseupFn);
    target.addEventListener("wheel", wheelfn);
  }

  const state = {
    get x() { return x; },
    get y() { return y; },
    get buttons() { return buttons; },
    pressed(button) { return !!(buttons & (1 << button)); },
    get wheel() { return wheel; },
    _clearFrameState() { wheel = 0; },
    _mousemoveFn: mousemoveFn,
    _mousedownFn: mousedownFn,
    _mouseupFn: mouseupFn,
    _wheelfn: wheelfn,
    _target: target,
  };

  if (!_scrml_input_mouse_registry.has(scopeId)) {
    _scrml_input_mouse_registry.set(scopeId, new Map());
  }
  _scrml_input_mouse_registry.get(scopeId).set(id, state);
  _scrml_input_state_registry.set(id, state);

  return state;
}

function _scrml_input_mouse_destroy(id, scopeId) {
  const scopeMap = _scrml_input_mouse_registry.get(scopeId);
  if (!scopeMap) return;
  const state = scopeMap.get(id);
  if (!state) return;
  const t = state._target;
  if (t) {
    t.removeEventListener("mousemove", state._mousemoveFn);
    t.removeEventListener("mousedown", state._mousedownFn);
    t.removeEventListener("mouseup", state._mouseupFn);
    t.removeEventListener("wheel", state._wheelfn);
  }
  scopeMap.delete(id);
  if (scopeMap.size === 0) _scrml_input_mouse_registry.delete(scopeId);
  _scrml_input_state_registry.delete(id);
}

// ---------------------------------------------------------------------------
// §35.4 Gamepad input runtime (polling via requestAnimationFrame)
// ---------------------------------------------------------------------------

const _scrml_input_gamepad_registry = new Map();

function _scrml_input_gamepad_create(id, scopeId, index) {
  let rafHandle = null;
  let connected = false;
  let axes = [];
  let gamepadButtons = [];

  function poll() {
    const gamepads = (typeof navigator !== "undefined" && navigator.getGamepads)
      ? navigator.getGamepads()
      : [];
    const gp = gamepads[index] || null;
    if (gp) {
      connected = true;
      axes = Array.from(gp.axes);
      gamepadButtons = gp.buttons.map(b => ({ pressed: b.pressed, value: b.value }));
    } else {
      connected = false;
    }
    if (typeof requestAnimationFrame !== "undefined") {
      rafHandle = requestAnimationFrame(poll);
    }
  }

  if (typeof requestAnimationFrame !== "undefined") {
    rafHandle = requestAnimationFrame(poll);
  }

  const state = {
    get connected() { return connected; },
    get axes() { return axes; },
    get buttons() { return gamepadButtons; },
    pressed(idx) { return gamepadButtons[idx] ? gamepadButtons[idx].pressed : false; },
    _stop() {
      if (rafHandle !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    },
  };

  if (!_scrml_input_gamepad_registry.has(scopeId)) {
    _scrml_input_gamepad_registry.set(scopeId, new Map());
  }
  _scrml_input_gamepad_registry.get(scopeId).set(id, state);
  _scrml_input_state_registry.set(id, state);

  return state;
}

function _scrml_input_gamepad_destroy(id, scopeId) {
  const scopeMap = _scrml_input_gamepad_registry.get(scopeId);
  if (!scopeMap) return;
  const state = scopeMap.get(id);
  if (!state) return;
  state._stop();
  scopeMap.delete(id);
  if (scopeMap.size === 0) _scrml_input_gamepad_registry.delete(scopeId);
  _scrml_input_state_registry.delete(id);
}

// ---------------------------------------------------------------------------
// §45 Structural equality — deep value comparison for structs and enums
// ---------------------------------------------------------------------------

function _scrml_structural_eq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  // Array comparison (for tuple-like fields)
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!_scrml_structural_eq(a[i], b[i])) return false;
    }
    return true;
  }
  // Enum: compare tag + payload
  if (a._tag !== undefined && b._tag !== undefined) {
    if (a._tag !== b._tag) return false;
    // Unit variant (no payload beyond _tag)
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (key === "_tag") continue;
      if (!_scrml_structural_eq(a[key], b[key])) return false;
    }
    return true;
  }
  // Struct: field-by-field comparison
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!_scrml_structural_eq(a[key], b[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fine-grained reactivity primitives (Reactivity Phase 1)
// ---------------------------------------------------------------------------

/**
 * Effect tracking context stack.
 * Each entry is { deps: Map<target, Set<prop>> } where target is a reactive proxy's
 * backing object and prop is the property name read during the effect.
 */
const _scrml_effect_stack = [];

/**
 * WeakMap from backing object → Map<prop, Set<effectFn>>
 * Tracks which effects depend on which properties of which objects.
 */
const _scrml_prop_subscribers = new WeakMap();

/**
 * WeakMap from backing object → Proxy. Ensures we return the same Proxy for the
 * same object (identity stability).
 */
const _scrml_proxy_cache = new WeakMap();

/**
 * WeakMap from Proxy → backing object. Used by _scrml_deep_reactive to unwrap
 * if a Proxy is passed in.
 */
const _scrml_proxy_targets = new WeakMap();

/**
 * Track a property read for the current effect context.
 * @param {object} target — the backing object
 * @param {string|symbol} prop — the property key
 */
let _scrml_tracking_paused = false;

function _scrml_track(target, prop) {
  if (_scrml_tracking_paused) return;
  if (_scrml_effect_stack.length === 0) return;
  const current = _scrml_effect_stack[_scrml_effect_stack.length - 1];
  if (!current.deps.has(target)) current.deps.set(target, new Set());
  current.deps.get(target).add(prop);
}

/**
 * Run fn without tracking property reads.
 * Used by reconcile_list to avoid tracking every item.id access
 * in the key extraction loop — the list only needs to track the
 * array itself, not individual item properties.
 */
function _scrml_untracked(fn) {
  _scrml_tracking_paused = true;
  try { return fn(); } finally { _scrml_tracking_paused = false; }
}

/**
 * Trigger all effects that depend on target[prop].
 * @param {object} target — the backing object
 * @param {string|symbol} prop — the property key
 */
function _scrml_trigger(target, prop) {
  const propMap = _scrml_prop_subscribers.get(target);
  if (!propMap) return;
  const effects = propMap.get(prop);
  if (!effects) return;
  // Copy to avoid mutation during iteration.
  // Each effect is wrapped in try/catch so that a throwing effect (e.g. a
  // derived expression that evaluates null.property) does not halt the
  // trigger loop or propagate up to the reactive-set caller — Bug K.
  if (__SCRML_PERF) {
    const __t_eff = __SCRML_PERF_NOW();
    for (const effect of [...effects]) {
      try { effect(); } catch(e) { console.error("scrml effect error:", e); }
    }
    __SCRML_PERF.effect_scheduling.ms += __SCRML_PERF_NOW() - __t_eff;
    __SCRML_PERF.effect_scheduling.count++;
    return;
  }
  for (const effect of [...effects]) {
    try { effect(); } catch(e) { console.error("scrml effect error:", e); }
  }
}


/**
 * Array methods that mutate and should trigger reactivity.
 */
const _scrml_array_mutators = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"
]);

/**
 * Wrap an object or array in a deep reactive Proxy.
 *
 * - Property reads track dependencies for the current effect
 * - Property writes trigger only effects that read THAT property
 * - Nested objects are lazily wrapped on access
 * - Array mutating methods (push/pop/splice/etc.) trigger via Proxy set trap
 *
 * @param {*} value — the value to wrap
 * @returns {*} — Proxy-wrapped if object/array, otherwise the value unchanged
 */
function _scrml_deep_reactive(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  // Unwrap if already a proxy
  const unwrapped = _scrml_proxy_targets.get(value);
  if (unwrapped) return value; // already a proxy, return as-is

  // Return cached proxy if we already wrapped this object
  if (_scrml_proxy_cache.has(value)) return _scrml_proxy_cache.get(value);

  const proxy = new Proxy(value, {
    get(target, prop, receiver) {
      // Track the read
      if (typeof prop === "string" || typeof prop === "symbol") {
        _scrml_track(target, prop);
      }

      const val = Reflect.get(target, prop, receiver);

      // For array mutating methods, return a wrapped version that triggers "length"
      if (Array.isArray(target) && typeof prop === "string" && _scrml_array_mutators.has(prop) && typeof val === "function") {
        return function(...args) {
          const result = val.apply(target, args);
          // Trigger length and the array itself to notify effects
          _scrml_trigger(target, "length");
          _scrml_trigger(target, prop);
          return result;
        };
      }

      // Lazily wrap nested objects
      if (val !== null && typeof val === "object" && !_scrml_proxy_targets.has(val)) {
        return _scrml_deep_reactive(val);
      }

      return val;
    },

    set(target, prop, newValue, receiver) {
      const oldValue = target[prop];
      const result = Reflect.set(target, prop, newValue, receiver);
      if (oldValue !== newValue) {
        _scrml_trigger(target, prop);
        // For arrays, setting an index also changes length conceptually
        if (Array.isArray(target) && typeof prop === "string" && /^\\d+$/.test(prop)) {
          _scrml_trigger(target, "length");
        }
      }
      return result;
    },

    deleteProperty(target, prop) {
      const had = prop in target;
      const result = Reflect.deleteProperty(target, prop);
      if (had) {
        _scrml_trigger(target, prop);
      }
      return result;
    },
  });

  _scrml_proxy_cache.set(value, proxy);
  _scrml_proxy_targets.set(proxy, value);
  return proxy;
}

/**
 * Create a reactive effect that auto-tracks property-level dependencies.
 *
 * Runs fn immediately, recording which reactive properties it reads.
 * When any tracked property changes, fn is re-run (after clearing old deps).
 *
 * Supports nested effects — inner effects don't leak deps to outer.
 *
 * @param {function} fn — the effect function
 * @returns {function} dispose — call to stop the effect and clean up subscriptions
 */
function _scrml_effect(fn) {
  let disposed = false;
  let cleanupEntries = []; // Array of { target, prop } for subscriber removal

  function effectFn() {
    if (disposed) return;

    // Remove old subscriptions
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(effectFn);
      }
    }
    cleanupEntries = [];

    // Push tracking context
    const ctx = { deps: new Map() };
    _scrml_effect_stack.push(ctx);

    // S139 Bug 11 (6nz-V class-binding on for-lift) fix — each _scrml_effect
    // owns its own tracking scope; un-pause around fn() so a paused outer
    // caller (e.g. _scrml_reconcile_list setting _scrml_tracking_paused=true
    // to suppress Proxy item.id reads from leaking onto the outer effect's
    // deps) does NOT silently swallow the nested effect's own dependency
    // tracking. Without this, per-item attribute-interpolation effects
    // registered during reconcile never subscribe and never re-fire.
    const wasPaused = _scrml_tracking_paused;
    _scrml_tracking_paused = false;
    try {
      fn();
    } finally {
      _scrml_tracking_paused = wasPaused;
      _scrml_effect_stack.pop();
    }

    // Subscribe to all tracked properties
    for (const [target, props] of ctx.deps) {
      if (!_scrml_prop_subscribers.has(target)) {
        _scrml_prop_subscribers.set(target, new Map());
      }
      const propMap = _scrml_prop_subscribers.get(target);
      for (const prop of props) {
        if (!propMap.has(prop)) propMap.set(prop, new Set());
        propMap.get(prop).add(effectFn);
        cleanupEntries.push({ target, prop });
      }
    }
  }

  // Initial run
  effectFn();

  // Return dispose function
  return function dispose() {
    disposed = true;
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(effectFn);
      }
    }
    cleanupEntries = [];
  };
}

/**
 * Static effect — like _scrml_effect but deps are tracked only on the first run.
 * Subsequent re-runs skip the cleanup/re-track/re-subscribe cycle entirely.
 * Use for effects that always read the same reactive properties (e.g. list reconcile).
 * DO NOT use for effects with conditional deps.
 */
function _scrml_effect_static(fn) {
  let disposed = false;
  let cleanupEntries = [];
  let hasRun = false;

  function effectFn() {
    if (disposed) return;

    if (hasRun) {
      fn();
      return;
    }

    const ctx = { deps: new Map() };
    _scrml_effect_stack.push(ctx);
    // S139 Bug 11 (6nz-V) fix — symmetric with _scrml_effect: each effect
    // owns its own tracking scope; un-pause around fn() so a paused outer
    // caller does NOT silently swallow this effect's first-run dep tracking.
    const wasPaused = _scrml_tracking_paused;
    _scrml_tracking_paused = false;
    try { fn(); } finally {
      _scrml_tracking_paused = wasPaused;
      _scrml_effect_stack.pop();
    }

    for (const [target, props] of ctx.deps) {
      if (!_scrml_prop_subscribers.has(target)) _scrml_prop_subscribers.set(target, new Map());
      const propMap = _scrml_prop_subscribers.get(target);
      for (const prop of props) {
        if (!propMap.has(prop)) propMap.set(prop, new Set());
        propMap.get(prop).add(effectFn);
        cleanupEntries.push({ target, prop });
      }
    }
    hasRun = true;
  }

  effectFn();

  return function dispose() {
    disposed = true;
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(effectFn);
      }
    }
    cleanupEntries = [];
  };
}

/**
 * Create a computed reactive value.
 *
 * Lazily evaluates fn when .value is accessed. Caches result until a tracked
 * dependency changes. Is itself reactive — effects that read .value track it.
 *
 * @param {function} fn — the computation function
 * @returns {{ readonly value: * }} — object with a reactive .value getter
 */
function _scrml_computed(fn) {
  let cachedValue;
  let dirty = true;
  let disposed = false;
  let cleanupEntries = [];

  function recompute() {
    // Remove old subscriptions
    for (const entry of cleanupEntries) {
      const propMap = _scrml_prop_subscribers.get(entry.target);
      if (propMap) {
        const effects = propMap.get(entry.prop);
        if (effects) effects.delete(invalidate);
      }
    }
    cleanupEntries = [];

    // Push tracking context
    const ctx = { deps: new Map() };
    _scrml_effect_stack.push(ctx);

    try {
      cachedValue = fn();
    } finally {
      _scrml_effect_stack.pop();
    }

    dirty = false;

    // Subscribe to tracked properties with invalidate (not recompute)
    for (const [target, props] of ctx.deps) {
      if (!_scrml_prop_subscribers.has(target)) {
        _scrml_prop_subscribers.set(target, new Map());
      }
      const propMap = _scrml_prop_subscribers.get(target);
      for (const prop of props) {
        if (!propMap.has(prop)) propMap.set(prop, new Set());
        propMap.get(prop).add(invalidate);
        cleanupEntries.push({ target, prop });
      }
    }
  }

  function invalidate() {
    if (disposed) return;
    dirty = true;
    // Trigger effects that depend on this computed's backing object
    _scrml_trigger(_computed_backing, "value");
  }

  // Backing object for tracking by effects that read .value
  const _computed_backing = {};

  const computed = {
    get value() {
      // Track that this computed's value was read
      _scrml_track(_computed_backing, "value");
      if (dirty) recompute();
      return cachedValue;
    },
    dispose() {
      disposed = true;
      for (const entry of cleanupEntries) {
        const propMap = _scrml_prop_subscribers.get(entry.target);
        if (propMap) {
          const effects = propMap.get(entry.prop);
          if (effects) effects.delete(invalidate);
        }
      }
      cleanupEntries = [];
    },
  };

  return computed;
}

// ---------------------------------------------------------------------------
// §55.10 Error message resolution runtime (chunk: 'messages')
// ---------------------------------------------------------------------------
// 4-level chain (L12). Levels 1 → 2 → 3 (Level 4 is the consumer-side
// \`<match for=ValidationError>\` escape hatch — not in this catalog).
//
//   Level 1: per-(cell,validator) inline override on field declaration
//            (highest priority; static-string only per L12 Edge F).
//            Stored by C10's emitter via _scrml_messages_register_inline.
//   Level 2: project-registered messages — \`registerMessages({...})\`.
//            Stored as enum-tag → (fieldName, ...payload) → string.
//   Level 3: shipped English defaults — _SCRML_DEFAULT_MESSAGES below.
//            Always available zero-config floor.
//
// Chunk-detection trigger: any state-decl whose validators[] contains an
// entry with a non-null \`inlineOverride\`, OR (future, C11) any \`<errors of=>\`
// element. When neither is present this chunk is tree-shaken out entirely.
//
// Cross-references:
//   - SPEC §55.10 (lines 25243-25301) — 4-level chain
//   - SPEC §55.9  (lines 25212-25241) — ValidationError enum (14 + Custom)
//   - SPEC §41.12 (lines 17073-17115) — registerMessages API + messageFor
//   - PA-SCRML-PRIMER §8 — validators + auto-synth surface
//   - compiler/src/codegen/emit-messages.ts — Level-1 codegen emission

// Level-1 storage: keys are "<cellName>::<validatorName>"; values are
// override strings. \`::\` is collision-safe (cell names cannot contain it).
const _scrml_messages_inline = {};

// Level-2 storage: keys are ValidationError enum tags ("Required",
// "MinFailed", "Custom", etc.); values are (fieldName, ...payload) => string.
const _scrml_messages_registered = {};

// Tag → validator name mapping for Level-1 inline override lookup. Mirrors
// the validator-catalog at compile time but lives here so Level-1 lookup
// is self-contained at runtime. Custom maps to "custom" (developer-defined).
const _SCRML_TAG_TO_VALIDATOR = {
  Required:        "req",
  NotSome:         "is some",
  LengthFailed:    "length",
  PatternMismatch: "pattern",
  MinFailed:       "min",
  MaxFailed:       "max",
  GtFailed:        "gt",
  LtFailed:        "lt",
  GteFailed:       "gte",
  LteFailed:       "lte",
  EqFailed:        "eq",
  NeqFailed:       "neq",
  OneOfFailed:     "oneOf",
  NotInFailed:     "notIn",
  Custom:          "custom",
};

// Format a relational-predicate payload like { op: ">=", value: 2 } → ">= 2".
// Used by LengthFailed default. Payload may be null/undefined defensively.
function _scrml_format_predicate(p) {
  if (p && typeof p === "object" && typeof p.op === "string") {
    return p.op + " " + p.value;
  }
  return String(p);
}

// Format a set/array payload for OneOfFailed / NotInFailed defaults.
function _scrml_format_set(s) {
  if (Array.isArray(s)) return s.map(v => String(v)).join(", ");
  return String(s);
}

// Level-3 default catalog. Each entry takes (fieldName, payload) and returns
// a non-condescending professional string. Payload shape matches the
// ValidationError enum at SPEC §55.9 (e.g., MinFailed has \`threshold\`).
// Uses string concatenation rather than template literals so we don't have to
// escape every \\\${} inside this template-literal runtime source.
const _SCRML_DEFAULT_MESSAGES = {
  Required:        function (f) { return f + " is required."; },
  NotSome:         function (f) { return f + " is required."; },
  LengthFailed:    function (f, p) { return f + " length must satisfy " + _scrml_format_predicate(p) + "."; },
  PatternMismatch: function (f) { return f + " doesn't match the expected format."; },
  MinFailed:       function (f, p) { return f + " must be at least " + p + "."; },
  MaxFailed:       function (f, p) { return f + " must be at most " + p + "."; },
  GtFailed:        function (f, p) { return f + " must be greater than " + p + "."; },
  LtFailed:        function (f, p) { return f + " must be less than " + p + "."; },
  GteFailed:       function (f, p) { return f + " must be greater than or equal to " + p + "."; },
  LteFailed:       function (f, p) { return f + " must be less than or equal to " + p + "."; },
  EqFailed:        function (f, p) { return f + " must equal " + p + "."; },
  NeqFailed:       function (f, p) { return f + " cannot equal " + p + "."; },
  OneOfFailed:     function (f, p) { return f + " must be one of: " + _scrml_format_set(p) + "."; },
  NotInFailed:     function (f, p) { return f + " cannot be any of: " + _scrml_format_set(p) + "."; },
  Custom:          function (f, p) { return f + " failed validation (" + p + ")."; },
};

// Fallback for unknown/future tags. Keeps messageFor total — never throws,
// never returns undefined.
function _scrml_messages_fallback(fieldName) {
  return fieldName + " is invalid.";
}

// Extract payload values as a positional array for Level-2 function call. The
// payload-key per tag is documented at runtime-validators.js:36-49.
function _scrml_extract_payload(error) {
  switch (error.tag) {
    case "Required":
    case "NotSome":
      return [];
    case "LengthFailed":    return [error.predicate];
    case "PatternMismatch": return [error.re];
    case "MinFailed":       return [error.threshold];
    case "MaxFailed":       return [error.threshold];
    case "GtFailed":        return [error.expected];
    case "LtFailed":        return [error.expected];
    case "GteFailed":       return [error.expected];
    case "LteFailed":       return [error.expected];
    case "EqFailed":        return [error.expected];
    case "NeqFailed":       return [error.forbidden];
    case "OneOfFailed":     return [error.set];
    case "NotInFailed":     return [error.set];
    case "Custom":          return [error.tag_string != null ? error.tag_string : error.customTag];
    default:                return [];
  }
}

// First payload value (for default-catalog single-arg use). Keeps the default
// catalog signature simple: \`(field, payload) => string\`.
function _scrml_extract_payload_first(error) {
  const arr = _scrml_extract_payload(error);
  return arr.length > 0 ? arr[0] : undefined;
}

/**
 * Level-1 storage emission — called by C10-emitted code at module init.
 * Key shape: cellName + "::" + validatorName.
 */
function _scrml_messages_register_inline(cellName, validatorName, override) {
  _scrml_messages_inline[cellName + "::" + validatorName] = override;
}

/**
 * Level-2 registration — public facade for \`registerMessages\` (stdlib re-export).
 * Last-write-wins per variant key per SPEC §41.12 line 17096. Composes across
 * multiple calls (each call merges into the table).
 *
 * @param {Object} map — \`{ Required: (field) => "...", MinFailed: (field, n) => "...", ... }\`
 */
function _scrml_messages_register(map) {
  if (!map || typeof map !== "object") return;
  for (const tag of Object.keys(map)) {
    const fn = map[tag];
    if (typeof fn === "function") {
      _scrml_messages_registered[tag] = fn;
    }
  }
}

/**
 * messageFor — the 4-level resolution walker. Returns the user-facing string
 * for a ValidationError-shaped object. Always returns a string (never throws,
 * never returns undefined) so consumers can render unconditionally.
 *
 * @param {Object} error      — \`{ tag: "...", ...payload }\` per §55.9 + runtime-validators
 * @param {string} fieldName  — display name of the field (passed by C11)
 * @param {string} [cellName] — qualified cell name (\`signup.email\`); needed for Level-1 lookup
 * @returns {string}
 */
function _scrml_message_for(error, fieldName, cellName) {
  if (!error || typeof error !== "object" || typeof error.tag !== "string") {
    return _scrml_messages_fallback(fieldName);
  }
  const tag = error.tag;

  // Level 1: per-(cell, validator) inline override. Validator name maps from
  // ValidationError tag (e.g., "Required" → "req", "MinFailed" → "min"). Only
  // checks if cellName given (consumer must pass it for L1 to fire).
  if (typeof cellName === "string" && cellName.length > 0) {
    const validatorName = _SCRML_TAG_TO_VALIDATOR[tag];
    if (typeof validatorName === "string") {
      const inlineKey = cellName + "::" + validatorName;
      if (Object.prototype.hasOwnProperty.call(_scrml_messages_inline, inlineKey)) {
        return _scrml_messages_inline[inlineKey];
      }
    }
  }

  // Level 2: project-registered. Function takes (fieldName, ...payloadValues).
  const registeredFn = _scrml_messages_registered[tag];
  if (typeof registeredFn === "function") {
    const payloadArgs = _scrml_extract_payload(error);
    try {
      const result = registeredFn(fieldName, ...payloadArgs);
      if (typeof result === "string") return result;
    } catch (_e) {
      // Fall through to Level 3 if user-supplied function throws.
    }
  }

  // Level 3: shipped English default for the tag.
  const defaultFn = _SCRML_DEFAULT_MESSAGES[tag];
  if (typeof defaultFn === "function") {
    const payload = _scrml_extract_payload_first(error);
    return defaultFn(fieldName, payload);
  }

  // Unknown tag — fallback (never undefined).
  return _scrml_messages_fallback(fieldName);
}

// ---------------------------------------------------------------------------
// §41.14.7 Label resolution — project-wide Level-2 store (within 'messages' chunk).
// ---------------------------------------------------------------------------
// 4-level label resolution chain per SPEC §41.14.7 (highest precedence first):
//
//   Level 1: Slot override — <slot name="<fieldName>"> body owns the label.
//   Level 2: Project-registered — \`registerLabels({TypeName: {field: "..."}})\`
//            (THIS STORE).
//   Level 3: Type-field annotation — \`@label("...")\` (RESERVED for v1.next).
//   Level 4: Mechanical default — title-cased field name.
//
// v1.0 the formFor expander always resolves to Level 4. \`registerLabels\` seeds
// this store so v1.next Level-2 consultation lights up without API churn at
// the call site. Calls today work unchanged when Level-2 lookup lands.
//
// Stored shape: { TypeName: { fieldName: "Display label" } }. Composes across
// multiple calls — outer-key MERGE, inner-key OVERLAY (last-write-wins per
// (struct, field)). Mirrors registerMessages composition semantics (§41.12).
//
// Co-located with the messages chunk because (a) the helpers are tiny and
// don't justify a separate chunk; (b) both stores are project-wide app-text
// registries called from the same top-level boot positions; (c) future
// 4-level chain consultation will share the formFor / errors emission paths
// that already pull \`messages\`. Tree-shaken with \`messages\`.

const _scrml_labels_registered = {};

/**
 * Level-2 label registration — public facade for \`registerLabels\` (stdlib re-export).
 * Last-write-wins per (TypeName, fieldName) per SPEC §41.14.7. Composes across
 * multiple calls (each call merges into the table; inner objects overlay).
 *
 * @param {Object} map — \`{ TypeName: { fieldName: "Display label", ... }, ... }\`
 */
function _scrml_labels_register(map) {
  if (!map || typeof map !== "object") return;
  for (const typeName of Object.keys(map)) {
    const fields = map[typeName];
    if (!fields || typeof fields !== "object") continue;
    const existing = _scrml_labels_registered[typeName] || {};
    for (const fieldName of Object.keys(fields)) {
      const label = fields[fieldName];
      if (typeof label === "string") {
        existing[fieldName] = label;
      }
    }
    _scrml_labels_registered[typeName] = existing;
  }
}

/**
 * Resolve a struct-field label via the 4-level chain. v1.0 walks Level 2 →
 * Level 4 (Levels 1 and 3 are RESERVED — see header comment). Always returns
 * a string (never throws, never returns undefined) so consumers can render
 * unconditionally.
 *
 * @param {string} typeName    — struct type name (e.g., "Signup")
 * @param {string} fieldName   — struct field name (e.g., "email")
 * @returns {string}           — display label
 */
function _scrml_label_for(typeName, fieldName) {
  // Level 2: project-registered lookup.
  const fields = _scrml_labels_registered[typeName];
  if (fields && typeof fields[fieldName] === "string") {
    return fields[fieldName];
  }
  // Level 4: mechanical default — title-cased field name with intra-word
  // boundary detection. Matches mechanicalLabel() in emit-form-for.ts.
  if (!fieldName) return "";
  const spaced = String(fieldName).replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.replace(/(^|\\s)([a-z])/g, function(_m, p1, p2) {
    return p1 + p2.toUpperCase();
  });
}

// ---------------------------------------------------------------------------
// §51.0.F + §51.0.G Engine state-machine runtime hooks (chunk: 'engine')
// ---------------------------------------------------------------------------
// C13: rule= contract enforcement on the auto-declared engine variable.
//
// Substrate from C12 (per-engine, compile-time-baked):
//   - __scrml_engine_<varName>_transitions — Object.freeze({...}) keyed by
//     from-variant. Entries: ["X"] (single), ["A","B"] (multi), "*" (wildcard
//     escape hatch), [] (terminal — no transitions).
//   - The variant cell uses standard reactive substrate; current variant via
//     _scrml_reactive_get(varName) (returns bare-string variant tag), write
//     via _scrml_reactive_set(varName, value).
//
// This chunk adds three helpers:
//   - _scrml_engine_check_transition(currentVariant, target, table)
//       Pure boolean predicate. Looks up the from-variant entry; legal iff
//       the entry is "*" OR includes the target. No side effects.
//   - _scrml_engine_advance(varName, target, table, timersTable, idleEntry, internalTable, historyMap)
//       For \`@var.advance(.X)\`. Reads current variant, checks, throws with
//       "asserted advance failed" framing on failure, else sets the cell.
//       Per §51.0.G "loud failure" semantics. Returns true on EXTERNAL
//       transition, false on INTERNAL transition (§51.0.O). Codegen gates
//       the post-commit hook-firing call on the return value.
//   - _scrml_engine_direct_set(varName, target, table, timersTable, idleEntry, internalTable, historyMap)
//       For \`@var = .X\`. Reads current variant, checks, throws plain
//       E-ENGINE-INVALID-TRANSITION on failure, else sets the cell.
//       Per §51.0.F direct-write enforcement (Move 12). Returns the same
//       external/internal boolean as _scrml_engine_advance.
//
// A5-7 Wave 2.2 (§51.0.O): when internalTable is non-null AND the target is
// internal-legal from the current variant, the internal write-path runs:
// the cell value updates WITHOUT firing subscribers, no <onTransition>
// hooks fire, no timer clear/arm, no history-cell write. The helper returns
// false so the codegen-emitted post-commit hook-firing call is skipped.
// The idle watchdog DOES reset (§51.0.R — internal is engine activity).
//
// A5-7 Wave 2.3 (§51.0.N, Bug #3): when historyMap is non-null AND the
// EXTERNAL branch is taken AND currentVariant is a key in historyMap AND
// currentVariant !== target (real outer-exit, not self-loop), the helper
// captures the inner-engine variant from \`_scrml_state[historyMap[current]]\`
// into the synth history cell \`_scrml_state["_" + varName + "_" + current
// + "_history"]\` BEFORE the cell write. The internal branch explicitly
// skips this capture (per §51.0.O — internal does not exit the composite,
// so its history is never written). The history cell is read-only from
// user code (synth — §51.0.N "synth cell"); writes from anywhere outside
// these helpers are not addressable through any user-authored expression.
//
// Both throwing helpers funnel through _scrml_engine_check_transition so
// the lookup logic exists in exactly one place. Codegen emits ONE call per
// write site — no per-call message construction.

function _scrml_engine_check_transition(currentVariant, target, table) {
  if (table == null) return false;
  // S95 Bug 2 — normalize both sides to the bare tag string. Unit variants
  // are stored as bare strings; payload-bearing variants as \`{ variant, data }\`
  // tagged-objects (SPEC §51.3.2 Implementation notes, landed S22). The
  // transition table is keyed/valued by bare tags, so both sides need
  // extraction. Self-write idempotent check and the \`entry.indexOf(target)\`
  // lookup both depend on tag-shaped comparands.
  const fromTag = _scrml_engine_variant_tag(currentVariant);
  const toTag = _scrml_engine_variant_tag(target);
  const entry = table[fromTag];
  if (entry === "*") return true;
  if (Array.isArray(entry) && entry.indexOf(toTag) !== -1) return true;
  return false;
}

// S95 Bug 2 — Extract the bare tag string from an enum variant value.
// Unit variants are stored as bare strings (\`"Idle"\`); payload-bearing
// variants as \`{ variant: "X", data: {...} }\` tagged-objects per SPEC §51.3.2.
// Used by engine helpers + dispatchers that need to switch / compare against
// the variant tag without caring whether a payload is present. Returns the
// input untouched when neither shape applies (defensive; non-variant values
// are not legitimate engine cell values and would already be a contract
// violation at the codegen level).
function _scrml_engine_variant_tag(value) {
  if (value != null && typeof value === "object" && typeof value.variant === "string") {
    return value.variant;
  }
  return value;
}

// A5-7 Wave 2.4 (§51.0.Q.1 + §51.0.N, Bug #2) — pending-history-restore flag map.
// Keyed by outer engine var name; value is the target outer variant tag when the
// most recent write to that outer var was the .Tag.history structured target
// form. Read+cleared by the outer dispatcher's composite-arm postMountJs after
// the inner mount slot lands in DOM. When the flag is set AND the synth cell
// _scrml_state["_<outerVar>_<targetTag>_history"] is non-null, the inner cell
// restores from the synth cell. When unset OR cell null, the inner falls
// through to its initial= attribute (per §51.0.N empty-history fallback).
//
// The flag is SET by _scrml_engine_direct_set / _scrml_engine_advance when
// the codegen-emitted 8th arg (isHistoryRestore) is true. The flag is CLEARED
// by the dispatcher (postMountJs) immediately after consumption so subsequent
// non-history-form writes don't accidentally restore.
const _scrml_engine_pending_history_restore = {};

// A5-7 Wave 2.3 (§51.0.N, Bug #3) — Capture the inner-engine variant into
// the synth history cell on an external outer-exit. Called by both
// _scrml_engine_advance and _scrml_engine_direct_set in the EXTERNAL branch
// BEFORE the cell write, when historyMap is non-null AND historyMap[current]
// names an inner-engine var.
//
// The "real exit" guard (current !== target) ensures a self-loop transition
// (rule=.X from .X) doesn't capture stale state — a self-loop is conceptually
// equivalent to a re-entry, where the inner re-initializes per §51.0.N + Q.1.
// (Self-loop semantics may evolve; current conservative behavior is "do not
// capture on self-loop"; if user-feedback flags this as wrong, the guard can
// be widened.)
function _scrml_engine_history_capture_on_exit(varName, current, target, historyMap) {
  if (historyMap == null) return;
  if (current === target) return; // self-loop — not a real exit, do not capture
  var innerVarName = historyMap[current];
  if (typeof innerVarName !== "string" || innerVarName.length === 0) return;
  // Capture the inner-engine var's current value into the synth cell.
  // The synth cell key matches the codegen convention in
  // emit-engine.ts:engineHistoryCellKey: "_<outerVar>_<currentVariant>_history".
  var cellKey = "_" + varName + "_" + current + "_history";
  // Read inner directly from _scrml_state (synth cells / engine cells live
  // in the same flat reactive store).
  _scrml_state[cellKey] = _scrml_state[innerVarName];
}

function _scrml_engine_advance(varName, target, table, timersTable, idleEntry, internalTable, historyMap, isHistoryRestore) {
  // timersTable (optional, A5-4): per-state-tag timer-config map for engines
  // with at least one <onTimeout>. When provided, clear-on-exit fires before
  // the cell write and arm-on-entry fires after. When null/undefined (engines
  // with zero <onTimeout>), the timer paths short-circuit (no-op).
  // internalTable (optional, A5-7 Wave 2.2 §51.0.O): per-engine INTERNAL
  // transition table. When provided AND the target is internal-legal from
  // the current variant, the internal write-path runs (no subscriber fire,
  // no <onTransition>, no timer arm/clear, no history) and the helper returns
  // false. Otherwise (or when internalTable is null), the canonical external
  // path runs and returns true. Codegen gates the post-commit hook-firing
  // call on this boolean.
  // historyMap (optional, A5-7 Wave 2.3 §51.0.N): per-engine HISTORY MAP
  // {outerVariantTag → innerEngineVarName}. When provided AND the EXTERNAL
  // branch is taken AND current is a key in the map AND current !== target,
  // the helper captures _scrml_state[innerEngineVarName] into the synth
  // cell _scrml_state["_" + varName + "_" + current + "_history"] BEFORE
  // the cell write. The internal branch (above) skips this capture by
  // construction (no real exit).
  const current = _scrml_reactive_get(varName);
  // S95 Bug 2 — normalize both sides to bare tag for control-flow decisions.
  // The CELL writes still store the full \`target\` (which may be a payload-
  // bearing \`{ variant, data }\` tagged-object); only the tag is used for
  // rule= comparison, self-write detection, timer/history lookup keys, and
  // the pending-history-restore flag (which lives in tag space).
  const currentTag = _scrml_engine_variant_tag(current);
  const targetTag = _scrml_engine_variant_tag(target);
  // §51.0.F (v0.3 Option-d synthesis) — IDEMPOTENT SELF-WRITE NO-OP.
  // When target equals the current variant, this is a self-write — by spec
  // a true no-op (NOT a rule= violation, even when the from-state's rule=
  // does not list itself). No <onTransition> fires, no history capture,
  // no timer rearm, no idle-watchdog reset, no subscriber fire. Returns
  // false (matches the "no external transition occurred" signal so any
  // caller that gates post-commit hooks on the return value treats this
  // as a non-event).
  // Precedent: _scrml_engine_history_capture_on_exit:2390 already short-
  // circuits self-loops as "not a real exit"; this guard makes the front-
  // door helpers consistent with that intuition. W-ENGINE-SELF-WRITE-DETECTED
  // (info-level) surfaces the no-op at compile time when statically detectable.
  //
  // S95 Bug 2 — self-write detection runs on TAGS (a payload-bearing self-
  // write \`@phase = .Dragging(otherId)\` is a tag-identity self-write — same
  // state-child, just refreshing payload). Re-evaluating semantics here:
  // SPEC §51.0.F.1 frames idempotency as "self-write to the current variant"
  // which is variant-identity, not value-identity. A payload-refresh self-
  // write IS a tag self-write under this spec — runtime no-op. If adopters
  // need payload-refresh-fires-subscribers semantics in the future, that's
  // a SPEC amendment, not a runtime change here.
  if (currentTag === targetTag) return false;
  // A5-7 Wave 2.2 — internal-path check FIRST. Per §51.0.O an internal
  // transition is preferred when both an internal rule and an external rule
  // permit the same target (canonical example: composite self-loop
  // internal-rule=.Playing from .Playing; if the user also has
  // rule=.Playing for some reason, the internal semantics win — they're
  // the more-specific "stay in place" intent).
  if (internalTable != null && _scrml_engine_check_transition(currentTag, targetTag, internalTable)) {
    // §51.0.O internal write path:
    //   - Update the cell value WITHOUT firing subscribers (variant-guard
    //     dispatcher would tear down + re-create the arm body, including the
    //     inner engine — which is exactly what internal:rule= avoids).
    //   - SKIP <onTransition> hook fire (helper returns false; codegen gates).
    //   - SKIP timer clear/arm (timers are state-child-scoped; the composite
    //     did not exit — timers stay armed).
    //   - SKIP history-cell write (§51.0.N — internal does not write history).
    //   - DO reset the idle watchdog: §51.0.R counts ANY transition as
    //     engine activity, internal included.
    _scrml_state[varName] = target;
    if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
    return false;
  }
  if (!_scrml_engine_check_transition(currentTag, targetTag, table)) {
    throw new Error(
      "E-ENGINE-INVALID-TRANSITION: asserted advance failed. " +
      "Variable: " + varName + ". Move: ." + String(currentTag) + " => ." + String(targetTag) +
      ". The from-state's rule= contract does not permit this target."
    );
  }
  // A5-7 Wave 2.3 §51.0.N — history capture on EXTERNAL outer-exit. Fires
  // BEFORE the cell write so the captured inner variant reflects the state
  // at the moment of exit (not after any side effect of the write). Tree-
  // shaken via null historyMap.
  //
  // S95 Bug 2 — pass currentTag (not raw \`current\`) so history-cell key
  // construction operates on tag space. The captured inner-engine value
  // stored in the synth cell IS the inner cell value (also potentially a
  // tagged-object — handled by the inner engine's read sites).
  if (historyMap != null) _scrml_engine_history_capture_on_exit(varName, currentTag, targetTag, historyMap);
  // A5-7 Wave 2.4 §51.0.Q.1 — set the pending-history-restore flag BEFORE
  // the cell write (which fires the outer dispatcher's subscriber). The
  // dispatcher composite-arm postMountJs reads the flag, restores inner
  // from the synth cell when set, and clears the flag. Tree-shaken via
  // isHistoryRestore default-false.
  //
  // S95 Bug 2 — historyMap is keyed by tag (outerVariantTag → innerVarName),
  // pending-restore flag is keyed by tag too. Use targetTag.
  if (isHistoryRestore === true && historyMap != null && historyMap[targetTag] != null) {
    _scrml_engine_pending_history_restore[varName] = targetTag;
  }
  // Clear timers attached to the OUTGOING state-child first (timers belong
  // to the from-state — the spec semantics are "armed on entry, cleared on
  // exit"). Re-entering the same state-child clears + re-arms below.
  //
  // S95 Bug 2 — timersTable is keyed by tag (state-child names map directly).
  if (timersTable != null) _scrml_engine_clear_state_timers(varName, currentTag, timersTable);
  _scrml_reactive_set(varName, target);
  // Arm timers for the INCOMING state-child. Re-entering the same state-child
  // (current === target) re-arms a fresh timer per §51.12.4 reset semantics.
  if (timersTable != null) _scrml_engine_arm_state_timers(varName, targetTag, timersTable, table);
  // A5-6 §51.0.R — reset the engine's idle watchdog on every successful
  // transition (machine-wide event-timeout). idleEntry is null when the
  // engine declares no <onIdle> (tree-shake).
  if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
  return true;
}

function _scrml_engine_direct_set(varName, target, table, timersTable, idleEntry, internalTable, historyMap, isHistoryRestore) {
  // timersTable: see _scrml_engine_advance above.
  // idleEntry (A5-6 §51.0.R): per-engine event-timeout watchdog config or null.
  // internalTable (A5-7 Wave 2.2 §51.0.O): per-engine internal transition
  // table or null. Returns true on external transition, false on internal.
  // historyMap (A5-7 Wave 2.3 §51.0.N): per-engine history map or null. See
  // _scrml_engine_advance above for full semantics.
  const current = _scrml_reactive_get(varName);
  // S95 Bug 2 — tag-space normalization (see _scrml_engine_advance for the
  // full rationale). The cell stores the full target value (payload-bearing
  // variants are \`{ variant, data }\`); transition-table lookups, self-write
  // detection, history-map / pending-restore lookups, and timer-table
  // lookups all operate in tag space.
  const currentTag = _scrml_engine_variant_tag(current);
  const targetTag = _scrml_engine_variant_tag(target);
  // §51.0.F (v0.3 Option-d synthesis) — IDEMPOTENT SELF-WRITE NO-OP.
  // See _scrml_engine_advance above for the full rationale. A self-write
  // (target === current) is a true no-op, NOT a rule= violation. Returns
  // false (matches the non-external-transition signal). Surfaced at compile
  // time by W-ENGINE-SELF-WRITE-DETECTED (info-level lint).
  if (currentTag === targetTag) return false;
  // A5-7 Wave 2.2 — internal-path check FIRST (see _scrml_engine_advance).
  if (internalTable != null && _scrml_engine_check_transition(currentTag, targetTag, internalTable)) {
    // §51.0.O internal write path — see _scrml_engine_advance for full
    // rationale. Side-effect-free write: update cell value, do NOT fire
    // subscribers, do NOT touch timers, do NOT touch history. Idle watchdog
    // resets per §51.0.R (internal IS engine activity).
    _scrml_state[varName] = target;
    if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
    return false;
  }
  if (!_scrml_engine_check_transition(currentTag, targetTag, table)) {
    throw new Error(
      "E-ENGINE-INVALID-TRANSITION: illegal direct write to engine variable. " +
      "Variable: " + varName + ". Move: ." + String(currentTag) + " => ." + String(targetTag) +
      ". The from-state's rule= contract does not permit this target."
    );
  }
  // A5-7 Wave 2.3 §51.0.N — history capture on EXTERNAL outer-exit (see
  // _scrml_engine_advance for rationale). Tree-shaken via null historyMap.
  if (historyMap != null) _scrml_engine_history_capture_on_exit(varName, currentTag, targetTag, historyMap);
  // A5-7 Wave 2.4 §51.0.Q.1 — pending-history-restore flag (see
  // _scrml_engine_advance for rationale).
  if (isHistoryRestore === true && historyMap != null && historyMap[targetTag] != null) {
    _scrml_engine_pending_history_restore[varName] = targetTag;
  }
  if (timersTable != null) _scrml_engine_clear_state_timers(varName, currentTag, timersTable);
  _scrml_reactive_set(varName, target);
  if (timersTable != null) _scrml_engine_arm_state_timers(varName, targetTag, timersTable, table);
  if (idleEntry != null) _scrml_engine_reset_idle_watchdog(varName, idleEntry, table);
  return true;
}

// ---------------------------------------------------------------------------
// §51.0.M onTimeout runtime — A5-4 engine state-child timer arm/clear
// ---------------------------------------------------------------------------
// Runtime support for the <onTimeout after=DURATION to=.Variant/> element.
// Backbone is shared with §51.12 (_scrml_machine_arm_timer /
// _scrml_machine_clear_timer); these two helpers provide the per-state-entry
// arm + per-state-exit clear bookkeeping for engine state-children.
//
// timersTable shape (compile-time-baked per engine, see emit-engine.ts):
//   const __scrml_engine_<varName>_timers = Object.freeze({
//     "Loading": [
//       { ms: 30000, target: "TimedOut" },
//       // OR for computed-delay (§51.12.3.1, A5-5):
//       { msExpr: function(){ return Math.min(1000 * 2 ** _scrml_reactive_get("attempt"), 30000) * 1; },
//         target: "Retry" },
//     ],
//     "Idle": [],
//     // ...
//   });
// (Tree-shake: emitted ONLY when the engine has at least one <onTimeout>; for
//  engines with zero timers, codegen passes null for the timersTable arg and
//  these helpers no-op.)
//
// Timer-key encoding (per SCOPE §3 decision #5): varName + "::" + stateName + "::" + index.
// The flat _scrml_machine_timers map is shared with legacy <machine> rules;
// composite keys avoid collision when an app mixes both surfaces or uses the
// same state name across multiple engines.

function _scrml_engine_arm_state_timers(varName, stateName, timersTable, table) {
  // Arm every <onTimeout> entry attached to stateName on engine varName.
  // table is the engine's transition table — needed so the timer's setterFn
  // can route through _scrml_engine_direct_set and enforce the rule= contract
  // at fire time (defensive — A5-3 typer already validated to= compile-time,
  // so a legitimate <onTimeout> never throws here).
  if (timersTable == null) return;
  var list = timersTable[stateName];
  if (!Array.isArray(list) || list.length === 0) return;
  for (var i = 0; i < list.length; i++) {
    var ent = list[i];
    var ms;
    if (typeof ent.ms === "number") {
      // Literal-form duration (constant-folded at compile time).
      ms = ent.ms;
    } else if (typeof ent.msExpr === "function") {
      // Computed-form duration (§51.12.3.1 — S67 amendment, A5-5).
      // The arrow-fn returns the runtime ms value; clamp negative/NaN to 0
      // per spec (equivalent to firing on the next tick per setTimeout).
      var v;
      try { v = ent.msExpr(); } catch (e) { v = 0; }
      ms = (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0;
    } else {
      continue; // malformed entry — defensive skip
    }
    // A5-6 Feature 1 (S79) -- named-timer key. When the entry has 'name',
    // the key uses 'n:NAME' instead of the index, so cancelTimer("NAME")
    // can reconstruct the same key from the same (varName, stateName).
    // Identifier-shape validation at compile time (E-TIMER-NAME-INVALID)
    // guarantees 'name' is never digits-only and so cannot collide with
    // an index-keyed sibling. Defensive runtime: still namespace named
    // entries with the 'n:' prefix to make collisions structurally
    // impossible.
    var keySuffix = (typeof ent.name === "string" && ent.name.length > 0)
      ? "n:" + ent.name
      : String(i);
    var timerKey = varName + "::" + stateName + "::" + keySuffix;
    var target = ent.target;
    // setterFn: route the timer-fire write through the engine's transition
    // table (A5-4 §51.0.M Semantics — a timer-induced transition is a legal
    // transition event that obeys the rule= contract).
    var setterFn = (function (vn, tbl) {
      return function (tg) { _scrml_engine_direct_set(vn, tg, tbl); };
    })(varName, table);
    _scrml_machine_arm_timer(timerKey, ms, target, {
      fromVariant: stateName,
      label: null,
      auditTarget: null,
      rulesJson: null,
      setterFn: setterFn,
    });
  }
}

function _scrml_engine_clear_state_timers(varName, stateName, timersTable) {
  // Clear every timer armed for stateName on engine varName. Called on
  // exit (any rule= transition or external write). No-ops when the state had
  // no <onTimeout> entries OR when the table is null (tree-shake path).
  if (timersTable == null) return;
  var list = timersTable[stateName];
  if (!Array.isArray(list) || list.length === 0) return;
  for (var i = 0; i < list.length; i++) {
    var ent = list[i];
    // A5-6 Feature 1 (S79) -- mirror the keying scheme used at arm time.
    var keySuffix = (ent && typeof ent.name === "string" && ent.name.length > 0)
      ? "n:" + ent.name
      : String(i);
    var timerKey = varName + "::" + stateName + "::" + keySuffix;
    _scrml_machine_clear_timer(timerKey);
  }
}

// A5-6 Feature 1 (SPEC sec 51.0.M name= extension, S79).
// cancelTimer("NAME") -- invoked from within an engine state-child arm body
// (event handler / interpolation expression) -- lowers to a call to this
// helper with the surrounding (varName, stateName) baked in by codegen.
// The helper reconstructs the same composite key the arm-on-entry path used
// and clears just that one timer via the shared _scrml_machine_clear_timer.
//
// Per SPEC sec 51.0.M S79 amendment + SCOPE sec 3.2 Option A:
//   - Names are scope-local to the state-child; cancelTimer can only address
//     timers declared in the SAME state-child. Codegen guarantees this by
//     using the static (varName, stateName) of the enclosing arm.
//   - Unknown names are a runtime no-op (matches clearTimeout(undefined)
//     browser semantics; SCOPE sec 3.3 explicit decision).
//   - Already-fired and not-yet-armed timers are no-ops.
function _scrml_engine_clear_named_timer(varName, stateName, name) {
  if (typeof name !== "string" || name.length === 0) return;
  var timerKey = varName + "::" + stateName + "::n:" + name;
  _scrml_machine_clear_timer(timerKey);
}

// ---------------------------------------------------------------------------
// §51.0.R onIdle runtime — A5-6 engine event-timeout watchdog
// ---------------------------------------------------------------------------
// Runtime support for the <onIdle after=DURATION to=.Variant/> element. One
// watchdog per engine. Armed at module-init alongside the variant cell;
// RESET on every successful transition (any _scrml_engine_direct_set or
// _scrml_engine_advance commit). Fires through the same write-path as a
// direct write — rule= validation applies at fire time.
//
// idleEntry shape (compile-time-baked per engine, see emit-engine.ts):
//   const __scrml_engine_<varName>_idle = {
//     ms: 300000, target: "Idle"
//   };
//   // OR for computed-delay (§51.12.3.1, A5-5):
//   const __scrml_engine_<varName>_idle = {
//     msExpr: function(){ return _scrml_reactive_get("backoffDelay") * 1; },
//     target: "Idle"
//   };
// (Tree-shake: emitted ONLY when the engine declares <onIdle>; codegen passes
//  null when absent and these helpers no-op.)
//
// Timer-key encoding: varName + "::__idle". The "::__idle" suffix cannot
// collide with state-child timer keys (state names start with PascalCase, not
// double-underscore).

function _scrml_engine_arm_idle_watchdog(varName, idleEntry, table) {
  // Arm the engine's machine-wide idle watchdog (A5-6 §51.0.R).
  // table is the engine's transition table — the setterFn routes the
  // watchdog-fire write through _scrml_engine_direct_set so rule= validation
  // applies (§51.0.R sub-A1: rule=-honoring fires).
  if (idleEntry == null) return;
  var ms;
  if (typeof idleEntry.ms === "number") {
    ms = idleEntry.ms;
  } else if (typeof idleEntry.msExpr === "function") {
    var v;
    try { v = idleEntry.msExpr(); } catch (e) { v = 0; }
    ms = (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0;
  } else {
    return; // malformed entry — defensive skip
  }
  var timerKey = varName + "::__idle";
  var target = idleEntry.target;
  var setterFn = (function (vn, tbl) {
    return function (tg) { _scrml_engine_direct_set(vn, tg, tbl); };
  })(varName, table);
  _scrml_machine_arm_timer(timerKey, ms, target, {
    fromVariant: null,
    label: null,
    auditTarget: null,
    rulesJson: null,
    setterFn: setterFn,
  });
}

function _scrml_engine_reset_idle_watchdog(varName, idleEntry, table) {
  // Reset the watchdog: clear any pending timer + re-arm. Called after
  // every successful _scrml_engine_direct_set / _scrml_engine_advance commit
  // (per A5-6 §51.0.R "reset on every transition" semantics). Module-init
  // arm uses _scrml_engine_arm_idle_watchdog directly (no clear needed).
  if (idleEntry == null) return;
  var timerKey = varName + "::__idle";
  _scrml_machine_clear_timer(timerKey);
  _scrml_engine_arm_idle_watchdog(varName, idleEntry, table);
}

${_STDLIB_AUTH_CHUNK}${_STDLIB_CRYPTO_CHUNK}${_STDLIB_DATA_CHUNK}${_STDLIB_HOST_CHUNK}`;

/**
 * Runtime filename used in external mode.
 */
export const RUNTIME_FILENAME = "scrml-runtime.js";
