/**
 * match-arm-void-element-scanner.test.js — §24 void elements as direct
 * children of a `<match for=T on=@x>` block-form arm body (SPEC §18.0.1 + §24).
 *
 * BUG (change-id match-arm-void-element-scanner-2026-06-15, the wave-1a GATING
 * fix for the corpus-rewrite arc / 09-error-handling flagship):
 *
 *   A §24 void element (`<input>`, `<br>`, `<img>`, …) used as a DIRECT CHILD
 *   of a match arm body broke the arm-closer scanning at TWO pipeline stages:
 *
 *     1. block-splitter.js `findStructuralBodyEnd` (the generic tag-stack
 *        scanner for STRUCTURAL_RAW_BODY_ELEMENTS = match / each bodies):
 *        a BARE (un-self-closed) void opener `<input>` was pushed onto the
 *        body tag-stack, so the arm's `</>` / outer `</match>` was mis-consumed
 *        as the void's closer → EOF → "inferred" → a misleading E-CTX-001
 *        "Unclosed <match>".
 *     2. match-statechild-parser.ts `findArmCloser`: a BARE void opener
 *        incremented the arm-close nesting `depth`, so the arm's `</>` /
 *        `</Variant>` closer decremented to a non-zero depth and the arm
 *        looked unclosed → a misleading E-MATCH-PARSE-001.
 *
 *   The self-closed form `<input/>` already worked at both stages (the
 *   self-closing `/>` short-circuit). The fix makes BOTH scanners treat §24
 *   void elements as self-terminating in their BARE form too — parity with
 *   plain-markup parsing, which already special-cases voids.
 *
 * The SAME void element compiles fine in plain markup outside any match, and
 * one level deep inside a non-void wrapper (`<label><input/></label>`) — so
 * the negative guard below confirms a genuinely-unclosed NON-void arm still
 * fires E-MATCH-PARSE-001 (the fix did not weaken the unclosed-arm detector).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { parseMatchArms } from "../../src/match-statechild-parser.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/match-arm-void-element-scanner");
const FIXTURE_OUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const p = join(FIXTURE_DIR, name);
  writeFileSync(p, src);
  return p;
}

function compile(src, name = "test.scrml") {
  const p = fix(name, src);
  return compileScrml({ inputFiles: [p], outputDir: FIXTURE_OUT, write: false });
}

// Cross-stream diagnostic lookup (W-/I- live in result.warnings; everything
// else in result.errors — partition rule). Scans both so a code assertion
// never silently passes against the wrong stream.
function findDiagnostic(result, code) {
  for (const d of [...(result.errors || []), ...(result.warnings || [])]) {
    if (d.code === code) return d;
  }
  return null;
}

// Count hard-error (exit-1) diagnostics — `result.errors` only.
function errorCodes(result) {
  return (result.errors || []).map((e) => e.code);
}

// ---------------------------------------------------------------------------
// §1: parseMatchArms — void direct child parses as a leaf (no arm-closer steal)
// ---------------------------------------------------------------------------

describe("§1: parseMatchArms treats a void direct child as a self-terminating leaf", () => {
  test("self-closed void `<input/>` direct child — arm closes correctly", () => {
    const r = parseMatchArms(`<Viewing> : "v"\n<Editing><input type="text" bind:value=@name /></Editing>`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(2);
    expect(r.arms[1].variantName).toBe("Editing");
    expect(r.arms[1].bodyForm).toBe("bare-body");
    expect(r.arms[1].bodyRaw).toContain("<input");
  });

  test("bare void `<input>` (un-self-closed) direct child — arm closes correctly", () => {
    const r = parseMatchArms(`<Viewing> : "v"\n<Editing><input type="text" bind:value=@name></Editing>`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(2);
    expect(r.arms[1].variantName).toBe("Editing");
    expect(r.arms[1].bodyForm).toBe("bare-body");
    expect(r.arms[1].bodyRaw).toContain("<input");
  });

  test("bare void closes with the generic `</>` closer too", () => {
    const r = parseMatchArms(`<Editing><input type="text"></>`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(1);
    expect(r.arms[0].variantName).toBe("Editing");
    expect(r.arms[0].bodyForm).toBe("bare-body");
  });

  test("multiple bare + self-closed voids in one arm — all leaves, arm closes", () => {
    const r = parseMatchArms(
      `<Editing><input type="text"><br/><img src="/a.png" /><br></Editing>`,
    );
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(1);
    expect(r.arms[0].variantName).toBe("Editing");
    expect(r.arms[0].bodyRaw).toContain("<input");
    expect(r.arms[0].bodyRaw).toContain("<br");
    expect(r.arms[0].bodyRaw).toContain("<img");
  });

  test("void with non-void siblings in the same arm — non-void wrapper still nests", () => {
    const r = parseMatchArms(
      `<Editing><label>Name</label><input type="text"><p>note</p></Editing>`,
    );
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(1);
    expect(r.arms[0].variantName).toBe("Editing");
    expect(r.arms[0].bodyRaw).toContain("<label>");
    expect(r.arms[0].bodyRaw).toContain("<input");
    expect(r.arms[0].bodyRaw).toContain("<p>note</p>");
  });

  test("void one level deep inside a non-void wrapper still parses (regression)", () => {
    const r = parseMatchArms(`<Editing><label><input type="text"></label></Editing>`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(1);
    expect(r.arms[0].bodyRaw).toContain("<label>");
  });

  test("uppercase void name lookup is case-insensitive (INPUT/BR)", () => {
    const r = parseMatchArms(`<Editing><INPUT type="text"><BR></Editing>`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(1);
    expect(r.arms[0].variantName).toBe("Editing");
  });
});

// ---------------------------------------------------------------------------
// §2: NEGATIVE — a genuinely-unclosed NON-void arm still fires E-MATCH-PARSE-001
// ---------------------------------------------------------------------------

describe("§2: unclosed NON-void arm still fires E-MATCH-PARSE-001 (fix did not weaken detection)", () => {
  test("non-void `<div>` with no matching closer in the arm body fires E-MATCH-PARSE-001", () => {
    // The arm-opener `<Editing>` has an inner non-void `<div>` that is never
    // closed, so the arm has no matching `</>` / `</Editing>` at depth 0.
    const r = parseMatchArms(`<Editing><div>no closer here`);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain("E-MATCH-PARSE-001");
  });

  test("a bare void does NOT suppress a sibling unclosed non-void in the same arm", () => {
    // `<input>` is a leaf; the `<section>` is the genuinely-unclosed element.
    const r = parseMatchArms(`<Editing><input type="text"><section>oops`);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain("E-MATCH-PARSE-001");
  });
});

// ---------------------------------------------------------------------------
// §3: END-TO-END — full compile, void direct child of a match arm, exit-0
// ---------------------------------------------------------------------------

describe("§3: end-to-end compile — void direct child of a match arm compiles clean", () => {
  test("self-closed `<input/>` direct child — zero E- errors", () => {
    const r = compile(
      `\${
    type Phase:enum = { Viewing, Editing }
    @phase: Phase = .Viewing
    @name: string = "Bob"
}
<match for=Phase on=@phase>
    <Viewing> : <p>viewing</p>
    <Editing>
        <input type="text" bind:value=@name />
    </>
</match>
`,
      "self-closed.scrml",
    );
    expect(errorCodes(r)).not.toContain("E-MATCH-PARSE-001");
    expect(errorCodes(r)).not.toContain("E-CTX-001");
    expect((r.errors || []).length).toBe(0);
  });

  test("bare `<input>` (un-self-closed) direct child — zero E- errors", () => {
    const r = compile(
      `\${
    type Phase:enum = { Viewing, Editing }
    @phase: Phase = .Viewing
    @name: string = "Bob"
}
<match for=Phase on=@phase>
    <Viewing> : <p>viewing</p>
    <Editing>
        <input type="text" bind:value=@name>
    </>
</match>
`,
      "bare.scrml",
    );
    expect(errorCodes(r)).not.toContain("E-MATCH-PARSE-001");
    expect(errorCodes(r)).not.toContain("E-CTX-001");
    expect((r.errors || []).length).toBe(0);
  });

  test("`<br/>` + `<img/>` voids as direct children — zero E- errors", () => {
    const r = compile(
      `\${
    type Phase:enum = { Viewing, Editing }
    @phase: Phase = .Viewing
}
<match for=Phase on=@phase>
    <Viewing> : <p>viewing</p>
    <Editing>
        <br/>
        <img src="/avatar.png" alt="avatar" />
        <br>
    </>
</match>
`,
      "br-img.scrml",
    );
    expect(errorCodes(r)).not.toContain("E-MATCH-PARSE-001");
    expect(errorCodes(r)).not.toContain("E-CTX-001");
    expect((r.errors || []).length).toBe(0);
  });

  test("multiple voids + non-void siblings in one arm — zero E- errors", () => {
    const r = compile(
      `\${
    type Phase:enum = { Viewing, Editing }
    @phase: Phase = .Viewing
    @name: string = "Bob"
}
<match for=Phase on=@phase>
    <Viewing> : <p>viewing</p>
    <Editing>
        <label>Name</label>
        <input type="text" bind:value=@name>
        <br/>
        <img src="/avatar.png" alt="avatar" />
        <p data-note="edit">edit your name</p>
    </>
</match>
`,
      "mixed.scrml",
    );
    expect(errorCodes(r)).not.toContain("E-MATCH-PARSE-001");
    expect(errorCodes(r)).not.toContain("E-CTX-001");
    expect((r.errors || []).length).toBe(0);
  });
});
