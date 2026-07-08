// scrml:redis — runtime shim
//
// Hand-written ES module mirroring stdlib/redis/index.scrml. Thin wrapper
// over Bun.redis (Bun ≥ 1.3). Server-side only — uses the global Bun.redis
// + RedisClient.
//
// Surface (must match stdlib/redis/index.scrml exports):
//   - get(key)                  → Promise<string | null>
//   - set(key, value)           → Promise<void>
//   - setex(key, value, seconds) → Promise<void>
//   - del(key)                  → Promise<void>
//   - exists(key)               → Promise<boolean>
//   - expire(key, seconds)      → Promise<void>
//   - ttl(key)                  → Promise<number>
//   - incr(key)                 → Promise<number>
//   - decr(key)                 → Promise<number>
//   - getBuffer(key)            → Promise<Uint8Array>
//   - sadd(key, member)         → Promise<void>
//   - srem(key, member)         → Promise<void>
//   - sismember(key, member)    → Promise<boolean>
//   - smembers(key)             → Promise<string[]>
//   - publish(channel, message) → Promise<void>
//   - subscribe(channel, handler) → Promise<void>
//   - unsubscribe(channel?)     → Promise<void>
//   - createClient(url, options?) → RedisClient
//   - send(command, args?)      → Promise<any>
//   - close()                   → void

import { redis, RedisClient } from "bun";

export async function get(key) {
  return await redis.get(key);
}

export async function set(key, value) {
  await redis.set(key, value);
}

export async function setex(key, value, seconds) {
  // Atomic SET-with-expiry (single round-trip). Separate set + expire would
  // leave a key with NO ttl if the process died between them. SETEX key sec value.
  await redis.send("SETEX", [key, seconds, value]);
}

export async function del(key) {
  await redis.del(key);
}

export async function exists(key) {
  return await redis.exists(key);
}

export async function expire(key, seconds) {
  await redis.expire(key, seconds);
}

export async function ttl(key) {
  return await redis.ttl(key);
}

export async function incr(key) {
  return await redis.incr(key);
}

export async function decr(key) {
  return await redis.decr(key);
}

export async function getBuffer(key) {
  return await redis.getBuffer(key);
}

export async function sadd(key, member) {
  await redis.sadd(key, member);
}

export async function srem(key, member) {
  await redis.srem(key, member);
}

export async function sismember(key, member) {
  return await redis.sismember(key, member);
}

export async function smembers(key) {
  return await redis.smembers(key);
}

export async function publish(channel, message) {
  await redis.publish(channel, message);
}

export async function subscribe(channel, handler) {
  await redis.subscribe(channel, handler);
}

export async function unsubscribe(channel) {
  if (channel) {
    await redis.unsubscribe(channel);
  } else {
    await redis.unsubscribe();
  }
}

export function createClient(url, options) {
  return new RedisClient(url, options);
}

export async function send(command, args) {
  return await redis.send(command, args || []);
}

export function close() {
  redis.close();
}
