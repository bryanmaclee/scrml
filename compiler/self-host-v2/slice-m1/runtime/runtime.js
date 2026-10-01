// =============================================================================
// scrml bootstrap runtime — slice M1 (dpa-051 §5, §6; SPEC §66).
//
// This is TARGET code: the JavaScript that programs compiled by the bootstrap
// printer (compiler/self-host-v2/print.scrml) run against. It is not compiler
// code (dpa-051 §8.5). It replaces impl#1's flat `_scrml_state["<chunk>$name"]`
// keyspace with:
//
//   - INSTANCE RECORDS: { id, decl, fields: [Signal], handles: [Cell], kids,
//     scope }. A field is an array slot in a record the code already holds
//     (§5.1). The shared instance of a declaration is id 0, created lazily
//     (§66.6.4). Records are created at CONSTRUCTION, before any render (L12 (b)).
//   - A SCOPE TREE: root → instance → <each> row → conditional arm. Every
//     effect and listener is constructed WITH a scope and disposed with it
//     (§5.6). An unscoped effect cannot be constructed.
//   - IMMUTABLE VALUES (§6.1, R3): every edit makes a new value, so a snapshot
//     is free (§66.10). Nothing enforces it at runtime: Core never emits an
//     in-place mutation (every write is a classified `Write`), so the dev-mode
//     deep-freeze was DROPPED (S437 PA decision — it cost 50–80× on large
//     sequences, slice-m1/progress.md). The identity/value line stays: instance
//     records, scopes and `as=` handles are IDENTITIES that hold values (§45.1),
//     never copied and never compared as values.
//   - KEYED <each> RECONCILIATION in which a row OWNS a scope, so an instance
//     created in a row moves with the row and is disposed with it (§5.3).
//
// Reused leaf (audited scope-clean): `lis` — the longest-increasing-subsequence
// helper from impl#1's runtime-template.js (`_scrml_lis`). Nothing else of the
// impl#1 runtime is imported; its reconcile is keyed by DOM expandos and has no
// scope axis.
// =============================================================================

// ---------------------------------------------------------------------------
// Stats — live effect / listener counts, for tests and devtools.
// ---------------------------------------------------------------------------
export const stats = { effects: 0, deriveds: 0, listeners: 0, instances: 0, whens: 0 };

// ---------------------------------------------------------------------------
// Scopes.
//
// Teardown order (SPEC §6.7.2): depth-first — every child scope is torn down
// before its parent begins; then, for the scope itself, step 1 unregisters its
// `when` effects, and the remaining cleanups (listeners, effects, DOM, records)
// run last-in-first-out. (Steps 2–4 — <timer>/<poll>, cleanup(), animationFrame
// — have no bootstrap form yet; they will join the LIFO list after step 1.)
// ---------------------------------------------------------------------------
export class Scope {
  constructor(parent) {
    this.parent = parent;
    this.children = new Set();
    this.whens = [];
    this.cleanups = [];
    this.disposed = false;
    if (parent) parent.children.add(this);
  }
  /** Register a cleanup to run when this scope is disposed. */
  own(cleanup) {
    if (this.disposed) { cleanup(); return; }
    this.cleanups.push(cleanup);
  }
  /** Register a `when` effect's unregistration — teardown step 1 (§6.7.2). */
  ownWhen(unregister) {
    if (this.disposed) { unregister(); return; }
    this.whens.push(unregister);
  }
  child() { return new Scope(this); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    batch(() => {
      for (const c of [...this.children].reverse()) c.dispose();
      for (const unregister of this.whens) unregister();
      for (let i = this.cleanups.length - 1; i >= 0; i--) this.cleanups[i]();
    });
    this.children.clear();
    this.whens = [];
    this.cleanups = [];
    if (this.parent) this.parent.children.delete(this);
  }
}

/** The program-lifetime scope. Shared instances live here. */
export const root = new Scope(null);

function requireScope(scope, what) {
  if (!(scope instanceof Scope) || scope.disposed) {
    throw new Error(`${what} requires a live owning scope (dpa-051 §5.6: every effect has an owner)`);
  }
}

