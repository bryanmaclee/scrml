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
// declaration. Read by reset(@cell) lowering (C5 — pending) to materialize
// the default when reset is invoked. Per SPEC §6.8.1 the default is the
// EXPRESSION (not a snapshot), so the closure is re-evaluated each reset.
//
// Parallel map (separate from _scrml_state / _scrml_derived_fns) so the
// existing reactive registries keep their shape stability.
const _scrml_default_fns = {};
function _scrml_default_set(name, fn) {
  _scrml_default_fns[name] = fn;
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
  // meta (optional): { fromVariant, label, auditTarget, rulesJson }
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
    _scrml_reactive_set(name, target);
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
  // Bridge with _scrml_effect auto-tracking: record _scrml_state[name] as a dependency
  if (typeof _scrml_track === "function") _scrml_track(_scrml_state, name);
  // Derived reactives are stored in _scrml_derived_cache, not _scrml_state.
  // Delegate to _scrml_derived_get for lazy re-evaluation when dirty.
  if (_scrml_derived_fns[name]) return _scrml_derived_get(name);
  return _scrml_state[name];
}

function _scrml_reactive_set(name, value) {
  _scrml_state[name] = value;
  // §6.6.3 Phase 2: eagerly propagate dirty flags to all downstream derived nodes
  // before subscribers fire and before this call returns. Synchronous, no re-evaluation.
  const dirtied = _scrml_propagate_dirty(name);
  if (_scrml_subscribers[name]) {
    for (const fn of _scrml_subscribers[name]) {
      try { fn(value); } catch(e) { console.error("scrml subscriber error:", e); }
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
  return value;
}

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
  // Fast path: clear all — avoid iterating old nodes one by one
  if (newItems.length === 0) {
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
    for (let i = 0; i < newItems.length; i++) {
      const node = createFn(newItems[i], i);
      if (!node) continue; // createFn returned undefined (filtered item)
      node._scrml_key = keyFn(newItems[i], i);
      container.appendChild(node);
    }
    return;
  }

  const newLen = newItems.length;
  const newKeys = new Array(newLen);
  for (let i = 0; i < newLen; i++) newKeys[i] = keyFn(newItems[i], i);

  const newKeySet = new Set(newKeys);
  // Remove nodes whose keys are no longer present
  for (const [key, node] of oldNodes) {
    if (!newKeySet.has(key)) container.removeChild(node);
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
  for (let i = newLen - 1; i >= 0; i--) {
    const node = newNodes[i];
    if (!node) continue; // filtered item (createFn returned undefined)
    if (!inLIS.has(i)) {
      container.insertBefore(node, nextSibling);
    }
    nextSibling = node;
  }

  } finally { _scrml_tracking_paused = wasPaused; }
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

function _scrml_debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function _scrml_throttle(fn, ms) {
  let last = 0;
  return function(...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    }
  };
}

function _scrml_reactive_debounced(name, fn, ms) {
  _scrml_reactive_set(name, fn());
  // Debounced update would re-evaluate fn after delay
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
  const MAX_RUNS = 100; // infinite loop guard

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

    try {
      fn();
    } finally {
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
    try { fn(); } finally { _scrml_effect_stack.pop(); }

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

`;

/**
 * Runtime filename used in external mode.
 */
export const RUNTIME_FILENAME = "scrml-runtime.js";
