// ---------------------------------------------------------------------------
// §38.13.2 — RowChange synthesis + schema/PK/driver reads (realtime feed over
// external DB writes; Phase 1 front-end). Unit-tests the pure helpers in
// compiler/src/channel-watches.ts directly.
//
// SPEC §38.13.2: for a `watches=<T>` channel the compiler synthesizes
//   RowChange:enum = { Inserted(row: <RowT>), Updated(row: <RowT>), Deleted(key: <PKT>) }
// where <RowT> is the struct of T's columns and <PKT> is the PK type. `Inserted`
// / `Updated` carry the full post-image row; `Deleted` carries only the PK. The
// PK is derived by the `id`-convention; a `key=<column>` attr overrides it.
// ---------------------------------------------------------------------------

import { describe, test, expect } from "bun:test";
import {
  synthesizeRowChange,
  derivePrimaryKey,
  collectSchemaTables,
  resolveProgramDbDriver,
  readLiteralIdentAttr,
  isWatchesChannel,
  ROWCHANGE_VARIANT_NAMES,
} from "../../src/channel-watches.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function astOf(src) {
  const bs = splitBlocks("app.scrml", src);
  const res = buildAST(bs);
  return res.ast?.nodes ?? res.nodes ?? [];
}

const ORDERS = {
  name: "orders",
  columns: [
    { name: "id", scrmlType: "int", primaryKey: true },
    { name: "status", scrmlType: "string", primaryKey: false },
    { name: "total", scrmlType: "number", primaryKey: false },
  ],
};

describe("§38.13.2 synthesizeRowChange — 3-column table with id PK", () => {
  const rc = synthesizeRowChange(ORDERS, null);

  test("has exactly the three fixed variants Inserted/Updated/Deleted", () => {
    expect(rc.variants.map((v) => v.name)).toEqual(["Inserted", "Updated", "Deleted"]);
    expect(ROWCHANGE_VARIANT_NAMES).toEqual(["Inserted", "Updated", "Deleted"]);
  });

  test("Inserted + Updated carry the FULL row struct", () => {
    const inserted = rc.variants.find((v) => v.name === "Inserted");
    const updated = rc.variants.find((v) => v.name === "Updated");
    const expectedFields = { id: "int", status: "string", total: "number" };
    expect(inserted.payload).toHaveLength(1);
    expect(inserted.payload[0].name).toBe("row");
    expect(inserted.payload[0].type).toEqual({ kind: "struct", fields: expectedFields });
    expect(updated.payload[0].type).toEqual({ kind: "struct", fields: expectedFields });
  });

  test("Deleted carries only the PK type (int), not the full row", () => {
    const deleted = rc.variants.find((v) => v.name === "Deleted");
    expect(deleted.payload).toHaveLength(1);
    expect(deleted.payload[0].name).toBe("key");
    expect(deleted.payload[0].type).toBe("int");
  });

  test("pkColumn/pkType resolve to id/int by the id-convention", () => {
    expect(rc.pkColumn).toBe("id");
    expect(rc.pkType).toBe("int");
  });
});

