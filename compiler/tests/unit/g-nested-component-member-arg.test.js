/**
 * g-nested-component-member-arg.test.js — regression gate for
 * g-nested-component-member-arg-misparse (S200, PA-direct fix).
 *
 * Bug: a component body passing a MEMBER-ACCESS arg to a NESTED component
 * (`<Badge s=row.name/>`) round-tripped through the logic tokenizer as
 * `s=row . name` (the `.` member operator gets space-padded). CE's component-
 * body normalization (`normalizeComponentBodyRaw`) collapsed call-form spacing
 * (`fn ( x )`→`fn(x)`) and the `@.`-each-sigil (`@ . id`→`@.id`) but NOT a
 * GENERAL member-access (`obj . field`). So the markup attribute tokenizer
 * (tokenizer.ts ~654) read `row` as ATTR_IDENT (stops at the space) and stranded
 * `.name` — either a phantom bare `name` attr → E-COMPONENT-011, or (when the
 * stranded segment matched a declared prop) a silent member-DROP
 * (`status=load.status` → `status=load`).
 *
 * Fix: component-expander.ts `normalizeComponentBodyRaw` — added a general
 * member-access collapse `obj . field` → `obj.field` (mirrors the existing
 * call-form + `@.`-sigil collapses). Chained access collapses left-to-right.
 *
 * Scope: component-body-only — a top-level `${for…lift}` nested-component arg
 * was never affected (it doesn't go through the component-body re-tokenization).
 *
 * S201 follow-on (g-each-inline-component-prop-member-unsubstituted, Approach B):
 * CE now also SUBSTITUTES the component's own prop when it is the leading
 * identifier of a member-access arg — `<Badge s=row.name/>` where the caller
 * passed `row=@val` becomes `s=@val.name` (the member-access TAIL is preserved;
 * the BASE is substituted to the caller value). The S200 regression these tests
 * guard is the TAIL preservation (the `.name`/`.inner.name`/`.status` survives,
 * not stranded as a phantom attr); they pass a VARIABLE prop so the substituted
 * base (`@val`) is recognizable end-to-end.
 */
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCEFile } from "../../src/component-expander.js";

function runCEOn(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const tabOut = buildAST(bsOut);
  return runCEFile(tabOut);
}

// GITI-039: the component-def `.raw` (and `shorthandBodyRaw`) is the PRE-
// substitution template source, which legitimately contains the un-substituted
// member arg (`<Badge s=row.name/>`). Before GITI-039 the mangle spaced it to
// `row . name`, so a whole-AST `not.toContain("row.name")` accidentally passed;
// now the raw is verbatim. The S200/S201 guard is about the EXPANDED USAGE
// nodes (where a stranded/dropped member would manifest), NOT the raw template —
// so exclude the raw template fields from the "no unsubstituted leak" check.
function stringifyWithoutRawTemplates(ast) {
  return JSON.stringify(ast, (key, value) =>
    (key === "raw" || key === "shorthandBodyRaw") ? undefined : value);
}

describe("g-nested-component-member-arg-misparse (S200)", () => {
  test("single member-access arg to a nested component — no E-COMPONENT-011, member tail preserved + base substituted", () => {
    const source = `<program>
\${ const Badge = <span props={ s: string } data-s="\${s}"/> }
\${ const Card = <div props={ row: string }><Badge s=row.name/></div> }
<Card row=@val/>
</program>`;
    const { ast, errors } = runCEOn(source);
    // Regression (S200): the `.name` was stranded as a phantom bare attr → E-COMPONENT-011.
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(0);
    // S201: the member-access BASE prop `row` is substituted to the caller value
    // `@val`; the `.name` TAIL is preserved (not stranded, not dropped).
    const j = stringifyWithoutRawTemplates(ast);
    expect(j).toContain("@val.name");
    expect(j).not.toContain("row.name");
  });

  test("chained member-access arg (row.inner.name) — no E-COMPONENT-011, chain tail preserved + base substituted", () => {
    const source = `<program>
\${ const Badge = <span props={ s: string } data-s="\${s}"/> }
\${ const Card = <div props={ row: string }><Badge s=row.inner.name/></div> }
<Card row=@val/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(0);
    // S201: base `row` -> `@val`; the full `.inner.name` chain tail survives.
    const j = stringifyWithoutRawTemplates(ast);
    expect(j).toContain("@val.inner.name");
    expect(j).not.toContain("row.inner.name");
  });

  test("member-arg whose stranded segment matches a declared prop — no silent member-drop, base substituted", () => {
    // The case-b shape: `status=load.status`. Pre-fix the `.status` stranded as a
    // phantom bare `status` (a DECLARED prop → no E-011) and the value dropped to
    // bare `load`. Post-S200 the member-access is preserved; post-S201 the BASE
    // prop `load` is also substituted to the caller value (`@row`).
    const source = `<program>
\${ const Badge = <span props={ status: string } data-st="\${status}"/> }
\${ const Card = <div props={ load: string }><Badge status=load.status/></div> }
<Card load=@row/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(0);
    // member NOT dropped + base substituted — `@row.status` (not bare `load` / `load.status`).
    const j = stringifyWithoutRawTemplates(ast);
    expect(j).toContain("@row.status");
    expect(j).not.toContain("load.status");
  });
});
