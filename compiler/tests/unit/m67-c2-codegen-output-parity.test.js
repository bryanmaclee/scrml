/**
 * M6.7-C2 — native→codegen output parity for `server @var = expr` (§52.4 cell
 * authority) and the §8.11 mount-hydrate coalescing it gates.
 *
 * DOMINANT ROOT CAUSE (closed here): under a native-parser default the legacy
 * `server @var = expr` cell-authority form (SPEC §52.4) HARD-ERRORED in the
 * native parser — `server` (KwServer) leading to a `@`-ident had no production,
 * so it fell through to the expression-statement arm and produced an
 * E-EXPR-UNEXPECTED + E-STMT-MISSING-SEMICOLON + E-STMT-UNEXPECTED-TOKEN
 * cascade. The whole `${...}` logic block failed -> NO `state-decl{isServer:true}`
 * -> the §8.11 mount-hydrate collector (collect.ts:549, which gates on
 * `state-decl{isServer:true}`) never fired -> every mount-hydrate codegen
 * output-string assertion DIVERGED from live.
 *
 * FIX LOCUS: native parser (parse-stmt.js parseServerAtStateDecl) + the
 * native->live bridge (translate-stmt.js makeStateDeclNode honoring
 * structuralForm:false). Codegen is UNTOUCHED (parser-agnostic, per the
 * b.5/b.6/C1 precedent). Live's ast-builder.js:4879 is the oracle.
 *
 * S449 RE-POINT: these tests used to DRIVE BOTH PIPELINES (live + the retired
 * full-pipeline `parser:"scrml-native"`) and assert parity. The fix lives in
 * the native parser + bridge, reached in production through `nativeParseFile`,
 * so §1 now asserts on the native tree directly: no parse-error cascade, and a
 * `state-decl{isServer:true}` per `server @var` whose structured fields equal
 * the default parser's (the input the §8.11 collector gates on). §2–§4 keep the
 * mount-hydrate output assertions on the default pipeline.
 *
 * SCOPE: the `server @var` form + the mount-hydrate output it enables. The
 * SPLIT follow-on root causes (sql-loop-hoist, tableFor clientJs drift,
 * reactivity-grammar debounced/throttled, server-eq residual) are NOT covered
 * here — see docs/changes/m67-phase-a-flag-flip/c2-codegen-output.md.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { nativeAst, liveAst, findNodes, withoutPositions, errorsOf } from "../helpers/native-ast.js";

// Compile `source` through the default pipeline; return { live } with
// { serverJs, clientJs, html, errs }. (Name kept from the two-pipeline era.)
function compileBoth(source) {
  const out = {};
  for (const parser of [null]) {
    const dir = mkdtempSync(join(tmpdir(), "m67-c2-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    try {
      const r = compileScrml({ inputFiles: [file], outputDir: null, write: false, log: () => {} });
      let serverJs = "", clientJs = "", html = "";
      for (const [, v] of (r.outputs ?? [])) {
        serverJs += v.serverJs ?? "";
        clientJs += v.clientJs ?? "";
        html += v.html ?? "";
      }
      const errs = (r.errors ?? []).filter((e) => e && e.severity !== "warning").map((e) => e.code);
      out[parser ?? "live"] = { serverJs, clientJs, html, errs };
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }
  return out;
}

// The §8.11 canonical 2-callable-server-@var coalescing source.
const MH2 = [
  '<program db="test.db">',
  "${ server function loadA() { return 1 } }",
  "${ server function loadB() { return 2 } }",
  "${ server @a = loadA() }",
  "${ server @b = loadB() }",
  "</>",
].join("\n");

// ---------------------------------------------------------------------------
// §1 — native no longer hard-errors on `server @var`
// ---------------------------------------------------------------------------

describe("§1 native parses `server @var = expr` without a parse-error cascade", () => {
  test("nativeParseFile: no E-EXPR-UNEXPECTED / E-STMT-MISSING-SEMICOLON / E-STMT-UNEXPECTED-TOKEN", () => {
    const codes = errorsOf(nativeAst(MH2)).map((e) => e.code);
    expect(codes).not.toContain("E-EXPR-UNEXPECTED");
    expect(codes).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(codes).not.toContain("E-STMT-UNEXPECTED-TOKEN");
    expect(codes).toEqual([]);
  });

  test("nativeParseFile: one state-decl{isServer:true} per `server @var`, matching the default parser", () => {
    const pick = (r) => findNodes(r.ast, (n) => n.kind === "state-decl").map((n) => ({
      name: n.name, isServer: n.isServer, structuralForm: n.structuralForm, shape: n.shape,
      initExpr: withoutPositions(n.initExpr),
    }));
    const nat = pick(nativeAst(MH2));
    expect(nat.map((d) => [d.name, d.isServer])).toEqual([["a", true], ["b", true]]);
    expect(nat).toEqual(pick(liveAst(MH2)));
  });

  test("the canonical source is error-clean on the default pipeline", () => {
    expect(compileBoth(MH2).live.errs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — §8.11 mount-hydrate server-side output parity
// ---------------------------------------------------------------------------

describe("§2 mount-hydrate server JS", () => {
  test("synthetic __mountHydrate route emitted", () => {
    const r = compileBoth(MH2);
    for (const needle of [
      "_scrml_route___mountHydrate",
      'path: "/__mountHydrate"',
      'method: "POST"',
      "Promise.all",
    ]) {
      expect(r.live.serverJs).toContain(needle);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — §8.11 mount-hydrate client-side output parity
// ---------------------------------------------------------------------------

describe("§3 mount-hydrate client JS", () => {
  test("unified fetch + demux + coalesced comment emitted", () => {
    const r = compileBoth(MH2);
    for (const needle of [
      'fetch("/__mountHydrate"',
      '_scrml_cs_reactive_set("a", _scrml_mh_json["a"])',
      '_scrml_cs_reactive_set("b", _scrml_mh_json["b"])',
      "coalesced via /__mountHydrate",
    ]) {
      expect(r.live.clientJs).toContain(needle);
    }
  });

  test("per-var initial-load IIFE comments suppressed", () => {
    const r = compileBoth(MH2);
    expect(r.live.clientJs).not.toContain("server @a — initial load on mount");
    expect(r.live.clientJs).not.toContain("server @b — initial load on mount");
  });
});

// ---------------------------------------------------------------------------
// §4 — 3-callable-server-@var → all three keys coalesced (native == live)
// ---------------------------------------------------------------------------

describe("§4 three callable server @var coalesce", () => {
  const MH3 = [
    '<program db="test.db">',
    "${ server function loadA() { return 1 } }",
    "${ server function loadB() { return 2 } }",
    "${ server function loadC() { return 3 } }",
    "${ server @a = loadA() }",
    "${ server @b = loadB() }",
    "${ server @c = loadC() }",
    "</>",
  ].join("\n");

  test("server response object has all three keys", () => {
    const r = compileBoth(MH3);
    for (const needle of ['"a": _scrml_mh_v0', '"b": _scrml_mh_v1', '"c": _scrml_mh_v2']) {
      expect(r.live.serverJs).toContain(needle);
    }
  });
});