describe("§38.13.2 derivePrimaryKey — precedence", () => {
  test("primary-key-marked column wins over the id-convention absence", () => {
    const t = { name: "t", columns: [
      { name: "uuid", scrmlType: "string", primaryKey: true },
      { name: "label", scrmlType: "string", primaryKey: false },
    ]};
    expect(derivePrimaryKey(t, null)).toEqual({ column: "uuid", type: "string" });
  });

  test("id-convention when no primary-key marking", () => {
    const t = { name: "t", columns: [
      { name: "id", scrmlType: "int", primaryKey: false },
      { name: "label", scrmlType: "string", primaryKey: false },
    ]};
    expect(derivePrimaryKey(t, null)).toEqual({ column: "id", type: "int" });
  });

  test("key= override wins over both, honoring the named column's type", () => {
    expect(derivePrimaryKey(ORDERS, "status")).toEqual({ column: "status", type: "string" });
  });

  test("no PK derivable → null (drives W-CHANNEL-WATCHES-NO-PK)", () => {
    const t = { name: "events", columns: [
      { name: "label", scrmlType: "string", primaryKey: false },
      { name: "ts", scrmlType: "number", primaryKey: false },
    ]};
    expect(derivePrimaryKey(t, null)).toBeNull();
  });

  // PA /code-review finding #3 (regression): key= override must resolve
  // CASE-INSENSITIVELY against the table, and a key= naming a non-existent
  // column must return null (surface W-CHANNEL-WATCHES-NO-PK), NOT silently
  // type the ghost key as `asIs`.
  test("[#3] key= resolves CASE-INSENSITIVELY to the declared column + its type", () => {
    expect(derivePrimaryKey(ORDERS, "Id")).toEqual({ column: "id", type: "int" });
    expect(derivePrimaryKey(ORDERS, "TOTAL")).toEqual({ column: "total", type: "number" });
  });
  test("[#3] key= naming a NON-EXISTENT column → null (no asIs ghost key)", () => {
    expect(derivePrimaryKey(ORDERS, "totl")).toBeNull();   // typo for `total`
    expect(derivePrimaryKey(ORDERS, "nope")).toBeNull();
  });
});

describe("§38.13.2 synthesizeRowChange — key= override on a no-id table", () => {
  const events = { name: "events", columns: [
    { name: "label", scrmlType: "string", primaryKey: false },
    { name: "ts", scrmlType: "number", primaryKey: false },
  ]};
  test("Deleted key type follows the key= column", () => {
    const rc = synthesizeRowChange(events, "ts");
    expect(rc.pkColumn).toBe("ts");
    expect(rc.pkType).toBe("number");
    expect(rc.variants.find((v) => v.name === "Deleted").payload[0].type).toBe("number");
  });
  test("no PK + no key= → Deleted key type asIs, pkColumn null (total synthesis)", () => {
    const rc = synthesizeRowChange(events, null);
    expect(rc.pkColumn).toBeNull();
    expect(rc.pkType).toBeNull();
    expect(rc.variants.find((v) => v.name === "Deleted").payload[0].type).toBe("asIs");
  });
});

describe("§38.13.1 schema/driver/attr reads from a real AST", () => {
  const src = `<program db="postgres://localhost/app">
  <schema>
    orders {
      id: int primary key
      status: string
      total: number
    }
  </schema>
  <channel name="orders-feed" watches=orders key=id></channel>
</program>
`;
  const nodes = astOf(src);

  test("collectSchemaTables reads the declared table + columns + PK flag", () => {
    const tables = collectSchemaTables(nodes);
    expect(tables.has("orders")).toBe(true);
    const t = tables.get("orders");
    expect(t.columns.map((c) => c.name)).toEqual(["id", "status", "total"]);
    expect(t.columns.find((c) => c.name === "id").primaryKey).toBe(true);
  });

  test("resolveProgramDbDriver returns postgres from <program db=>", () => {
    expect(resolveProgramDbDriver(nodes)).toBe("postgres");
  });

  test("readLiteralIdentAttr reads watches= and key= as bare identifiers", () => {
    const bs = splitBlocks("app.scrml", src);
    const res = buildAST(bs);
    const walk = (n, acc = []) => {
      if (!n || typeof n !== "object") return acc;
      if (Array.isArray(n)) { for (const x of n) walk(x, acc); return acc; }
      if (n.kind === "markup" && (n.tag ?? "") === "channel") acc.push(n);
      for (const k of Object.keys(n)) { if (k === "span") continue; walk(n[k], acc); }
      return acc;
    };
    const ch = walk(res.ast?.nodes ?? res.nodes ?? [])[0];
    expect(readLiteralIdentAttr(ch, "watches")).toBe("orders");
    expect(readLiteralIdentAttr(ch, "key")).toBe("id");
    expect(isWatchesChannel(ch)).toBe(true);
  });

  test("resolveProgramDbDriver returns sqlite for a sqlite: db", () => {
    const sqliteNodes = astOf(`<program db="sqlite:app.db"><channel name="c" watches=orders></channel></program>`);
    expect(resolveProgramDbDriver(sqliteNodes)).toBe("sqlite");
  });
});
