/**
 * Parse import-pinned — Phase A1a Step 7
 *
 * Step 7 — extend the import-decl parser to recognize the `pinned` bareword
 * modifier on per-item imports (`import { foo pinned } from '...'`). Per
 * SPEC §21.8.1, `pinned` applies the §6.10 identity-stability contract to
 * the imported binding in the importing file's scope.
 *
 * **Scope:** parser-only. NO semantic enforcement (E-IMPORT-PINNED-INVALID
 * cycle/context check is A1b). NO codegen hoisting (A1c).
 *
 * **AST contract (per `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md` §1.4):**
 * - `ImportDeclNode.specifiers[]` carries per-item `{ imported, local, pinned }`.
 * - `pinned: boolean` defaults to `false`; set `true` only when the bareword
 *   `pinned` follows the imported name (and any optional `as <alias>`).
 *
 * **Disambiguation rule (per AST-CONTRACTS §2.1):** `pinned` is NOT a global
 * KEYWORD — it's a contextual bareword. So `import { pinned } from '...'`
 * imports a name *called* `pinned` (no modifier). The modifier is the LAST
 * whitespace-separated token AND its predecessor is NOT `as`.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function findImport(ast) {
  if (ast?.imports?.length) return ast.imports[0];
  return ast?.body?.find((n) => n.kind === "import-decl") ?? null;
}

describe("A1a Step 7 — `pinned` bareword on import items", () => {
  // -------------------------------------------------------------------------
  // §I7.1 — single pinned item
  // -------------------------------------------------------------------------
  test("§I7.1 `import { foo pinned }` sets pinned:true on that item", () => {
    const src = `<program>\n\${ import { foo pinned } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp).toBeTruthy();
    expect(imp.kind).toBe("import-decl");
    expect(imp.names).toEqual(["foo"]);
    expect(imp.specifiers).toHaveLength(1);
    expect(imp.specifiers[0]).toEqual({ imported: "foo", local: "foo", pinned: true });
    expect(imp.source).toBe("./m.scrml");
    expect(imp.isDefault).toBe(false);
  });

  // -------------------------------------------------------------------------
  // §I7.2 — bare regression: no pinned anywhere
  // -------------------------------------------------------------------------
  test("§I7.2 `import { foo, bar }` regression — both items pinned:false", () => {
    const src = `<program>\n\${ import { foo, bar } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.names).toEqual(["foo", "bar"]);
    expect(imp.specifiers).toHaveLength(2);
    expect(imp.specifiers[0]).toEqual({ imported: "foo", local: "foo", pinned: false });
    expect(imp.specifiers[1]).toEqual({ imported: "bar", local: "bar", pinned: false });
  });

  // -------------------------------------------------------------------------
  // §I7.3 — multi-item with mixed pinned flags
  // -------------------------------------------------------------------------
  test("§I7.3 `import { foo pinned, bar, baz pinned }` — mixed flags", () => {
    const src = `<program>\n\${ import { foo pinned, bar, baz pinned } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.names).toEqual(["foo", "bar", "baz"]);
    expect(imp.specifiers).toHaveLength(3);
    expect(imp.specifiers[0].pinned).toBe(true);
    expect(imp.specifiers[1].pinned).toBe(false);
    expect(imp.specifiers[2].pinned).toBe(true);
    // imported/local consistency
    expect(imp.specifiers[0].imported).toBe("foo");
    expect(imp.specifiers[0].local).toBe("foo");
    expect(imp.specifiers[1].imported).toBe("bar");
    expect(imp.specifiers[2].imported).toBe("baz");
  });

  // -------------------------------------------------------------------------
  // §I7.4 — alias + pinned together
  // -------------------------------------------------------------------------
  test("§I7.4 `import { foo as bar pinned }` — alias + modifier", () => {
    const src = `<program>\n\${ import { foo as bar pinned } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.names).toEqual(["foo"]);
    expect(imp.specifiers).toHaveLength(1);
    expect(imp.specifiers[0]).toEqual({ imported: "foo", local: "bar", pinned: true });
  });

  // -------------------------------------------------------------------------
  // §I7.5 — alias regression: alias only, no pinned
  // -------------------------------------------------------------------------
  test("§I7.5 `import { foo as bar }` regression — alias preserved, pinned:false", () => {
    const src = `<program>\n\${ import { foo as bar } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.names).toEqual(["foo"]);
    expect(imp.specifiers).toHaveLength(1);
    expect(imp.specifiers[0]).toEqual({ imported: "foo", local: "bar", pinned: false });
  });

  // -------------------------------------------------------------------------
  // §I7.6 — default-import regression: pinned NOT applied
  // -------------------------------------------------------------------------
  test("§I7.6 `import foo from '...'` (default) — no specifiers, isDefault:true", () => {
    const src = `<program>\n\${ import foo from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.names).toEqual(["foo"]);
    expect(imp.isDefault).toBe(true);
    // Default imports don't populate specifiers[] (per existing parser contract).
    expect(imp.specifiers ?? []).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // §I7.7 — `pinned` as the imported name itself (no modifier)
  //
  // Disambiguation: `pinned` is contextual, not a global keyword. So
  // `import { pinned }` imports the name `pinned` with NO modifier (length<2
  // → no strip).
  // -------------------------------------------------------------------------
  test("§I7.7 `import { pinned } from '...'` — imports name `pinned`, no modifier", () => {
    const src = `<program>\n\${ import { pinned } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.names).toEqual(["pinned"]);
    expect(imp.specifiers).toHaveLength(1);
    expect(imp.specifiers[0]).toEqual({ imported: "pinned", local: "pinned", pinned: false });
  });

  // -------------------------------------------------------------------------
  // §I7.8 — alias TO `pinned` (no modifier)
  //
  // Disambiguation: `foo as pinned` could be alias-to-`pinned` OR
  // modifier-on-`foo`. Per the rule "modifier ONLY when predecessor is not
  // `as`", `foo as pinned` is alias-to-`pinned` (no modifier).
  // -------------------------------------------------------------------------
  test("§I7.8 `import { foo as pinned } from '...'` — alias to name `pinned`, no modifier", () => {
    const src = `<program>\n\${ import { foo as pinned } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.specifiers).toHaveLength(1);
    expect(imp.specifiers[0]).toEqual({ imported: "foo", local: "pinned", pinned: false });
  });

  // -------------------------------------------------------------------------
  // §I7.9 — quoted import name (S40 P3.A) + pinned
  //
  // Channel exports use quoted kebab-case names. The quote-stripping path
  // (`_stripQuotes`) must compose with the new `_splitPinned` helper.
  // -------------------------------------------------------------------------
  test('§I7.9 `import { "dispatch-board" as dispatchBoard pinned }` — quote-stripped + pinned', () => {
    const src = `<program>\n\${ import { "dispatch-board" as dispatchBoard pinned } from './m.scrml' }\n</program>`;
    const { ast } = parse(src);
    const imp = findImport(ast);
    expect(imp.names).toEqual(["dispatch-board"]);
    expect(imp.specifiers).toHaveLength(1);
    expect(imp.specifiers[0]).toEqual({ imported: "dispatch-board", local: "dispatchBoard", pinned: true });
  });

  // -------------------------------------------------------------------------
  // §I7.10 — every specifier has `typeof pinned === "boolean"` invariant
  //
  // Enforces that the parser NEVER returns `pinned: undefined`. Catches the
  // regression where a code path forgets to set the default.
  // -------------------------------------------------------------------------
  test("§I7.10 every specifier has typeof pinned === 'boolean' invariant", () => {
    const fixtures = [
      `\${ import { a } from './m.scrml' }`,
      `\${ import { a, b, c } from './m.scrml' }`,
      `\${ import { a pinned } from './m.scrml' }`,
      `\${ import { a as b } from './m.scrml' }`,
      `\${ import { a as b pinned } from './m.scrml' }`,
      `\${ import { a pinned, b, c pinned } from './m.scrml' }`,
      `\${ import { "kebab-name" as bar } from './m.scrml' }`,
    ];
    for (const inner of fixtures) {
      const src = `<program>\n${inner}\n</program>`;
      const { ast } = parse(src);
      const imp = findImport(ast);
      expect(imp).toBeTruthy();
      expect(Array.isArray(imp.specifiers)).toBe(true);
      for (const s of imp.specifiers) {
        expect(typeof s.pinned).toBe("boolean");
        expect(typeof s.imported).toBe("string");
        expect(typeof s.local).toBe("string");
      }
    }
  });
});
