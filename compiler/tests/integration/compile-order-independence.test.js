/**
 * compile-order-independence (s430-emit-state-leak — P5 hybrid-differential
 * determinism gate).
 *
 * The compiler's output MUST be a pure function of its input. Module-level
 * mutable state in the pipeline (codegen per-file singletons, id counters,
 * override hooks) that is not re-initialised before its first reader makes a
 * compile depend on what the SAME PROCESS compiled earlier — the defect that
 * surfaced as `_structuralDeclNamesForFile` (emit-logic.ts) leaking the previous
 * file's structural-decl set into the next file's function-body emission, so
 * `handler-recovery-into-cell` emitted a reset init-thunk from inside `go()` in
 * a fresh process but not on a second compile.
 *
 * The gate: for a representative sample, compile the whole sample in ONE
 * process in order A and then in reverse order; every file's artifacts
 * (every output string + the diagnostic stream) must be byte-identical to
 * compiling that file ALONE in a FRESH process. The in-process runs happen
 * inside the bun-test process, which has usually compiled many other files
 * already — a strictly harder condition than a clean process.
 *
 * The sample is chosen to cover each leak class the s430 corpus A/B found:
 * the guarded-expr-in-function reset thunk (§6.8), the emit-each local-id
 * counter reached from a lift (ternary markup), and the rest are breadth
 * (server fns, engines, each, match, table-for / form-for synth ids,
 * parseVariant).
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { digestCompile } from "../helpers/compile-artifact-digest.js";

const ROOT = resolve(import.meta.dir, "../../..");
const HELPER = resolve(import.meta.dir, "../helpers/compile-artifact-digest.js");

const SAMPLE = [
  "conformance/cases/error/handler-recovery-into-cell/case.scrml",
  "conformance/cases/each/ternary-markup-giti033/case.scrml",
  "conformance/cases/parse-variant/happy-unit-variant/case.scrml",
  "conformance/cases/parse-variant/happy-payload-variant/case.scrml",
  "conformance/cases/table-for/tablefor-render-rt/case.scrml",
].map((p) => resolve(ROOT, p));

function freshDigests(files) {
  const out = new Map();
  for (const f of files) {
    const r = Bun.spawnSync(["bun", HELPER, f], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const line = r.stdout.toString().trim().split("\n").pop();
    const rec = JSON.parse(line);
    out.set(f, rec);
  }
  return out;
}

describe("compile output is independent of prior compiles in the same process", () => {
  test("sample: one process (forward + reverse) == fresh process per file", () => {
    const fresh = freshDigests(SAMPLE);
    const mismatches = [];
    for (const order of [SAMPLE, [...SAMPLE].reverse()]) {
      for (const f of order) {
        const got = digestCompile(f);
        const want = fresh.get(f);
        if (got.digest !== want.digest) {
          const diff = got.parts.filter((p, i) => p !== want.parts[i]);
          mismatches.push(`${f.replace(ROOT + "/", "")}: ${diff.map((d) => d.split("::")[1]).join(",")}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});
