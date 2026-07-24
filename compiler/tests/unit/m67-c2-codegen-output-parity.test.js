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
 * These tests DRIVE BOTH PIPELINES (live `parser:null` + `parser:"scrml-native"`)
 * and assert PARITY. They are LOAD-BEARING: each must FAIL without the fix
 * (native previously emitted parse errors + no mount-hydrate output).
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

// Compile `source` under both pipelines; return { live, "scrml-native" } each
// with { serverJs, clientJs, html, errs }.
function compileBoth(source) {
  const out = {};
  for (const parser of [null, "scrml-native"]) {
    const dir = mkdtempSync(join(tmpdir(), "m67-c2-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    try {
      const r = compileScrml({ inputFiles: [file], outputDir: null, write: false, log: () => {}, parser });
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
  test("no E-EXPR-UNEXPECTED / E-STMT-MISSING-SEMICOLON / E-STMT-UNEXPECTED-TOKEN under native", () => {
    const r = compileBoth(MH2);
    // The pre-fix native cascade is gone.
    expect(r["scrml-native"].errs).not.toContain("E-EXPR-UNEXPECTED");
    expect(r["scrml-native"].errs).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r["scrml-native"].errs).not.toContain("E-STMT-UNEXPECTED-TOKEN");
  });

  test("native error profile matches live (no spurious errors introduced)", () => {
    const r = compileBoth(MH2);
    expect(r["scrml-native"].errs.sort()).toEqual(r.live.errs.sort());
    expect(r.live.errs).toEqual([]); // canonical source is error-clean on live
  });
});

// ---------------------------------------------------------------------------
// §2 — §8.11 mount-hydrate server-side output parity
// ---------------------------------------------------------------------------

describe("§2 mount-hydrate server JS parity (native == live)", () => {
  test("synthetic __mountHydrate route emitted under native", () => {
    const r = compileBoth(MH2);
    for (const needle of [
      "_scrml_route___mountHydrate",
      'path: "/__mountHydrate"',
      'method: "POST"',
      "Promise.all",
    ]) {
      expect(r.live.serverJs).toContain(needle);          // sanity: live emits it
      expect(r["scrml-native"].serverJs).toContain(needle); // load-bearing: native too
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — §8.11 mount-hydrate client-side output parity
// ---------------------------------------------------------------------------

describe("§3 mount-hydrate client JS parity (native == live)", () => {
  test("unified fetch + demux + coalesced comment emitted under native", () => {
    const r = compileBoth(MH2);
    for (const needle of [
      'fetch("/__mountHydrate"',
      '_scrml_reactive_set("a", _scrml_mh_json["a"])',
      '_scrml_reactive_set("b", _scrml_mh_json["b"])',
      "coalesced via /__mountHydrate",
    ]) {
      expect(r.live.clientJs).toContain(needle);
      expect(r["scrml-native"].clientJs).toContain(needle);
    }
  });

  test("per-var initial-load IIFE comments suppressed under native (as live)", () => {
    const r = compileBoth(MH2);
    expect(r["scrml-native"].clientJs).not.toContain("server @a — initial load on mount");
    expect(r["scrml-native"].clientJs).not.toContain("server @b — initial load on mount");
    expect(r.live.clientJs).not.toContain("server @a — initial load on mount");
  });
});

// ---------------------------------------------------------------------------
// §4 — 3-callable-server-@var → all three keys coalesced (native == live)
// ---------------------------------------------------------------------------

describe("§4 three callable server @var coalesce identically under native", () => {
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

  test("server response object has all three keys under native", () => {
    const r = compileBoth(MH3);
    for (const needle of ['"a": _scrml_mh_v0', '"b": _scrml_mh_v1', '"c": _scrml_mh_v2']) {
      expect(r.live.serverJs).toContain(needle);
      expect(r["scrml-native"].serverJs).toContain(needle);
    }
  });
});
