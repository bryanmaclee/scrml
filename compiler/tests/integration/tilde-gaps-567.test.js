/**
 * Regression tests — `~` (last-unbound-expression carry-forward) codegen Gaps 5/6/7.
 *
 * The S94 codegen-lowering dispatch landed `~` for the smoke + bound-consume +
 * function-body shapes. Three follow-up gaps remained (docs/changes/tilde-codegen/FOLLOWUPS.md):
 *
 *   Gap 5 — `~` after a `!{}` failable-handler doesn't lower; `case "guarded-expr"`
 *           did not wire `opts.tildeContext.var = resultVar` after emitting, so
 *           subsequent `~` refs fell through emit-expr's tildeVar=null arm and
 *           emitted literal `~`.
 *
 *   Gap 6 — `~`-bearing text at `<program>` / `<page>` / `<channel>` direct
 *           child position silently dropped when a JS line comment (`//`) split
 *           the program-body text region. The text fragment after the comment
 *           failed BARE_DECL_RE (doesn't start with a decl keyword) and stayed
 *           as a TEXT node.
 *
 *   Gap 7 — pure consume+reinit chain self-referenced. `case "bare-expr"`
 *           overwrote `opts.tildeContext.var = tVar` BEFORE constructing the
 *           expr ctx via _makeExprCtx, so `~` inside the bare-expr's RHS
 *           resolved to its OWN initializer's var name.
 *
 * The fixes are documented in docs/changes/tilde-gaps-567/SURVEY.md.
 */

import { describe, expect, test } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compileSource(src, fname = "tilde-gaps-fixture.scrml") {
  const dir = mkdtempSync(join(tmpdir(), "tilde-gaps-"));
  const inputPath = join(dir, fname);
  writeFileSync(inputPath, src, "utf-8");
  const result = compileScrml({
    inputFiles: [inputPath],
    outputDir: dir,
    write: true,
    log: () => {},
  });
  const base = fname.replace(/\.scrml$/, "");
  const clientPath = join(dir, `${base}.client.js`);
  let clientJs = "";
  try { clientJs = readFileSync(clientPath, "utf-8"); } catch { /* file may not exist on errors */ }
  return {
    clientJs,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    dir,
  };
}

function runClientJs(clientJs, finalExpression) {
  const shims = `
    const _scrml_reactive_get = () => undefined;
    const _scrml_derived_get = () => undefined;
    const _scrml_reactive_set = () => {};
    const _scrml_effect = () => {};
    const _scrml_effect_static = () => {};
    const _scrml_lift = () => {};
    const _scrml_derived_declare = () => {};
    const _scrml_derived_subscribe = () => {};
    const _scrml_default_set = () => {};
    const _scrml_init_set = () => {};
  `;
  const fn = new Function(shims + "\n" + clientJs + "\n" + `return (${finalExpression});`);
  return fn();
}

describe("tilde (~) Gap 7 — pure consume+reinit no longer self-references", () => {
  test("two-link consume+reinit chain — RHS uses PREVIOUS tilde var", () => {
    const src = [
      "function step1(n: number) -> number { return n + 10 }",
      "function step2(n: number) -> number { return n * 3 }",
      "",
      "${",
      "  step1(2)",
      "  step2(~)",
      "  const final = ~",
      "}",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);

    // The bug shape: `let _scrml_tilde_8 = _scrml_step2_5(_scrml_tilde_8);` — self-ref
    // Fix: each bare-expr's RHS references the PREVIOUS tilde var, not itself.
    const tildeAssigns = [...clientJs.matchAll(/let (_scrml_tilde_\d+) = .*?\((_scrml_tilde_\d+)\)/g)];
    for (const m of tildeAssigns) {
      expect(m[1]).not.toBe(m[2]); // LHS name must differ from RHS arg name
    }

    // Runnable: step1(2)=12, step2(12)=36, final=36
    const value = runClientJs(clientJs, "final");
    expect(value).toBe(36);
  });

  test("three-link chain — each link consumes prev and rebinds", () => {
    const src = [
      "function inc(n: number) -> number { return n + 1 }",
      "function dbl(n: number) -> number { return n * 2 }",
      "function neg(n: number) -> number { return -n }",
      "",
      "${",
      "  inc(5)",
      "  dbl(~)",
      "  neg(~)",
      "  const result = ~",
      "}",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);

    // No literal `~` left in output (consuming-position regex)
    expect(clientJs).not.toMatch(/[(=,]\s*~\s*[),]/);

    // Runnable: inc(5)=6, dbl(6)=12, neg(12)=-12
    const value = runClientJs(clientJs, "result");
    expect(value).toBe(-12);
  });

  test("pure consume+reinit followed by bound-consume — still no self-ref", () => {
    const src = [
      "function f(n: number) -> number { return n + 1 }",
      "function g(n: number) -> number { return n * 10 }",
      "function h(n: number) -> number { return n - 100 }",
      "",
      "${",
      "  f(2)",
      "  g(~)",                 // pure consume+reinit (Gap 7 site)
      "  const bound = h(~)",   // bound consume (S94 lowering)
      "}",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);

    // f(2)=3, g(3)=30, h(30)=-70
    const value = runClientJs(clientJs, "bound");
    expect(value).toBe(-70);
  });
});

