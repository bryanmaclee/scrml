/**
 * schema-html-leak-r25-bug-41.test.js — `<schema>` body content must NOT leak
 * into the emitted HTML body.
 *
 * R25-Bug-41 (HIGH, S138) — gauntlet R25 dev-2-elixir reproducer: a compiled
 * `<program>` with a `<schema>` block rendered the schema's raw DDL text as
 * visible prose in the HTML body, e.g.:
 *
 *   <body>
 *       cards {
 *           id:    integer primary key
 *           title: text not null
 *       }
 *       ...
 *   </body>
 *
 * Root cause: `<schema>` normalizes to a state-block (`node.kind === "state"`,
 * `stateType: "schema"`) at ast-builder.js:10870-10888. emit-html.ts's
 * state-kind branch unconditionally walked children — the children include
 * raw text nodes for the DDL, which then hit the text-kind branch and got
 * pushed into the HTML body.
 *
 * Fix (compiler/src/codegen/emit-html.ts):
 *   - Add `SERVER_ONLY_STATE_TYPES = new Set(["schema", "seeds"])` to the
 *     header constants alongside `LIFECYCLE_SILENT_TAGS`.
 *   - Modify the state-kind branch in `emitNode` to early-return when the
 *     state's `stateType` is in that set. The state-block's body is consumed
 *     by upstream passes (schemaFor walker / migration diff / seed runner)
 *     and never belongs in the HTML render-tree.
 *
 * `<db>` / `<engine>` / `<engine>` are NOT in the exclusion set:
 *   - `<db>` bodies are canonically `${ ... }` logic contexts (declarations
 *     only — no DOM emission by the markup-walker).
 *   - `<engine>` / `<engine>` route upstream to `engine-decl` AST shape; the
 *     state-kind branch never sees them.
 *
 * Coverage:
 *   §1 — minimal reproducer (schema + page): DDL text not in HTML
 *   §2 — multi-table schema: no leak of any table or column
 *   §3 — column names that are plausible English words ("title", "description"):
 *        the FIX must exclude the schema block structurally, not by string match
 *   §4 — positive control: `<page>` body text IS in HTML (regression-guard)
 *   §5 — `<schema>` AFTER `<page>` in source order — exclusion is structural,
 *        not positional
 *   §6 — `<program>` with multiple `<page>` siblings — exclusion holds across
 *        page boundaries
 *   §7 — `<schema>` with `${ schemaFor(T) }` interpolation — the rewritten
 *        text-child (synthesized by the schemaFor walker) must also be
 *        suppressed
 *   §8 — `<schema>` containing a normal table-decl + a `${ schemaFor(T) }`
 *        composition — interleaved hand-authored + walker-rewritten — both
 *        suppressed
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/schema-html-leak-r25-bug-41");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

function htmlOf(result, path) {
  return result.outputs.get(path)?.html ?? "";
}

// =============================================================================
// §1 — minimal reproducer
// =============================================================================

describe("§1 — `<schema>` body content must NOT leak into HTML", () => {
  let p;
  beforeAll(() => {
    p = fix("minimal.scrml", `<program title="repro" db="./test.db">

    < schema>
        cards {
            id:    integer primary key
            title: text not null
        }
    </>

    <page>
        <h1>Hello World</h1>
    </page>

</program>
`);
  });

  test("compiles without HTML-emit errors", () => {
    const result = compile(p);
    const cgErrors = (result.errors ?? []).filter(
      (e) => (e.severity == null || e.severity === "error") && (e.stage === "CG" || (e.code ?? "").startsWith("E-CG")),
    );
    expect(cgErrors).toEqual([]);
  });

  test("emitted HTML does not contain DDL column declarations", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toContain("integer primary key");
    expect(html).not.toContain("text not null");
  });

  test("emitted HTML does not contain the schema table name as prose", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    // The bare table-name + opening brace shape is unique to leaked DDL.
    expect(html).not.toMatch(/cards\s*\{/);
  });
});

// =============================================================================
// §2 — multi-table schema
// =============================================================================

describe("§2 — multi-table `<schema>` — no leak of any table or column", () => {
  let p;
  beforeAll(() => {
    p = fix("multi-table.scrml", `<program title="multi" db="./test.db">

    < schema>
        users {
            id:    integer primary key
            email: text not null unique
        }
        posts {
            id:      integer primary key
            user_id: integer not null
            body:    text not null
        }
    </>

    <page>
        <h1>Multi-table</h1>
    </page>

</program>
`);
  });

  test("no table name leaks into HTML body", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toMatch(/users\s*\{/);
    expect(html).not.toMatch(/posts\s*\{/);
  });

  test("no column constraint leaks into HTML body", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toContain("integer primary key");
    expect(html).not.toContain("text not null unique");
    expect(html).not.toContain("integer not null");
  });

  test("no DDL identifier (`user_id`) leaks into HTML body", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toContain("user_id");
  });
});

// =============================================================================
// §3 — column-name collision with plausible English words
// =============================================================================

describe("§3 — DDL column-name with plausible-English-word collision", () => {
  let p;
  beforeAll(() => {
    p = fix("english-word-columns.scrml", `<program title="prose" db="./test.db">

    < schema>
        articles {
            id:          integer primary key
            title:       text not null
            description: text
            content:     text
            author:      text
        }
    </>

    <page>
        <h1>Articles</h1>
    </page>

</program>
`);
  });

  test("HTML does not contain DDL-shape `<column>: text` pairs", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    // The `column: type` pattern is unique to DDL — never appears in
    // ordinary HTML body prose.
    expect(html).not.toMatch(/title:\s+text/);
    expect(html).not.toMatch(/description:\s+text/);
    expect(html).not.toMatch(/content:\s+text/);
    expect(html).not.toMatch(/author:\s+text/);
  });

  test("HTML does not contain the table name + brace", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toMatch(/articles\s*\{/);
  });
});

// =============================================================================
// §4 — positive control: `<page>` body text IS in HTML
// =============================================================================

describe("§4 — positive control: `<page>` body content survives exclusion", () => {
  let p;
  beforeAll(() => {
    p = fix("positive-control.scrml", `<program title="positive" db="./test.db">

    < schema>
        widgets {
            id:    integer primary key
            label: text
        }
    </>

    <page>
        <h1>Visible Heading</h1>
        <p>Visible paragraph body.</p>
    </page>

</program>
`);
  });

  test("page body content IS rendered into HTML", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).toContain("Visible Heading");
    expect(html).toContain("Visible paragraph body.");
  });

  test("but schema DDL is still excluded", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toMatch(/widgets\s*\{/);
    expect(html).not.toContain("integer primary key");
  });
});

// =============================================================================
// §5 — `<schema>` AFTER `<page>` in source order
// =============================================================================

describe("§5 — exclusion is structural, not positional", () => {
  let p;
  beforeAll(() => {
    p = fix("schema-after-page.scrml", `<program title="positional" db="./test.db">

    <page>
        <h1>Heading</h1>
    </page>

    < schema>
        items {
            id:   integer primary key
            sku:  text not null unique
        }
    </>

</program>
`);
  });

  test("page content present", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).toContain("Heading");
  });

  test("schema DDL absent even when declared after page", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toMatch(/items\s*\{/);
    expect(html).not.toContain("integer primary key");
    // `sku` is a unique DDL identifier — should NOT be in HTML.
    expect(html).not.toContain("sku");
  });
});

// =============================================================================
// §6 — schema visibility across multiple page siblings
// =============================================================================

describe("§6 — `<schema>` exclusion holds across multiple `<page>` boundaries", () => {
  let p;
  beforeAll(() => {
    p = fix("schema-multi-page.scrml", `<program title="multi-page" db="./test.db">

    < schema>
        records {
            id:    integer primary key
            data:  text not null
        }
    </>

    <page route="/">
        <h1>Home</h1>
    </page>

    <page route="/about">
        <h1>About</h1>
    </page>

</program>
`);
  });

  test("schema DDL not in HTML body (single-file emit)", () => {
    const result = compile(p);
    // Multi-page emit produces one HTML per route under outputs; the schema
    // exclusion must apply to whichever HTML is in the output map.
    let foundAnyHtml = false;
    for (const [, output] of result.outputs) {
      const html = output.html ?? "";
      if (!html) continue;
      foundAnyHtml = true;
      expect(html).not.toMatch(/records\s*\{/);
      expect(html).not.toContain("integer primary key");
      expect(html).not.toContain("text not null");
    }
    // At least one html output must exist for the assertion to be meaningful.
    expect(foundAnyHtml).toBe(true);
  });
});

// =============================================================================
// §7 — `<schema>` with `${ schemaFor(T) }` interpolation
// =============================================================================

describe("§7 — `${ schemaFor(T) }` walker-rewritten body must also be suppressed", () => {
  let p;
  beforeAll(() => {
    p = fix("schema-for-interp.scrml", `<program title="schemafor" db="./test.db">

\${
    type Card = struct {
        id:    integer
        title: string
    }
}

    < schema>
        \${ schemaFor(Card) }
    </>

    <page>
        <h1>SchemaFor test</h1>
    </page>

</program>
`);
  });

  test("schemaFor-derived DDL does not leak into HTML", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    // The schemaFor walker produces a synthesized text-child carrying the
    // table declaration (`cards { id: integer ... }`). That synthesized text
    // is ALSO inside the state-kind children — must be suppressed by the
    // same SERVER_ONLY_STATE_TYPES gate.
    expect(html).not.toMatch(/cards\s*\{/);
    expect(html).not.toMatch(/[a-z_]+\s*:\s*integer/);
    expect(html).not.toContain("primary key");
  });

  test("the page heading still renders", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).toContain("SchemaFor test");
  });
});

// =============================================================================
// §8 — interleaved hand-authored + schemaFor inside one `<schema>` block
// =============================================================================

describe("§8 — interleaved hand-authored DDL + `${ schemaFor(T) }` — both suppressed", () => {
  let p;
  beforeAll(() => {
    p = fix("schema-interleaved.scrml", `<program title="interleaved" db="./test.db">

\${
    type Comment = struct {
        id:   integer
        body: string
    }
}

    < schema>
        articles {
            id:    integer primary key
            title: text not null
        }
        \${ schemaFor(Comment) }
    </>

    <page>
        <h1>Interleaved</h1>
    </page>

</program>
`);
  });

  test("hand-authored DDL absent from HTML", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toMatch(/articles\s*\{/);
    expect(html).not.toContain("integer primary key");
  });

  test("walker-rewritten DDL absent from HTML", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).not.toMatch(/comments\s*\{/);
  });

  test("page heading present", () => {
    const result = compile(p);
    const html = htmlOf(result, p);
    expect(html).toContain("Interleaved");
  });
});