// ---------------------------------------------------------------------------
// Signals: Cell (writable), Derived (computed, read-only), Effect.
// Push-invalidate / pull-recompute: a write marks dependents stale and queues
// effects; effects run once per flush and pull derived values lazily, so a
// derived value is recomputed at most once per change and never glitches.
// ---------------------------------------------------------------------------
let tracking = null;
let batchDepth = 0;
// Construction (L12 (b)): the depth of nested factory runs, and the seeds owed
// until the outermost one ends.
let constructing = 0;
let owed = [];
const SEEDING = Symbol("seeding");
const queue = new Set();
// `when` effects (§6.7.4) wait until the render / structure effects of the
// same flush have settled: a conditional arm or <each> row that the same
// batch unmounts unregisters its `when`s (teardown step 1) BEFORE they could
// run against a scope that is going away.
const whenQueue = new Set();

function track(source) {
  if (tracking) {
    tracking.sources.add(source);
    source.observers.add(tracking);
  }
}

function invalidate(source) {
  for (const o of [...source.observers]) o.markStale();
}

export function untrack(fn) {
  const saved = tracking;
  tracking = null;
  try { return fn(); } finally { tracking = saved; }
}

export function batch(fn) {
  batchDepth++;
  try { return fn(); } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

// When runs are flushed ITERATIVELY: a When triggered inside another's body
// (or inside an effect that body caused) waits for the outermost flush loop
// instead of recursing — a long causal chain is a loop, never a deep stack
// (review round 3, R2-2). Render / structure effects still settle at every
// batch end. `flushEvent`: the external event of the outermost flush (lazy;
// see WhenEvent).
let flushDepth = 0;
let whenRunning = false;
let flushEvent = null;

function flush() {
  flushDepth++;
  try {
    for (;;) {
      if (queue.size > 0) {
        const [e] = queue;
        queue.delete(e);
        if (!e.disposed) e.run();
      } else if (whenQueue.size > 0 && !whenRunning) {
        const [w] = whenQueue;
        whenQueue.delete(w);
        if (w.disposed) continue;
        whenRunning = true;
        try { w.run(); } finally { whenRunning = false; }
      } else {
        return;
      }
    }
  } finally {
    if (--flushDepth === 0) flushEvent = null;
  }
}

export class Cell {
  constructor(value) {
    this.value = value;
    this.observers = new Set();
    // A seed still owed (an initializer queued during construction, see
    // `construct`), SEEDING while it runs, or null once the value is settled.
    this.pending = null;
  }
  get() { track(this); if (this.pending !== null) this.settle(); return this.value; }
  /** The current value without subscribing (used by writes). */
  peek() { if (this.pending !== null) this.settle(); return this.value; }
  set(v) {
    this.pending = null;
    if (Object.is(v, this.value)) return;
    this.value = v;
    batch(() => invalidate(this));
  }
  /** Run an owed seed now (on first demand, or when construction ends). */
  settle() {
    const init = this.pending;
    if (init === SEEDING) throw new Error("a `let` initializer reads itself while the program is being constructed (a seeding cycle)");
    this.pending = SEEDING;
    try { this.value = untrack(init); } finally { if (this.pending === SEEDING) this.pending = null; }
  }
}

function unsubscribe(comp) {
  for (const s of comp.sources) s.observers.delete(comp);
  comp.sources.clear();
}

export class Derived {
  constructor(scope, fn) {
    requireScope(scope, "a derived value");
    this.fn = fn;
    this.value = undefined;
    this.stale = true;
    this.disposed = false;
    this.sources = new Set();
    this.observers = new Set();
    stats.deriveds++;
    scope.own(() => { this.disposed = true; unsubscribe(this); stats.deriveds--; });
  }
  get() {
    track(this);
    if (this.stale && !this.disposed) this.recompute();
    return this.value;
  }
  peek() { return untrack(() => this.get()); }
  recompute() {
    unsubscribe(this);
    const saved = tracking;
    tracking = this;
    try { this.value = this.fn(); } finally { tracking = saved; }
    this.stale = false;
  }
  markStale() {
    if (this.stale) return;
    this.stale = true;
    invalidate(this);
  }
}

class Effect {
  constructor(scope, fn) {
    this.fn = fn;
    this.disposed = false;
    this.sources = new Set();
    stats.effects++;
    scope.own(() => {
      this.disposed = true;
      queue.delete(this);
      unsubscribe(this);
      stats.effects--;
    });
    this.run();
  }
  run() {
    unsubscribe(this);
    const saved = tracking;
    tracking = this;
    try { this.fn(); } finally { tracking = saved; }
  }
  markStale() {
    queue.add(this);
    if (batchDepth === 0) flush();
  }
}

/** A tracked side effect, owned by `scope`. Re-tracks on every run. */
export function effect(scope, fn) {
  requireScope(scope, "an effect");
  return new Effect(scope, fn);
}

// ---------------------------------------------------------------------------
// `when <deps> changes { body }` (SPEC §6.7.4) and the suspendable task layer.
//
// A When subscribes to EXACTLY its dep cells (it is an observer of each, the
// set every write fans out to) and never tracks its body: an unlisted read is
// not a trigger. It does not run at registration. A change queues it; it runs
// once per flush — after the write's batch completes, before control returns
// to the writer, so before the next microtask boundary — however many of its
// deps that batch changed. Its body runs untracked and in ONE batch. A derived
// value is recomputed on read (lazy pull), so a derived the body reads already
// reflects the change (§6.7.4 flush ordering, by construction).
//
// Each run gets a TASK: the handle a suspension (`suspend`, Core
// Stmt.Suspend) resumes through. Unregistering the When (its scope's teardown,
// step 1) cancels every task it has in flight: a cancelled task's continuation
// never runs, so a destroyed scope's effect never resumes and never writes.
//
// THE NEWEST RUN WINS (RULED (b), user-voice S446): a run that starts while an
// earlier run of the SAME When is suspended cancels that earlier run's task —
// its continuation never resumes. Cancellation is not a rollback: what the
// earlier run wrote before it suspended stays written.
//
// RE-ENTRY — CYCLES (parity with impl#1's `_scrml_when_changes`, PA-ruled
// S446; mechanism re-done in review round 3). Every run carries its CAUSE: a
// provenance link (`Cause`) naming the When that ran and the cause of THAT
// run, back to an external write (null). The body, every continuation of the
// run's task, and every write made under them carry that link
// (`currentCause`). A trigger is CYCLIC iff its cause's ancestry already
// contains the triggered When — the When caused its own re-trigger, directly
// (a self-write through a call, synchronous or from a resumed continuation) or
// through other Whens. A cyclic trigger re-runs once; when the ancestry
// already holds the When twice it is dropped and reported (console.error, the
// impl#1 wording) — the page stays alive. A NON-cyclic trigger always runs
// (§6.7.4 "The body executes whenever any listed dependency changes value"):
// a downstream When that a run's continuations re-trigger three times runs
// three times. (SPEC §6.7.4 names only the direct self-write,
// E-LIFECYCLE-006; cross-`when` cycles are a SPEC question.)
//
// RULED (b) is unaffected: an external write has no cause (empty ancestry),
// so a re-trigger from outside a suspended run is never cyclic — it runs and
// cancels the suspended task (newest wins). A When queued by several writes
// before it runs keeps the least cyclic cause (an external one if any): that
// trigger alone would have run it.
//
// THE RUNAWAY BACKSTOP (review round 3, R2-2). A chain can grow without ever
// being cyclic: a row `when` that appends a row creates a NEW When whose
// ancestry does not contain it. Each external event (one outermost flush) owns
// a budget, WHEN_EVENT_BUDGET, spent by every When run and every When
// registration that some When CAUSED (a non-null cause) — the direct fan-out of
// the external write itself is bounded by the Whens that exist and is free.
// When the budget is spent the event is STOPPED: reported once, and every
// further run or continuation it caused is dropped. It never crashes: When runs
// are flushed iteratively (a When triggered inside another's body waits for the
// outer flush loop), so a long chain is a loop, not a recursion.
// ---------------------------------------------------------------------------
const WHEN_RERUN_CAP = 1;
const WHEN_EVENT_BUDGET = 10000;

/** One external event: its budget of caused When runs + registrations. */
class WhenEvent {
  constructor() { this.spent = 0; this.stopped = false; this.cycleReported = false; }
  /** Spend one unit; false (and the event stopped, reported once) when exhausted. */
  spend() {
    if (this.stopped) return false;
    if (++this.spent <= WHEN_EVENT_BUDGET) return true;
    this.stopped = true;
    console.error(`scrml when-effect error: runaway — one change caused more than ${WHEN_EVENT_BUDGET} when runs / registrations; the rest of that chain is stopped.`);
    return false;
  }
}

/** A provenance link: a run of `when`, caused by `parent` (null = an external write), in `event`. */
class Cause {
  constructor(when, parent, event) {
    this.when = when;
    this.parent = parent;
    this.event = event;
  }
}

/** How many times `w` ran in the ancestry ending at `cause`. */
function timesIn(cause, w) {
  let n = 0;
  for (let c = cause; c !== null; c = c.parent) if (c.when === w) n++;
  return n;
}

// The cause the executing When body / continuation runs under; null outside them.
let currentCause = null;

function underCause(cause, fn) {
  const saved = currentCause;
  currentCause = cause;
  try { return fn(); } finally { currentCause = saved; }
}

class Task {
  constructor(owner, cause) {
    this.owner = owner;
    this.cause = cause;
    this.cancelled = false;
    this.pending = 0;
  }
  cancel() { this.cancelled = true; }
}

class When {
  constructor(scope, deps, body) {
    this.deps = deps;
    this.body = body;
    this.disposed = false;
    this.tasks = new Set();
    this.running = false;
    this.pending = false;
    // The cause of the trigger that queued this When (null: an external write),
    // and of a re-trigger while it runs.
    this.cause = null;
    this.pendingCause = null;
    for (const d of deps) d.observers.add(this);
    stats.whens++;
    scope.ownWhen(() => this.unregister());
    // A registration some When caused (a row its write created) spends that event's budget.
    if (currentCause !== null) currentCause.event.spend();
  }
  /** Of two triggers' causes, the less cyclic one for this When (external wins). */
  leastCyclic(a, b) {
    return timesIn(b, this) < timesIn(a, this) ? b : a;
  }
  markStale() {
    if (this.disposed) return;
    const cause = currentCause;
    if (this.running) {
      this.pendingCause = this.pending ? this.leastCyclic(this.pendingCause, cause) : cause;
      this.pending = true;
      return;
    }
    this.cause = whenQueue.has(this) ? this.leastCyclic(this.cause, cause) : cause;
    whenQueue.add(this);
    if (batchDepth === 0) flush();
  }
  /** May a trigger with `cause` run? (cycle cap, then the event budget) */
  admit(cause) {
    if (cause === null) return true;
    if (cause.event.stopped) return false;
    if (timesIn(cause, this) > WHEN_RERUN_CAP) {
      // reported once per external event (a runaway can drop thousands)
      if (!cause.event.cycleReported) {
        cause.event.cycleReported = true;
        console.error("scrml when-effect error: E-LIFECYCLE-006 — re-triggered during its re-run; dropped.");
      }
      return false;
    }
    return cause.event.spend();
  }
  run() {
    let cause = this.cause;
    this.cause = null;
    this.running = true;
    try {
      for (;;) {
        this.pending = false;
        if (!this.admit(cause)) break;
        const event = cause === null ? (flushEvent ??= new WhenEvent()) : cause.event;
        this.runOnce(new Cause(this, cause, event));
        if (!this.pending || this.disposed) break;
        cause = this.pendingCause;
      }
    } finally {
      this.running = false;
      this.pending = false;
      this.pendingCause = null;
    }
  }
  runOnce(link) {
    // The newest run wins: an earlier run still suspended never resumes.
    for (const t of this.tasks) t.cancel();
    this.tasks.clear();
    const task = new Task(this, link);
    this.tasks.add(task);
    try {
      underCause(link, () => untrack(() => batch(() => this.body(task))));
    } finally {
      this.settled(task);
    }
  }
  /** A task with no suspension pending is finished. */
  settled(task) {
    if (task.pending === 0) this.tasks.delete(task);
  }
  unregister() {
    if (this.disposed) return;
    this.disposed = true;
    whenQueue.delete(this);
    for (const d of this.deps) d.observers.delete(this);
    for (const t of this.tasks) t.cancel();
    this.tasks.clear();
    stats.whens--;
  }
}

/**
 * Register `when <deps> changes { body }` in `scope` (§6.7.4). `deps` are the
 * dep CELLS; `body(task)` is the effect. Unregistered when `scope` is disposed.
 */
export function when(scope, deps, body) {
  requireScope(scope, "a when effect");
  for (const d of deps) {
    if (!(d instanceof Cell)) throw new Error("a when dep must be a mutable cell (§6.7.4, E-LIFECYCLE-007)");
  }
  new When(scope, deps, body);
}

/**
 * Suspend `task` on `value` (Core Stmt.Suspend — the CPS split, §19.9.8): when
 * it settles, run the continuation `k(v)` in one batch — unless the task was
 * cancelled meanwhile (or its event was stopped by the runaway backstop), in
 * which case nothing runs and nothing is written. A rejection reaching a live
 * task is re-raised (never swallowed); the §19 error context of a `when` body
 * arrives with server calls (U1).
 */
export function suspend(task, value, k) {
  task.pending++;
  Promise.resolve(value).then(
    (v) => {
      task.pending--;
      if (task.cancelled || task.cause.event.stopped) return;
      try {
        // The continuation runs under its run's cause: what it re-triggers has
        // that run in its ancestry (a self re-trigger is cyclic).
        underCause(task.cause, () => untrack(() => batch(() => k(v))));
      } finally {
        task.owner.settled(task);
      }
    },
    (e) => {
      task.pending--;
      if (task.cancelled) return;
      task.owner.settled(task);
      throw e;
    },
  );
}

/** A writable cell holding `v`. */
export function cell(v) { return new Cell(v); }

/**
 * A `let` / seeded field: evaluated ONCE, untracked, then independent (§66.9).
 * Outside construction it is evaluated immediately. During construction it is
 * OWED: evaluated on first demand or when the outermost construction ends —
 * so a seed may read any record of the construction tree, whatever the order
 * the factories allocated them in (L12 (b)).
 */
export function seeded(init) {
  if (constructing === 0) return new Cell(untrack(init));
  const c = new Cell(undefined);
  c.pending = init;
  owed.push(c);
  return c;
}

/** A locked field: recomputes from its initializer (derived when it reads cells, §66.9). */
export function derived(scope, init) { return new Derived(scope, init); }

// ---------------------------------------------------------------------------
// Declarations and instances (§5.1, §5.2).
// ---------------------------------------------------------------------------
let nextDeclId = 0;
const registry = new Map();
export const devtools = {
  instances: registry,
  /** The devtools/SSR key `d<decl>.i<id>.f<field>` — never used for access. */
  key: (inst, field) => `d${inst.decl.id}.i${inst.id}.f${field}`,
};

/** A declaration descriptor: its name and field names (for snapshots and devtools). */
export function declare(name, fields) {
  return { id: nextDeclId++, name, fields: Object.freeze(fields), nextId: 1, shared: null };
}

/** An instance record (§5.1): an identity holding one signal per field. */
export class Instance {
  constructor(id, decl, scope) {
    this.id = id;
    this.decl = decl;
    this.fields = [];
    this.handles = [];
    // The instances its `renders` mounts UNCONDITIONALLY, created with this
    // record (L12 (b)) — in document order; render_<decl> mounts them.
    this.kids = [];
    // The construction initializer of a field a `reset` re-runs (D15): the
    // use-site value's thunk, else the declared default's.
    this.inits = [];
    this.scope = scope;
  }
}

/**
 * Run a factory body (L12 (b)): records are allocated and their fields,
 * handles and unconditional child instances created before any initializer is
 * evaluated; the seeds owed by the whole construction tree are settled when
 * the OUTERMOST construction ends, before any render, handler or user call.
 */
export function construct(inst, body) {
  constructing++;
  try { body(); } finally { constructing--; }
  if (constructing === 0) {
    const due = owed;
    owed = [];
    for (const c of due) if (c.pending !== null) c.settle();
  }
  return inst;
}

/** Allocate an instance record owned by `parentScope`. The factory seeds its fields. */
export function instance(decl, parentScope, id) {
  requireScope(parentScope, "an instance");
  const scope = parentScope.child();
  const inst = new Instance(id ?? decl.nextId++, decl, scope);
  const k = `d${decl.id}.i${inst.id}`;
  registry.set(k, inst);
  stats.instances++;
  scope.own(() => { registry.delete(k); stats.instances--; });
  return inst;
}

/**
 * The declaration's shared instance: id 0, created on first reference
 * (§66.6.4). It is registered BEFORE its factory runs, so a function the
 * construction calls (a seed's initializer) reaches this record, not a second one.
 */
export function shared(decl, factory) {
  if (decl.shared === null) {
    const inst = instance(decl, root, 0);
    decl.shared = inst;
    factory(inst);
  }
  return decl.shared;
}

/** `@x` of a declaration: a struct snapshot of its fields — a new value (§66.7.1, §66.10). */
export function snapshot(inst) {
  const out = {};
  inst.decl.fields.forEach((name, i) => { out[name] = inst.fields[i].get(); });
  return out;
}

/** Field `i`'s construction initializer, evaluated again, untracked (a `reset`, L4 / D15). */
export function initial(inst, i) { return untrack(inst.inits[i]); }

/** An `as=` handle cell: holds an Instance identity or `not` (null), never a value. */
export function handle() { return new Cell(null); }

/** Point an `as=` handle at `inst` while it lives; clear it to `not` (null) on dispose (§5.2 (5)). */
export function bindHandle(handle, inst) {
  handle.set(inst);
  inst.scope.own(() => { if (handle.peek() === inst) handle.set(null); });
}

/** An attribute declared with no default, reached with no use-site value (⚑ O33 — not ruled). */
export function noDefault(what) {
  throw new Error(`${what} has no default and no use-site value (SPEC §66.3 O33 is OPEN)`);
}

// ---------------------------------------------------------------------------
// Writes (§6.2). Every write is one signal set of a NEW value.
// ---------------------------------------------------------------------------

/** A `rule=` graph edge table, shared by every instance of the declaration (§5.4). */
export function edges(table) { return table; }

/**
 * The runtime edge check alone (§6.3): throws unless `to` is reachable from the
 * current state in one edge. A self-write passes (§51.0.F.1). Writes nothing —
 * an all-or-nothing spread edit (RULED S440) checks every edge before any write.
 */
export function checkEdge(target, table, to) {
  const from = target.peek();
  if (from === to) return;
  const allowed = table[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`E-ENGINE-INVALID-TRANSITION: .${from} → .${to} is not an edge of this field's rule= graph`);
  }
}

