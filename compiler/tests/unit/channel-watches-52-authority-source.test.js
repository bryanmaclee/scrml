// ---------------------------------------------------------------------------
// §38.13.5 — `<channel watches=<table>>` sources its table shape from a §52
// `authority="server" table=<T>` collection (the composition the DD + SPEC
// §38.13.5 advertise). The §52 Tier-1 TYPE decl carries the row shape INLINE
// (its colon-field body ARE the columns); a `watches=T` channel resolves T's
// row shape + `id`-PK from that decl — no `<schema>` block required.
//
// change-id channel-watches-52-authority-source-2026-07-07 / gap
// g-channel-watches-schema-vs-52-authority-composition.
//
// TWO layers:
//   (A) collectSchemaTables(nodes) directly — the shared shape resolver now
//       merges §52 authority tables (fallback) with `<schema>` tables (which
//       keep precedence).
//   (B) end-to-end via compileScrml — the §52-sourced feed compiles clean
//       (no E-CHANNEL-WATCHES-UNKNOWN-TABLE, no E-MATCH-NOT-EXHAUSTIVE), and
//       the regression matrix (schema still works, both-declare precedence,
//       unknown still errors, no-PK still warns) holds.
//
// SPEC §38.13.1 (shape source — <schema> OR §52 authority), §38.13.2 (RowChange
// synth), §38.13.5 (§52 composition), §52.3.5 (the canonical ${...} placement).
// ---------------------------------------------------------------------------

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import { collectSchemaTables, derivePrimaryKey } from "../../src/channel-watches.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function astOf(src) {
  const bs = splitBlocks("app.scrml", src);
  const res = buildAST(bs);
  return res.ast?.nodes ?? res.nodes ?? [];
}

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "channel-watches-52-"));
  try {
    const p = join(dir, "app.scrml");
    writeFileSync(p, src);
    const r = compileScrml({ inputFiles: [p], write: false, outputDir: join(dir, "out") });
    return {
      errorCodes: (r.errors ?? []).map((e) => e.code),
      warningCodes: (r.warnings ?? []).map((e) => e.code),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const hasErr = (r, code) => r.errorCodes.includes(code);
const hasWarn = (r, code) => r.warningCodes.includes(code);

// A §52 Tier-1 server-authority TYPE decl in its canonical `${...}` placement.
const AUTH_ORDERS = `  \${
    <Order authority="server" table="orders">
      id: int
      status: string
      total: number
    </>
    <Order> @orders
  }`;

const ONCHANGE = `    <onchange>
      <Inserted(row) : logIt(row)>
      <Updated(row) : logIt(row)>
      <Deleted(key) : logIt(key)>
    </onchange>`;

const pg52 = (body) =>
  `<program db="postgres://localhost/app">\n${AUTH_ORDERS}\n${body}\n</program>\n`;

// ---------------------------------------------------------------------------
// (A) collectSchemaTables — the resolver reads the §52 authority TYPE decl.
// ---------------------------------------------------------------------------

describe("(A) collectSchemaTables reads a §52 authority TYPE decl", () => {
  const src = `<program db="postgres://localhost/app">\n${AUTH_ORDERS}\n</program>\n`;
  const tables = collectSchemaTables(astOf(src));

  test("resolves the §52 table keyed by the table= value (lower-cased)", () => {
    expect(tables.has("orders")).toBe(true);
  });

  test("columns come from the decl's inline fields, in order", () => {
    const t = tables.get("orders");
    expect(t.name).toBe("orders");
    expect(t.columns.map((c) => c.name)).toEqual(["id", "status", "total"]);
    expect(t.columns.map((c) => c.scrmlType)).toEqual(["int", "string", "number"]);
  });

  test("PK derives via the §38.13.2 id-convention (no `primary key` marker needed)", () => {
    const pk = derivePrimaryKey(tables.get("orders"), null);
    expect(pk).toEqual({ column: "id", type: "int" });
  });

  test("a `<schema>`-declared table keeps precedence over a same-named §52 decl", () => {
    // Both declare `orders`; the <schema> marks `status` (not id) as the PK to
    // make the winning source observable. <schema> wins → PK is `status`.
    const both = `<program db="postgres://localhost/app">
  <schema>
    orders {
      id: int
      status: string primary key
    }
  </schema>
${AUTH_ORDERS}
</program>
`;
    const t = collectSchemaTables(astOf(both)).get("orders");
    const pk = derivePrimaryKey(t, null);
    expect(pk.column).toBe("status"); // the <schema> shape, not the §52 id-convention
  });
});

// ---------------------------------------------------------------------------
// (B) end-to-end — the §52-sourced feed compiles + the regression matrix.
// ---------------------------------------------------------------------------

describe("(B) §52-sourced watches= feed — end-to-end", () => {
  test("§52 authority decl (NO <schema>) → compiles clean, no UNKNOWN-TABLE / no NOT-EXHAUSTIVE", () => {
    const r = compile(pg52(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE}\n  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(false);
    expect(hasErr(r, "E-MATCH-NOT-EXHAUSTIVE")).toBe(false);
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(false); // id-PK derivable
  });

  test("REGRESSION: a <schema>-declared watches table still resolves clean", () => {
    const SCHEMA = `  <schema>
    orders {
      id: int primary key
      status: string
      total: number
    }
  </schema>`;
    const src = `<program db="postgres://localhost/app">\n${SCHEMA}\n  <channel name="orders-feed" watches=orders>\n${ONCHANGE}\n  </channel>\n</program>\n`;
    const r = compile(src);
    expect(hasErr(r, "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(false);
    expect(hasErr(r, "E-MATCH-NOT-EXHAUSTIVE")).toBe(false);
  });

  test("a §52 decl with no id/PK column and no key= still fires W-CHANNEL-WATCHES-NO-PK", () => {
    const AUTH_NOPK = `  \${
    <Event authority="server" table="events">
      label: string
      kind: string
    </>
    <Event> @events
  }`;
    const src = `<program db="postgres://localhost/app">\n${AUTH_NOPK}\n  <channel name="events-feed" watches=events>\n    <onchange>\n      <Inserted(row) : logIt(row)>\n      <Updated(row) : logIt(row)>\n      <Deleted(key) : logIt(key)>\n    </onchange>\n  </channel>\n</program>\n`;
    const r = compile(src);
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(true);
    expect(hasErr(r, "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(false);
  });

  test("a §52 decl with no id but a key= override resolves the PK (no NO-PK warning)", () => {
    const AUTH_KEYED = `  \${
    <Event authority="server" table="events">
      slug: string
      kind: string
    </>
    <Event> @events
  }`;
    const src = `<program db="postgres://localhost/app">\n${AUTH_KEYED}\n  <channel name="events-feed" watches=events key=slug>\n    <onchange>\n      <Inserted(row) : logIt(row)>\n      <Updated(row) : logIt(row)>\n      <Deleted(key) : logIt(key)>\n    </onchange>\n  </channel>\n</program>\n`;
    const r = compile(src);
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(false);
    expect(hasErr(r, "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(false);
  });

  test("a table declared by NEITHER <schema> NOR §52 still fires E-CHANNEL-WATCHES-UNKNOWN-TABLE", () => {
    const r = compile(pg52(`  <channel name="ghost-feed" watches=ghosts>\n${ONCHANGE}\n  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(true);
  });
});
