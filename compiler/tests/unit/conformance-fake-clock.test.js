/**
 * conformance-fake-clock.test.js — unit coverage for the conformance suite's
 * deterministic VIRTUAL CLOCK (conformance/fake-clock.ts, S235 Track-B Phase 1).
 *
 * The clock backs the ratified {"advance-time": ms} driver verb: ms>0 timers
 * (<onTimeout> §51.0.M, <onIdle> §51.0.R, debounce/throttle §6.13, intervals
 * §6.7) fire EXCLUSIVELY on advance(), never on a wall clock, while a
 * setTimeout(0) still passes through to the real timer (the delay===0 rule that
 * keeps the conformance shim's settled() macrotask hop working).
 *
 * Every test installs on globalThis and the afterEach restore() (which always
 * runs, even on a thrown assertion) guarantees no timer/Date.now pollution
 * leaks into sibling test files sharing the bun:test process.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { FakeClock } from "../../../conformance/fake-clock.ts";

let active = null;
afterEach(() => {
  if (active) {
    active.restore();
    active = null;
  }
});
function installed() {
  active = new FakeClock();
  active.install();
  return active;
}

describe("fake-clock — the delay===0 pass-through rule (settled() safety)", () => {
  test("setTimeout(fn, 0) passes through to the real timer (fires without advance)", async () => {
    const clock = installed();
    let fired = false;
    globalThis.setTimeout(() => {
      fired = true;
    }, 0);
    await new Promise((res) => globalThis.setTimeout(res, 0));
    expect(fired).toBe(true);
  });

  test("a falsy/negative delay also passes through (task-queue ordering)", async () => {
    const clock = installed();
    let a = false;
    let b = false;
    globalThis.setTimeout(() => {
      a = true;
    });
    globalThis.setTimeout(() => {
      b = true;
    }, -5);
    await new Promise((res) => globalThis.setTimeout(res, 0));
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});

describe("fake-clock — ms>0 timers are virtual (fire only on advance)", () => {
  test("a ms>0 timeout does not fire on a macrotask hop; fires on advance()", async () => {
    const clock = installed();
    let fired = false;
    globalThis.setTimeout(() => {
      fired = true;
    }, 1000);
    await new Promise((res) => globalThis.setTimeout(res, 0));
    expect(fired).toBe(false);
    await clock.advance(1000);
    expect(fired).toBe(true);
  });

  test("timers fire in fireAt order regardless of arm order", async () => {
    const clock = installed();
    const order = [];
    globalThis.setTimeout(() => order.push("late"), 200);
    globalThis.setTimeout(() => order.push("early"), 50);
    await clock.advance(300);
    expect(order).toEqual(["early", "late"]);
  });

  test("a partial advance below the deadline does not fire the timer", async () => {
    const clock = installed();
    let fired = false;
    globalThis.setTimeout(() => {
      fired = true;
    }, 1000);
    await clock.advance(999);
    expect(fired).toBe(false);
    await clock.advance(1);
    expect(fired).toBe(true);
  });
});

describe("fake-clock — clearTimeout / clearInterval on virtual handles", () => {
  test("clearTimeout on a virtual handle cancels the pending timer", async () => {
    const clock = installed();
    let fired = false;
    const h = globalThis.setTimeout(() => {
      fired = true;
    }, 500);
    globalThis.clearTimeout(h);
    await clock.advance(1000);
    expect(fired).toBe(false);
  });

  test("clearInterval stops a virtual interval from re-arming", async () => {
    const clock = installed();
    let ticks = 0;
    const h = globalThis.setInterval(() => {
      ticks++;
    }, 100);
    await clock.advance(100);
    expect(ticks).toBe(1);
    globalThis.clearInterval(h);
    await clock.advance(1000);
    expect(ticks).toBe(1);
  });
});

describe("fake-clock — intervals re-arm across multiple advance() calls", () => {
  test("an interval fires once per period, re-arming across separate advances", async () => {
    const clock = installed();
    let ticks = 0;
    globalThis.setInterval(() => {
      ticks++;
    }, 100);
    await clock.advance(100);
    expect(ticks).toBe(1);
    await clock.advance(100);
    expect(ticks).toBe(2);
    await clock.advance(250); // fires at +100 and +200 within this window
    expect(ticks).toBe(4);
  });
});

describe("fake-clock — Date.now() is deterministic", () => {
  test("Date.now() starts at a fixed epoch and advances exactly with advance()", async () => {
    const clock = installed();
    const t0 = globalThis.Date.now();
    await clock.advance(1234);
    expect(globalThis.Date.now() - t0).toBe(1234);
  });

  test("Date.now() is stable between advances (no wall-clock drift)", async () => {
    const clock = installed();
    const a = globalThis.Date.now();
    const b = globalThis.Date.now();
    expect(a).toBe(b);
  });
});

describe("fake-clock — restore()", () => {
  test("restore() puts the real timer + Date.now globals back", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realDateNow = globalThis.Date.now;
    const clock = new FakeClock();
    clock.install();
    expect(globalThis.setTimeout).not.toBe(realSetTimeout);
    clock.restore();
    active = null;
    expect(globalThis.setTimeout).toBe(realSetTimeout);
    expect(globalThis.Date.now).toBe(realDateNow);
  });

  test("restore() in a finally recovers the globals even when the body throws", () => {
    const realSetTimeout = globalThis.setTimeout;
    const realDateNow = globalThis.Date.now;
    const clock = new FakeClock();
    clock.install();
    let threw = false;
    try {
      throw new Error("simulated eval throw");
    } catch (e) {
      threw = true;
    } finally {
      clock.restore();
      active = null;
    }
    expect(threw).toBe(true);
    expect(globalThis.setTimeout).toBe(realSetTimeout);
    expect(globalThis.Date.now).toBe(realDateNow);
  });
});
