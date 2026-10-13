/**
 * scrml:time debounce / throttle — S464 "(a) Struct + free fns".
 *
 * A Debouncer / Throttler is DATA ({ id, delay } / { id, limit }); no value holds a function
 * (§14.3 E-VALUE-FUNCTION-STORED), so the timed function is passed once and driven by the free
 * functions run / cancel / flush. Executed against the runtime shim
 * (compiler/runtime/stdlib/time.js), and the scrml surface is compiled.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { debounce, throttle, run, cancel, flush } from "../../runtime/stdlib/time.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("scrml:time debounce — a Debouncer struct driven by run / cancel / flush", () => {
  test("debounce returns plain data (no function anywhere in it)", () => {
    const d = debounce(() => 0, 10);
    expect(Object.keys(d).sort()).toEqual(["delay", "id"]);
    expect(Object.values(d).some((v) => typeof v === "function")).toBe(false);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  test("run coalesces: one call, with the LAST arguments, after the delay", async () => {
    const seen = [];
    const d = debounce((x) => seen.push(x), 15);
    run(d, 1); run(d, 2); run(d, 3);
    expect(seen).toEqual([]);
    await wait(40);
    expect(seen).toEqual([3]);
  });

  test("cancel drops the pending call; flush runs it now", async () => {
    const seen = [];
    const d = debounce((x) => seen.push(x), 15);
    run(d, "a"); cancel(d);
    await wait(40);
    expect(seen).toEqual([]);
    run(d, "b"); flush(d);
    expect(seen).toEqual(["b"]);
    await wait(40);
    expect(seen).toEqual(["b"]);
    flush(d); // nothing pending → nothing runs
    expect(seen).toEqual(["b"]);
  });

  test("two debouncers keep separate state", async () => {
    const seen = [];
    const a = debounce((x) => seen.push("a" + x), 10);
    const b = debounce((x) => seen.push("b" + x), 10);
    expect(a.id).not.toBe(b.id);
    run(a, 1); run(b, 2);
    await wait(30);
    expect(seen.sort()).toEqual(["a1", "b2"]);
  });
});

describe("scrml:time — state is keyed by the struct's identity (S464 round 3)", () => {
  test("a hand-built or copied struct drives nothing (unforgeable)", async () => {
    const seen = [];
    const a = debounce((x) => seen.push("a" + x), 10);
    run({ id: a.id, delay: 0 }, "forged");
    run({ ...a }, "copy");
    await wait(30);
    expect(seen).toEqual([]);
    run(a, "real");
    await wait(30);
    expect(seen).toEqual(["areal"]);
  });

  test("the struct's own delay is the wait run uses", async () => {
    const seen = [];
    const fast = debounce((x) => seen.push(x), 5);
    const slow = debounce((x) => seen.push(x), 60);
    run(slow, "slow"); run(fast, "fast");
    await wait(30);
    expect(seen).toEqual(["fast"]);
    await wait(60);
    expect(seen).toEqual(["fast", "slow"]);
  });

  test("a dropped debouncer is collectable (no table entry outlives its struct)", async () => {
    if (typeof Bun === "undefined" || typeof Bun.gc !== "function") return;
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 500; i++) { const big = new Array(10000).fill(i); debounce(() => big.length, 10); }
    Bun.gc(true);
    const grownMB = (process.memoryUsage().heapUsed - before) / 1e6;
    expect(grownMB).toBeLessThan(10); // 500 × ~80 KB = ~40 MB if the table kept them
  });
});

describe("scrml:time throttle — a Throttler struct", () => {
  test("leading call at once, the last call inside the window runs at its end", async () => {
    const seen = [];
    const t = throttle((x) => seen.push(x), 20);
    expect(Object.keys(t).sort()).toEqual(["id", "limit"]);
    run(t, 1); run(t, 2); run(t, 3);
    expect(seen).toEqual([1]);
    await wait(45);
    expect(seen).toEqual([1, 3]);
  });

  test("cancel drops the trailing call and reopens the window", async () => {
    const seen = [];
    const t = throttle((x) => seen.push(x), 20);
    run(t, 1); run(t, 2); cancel(t);
    await wait(45);
    expect(seen).toEqual([1]);
    run(t, 4);
    expect(seen).toEqual([1, 4]);
  });
});

describe("scrml:time debounce / throttle — the scrml surface compiles (no stored function)", () => {
  let TMP;
  beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "time-struct-")); });
  afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });
  test("a Debouncer kept in a cell or a field is data", () => {
    const fp = join(TMP, "app.scrml");
    writeFileSync(fp, `\${\n  import { debounce, throttle, run, cancel } from 'scrml:time'\n  function search(q) { return q }\n  const searchLater = debounce((q) => search(q), 300)\n  const handlers = { search: debounce(search, 300), scroll: throttle(search, 16) }\n}\n<q> = ""\n<program><input oninput=\${ run(searchLater, @q) }/><button onclick=\${ cancel(searchLater) }>c</button></>\n`);
    const res = compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
    const all = [...(res.errors || []), ...(res.warnings || [])];
    expect(all.filter((d) => d.code === "E-VALUE-FUNCTION-STORED")).toEqual([]);
  });
});
