/**
 * Bug R28-2 (S143) — tableFor `<column>` row-access broken BOTH documented ways.
 *
 * Symptom (PA-verified, gauntlet R28):
 *   1. The SPEC §41.16.3-MANDATED parametric-slot form
 *        `<column field="status" :let={(r) => <span>${r.status}</span>}/>`
 *      was forwarded as a plain HTML attribute (W-ATTR-001) and the slot body
 *      was DISCARDED (the column fell through to default-render). Root cause:
 *      the tokenizer drops the leading `:` so `:let` arrives as `let` carrying
 *      an opaque `expr` value (the arrow text); the arrow-body markup was never
 *      parsed into AST.
 *   2. The §41.16.10-deferred implicit form
 *        `<column field="status"><span>${@row.status}</span></column>`
 *      compiled but emitted `_scrml_reactive_get("row").status` — reading a
 *      NONEXISTENT reactive cell named "row" instead of the per-row loop local.
 *
 * Fix:
 *   - PRIMARY (`:let` form): type-system column walk re-parses the
 *     `(param) => <markup>` arrow body into slot-body AST via splitBlocks +
 *     buildAST (the §16.6 machinery); the param becomes the row-binding name.
 *     `let` recognized as the colon-stripped alias of `:let` on `<column>` so
 *     no spurious W-ATTR-001 / HTML leak.
 *   - SECONDARY (`@row` form): emit-table-for rewriteAtDotInExprText also
 *     strips the leading `@` from the EXACT row-binding name → resolves to the
 *     loop local (matching the `${row.status}` form). Genuine `@cell` refs
 *     (any other ident) are untouched.
 *
 * Spec references:
 *   §41.16.3  — column slot grammar; slot body SHALL expose row via
 *               `:let={(row) => ...}` per §16.6
 *   §16.6     — parametric-slot `:let={(...) => markup}` scope
 *   §41.16.10 — defers implicit `@row` magic var to v1.next (but the
 *               silent-wrong `_scrml_reactive_get("row")` lowering is a BUG)
 *
 * Cross-refs: re-opens the DEFERRED Bug 54 (`tableFor :let` parse-layer).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "r28-bug-2-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function realErrors(result) {
  return (result.errors || []).filter((e) => e && e.severity !== "warning" && e.severity !== "info");
}

function compile(filename, source) {
  const abs = fx(filename, source);
  return compileScrml({
    inputFiles: [abs],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
  });
}

function getClientJs(result) {
  const outputs = result.outputs;
  if (!outputs) return "";
  for (const [, v] of outputs) {
    if (typeof v === "object" && v && foldChunkNamespacing(v.clientJs)) return foldChunkNamespacing(v.clientJs);
  }
  return "";
}

// Collect all diagnostics (errors + warnings + info) into one array for
// cross-stream code assertions (W-ATTR-001 lands in warnings, not errors).
function allDiagnostics(result) {
  return [...(result.errors || []), ...(result.warnings || [])];
}

// ---------------------------------------------------------------------------
// §1 — `:let={(name) => <markup>}` parametric-slot (PRIMARY / §41.16.3 canon)
// ---------------------------------------------------------------------------

describe("§1 :let parametric-slot form", () => {
  test("`:let={(r) => <span>${r.status}</span>}` emits the slot body + row-field access (no W-ATTR-001)", () => {
    const result = compile("let-basic.scrml", `<program title="LetBasic">
\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    name:   string
    status: string
  }

  <users>: User[] = []
}

<tableFor for=User rows=@users>
  <column field="name"/>
  <column field="status" :let={(r) => <span class="badge">\${r.status}</span>}/>
</tableFor>
</program>
`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    // Slot body markup is emitted (the <span>), NOT discarded.
    expect(js).toContain('document.createElement("span")');
    // The row-field access uses the adopter's binding name `r`.
    expect(js).toContain("r.status");
    // W-ATTR-001 must NOT fire on the consumed `:let` / `let` attribute.
    const attr001 = allDiagnostics(result).filter(
      (d) => d && d.code === "W-ATTR-001" && /\blet\b/.test(d.message || ""),
    );
    expect(attr001).toEqual([]);
  });

  test("adopter binding name flows to the for-loop binding (`:let={(row) => ...}`)", () => {
    const result = compile("let-rowname.scrml", `<program title="LetRow">
\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    name:   string
    status: string
  }

  <users>: User[] = []
}

<tableFor for=User rows=@users>
  <column field="status" :let={(row) => <em>\${row.status}</em>}/>
</tableFor>
</program>
`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    expect(js).toContain('document.createElement("em")');
    expect(js).toContain("row.status");
  });
});

// ---------------------------------------------------------------------------
// §2 — `@row` children-bearing form (SECONDARY)
// ---------------------------------------------------------------------------

describe("§2 @row children-bearing slot form", () => {
  test("`${@row.status}` lowers to the loop local `row.status` (not _scrml_reactive_get(\"row\"))", () => {
    const result = compile("atrow-basic.scrml", `<program title="AtRow">
\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    name:   string
    status: string
  }

  <users>: User[] = []
}

<tableFor for=User rows=@users>
  <column field="name"/>
  <column field="status">
    <span class="badge">\${@row.status}</span>
  </column>
</tableFor>
</program>
`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    expect(js).toContain("row.status");
    // The bug surface: a reactive read of a nonexistent "row" cell.
    expect(js).not.toContain('_scrml_reactive_get("row")');
    expect(js).not.toContain("_scrml_reactive_get('row')");
  });

  test("bare `${@row}` lowers to the loop local `row` (no reactive read)", () => {
    const result = compile("atrow-bare.scrml", `<program title="AtRowBare">
\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    name: string
  }

  <users>: User[] = []
}

<tableFor for=User rows=@users>
  <column field="name">
    <code>\${@row.name}</code>
  </column>
</tableFor>
</program>
`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    // ss21 g-tablefor-column-slot-literal-interp — the column slot's ${@row.name}
    // must be LOWERED to a reactive loop-local read, NOT shipped as the literal
    // interpolation string. The prior lone `toContain("row.name")` MASKED the bug:
    // "row.name" is a substring of the un-lowered literal "${@row.name}", so it
    // passed on the bug. Assert the literal interpolation does NOT survive.
    expect(js).not.toContain("${@row.name}");
    expect(js).toContain("row.name");
    expect(js).not.toContain('_scrml_reactive_get("row")');
  });
});

// ---------------------------------------------------------------------------
// §3 — genuine `@cell` references are NOT clobbered by the @row rewrite
// ---------------------------------------------------------------------------

describe("§3 @cell preservation regression-guard", () => {
  test("a genuine outer `@flag` cell in a slot body keeps its reactive read", () => {
    const result = compile("at-cell.scrml", `<program title="AtCell">
\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    name: string
  }

  <users>: User[] = []
  <flag> = true
}

<tableFor for=User rows=@users>
  <column field="name">
    <span if=\${@flag}>\${@row.name}</span>
  </column>
</tableFor>
</program>
`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    // Per-row binding → loop local.
    expect(js).toContain("row.name");
    expect(js).not.toContain('_scrml_reactive_get("row")');
    // The genuine outer cell `@flag` still reads reactively (the `@row` rewrite
    // is scoped to the EXACT row-binding name only).
    expect(js).toContain('_scrml_reactive_get("flag")');
  });

  test("a sibling cell whose name is a superstring of the row binding (`@rowItem`) is untouched", () => {
    const result = compile("at-superstring.scrml", `<program title="AtSuperstr">
\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    name: string
  }

  <users>: User[] = []
  <rowItem> = "x"
}

<tableFor for=User rows=@users>
  <column field="name">
    <span>\${@rowItem}</span>
  </column>
</tableFor>
</program>
`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    // `@rowItem` is a different cell — the row-binding (`row`) rewrite must NOT
    // strip its `@` (negative-lookahead boundary guard).
    expect(js).toContain('_scrml_reactive_get("rowItem")');
  });
});
