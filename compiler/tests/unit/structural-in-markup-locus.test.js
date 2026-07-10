/**
 * structural-in-markup-locus.test.js — E-STRUCTURAL-ELEMENT-MISPLACED in plain markup
 *
 * Closes the markup-locus half of the §4.15 structural-element misplacement
 * class for the engine-child-only self-closing elements `<onTimeout>` (§51.0.M)
 * and `<onIdle>` (§51.0.R). The `${...}`-logic-body half is covered by
 * structural-in-logic-body.test.js.
 *
 * The bug (pre-fix): an `<onTimeout>` / `<onIdle>` placed OUTSIDE an engine
 * state-child — specifically in plain `<program>` / `<page>` markup — was parsed
 * as a GENERAL markup element node, so its `after=` / `to=` were validated as HTML
 * attributes: the misplacement degraded to the incidental E-ATTR-001 + E-SCOPE-001
 * pair instead of the SPEC-mandated E-STRUCTURAL-ELEMENT-MISPLACED (§51.0.M
 * "outside an engine state-child → E-STRUCTURAL-ELEMENT-MISPLACED"). This is the
 * markup-locus dual of the `${}`-logic-body fire site.
 *
 * The fix (ast-builder.js): the general-markup element branch gates on
 * `ENGINE_CHILD_MARKUP_ONLY_ELEMENTS` ({onTimeout, onIdle}) and — before
 * attribute parsing — fires E-STRUCTURAL-ELEMENT-MISPLACED, returning an
 * attribute-less node so the E-ATTR-001 / E-SCOPE-001 cascade is suppressed
 * (parity with the clean `${}`-locus fire). A VALID in-engine occurrence reaches
 * the same branch via the engine-decl body recurse whose buildBlock errors are
 * DISCARDED, so the fire is user-visible only for a genuinely misplaced element.
 *
 * `<onTransition>` is deliberately EXCLUDED (it may carry a handler body + has a
 * distinct §18.0.2 match-locus code); its markup-locus enforcement is a separate
 * follow-up.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/structural-in-markup-locus");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function fix(name, src) {
  const p = join(FIXTURE_DIR, name);
  writeFileSync(p, src);
  return p;
}
function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false, log: () => {} });
}
function codes(result) {
  return [...(result.errors || []), ...(result.warnings || [])].map(d => d.code);
}
function structuralErrors(result) {
  return (result.errors || []).filter(e => e.code === "E-STRUCTURAL-ELEMENT-MISPLACED");
}

// ---------------------------------------------------------------------------
// §1 — misplacement in plain <program> markup fires E-STRUCTURAL-ELEMENT-MISPLACED
// ---------------------------------------------------------------------------

describe("§1 — engine-child structural element in plain markup", () => {
  test("§1.1 — `<onTimeout>` in plain <program> markup fires E-STRUCTURAL-ELEMENT-MISPLACED", () => {
    const r = compile(fix("ontimeout-markup.scrml", `<program>
type LoadPhase:enum = { Idle, Loading, TimedOut }
<onTimeout after=30s to=.TimedOut/>
</program>
`));
    const errs = structuralErrors(r);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("<onTimeout>");
    expect(errs[0].message).toContain("§4.15");
  });

  test("§1.2 — `<onIdle>` in plain <program> markup fires E-STRUCTURAL-ELEMENT-MISPLACED", () => {
    const r = compile(fix("onidle-markup.scrml", `<program>
type LoadPhase:enum = { Active, Idle }
<onIdle after=60s to=.Idle/>
</program>
`));
    const errs = structuralErrors(r);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("<onIdle>");
  });

  test("§1.3 — the markup-locus fire is CLEAN — no incidental E-ATTR-001 / E-SCOPE-001 cascade", () => {
    const r = compile(fix("ontimeout-clean.scrml", `<program>
type LoadPhase:enum = { Idle, Loading, TimedOut }
<onTimeout after=30s to=.TimedOut/>
</program>
`));
    const c = codes(r);
    expect(c).toContain("E-STRUCTURAL-ELEMENT-MISPLACED");
    expect(c).not.toContain("E-ATTR-001");
    expect(c).not.toContain("E-SCOPE-001");
  });
});

// ---------------------------------------------------------------------------
// §2 — negative regressions: a VALID in-engine occurrence must NOT fire
// ---------------------------------------------------------------------------

describe("§2 — valid in-engine occurrence does NOT false-fire", () => {
  test("§2.1 — `<onTimeout>` inside an engine state-child is silent", () => {
    const r = compile(fix("ontimeout-valid.scrml", `<program>
type LoadPhase:enum = { Idle, Loading, TimedOut }
<engine for=LoadPhase initial=.Idle>
  <Idle rule=.Loading>
    <button onclick=\${@loadPhase = .Loading}>Load</button>
  </>
  <Loading rule=(.TimedOut)>
    <onTimeout after=30s to=.TimedOut/>
    "Loading…"
  </>
  <TimedOut rule=.Idle : "Timed out">
</engine>
</program>
`));
    expect(structuralErrors(r).length).toBe(0);
  });

  test("§2.2 — `<onIdle>` at engine root (§51.0.R) is silent", () => {
    const r = compile(fix("onidle-valid.scrml", `<program>
type LoadPhase:enum = { Active, Idle }
<engine for=LoadPhase initial=.Active>
  <onIdle after=60s to=.Idle/>
  <Active rule=.Idle : "active">
  <Idle rule=.Active : "idle">
</engine>
</program>
`));
    expect(structuralErrors(r).length).toBe(0);
  });
});
