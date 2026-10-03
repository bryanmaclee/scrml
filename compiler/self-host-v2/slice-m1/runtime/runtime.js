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
export const stats = { effects: 0, deriveds: 0, listeners: 0, instances: 0, depEffects: 0 };

// ---------------------------------------------------------------------------
// Scopes.
//
// Teardown order (SPEC §6.7.2): depth-first — every child scope is torn down
// before its parent begins; then, for the scope itself, step 1 unregisters its
// `<effect>`s, and the remaining cleanups (listeners, render effects, DOM,
// records) run last-in-first-out. (Steps 2–4 — <timer>/<poll>, cleanup(),
// animationFrame — have no bootstrap form yet; they join the LIFO list after
// step 1 when they land.)
// ---------------------------------------------------------------------------
export class Scope {
  constructor(parent) {
    this.parent = parent;
    this.children = new Set();
    this.depEffects = [];
    this.cleanups = [];
    this.disposed = false;
    if (parent) parent.children.add(this);
  }
  /** Register a cleanup to run when this scope is disposed. */
  own(cleanup) {
    if (this.disposed) { cleanup(); return; }
    this.cleanups.push(cleanup);
  }
  /** Register an `<effect>`'s unregistration — teardown step 1 (§6.7.2). */
  ownEffect(unregister) {
    if (this.disposed) { unregister(); return; }
    this.depEffects.push(unregister);
  }
  child() { return new Scope(this); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    batch(() => {
      for (const c of [...this.children].reverse()) c.dispose();
      for (const unregister of this.depEffects) unregister();
      for (let i = this.cleanups.length - 1; i >= 0; i--) this.cleanups[i]();
    });
    this.children.clear();
    this.depEffects = [];
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
// `<effect>` bodies (§6.7.4) wait until the render / structure effects of the
// same flush have settled: an `if=` region or `<each>` row the same batch
// unmounts unregisters its effects (teardown step 1) BEFORE they could run.
const effectQueue = new Set();

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

// Render / structure effects first, then `<effect>` bodies. An effect body
// cannot write a reactive cell (§6.7.4 — a compile error, directly or through
// a called function), so running one queues nothing: there is no cascade to
// order or bound, and this is a plain loop.
//
// One flush at a time (s449 fix round, MEDIUM-1): a render effect that writes
// while it runs — `<each>`'s reconcile sets a surviving row's item cell before
// it disposes the removed rows — used to start a NESTED flush from that write's
// batch, which drained the effect queue mid-run, so an `<effect>` in a row the
// same batch was removing still ran. A flush started while one is running now
// returns at once; the running loop picks up everything queued.
let flushing = false;

function flush() {
  if (flushing) return;
  flushing = true;
  try { drainQueues(); } finally { flushing = false; }
}

function drainQueues() {
  for (;;) {
    if (queue.size > 0) {
      const [e] = queue;
      queue.delete(e);
      if (!e.disposed) e.run();
    } else if (effectQueue.size > 0) {
      const [d] = effectQueue;
      effectQueue.delete(d);
      if (!d.disposed) d.run();
    } else {
      return;
    }
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
    // Every observer is marked first, then the `reset-on=` resets this write
    // triggered are applied — all of them, in rank order — still inside this
    // batch, so its flush sees the trigger and the resets as one change.
    batch(() => { invalidate(this); drainResets(); });
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
// `<effect deps=[…]>${ body }</>` (SPEC §6.7.4) and the suspendable task layer.
//
// A DepEffect subscribes to EXACTLY its dependency cells (it is an observer of
// each — the set every write fans out to) and never tracks its body: reading
// an unlisted cell in the body is valid and is not a trigger. It does NOT run
// when it is registered (S447 2b: not on mount, not on remount). A change
// queues it; it runs once per flush, after the writing batch completes and its
// render / structure effects have settled — however many of its dependencies
// that batch changed. Change detection is `Cell.set`'s reference identity.
// A derived value is recomputed on read (lazy pull), so a derived value the
// body reads already reflects the change — the §6.7.4 "derived flush before
// effect bodies" rule holds by construction.
//
// The body may not write any reactive cell (E-EFFECT-WRITES-STATE, decided at
// compile time from a transitive write summary). Nothing here guards against a
// write: the compile-time rule is the guarantee, and a runtime bound would mean
// the rule had a hole.
//
// Each run gets a TASK — the handle a suspension (`suspend`, Core
// Stmt.Suspend, the CPS split of §19.9.8) resumes through. THE NEWEST RUN
// WINS (S446 (b), carried onto <effect> by §6.7.4): a run that starts while an
// earlier run of the same effect is suspended cancels that run's task, so its
// continuation never resumes and the value it was waiting for is discarded.
// Unregistering the effect (its scope's teardown, step 1) cancels its tasks
// the same way. Transport (§6.7.7.1): the task layer never aborts an in-flight
// call — it discards the result. Abort is permitted only for a READ call
// ("MAY"), never required, and never permitted otherwise; discarding everywhere
// is the conforming choice that needs no classification at run time.
// ---------------------------------------------------------------------------
class Task {
  constructor(owner) {
    this.owner = owner;
    this.cancelled = false;
    this.pending = 0;
  }
  cancel() { this.cancelled = true; }
}

class DepEffect {
  constructor(scope, deps, body) {
    this.deps = deps;
    this.body = body;
    this.disposed = false;
    this.tasks = new Set();
    for (const d of deps) d.observers.add(this);
    stats.depEffects++;
    scope.ownEffect(() => this.unregister());
  }
  markStale() {
    if (this.disposed) return;
    effectQueue.add(this);
    if (batchDepth === 0) flush();
  }
  run() {
    // The newest run wins: an earlier run still suspended never resumes.
    for (const t of this.tasks) t.cancel();
    this.tasks.clear();
    const task = new Task(this);
    this.tasks.add(task);
    try {
      untrack(() => this.body(task));
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
    effectQueue.delete(this);
    for (const d of this.deps) d.observers.delete(this);
    for (const t of this.tasks) t.cancel();
    this.tasks.clear();
    stats.depEffects--;
  }
}

/**
 * Register `<effect deps=[…]>${ body }</>` in `scope` (§6.7.4). `deps` are the
 * dependency CELLS; `body(task)` is the effect. It never runs at registration;
 * it is unregistered when `scope` is disposed (teardown step 1).
 */
export function effectOn(scope, deps, body) {
  requireScope(scope, "an <effect>");
  if (deps.length === 0) throw new Error("an <effect> needs at least one dependency (§6.7.4, E-EFFECT-NO-DEPS)");
  for (const d of deps) {
    if (!(d instanceof Cell)) throw new Error("an <effect> dependency must be a mutable cell (§6.7.4, E-LIFECYCLE-007)");
  }
  new DepEffect(scope, deps, body);
}

/**
 * Suspend `task` on `value` (Core Stmt.Suspend — the CPS split, §19.9.8):
 * when it settles, run the continuation `k(v)` untracked — unless the task was
 * cancelled meanwhile (a newer run started, or the effect was unregistered),
 * in which case nothing runs. A rejection reaching a live task is re-raised
 * (never swallowed); an effect body's §19 error context arrives with server
 * calls. A rejection on a cancelled task is dropped with its result.
 */
export function suspend(task, value, k) {
  task.pending++;
  Promise.resolve(value).then(
    (v) => {
      task.pending--;
      if (task.cancelled) return;
      try {
        untrack(() => k(v));
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

// ---------------------------------------------------------------------------
// `reset-on=[@a, @b]` on a cell (SPEC §6.8.4).
//
// A ResetOn observes its trigger cells. When one changes, the reset is
// applied AT ONCE — right after the write has marked every observer, inside
// the writing cell's own batch, before that batch flushes — so every render
// effect and every `<effect>` that the trigger and the reset both reach is
// queued once and runs once, after both, seeing the reset value (rule 4: "The
// triggering write and the resets it causes are ONE change for every
// dependent"). A handler that reads the reset cell after writing the trigger
// sees the reset value too.
//
// A chain (`a` resets on `b`, `b` resets on `c`) is applied in RANK order —
// the cell's depth in the static reset-on graph, computed by the compiler —
// so every reset in one drain runs after the resets it depends on, and each
// cell is reset at most once per drain. The graph is acyclic (E-RESET-ON-CYCLE,
// a compile-time error), so a drain ends by construction: there is no counter
// or bound here, and one would mean the compile-time rule had a hole.
// ---------------------------------------------------------------------------
const pendingResets = new Set();
let drainingResets = false;

class ResetOn {
  constructor(scope, triggers, reset, rank) {
    this.triggers = triggers;
    this.reset = reset;
    this.rank = rank;
    this.disposed = false;
    for (const t of triggers) t.observers.add(this);
    scope.own(() => {
      this.disposed = true;
      pendingResets.delete(this);
      for (const t of this.triggers) t.observers.delete(this);
    });
  }
  markStale() {
    if (!this.disposed) pendingResets.add(this);
  }
}

// Apply the pending resets, lowest rank first (Cell.set calls it once every
// observer of the write is marked). A reset's own write queues the resets
// downstream of it (higher ranks) into the same loop.
function drainResets() {
  if (drainingResets || pendingResets.size === 0) return;
  drainingResets = true;
  try {
    while (pendingResets.size > 0) {
      let next = null;
      for (const r of pendingResets) if (next === null || r.rank < next.rank) next = r;
      pendingResets.delete(next);
      if (!next.disposed) batch(() => untrack(next.reset));
    }
  } finally {
    drainingResets = false;
  }
}

/**
 * Register a cell's `reset-on=` rule in `scope` (§6.8.4): when a `triggers`
 * cell changes, `reset()` writes the cell's reset value, in rank order within
 * the triggering write's flush.
 */
export function resetOn(scope, triggers, reset, rank) {
  requireScope(scope, "a reset-on= rule");
  if (triggers.length === 0) throw new Error("reset-on= needs at least one cell (§6.8.4, E-RESET-ON-INVALID-ENTRY)");
  for (const t of triggers) {
    if (!(t instanceof Cell)) throw new Error("a reset-on= entry must be a mutable cell (§6.8.4, E-RESET-ON-INVALID-ENTRY)");
  }
  new ResetOn(scope, triggers, reset, rank);
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

/**
 * A declaration descriptor: its name and field names (for snapshots and
 * devtools). `opts.checks[i]` lists field i's validators (§55.1, built with
 * `check.*`); `opts.topLevel` says the fields are top-level values (the
 * program's cells), each with its own `submitted` (§55.5.1 rule 6) — a user
 * declaration's fields share their instance's (§55.7).
 */
export function declare(name, fields, opts = {}) {
  return {
    id: nextDeclId++, name, fields: Object.freeze(fields), nextId: 1, shared: null,
    checks: opts.checks ?? [], topLevel: opts.topLevel === true,
  };
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
    // The validity surface (§55), created on first use: one record per field
    // (`validity`), the compound (`compound`) and the compound's `submitted`.
    this.validity = [];
    this.compound = null;
    this.submittedCell = null;
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

/**
 * s451 — `defer` (SPEC §19.16.2): run a block's deferred bodies at its exit, called from the
 * `finally` the printer wraps the block in. Last registered runs first (LIFO). A host error in
 * one does not stop the others; after all have run, the FIRST such error is rethrown — replacing
 * an error already in flight, as a host `finally` does.
 */
export function runDefers(stack) {
  let failed = false;
  let first;
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      stack[i]();
    } catch (e) {
      if (!failed) { failed = true; first = e; }
    }
  }
  if (failed) throw first;
}

// ---------------------------------------------------------------------------
// The validity surface (SPEC §55.5–§55.8, §55.12, §55.13).
//
// A field's surface is a RECORD created on first use (a read, a bind, a
// gate): `errors` is a Derived over the field's value — recomputed when the
// value changes, never on read (§55.2 "reactive recompute") — and `touched`
// is a Cell only the runtime writes (first `bind:` change or first focus-out,
// §55.7; a gate's touch, §55.17.3 step 1; cleared by a reset, §55.13).
// `submitted` belongs to a top-level value itself (§55.5.1 rule 6) or, for a
// field of a user declaration, to its instance — the compound (§55.7). No
// program can write any of them: Core has no write capability for a surface
// (E-SYNTHESIZED-WRITE is a compile-time error), and these setters are not
// reachable from compiled code except through the gate, a bind and a reset.
//
// The validators (§55.1) a field carries arrive as `check.*` descriptors,
// in declaration order. An error is a ValidationError tag (§55.9) in the
// bootstrap's enum layout: a nullary variant is its tag string ("Required"),
// a variant with fields is `{ tag, ...fields }`.
// ---------------------------------------------------------------------------

const absent = (v) => v === null || v === undefined;

function lengthHolds(len, op, n) {
  switch (op) {
    case ">=": return len >= n;
    case ">": return len > n;
    case "<=": return len <= n;
    case "<": return len < n;
    case "==": return len === n;
    default: throw new Error(`length(${op} ${n}): unknown comparison`);
  }
}

/**
 * The validators the bootstrap evaluates (§55.1). Each `test(value)` returns
 * the ValidationError tag of a failure, or null. `req` short-circuits
 * (§55.12): when it fails, the field reports `.Required` alone. A value that
 * is absent (`not`) fails only `req`; the other predicates are about a
 * length / a number / a string the absent value does not have (agent
 * reading — §55.12 states the short-circuit only for `req` / `is some`).
 */
export const check = {
  req: () => ({ shortCircuit: true, test: (v) => (absent(v) || v === "" ? "Required" : null) }),
  length: (op, n) => ({
    test: (v) => (absent(v) || lengthHolds(v.length, op, n) ? null : { tag: "LengthFailed", predicate: `(${op}${n})` }),
  }),
  min: (n) => ({ test: (v) => (absent(v) || v >= n ? null : { tag: "MinFailed", threshold: n }) }),
  max: (n) => ({ test: (v) => (absent(v) || v <= n ? null : { tag: "MaxFailed", threshold: n }) }),
  pattern: (source) => {
    const re = new RegExp(source);
    return { test: (v) => (absent(v) || re.test(v) ? null : { tag: "PatternMismatch", re: source }) };
  },
};

/** Every failing validator's error, in declaration order; `req` short-circuits (§55.12). */
function runChecks(checks, v) {
  const out = [];
  for (const c of checks) {
    const err = c.test(v);
    if (err === null) continue;
    if (c.shortCircuit) return [err];
    out.push(err);
  }
  return out;
}

// §55.10 Level 3 — the shipped English defaults (impl#1's wording, the same
// catalogue `scrml:data` ships). Levels 1 / 2 are not in the bootstrap (a
// Level-1 message is refused at compile time).
function messageFor(err, field) {
  const tag = typeof err === "string" ? err : err.tag;
  switch (tag) {
    case "Required": return `${field} is required.`;
    case "LengthFailed": return `${field} length must satisfy ${err.predicate.slice(1, -1)}.`;
    case "PatternMismatch": return `${field} doesn't match the expected format.`;
    case "MinFailed": return `${field} must be at least ${err.threshold}.`;
    case "MaxFailed": return `${field} must be at most ${err.threshold}.`;
    default: return `${field} is invalid.`;
  }
}

/** The compound's `submitted` (§55.7): one per instance of a user declaration. */
function compoundSubmitted(inst) {
  if (inst.submittedCell === null) inst.submittedCell = new Cell(false);
  return inst.submittedCell;
}

/**
 * Field `i`'s validity record (§55.6; §55.5.1 for a top-level value).
 * `validated` — the field carries validators (only those gate a form,
 * §55.17.3); a field with none reads trivially valid (Edge B).
 */
export function validity(inst, i) {
  const have = inst.validity[i];
  if (have) return have;
  const checks = inst.decl.checks[i] ?? [];
  const value = inst.fields[i];
  const name = inst.decl.fields[i];
  const errors = checks.length === 0 ? null : new Derived(inst.scope, () => runChecks(checks, value.get()));
  const touched = new Cell(false);
  const submitted = inst.decl.topLevel ? new Cell(false) : compoundSubmitted(inst);
  const rec = {
    name,
    validated: checks.length > 0,
    errors: () => (errors === null ? [] : errors.get()),
    isValid: () => (errors === null ? true : errors.get().length === 0),
    touched: () => touched.get(),
    submitted: () => submitted.get(),
    messages: () => rec.errors().map((e) => messageFor(e, name)),
    touch() { touched.set(true); },
    submit() { submitted.set(true); },
    // §55.13: `reset(@x)` reverts `touched`; a top-level value's `submitted` too.
    reset() {
      batch(() => {
        touched.set(false);
        if (inst.decl.topLevel) submitted.set(false);
      });
    },
  };
  inst.validity[i] = rec;
  return rec;
}

/**
 * The compound surface of an instance of a user declaration (§55.5): valid
 * when every field is; `errors` / `touched` map field names to the per-field
 * values; `submitted` is the instance's own.
 */
export function compound(inst) {
  if (inst.compound !== null) return inst.compound;
  const recs = () => inst.decl.fields.map((_, i) => validity(inst, i));
  const submitted = compoundSubmitted(inst);
  inst.compound = {
    isValid: () => recs().every((r) => r.isValid()),
    errors: () => Object.fromEntries(recs().map((r) => [r.name, r.errors()])),
    touched: () => Object.fromEntries(recs().map((r) => [r.name, r.touched()])),
    submitted: () => submitted.get(),
    messages: () => recs().flatMap((r) => r.messages()),
  };
  return inst.compound;
}

/**
 * `<errors of=…/>` (§55.8): one `<p class="scrml-error">` per message — the
 * first only unless `all` — and NO DOM when there are none (not a hidden
 * element). Replaces the marker comment; re-renders when the errors change.
 */
export function errors(scope, marker, messages, all) {
  const end = document.createComment("/errors");
  marker.parentNode.insertBefore(end, marker.nextSibling);
  let shown = [];
  effect(scope, () => {
    const ms = messages();
    const want = all ? ms : ms.slice(0, 1);
    untrack(() => {
      for (const p of shown) p.remove();
      shown = want.map((m) => {
        const p = document.createElement("p");
        p.className = "scrml-error";
        p.textContent = m;
        end.parentNode.insertBefore(p, end);
        return p;
      });
    });
  });
  scope.own(() => { for (const p of shown) p.remove(); end.remove(); });
}

// The validity record a bound control writes to (set by `bind`): the gate
// finds a form's bound validated values through its live controls.
const boundSurface = new WeakMap();

/**
 * The form's surface listener (§55.7) and, when a bound value carries
 * validators, the compiler submit gate (§55.17.3). Registered BEFORE any
 * author `submit` listener of the form, so it runs first and synchronously.
 *
 * The bound values are the union of `named()` — the records of the fields the
 * form's composed subtree names statically, mounted or not (§55.17.3: the
 * values bound "inside the form (the §55.17.2 rule 1 composed subtree)") —
 * and the records of the controls rendered inside the form, which is how an
 * instance a use, an `<each>` row or a slot creates is reached.
 *
 * On each submit:
 *   1. touch — `touched` on every bound VALIDATED value;
 *   2. submitted — `submitted` on every bound value (a field's compound);
 *   3. block if invalid — cancel the submission (no native navigation / POST)
 *      and stop the event, so no author handler runs;
 *   4. otherwise the event proceeds to the author's handler.
 * A submitter carrying `formnovalidate` (§55.17.4) bypasses steps 1 and 3;
 * step 2 still runs. `SubmitEvent.submitter` is null for `requestSubmit()`
 * with no argument — that submit is gated.
 */
export function gate(scope, form, named) {
  requireScope(scope, "a submit gate");
  const h = (e) => batch(() => {
    const recs = new Set(named());
    for (const el of form.querySelectorAll("input, textarea, select")) {
      const rec = boundSurface.get(el);
      if (rec) recs.add(rec);
    }
    const bypass = e.submitter != null && e.submitter.hasAttribute("formnovalidate");
    for (const r of recs) r.submit();
    if (bypass) return;
    let valid = true;
    for (const r of recs) {
      if (!r.validated) continue;
      r.touch();
      if (!r.isValid()) valid = false;
    }
    if (!valid) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });
  form.addEventListener("submit", h);
  stats.listeners++;
  scope.own(() => { form.removeEventListener("submit", h); stats.listeners--; });
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
 *
 * `surface` (§55.7) — the validity record of the bound field, when it has
 * one: the bind's change and the element's first focus-out mark it
 * `touched`, and a gated form finds it through this element (§55.17.3).
 */
export function bind(scope, el, prop, read, write, surface) {
  requireScope(scope, "a bind");
  effect(scope, () => {
    const v = read();
    const shown = prop === "checked" ? v === true : display(v);
    if (el[prop] !== shown) el[prop] = shown;
  });
  on(scope, el, prop === "checked" ? "change" : "input", () => {
    write(el[prop]);
    if (surface) surface.touch();
  });
  if (surface) {
    boundSurface.set(el, surface);
    on(scope, el, "focusout", () => surface.touch());
    scope.own(() => { if (boundSurface.get(el) === surface) boundSurface.delete(el); });
  }
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