describe("tilde (~) Gap 5 — `~` after `!{}` handler lowers correctly", () => {
  test("guarded-expr followed by `~` consume — tildeContext.var rewired to resultVar", () => {
    // Use stubbed handler `data` field so the codegen path runs without an
    // actual failable function. The arm-body emission bug (Gap 8) means we
    // can't easily test through the WHOLE error path, but the success path
    // is what Gap 5 targets: the SUCCESS value flows into resultVar and `~`
    // resolves there.
    const src = [
      "function loadItem(id: number) -> string { return `item-${id}` }",
      "function format(s: string) -> string { return `[${s}]` }",
      "",
      "function loadAndFormat(id: number) -> string {",
      "  loadItem(id) !{",
      "    | .NotFound -> { return \"missing\" }",
      "    | .Timeout  -> { return \"timeout\" }",
      "  }",
      "  return format(~)",
      "}",
      "",
      "${",
      "  const result = loadAndFormat(7)",
      "}",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);

    // SYMPTOM regression: literal `~` in a consuming position must NOT survive.
    // The Gap 5 symptom was `return _scrml_format_5(~);` — pre-fix this leaked.
    expect(clientJs).not.toMatch(/[(=,]\s*~\s*[),]/);

    // Affirmative: the format(~) lowered call must reference SOMETHING (the
    // resultVar). The fix sets tildeContext.var = resultVar.
    expect(clientJs).toMatch(/_scrml_format_\d+\(_scrml_[A-Za-z0-9_]+\)/);
  });

  test("guarded-expr in function body — `~` resolves to the resultVar", () => {
    // Minimal: just check the function body compiles and contains no literal `~`.
    const src = [
      "function fetchUser(id: number) -> string { return `u-${id}` }",
      "function display(s: string) -> string { return `<${s}>` }",
      "",
      "function loadAndShow(id: number) -> string {",
      "  fetchUser(id) !{",
      "    | .NotFound -> { return \"x\" }",
      "  }",
      "  return display(~)",
      "}",
      "",
      "${",
      "  const out = loadAndShow(1)",
      "}",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/[(=,]\s*~\s*[),]/);
  });

  test("guarded-expr inside ${} top-level — `~` after consumes correctly", () => {
    // Same shape but the guarded-expr + `~`-consume both at top-level of a ${} body.
    const src = [
      "function loadItem(id: number) -> string { return `item-${id}` }",
      "function format(s: string) -> string { return `[${s}]` }",
      "",
      "${",
      "  loadItem(1) !{",
      "    | .NotFound -> { return \"missing\" }",
      "  }",
      "  const result = format(~)",
      "}",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);
    expect(clientJs).not.toMatch(/[(=,]\s*~\s*[),]/);
    expect(clientJs).toMatch(/_scrml_format_\d+\(_scrml_[A-Za-z0-9_]+\)/);
  });
});

describe("tilde (~) Gap 6 — text at <program> direct child with `~` lifts to logic", () => {
  test("bare-call + const-decl with ~ after JS comment lifts cleanly", () => {
    // The comment-split case: the comment ends the leading text region;
    // the following text begins with `step1(2)` which doesn't match
    // BARE_DECL_RE. Pre-fix: text node, silently dropped.
    const src = [
      "<program>",
      "  function step1(n: number) -> number { return n + 10 }",
      "  function step2(n: number) -> number { return n * 3 }",
      "",
      "  // descriptive comment between fn decls and chain",
      "  step1(2)",
      "  const result = step2(~)",
      "",
      "  <div>${result}</div>",
      "</program>",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);

    // The bare-call must have lifted — `let _scrml_tilde_N = ...` present.
    expect(clientJs).toMatch(/let _scrml_tilde_\d+ = _scrml_step1_\d+\(2\);/);
    // const result = step2(~) lowers via tildeContext.
    expect(clientJs).toMatch(/const result = _scrml_step2_\d+\(_scrml_tilde_\d+\);/);
  });

  test("three-link chain at <program> direct child lifts cleanly", () => {
    // Gap 6 + Gap 7 combined — three-link chain without an explicit ${} wrapper.
    const src = [
      "<program>",
      "  function step1(n: number) -> number { return n + 10 }",
      "  function step2(n: number) -> number { return n * 3 }",
      "",
      "  // chain across the comment-boundary",
      "  step1(2)",
      "  step2(~)",
      "  const final = ~",
      "",
      "  <div>${final}</div>",
      "</program>",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/let _scrml_tilde_\d+ = _scrml_step1_\d+\(2\);/);
    // Verify no self-reference (Gap 7 cross-check)
    const tildeAssigns = [...clientJs.matchAll(/let (_scrml_tilde_\d+) = .*?\((_scrml_tilde_\d+)\)/g)];
    for (const m of tildeAssigns) {
      expect(m[1]).not.toBe(m[2]);
    }
  });

  test("non-tilde text at <program> direct child still preserved as prose", () => {
    // Negative check — text WITHOUT `~` and WITHOUT a decl-keyword prefix
    // should NOT be lifted (preserve adopter intent for prose / whitespace).
    const src = [
      "<program>",
      "  function step1(n: number) -> number { return n + 10 }",
      "",
      "  // a plain prose comment — no `~` here",
      "  // just trailing whitespace below",
      "  ",
      "  <div>${step1(2)}</div>",
      "</program>",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);
    // The function declaration still emits.
    expect(clientJs).toMatch(/function _scrml_step1_\d+\(n\)/);
    // Markup interpolation still works.
    expect(clientJs).toMatch(/_scrml_step1_\d+\(2\)/);
  });

  test("Gap 6 + Gap 7 — pure consume+reinit chain at <program> direct child", () => {
    // End-to-end shape demanded by FOLLOWUPS.md — adopters can drop the
    // explicit `${}` wrapper around `~` chains at <program> direct level.
    const src = [
      "<program>",
      "  function dbl(n: number) -> number { return n * 2 }",
      "  function inc(n: number) -> number { return n + 1 }",
      "",
      "  dbl(5)",
      "  inc(~)",
      "  const out = ~",
      "",
      "  <div>${out}</div>",
      "</program>",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);
    // Expect both tilde-bindings + final const.
    expect(clientJs).toMatch(/let _scrml_tilde_\d+ = _scrml_dbl_\d+\(5\);/);
    expect(clientJs).toMatch(/let _scrml_tilde_\d+ = _scrml_inc_\d+\(_scrml_tilde_\d+\);/);
    expect(clientJs).toMatch(/const out = _scrml_tilde_\d+;/);
  });
});

