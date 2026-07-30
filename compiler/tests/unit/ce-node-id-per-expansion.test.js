/**
 * ce-node-id-per-expansion.test.js — component expansion assigns FRESH node ids
 * per instantiation (S299; closes the root cause of
 * `g-each-anchor-lookup-first-match-document-wide`).
 *
 * THE DEFECT. `RegistryEntry.nodes` is the registry's parsed component body,
 * SHARED by every instantiation, and its ids come from `parseComponentBody` →
 * `reparseSynthesizedFile`, which numbers from a counter of its own starting at
 * zero. So two things collided:
 *
 *   - the SAME component instantiated twice reused one set of ids, and
 *   - two DIFFERENT components each got their own from-scratch parse, so both
 *     started at the same low numbers and collided WITH EACH OTHER.
 *
 * Anything downstream keyed on `node.id` therefore collided. Measured on
 * `<each>` before the fix — two list components emitted ONE fence id, so
 * `_scrml_each_renderers[key]` was second-write-wins and every
 * `_scrml_find_each_anchor` resolved to the first fence. EXECUTED in happy-dom,
 * the observable result was:
 *
 *     panel 0: [B-one]      <- rendered the SECOND list's data
 *     panel 1: []           <- empty
 *
 * with a GREEN compile: 0 errors, 0 warnings. A page with two list components —
 * an extremely ordinary shape — was silently wrong.
 *
 * WHY THIS TEST ASSERTS ON IDS RATHER THAN ON RENDER. The render symptom is what
 * makes it matter, but the id collision is the CAUSE and is the invariant worth
 * pinning: any future `node.id`-derived emitted name inherits it. Attribute
 * bindings use a separate sequence and were never affected (§4 guards that).
 *
 * Test map:
 *   §1  the same component instantiated 2x emits DISTINCT each fence ids
 *   §2  3x instantiation emits 3 distinct ids (no accidental 2-only fix)
 *   §3  two DIFFERENT components each with an <each> do not collide
 *   §4  GUARD — attribute-binding ids were already unique; still are
 *   §5  GUARD — a single instantiation is unchanged (no gratuitous churn)
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/** Compile a source and return the emitted html + client js. */
function compileEmit(scrmlSource, tag) {
  const t = tag ?? `ceid-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_ceid_${t}`);
  const tmpInput = resolve(tmpDir, `${t}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${t}.html`);
    const jsPath = resolve(outDir, `${t}.client.js`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      js: existsSync(jsPath) ? readFileSync(jsPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

/** Distinct `scrml-each:<id>` fence ids present in the emitted HTML. */
function eachFenceIds(html) {
  return [...new Set([...html.matchAll(/scrml-each:([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
}

/** Distinct `_scrml_each_renderers["..."]` keys in the emitted client JS. */
function rendererKeys(js) {
  return [...new Set([...js.matchAll(/_scrml_each_renderers\["([^"]+)"\]/g)].map((m) => m[1]))];
}

const ROW_TYPE = `        type Row:struct = { id: string, label: string }`;

function panelDef(name) {
  return `    \${
        const ${name} = <div props={ items: Row[] }>
            <ul>
                <each in=items key=@.id>
                    <li : @.label>
                </each>
            </ul>
        </>
    }`;
}

function program(defs, cells, uses) {
  return `<program>
  <page>
    \${
${ROW_TYPE}
    }

${defs}

    \${
${cells}
    }

${uses}
  </>
</program>`;
}

const CELLS_AB = `        <listA>: Row[] = [{ id: "a1", label: "A-one" }]
        <listB>: Row[] = [{ id: "b1", label: "B-one" }]`;

// ---------------------------------------------------------------------------
// §1 — the headline case
// ---------------------------------------------------------------------------

describe("CE node ids §1 — one component, two instantiations", () => {
  test("emits TWO distinct each fence ids and TWO distinct renderer keys", () => {
    const out = compileEmit(program(
      panelDef("Panel"),
      CELLS_AB,
      `    <Panel items=@listA/>\n    <Panel items=@listB/>`,
    ));
    expect(out.errors).toEqual([]);
    // Before the fix: ONE id shared by both instances, and ONE renderer key
    // written twice (second clobbering the first).
    expect(eachFenceIds(out.html).length).toBe(2);
    expect(rendererKeys(out.js).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §2 — three instantiations (guards against a fix that only distinguishes two)
// ---------------------------------------------------------------------------

describe("CE node ids §2 — three instantiations", () => {
  test("emits THREE distinct each fence ids", () => {
    const out = compileEmit(program(
      panelDef("Panel"),
      CELLS_AB,
      `    <Panel items=@listA/>\n    <Panel items=@listB/>\n    <Panel items=@listA/>`,
    ));
    expect(out.errors).toEqual([]);
    expect(eachFenceIds(out.html).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §3 — two DIFFERENT components. This is the half that surprised: each body is
// re-parsed from scratch, so two unrelated components collided with each other.
// ---------------------------------------------------------------------------

describe("CE node ids §3 — two different components", () => {
  test("two components each containing an <each> do not share a fence id", () => {
    const out = compileEmit(program(
      `${panelDef("PanelA")}\n\n${panelDef("PanelB")}`,
      CELLS_AB,
      `    <PanelA items=@listA/>\n    <PanelB items=@listB/>`,
    ));
    expect(out.errors).toEqual([]);
    expect(eachFenceIds(out.html).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4 — GUARD: attribute-binding ids use a SEPARATE sequence and were never
// affected. Pinned so a future "unify the counters" change cannot regress it.
// ---------------------------------------------------------------------------

describe("CE node ids §4 — attribute bindings stay unique", () => {
  test("two components' if= bindings emit distinct attr-binding ids", () => {
    const out = compileEmit(`<program>
  <page>
    \${
        const CardA = <div props={ flag: boolean, txt: string }>
            <p if=flag>A: \${txt}</p>
        </>
    }
    \${
        const CardB = <div props={ flag: boolean, txt: string }>
            <p if=flag>B: \${txt}</p>
        </>
    }
    \${
        <onA> = true
        <onB> = true
    }
    <CardA flag=@onA txt="xx"/>
    <CardB flag=@onB txt="yy"/>
  </>
</program>`);
    expect(out.errors).toEqual([]);
    // Phase 2 finish (S301): `if=` lowers to template+marker (§17.1), so the
    // per-expansion id surface is the MARKER id rather than a `data-scrml-bind-if`
    // placeholder. The guard is unchanged in substance — two expansions, two ids.
    const markerIds = [...new Set(
      [...out.html.matchAll(/scrml-if-marker:([A-Za-z0-9_]+)/g)].map((m) => m[1]),
    )];
    expect(markerIds.length).toBe(2);
    const templateIds = [...new Set(
      [...out.html.matchAll(/<template id="([^"]+)"/g)].map((m) => m[1]),
    )];
    expect(templateIds.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §5 — GUARD: a single instantiation still emits exactly one id.
// ---------------------------------------------------------------------------

describe("CE node ids §5 — single instantiation unchanged", () => {
  test("one component used once emits exactly one each fence id", () => {
    const out = compileEmit(program(
      panelDef("Panel"),
      `        <listA>: Row[] = [{ id: "a1", label: "A-one" }]`,
      `    <Panel items=@listA/>`,
    ));
    expect(out.errors).toEqual([]);
    expect(eachFenceIds(out.html).length).toBe(1);
    expect(rendererKeys(out.js).length).toBe(1);
  });
});
