/**
 * async-name-provider.test.js — Limb 1 (dpa-023, S322): ONE async-name provider
 * for three consumers.
 *
 * THE DEFECT. Three consumers asked "is this name async here?" and disagreed for a
 * CLIENT SERVER FN:
 *
 *   emit-expr.ts  combinatorIsAsyncName   -> yes
 *   emit-expr.ts  isClientServerFnCall    -> yes
 *   emit-library-shared.ts  drain-local   -> NO
 *
 * The drain's answer came from `computeAsyncFnNames`, which treats `serverFnNames`
 * as a SEED TRIGGER — `callsServerFn(callees)` colours the CALLER async and never
 * admits the CALLEE to its result set. So `loadRows` was async to the emitter and
 * sync to the fail-closed drain, in the same compilation.
 *
 * The consequence was a MISSING diagnostic rather than a wrong emission. Where
 * emit-expr reaches the call structurally it already records the site into
 * `_clientSyncPeerCalls`; the gap was the positions that sink structurally cannot
 * reach — above all a fn-SIGNATURE parameter default, which `paramSignature`
 * splices as RAW TEXT and which therefore lives in neither `fn.body` nor any
 * structural node (emit-functions.ts says so at its own drain call site).
 *
 * Coverage:
 *   (1) the provider's own rule, directly — shadowing, the three async surfaces,
 *       and the mode-free server-fn term.
 *   (2) `isServerBoundaryCallee` is the shadow-aware membership test both
 *       `isAsyncCalleeName` and `isClientServerFnCall` share.
 *   (3) END-TO-END, the behaviour change: a CLIENT server-fn call in a fn-signature
 *       parameter default now fails closed. This is THE shape the old drain missed.
 *   (4) NEGATIVE control — the `_clientAsyncFnNames` peer surface is unchanged.
 *   (5) A LOCKED KNOWN FALSE POSITIVE, deliberately not suppressed —
 *       `g-drain-textscan-overfires-on-awaited-nested-arm-site`. See the block
 *       comment there for why suppression was rejected after two wrong attempts.
 *   (6) THE FAIL-CLOSE GUARDS the suppression attempts kept breaking. A `!{}` arm
 *       body must still fail closed on a genuinely un-awaitable async site — on the
 *       raw-text branch, on the STRUCTURAL lambda walk, in CLIENT mode, in LIBRARY
 *       mode, and both with and without a nested `!{}`. Two successive `handlerExpr`
 *       skips broke these; the S239 adversarial review caught what 79 green tests
 *       did not. R1/R2/R3 + A1/A2/B2 below are that reviewer's repros, permanent.
 *
 *       EVERY case here asserts the DIAGNOSTIC and the EMITTED JS together. That is
 *       load-bearing, not thoroughness theatre: when these were broken, all six
 *       emitted IDENTICAL JS on both sides, so a diagnostic-only assertion would
 *       have passed while the leak shipped, and an emission-only assertion would
 *       never have failed at all.
 *
 *       PAIRED CONTROL, elsewhere: a RETURNED ARROW closure containing a `!{}` is
 *       spliced verbatim and must STILL fail closed
 *       (`colorless-async-seam-a.test.js`).
 *
 * SPEC / authority: §13.2 position-invariant auto-await · §34
 * E-ASYNC-STDLIB-IN-SYNC-CALLBACK. Origin: dpa-023 Limb 1, scoped
 * `docs/changes/async-predicate-unification/SCOPING.md`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { isAsyncCalleeName, isServerBoundaryCallee } from "../../src/codegen/async-combinators.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/async-name-provider");

beforeAll(() => mkdirSync(FIXTURE_DIR, { recursive: true }));
afterAll(() => { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {} });

const CODE = "E-ASYNC-STDLIB-IN-SYNC-CALLBACK";

/** Compile a `<program>` app fixture; return { clientJs, codes }. */
function compileApp(name, src) {
  const path = join(FIXTURE_DIR, name + ".scrml");
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], write: false, log: () => {} });
  let clientJs = "";
  for (const [fp, out] of result.outputs) {
    if (fp.endsWith(`${name}.scrml`)) { clientJs = out.clientJs ?? ""; break; }
  }
  const codes = (result.errors || [])
    .filter((e) => e.severity !== "warning" && e.severity !== "info")
    .map((e) => e.code);
  return { clientJs, codes };
}

