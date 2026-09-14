/* SPDX-License-Identifier: MIT
 *
 * Unit — g-library-map-surface-unlowered-beyond-the-bracket-read (S415).
 *
 * S412 shipped the §59 map runtime to the library boundary with a fail-closed guard:
 * a map-bearing library fn that ALSO reads the map falls back to the raw path,
 * because §59.6's read lowering does not reach that boundary and the routed emit
 * would return `undefined`. That guard's detection axis was `index` alone, and
 * `mapSetLoweringBoundaryOk` (emit-expr.ts) actually gates the WHOLE §59 read/method
 * surface, returning `false` for every mode that is not `client`/`server`.
 *
 * ⚑ MEASURED AT `9eb9eb24`, library mode, compiling each probe and then IMPORTING AND
 * CALLING the emitted ES module:
 *
 *     m["k"]  -> REFUSED E-CODEGEN-INVALID-LOGIC   (the one shape the old axis caught)
 *     m.size  -> exit 0, returns `undefined`       <- SILENT-WRONG, the headline
 *     m.get / .getOr / .has / .insert / .remove / .update / .insertAll / .keys /
 *       .values / .entries / .sorted / .sortedBy, set .add / .elements
 *             -> exit 0, then TypeError at CALL time
 *
 * ⛔ THE FIRST CUT OF THE FIX WALKED THE AST FOR THOSE NAMES AND WAS WRONG, TWICE
 * OVER. Both failures are pinned below, because both are cheap to reintroduce:
 *
 *   1. RECEIVER-BLINDNESS REFUSED VALID PROGRAMS (the `describe` block "valid
 *      programs on NON-map receivers"). `index` is a syntactic form, but `.size` /
 *      `.get` / `.add` / `.keys` are ordinary identifiers — `.size` is an ordinary
 *      struct field name. Nine valid programs, each executed to a correct value at
 *      `9eb9eb24`, were refused; the refusal is whole-MODULE and the diagnostic
 *      tells their author to report a compiler defect.
 *   2. THE WALK COULD NOT SEE THE LIVE ESCAPE. A non-variant `match` arm result is
 *      carried as a STRING and re-parsed at emit time, so the arm's expression is
 *      not a node under `fn.body`. 13 of 14 shapes inside a `match` arm walked past
 *      the AST guard — in the splicer that exists FOR `match`. Fingerprint: the
 *      token-spaced emit, `return m . size;`.
 *
 * Both are answered by reading the EMITTED BYTES instead — this file's own
 * documented discipline. The emit names its map locals (`let m =
 * _scrml_map_from_entries(…)`), so the scan is scoped to those receivers, and the
 * match-arm escape is present in the bytes even though it is absent from the tree.
 *
 * ⚠ The measured RESIDUALS are pinned as characterization tests in the last block.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
let seq = 0;
function emit(body, name, mode = "library") {
  TMP = TMP || mkdtempSync(join(tmpdir(), "lib-map-surface-"));
  const slug = `${name}-${seq++}`;
  const file = join(TMP, `${slug}.scrml`);
  writeFileSync(file, "${\n  " + body + "\n}\n");
  const outDir = join(TMP, `${slug}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode,
    write: true, verbose: false, log: () => {},
  });
  let js = "";
  let artifact = null;
  try {
    for (const f of readdirSync(outDir)) {
      if (f.endsWith(".js")) { js += readFileSync(join(outDir, f), "utf8"); artifact = join(outDir, f); }
    }
  } catch { /* no artifact */ }
  return { js, artifact, errors: r.errors || [], codes: (r.errors || []).map((e) => e.code) };
}

// The §59 method vocabulary, as `[label, call-suffix]`.
const METHODS = [
  ["get", `get("k")`], ["getOr", `getOr("k", 0)`], ["has", `has("k")`],
  ["insert", `insert("j", 9)`], ["remove", `remove("k")`], ["update", `update("k", 1)`],
  ["insertAll", `insertAll(["j": 9])`], ["keys", `keys()`], ["values", `values()`],
  ["entries", `entries()`], ["sorted", `sorted()`], ["sortedBy", `sortedBy("k")`],
];

