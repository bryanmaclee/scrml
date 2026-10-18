// THROWAWAY (s469-ci-speedup bite proof) — must never reach main. Proves one failing test in one
// integration shard turns the aggregated `gate` check red.
import { test, expect } from "bun:test";
test("s469 ci bite proof — deliberately fails", () => { expect(1).toBe(2); });
