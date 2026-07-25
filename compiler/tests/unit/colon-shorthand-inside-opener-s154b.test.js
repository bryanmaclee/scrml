/**
 * colon-shorthand-inside-opener-s154b.test.js — S160 (S154 design ruling (b)).
 *
 * Inside-opener `:`-shorthand placement is canonical EVERYWHERE; the legacy
 * after-`>` placement is DEPRECATED (W-COLON-SHORTHAND-LEGACY-PLACEMENT).
 *
 * SPEC §4.14 (S160 amendment):
 *   - The `:`-shorthand body opens INSIDE the opener — the `:` follows the last
 *     attribute, the body runs to the `>` that terminates the opener. This is
 *     the single canonical placement in EVERY locus (HTML §24, `<each>` §17.7.6,
 *     match block-form arms §18.0.1, engine state-children §51.0.I).
 *   - Whitespace AFTER the `:` is OPTIONAL (`<span :@thing>` legal; only
 *     BEFORE-`:` whitespace is required).
 *   - The legacy AFTER-`>` placement (`<Variant> : expr`) parses identically
 *     during the deprecation window and surfaces an info-level lint.
 *   - The `>` terminator is angleDepth- and string-aware (§4.14 line 984): a `>`
 *     inside a string literal or nested markup-as-value body is opaque.
 *
 * Implementation (S154 ruling (b)):
 *   - engine-statechild-parser.ts: `findInsideOpenerColonPos` locates the
 *     inside-opener `:`; `parseEngineStateChildren` splits the opener into the
 *     attribute region (before `:`) and the single-expression body (after `:`,
 *     through `openerEnd`). `findOpenerEnd` gains angleDepth so a nested
 *     markup-as-value `>` inside the body does not truncate the opener. The
 *     legacy after-`>` form is retained and marked `legacyColonPlacement`.
 *   - match-statechild-parser.ts: `scanOpenerAttrs` detects the inside-opener
 *     `:` body-introducer and scans to the opener `>` via `scanToOpenerClose`
 *     (string-/`${}`-/angleDepth-aware). The legacy after-`>` form is retained
 *     and marked `legacyColonPlacement`.
 *   - symbol-table.ts: `validateEngineStateChildrenAndRules` +
 *     `validateMatchBlock` emit `W-COLON-SHORTHAND-LEGACY-PLACEMENT` (info) at
 *     after-`>` sites.
 *
 * ZERO codegen change: all placements build an identical AST and emit identical
 * JS (proven byte-identical here for the match locus).
 *
 * Coverage:
 *   §1 — engine parser: inside-opener parses; AST fields match after-`>`.
 *   §2 — match parser: inside-opener parses; AST fields match after-`>`.
 *   §3 — after-`>` (space + no-space) still parses + sets `legacyColonPlacement`.
 *   §4 — after-`:` whitespace optional (`:@thing` / `:"x"`).
 *   §5 — worst-case string-awareness (`<LengthFailed("(>=2)") : "...">`).
 *   §6 — payload-binding + multi-target-rule before `:`.
 *   §7 — markup-as-value body (angleDepth) does not truncate the opener.
 *   §8 — E2E: inside-opener match compiles clean; after-`>` fires the W-lint;
 *        emitted JS is byte-identical (AST-identity / zero-codegen).
 *   §9 — self-closing + bare-body forms unaffected (regression).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseEngineStateChildren } from "../../src/engine-statechild-parser.ts";
import { parseMatchArms } from "../../src/match-statechild-parser.ts";
import { compileScrml } from "../../src/api.js";
import { rewriteColonShorthandPlacement } from "../../src/commands/migrate.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "s154b-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function realErrors(result) {
  return (result.errors || []).filter((e) => e && e.severity !== "warning" && e.severity !== "info");
}
function allDiagnostics(result) { return [...(result.errors || []), ...(result.warnings || [])]; }
function hasCode(result, code) { return allDiagnostics(result).some((d) => d && d.code === code); }
function countCode(result, code) { return allDiagnostics(result).filter((d) => d && d.code === code).length; }
function getOut(result, key) {
  const outputs = result.outputs;
  if (!outputs) return "";
  for (const [, v] of outputs) { if (v && typeof v === "object" && v[key]) return v[key]; }
  return "";
}
function getClientJs(result) { return foldChunkNamespacing(getOut(result, "clientJs")); }
// Normalize gensym counters + per-file client-js script name so two
// STRUCTURALLY identical lowerings compare equal modulo placeholder ids.
// The chunk-namespace token is STRIPPED first: these two fixtures are written to
// different temp paths on purpose, so their tokens differ by construction and
// would otherwise swamp the structural comparison this test exists to make.
// A token is exactly `0` + 7 base36 chars + `_`; anchoring on that leading `0`
// is load-bearing. The unanchored `_[0-9a-z]{8}_(\d+)` form this replaces
// rewrote `_scrml_reactive_1` to `_scrml_NS_1` — which the NEXT pass could no
// longer collapse to `_scrml_GEN`, so a structural-identity test silently became
// sensitive to the counter drift it exists to ignore.
function norm(s) {
  return String(s)
    .replace(/(?<![0-9a-z])0[0-9a-z]{7}_(?=[0-9A-Za-z_])/g, "")
    .replace(/_scrml_[a-z_]+_\d+/g, "_scrml_GEN")
    .replace(/[A-Za-z0-9_-]+\.client\.js/g, "GEN.client.js");
}

// ---------------------------------------------------------------------------
// §1 — engine parser: inside-opener parses; AST-equal to after-`>`
// ---------------------------------------------------------------------------
describe("§1 engine parser — inside-opener `:`-shorthand", () => {
  test("inside-opener parses with the body, rule, and payload extracted", () => {
    const entries = parseEngineStateChildren(`
      <Small rule=.Big : "small">
      <Big rule=(.Fire | .Small) : "big">
      <Fire rule=.Small : "fire">
    `);
    expect(entries.length).toBe(3);
    expect(entries[0].tag).toBe("Small");
    expect(entries[0].isColonShorthand).toBe(true);
    expect(entries[0].legacyColonPlacement).toBe(false);
    expect(entries[0].bodyRaw.trim()).toBe('"small"');
    expect(entries[0].rule).toEqual({ kind: "single", target: "Big" });
    expect(entries[1].rule).toEqual({ kind: "multi", targets: ["Fire", "Small"] });
    expect(entries[2].bodyRaw.trim()).toBe('"fire"');
  });

  test("inside-opener and after-`>` produce identical entry fields (sans placement flag)", () => {
    const inside = parseEngineStateChildren(`<Small rule=.Big : "small">`);
    const after = parseEngineStateChildren(`<Small rule=.Big> : "small"`);
    expect(inside.length).toBe(1);
    expect(after.length).toBe(1);
    expect(inside[0].tag).toBe(after[0].tag);
    expect(inside[0].isColonShorthand).toBe(after[0].isColonShorthand);
    expect(inside[0].bodyRaw.trim()).toBe(after[0].bodyRaw.trim());
    expect(inside[0].rule).toEqual(after[0].rule);
    // The only observable difference is the placement flag.
    expect(inside[0].legacyColonPlacement).toBe(false);
    expect(after[0].legacyColonPlacement).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — match parser: inside-opener parses; AST-equal to after-`>`
// ---------------------------------------------------------------------------
describe("§2 match parser — inside-opener `:`-shorthand", () => {
  test("inside-opener parses as a shorthand arm", () => {
    const { arms, diagnostics } = parseMatchArms(`
      <Small : "small">
      <Big : "big">
    `);
    expect(diagnostics.length).toBe(0);
    expect(arms.length).toBe(2);
    expect(arms[0].variantName).toBe("Small");
    expect(arms[0].bodyForm).toBe("shorthand");
    expect(arms[0].bodyRaw).toBe('"small"');
    expect(arms[0].legacyColonPlacement).toBeFalsy();
  });

  test("inside-opener and after-`>` produce identical arm fields (sans placement flag)", () => {
    const inside = parseMatchArms(`<Small : "small">`).arms;
    const after = parseMatchArms(`<Small> : "small"`).arms;
    expect(inside.length).toBe(1);
    expect(after.length).toBe(1);
    expect(inside[0].variantName).toBe(after[0].variantName);
    expect(inside[0].bodyForm).toBe(after[0].bodyForm);
    expect(inside[0].bodyRaw).toBe(after[0].bodyRaw);
    expect(inside[0].legacyColonPlacement).toBeFalsy();
    expect(after[0].legacyColonPlacement).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — after-`>` (space + no-space) still parses + marks legacy placement
// ---------------------------------------------------------------------------
describe("§3 legacy after-`>` placement — still parses (deprecation window)", () => {
  test("engine after-`>` space form parses with legacyColonPlacement", () => {
    const entries = parseEngineStateChildren(`<Small rule=.Big> : "small"`);
    expect(entries[0].isColonShorthand).toBe(true);
    expect(entries[0].legacyColonPlacement).toBe(true);
  });

  test("engine after-`>` NO-SPACE `>:` form parses with legacyColonPlacement", () => {
    const entries = parseEngineStateChildren(`<Idle rule=.Loading>: "idle"`);
    expect(entries[0].isColonShorthand).toBe(true);
    expect(entries[0].legacyColonPlacement).toBe(true);
    expect(entries[0].bodyRaw.trim()).toBe('"idle"');
  });

  test("match after-`>` form parses with legacyColonPlacement", () => {
    const { arms } = parseMatchArms(`<Small> : "small"`);
    expect(arms[0].bodyForm).toBe("shorthand");
    expect(arms[0].legacyColonPlacement).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — after-`:` whitespace OPTIONAL
// ---------------------------------------------------------------------------
describe("§4 after-`:` whitespace optional", () => {
  test("engine `:@thing` (no after-`:` ws) parses; body matches `: @thing`", () => {
    const noWs = parseEngineStateChildren(`<Small rule=.Big :"small">`);
    const ws = parseEngineStateChildren(`<Small rule=.Big : "small">`);
    expect(noWs[0].isColonShorthand).toBe(true);
    expect(noWs[0].bodyRaw.trim()).toBe('"small"');
    expect(noWs[0].bodyRaw.trim()).toBe(ws[0].bodyRaw.trim());
  });

  test("match `:@thing` (no after-`:` ws) parses; body matches `: @thing`", () => {
    const noWs = parseMatchArms(`<Small :"small">`).arms;
    const ws = parseMatchArms(`<Small : "small">`).arms;
    expect(noWs[0].bodyForm).toBe("shorthand");
    expect(noWs[0].bodyRaw).toBe('"small"');
    expect(noWs[0].bodyRaw).toBe(ws[0].bodyRaw);
  });
});

// ---------------------------------------------------------------------------
// §5 — worst-case string-awareness: `>` inside a quoted pattern arg is opaque
// ---------------------------------------------------------------------------
describe("§5 worst-case string-awareness (`(>=2)` inside a quoted arg)", () => {
  test("engine `<LengthFailed(\"(>=2)\") : \"...\">` finds the FINAL `>`", () => {
    const entries = parseEngineStateChildren(`<LengthFailed("(>=2)") : "Name must be at least 2 characters">`);
    expect(entries.length).toBe(1);
    expect(entries[0].tag).toBe("LengthFailed");
    expect(entries[0].isColonShorthand).toBe(true);
    expect(entries[0].bodyRaw.trim()).toBe('"Name must be at least 2 characters"');
  });

  test("match `<LengthFailed(\"(>=2)\") : \"...\">` parses; body is the full string", () => {
    const { arms, diagnostics } = parseMatchArms(`<LengthFailed("(>=2)") : "Name must be at least 2 characters">`);
    expect(diagnostics.length).toBe(0);
    expect(arms.length).toBe(1);
    expect(arms[0].variantName).toBe("LengthFailed");
    expect(arms[0].payloadBindingsRaw).toBe('"(>=2)"');
    expect(arms[0].bodyRaw).toBe('"Name must be at least 2 characters"');
  });
});

// ---------------------------------------------------------------------------
// §6 — payload-binding + multi-target rule before the `:`
// ---------------------------------------------------------------------------
describe("§6 payload-binding + multi-target rule before `:`", () => {
  test("engine `<Done count : \"...\">` binds the payload before the body", () => {
    const entries = parseEngineStateChildren(`<Done count : "got it">`);
    expect(entries[0].tag).toBe("Done");
    expect(entries[0].isColonShorthand).toBe(true);
    expect(entries[0].payloadBindings).toEqual([{ kind: "positional", name: "count" }]);
    expect(entries[0].bodyRaw.trim()).toBe('"got it"');
  });

  test("engine `<Big rule=(.Fire | .Small) : \"...\">` parses the paren rule before `:`", () => {
    const entries = parseEngineStateChildren(`<Big rule=(.Fire | .Small) : "big">`);
    expect(entries[0].rule).toEqual({ kind: "multi", targets: ["Fire", "Small"] });
    expect(entries[0].bodyRaw.trim()).toBe('"big"');
  });

  test("match `<Ready(rows) : \"...\">` binds the parenthesized payload before `:`", () => {
    const { arms } = parseMatchArms(`<Ready(rows) : "ready">`);
    expect(arms[0].variantName).toBe("Ready");
    expect(arms[0].payloadBindingsRaw).toBe("rows");
    expect(arms[0].bodyRaw).toBe('"ready"');
  });
});

// ---------------------------------------------------------------------------
// §7 — markup-as-value body (angleDepth) does not truncate the opener
// ---------------------------------------------------------------------------
describe("§7 markup-as-value inside-opener body (angleDepth, §4.14 line 984)", () => {
  test("engine `<Idle rule=.Loading : <button>Load</button>>` captures the full body", () => {
    const entries = parseEngineStateChildren(`<Idle rule=.Loading : <button onclick=load()>Load</button>>`);
    expect(entries.length).toBe(1);
    expect(entries[0].isColonShorthand).toBe(true);
    expect(entries[0].bodyRaw.trim()).toBe("<button onclick=load()>Load</button>");
  });

  test("match `<Small : <span>still small</span>>` captures the full nested markup body", () => {
    const { arms } = parseMatchArms(`<Small : <span>still small</span>>`);
    expect(arms.length).toBe(1);
    expect(arms[0].bodyForm).toBe("shorthand");
    expect(arms[0].bodyRaw).toBe("<span>still small</span>");
  });
});

// ---------------------------------------------------------------------------
// §8 — E2E: inside-opener compiles clean; after-`>` fires W-lint; BYTE-IDENTICAL
// ---------------------------------------------------------------------------
describe("§8 E2E match block — inside vs after-`>` (AST-identity / zero-codegen)", () => {
  const inside = `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready }
        <phase>: Phase = .Idle
    }
    <match for=Phase on=@phase>
        <Idle : "Press to load">
        <Loading : "Loading now">
        <Ready : "All set">
    </match>
</div>`;
  const after = `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready }
        <phase>: Phase = .Idle
    }
    <match for=Phase on=@phase>
        <Idle> : "Press to load"
        <Loading> : "Loading now"
        <Ready> : "All set"
    </match>
</div>`;

  test("inside-opener match compiles with NO real errors and NO legacy lint", () => {
    const res = compile("e2e-inside.scrml", inside);
    expect(realErrors(res)).toEqual([]);
    expect(hasCode(res, "W-COLON-SHORTHAND-LEGACY-PLACEMENT")).toBe(false);
  });

  test("after-`>` match compiles AND fires the legacy-placement lint per arm", () => {
    const res = compile("e2e-after.scrml", after);
    expect(realErrors(res)).toEqual([]);
    // One lint per legacy-placed arm (3 arms).
    expect(countCode(res, "W-COLON-SHORTHAND-LEGACY-PLACEMENT")).toBe(3);
  });

  test("inside-opener and after-`>` emit BYTE-IDENTICAL client JS (normalized)", () => {
    const jsInside = getClientJs(compile("bi-inside.scrml", inside));
    const jsAfter = getClientJs(compile("bi-after.scrml", after));
    expect(jsInside.length).toBeGreaterThan(0);
    expect(norm(jsInside)).toBe(norm(jsAfter));
  });
});

// ---------------------------------------------------------------------------
// §9 — self-closing + bare-body forms unaffected (regression)
// ---------------------------------------------------------------------------
describe("§9 self-closing + bare-body unaffected (regression)", () => {
  test("engine self-close stays self-close (no colon shorthand)", () => {
    const entries = parseEngineStateChildren(`<Small rule=.Big/>`);
    expect(entries[0].isColonShorthand).toBe(false);
    expect(entries[0].legacyColonPlacement).toBe(false);
    expect(entries[0].bodyRaw).toBe("");
  });

  test("engine bare-body stays bare-body (nested markup preserved)", () => {
    const entries = parseEngineStateChildren(`<Idle rule=.Loading><button onclick=load()>Load</button></>`);
    expect(entries[0].isColonShorthand).toBe(false);
    expect(entries[0].legacyColonPlacement).toBe(false);
    expect(entries[0].bodyRaw).toBe("<button onclick=load()>Load</button>");
  });

  test("match bare-body + self-close unaffected", () => {
    const bare = parseMatchArms(`<NotAsked><p>Press to load.</p></>`).arms;
    expect(bare[0].bodyForm).toBe("bare-body");
    expect(bare[0].legacyColonPlacement).toBeFalsy();
    const self = parseMatchArms(`<Small/>`).arms;
    expect(self[0].bodyForm).toBe("self-closing");
  });
});

// ---------------------------------------------------------------------------
// §10 — `migrate --fix` rewrites after-`>` → inside-opener (AST-driven)
// ---------------------------------------------------------------------------
describe("§10 migrate --fix — after-`>` → inside-opener", () => {
  const after = `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready }
        <phase>: Phase = .Idle
    }
    <match for=Phase on=@phase>
        <Idle> : "Press to load"
        <Loading> : "Loading now"
        <Ready> : "All set"
    </match>
</div>`;

  test("rewrites every legacy after-`>` arm to inside-opener", () => {
    const r = rewriteColonShorthandPlacement(after, "m.scrml");
    expect(r.changed).toBe(true);
    expect(r.count).toBe(3);
    expect(r.rewritten).toContain(`<Idle : "Press to load">`);
    expect(r.rewritten).toContain(`<Loading : "Loading now">`);
    expect(r.rewritten).toContain(`<Ready : "All set">`);
    // No after-`>` placement remains.
    expect(r.rewritten).not.toContain(`<Idle> : `);
  });

  test("the rewrite is idempotent (already-canonical source is a no-op)", () => {
    const once = rewriteColonShorthandPlacement(after, "m.scrml").rewritten;
    const twice = rewriteColonShorthandPlacement(once, "m.scrml");
    expect(twice.changed).toBe(false);
    expect(twice.count).toBe(0);
    expect(twice.rewritten).toBe(once);
  });

  test("the rewritten source compiles with NO legacy lint and is byte-identical", () => {
    const rewritten = rewriteColonShorthandPlacement(after, "m.scrml").rewritten;
    const resBefore = compile("mig-before.scrml", after);
    const resAfter = compile("mig-after.scrml", rewritten);
    expect(realErrors(resAfter)).toEqual([]);
    expect(hasCode(resAfter, "W-COLON-SHORTHAND-LEGACY-PLACEMENT")).toBe(false);
    // The migrated source emits the same JS as the original legacy source.
    expect(norm(getClientJs(resAfter))).toBe(norm(getClientJs(resBefore)));
  });

  test("a worst-case string arg + markup-as-value body survive the rewrite", () => {
    // `(>=2)` inside a string arg; the `>` must not be mistaken for the opener.
    const src = `<div>
    \${
        type V:enum = { Required, LengthFailed, Ok }
        <v>: V = .Required
    }
    <match for=V on=@v>
        <Required> : "Name is required"
        <LengthFailed> : "Name must be at least 2 characters (>=2)"
        <Ok> : "looks good"
    </match>
</div>`;
    const r = rewriteColonShorthandPlacement(src, "w.scrml");
    expect(r.changed).toBe(true);
    expect(r.rewritten).toContain(`<LengthFailed : "Name must be at least 2 characters (>=2)">`);
    expect(realErrors(compile("w-out.scrml", r.rewritten))).toEqual([]);
  });
});
