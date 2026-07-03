/**
 * fake-clock.ts — the conformance suite's deterministic VIRTUAL CLOCK
 * (Track-B Phase 1, S235). Backs the `{"advance-time": ms}` driver verb — a
 * RATIFIED normative language-1.0 conformance-contract verb: an impl adopts a
 * virtual-clock model in which time-dependent surfaces (`<onTimeout>` §51.0.M,
 * `<onIdle>` §51.0.R, debounce/throttle §6.13, engine-temporal §51.12,
 * interval §6.7) advance ONLY when a case says so — never on a wall clock.
 *
 * WHAT IT OVERRIDES. `install()` captures the REAL timer globals, then swaps in
 * fakes on `globalThis`: setTimeout / clearTimeout / setInterval / clearInterval
 * / Date.now / requestIdleCallback / cancelIdleCallback. The scrml runtime's
 * timer surfaces all funnel through these globals (runtime-template.js:
 * `_scrml_machine_arm_timer`->setTimeout, debounce/throttle setTimeout+Date.now,
 * `_scrml_timer_start`->setInterval, idle-prefetch requestIdleCallback), so the
 * whole temporal surface becomes controller-driven without a single production
 * byte changing.
 *
 * THE delay===0 RULE (correctness-critical). A faked `setTimeout(fn, 0)` (and
 * any falsy / <=0 ms) is TASK-QUEUE ORDERING, not time advancement — it passes
 * STRAIGHT THROUGH to the REAL setTimeout. This is what keeps the conformance
 * shim's `settled()` macrotask hop (`setTimeout(...,0)`) working untouched, and
 * lets a 0-clamped debounce/throttle drain via `settled()` with NO advance-time.
 * ONLY ms>0 timers (and ALL intervals, which require a positive period) go
 * virtual — fired exclusively by `advance()`.
 *
 * DETERMINISM. The virtual clock starts at a FIXED epoch (not the wall clock and
 * not 0). A fixed non-zero base makes `Date.now()`-relative surfaces behave
 * realistically AND reproducibly: e.g. a throttle's leading edge fires on the
 * first write (the elapsed-since-lastEmit=0 window opens immediately) exactly as
 * it would against a real clock, rather than being mis-classified as "inside the
 * window" the way a now=0 base would.
 *
 * HANDLES. A virtual handle is a BRANDED OBJECT (`{ __scrmlFakeTimer: id }`),
 * never a bare number, so it can never be confused with a real timer handle
 * (number or Node/Bun Timeout object) at clear time — the runtime treats every
 * handle opaquely (stores it, compares only to null/undefined, never does
 * arithmetic), so an object handle is a safe drop-in.
 */

type TimerFn = (...args: unknown[]) => void;

interface VirtualTimer {
  id: number;
  /** virtual-ms timestamp at which this timer next fires */
  fireAt: number;
  /** the scheduled callback (args already bound in) */
  fn: () => void;
  /** 0 for a one-shot timeout; >0 for an interval (re-armed each fire) */
  intervalMs: number;
}

interface VirtualHandle {
  __scrmlFakeTimer: number;
}

/** A fixed, deterministic virtual base (2023-11-14T22:13:20Z in ms). */
const START_EPOCH = 1_700_000_000_000;

function isVirtualHandle(h: unknown): h is VirtualHandle {
  return (
    h !== null &&
    typeof h === "object" &&
    typeof (h as { __scrmlFakeTimer?: unknown }).__scrmlFakeTimer === "number"
  );
}

/**
 * Flush chained microtasks between virtual-timer fires, so a timer's reactive
 * propagation (`_scrml_reactive_set` is synchronous) plus any short promise
 * chain it kicked off settles deterministically before the next timer fires.
 * A handful of hops covers a multi-stage `.then` chain; the trailing
 * `settled()` (a real-macrotask hop) does the exhaustive drain after advance().
 */
function microtaskDrain(): Promise<void> {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => undefined);
}

export class FakeClock {
  private now = START_EPOCH;
  private nextId = 1;
  private readonly virtual = new Map<number, VirtualTimer>();
  private installed = false;

  // Captured real globals (bound at install()).
  private realSetTimeout!: (fn: TimerFn, ms?: number, ...args: unknown[]) => unknown;
  private realClearTimeout!: (id: unknown) => void;
  private realSetInterval!: (fn: TimerFn, ms?: number, ...args: unknown[]) => unknown;
  private realClearInterval!: (id: unknown) => void;
  private realDateNow!: () => number;
  private realRequestIdleCallback: unknown;
  private realCancelIdleCallback: unknown;

  /** Current virtual time (ms). Exposed for assertions / debugging. */
  virtualNow(): number {
    return this.now;
  }

  /** Number of pending virtual timers (one-shot + interval). */
  pendingCount(): number {
    return this.virtual.size;
  }