/** A graph write with a runtime edge check (§6.3). A self-write is a no-op (§51.0.F.1). */
export function transition(target, table, to) {
  checkEdge(target, table, to);
  target.set(to);
}

/** An end-append edit: a new array one longer (O(n) copy — dpa-051 §6.1). */
export function append(target, element) { target.set([...target.peek(), element]); }
/** A front-prepend edit. */
export function prepend(target, element) { target.set([element, ...target.peek()]); }
/** A removal of `n` elements at the end (`pop()`, n = 1): a new, shorter array. An empty sequence stays empty. */
export function removeEnd(target, n) { const xs = target.peek(); target.set(xs.slice(0, Math.max(0, xs.length - n))); }
/** A removal of `n` elements at the front (`shift()`, n = 1). */
export function removeFront(target, n) { target.set(target.peek().slice(n)); }
/**
 * A write of struct path `path` inside the element at position `index`
 * (`@xs[i].f = v`, dpa-052 Q3). A position outside the sequence is refused —
 * nothing is written (a write never grows or pads a sequence).
 */
export function setAt(target, index, path, v) {
  const xs = target.peek();
  if (!Number.isInteger(index)) {
    throw new Error(`index ${JSON.stringify(index)} is not a sequence position (an int) — nothing was written`);
  }
  if (index < 0 || index >= xs.length) {
    const has = xs.length === 0 ? "the sequence is empty" : `its positions are 0..${xs.length - 1}`;
    throw new Error(`position ${index} is outside the sequence (${has}) — nothing was written`);
  }
  setIn(target, [index, ...path], v);
}
/**
 * A write at `path` (struct property names / sequence indices): a new value
 * along the path, sharing every untouched branch with the old one.
 */
