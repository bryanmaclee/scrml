/**
 * formfor-nested-in-engine-statechild-r27-c6.test.js — S177 r27-c6 (MED).
 *
 * A `<formFor for=NewExpense>` nested inside an `<engine>` state-child (`<Draft>`)
 * false-fired E-SCOPE-001 on `bind:value=@newExpense.category` — but the
 * IDENTICAL formFor at TOP LEVEL compiled clean.
 *
 * ROOT (empirically confirmed): the formFor expansion walk (`walkAndSplice` in
 * type-system.ts) recursed into a node's `.children` + `.body`, but NOT into an
 * engine-decl's `.bodyChildren` (where the engine state-children live, each
 * hosting its own markup `.children`). So a formFor nested in an engine
 * state-child was NEVER EXPANDED: the raw `<formFor>` tag leaked into the output
 * AND its compound state cell (`@newExpense`) was never hoisted / bound, so the
 * `bind:value=@newExpense.*` scope-check found no `@newExpense` -> E-SCOPE-001.
 * (The brief hypothesized a synth-cell-in-wrong-scope issue, but the cell never
 * existed: the expansion itself was skipped.)
 *
 * FIX (type-system.ts): `walkAndSplice` also recurses into `bodyChildren`, so the
 * nested formFor is expanded; its compound decl is hoisted to a top-level synth
 * logic node (FILE scope) — an ancestor of the engine-arm scope the bind site
 * resolves against, so the lookup resolves.
 *
 * Coverage:
 *   §1 — nested formFor compiles clean (no E-SCOPE-001), matching the top-level control
 *   §2 — the nested formFor is EXPANDED (raw `<formFor>` tag gone; `<form>` present)
 *   §3 — `@newExpense` compound cell is wired (validity surface emitted)
 *   §4 — top-level control still compiles clean (no regression)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "r27-c6-formfor-engine-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: true, log: () => {} });
}
function realErrors(result) {
  return (result.errors || []).filter((e) => e && e.severity !== "warning" && e.severity !== "info");
}
function codes(result) { return realErrors(result).map((e) => e.code); }
function clientJs(filename) {
  const p = join(TMP, "dist", filename.replace(/\.scrml$/, "") + ".client.js");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}
function html(filename) {
  const p = join(TMP, "dist", filename.replace(/\.scrml$/, "") + ".html");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

const NESTED = `\${
    import { formFor } from 'scrml:data'
    type ExpenseCategory:enum = { Travel, Meals, Lodging, Supplies, Other }
    type ReportStatus:enum = { Draft, Submitted, Approved }
    type NewExpense:struct = { merchant: string req length(>=2), category: ExpenseCategory req }
}
<program>
    <engine for=ReportStatus initial=.Draft>
        <Draft rule=.Submitted>
            <h2>Draft</h2>
            <formFor for=NewExpense onsubmit=\${} pick=["merchant", "category"]>
                <slot name="category">
                    <select bind:value=@newExpense.category>
                        <option value="Travel">Travel</option>
                    </select>
                </slot>
            </formFor>
        </>
        <Submitted rule=.Approved><h2>Submitted</h2></>
        <Approved><h2>Approved</h2></>
    </engine>
</program>`;

const TOPLEVEL = `\${
    import { formFor } from 'scrml:data'
    type ExpenseCategory:enum = { Travel, Meals, Lodging, Supplies, Other }
    type NewExpense:struct = { merchant: string req length(>=2), category: ExpenseCategory req }
}
<program>
    <formFor for=NewExpense onsubmit=\${} pick=["merchant", "category"]>
        <slot name="category">
            <select bind:value=@newExpense.category>
                <option value="Travel">Travel</option>
            </select>
        </slot>
    </formFor>
</program>`;

describe("§1-3 formFor nested in an engine state-child", () => {
  test("§1 nested formFor compiles clean (no E-SCOPE-001)", () => {
    const result = compile("nested.scrml", NESTED);
    expect(codes(result)).not.toContain("E-SCOPE-001");
    expect(realErrors(result)).toEqual([]);
  });

  test("§2 the nested formFor is EXPANDED (raw <formFor> tag gone; <form> present)", () => {
    compile("nested2.scrml", NESTED);
    const out = html("nested2.scrml") + clientJs("nested2.scrml");
    // The raw element opener `<formFor ` (with a trailing space — distinct from
    // the `data-scrml-formfor` data attributes) must be GONE.
    expect(out).not.toContain("<formFor ");
    expect(out).toContain("<form ");
  });

  test("§3 `@newExpense` compound cell is wired (validity surface emitted)", () => {
    compile("nested3.scrml", NESTED);
    const js = clientJs("nested3.scrml");
    expect(js).toContain('"newExpense.merchant"');
  });
});

describe("§4 top-level control unchanged (no regression)", () => {
  test("top-level formFor still compiles clean", () => {
    const result = compile("toplevel.scrml", TOPLEVEL);
    expect(codes(result)).not.toContain("E-SCOPE-001");
    expect(realErrors(result)).toEqual([]);
  });
});