const straight = (tail) => `export fn probe() { let m = ["k": 7]; ${tail} }`;

const STRAIGHT_SHAPES = [
  ["bracket read `m[k]`", straight(`return m["k"]`)],
  ["`.size` member", straight("return m.size")],
  ...METHODS.map(([n, call]) => [`\`.${n}\``, straight(`return m.${call}`)]),
  ["set `.add`", `export fn probe() { let s: set[string] = [:]; return s.add("a") }`],
  ["set `.elements`", `export fn probe() { let s: set[string] = [:]; return s.elements() }`],
];

describe("§59 library boundary — the STRAIGHT-LINE read surface fails LOUDLY (S415)", () => {
  for (const [label, src] of STRAIGHT_SHAPES) {
    test(`${label} is REFUSED at compile time, not shipped`, () => {
      const { codes, artifact } = emit(src, "shape");
      // Loud half 1 — a build-blocking diagnostic.
      expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
      // Loud half 2 — and NO importable artifact reaches disk. A diagnostic beside a
      // written module would still let a consumer import the wrong answer.
      expect(artifact).toBeNull();
    });
  }

  test("⚑ THE HEADLINE — `.size` no longer compiles clean and returns `undefined`", () => {
    // At `9eb9eb24` this emitted `return m.size;` against a HAMT node (a tagged plain
    // object with no `size` property) at exit 0, zero diagnostics. §59.6 says
    // `.size -> int` is the entry count, with no condition on compile mode.
    const { codes, js } = emit(straight("return m.size"), "size-headline");
    expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(js).not.toContain("return m.size");
  });
});

describe("§59 library boundary — the same surface inside a MATCH arm (S415)", () => {
  // ⚑ THE HALF AN AST WALK STRUCTURALLY CANNOT SEE. A non-variant arm result is
  // carried as a STRING and re-parsed at emit time, so it is not a node under
  // `fn.body`. At `9eb9eb24` 13 of these 14 compiled clean.
  const arm = (expr) =>
    `export fn probe(n: int) { let m = ["k": 7]; return match n { 1 -> ${expr} else -> 0 } }`;
  const ARM_SHAPES = [
    ["bracket read", arm(`m["k"]`)],
    ["`.size`", arm("m.size")],
    ...METHODS.map(([n, call]) => [`\`.${n}\``, arm(`m.${call}`)]),
  ];
  for (const [label, src] of ARM_SHAPES) {
    test(`${label} in a match arm is REFUSED`, () => {
      const { codes, artifact } = emit(src, "arm-shape");
      expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
      expect(artifact).toBeNull();
    });
  }

  test("the token-spaced re-parse fingerprint does not survive into an artifact", () => {
    const { js } = emit(arm("m.size"), "arm-fingerprint");
    expect(js).not.toMatch(/m\s+\.\s+size/);
  });
});