export function setIn(target, path, v) {
  const go = (obj, i) => {
    if (i === path.length) return v;
    const k = path[i];
    const copy = Array.isArray(obj) ? obj.slice() : { ...obj };
    copy[k] = go(obj[k], i + 1);
    return copy;
  };
  target.set(go(target.peek(), 0));
}

/** Structural equality (§45) for `==` on structs and sequences. */
export function eq(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => eq(a[k], b[k]));
}

// ---------------------------------------------------------------------------
// DOM. Views are cloned from <template> elements the printer writes into the
// page; holes are addressed by child-index path, looked up before any wiring.
// ---------------------------------------------------------------------------

/** A fresh clone of template `id`'s content. */
export function template(id) {
  const t = document.getElementById(id);
  if (!t) throw new Error(`missing <template id="${id}">`);
  return t.content.cloneNode(true);
}

/** The node at a child-index path under `node`. */
export function at(node, ...path) {
  let n = node;
  for (const i of path) n = n.childNodes[i];
  return n;
}

/** Insert a fragment before `anchor`; its nodes are removed when `scope` is disposed. */
export function insert(scope, frag, anchor) {
  const nodes = [...frag.childNodes];
  anchor.parentNode.insertBefore(frag, anchor);
  scope.own(() => { for (const n of nodes) if (n.parentNode) n.parentNode.removeChild(n); });
}