/** Compile a `${}` LIBRARY fixture; return { js, codes }. */
function compileLib(name, src) {
  const path = join(FIXTURE_DIR, name + ".scrml");
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], mode: "library", write: false, log: () => {} });
  let js = "";
  for (const [fp, out] of result.outputs) {
    if (fp.endsWith(`${name}.scrml`)) { js = out.libraryJs ?? ""; break; }
  }
  const codes = (result.errors || [])
    .filter((e) => e.severity !== "warning" && e.severity !== "info")
    .map((e) => e.code);
  return { js, codes };
}

// ---------------------------------------------------------------------------
// (1) the provider's rule, directly
// ---------------------------------------------------------------------------
describe("isAsyncCalleeName — the one rule", () => {
  test("a shadowing local wins over EVERY async surface", () => {
    const facts = {
      declaredNames: new Set(["loadRows"]),
      asyncFnNames: new Set(["loadRows"]),
      serverFnNames: new Set(["loadRows"]),
      isStdlibAsync: () => true,
    };
    expect(isAsyncCalleeName("loadRows", facts)).toBe(false);
    expect(isServerBoundaryCallee("loadRows", facts)).toBe(false);
  });

  test("each of the three async surfaces alone is sufficient", () => {
    expect(isAsyncCalleeName("f", { isStdlibAsync: (n) => n === "f" })).toBe(true);
    expect(isAsyncCalleeName("f", { serverFnNames: new Set(["f"]) })).toBe(true);
    expect(isAsyncCalleeName("f", { asyncFnNames: new Set(["f"]) })).toBe(true);
  });

  test("no facts at all → not async (a test harness / import-free file is not a leak)", () => {
    expect(isAsyncCalleeName("f", {})).toBe(false);
    expect(isAsyncCalleeName("f", { asyncFnNames: new Set(), serverFnNames: new Set() })).toBe(false);
  });

  test("THE DEFECT: a server fn is async even when the async-peer set excludes it", () => {
    // Exactly what `computeAsyncFnNames` hands back — `serverFnNames` seeded the
    // CALLER (`caller` is in asyncFnNames) but the CALLEE is absent from it.
    const facts = {
      asyncFnNames: new Set(["caller"]),
      serverFnNames: new Set(["loadRows"]),
    };
    expect(isAsyncCalleeName("caller", facts)).toBe(true);
    expect(isAsyncCalleeName("loadRows", facts)).toBe(true); // was `false` pre-Limb-1
  });
});

