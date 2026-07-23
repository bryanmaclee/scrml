/**
 * e-dg-002-false-positive-class.test.js — Stage 11 DG E-DG-002 reader-credit
 * for three under-counted reader loci (closes S146 match-DG + R27 C9 +
 * `g-dg-class-attr-interp-not-consumed`).
 *
 * E-DG-002 ("Reactive variable `@x` is declared but never consumed") fired
 * SPURIOUSLY on three real read loci the DG's reader-accounting missed:
 *
 *   (A) Derived-cell RHS arrow-body read (R27 "C9"): a `@var` read only inside
 *       a `.map`/`.filter`/`.reduce` callback body
 *       (`const <filtered> = @items.filter(x => x > @threshold)`). The shared
 *       `forEachIdentInExprNode` walker stops at the LambdaExpr scope boundary
 *       (correct for lin-capture tracking, wrong for DG reader-accounting).
 *       Fix: DG-local `collectLambdaBodyReactiveRefs` descends into lambda
 *       bodies for reader-credit only (dependency-graph.ts).
 *
 *   (B) Block-form `<match on=@cell>` header (S146): the markup match-block
 *       node is block-splitter-captured raw and carries its match subject as
 *       `onExprRaw` (a string, not a walkable ExprNode), so the generic
 *       ExprNode markup-sweep never credited the subject cell. Fix: a
 *       match-block special-case (analogous to each-block opener-attr credit)
 *       scans `onExprRaw` + `armsRaw` for @cell reads.
 *
 *   (C) Template-literal attribute interpolation ("SB3",
 *       `g-dg-class-attr-interp-not-consumed`): a `@var` read only inside a
 *       quoted attribute value's `${...}` (`<div class="box ${@theme}">`). Such
 *       a value is `{ kind: "string-literal", value: "box ${@theme}" }` — an
 *       OBJECT whose payload is `value` — so it matched none of the DG's
 *       attribute-value branches and was never credited at all. NOT
 *       class-specific: the miss is in the value SHAPE, so `style` / `title` /
 *       `data-*` / `aria-*` were equally affected. Fix: credit the cells
 *       reported by `rewriteTemplateAttrValue` (codegen's own lowerer, reused
 *       so the DG's reader set is the WIRED set by construction).
 *       Spec: §5.5.3 (interpolated `@var` SHALL subscribe), §5 line 1244
 *       (the `${...}` token is attribute-name-agnostic).
 *
 * HARD regression guard: E-DG-002 MUST STILL FIRE on genuinely-unused reactive
 * vars (the fix CREDITS specific real read loci; it must NOT blanket-suppress).
 *
 * Stream note (diagnostic-stream-partition): E-DG-002 is `warning` severity, so
 * api.js routes it to `result.warnings`. The helper unions both channels so an
 * accidental partition flip can never silently pass.
 *
 * Spec authority: SPEC §31.5 (DG normative), §34 (E-DG-002 catalog),
 * §18 (match block-form).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/e-dg-002-false-positive-class");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let _fileCounter = 0;
function compileSource(source) {
  const filename = `test-${_fileCounter++}.scrml`;
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: false });
  // Cross-stream: E-DG-002 is `warning`-severity (-> result.warnings). Union
  // both channels so a stream-partition flip can't make a NO-fire test pass
  // (or a fire test fail) silently. See diagnostic-stream-partition note.
  const fatalErrors = result.errors || [];
  const warnings = result.warnings || [];
  return { all: [...fatalErrors, ...warnings], warnings, fatalErrors };
}

function edg002For(diagnostics, varName) {
  return diagnostics.find((e) =>
    e.code === "E-DG-002" && new RegExp("`@" + varName + "`").test(e.message)
  );
}

describe("E-DG-002 false-positive class — credit under-counted reader loci", () => {
  // ---- (A) Derived-cell RHS arrow-body reads (R27 C9) ----

  test("(A) derived .filter arrow body: @threshold read inside callback fires NO E-DG-002", () => {
    const source = [
      "<program>",
      "  <items>: int[] = [1, 2, 3, 4]",
      "  <threshold> = 2",
      "  const <filtered> = @items.filter(x => x > @threshold)",
      "  <div>${@filtered}</div>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "threshold")).toBeUndefined();
    // @items is read at the member base (already credited) — also no fire.
    expect(edg002For(all, "items")).toBeUndefined();
    // @filtered is consumed by the markup interpolation — no fire.
    expect(edg002For(all, "filtered")).toBeUndefined();
  });

  test("(A-variant) derived .map arrow body credits @factor", () => {
    const source = [
      "<program>",
      "  <nums>: int[] = [1, 2, 3]",
      "  <factor> = 10",
      "  const <scaled> = @nums.map(n => n * @factor)",
      "  <div>${@scaled}</div>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "factor")).toBeUndefined();
    expect(edg002For(all, "nums")).toBeUndefined();
  });

  test("(A-variant) derived .reduce arrow body credits @seed", () => {
    const source = [
      "<program>",
      "  <nums>: int[] = [1, 2, 3]",
      "  <seed> = 100",
      "  const <total> = @nums.reduce((acc, n) => acc + n + @seed, 0)",
      "  <div>${@total}</div>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "seed")).toBeUndefined();
    expect(edg002For(all, "nums")).toBeUndefined();
  });

  test("(A-variant) doubly-nested arrow body credits @limit", () => {
    // `v < @limit` would hit an unrelated markup-region `<`-in-expr ParseError
    // (deferred — see NOTES); use `>` to isolate the nested-lambda credit path.
    const source = [
      "<program>",
      "  <rows>: int[][] = [[1, 2], [3, 4]]",
      "  <limit> = 2",
      "  const <picked> = @rows.map(row => row.filter(v => v > @limit))",
      "  <div>${@picked}</div>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "limit")).toBeUndefined();
    expect(edg002For(all, "rows")).toBeUndefined();
  });

  // ---- (B) Block-form <match on=@cell> header (S146) ----

  test("(B) block-form <match on=@phase> credits @phase", () => {
    const source = [
      "<program>",
      "  type Phase:enum = { Idle, Busy }",
      "  <phase>: Phase = .Idle",
      "  <match on=@phase>",
      "    <Idle>idle</Idle>",
      "    <Busy>busy</Busy>",
      "  </match>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "phase")).toBeUndefined();
  });

  test("(B-variant) <match on=@wrapper.phase> member-access subject credits @wrapper", () => {
    const source = [
      "<program>",
      "  type Phase:enum = { Idle, Busy }",
      "  <wrapper>: { phase: Phase } = { phase: .Idle }",
      "  <match on=@wrapper.phase>",
      "    <Idle>idle</Idle>",
      "    <Busy>busy</Busy>",
      "  </match>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "wrapper")).toBeUndefined();
  });

  // ---- (C) Template-literal attribute interpolation (SB3) ----
  //
  // `g-dg-class-attr-interp-not-consumed`. A quoted attribute value carrying
  // `${...}` arrives as `{ kind: "string-literal", value: "box ${@theme}" }` —
  // an OBJECT whose payload lives in `value`. Pre-fix it matched NONE of the
  // DG markup-sweep attribute branches (`name` = variable-ref, `refs` =
  // expr-attr, `raw` = expr fallback, kind "call-ref") and none of the
  // string-typed path above them, so the read was never credited AT ALL.
  //
  // The read is normative, not incidental: SPEC §5.5.3 — "Reactive variables
  // referenced as `${@varName}` inside the template literal SHALL each
  // subscribe to changes" — and codegen agrees, emitting
  // `_scrml_effect(() => el.setAttribute(name, `…${_scrml_reactive_get(…)}…`))`.

  test("(C) class attr interpolation is the ONLY read: fires NO E-DG-002", () => {
    const source = [
      "<program>",
      '  <theme> = "dark"',
      '  <div class="box ${@theme}">hello</div>',
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "theme")).toBeUndefined();
  });

  test("(C) class attr interpolation + a text read: still clean", () => {
    // The text read alone already credited @theme pre-fix; this pins that the
    // SB3 credit is additive and did not disturb the already-working path.
    const source = [
      "<program>",
      '  <theme> = "dark"',
      '  <div class="box ${@theme}">hello ${@theme}</div>',
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "theme")).toBeUndefined();
  });

  test("(C) interpolation with no static prefix (class=\"${@theme}\") is credited", () => {
    const source = [
      "<program>",
      '  <theme> = "dark"',
      '  <div class="${@theme}">hello</div>',
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "theme")).toBeUndefined();
  });

  test("(C) the credit is attribute-name-agnostic, not class-specific", () => {
    // The miss was in the attribute VALUE SHAPE, not the attribute name —
    // codegen emits an identical setAttribute + _scrml_effect pair for every
    // one of these, so each must be credited. A class-only fix would leave
    // these four false-fire shapes standing.
    const source = [
      "<program>",
      '  <tone> = "dark"',
      '  <hue> = "red"',
      '  <tag> = "x"',
      '  <label> = "l"',
      '  <div title="t ${@tone}">a</div>',
      '  <div style="color: ${@hue}">b</div>',
      '  <div data-kind="k ${@tag}">c</div>',
      '  <div aria-label="al ${@label}">d</div>',
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "tone")).toBeUndefined();
    expect(edg002For(all, "hue")).toBeUndefined();
    expect(edg002For(all, "tag")).toBeUndefined();
    expect(edg002For(all, "label")).toBeUndefined();
  });

  test("(C) every cell across multiple interpolations in one attr is credited", () => {
    // SPEC §5.5.3: "Multiple `${...}` interpolations in a single `class`
    // attribute are supported. Each reactive variable in any interpolation
    // produces an independent reactive subscription."
    const source = [
      "<program>",
      '  <size> = "lg"',
      '  <tone> = "dark"',
      '  <div class="btn-${@size} tone-${@tone}">hello</div>',
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "size")).toBeUndefined();
    expect(edg002For(all, "tone")).toBeUndefined();
  });

  test("(C-GUARD) a bare @x in LITERAL attr text (no ${}) STILL fires", () => {
    // The bound on the fix. Codegen does NOT wire `title="mail @theme now"` —
    // the compiled client contains no `_scrml_reactive_get("theme")` — so
    // E-DG-002 there is CORRECT. Scanning the whole attribute string instead
    // of only the `${...}` segments would silence a REAL unused-cell warning,
    // which is a worse bug than the false fire and invisible without this test.
    const source = [
      "<program>",
      '  <theme> = "dark"',
      '  <div title="mail @theme now">hello</div>',
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "theme")).toBeDefined();
  });

  test("(C-GUARD) a credited attr interp does NOT credit a sibling unused cell", () => {
    // Precision check, mirroring the (A) lambda guard: @theme is read in the
    // class template and must be credited; @bystander is declared and read
    // nowhere and must still fire. Proves SB3 is a targeted per-cell credit,
    // not a blanket suppression for any file containing an interpolated attr.
    const source = [
      "<program>",
      '  <theme> = "dark"',
      "  <bystander> = 99",
      '  <div class="box ${@theme}">hello</div>',
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "theme")).toBeUndefined();
    expect(edg002For(all, "bystander")).toBeDefined();
  });

  // ---- HARD regression guard — genuinely-unused MUST still fire ----

  test("(GUARD) genuinely-unused @reallyUnused STILL fires E-DG-002", () => {
    const source = [
      "<program>",
      "  <reallyUnused> = 5",
      "  <div>hello</div>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "reallyUnused")).toBeDefined();
  });

  test("(GUARD) a cell read ONLY in a lambda body still leaves a SIBLING unused cell firing", () => {
    // The lambda-body credit must be precise: it credits @threshold (read in
    // the callback) but must NOT spuriously credit @bystander (declared, never
    // read anywhere). Proves the fix is a targeted credit, not a blanket
    // suppression of every cell in a file that contains a lambda.
    const source = [
      "<program>",
      "  <items>: int[] = [1, 2, 3]",
      "  <threshold> = 2",
      "  <bystander> = 99",
      "  const <filtered> = @items.filter(x => x > @threshold)",
      "  <div>${@filtered}</div>",
      "</program>",
    ].join("\n");
    const { all } = compileSource(source);
    expect(edg002For(all, "threshold")).toBeUndefined();
    expect(edg002For(all, "bystander")).toBeDefined();
  });
});