/** A comment anchor appended to `parent` — the mount point of the program's view. */
export function mount(parent) {
  const a = document.createComment("scrml");
  parent.appendChild(a);
  return a;
}

function display(v) { return v === null || v === undefined ? "" : String(v); }

/** A text hole: replaces the marker comment with a text node kept equal to `fn()`. */
export function text(scope, marker, fn) {
  const t = document.createTextNode("");
  marker.parentNode.replaceChild(t, marker);
  effect(scope, () => { t.data = display(fn()); });
}

/** A bound attribute. */
export function attr(scope, el, name, fn) {
  effect(scope, () => {
    const v = fn();
    if (v === null || v === undefined || v === false) el.removeAttribute(name);
    else el.setAttribute(name, v === true ? "" : String(v));
  });
}

/** An event listener owned by `scope`; the handler runs as one batch. */
export function on(scope, el, event, handler) {
  requireScope(scope, "a listener");
  const h = (e) => batch(() => handler(e));
  el.addEventListener(event, h);
  stats.listeners++;
  scope.own(() => { el.removeEventListener(event, h); stats.listeners--; });
}

/**
 * A two-way bind (§5.4): the element's `prop` (`value` / `checked`) shows
 * `read()` and follows it; the element's input (`value`) / change (`checked`)
 * event hands the property's value to `write` — the compiled, contract-checked
 * write of that value to the same place. A write that lands the value the
 * element already shows changes nothing (no caret jump).
 */