describe("⛔ valid programs on NON-map receivers must still COMPILE AND RUN (S415)", () => {
  // ⚑ THIS IS THE HALF THE FIRST CUT GOT WRONG, AND THE HALF ITS TESTS NEVER
  // EXERCISED — they pinned only `.length` and `.reverse()`, two names chosen not to
  // collide. Every case here builds a map AND touches a colliding identifier on a
  // receiver that is not that map. Each ran to the asserted value at `9eb9eb24`.
  const CASES = [
    ["struct field named `size`",
     `type Item:struct = { size: int, name: string }\n  export fn probe(it: Item) -> int { let m = ["k": 7]; return it.size }`,
     { size: 42, name: "x" }, 42],
    ["`.get` on a plain object",
     `export fn probe(o) { let m = ["k": 7]; return o.get("a") }`,
     { get: (k) => "GOT:" + k }, "GOT:a"],
    ["`.add` on a plain object",
     `export fn probe(o) { let m = ["k": 7]; return o.add(1) }`,
     { add: (n) => n + 100 }, 101],
    ["`.has` on a plain object",
     `export fn probe(o) { let m = ["k": 7]; return o.has("a") }`,
     { has: () => true }, true],
    ["`.keys` on a plain object",
     `export fn probe(o) { let m = ["k": 7]; return o.keys() }`,
     { keys: () => ["a"] }, ["a"]],
    ["`.entries` on a plain object",
     `export fn probe(o) { let m = ["k": 7]; return o.entries() }`,
     { entries: () => [1] }, [1]],
    ["`.values` on a plain object",
     `export fn probe(o) { let m = ["k": 7]; return o.values() }`,
     { values: () => [9] }, [9]],
    ["`.update` on a plain object",
     `export fn probe(o) { let m = ["k": 7]; return o.update(1) }`,
     { update: (n) => n * 3 }, 3],
    ["`o.m.size` where a local named `m` exists",
     `export fn probe(o) { let m = ["k": 7]; return o.m.size }`,
     { m: { size: 5 } }, 5],
    ["`o.m.get(…)` where a local named `m` exists",
     `export fn probe(o) { let m = ["k": 7]; return o.m.get("a") }`,
     { m: { get: (k) => "G:" + k } }, "G:a"],
    ["`.size` on a plain identifier parameter",
     `export fn probe(o) { let m = ["k": 7]; return o.size }`,
     { size: 9 }, 9],
  ];

  for (const [label, src, arg, expected] of CASES) {
    test(`${label} compiles AND returns the right value`, async () => {
      const { codes, artifact } = emit(src, "collide");
      expect(codes).toEqual([]);
      expect(artifact).not.toBeNull();
      const mod = await import(pathToFileURL(artifact).href);
      // Compiling is not enough — the point is that the program still WORKS.
      expect(mod.probe(arg)).toEqual(expected);
    });
  }

  test("an initializer that merely CONTAINS a map argument does not make the name a map", () => {
    // `let z = f(["k": 7])` — the runtime call is an ARGUMENT, not the initializer
    // head. Conferring map-hood on `z` refused a program that runs at base.
    const { codes, artifact } = emit(
      `export fn f(x) { return x }\n  export fn probe() { let z = f(["k": 7]); return z.size }`,
      "arg-not-map",
    );
    expect(codes).toEqual([]);
    expect(artifact).not.toBeNull();
  });

  test("⚠ the BRACKET limb stays receiver-BLIND — `xs[0]` beside a map literal IS refused", () => {
    // Base `9eb9eb24` refused this and so does head: the bracket limb is base's
    // `containsIndexExpr`, unchanged. An intermediate revision scoped the bracket to
    // named receivers, which un-refused this case AND introduced a silent-wrong (see
    // the alias-bracket test below). The false-rejection cost here is base's own
    // accepted precedent. DO NOT "fix" it by scoping the bracket.
    const { codes } = emit(
      `export fn probe(xs) { let m = ["k": 7]; return xs[0] }`,
      "array-index-blind",
    );
    expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
  });
});

describe("CONTROL — the read shapes are correct at the browser boundary (S415)", () => {
  // The refusals are a LIBRARY-BOUNDARY fact, not a broken program. If these redden,
  // the guard is rejecting valid scrml rather than an unlowerable emission.
  for (const [label, src] of STRAIGHT_SHAPES) {
    test(`${label} compiles clean under mode:browser`, () => {
      const { codes } = emit(src, "browser-control", "browser");
      expect(codes).toEqual([]);
    });
  }
});

