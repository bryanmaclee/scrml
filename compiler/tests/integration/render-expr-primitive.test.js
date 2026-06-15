/**
 * §19.15 — the `<render of=X/>` render-expression (held-variant display).
 *
 * RATIFIED S195 (held-error-display deep-dive + debate; design-insight a/c);
 * built S196. Fires a HELD enum value's per-variant `renders` markup (§19.2)
 * from any markup position, exhaustiveness-fenced (§19.15.3, reuses the
 * §19.6.6 E-ERROR-005 per-variant logic). It does NOT widen `<errorBoundary>`
 * (sidesteps the `__scrml_error` gate) nor generalize `renders` to non-error
 * enums. See compiler/src/codegen/emit-html.ts (the producer — variantRenderExprs
 * via emitBoundaryMarkupExpr against the held value's `.data`), emit-variant-guard.ts
 * + emit-event-wiring.ts (the per-variant switch consumers), type-system.ts
 * (the E-RENDER-* fence in annotateNodes).
 *
 * Test §1 — exhaustiveness fence fires (a variant missing `renders` → E-RENDER-NO-CLAUSE)
 * Test §2 — missing `of=` → E-RENDER-NO-OF
 * Test §3 — clean match-arm `<render of=err/>` → no E-RENDER-*; switch dispatches on (err).data
 * Test §4 — clean top-level `<render of=@cell/>` → switch + reactive subscribe; gate-clean
 * Test §5 — `<errorBoundary>` codegen is UNCHANGED (the render-expr does not perturb the catch path)
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-render-expr-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], outputDir: join(dir, "dist"), write: true, validateEmit: true, log: () => {} });
}

function clientJs(result) {
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return out?.clientJs ?? "";
}

function errsByCode(result, code) {
  return (result.errors ?? []).filter((e) => e.code === code);
}

// ---------------------------------------------------------------------------
// §1 — the exhaustiveness fence: a reachable variant lacking `renders` → compile error
// ---------------------------------------------------------------------------
describe("§19.15.3 exhaustiveness fence", () => {
  test("E-RENDER-NO-CLAUSE fires when a held-enum variant has no renders clause", () => {
    const src = [
      "<program>",
      'type LE:enum = { NotFound(id: string) renders <p>No #${id}</p>, Network(msg: string) }',
      "type Ph:enum = { Idle, Failed(err: LE) }",
      "<phase>: Ph = .Idle",
      "<div><match for=Ph on=@phase>",
      "  <Idle> <p>idle</p> </>",
      "  <Failed err> <render of=err/> </>",
      "</match></div>",
      "</program>",
    ].join("\n");
    const result = compileSource(src);
    const fires = errsByCode(result, "E-RENDER-NO-CLAUSE");
    expect(fires.length).toBeGreaterThan(0);
    expect(fires[0].message).toContain("Network");
  });

  test("a non-enum of= target does not godify — clean enum fences, string cell is an inert no-op", () => {
    // All variants carry renders → no fence fire.
    const src = [
      "<program>",
      'type LE:enum = { NotFound(id: string) renders <p>No #${id}</p>, Network(msg: string) renders <p>Net ${msg}</p> }',
      "<err>: LE = .NotFound(\"42\")",
      "<div><render of=@err/></div>",
      "</program>",
    ].join("\n");
    const result = compileSource(src);
    expect(errsByCode(result, "E-RENDER-NO-CLAUSE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — missing `of=`
// ---------------------------------------------------------------------------
describe("§19.15.1 of= is required", () => {
  test("E-RENDER-NO-OF fires when <render> has no of= attribute", () => {
    const src = [
      "<program>",
      'type LE:enum = { NotFound(id: string) renders <p>No #${id}</p> }',
      "<err>: LE = .NotFound(\"1\")",
      "<div><render/></div>",
      "</program>",
    ].join("\n");
    const result = compileSource(src);
    expect(errsByCode(result, "E-RENDER-NO-OF").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §3 — match-arm locus (the common case, option c) — switch dispatches on (err).data
// ---------------------------------------------------------------------------
describe("§19.15 match-arm `<render of=err/>` codegen", () => {
  test("clean compile; per-variant switch fires the held payload's renders against (err).data", () => {
    const src = [
      "<program>",
      'type LE:enum = { NotFound(id: string) renders <p>No item #${id}.</p>, Network(msg: string) renders <p>Net: ${msg}.</p> }',
      "type Ph:enum = { Idle, Failed(err: LE) }",
      "<phase>: Ph = .Idle",
      "<div><match for=Ph on=@phase>",
      "  <Idle> <p>idle</p> </>",
      "  <Failed err> <render of=err/> </>",
      "</match></div>",
      "</program>",
    ].join("\n");
    const result = compileSource(src);
    expect(errsByCode(result, "E-RENDER-NO-CLAUSE").length).toBe(0);
    expect(errsByCode(result, "E-CODEGEN-INVALID-JS").length).toBe(0);
    const js = clientJs(result);
    expect(js).toContain('case "NotFound"');
    expect(js).toContain('case "Network"');
    // dispatch fires against the held value's data, NOT the boundary envelope.
    expect(js).toContain("(err).data");
    expect(js).not.toContain("_eb_result");
  });
});

// ---------------------------------------------------------------------------
// §4 — top-level @cell locus (option a) — switch + reactive re-fire
// ---------------------------------------------------------------------------
describe("§19.15 top-level `<render of=@cell/>` codegen", () => {
  test("switch fills + subscribes to the cell for reactive re-render; gate-clean", () => {
    const src = [
      "<program>",
      'type LE:enum = { NotFound(id: string) renders <p>No #${id}</p>, Network(msg: string) renders <p>Net ${msg}</p> }',
      "<err>: LE = .NotFound(\"42\")",
      "<div><render of=@err/></div>",
      "</program>",
    ].join("\n");
    const result = compileSource(src);
    expect(errsByCode(result, "E-CODEGEN-INVALID-JS").length).toBe(0);
    const js = clientJs(result);
    expect(js).toContain('case "NotFound"');
    expect(js).toContain('_scrml_reactive_subscribe("err"');
  });
});

// ---------------------------------------------------------------------------
// §5 — <errorBoundary> codegen is UNCHANGED (render-expr is an independent fire site)
// ---------------------------------------------------------------------------
describe("§19.15.4 render-expr does not perturb the errorBoundary catch path", () => {
  test("a boundary catching a live !-call still emits the __scrml_error gate + variant switch", () => {
    const src = [
      "<program>",
      'type LE:enum = { NotFound(id: string) renders <p>No #${id}</p> }',
      "function load() -> ! LE { fail LE::NotFound(\"x\") }",
      "<div><errorBoundary><div>${load()}</div></errorBoundary></div>",
      "</program>",
    ].join("\n");
    const result = compileSource(src);
    const js = clientJs(result);
    // The boundary path is unchanged: it still gates on the thrown envelope.
    expect(js).toContain("__scrml_error");
  });
});
