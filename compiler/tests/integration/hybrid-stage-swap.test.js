/**
 * hybrid-stage-swap — the stage-substitution seam + the hybrid-compiler harness.
 * change-id: s430-stage-swap (bryan S430 ruling P5).
 *
 * P5: a bootstrap module is DONE when a HYBRID compiler — the TS pipeline with that one stage
 * swapped for the bootstrap build — passes the full conformance suite; the corpus differential is
 * triage. These tests pin the mechanism that ruling depends on:
 *
 *   1. NO SUBSTITUTION = NO CHANGE: the seam hands back the TS default function itself.
 *   2. The registry and api.js agree: every stage api.js picks is registered, every registered
 *      stage is picked, and every TS default module exports the registered entry.
 *   3. SEAM VALIDATION fails LOUD with the stage name and the first divergent path — for a
 *      malformed return, for in-place AST corruption, for a throw, for a Promise — and nothing
 *      downstream runs.
 *   4. IT BITES, BOTH DIRECTIONS: an unperturbed re-export is green on conformance and the
 *      differential; a deliberately perturbed stage (drops every `function-decl`) is red on both,
 *      and the differential names the divergent artifacts.
 *   5. CALIBRATION GUARD: every stage routed through its own seam (the TS default as the
 *      "substitute") passes its own contract on a representative sample set.
 *
 * The full-corpus / full-suite versions of 4 and 5 are `bun scripts/hybrid.ts` runs, recorded in
 * docs/changes/s430-stage-swap/progress.md; these are the bounded, gated regression pins.
 */
import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { compileScrml } from "../../src/api.js";
import { buildAST } from "../../src/ast-builder.js";
import { runNRBatch } from "../../src/name-resolver.ts";
import {
  STAGE_SEAMS,
  StageSeamError,
  createStageSeams,
  checkStageOutput,
} from "../../src/pipeline-seam.ts";
import {
  buildStageOverrides,
  runDifferential,
  runHybridConformance,
} from "../../../scripts/hybrid.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const FIX = resolve(HERE, "fixtures/hybrid");
const IDENTITY_TAB = resolve(FIX, "tab-identity.js");
const PERTURBED_TAB = resolve(FIX, "tab-drop-function-decl.js");
const SPANLESS_TAB = resolve(FIX, "tab-spanless.js");

// Samples with functions, markup, server fns, engines — the perturbation has something to drop.
const SAMPLES = [
  "examples/02-counter.scrml",
  "examples/03-contact-book.scrml",
  "examples/14-mario-state-machine.scrml",
  "examples/20-middleware.scrml",
];
const abs = (rel) => resolve(REPO, rel);

function compileWith(rel, extra = {}) {
  return compileScrml({ inputFiles: [abs(rel)], write: false, log: () => {}, ...extra });
}