// ---------------------------------------------------------------------------
// (2) the shared membership component
// ---------------------------------------------------------------------------
describe("isServerBoundaryCallee — shared by the provider and isClientServerFnCall", () => {
  test("is MODE-FREE by construction — it takes no mode and cannot branch on one", () => {
    const facts = { serverFnNames: new Set(["loadRows"]) };
    expect(isServerBoundaryCallee("loadRows", facts)).toBe(true);
    expect(isAsyncCalleeName("loadRows", facts)).toBe(true);
  });

  test("does NOT answer for the other two async surfaces — it is an identity test", () => {
    expect(isServerBoundaryCallee("f", { asyncFnNames: new Set(["f"]) })).toBe(false);
    expect(isServerBoundaryCallee("f", { isStdlibAsync: () => true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (3) end-to-end — the shape the old drain could not see
// ---------------------------------------------------------------------------
describe("client server fn in a NON-awaitable position now fails closed", () => {
  test("a fn-SIGNATURE parameter default calling a server fn raises " + CODE, () => {
    // A parameter default is spliced as RAW TEXT by `paramSignature`, so it is in
    // neither `fn.body` nor any structural node — emit-expr's own
    // `_clientSyncPeerCalls` sink structurally cannot reach it. Only the drain can,
    // and pre-Limb-1 the drain did not believe `loadRows` was async.
    const { codes } = compileApp("param-default-server-fn", [
      '<program title="pd">',
      "<state>",
      "<n> = 0",
      "</state>",
      "<page>",
      "<button onclick=go()>Go</button>",
      "</page>",
      "server function loadRows() { return 7 }",
      "function usesDefault(x = loadRows()) { @n = x }",
      "function go() { usesDefault(1) }",
      "</program>",
    ].join("\n"));
    expect(codes).toContain(CODE);
  });
});

// ---------------------------------------------------------------------------
// (4) negative control — the peer surface is untouched
// ---------------------------------------------------------------------------
describe("negative controls", () => {
  test("a plain client server-fn call in an AWAITABLE position still compiles clean and is awaited", () => {
    const { clientJs, codes } = compileApp("awaitable-ok", [
      '<program title="ok">',
      "<state>",
      "<n> = 0",
      "</state>",
      "<page>",
      "<button onclick=go()>Go</button>",
      "</page>",
      "server function loadRows() { return 7 }",
      "function go() { const r = loadRows() @n = r }",
      "</program>",
    ].join("\n"));
    expect(codes).not.toContain(CODE);
    expect(clientJs).toMatch(/await\s+_scrml_fetch_loadRows/);
  });
});

// ---------------------------------------------------------------------------
// (5) KNOWN FALSE POSITIVE — locked, not suppressed
//
// `g-drain-textscan-overfires-on-awaited-nested-arm-site` (filed, dpa-023 Limb 1).
//
// THE BUG. The drain's raw-TEXT scan is POSITION-BLIND: it records every async name
// it finds in an arm handler's text, with no way to tell an awaitable site from a
// non-awaitable one. On the CLIENT caller, `emitArmBody`'s re-parse path DOES await
// an awaitable-position server call — so for that one combination the diagnostic
// fires against output that is already correct.
//
// WHY IT IS NOT SUPPRESSED. Two attempts at a `handlerExpr` skip were both wrong,
// and the S239 review showed why the shape cannot be fixed by narrowing: the gate is
// ARM-granular while the hazard is SITE-granular. Agreeing on which BRANCH runs says
// nothing about whether that branch awaits a given SITE — `emitArmBody` awaits SOME
// awaitable-position sites, while the drain's entire population is non-awaitable
// sites. Blast radius decided it: the over-fire is one disjunct x one position x one
// caller; any subtree skip is all async-name classes x all positions x all four
// callers. A loud false positive is visible and fixable. A silently lost fail-close
// is the exact class this arc exists to kill (see §6).
//
// MEASURED before choosing: corpus population of this false positive is 0 of 1878
// (full diagnostic differential, 0 newly-failing / 0 code changes / 0 text changes).
//
// This test LOCKS the bug rather than hiding it: it asserts the false positive is
// present AND that the emission it fires against is correct. Fix the root (run the
// drain against the re-parsed AST, so positions are real) and this test fails,
// telling you to delete it. That is the intent.
// ---------------------------------------------------------------------------
describe("KNOWN FALSE POSITIVE: position-blind text scan on an awaited nested-arm site", () => {
  test("a nested `!{}` arm body holding an AWAITED server call still raises " + CODE, () => {
    const { clientJs, codes } = compileApp("parse-error-arm", [
      '<program title="pe">',
      "<state>",
      '<outer> = ""',
      '<inner> = ""',
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type OuterErr:enum = { X }",
      "type InnerErr:enum = { Y }",
      "server function a() ! OuterErr { fail OuterErr::X }",
      "server function b() ! InnerErr { fail InnerErr::Y }",
      "function run() {",
      "  const r = a() !{",
      "    | ::X -> {",
      "      const s = b() !{",
      '        | ::Y -> { @inner = "y" }',
      "      }",
      '      @outer = "x"',
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n"));
    // The diagnostic fires — this is the false positive, locked.
    expect(codes).toContain(CODE);
    // …and here is the PROOF that it is false: the emission is correct. The host
    // carries `async` and the inner server call IS awaited. If this pair ever
    // disagrees — diagnostic gone AND emission still awaited — the root has been
    // fixed and this whole `describe` should be deleted.
    expect(clientJs).toMatch(/async function _scrml_run_\d+\(/);
    expect(clientJs).toMatch(/await\s+_scrml_fetch_b_\d+/);
  });
});

// ---------------------------------------------------------------------------
// (6) THE COUNTER-GUARD — a block arm WITHOUT a nested `!{}` must STILL fail closed
//
// `emitArmBody` (emit-logic.ts:632-646) has TWO block paths and only the RE-PARSE
// one (a nested `!{}`) makes `handlerExpr` a dead node. Everything else goes to
// `rewriteBlockBody`, a token-splice with NO auto-await — verbatim, so the parsed
// `handlerExpr` IS a faithful proxy and must still be scanned.
//
// Each case below asserts the WRONG EMISSION and the DIAGNOSTIC together. That
// pairing is the point: when this guard was broken, every emitted-JS assertion still
// passed on both sides — identical wrong output, diagnostic silently gone. Asserting
// only the diagnostic would not have shown that the output was already bad; asserting
// only the emission would not have failed at all.
//
// Provenance: the S239 adversarial review's `lost-failclose.test.js`, verified
// base 3 pass / broken-head 0 pass before being adopted here.
// ---------------------------------------------------------------------------
describe("a BLOCK `!{}` arm WITHOUT a nested `!{}` still fails closed", () => {
  const HEAD = [
    '<program title="counter-guard">',
    "<state>",
    '<outer> = ""',
    "</state>",
    "<page>",
    "<button onclick=run()>Run</button>",
    "<div>${@outer}</div>",
    "</page>",
    "type E:enum = { X }",
    "server function rank(n: int) ! E { fail E::X }",
    "function helper(n: int) {",
    "  return rank(n)",
    "}",
    "function mayFail() ! E { fail E::X }",
  ];

  test("R1 — raw-text branch: a `const` decl binding an async call in a block arm", () => {
    const { clientJs, codes } = compileApp("cg-r1-const-decl", [
      ...HEAD,
      "function run() {",
      "  const r = mayFail() !{",
      "    | ::X :> {",
      "      const v = helper(1)",
      "      @outer = v",
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n"));
    // The host is a PLAIN function and the call is emitted BARE, so `v` is a
    // Promise that gets written into a rendered cell -> the page shows
    // `[object Promise]`. THIS is what the diagnostic is protecting against.
    expect(clientJs).toMatch(/\nfunction _scrml_run_\d+\(\)/);
    expect(clientJs).toMatch(/const v = _scrml_helper_\d+ \( 1 \);/);
    expect(codes).toContain(CODE);
  });

  test("R2 — structural lambda walk: `.sort` async comparator (FORK-2 fail-close)", () => {
    // No raw-text involvement at all here: `handlerExpr.kind === "call"` and
    // `raw` is undefined, so this is caught by the STRUCTURAL walk. `.sort` is
    // deliberately NOT clean-family (DD FORK 2), so it must stay fail-closed.
    const { clientJs, codes } = compileApp("cg-r2-sort-comparator", [
      ...HEAD,
      "function run() {",
      "  const xs = [3, 1, 2]",
      "  const r = mayFail() !{",
      "    | ::X :> {",
      "      xs.sort((p, q) => helper(p))",
      '      @outer = "done"',
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n"));
    expect(clientJs).toMatch(/sort \( \( p , q \) => _scrml_helper_\d+ \( p \) \)/);
    expect(codes).toContain(CODE);
  });

  test("R3 — LIBRARY mode: async stdlib in a `.sort` comparator inside a block arm", () => {
    // The narrowing lives in the SHARED drain, so none of its four callers is
    // exempt. This is the literal shape of `stdlib/auth/jwt.scrml`'s arms.
    const { js, codes } = compileLib("cg-r3-library-sort", [
      "${",
      '  import { safeCall, safeCallAsync } from "scrml:host"',
      "",
      "  export function inspect(obj, items) {",
      "    const bytes = safeCall(() => obj.decode()) !{",
      "      | ::Thrown(msg, name) -> {",
      "        const probe = items.sort((p, q) => safeCallAsync(() => p.rank()))",
      "        return probe",
      "      }",
      "    }",
      "    return bytes",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(js).toContain("safeCallAsync ( ( ) => p . rank ( ) )");
    expect(codes).toContain(CODE);
  });

  // ── A1 / A2 / B2 — the same guards WITH a nested `!{}` present ────────────────
  // R1/R2/R3 above use a block arm with NO nested `!{}`. These three add one, which
  // is what routes `emitArmBody` down its RE-PARSE path. They exist because the
  // second suppression attempt scoped itself to exactly that path on the theory
  // that the re-parse awaits everything in it. It does not:
  //
  //   * the gate is ARM-granular, the hazard is SITE-granular. The re-parse awaits
  //     some AWAITABLE-position sites; the drain's entire population is
  //     NON-awaitable sites (sync callback bodies, param defaults, raw regions).
  //     Which BRANCH runs says nothing about whether a given SITE gets awaited.
  //   * and B2 shows the premise fails even for an awaitable site: on the LIBRARY
  //     caller the re-parse does not await at all.

  test("A1 — CLIENT: `.sort` comparator inside a NESTED-`!{}` arm still fails closed", () => {
    const { clientJs, codes } = compileApp("cg-a1-nested-sort", [
      ...HEAD,
      "function run() {",
      "  const xs = [3, 1, 2]",
      "  const r = mayFail() !{",
      "    | ::X :> {",
      "      const s = mayFail() !{",
      '        | ::X :> { @outer = "y" }',
      "      }",
      "      xs.sort((p, q) => helper(p))",
      '      @outer = "done"',
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n"));
    // NOTE the SPACING, which is itself the tell: the re-parse path emits from a
    // real AST (`xs.sort((p, q) => …)`), whereas `rewriteBlockBody` token-splices
    // (`sort ( ( p , q ) => …`) as in R2 above. Same hazard, two emitters.
    // The comparator is sync and the host is a PLAIN function, so the async
    // `helper` ships a bare Promise into `.sort`.
    expect(clientJs).toMatch(/xs\.sort\(\(p, q\) => _scrml_helper_\d+\(p\)\)/);
    expect(clientJs).toMatch(/\nfunction _scrml_run_\d+\(\)/);
    expect(codes).toContain(CODE);
  });

  test("A2 — LIBRARY: `.sort` comparator inside a NESTED-`!{}` arm still fails closed", () => {
    const { js, codes } = compileLib("cg-a2-nested-sort-lib", [
      "${",
      '  import { safeCall, safeCallAsync } from "scrml:host"',
      "",
      "  export function inspect(obj, items) {",
      "    const bytes = safeCall(() => obj.decode()) !{",
      "      | ::Thrown(msg, name) -> {",
      "        const guard = safeCall(() => obj.check()) !{",
      "          | ::Thrown(m2, n2) -> { return 0 }",
      "        }",
      "        const probe = items.sort((p, q) => safeCallAsync(() => p.rank()))",
      "        return probe",
      "      }",
      "    }",
      "    return bytes",
      "  }",
      "}",
      "",
    ].join("\n"));
    // Re-parse path → normally-spaced emission (contrast R3's token-splice).
    expect(js).toMatch(/export function inspect\s*\(/);
    expect(js).not.toMatch(/export async function inspect\s*\(/);
    expect(js).toContain("items.sort((p, q) => safeCallAsync(() => p.rank()))");
    expect(codes).toContain(CODE);
  });

  test("B2 — LIBRARY: an AWAITABLE-position site in a nested `!{}` is NOT awaited", () => {
    // The one that kills the "the re-parse awaits it" premise outright. The site is
    // an awaitable-position decl init, on the re-parse path — and the library caller
    // still emits it BARE inside a PLAIN function.
    const { js, codes } = compileLib("cg-b2-awaitable-not-awaited", [
      "${",
      '  import { safeCall, safeCallAsync } from "scrml:host"',
      "",
      "  export function inspect(obj) {",
      "    const bytes = safeCall(() => obj.decode()) !{",
      "      | ::Thrown(msg, name) -> {",
      "        const inner = safeCallAsync(() => obj.retry()) !{",
      "          | ::Thrown(m2, n2) -> { return 0 }",
      "        }",
      "        return inner",
      "      }",
      "    }",
      "    return bytes",
      "  }",
      "}",
      "",
    ].join("\n"));
    // Not async, and the call is bare — so `.__scrml_error` is read off a Promise
    // and is ALWAYS falsy: the nested error arm can never run, and a sync fn hands
    // back a Promise. This diagnostic is a TRUE positive.
    expect(js).toMatch(/export function inspect\s*\(/);
    expect(js).not.toMatch(/export async function inspect\s*\(/);
    expect(js).toContain("safeCallAsync(() => obj.retry());");
    expect(js).not.toContain("await safeCallAsync(() => obj.retry())");
    expect(codes).toContain(CODE);
  });
});
