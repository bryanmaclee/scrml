/**
 * s144-ontransition-body-self-write-no-phantom.test.js
 *
 * S144 Cluster E / Bug-AB — Defect 2.
 *
 * Writing the engine's OWN variable (and other cells) inside an `<onTransition>`
 * body MUST NOT trip phantom analyzer errors:
 *   - phantom E-ENGINE-VAR-DUPLICATE (the `@engineVar = .X` write mis-classified
 *     as a separate `<engineVar>` cell DECLARATION colliding with the engine's
 *     auto-declared variable), and
 *   - false E-DG-002 (a cell written in the onTransition body + read in a
 *     state-child mis-reported as "never consumed").
 *
 * ROOT: the ast-builder builds engine bodyChildren in MARKUP context, so an
 * onTransition body's `@x = expr` parses as a non-structural state-decl
 * (structuralForm:false) WITHOUT the V-kill `_isReactiveAssign` tag. SYM PASS 1
 * then REGISTERED those writes as phantom cells.
 *
 * FIX: SYM PASS 1 `walk` gains an `inEngineBody` flag; non-structural state-decl
 * writes inside an engine body are walked-through (RHS visited) but NOT
 * registered.
 *
 * NOTE on transition legality (distinct from this defect): `<onTransition to=.X>`
 * in a FROM-state-child whose `rule=` does not include `.X` is a genuine
 * E-ENGINE-INVALID-TRANSITION (§51.0.H — `to=` = "fires when leaving toward .X").
 * The valid fixtures below use a legal `to=` so the phantom-error fix is proven
 * in isolation.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

function compileErrors(source, suffix = "s144-ab2") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    return (result.errors ?? []).map((e) => ({ code: e.code, severity: e.severity }));
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codes = (diags) => diags.map((d) => d.code);

describe("S144 Bug-AB Defect 2 — onTransition-body self-write does not trip phantom errors", () => {
  test("engine self-write `@phase = .Ready` inside a (valid) onTransition body is NOT E-ENGINE-VAR-DUPLICATE", () => {
    const src = `<program>
type Phase:enum = { Loading, Ready }
<count> = 0
<engine for=Phase initial=.Loading>
    <Loading rule=.Ready>
        Loading…
        <onTransition to=.Ready>\${ @count = 42; @phase = .Ready }</>
    </>
    <Ready>Ready: \${@count}</>
</engine>
</program>`;
    const diags = compileErrors(src, "s144-ab2-valid");
    expect(codes(diags)).not.toContain("E-ENGINE-VAR-DUPLICATE");
    // No hard errors at all on this well-formed fixture.
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("a cell written in an onTransition body + read in a state-child is consumed (no false E-DG-002)", () => {
    const src = `<program>
type Phase:enum = { Loading, Ready }
<count> = 0
<engine for=Phase initial=.Loading>
    <Loading rule=.Ready>
        Loading…
        <onTransition to=.Ready>\${ @count = 42; @phase = .Ready }</>
    </>
    <Ready>Ready: \${@count}</>
</engine>
</program>`;
    const diags = compileErrors(src, "s144-ab2-dg");
    // @count is written in the onTransition body and READ in <Ready> → consumed.
    expect(codes(diags)).not.toContain("E-DG-002");
  });

  test("the brief's literal `to=.Loading` fixture no longer emits the two PHANTOM errors (only the genuine invalid-transition remains)", () => {
    // This fixture is malformed: `<onTransition to=.Loading>` in `<Loading
    // rule=.Ready>` is a self-target the rule does not permit → a LEGITIMATE
    // E-ENGINE-INVALID-TRANSITION. The point of this assertion is that the two
    // PHANTOM errors are gone; the real transition diagnostic is correct and
    // intentionally NOT suppressed.
    const src = `<program>
type Phase:enum = { Loading, Ready }
<count> = 0
<engine for=Phase initial=.Loading>
    <Loading rule=.Ready>
        Loading…
        <onTransition to=.Loading>\${ @count = 42; @phase = .Ready }</>
    </>
    <Ready>Ready: \${@count}</>
</engine>
</program>`;
    const diags = compileErrors(src, "s144-ab2-literal");
    expect(codes(diags)).not.toContain("E-ENGINE-VAR-DUPLICATE");
    expect(codes(diags)).not.toContain("E-DG-002");
    // The genuine diagnostic on the malformed self-target IS expected.
    expect(codes(diags)).toContain("E-ENGINE-INVALID-TRANSITION");
  });
});