export function bind(scope, el, prop, read, write) {
  requireScope(scope, "a bind");
  effect(scope, () => {
    const v = read();
    const shown = prop === "checked" ? v === true : display(v);
    if (el[prop] !== shown) el[prop] = shown;
  });
  on(scope, el, prop === "checked" ? "change" : "input", () => write(el[prop]));
}

/**
 * A conditional view (§5.6 scope tree: conditional arm). Only the arm TESTS are
 * tracked by this effect; each arm renders untracked into its OWN child scope,
 * so reads inside an arm have their own effects and are never dropped when the
 * chosen arm is unchanged (the dpa-053 M4/M5 root cause, dpa-051 §3.6).
 */
export function cond(scope, anchor, arms) {
  let current = -1;
  let armScope = null;
  effect(scope, () => {
    let idx = -1;
    for (let i = 0; i < arms.length; i++) if (arms[i].test()) { idx = i; break; }
    if (idx === current) return;
    untrack(() => {
      if (armScope) armScope.dispose();
      armScope = null;
      current = idx;
      if (idx >= 0) {
        armScope = scope.child();
        arms[idx].render(armScope, anchor);
      }
    });
  });
}

/** Place use-site slot content (§66.15.2), if any. */
export function slot(scope, anchor, fill) {
  if (fill) fill(scope, anchor);
}