describe("the guard stays narrow — what must KEEP routing (S415)", () => {
  test("a map-CONSTRUCTING fn still routes, and the emitted module runs", async () => {
    const { codes, artifact } = emit(straight("return m"), "construct");
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    // A green compile proves it parses; only calling it proves the runtime travelled.
    expect(mod.probe().__scrml_map).toBe(true);
  });

  test("a map-free fn is untouched", () => {
    const { codes, js } = emit("export fn probe(a, b) { return a + b }", "map-free");
    expect(codes).toEqual([]);
    expect(js).toContain("export function probe");
    expect(js).not.toContain("_scrml_map_from_entries");
  });

  test("a STRING containing `.size` cannot cost a valid program its route", () => {
    // String literal CONTENT is blanked before the scan. A read is code, never
    // literal content, so blanking can only prevent false positives.
    const { codes, artifact } = emit(
      `export fn probe() { let m = ["k": 7]; return "m.size and m[0] and m.getOr(" }`,
      "string-immune",
    );
    expect(codes).toEqual([]);
    expect(artifact).not.toBeNull();
  });
});

describe("the ASYNC library splicer is guarded too (S415)", () => {
  // `emitAsyncLibraryFns` is a SEPARATE router that consults neither
  // `unmetRuntimeHelperRefs` nor the map guard, so an async fn escaped entirely —
  // at `9eb9eb24` all three below compiled exit 0, INCLUDING the bracket read, the
  // one shape S412's guard was written for.
  const asyncBuild = (tail) =>
    `import { safeCallAsync } from "scrml:host"\n  ` +
    `export fn probe() { let m = ["k": 7]; let r = safeCallAsync(() => 1); ${tail} }`;

  for (const [label, tail] of [
    ["bracket read", `return m["k"]`],
    ["`.size`", "return m.size"],
    ["`.getOr`", `return m.getOr("k", 0)`],
  ]) {
    test(`${label} in an ASYNC library fn is refused`, () => {
      const { codes, artifact } = emit(asyncBuild(tail), "async-shape");
      expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
      expect(artifact).toBeNull();
    });
  }

  test("CONTROL — an async fn that only CONSTRUCTS a map still routes and stays async", () => {
    const { codes, js } = emit(asyncBuild("return m"), "async-construct");
    expect(codes).toEqual([]);
    expect(js).toContain("export async function probe");
    expect(js).toContain("_scrml_map_from_entries(");
  });

  test("CONTROL — a colliding name on a non-map receiver still routes in an ASYNC fn", async () => {
    const { codes, artifact } = emit(
      `import { safeCallAsync } from "scrml:host"\n  ` +
      `export fn probe(o) { let m = ["k": 7]; let r = safeCallAsync(() => 1); return o.get("a") }`,
      "async-collide",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(await mod.probe({ get: (k) => "A:" + k })).toBe("A:a");
  });
});

describe("⛔ the BRACKET form on an unbound receiver must REFUSE, not escape (S415)", () => {
  // ⚑ THE TEST THAT WAS MISSING, AND ITS ABSENCE IS THE WHOLE STORY OF ROUND 3.
  // The residual block below pins the `.size` form on alias / peer / parameter
  // receivers as silent-wrong, which is correct — base does the same. An
  // intermediate revision scoped the BRACKET limb to named receivers too, and
  // because every residual test wrote `return n.size` rather than `return n["k"]`,
  // nothing caught that `let n = m; return n["k"]` — REFUSED at base — began
  // shipping `return n["k"]` and returning `undefined` where §59.6 requires 7.
  // A mutant cannot kill a behaviour the suite never expresses.
  test("`let n = m; return n[\"k\"]` is REFUSED (base parity)", () => {
    const { codes, artifact } = emit(
      `export fn probe() -> int { let m = ["k": 7]; let n = m; return n["k"] }`,
      "alias-bracket",
    );
    expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(artifact).toBeNull();
  });

  test("⚠ an ALIASED bracket read inside a MATCH arm escapes BOTH limbs (base parity)", async () => {
    // The intersection of the two limbs' blind spots, and it is pre-existing:
    // measured at `9eb9eb24`, this also ran `undefined`. Limb 1 cannot see it (the
    // arm is carried as a STRING, so there is no `index` node) and limb 2 will not
    // (the alias is not bound to a map constructor). Pinned as a characterization
    // rather than asserted as a refusal — closing it would need a THIRD policy over
    // the same surface, and each previous attempt to widen one policy produced a new
    // defect in the opposite direction.
    const { codes, artifact } = emit(
      `export fn probe(n: int) -> int { let m = ["k": 7]; let a = m; return match n { 1 -> a["k"] else -> 0 } }`,
      "alias-bracket-arm",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.probe(1)).toBeUndefined();
  });
});

describe("⚠ RESIDUALS, PINNED NOT PAPERED OVER — measured against BASE, per form (S415)", () => {
  // ⚑ THE DISTINCTION THIS BLOCK MUST KEEP STRAIGHT, because blurring it is what
  // hid a regression for a whole review round. "Already silent-wrong at base" is
  // true for the `.size` FORM on these receivers and FALSE for the BRACKET form on
  // an alias — base REFUSED that one (see the block above). Every claim here was
  // measured at `9eb9eb24` by compiling AND RUNNING, not inferred.
  test("a map arriving as a PARAMETER still reads silently wrong", async () => {
    const { codes, artifact, js } = emit("export fn probe(m) { return m.size }", "residual-param");
    expect(codes).toEqual([]);
    expect(js).toContain("return m.size");
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.probe({ __scrml_map: true })).toBeUndefined();
  });

  test("a map returned by a PEER call still reads silently wrong", async () => {
    const { codes, artifact } = emit(
      `export fn mk() { let m = ["k": 7]; return m }\n  export fn probe() { let q = mk(); return q.size }`,
      "residual-peer",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.probe()).toBeUndefined();
  });

  test("an ALIASED map still reads silently wrong in the `.size` form", async () => {
    // ⚑ Contrast with the block above: the same alias in the BRACKET form REFUSES.
    // The two forms are on different limbs, deliberately.
    const { codes, artifact } = emit(
      `export fn probe() { let m = ["k": 7]; let n = m; return n.size }`,
      "residual-alias",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.probe()).toBeUndefined();
  });

  test("a PEER-call receiver in the BRACKET form is pre-existing silent-wrong, NOT a regression", async () => {
    // Measured at `9eb9eb24`: this also ran `undefined`. Base's guard is gated on
    // the map runtime appearing in THIS fn's emit, and `probe` lowers no literal of
    // its own, so base never consulted it either. Recorded because the review brief
    // expected base to refuse it — it does not.
    const { codes, artifact } = emit(
      `export fn mk() { let m = ["k": 7]; return m }\n  export fn probe() -> int { let q = mk(); return q["k"] }`,
      "residual-peer-bracket",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.probe()).toBeUndefined();
  });

  test("⚠ KNOWN FALSE REJECTION — an inner binding shadowing a map local's name", () => {
    // `xs.map((m) => m.size)` beside `let m = ["k": 7]`: the lambda's `m` is not the
    // map, but a text scan cannot see the shadow. This RUNS correctly at base and is
    // refused here. Left refusing deliberately — dropping the name whenever it is
    // re-bound would un-guard a real top-level `m.size` in the same fn, trading a
    // rare false rejection for a rare WRONG ANSWER. Closing it needs SCOPE.
    const { codes } = emit(
      `export fn probe(xs) { let m = ["k": 7]; return xs.map((m) => m.size) }`,
      "shadowed-lambda-param",
    );
    expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // --- and two shapes measured CAUGHT that look like they should escape ---------
  test("a PARENTHESISED receiver IS caught (the parens do not survive the emit)", () => {
    const { codes } = emit(
      `export fn probe() { let m = ["k": 7]; return (m)["k"] }`,
      "paren-receiver",
    );
    expect(codes).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("an ANONYMOUS receiver IS caught (the balanced-paren scan reaches it)", () => {
    for (const src of [
      `export fn probe() { return ["k": 7].size }`,
      `export fn probe() { return ["k": 7].getOr("k", 0) }`,
    ]) {
      expect(emit(src, "anon-receiver").codes).toContain("E-CODEGEN-INVALID-LOGIC");
    }
  });
});
