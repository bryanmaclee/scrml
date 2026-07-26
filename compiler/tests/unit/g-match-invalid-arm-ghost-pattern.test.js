/**
 * g-match-invalid-arm-ghost-pattern.test.js — a `<match>` arm-position tag that
 * is NOT a variant-named arm or the `<_>` wildcard (the Ghost-Pattern
 * `<when is="…">`) is REJECTED with E-MATCH-INVALID-ARM (SPEC §18.0.1 + §34).
 *
 * GAP (g-match-without-for-plus-when-children-silent-undeclared-dispatch, HIGH):
 *
 *   `<match on=@status>` (or `<match for=T on=@status>`) with `<when is="ok">…`
 *   children compiled with 0 errors: the Phase-2 arm tokenizer only recognises
 *   `<`+`[A-Z_]` openers as arms, so a lowercase `<when>` at the arm position was
 *   silently skipped as "stray content" → ZERO recognised arms → the match
 *   tree-shook to nothing → a DEAD PAGE emitted with 0 errors (the worst failure
 *   shape). Neither half of that source is scrml — there is no `<when>` element
 *   and block-form arms must be variant-named; it is the Vue/Svelte-ish
 *   conditional an LLM / framework-refugee reaches for.
 *
 *   S288 CORRECTION to the original gap direction: `<match on=@cell>` WITHOUT
 *   `for=` is a LEGITIMATE, supported form (type inferred from the on-cell's
 *   declared enum — see e-dg-002-false-positive-class + match-on-atdot-in-each).
 *   So "reject match without for=" was wrong (it would break valid code). The
 *   real defect is the un-flagged ghost ARM. The fix rejects the invalid arm tag
 *   at parse time and skips the whole stray element as a unit, so a following
 *   real arm still parses and nested lowercase children are not double-flagged.
 *
 * Fix locus: match-statechild-parser.ts parseMatchArms main-loop stray branch.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { parseMatchArms } from "../../src/match-statechild-parser.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/g-match-invalid-arm-ghost-pattern");
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

function errorCodes(result) {
  return (result.errors || []).map((e) => e.code);
}

// ---------------------------------------------------------------------------
// §1: parseMatchArms — the ghost `<when>` arm is flagged, not silently dropped
// ---------------------------------------------------------------------------

describe("§1: parseMatchArms flags a ghost `<when>` at the arm position", () => {
  test("a single `<when is>` arm → E-MATCH-INVALID-ARM, zero recognised arms", () => {
    const r = parseMatchArms(`<when is="ok"><p>All good</p></when>`);
    expect(r.arms.length).toBe(0);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E-MATCH-INVALID-ARM"]);
    expect(r.diagnostics[0].message).toContain("<when>");
    expect(r.diagnostics[0].message).toContain("Vue/Svelte");
  });

  test("two `<when>` arms → exactly two diagnostics (one per stray element)", () => {
    const r = parseMatchArms(
      `<when is="ok"><p>All good</p></when><when is="err"><p>Broken</p></when>`,
    );
    expect(r.arms.length).toBe(0);
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      "E-MATCH-INVALID-ARM",
      "E-MATCH-INVALID-ARM",
    ]);
  });

  test("nested lowercase children inside the stray element are NOT double-flagged", () => {
    // `<p>` lives inside the `<when>` body — the element is consumed as a unit,
    // so only ONE diagnostic (for `<when>`), never one for `<p>` too.
    const r = parseMatchArms(`<when is="ok"><div><p><span>x</span></p></div></when>`);
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0].code).toBe("E-MATCH-INVALID-ARM");
  });

  test("a self-closing ghost `<when/>` is flagged and recovery continues", () => {
    const r = parseMatchArms(`<when is="ok"/><Ok><p>fine</p></Ok>`);
    // `<Ok>` after the self-closed stray still parses.
    expect(r.arms.map((a) => a.variantName)).toEqual(["Ok"]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E-MATCH-INVALID-ARM"]);
  });

  test("MIXED — a valid `<Ok>` arm + a ghost `<when>` → arm kept, ghost flagged", () => {
    const r = parseMatchArms(`<Ok><p>All good</p></Ok><when is="err"><p>Broken</p></when>`);
    expect(r.arms.map((a) => a.variantName)).toEqual(["Ok"]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E-MATCH-INVALID-ARM"]);
  });
});

// ---------------------------------------------------------------------------
// §2: no-regression — valid arm shapes stay clean
// ---------------------------------------------------------------------------

describe("§2: valid match-arm shapes are untouched", () => {
  test("variant + wildcard arms → zero diagnostics", () => {
    const r = parseMatchArms(`<Ok><p>good</p></Ok><Err><p>bad</p></Err><_><p>?</p></_>`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.map((a) => a.variantName)).toEqual(["Ok", "Err", "_"]);
  });

  test("lowercase tags INSIDE an arm body are body content, not flagged", () => {
    const r = parseMatchArms(`<Editing><form><input type="text"><label>x</label></form></Editing>`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.length).toBe(1);
    expect(r.arms[0].bodyRaw).toContain("<form>");
  });

  test("a comment between arms is still skipped (no false positive)", () => {
    const r = parseMatchArms(`<Ok> : "a"\n<!-- a note about <when> patterns -->\n<Err> : "b"`);
    expect(r.diagnostics.length).toBe(0);
    expect(r.arms.map((a) => a.variantName)).toEqual(["Ok", "Err"]);
  });
});

// ---------------------------------------------------------------------------
// §3: end-to-end — the reported dead-page shape now errors, valid stays clean
// ---------------------------------------------------------------------------

const WHEN_GHOST = `<program>
<div>
  \${
    type Status:enum = { Ok, Err }
    <status>: Status = .Ok
  }
  <match on=@status>
    <when is="ok"><p>All good</p></when>
    <when is="err"><p>Broken</p></when>
  </match>
</div>
</program>
`;

const VALID_NOFOR = `<program>
<div>
  \${
    type Status:enum = { Ok, Err }
    <status>: Status = .Ok
  }
  <match on=@status>
    <Ok><p>All good</p></Ok>
    <Err><p>Broken</p></Err>
  </match>
</div>
</program>
`;

describe("§3: end-to-end compile", () => {
  test("the reported ghost shape (enum cell, no for=, `<when>`) → E-MATCH-INVALID-ARM (not a dead page)", () => {
    const r = compile(WHEN_GHOST, "when-ghost.scrml");
    expect(errorCodes(r)).toContain("E-MATCH-INVALID-ARM");
  });

  test("the valid inferred-type form (no for=, variant arms) still compiles clean", () => {
    const r = compile(VALID_NOFOR, "valid-nofor.scrml");
    expect(r.errors || []).toHaveLength(0);
  });
});
