/**
 * meta-timers-s458.test.js — the §22.5.1 runtime timer primitives.
 *
 * change-id: s458-meta-allow-list-land. §22.5.1 makes `meta.interval` /
 * `meta.timeout` / `meta.clearInterval` / `meta.clearTimeout` part of the runtime
 * `meta` object ("The runtime SHALL construct a `meta` object ... SHALL expose
 * the following properties and methods") and REPLACES JS-host timers inside
 * `^{}` (a `setInterval` there is E-META-001). Before S458 the runtime `meta`
 * object had none of the four: a `^{}` written to the SPEC compiled clean and
 * threw `meta.interval is not a function` at run time.
 *
 * The host timer functions are injected as fakes so every assertion is
 * deterministic (no wall-clock waits).
 *
 * Coverage:
 *   §1 the four members are present on every meta object
 *   §2 meta.interval runs its callback on each host tick; meta.clearInterval stops it
 *   §3 meta.timeout fires once; clearing after it fired is a no-op
 *   §4 scope destroy clears live timers in LIFO order BEFORE meta.cleanup callbacks run
 *   §5 a re-run clears the previous run's timers before its cleanups; the new run registers fresh ids
 *   §6 the ids are opaque per-scope — a host handle / another kind's id / another scope's id cancels nothing
 *   §7 a non-function callback is refused (a host timer would evaluate a string as code)
 *   §8 the migrated corpus file samples/.../meta-cleanup-001.scrml compiles clean and its body runs
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { compileScrml } from "../../src/api.js";

function makeRuntime() {
  const host = { next: 1000, live: new Map(), log: [] };
  const fakeSet = (kind) => (fn, ms) => {
    const h = host.next++;
    host.live.set(h, { kind, fn, ms });
    host.log.push(["set", kind, h, ms]);
    return h;
  };
  const fakeClear = (kind) => (h) => {
    host.log.push(["clear", kind, h]);
    host.live.delete(h);
  };
  // eslint-disable-next-line no-new-func
  const rt = new Function(
    "setInterval", "clearInterval", "setTimeout", "clearTimeout",
    `${SCRML_RUNTIME}
return { _scrml_meta_effect, _scrml_destroy_scope, _scrml_reactive_set, _scrml_reactive_get };`,
  )(fakeSet("interval"), fakeClear("interval"), fakeSet("timeout"), fakeClear("timeout"));
  // Fire a host timer as the host would: an interval stays live, a timeout is consumed.
  host.fire = (h) => {
    const t = host.live.get(h);
    if (!t) return false;
    if (t.kind === "timeout") host.live.delete(h);
    t.fn();
    return true;
  };
  return { rt, host };
}

describe("§22.5.1 timers §1: present on the meta object", () => {
  test("interval / timeout / clearInterval / clearTimeout are functions", () => {
    const { rt } = makeRuntime();
    let m = null;
    rt._scrml_meta_effect("s", (meta) => { m = meta; });
    for (const k of ["interval", "timeout", "clearInterval", "clearTimeout"]) {
      expect(typeof m[k]).toBe("function");
    }
  });
});

describe("§22.5.1 timers §2: meta.interval", () => {
  test("ticks on each host fire with the given ms; clearInterval stops it", () => {
    const { rt, host } = makeRuntime();
    let ticks = 0, m = null, id = 0;
    rt._scrml_meta_effect("s", (meta) => { m = meta; id = meta.interval(250, () => { ticks++; }); });
    const [h] = [...host.live.keys()];
    expect(host.live.get(h).ms).toBe(250);
    host.fire(h); host.fire(h);
    expect(ticks).toBe(2);
    m.clearInterval(id);
    expect(host.live.size).toBe(0);
    m.clearInterval(id); // already cleared: no-op
    expect(host.log.filter((e) => e[0] === "clear").length).toBe(1);
  });
});

describe("§22.5.1 timers §3: meta.timeout", () => {
  test("fires once; clearTimeout after firing is a no-op", () => {
    const { rt, host } = makeRuntime();
    let fired = 0, m = null, id = 0;
    rt._scrml_meta_effect("s", (meta) => { m = meta; id = meta.timeout(10, () => { fired++; }); });
    const [h] = [...host.live.keys()];
    host.fire(h);
    expect(fired).toBe(1);
    m.clearTimeout(id);
    expect(host.log.filter((e) => e[0] === "clear").length).toBe(0);
  });
});

describe("§22.5.1 timers §4: scope destroy", () => {
  test("live timers are cleared LIFO, then the cleanup callbacks run and observe them cleared", () => {
    const { rt, host } = makeRuntime();
    const seen = [];
    rt._scrml_meta_effect("s", (meta) => {
      meta.interval(5, () => {});
      meta.timeout(5, () => {});
      meta.cleanup(() => { seen.push(["cleanup", host.live.size]); });
    });
    const [h1, h2] = [...host.live.keys()];
    rt._scrml_destroy_scope("s");
    const clears = host.log.filter((e) => e[0] === "clear").map((e) => e[2]);
    expect(clears).toEqual([h2, h1]);
    expect(seen).toEqual([["cleanup", 0]]);
  });

  test("the migrated cleanup shape: meta.clearInterval inside meta.cleanup is a safe no-op", () => {
    const { rt, host } = makeRuntime();
    let cleaned = 0;
    rt._scrml_meta_effect("s", (meta) => {
      const id = meta.interval(1000, () => {});
      meta.cleanup(() => { cleaned++; meta.clearInterval(id); });
    });
    rt._scrml_destroy_scope("s");
    expect(cleaned).toBe(1);
    expect(host.live.size).toBe(0);
    expect(host.log.filter((e) => e[0] === "clear").length).toBe(1);
  });
});

describe("§22.5.1 timers §5: re-run", () => {
  test("a re-run clears the previous run's timers before its cleanups, then registers fresh ids", () => {
    const { rt, host } = makeRuntime();
    rt._scrml_reactive_set("n", 1);
    const ids = [];
    const order = [];
    rt._scrml_meta_effect("s", (meta) => {
      meta.get("n");
      ids.push(meta.interval(5, () => {}));
      meta.cleanup(() => { order.push(host.live.size); });
    });
    expect(host.live.size).toBe(1);
    rt._scrml_reactive_set("n", 2);
    expect(order).toEqual([0]);
    expect(host.live.size).toBe(1);
    expect(ids.length).toBe(2);
    expect(ids[1]).not.toBe(ids[0]);
  });
});

describe("§22.5.1 timers §6: ids are scope-local and kind-checked", () => {
  test("clearInterval with a host handle, a timeout id, or another scope's id cancels nothing", () => {
    const { rt, host } = makeRuntime();
    let a = null, b = null, aInt = 0, aTo = 0;
    rt._scrml_meta_effect("a", (meta) => { a = meta; aInt = meta.interval(5, () => {}); aTo = meta.timeout(5, () => {}); });
    rt._scrml_meta_effect("b", (meta) => { b = meta; meta.interval(5, () => {}); });
    expect(host.live.size).toBe(3);
    const hostHandles = [...host.live.keys()];
    for (const h of hostHandles) a.clearInterval(h); // host handles are not meta ids
    a.clearInterval(aTo);   // a timeout id given to clearInterval
    b.clearInterval(aInt);  // scope a's id given to scope b
    expect(host.live.size).toBe(3);
  });
});

describe("§22.5.1 timers §7: callback must be a function", () => {
  test("a string callback is refused and no host timer is started", () => {
    const { rt, host } = makeRuntime();
    const errs = [];
    const orig = console.error;
    console.error = (...a) => { errs.push(a.map(String).join(" ")); };
    try {
      rt._scrml_meta_effect("s", (meta) => { meta.interval(5, "globalThis.pwned = 1"); });
    } finally {
      console.error = orig;
    }
    expect(host.live.size).toBe(0);
    expect(errs.some((e) => e.includes("callback must be a function"))).toBe(true);
  });
});

describe("§22.5.1 timers §8: the migrated corpus file", () => {
  test("meta-cleanup-001.scrml compiles with no errors and emits meta.interval / meta.clearInterval", () => {
    const file = resolve(import.meta.dir, "../../../samples/compilation-tests/gauntlet-s20-meta/meta-cleanup-001.scrml");
    const result = compileScrml({ inputFiles: [file], write: false });
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    const out = [...result.outputs.values()].map((o) => o.clientJs ?? "").join("\n");
    expect(out).toContain("meta . interval");
    expect(out).toContain("meta . clearInterval");
    expect(out).not.toMatch(/(^|[^.\w])setInterval\s*\(/);
  });
});

describe("§22.5.1 timers §9 (S458 review F5): no timer outlives its scope", () => {
  test("a timer registered inside meta.cleanup during destroy is never started", () => {
    const { rt, host } = makeRuntime();
    rt._scrml_meta_effect("s", (meta) => {
      meta.cleanup(() => { meta.interval(5, () => {}); });
    });
    rt._scrml_destroy_scope("s");
    expect(host.live.size).toBe(0);
    expect(host.log.filter((e) => e[0] === "set").length).toBe(0);
  });

  test("a timer registered inside meta.cleanup before a re-run is never started", () => {
    const { rt, host } = makeRuntime();
    rt._scrml_reactive_set("n", 1);
    rt._scrml_meta_effect("s", (meta) => {
      meta.get("n");
      meta.cleanup(() => { meta.timeout(5, () => {}); });
    });
    rt._scrml_reactive_set("n", 2);
    expect(host.log.filter((e) => e[0] === "set").length).toBe(0);
  });

  test("a meta object retained past _scrml_destroy_scope registers nothing", () => {
    const { rt, host } = makeRuntime();
    let kept = null;
    rt._scrml_meta_effect("s", (meta) => { kept = meta; });
    rt._scrml_destroy_scope("s");
    const id = kept.interval(5, () => {});
    expect(host.live.size).toBe(0);
    kept.clearInterval(id); // a no-op, not a throw
  });

});
