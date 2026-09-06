/**
 * S19 gauntlet Phase 1 — type annotation literal-mismatch (E-TYPE-031).
 *
 * Covers:
 *   - A12  `const n: number = "x"` → E-TYPE-031
 *   - A13  `let n: number = "x"` → E-TYPE-031
 *   - S402 the FULL §7.5.1 position-1 AND position-2 cell matrices — 3
 *     annotations x 4 literal forms, all 12 cells each, every one compiled.
 *
 * Unpredicated primitive annotations (`number`/`string`/`boolean`) must match
 * the initializer literal type. Predicated annotations are covered by §53.4 /
 * classifyPredicateZone; the cases at the bottom of this file pin the ONE way
 * the two interact.
 *
 * ⚑ WHY THE MATRIX IS EXHAUSTIVE RATHER THAN EXEMPLARY. Before S402 this check
 * held at 4 of the 8 off-diagonal cells and nobody knew, because the tests
 * sampled `number = "x"` twice. `string = true`, `number = true`,
 * ``number = `tpl` `` and ``boolean = `tpl` `` all compiled silently against a
 * §7.5.1 that says they SHALL NOT. A partial matrix reads exactly like a
 * complete one from the outside, which is the failure mode this replaces.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-typeannot-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      typeErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-TYPE")),
      emittedJs: collectEmittedJs(result),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Concatenate every JS artifact the compile produced. `compileScrml` returns
 * `outputs` even under `write: false`, so a test can assert on what codegen
 * ACTUALLY emitted rather than inferring it from the absence of a diagnostic —
 * which is the distinction a §53 runtime guard turns on.
 */
function collectEmittedJs(result) {
  const outs = result.outputs;
  if (!outs || typeof outs.values !== "function") return "";
  const parts = [];
  for (const o of outs.values()) {
    for (const k of ["clientJs", "serverJs", "libraryJs"]) {
      if (o && typeof o[k] === "string") parts.push(o[k]);
    }
  }
  return parts.join("\n");
}

function codes(errors) {
  return errors.map(e => e.code).sort();
}

