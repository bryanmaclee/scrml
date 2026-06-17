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

describe("g-nested-component-member-arg-misparse (S200)", () => {
  test("single member-access arg to a nested component — no E-COMPONENT-011, member preserved", () => {
    const source = `<program>
\${ const Badge = <span props={ s: string } data-s="\${s}"/> }
\${ const Card = <div props={ row: string }><Badge s=row.name/></div> }
<Card row="x"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    // Regression: the `.name` was stranded as a phantom bare attr → E-COMPONENT-011.
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(0);
    // Member preserved end-to-end (not dropped to bare `row`).
    expect(JSON.stringify(ast)).toContain("row.name");
  });

  test("chained member-access arg (row.inner.name) — no E-COMPONENT-011, chain preserved", () => {
    const source = `<program>
\${ const Badge = <span props={ s: string } data-s="\${s}"/> }
\${ const Card = <div props={ row: string }><Badge s=row.inner.name/></div> }
<Card row="x"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(0);
    expect(JSON.stringify(ast)).toContain("row.inner.name");
  });

  test("member-arg whose stranded segment matches a declared prop — no silent member-drop", () => {
    // The case-b shape: `status=load.status`. Pre-fix the `.status` stranded as a
    // phantom bare `status` (a DECLARED prop → no E-011) and the value dropped to
    // bare `load`. Post-fix the value is the full `load.status`.
    const source = `<program>
\${ const Badge = <span props={ status: string } data-st="\${status}"/> }
\${ const Card = <div props={ load: string }><Badge status=load.status/></div> }
<Card load="x"/>
</program>`;
    const { ast, errors } = runCEOn(source);
    const e011 = errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011).toHaveLength(0);
    // member NOT dropped — the full `load.status` survives (not bare `load`).
    expect(JSON.stringify(ast)).toContain("load.status");
  });
});