describe("tilde (~) Gap 5/6/7 — cross-gap interaction smoke", () => {
  test("function body with !{} + `~`, called from <program> direct chain", () => {
    // Stress: Gap-5 inside the function body, Gap-6+7 at program direct level.
    const src = [
      "<program>",
      "  function fetchData(id: number) -> string { return `data-${id}` }",
      "  function transform(s: string) -> string { return s.toUpperCase() }",
      "",
      "  function load(id: number) -> string {",
      "    fetchData(id) !{",
      "      | .NotFound -> { return \"missing\" }",
      "    }",
      "    return transform(~)",
      "  }",
      "",
      "  // direct chain at <program> level",
      "  load(1)",
      "  const final = ~",
      "",
      "  <div>${final}</div>",
      "</program>",
    ].join("\n");

    const { clientJs, errors } = compileSource(src);
    expect(errors).toEqual([]);
    // No literal `~` anywhere in a consuming position
    expect(clientJs).not.toMatch(/[(=,]\s*~\s*[),]/);
    // load(1) lifted via Gap-6 fix + Gap-7-safe sequencing
    expect(clientJs).toMatch(/let _scrml_tilde_\d+ = _scrml_load_\d+\(1\);/);
    expect(clientJs).toMatch(/const final = _scrml_tilde_\d+;/);
  });
});

// ---------------------------------------------------------------------------
// gate-found-invalid-js-fix-wave (S141 follow-on) — a server-fn call used as a
// `~`-init inside an async client function must NOT emit `await let X = ...`.
//
// ROOT CAUSE (example 16-remote-data): the §32 tilde-init bare-expr
// (`fetchContacts()`) lowers to `let _scrml_tilde_N = _scrml_fetch_*();` under
// an active tildeContext. The CPS scheduler's single-statement await branch
// (scheduling.ts) prepended `await` to the WHOLE statement -> `await let X = ...`
// (invalid JS — the gate's E-CODEGEN-INVALID-JS). The await belongs on the
// initializer, not the declaration; the fix injects it after the `=`.
// ---------------------------------------------------------------------------

describe("gate fix-wave: await on tilde-init server call lands on the initializer", () => {
  const acorn = require("acorn");

  test("`serverFn(); @x = .Ready(~)` inside a client fn emits `let _scrml_tilde_N = await ...`, valid JS", () => {
    const src = `<program>
  \${
    type RD = .NotAsked | .Loading | .Ready(rows)
    <state>: RD = .NotAsked
    server function fetchRows() {
      return ?{\`SELECT id FROM things\`}.all()
    }
    function load() {
      @state = RD::Loading
      fetchRows()
      @state = RD::Ready(~)
    }
  }
  <button onclick=load()>Load</button>
</program>`;
    const { clientJs, errors } = compileSource(src, "tilde-await-init.scrml");
    const invalid = errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS");
    expect(invalid).toHaveLength(0);
    expect(clientJs.length).toBeGreaterThan(0);
    // The malformed `await let` must NOT appear; the await must be on the init.
    expect(clientJs).not.toContain("await let ");
    expect(clientJs).toMatch(/let _scrml_tilde_\d+ = await /);
    expect(() => acorn.parse(clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  });
});
