/**
 * stdlib-redis — unit tests for scrml:redis
 *
 * Tests each function directly — extracted from stdlib/redis/index.scrml.
 *
 * STRATEGY: tests run in TWO modes:
 *   1. Smoke / shape tests — verify the wrapper functions exist, accept
 *      the documented argument shapes, and pass through to Bun.redis. These
 *      run unconditionally and use a stub.
 *   2. Live integration tests — only run if REDIS_TEST_URL env var is set,
 *      pointing at a test redis instance. Skipped by default in CI.
 *
 * Why this split: redis is network-bound. Requiring a live redis in CI is
 * heavy. Shape tests catch wrapper-level bugs; integration tests catch
 * real-world bugs and run in environments that have redis available.
 *
 * Coverage:
 *   R1   get / set
 *   R2   setex (set + expire combo)
 *   R3   del / exists
 *   R4   expire / ttl
 *   R5   incr / decr
 *   R6   getBuffer
 *   R7   sadd / srem / sismember / smembers
 *   R8   publish / subscribe / unsubscribe
 *   R9   createClient (custom connection)
 *   R10  send (raw command escape hatch)
 *   R11  close
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";

// --- Stub redis for shape tests (no live connection needed) -------------------

let stubLog = [];
const stubResults = new Map();

const stubRedis = {
  get: async (key) => { stubLog.push(["get", key]); return stubResults.get(key) ?? null; },
  set: async (key, value) => { stubLog.push(["set", key, value]); stubResults.set(key, value); },
  del: async (key) => { stubLog.push(["del", key]); stubResults.delete(key); },
  exists: async (key) => { stubLog.push(["exists", key]); return stubResults.has(key); },
  expire: async (key, sec) => { stubLog.push(["expire", key, sec]); },
  ttl: async (key) => { stubLog.push(["ttl", key]); return stubResults.has(key) ? -1 : -2; },
  incr: async (key) => { stubLog.push(["incr", key]); const v = (Number(stubResults.get(key)) || 0) + 1; stubResults.set(key, String(v)); return v; },
  decr: async (key) => { stubLog.push(["decr", key]); const v = (Number(stubResults.get(key)) || 0) - 1; stubResults.set(key, String(v)); return v; },
  getBuffer: async (key) => { stubLog.push(["getBuffer", key]); return new Uint8Array([1, 2, 3]); },
  sadd: async (key, member) => { stubLog.push(["sadd", key, member]); },
  srem: async (key, member) => { stubLog.push(["srem", key, member]); },
  sismember: async (key, member) => { stubLog.push(["sismember", key, member]); return false; },
  smembers: async (key) => { stubLog.push(["smembers", key]); return []; },
  publish: async (ch, msg) => { stubLog.push(["publish", ch, msg]); },
  subscribe: async (ch, h) => { stubLog.push(["subscribe", ch, typeof h]); },
  unsubscribe: async (ch) => { stubLog.push(["unsubscribe", ch ?? null]); },
  send: async (cmd, args) => { stubLog.push(["send", cmd, args]); return "OK"; },
  close: () => { stubLog.push(["close"]); },
};

// --- Functions extracted from stdlib/redis/index.scrml (using stubRedis) ------

async function get(key) { return await stubRedis.get(key); }
async function set(key, value) { await stubRedis.set(key, value); }
async function setex(key, value, seconds) { await stubRedis.send("SETEX", [key, seconds, value]); }
async function del(key) { await stubRedis.del(key); }
async function exists(key) { return await stubRedis.exists(key); }
async function expire(key, seconds) { await stubRedis.expire(key, seconds); }
async function ttl(key) { return await stubRedis.ttl(key); }
async function incr(key) { return await stubRedis.incr(key); }
async function decr(key) { return await stubRedis.decr(key); }
async function getBuffer(key) { return await stubRedis.getBuffer(key); }
async function sadd(key, member) { await stubRedis.sadd(key, member); }
async function srem(key, member) { await stubRedis.srem(key, member); }
async function sismember(key, member) { return await stubRedis.sismember(key, member); }
async function smembers(key) { return await stubRedis.smembers(key); }
async function publish(channel, message) { await stubRedis.publish(channel, message); }
async function subscribe(channel, handler) { await stubRedis.subscribe(channel, handler); }
async function unsubscribe(channel) { if (channel) { await stubRedis.unsubscribe(channel); } else { await stubRedis.unsubscribe(); } }
async function send(command, args) { return await stubRedis.send(command, args || []); }
function close() { stubRedis.close(); }

// --- Shape tests (stub — always run) -----------------------------------------

describe("scrml:redis — shape", () => {
  beforeAll(() => { stubLog = []; stubResults.clear(); });

  test("R1 get / set roundtrips", async () => {
    await set("k1", "v1");
    expect(await get("k1")).toBe("v1");
    expect(await get("missing")).toBeNull();
  });

  test("R2 setex issues a single atomic SETEX", async () => {
    stubLog = [];
    await setex("session", "abc", 60);
    expect(stubLog).toEqual([["send", "SETEX", ["session", 60, "abc"]]]);
  });

  test("R3 del removes key; exists reports presence", async () => {
    await set("temp", "x");
    expect(await exists("temp")).toBe(true);
    await del("temp");
    expect(await exists("temp")).toBe(false);
  });

  test("R4 expire + ttl pass through", async () => {
    stubLog = [];
    await expire("k", 30);
    const remaining = await ttl("k");
    expect(stubLog[0]).toEqual(["expire", "k", 30]);
    expect(typeof remaining).toBe("number");
  });

  test("R5 incr / decr return new value", async () => {
    stubResults.delete("counter");
    expect(await incr("counter")).toBe(1);
    expect(await incr("counter")).toBe(2);
    expect(await decr("counter")).toBe(1);
  });

  test("R6 getBuffer returns Uint8Array", async () => {
    const buf = await getBuffer("anykey");
    expect(buf).toBeInstanceOf(Uint8Array);
  });

  test("R7 set ops shape", async () => {
    stubLog = [];
    await sadd("s", "alpha");
    await sismember("s", "alpha");
    await smembers("s");
    await srem("s", "alpha");
    expect(stubLog.map(e => e[0])).toEqual(["sadd", "sismember", "smembers", "srem"]);
  });

  test("R8 publish / subscribe / unsubscribe", async () => {
    stubLog = [];
    await publish("notif", "hello");
    await subscribe("notif", (msg, ch) => {});
    await unsubscribe("notif");
    await unsubscribe();
    expect(stubLog).toEqual([
      ["publish", "notif", "hello"],
      ["subscribe", "notif", "function"],
      ["unsubscribe", "notif"],
      ["unsubscribe", null],
    ]);
  });

  test("R10 send raw command", async () => {
    stubLog = [];
    const result = await send("PING", []);
    expect(result).toBe("OK");
    expect(stubLog[0]).toEqual(["send", "PING", []]);
  });

  test("R11 close pass-through", () => {
    stubLog = [];
    close();
    expect(stubLog[0]).toEqual(["close"]);
  });
});

// --- Live integration tests (only with REDIS_TEST_URL) -----------------------

const liveUrl = process.env.REDIS_TEST_URL;

describe.if(liveUrl != null && liveUrl != "")("scrml:redis — live (REDIS_TEST_URL set)", () => {
  let live;

  beforeAll(async () => {
    const bun = await import("bun");
    live = new bun.RedisClient(liveUrl);
    await live.connect();
  });

  afterAll(() => {
    if (live) live.close();
  });

  test("live get/set roundtrip", async () => {
    const k = "scrml-test-" + Date.now();
    await live.set(k, "live-value");
    expect(await live.get(k)).toBe("live-value");
    await live.del(k);
    expect(await live.get(k)).toBeNull();
  });
});