// Longest increasing subsequence of `arr` (ignoring -1), as indices into arr.
// Reused from impl#1 runtime-template.js `_scrml_lis` (a scope-clean leaf).
function lis(arr) {
  const len = arr.length;
  if (len === 0) return [];
  const tails = [];
  const pred = new Array(len);
  for (let i = 0; i < len; i++) {
    if (arr[i] === -1) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < arr[i]) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) pred[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const result = new Array(tails.length);
  let k = tails[tails.length - 1];
  for (let i = result.length - 1; i >= 0; i--) { result[i] = k; k = pred[k]; }
  return result;
}

/** A cleanup removing the DOM range `start`..`end` (a row's markers and content). */
function removeRange(start, end) {
  return () => {
    let x = start;
    while (x) {
      const nx = x === end ? null : x.nextSibling;
      if (x.parentNode) x.parentNode.removeChild(x);
      x = nx;
    }
  };
}

function moveRange(row, before) {
  const parent = before.parentNode;
  let n = row.start;
  for (;;) {
    const next = n.nextSibling;
    parent.insertBefore(n, before);
    if (n === row.end) break;
    n = next;
  }
}

/**
 * A keyed list (§17.7, §66.7.3). Each row OWNS a scope and a cell holding its
 * item; `render(rowScope, itemCell, rowAnchor)` renders the row. Rows are
 * matched by `key(item, index)`; a surviving row keeps its scope (and the
 * instances in it) and is MOVED; a removed row's scope is disposed, which
 * disposes its instances' effects, listeners and timers.
 */