function catchSeam(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

describe("1. no substitution = no change", () => {
  test("pick() returns the TS default function object itself for every stage", () => {
    const seams = createStageSeams(null, null);
    expect(seams.active).toBe(false);
    for (const s of STAGE_SEAMS) {
      const f = function tsDefault() {};
      expect(seams.pick(s.name, f)).toBe(f);
    }
  });

  test("an empty stageOverrides object is also inert", () => {
    const seams = createStageSeams({}, {});
    expect(seams.active).toBe(false);
    expect(seams.pick("TAB", buildAST)).toBe(buildAST);
  });
});

describe("2. registry <-> api.js <-> TS modules agree", () => {
  const apiSrc = readFileSync(resolve(REPO, "compiler/src/api.js"), "utf8");
  const picked = new Set([...apiSrc.matchAll(/seams\.pick\("([A-Z0-9-]+)"/g)].map((m) => m[1]));

  test("every stage api.js picks is registered, and every registered stage is picked", () => {
    const registered = new Set(STAGE_SEAMS.map((s) => s.name));
    expect([...picked].filter((n) => !registered.has(n))).toEqual([]);
    expect([...registered].filter((n) => !picked.has(n))).toEqual([]);
  });

  test("every stage's TS default module exports its registered entry function", async () => {
    const missing = [];
    for (const s of STAGE_SEAMS) {
      const mod = await import(resolve(REPO, "compiler/src", s.tsModule));
      if (typeof mod[s.entry] !== "function") missing.push(`${s.name}: ${s.tsModule} lacks ${s.entry}`);
    }
    expect(missing).toEqual([]);
  });

  test("stage names are unique", () => {
    const names = STAGE_SEAMS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("3. seam validation fails loud, names the stage and the first divergent path", () => {
  test("unknown stage name in stageOverrides is refused up front", () => {
    const e = catchSeam(() => compileWith(SAMPLES[0], { stageOverrides: { NOPE: () => ({}) } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("NOPE");
    expect(e.message).toContain("unknown stage");
  });

  test("a module missing the entry export is refused, listing what it does export", () => {
    const e = catchSeam(() => compileWith(SAMPLES[0], { stageOverrides: { TAB: { notBuildAST() {} } } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.message).toContain("exports no `buildAST`");
    expect(e.message).toContain("notBuildAST");
  });

  test("the same stage substituted twice (stageOverrides + selfHostModules) is refused", () => {
    const e = catchSeam(() =>
      compileWith(SAMPLES[0], { stageOverrides: { TAB: buildAST }, selfHostModules: { buildAST } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.message).toContain("substituted twice");
  });

  test("a TAB that drops a span is stopped AT the TAB boundary; no downstream stage runs", async () => {
    const spanless = await import(SPANLESS_TAB);
    let ceCalls = 0;
    const e = catchSeam(() =>
      compileWith(SAMPLES[1], {
        stageOverrides: {
          TAB: spanless,
          CE: (input) => {
            ceCalls++;
            return { files: [], errors: [] };
          },
        },
      }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("TAB");
    expect(e.path).toMatch(/^result\.ast\.nodes\[\d+\](\.children\[\d+\])?\.span$/);
    expect(e.message).toContain("Span loss");
    expect(ceCalls).toBe(0);
  });

  test("a malformed return value names the first divergent path", () => {
    const e = catchSeam(() =>
      compileWith(SAMPLES[0], { stageOverrides: { MOD: () => ({ compilationOrder: [], exportRegistry: new Map(), importGraph: {}, errors: [] }) } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("MOD");
    expect(e.path).toBe("result.importGraph");
    expect(e.message).toContain("expected a Map");
  });

  test("a stage that corrupts an upstream AST IN PLACE is caught at its own boundary", () => {
    const e = catchSeam(() =>
      compileWith(SAMPLES[1], {
        stageOverrides: {
          NR: (files, reg, graph) => {
            const out = runNRBatch(files, reg, graph);
            delete files[0].ast.nodes[0].span;
            return out;
          },
        },
      }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("NR");
    expect(e.path).toBe("files[0].ast.nodes[0].span");
    expect(e.message).toContain("mutated in place");
  });

  test("a substitute that throws is re-thrown naming the stage, original kept as cause", () => {
    const boom = new Error("boom from the bootstrap");
    const e = catchSeam(() => compileWith(SAMPLES[0], { stageOverrides: { DG: () => { throw boom; } } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("DG");
    expect(e.cause).toBe(boom);
    expect(e.message).toContain("substitute threw");
  });

  test("a substitute that returns a Promise is refused (the pipeline is synchronous)", () => {
    const e = catchSeam(() => compileWith(SAMPLES[0], { stageOverrides: { PA: async () => ({}) } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("PA");
    expect(e.message).toContain("Promise");
  });

  test("the legacy selfHostModules route is validated by the same seam", () => {
    const e = catchSeam(() => compileWith(SAMPLES[0], { selfHostModules: { runPA: () => ({ errors: [] }) } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("PA");
    expect(e.path).toBe("result.protectAnalysis");
  });

  test("a seam violation is not swallowed by a lint stage's defensive try/catch", () => {
    // CSS-CONFLICT runs inside a try/catch that swallows a throwing checker; a CONTRACT violation
    // must still escape.
    const e = catchSeam(() => compileWith(SAMPLES[1], { stageOverrides: { "CSS-CONFLICT": () => "not an array" } }));
    expect(e).toBeInstanceOf(StageSeamError);
    expect(e.stage).toBe("CSS-CONFLICT");
  });

  test("checkStageOutput reports the first divergence for a direct value", () => {
    expect(checkStageOutput("DG", { depGraph: { nodes: new Map(), edges: [{ from: "a", to: 1, kind: "reads" }] }, errors: [] }))
      .toEqual({ path: "result.depGraph.edges[0].to", detail: "expected a string, got number 1" });
    expect(checkStageOutput("DG", { depGraph: { nodes: new Map(), edges: [] }, errors: [] })).toBeNull();
  });
});

describe("4. the harness bites, both directions", () => {
  test("unperturbed re-export: differential identical on the samples", async () => {
    const rep = await runDifferential(SAMPLES, [["TAB", IDENTITY_TAB]], { concurrency: 2 });
    expect(rep.divergences).toEqual([]);
    expect(rep.identical).toBe(SAMPLES.length);
  }, 120_000);

  test("perturbed TAB (drops function-decl): differential red and names the artifacts", async () => {
    const rep = await runDifferential(SAMPLES, [["TAB", PERTURBED_TAB]], { concurrency: 2 });
    expect(rep.divergentFiles).toBeGreaterThan(0);
    const named = rep.divergences.filter((d) => d.kind === "artifact" && /#clientJs$/.test(d.artifact ?? ""));
    expect(named.length).toBeGreaterThan(0);
    expect(named[0].hunk).toContain("@@ first difference at line");
    // Structurally valid — the seam did NOT fire; only the differential could see it.
    expect(rep.divergences.some((d) => d.kind === "seam-violation")).toBe(false);
  }, 120_000);

  // A case that needs a function-decl to fire its code (measured red under the perturbation).
  const CASE = "channel/server-cell-read";

  test("unperturbed re-export: conformance green", async () => {
    const overrides = await buildStageOverrides([["TAB", IDENTITY_TAB]]);
    const rep = await runHybridConformance(overrides, CASE);
    expect(rep.total).toBeGreaterThan(0);
    expect(rep.failures).toEqual([]);
  }, 60_000);

  test("perturbed TAB: conformance red", async () => {
    const overrides = await buildStageOverrides([["TAB", PERTURBED_TAB]]);
    const rep = await runHybridConformance(overrides, CASE);
    expect(rep.total).toBeGreaterThan(0);
    expect(rep.failures.length).toBe(rep.total);
    expect(rep.failures[0].reasons.join("\n")).toContain("missing required codes");
  }, 60_000);
});

describe("5. calibration guard: every stage passes its own contract", () => {
  test("all 36 stages routed through their seams, TS defaults as substitutes", async () => {
    const overrides = await buildStageOverrides([["all", "ts"]]);
    expect(Object.keys(overrides).length).toBe(STAGE_SEAMS.length);
    for (const rel of [...SAMPLES, "samples/compilation-tests/test-002-with-logic.scrml", "stdlib/regex/index.scrml"]) {
      const r = compileWith(rel, { stageOverrides: overrides });
      expect(Array.isArray(r.errors)).toBe(true);
    }
  }, 60_000);
});

describe("runner CLI exit codes", () => {
  const run = (...args) =>
    Bun.spawnSync(["bun", resolve(REPO, "scripts/hybrid.ts"), ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });

  test("unknown stage -> exit 2 (not a valid run)", () => {
    const p = run("--swap", "NOPE=ts", "--differential", "--files", SAMPLES[0]);
    expect(p.exitCode).toBe(2);
    expect(p.stderr.toString()).toContain("unknown stage");
  }, 60_000);

  test("no --swap -> exit 2 (a hybrid with nothing swapped is pure TS)", () => {
    const p = run("--differential");
    expect(p.exitCode).toBe(2);
  }, 60_000);

  test("--list -> exit 0 and prints every stage", () => {
    const p = run("--list");
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    for (const s of STAGE_SEAMS) expect(out).toContain(s.name);
  }, 60_000);
});