  install(): void {
    if (this.installed) return;
    const g = globalThis as Record<string, unknown> & { Date: DateConstructor };

    // FIRST capture the reals (for internal use + the delay===0 pass-through).
    this.realSetTimeout = g.setTimeout as typeof this.realSetTimeout;
    this.realClearTimeout = g.clearTimeout as typeof this.realClearTimeout;
    this.realSetInterval = g.setInterval as typeof this.realSetInterval;
    this.realClearInterval = g.clearInterval as typeof this.realClearInterval;
    this.realDateNow = g.Date.now;
    this.realRequestIdleCallback = g.requestIdleCallback;
    this.realCancelIdleCallback = g.cancelIdleCallback;

    g.setTimeout = (fn: TimerFn, ms?: number, ...args: unknown[]): unknown =>
      this.fakeSetTimeout(fn, ms, args);
    g.clearTimeout = (id: unknown): void => this.fakeClearTimeout(id);
    g.setInterval = (fn: TimerFn, ms?: number, ...args: unknown[]): unknown =>
      this.fakeSetInterval(fn, ms, args);
    g.clearInterval = (id: unknown): void => this.fakeClearInterval(id);
    g.Date.now = (): number => this.now;
    // requestIdleCallback: model as an immediate task-queue hop (delay===0
    // pass-through) — an idle callback fires promptly in a quiescent test and
    // so drains via settled() WITHOUT advance-time. The runtime ignores the
    // IdleDeadline arg, but we supply a minimal one for shape-fidelity.
    g.requestIdleCallback = (cb: (deadline?: unknown) => void): unknown =>
      this.fakeSetTimeout(
        () => cb({ didTimeout: false, timeRemaining: () => 0 }),
        0,
        [],
      );
    g.cancelIdleCallback = (id: unknown): void => this.fakeClearTimeout(id);

    this.installed = true;
  }

  private fakeSetTimeout(fn: TimerFn, ms: number | undefined, args: unknown[]): unknown {
    const delay = typeof ms === "number" ? ms : 0;
    // THE delay===0 RULE: task-queue ordering, not time advancement.
    if (!(delay > 0)) {
      return this.realSetTimeout(() => fn(...args), 0);
    }
    const id = this.nextId++;
    this.virtual.set(id, {
      id,
      fireAt: this.now + delay,
      fn: () => fn(...args),
      intervalMs: 0,
    });
    return { __scrmlFakeTimer: id } as VirtualHandle;
  }

  private fakeSetInterval(fn: TimerFn, ms: number | undefined, args: unknown[]): unknown {
    // ALL intervals are virtual (a real interval requires a positive period;
    // a non-positive one is clamped to 1 to guarantee advance() terminates).
    const period = typeof ms === "number" && ms > 0 ? ms : 1;
    const id = this.nextId++;
    this.virtual.set(id, {
      id,
      fireAt: this.now + period,
      fn: () => fn(...args),
      intervalMs: period,
    });
    return { __scrmlFakeTimer: id } as VirtualHandle;
  }

  private fakeClearTimeout(id: unknown): void {
    if (isVirtualHandle(id)) {
      this.virtual.delete(id.__scrmlFakeTimer);
      return;
    }
    this.realClearTimeout(id);
  }

  private fakeClearInterval(id: unknown): void {
    if (isVirtualHandle(id)) {
      this.virtual.delete(id.__scrmlFakeTimer);
      return;
    }
    this.realClearInterval(id);
  }

  /**
   * Advance virtual time by `ms`. Fires every virtual timer whose fireAt lands
   * in `(now, now+ms]`, in fireAt order (ties broken by arm order / id), setting
   * `now` to each timer's fire time as it fires, re-arming intervals, and
   * awaiting a microtask drain after each fire. Finally pins `now` to now+ms.
   * A fired timer may schedule further virtual timers (chained temporal rules)
   * or clear pending ones — both are honored on the next loop iteration.
   */
  async advance(ms: number): Promise<void> {
    const delta = typeof ms === "number" && ms > 0 ? ms : 0;
    const target = this.now + delta;
    let guard = 0;
    for (;;) {
      if (guard++ > 1_000_000) {
        throw new Error("fake-clock: advance() exceeded 1e6 fires (runaway interval?)");
      }
      // Earliest virtual timer with fireAt <= target.
      let next: VirtualTimer | undefined;
      for (const t of this.virtual.values()) {
        if (t.fireAt > target) continue;
        if (
          next === undefined ||
          t.fireAt < next.fireAt ||
          (t.fireAt === next.fireAt && t.id < next.id)
        ) {
          next = t;
        }
      }
      if (next === undefined) break;
      this.now = next.fireAt;
      if (next.intervalMs > 0) {
        // Re-arm in place: next fire is intervalMs after THIS scheduled fire.
        next.fireAt = next.fireAt + next.intervalMs;
      } else {
        this.virtual.delete(next.id);
      }
      next.fn();
      await microtaskDrain();
    }
    this.now = target;
  }

  /** Restore every overridden global to its captured original. Idempotent. */
  restore(): void {
    if (!this.installed) return;
    const g = globalThis as Record<string, unknown> & { Date: DateConstructor };
    g.setTimeout = this.realSetTimeout;
    g.clearTimeout = this.realClearTimeout;
    g.setInterval = this.realSetInterval;
    g.clearInterval = this.realClearInterval;
    g.Date.now = this.realDateNow;
    g.requestIdleCallback = this.realRequestIdleCallback;
    g.cancelIdleCallback = this.realCancelIdleCallback;
    this.virtual.clear();
    this.installed = false;
  }
}