export function each(scope, anchor, src, key, render) {
  let rows = [];
  effect(scope, () => {
    const items = src();
    untrack(() => { rows = reconcile(scope, anchor, rows, items, key, render); });
  });
}

function reconcile(scope, anchor, oldRows, items, key, render) {
  const byKey = new Map(oldRows.map((r, i) => [r.key, { row: r, index: i }]));
  const next = [];
  const seen = new Set();
  items.forEach((item, i) => {
    const k = key ? key(item, i) : i;
    if (seen.has(k)) throw new Error(`<each>: duplicate key ${String(k)}`);
    seen.add(k);
    const old = byKey.get(k);
    if (old) {
      old.row.item.set(item);
      next.push({ row: old.row, oldIndex: old.index });
    } else {
      next.push({ row: null, item, key: k, oldIndex: -1 });
    }
  });
  // Dispose rows that left the collection.
  for (const r of oldRows) if (!seen.has(r.key)) r.scope.dispose();
  // Rows on the longest increasing run of old positions stay put; others move.
  const stay = new Set(lis(next.map((n) => n.oldIndex)));
  const out = new Array(next.length);
  let before = anchor;
  for (let i = next.length - 1; i >= 0; i--) {
    const n = next[i];
    let row = n.row;
    if (!row) {
      const rowScope = scope.child();
      const start = document.createComment("row");
      const end = document.createComment("/row");
      before.parentNode.insertBefore(start, before);
      before.parentNode.insertBefore(end, before);
      row = { key: n.key, scope: rowScope, item: new Cell(n.item), start, end };
      // The cleanup is built OUTSIDE this function: a closure here would capture
      // reconcile's whole environment (`byKey`, `next`, `items` — O(rows)) for
      // the row's lifetime, so N rows added one at a time retained O(N²) objects.
      rowScope.own(removeRange(start, end));
      render(rowScope, row.item, end);
    } else if (!stay.has(i)) {
      moveRange(row, before);
    }
    out[i] = row;
    before = row.start;
  }
  return out;
}
