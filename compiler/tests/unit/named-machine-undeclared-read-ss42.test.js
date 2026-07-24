/**
 * ss42 — named-machine undeclared-read (Model 1, S223 PA ruling).
 *
 * Locks the diagnostic behavior change from g-named-machine-arrow-no-statedecl
 * (the SURVEY's split-brain). Before ss42, a NAMED non-derived machine
 * (`<engine name=PM for=Phase> .Idle => .Running </>`) silently pre-bound its
 * lowercased/raw reads (`@PM` / `@pm`) AND its match `on=@PM` bypassed the
 * read-side walker entirely → the governed cell stayed `undefined` at mount, the
 * driven `<match>` rendered EMPTY, and the compiler emitted ZERO diagnostic
 * (only `W-ENGINE-INITIAL-MISSING`, itself a misfire). Model 1 (§51.3.3 / §51.0.B):
 * `@pm` is NOT a legal read of a non-derived named machine — the user must
 * declare a SEPARATE `@var: MachineName = init` (§51.3.3) and read THAT.
 *
 * This regression guard pins all three landed fixes on REAL compiled source so a
 * future refactor cannot silently revert to silent-empty:
 *
 *   item 1 — the machineRegistry auto-decl pre-bind (type-system.ts ~11314) is
 *            narrowed to skip the NAMED non-derived case (`hadNameAttr &&
 *            !isDerived`), so `@PM`/`@pm` fall through to the read-side
 *            E-STATE-UNDECLARED walker. The narrow MUST NOT touch (a) non-named
 *            `<engine for=Type>` engines (their §51.0.C auto-cell `@type` is a
 *            real codegen-init'd read) or (b) §51.9 derived/projection machines
 *            (their projection cell is materialized by `_scrml_derived_declare`).
 *            The literal "derived-only" narrow would have regressed (a) —
 *            that is exactly the no-regression case Cases 3+4 lock.
 *   item 2 — the markup-match `on=@X` read (match-block `onExprRaw`) is routed
 *            through the same read-side walker, so an undeclared `on=` read fires
 *            (a GENERAL match-`on=` gap, the broadest slice).
 *   item 3 — `W-ENGINE-INITIAL-MISSING` (a §51.0.E STATE-engine nudge) no longer
 *            misfires on the §51.3 machine surfaces (named machine / `<machine>`
 *            keyword), which have zero state-children and no `initial=` concept.
 *
 * Harness: compileScrml on REAL source (mirrors v-kill-readside-undeclared.test.js).
 * Diagnostic partition (diagnostic-stream rule): E- codes land in result.errors,
 * W- / I- codes land in result.warnings — so warning assertions use a CROSS-STREAM
 * helper that searches
 * BOTH streams (a `result.errors.filter(code === "W-...")` would silently pass).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const FIXTURE_DIR = "/tmp/ss42-named-machine-undeclared-read-fixtures";
mkdirSync(FIXTURE_DIR, { recursive: true });

function compileSource(source, filename) {
  const filePath = join(FIXTURE_DIR, filename);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(FIXTURE_DIR, "dist"),
    write: false,
  });
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  const first = [...(result.outputs ?? new Map()).values()][0];
  return {
    errors,
    warnings,
    clientJs: (first && first.clientJs) || "",
  };
}

// Cross-stream code lookup (diagnostic-partition rule): a W-/I- code lands in
// `warnings`, an E- code in `errors` — search BOTH so a code-only assertion is
// stream-agnostic and cannot silently pass against the wrong partition.
function diagsByCode({ errors, warnings }, code) {
  return [...errors, ...warnings].filter((d) => d.code === code);
}

// ---------------------------------------------------------------------------
// item 1 — NEW fire (acceptance): named non-derived machine reads are undeclared
// ---------------------------------------------------------------------------

describe("ss42 item-1 — named non-derived machine lowercased/raw read fires E-STATE-UNDECLARED", () => {
  test("Case 1 — `<engine name=PM for=Phase>` + `${@PM}` read, no `@var: PM` decl, fires E-STATE-UNDECLARED", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
<engine name=PM for=Phase>
  .Idle => .Running
  .Running => .Done
</engine>
<app><p>\${@PM}</p></app>`;
    const result = compileSource(source, "case-1-named-raw-read.scrml");
    const fired = diagsByCode(result, "E-STATE-UNDECLARED");
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0].message).toContain("@PM");
  });

  test("Case 2 — the lowercased `${@pm}` read form ALSO fires E-STATE-UNDECLARED", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
<engine name=PM for=Phase>
  .Idle => .Running
  .Running => .Done
</engine>
<app><p>\${@pm}</p></app>`;
    const result = compileSource(source, "case-2-named-lower-read.scrml");
    const fired = diagsByCode(result, "E-STATE-UNDECLARED");
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0].message).toContain("@pm");
  });
});

// ---------------------------------------------------------------------------
// item 1 — NO-REGRESSION: the cases the literal "derived-only" narrow broke
// ---------------------------------------------------------------------------

describe("ss42 item-1 — NO-REGRESSION: non-named + derived reads still resolve", () => {
  test("Case 3 — non-named `<engine for=PhaseTag>` §51.0.C auto-read `@phaseTag` resolves (NO E-STATE-UNDECLARED)", () => {
    const source = `type PhaseTag:enum = { Idle, Loading, Done }
<engine for=PhaseTag initial=.Idle>
  <Idle rule=.Loading />
  <Loading rule=.Done />
  <Done />
</engine>
<app><p>\${@phaseTag.variant}</p></app>`;
    const result = compileSource(source, "case-3-nonnamed-autoread.scrml");
    expect(diagsByCode(result, "E-STATE-UNDECLARED").length).toBe(0);
  });

  test("Case 4 — §51.9 derived/projection machine lowercased read `@risk` resolves (NO E-STATE-UNDECLARED)", () => {
    const source = `\${
  type Phase:enum = { Idle, Loading }
  type Risk:enum = { Safe, AtRisk }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading />
  <Loading rule=.Idle />
</engine>
<engine for=Risk derived=@phase>
  .Idle    => .Safe
  .Loading => .AtRisk
</engine>
<app>
  <p>\${@risk}</p>
  <match for=Risk on=@risk>
    <Safe> <div>safe</div> </>
    <AtRisk> <div>at risk</div> </>
  </match>
</app>`;
    const result = compileSource(source, "case-4-derived-projection-read.scrml");
    expect(diagsByCode(result, "E-STATE-UNDECLARED").length).toBe(0);
    // The projection cell is genuinely materialized (the reason it legitimately resolves).
    expect(result.clientJs).toContain('_scrml_derived_declare("risk"');
  });
});

// ---------------------------------------------------------------------------
// item 1 — FIX PATH: the §51.3.3 separate `@var: Machine` binding compiles + inits
// ---------------------------------------------------------------------------

describe("ss42 item-1 — fix path: separate `@var: PM` decl compiles clean + inits", () => {
  test("Case 5 — `<phase>: PM = Phase.Idle` + `on=@phase` compiles clean (no E-STATE-UNDECLARED) and inits the cell", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
<engine name=PM for=Phase>
  .Idle => .Running
  .Running => .Done
</engine>
<phase>: PM = Phase.Idle
<app>
  <match for=Phase on=@phase>
    <Idle> <div>idle</div> </>
    <Running> <div>running</div> </>
    <Done> <div>done</div> </>
  </match>
</app>`;
    const result = compileSource(source, "case-5-fix-path-decl.scrml");
    expect(diagsByCode(result, "E-STATE-UNDECLARED").length).toBe(0);
    // Init comes from the STATE-DECL (§51.3.3), never from the engine.
    expect(result.clientJs).toContain('_scrml_reactive_set("phase"');
    expect(result.clientJs).toContain('_scrml_init_set("phase"');
  });
});

// ---------------------------------------------------------------------------
// item 2 — match `on=@X` routed through the read-side walker
// ---------------------------------------------------------------------------

describe("ss42 item-2 — markup-match `on=@X` undeclared read fires E-STATE-UNDECLARED", () => {
  test("Case 6 — `<match on=@totallyUndeclared>` (no engine, no decl) fires E-STATE-UNDECLARED", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
<app>
  <match for=Phase on=@totallyUndeclared>
    <Idle> <div>idle</div> </>
    <Running> <div>running</div> </>
    <Done> <div>done</div> </>
  </match>
</app>`;
    const result = compileSource(source, "case-6-match-on-undeclared.scrml");
    const fired = diagsByCode(result, "E-STATE-UNDECLARED");
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0].message).toContain("@totallyUndeclared");
  });

  test("Case 7 — `<match on=@declared>` over a real reactive cell resolves (NO E-STATE-UNDECLARED)", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
<declared>: Phase = Phase.Idle
<app>
  <match for=Phase on=@declared>
    <Idle> <div>idle</div> </>
    <Running> <div>running</div> </>
    <Done> <div>done</div> </>
  </match>
</app>`;
    const result = compileSource(source, "case-7-match-on-declared.scrml");
    expect(diagsByCode(result, "E-STATE-UNDECLARED").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// item 3 — W-ENGINE-INITIAL-MISSING misfire suppression (and genuine-fire preserved)
// ---------------------------------------------------------------------------

describe("ss42 item-3 — W-ENGINE-INITIAL-MISSING no longer misfires on §51.3 machine surfaces", () => {
  test("Case 8 — `<engine name=PM for=Phase>` arrow body does NOT fire W-ENGINE-INITIAL-MISSING", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
<engine name=PM for=Phase>
  .Idle => .Running
  .Running => .Done
</engine>
<phase>: PM = Phase.Idle
<app>
  <match for=Phase on=@phase>
    <Idle> <div>idle</div> </>
    <Running> <div>running</div> </>
    <Done> <div>done</div> </>
  </match>
</app>`;
    const result = compileSource(source, "case-8-named-no-misfire.scrml");
    // Cross-stream: the warning lands in result.warnings; assert absent EVERYWHERE.
    expect(diagsByCode(result, "W-ENGINE-INITIAL-MISSING").length).toBe(0);
  });

  test("Case 9 — `<machine>` keyword named form does NOT fire W-ENGINE-INITIAL-MISSING", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
< machine name=PM for=Phase>
  .Idle => .Running
  .Running => .Done
</machine>
<phase>: PM = Phase.Idle
<app>
  <match for=Phase on=@phase>
    <Idle> <div>idle</div> </>
    <Running> <div>running</div> </>
    <Done> <div>done</div> </>
  </match>
</app>`;
    const result = compileSource(source, "case-9-machine-keyword-no-misfire.scrml");
    expect(diagsByCode(result, "W-ENGINE-INITIAL-MISSING").length).toBe(0);
  });

  test("Case 10 — NOT over-suppressed: a genuine non-named state-child `<engine for=Phase>` missing `initial=` STILL fires W-ENGINE-INITIAL-MISSING", () => {
    const source = `type Phase:enum = { Idle, Running, Done }
<engine for=Phase>
  <Idle rule=.Running />
  <Running rule=.Done />
  <Done />
</engine>
<app>
  <match for=Phase>
    <Idle> <div>idle</div> </>
    <Running> <div>running</div> </>
    <Done> <div>done</div> </>
  </match>
</app>`;
    const result = compileSource(source, "case-10-statechild-still-fires.scrml");
    expect(diagsByCode(result, "W-ENGINE-INITIAL-MISSING").length).toBe(1);
  });
});
