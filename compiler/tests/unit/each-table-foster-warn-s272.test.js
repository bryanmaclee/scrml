/**
 * W-EACH-TABLE-FOSTER info-level lint (S272 — assetManagement adopter report).
 *
 * A top-level `<each>` placed directly inside a table-context element
 * (`<table>/<thead>/<tbody>/<tfoot>/<tr>`) emits a static `<div>` mount that the
 * HTML parser FOSTER-PARENTS out of the table → the list silently renders zero
 * rows. This lint turns that silent failure loud and points at the `<div>`-layout
 * workaround. Tracked: docs/known-gaps.md g-each-mount-div-foster-parented-in-table.
 *
 * Tests the lint module directly (runWEachTableFoster over a synthetic typed-AST)
 * AND the end-to-end partition (lands in lintDiagnostics / result.warnings — never
 * result.errors), including the no-false-positive contract for the `<div>`-layout
 * workaround and for runtime-mounted NESTED eaches.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { runWEachTableFoster } from "../../src/lint-w-each-table-foster.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// §A  runWEachTableFoster — direct over a synthetic typed-AST
// ---------------------------------------------------------------------------

/** An each-block nested directly inside one element `tag`. */
function eachUnder(tag) {
  return {
    filePath: "/x.scrml",
    ast: {
      nodes: [
        {
          kind: "markup",
          tag,
          children: [
            { kind: "each-block", iterShape: "in", inExprRaw: "@rows", span: { line: 4, col: 5 }, templateChildren: [] },
          ],
        },
      ],
    },
  };
}

describe("runWEachTableFoster — direct", () => {
  test("fires for each directly inside <tbody>", () => {
    const diags = runWEachTableFoster([eachUnder("tbody")]);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe("W-EACH-TABLE-FOSTER");
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("foster-parent");
    expect(diags[0].message).toContain("g-each-mount-div-foster-parented-in-table");
    expect(diags[0].line).toBe(4);
  });

  test("fires under every table-section tag (table/thead/tbody/tfoot/tr)", () => {
    for (const tag of ["table", "thead", "tbody", "tfoot", "tr"]) {
      expect(runWEachTableFoster([eachUnder(tag)]).length).toBe(1);
    }
  });

  test("is case-insensitive on the enclosing tag", () => {
    expect(runWEachTableFoster([eachUnder("TBODY")]).length).toBe(1);
  });

  test("does NOT fire for the <div>-layout workaround (each under a div/ul/section)", () => {
    for (const tag of ["div", "ul", "ol", "section", "span"]) {
      expect(runWEachTableFoster([eachUnder(tag)]).length).toBe(0);
    }
  });

  test("does NOT descend into an each's templateChildren (nested each is runtime-mounted → immune)", () => {
    // Outer each under <div>; its per-item template contains a <tbody> with an
    // INNER each. The inner each's mount is createElement'd at runtime, NOT in the
    // served shell, so it is never foster-parented. Must NOT warn.
    const file = {
      filePath: "/x.scrml",
      ast: {
        nodes: [
          {
            kind: "markup",
            tag: "div",
            children: [
              {
                kind: "each-block",
                iterShape: "in",
                inExprRaw: "@groups",
                span: { line: 3, col: 3 },
                templateChildren: [
                  {
                    kind: "markup",
                    tag: "tbody",
                    children: [
                      { kind: "each-block", iterShape: "in", inExprRaw: "g.rows", span: { line: 6, col: 7 }, templateChildren: [] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(runWEachTableFoster([file]).length).toBe(0);
  });

  test("fires through a TRANSPARENT bare <if> wrapper under a table section", () => {
    // <tbody><if @c><each>…</each></if></tbody> — the <if> establishes no real
    // element (it fosters with its content), so the each still lands in <tbody>.
    const file = {
      filePath: "/x.scrml",
      ast: {
        nodes: [
          {
            kind: "markup",
            tag: "tbody",
            children: [
              {
                kind: "markup",
                tag: "if",
                children: [
                  { kind: "each-block", iterShape: "in", inExprRaw: "@rows", span: { line: 5, col: 7 }, templateChildren: [] },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(runWEachTableFoster([file]).length).toBe(1);
  });

  test("does NOT fire for an <if>-wrapped each under a <div> (transparent pass-through keeps the div)", () => {
    const file = {
      filePath: "/x.scrml",
      ast: {
        nodes: [
          {
            kind: "markup",
            tag: "div",
            children: [
              {
                kind: "markup",
                tag: "if",
                children: [
                  { kind: "each-block", iterShape: "in", inExprRaw: "@rows", span: { line: 5, col: 7 }, templateChildren: [] },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(runWEachTableFoster([file]).length).toBe(0);
  });

  test("empty / malformed input is safe", () => {
    expect(runWEachTableFoster([]).length).toBe(0);
    expect(runWEachTableFoster(null).length).toBe(0);
    expect(runWEachTableFoster([null, {}]).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B  end-to-end partition — lands in lintDiagnostics, never errors
// ---------------------------------------------------------------------------

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "each-table-foster-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, "t.scrml");
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: true, log: () => {} });
}

describe("W-EACH-TABLE-FOSTER — end-to-end partition", () => {
  test("each under <tbody> surfaces the info lint (never an error)", () => {
    const src = `<program>
  \${ <rows> = [] }
  <table>
    <thead><tr><th>Email</th></tr></thead>
    <tbody>
      <each in=@rows as r key=@.id>
        <tr><td>\${r.email}</td></tr>
      </each>
    </tbody>
  </table>
</program>`;
    const res = compile(src);
    const fatal = (res.errors || []).filter(e => e.severity == null || e.severity === "error");
    expect(fatal.filter(e => (e.code || "").startsWith("W-EACH-TABLE-FOSTER"))).toEqual([]); // NEVER an error
    expect((res.lintDiagnostics || []).some(d => d.code === "W-EACH-TABLE-FOSTER")).toBe(true);
  });

  test("the <div>-layout workaround does NOT surface the lint", () => {
    const src = `<program>
  \${ <rows> = [] }
  <div class="list">
    <each in=@rows as r key=@.id>
      <div class="row">\${r.email}</div>
    </each>
  </div>
</program>`;
    const res = compile(src);
    expect((res.lintDiagnostics || []).some(d => d.code === "W-EACH-TABLE-FOSTER")).toBe(false);
  });

  test("an each wrapped in a bare <if> inside <tbody> surfaces the lint", () => {
    const src = `<program>
  \${ <rows> = []
     <show> = true }
  <table><tbody>
    <if @show>
      <each in=@rows as r key=@.id><tr><td>\${r.email}</td></tr></each>
    </if>
  </tbody></table>
</program>`;
    const res = compile(src);
    const fatal = (res.errors || []).filter(e => e.severity == null || e.severity === "error");
    expect(fatal.filter(e => (e.code || "").startsWith("W-EACH-TABLE-FOSTER"))).toEqual([]);
    expect((res.lintDiagnostics || []).some(d => d.code === "W-EACH-TABLE-FOSTER")).toBe(true);
  });

  test("a NESTED each inside a runtime-built table does NOT false-positive", () => {
    const src = `<program>
  \${ <groups> = [] }
  <div class="wrap">
    <each in=@groups as g key=@.id>
      <table><tbody>
        <each in=g.rows as r key=@.id>
          <tr><td>\${r.x}</td></tr>
        </each>
      </tbody></table>
    </each>
  </div>
</program>`;
    const res = compile(src);
    expect((res.lintDiagnostics || []).some(d => d.code === "W-EACH-TABLE-FOSTER")).toBe(false);
  });
});