describe("S19 gauntlet Phase 1 — type annotation literal mismatch", () => {

  test("A12: const n: number = \"x\" → E-TYPE-031", () => {
    const src = `\${
    const n: number = "not a number"
}
<p>\${n}</>`;
    const { typeErrors } = compileWholeScrml(src, "a12-const-mismatch");
    expect(codes(typeErrors)).toContain("E-TYPE-031");
  });

  test("A13: let n: number = \"x\" → E-TYPE-031", () => {
    const src = `\${
    let n: number = "not a number"
}
<p>\${n}</>`;
    const { typeErrors } = compileWholeScrml(src, "a13-let-mismatch");
    expect(codes(typeErrors)).toContain("E-TYPE-031");
  });

  test("const n: number = 5 compiles clean (matching literal)", () => {
    const src = `\${
    const n: number = 5
}
<p>\${n}</>`;
    const { typeErrors } = compileWholeScrml(src, "const-match");
    expect(codes(typeErrors)).toEqual([]);
  });

  test("const s: string = \"hi\" compiles clean (matching literal)", () => {
    const src = `\${
    const s: string = "hi"
}
<p>\${s}</>`;
    const { typeErrors } = compileWholeScrml(src, "const-string-match");
    expect(codes(typeErrors)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §7.5.1 position 1 — the FULL cell matrix (S402)
// ---------------------------------------------------------------------------

/** The four literal forms scrml has for a §7.5 primitive, and what each denotes. */
const LITERAL_FORMS = [
  { tag: "string literal", src: '"nope"', denotes: "string" },
  { tag: "number literal", src: "42", denotes: "number" },
  { tag: "boolean literal", src: "true", denotes: "boolean" },
  { tag: "template literal", src: "`tpl`", denotes: "string" },
];

const PRIMITIVE_ANNOTATIONS = ["number", "string", "boolean"];

describe("§7.5.1 position 1 — every annotation x literal cell, compiled", () => {
  for (const annot of PRIMITIVE_ANNOTATIONS) {
    for (const form of LITERAL_FORMS) {
      const matches = annot === form.denotes;
      const label = `let v: ${annot} = ${form.src}`;
      test(`${label} → ${matches ? "clean" : "E-TYPE-031"}`, () => {
        const src = `\${
    let v: ${annot} = ${form.src}
    log(v)
}
<p>ok</>`;
        const id = `pos1-${annot}-${form.denotes}-${form.src.replace(/\W+/g, "")}`;
        const { typeErrors } = compileWholeScrml(src, id);
        if (matches) expect(codes(typeErrors)).toEqual([]);
        else expect(codes(typeErrors)).toContain("E-TYPE-031");
      });
    }
  }
});

// ---------------------------------------------------------------------------
// §7.5.1 position 2 — the annotated STATE-CELL declaration (S402)
// ---------------------------------------------------------------------------

/**
 * `<n>: number = "nope"` was position 2 in §7.5.1's MEASURED table, and it read
 * "not checked" until S402. A state cell is where an adopter's data actually
 * lives, so of the four unchecked positions this was the one carrying the most
 * weight — and it is the same rule as position 1, at a different node.
 */
describe("§7.5.1 position 2 — every annotation x literal cell, compiled", () => {
  for (const annot of PRIMITIVE_ANNOTATIONS) {
    for (const form of LITERAL_FORMS) {
      const matches = annot === form.denotes;
      const label = `<v>: ${annot} = ${form.src}`;
      test(`${label} → ${matches ? "clean" : "E-TYPE-031"}`, () => {
        const src = `<v>: ${annot} = ${form.src}
<p>ok</>`;
        const id = `pos2-${annot}-${form.denotes}-${form.src.replace(/\W+/g, "")}`;
        const { typeErrors } = compileWholeScrml(src, id);
        if (matches) expect(codes(typeErrors)).toEqual([]);
        else expect(codes(typeErrors)).toContain("E-TYPE-031");
      });
    }
  }

  test("`int` is OUTSIDE §7.5.1's enumerated set and stays silent", () => {
    // §7.5.1 enumerates `number`, `string`, `boolean` and nothing else, and
    // SPEC rules `int`/`number` assignability NOWHERE. Firing here would be
    // inventing a rule, not enforcing one.
    const src = `<n>: int = "not a number"
<p>ok</>`;
    const { typeErrors } = compileWholeScrml(src, "pos2-int-out-of-set");
    expect(codes(typeErrors)).toEqual([]);
  });

  test("an optional annotation initialized to `not` stays silent", () => {
    const src = `<s>: string | not = not
<p>ok</>`;
    const { typeErrors } = compileWholeScrml(src, "pos2-optional-not");
    expect(codes(typeErrors)).toEqual([]);
  });

  test("an un-annotated cell is not a position-2 site at all", () => {
    const src = `<n> = 0
<p>ok</>`;
    const { typeErrors } = compileWholeScrml(src, "pos2-no-annotation");
    expect(codes(typeErrors)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §7.5.1 x §53.4 — the widening must not reach into the predicate zone
// ---------------------------------------------------------------------------

/**
 * A widening that also rejects valid code is not a win. §7.5.1's literal set
 * feeds `classifyPredicateZone`, which evaluates a `literal` source's VALUE at
 * compile time and ELIDES the runtime guard when it can. Two of the four
 * literal forms S402 added carry no usable value there:
 *
 *   - an INTERPOLATED template's parsed `value` is `""`, which is not its text;
 *   - a BOOLEAN is outside `evaluatePredicateOnLiteral`'s domain entirely, and
 *     `checkPredicateLiteral` returns `null` for one by construction.
 *
 * Treating either as a decided literal would statically reject a program that
 * satisfies its predicate at runtime, AND delete the guard that would have
 * caught the case where it does not. Both directions are pinned below.
 */
describe("§7.5.1 x §53.4 — the literal set does not decide what it cannot decide", () => {

  test("an INTERPOLATED template at a predicated annotation stays a runtime check", () => {
    const src = `\${
    let a = "hello"
    let s: string(.length >= 5) = \`\${a} world\`
    log(s)
}
<p>ok</>`;
    const { errors, emittedJs } = compileWholeScrml(src, "pred-tpl-interp");
    expect(codes(errors)).toEqual([]);
    // Absence of a diagnostic is not the assertion — the GUARD is.
    expect(emittedJs).toContain("E-CONTRACT-001-RT");
  });

  test("an interpolated template is NOT statically failed against its predicate", () => {
    // `a` is 2 characters, so the empty cooked value would fail `.length >= 5`
    // if the compiler mistook it for the template's value. The predicate is
    // undecidable here and must stay that way.
    const src = `\${
    let a = "hi"
    let s: string(.length >= 5) = \`\${a}\`
    log(s)
}
<p>ok</>`;
    const { errors, emittedJs } = compileWholeScrml(src, "pred-tpl-interp-short");
    expect(codes(errors)).not.toContain("E-CONTRACT-001");
    expect(emittedJs).toContain("E-CONTRACT-001-RT");
  });

  test("a STATIC template IS decided — parity with the double-quoted form", () => {
    const mk = (init) => `\${
    let s: string(.length >= 5) = ${init}
    log(s)
}
<p>ok</>`;
    const tpl = compileWholeScrml(mk("`hi`"), "pred-tpl-static-fail");
    const str = compileWholeScrml(mk('"hi"'), "pred-str-static-fail");
    expect(codes(tpl.errors)).toContain("E-CONTRACT-001");
    expect(codes(str.errors)).toContain("E-CONTRACT-001");
  });

  test("a BOOLEAN at a predicated numeric annotation stays a runtime check, not a silent pass", () => {
    const src = `\${
    let x: number(>0) = true
    log(x)
}
<p>ok</>`;
    const { errors, emittedJs } = compileWholeScrml(src, "pred-bool-numeric");
    // §7.5.1 position 1 is scoped to UNPREDICATED annotations, so E-TYPE-031
    // does not fire here — but the §53 boundary guard must not be dropped
    // either, which is what a "static" zone classification would do.
    expect(codes(errors)).toEqual([]);
    expect(emittedJs).toContain("E-CONTRACT-001-RT");
  });
});
