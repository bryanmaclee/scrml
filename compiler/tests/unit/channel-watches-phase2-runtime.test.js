/**
 * channel-watches-phase2-runtime.test.js
 *
 * §38.13 realtime `<channel watches=<table>>` — PHASE 2 (runtime codegen).
 * Asserts the EMITTED artifacts (the test env has NO live Postgres):
 *   (i)   the Postgres trigger + function DDL install string;
 *   (ii)  the LISTEN-bridge server JS (dedicated pg connection, LISTEN, re-SELECT, publish);
 *   (iii) the client `__change` branch dispatching the three <onchange> arms + binding row/key;
 *   (iv)  node --check parse-proof of the emitted server + client JS;
 *   (v)   a mock-SQL notification test: simulate {op:INSERT,key} -> re-SELECT + publish fire;
 *         simulate {op:DELETE,key} -> publish (no re-SELECT); the client branch patches the cell;
 *   (vi)  regression: a non-watches channel emits NEITHER a __change branch NOR the capture block;
 *   (vii) the no-PK feed: server capture SKIPPED, client dispatch present-but-inert.
 *
 * SPEC §38.13.7 (LISTEN/NOTIFY substrate), §38.13.3 (<onchange> client dispatch),
 * §38.13.2 (RowChange). Phase-1 front-end landed 52c5afec.
 *
 * SUBSTRATE: Bun.SQL v1.3.13 has no LISTEN/NOTIFY subscription API, so the bridge
 * uses the `pg` package. True end-to-end (real commit -> NOTIFY -> client patch) is
 * NOT covered here (no live PG) and needs human verification against live Postgres.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import {
  buildWatchesTriggerDDL,
  emitChannelClientJs,
  emitChannelWatchesServerBoot,
  collectChannelNodes,
} from "../../src/codegen/emit-channel.ts";
import {
  synthesizeRowChange,
  collectSchemaTables,
  readLiteralIdentAttr,
  isWatchesChannel,
} from "../../src/channel-watches.ts";
import { SERVER_PROTECT_HELPER } from "../../src/codegen/protect-egress.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE = `<program db="postgres://localhost/app">
  <schema>
    orders {
      id: integer primary key
      status: text
      total: real
    }
  </schema>
  <channel name="orders-feed" watches=orders>
      <onchange>
          <Inserted(row) : { @orders = [...@orders, row] }>
          <Updated(row) : { @orders = @orders.map(r => r.id == row.id ? row : r) }>
          <Deleted(key) : { @orders = @orders.filter(r => r.id != key) }>
      </onchange>
  </channel>
</program>`;

function compileToDir(src) {
  const dir = mkdtempSync(join(tmpdir(), "cw-p2-"));
  const p = join(dir, "app.scrml");
  writeFileSync(p, src);
  const out = join(dir, "out");
  const r = compileScrml({ inputFiles: [p], write: true, outputDir: out });
  const read = (name) => (existsSync(join(out, name)) ? readFileSync(join(out, name), "utf8") : "");
  return {
    dir,
    errors: (r.errors ?? []).map((e) => e.code),
    warnings: (r.warnings ?? []).map((e) => e.code),
    server: read("app.server.js"),
    client: read("app.client.js"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Build the AST + stamp `_rowChangeSynth` (as the type-system does). */
function astWithSynth(src) {
  const nodes = buildAST(splitBlocks("app.scrml", src)).ast?.nodes ?? [];
  const tables = collectSchemaTables(nodes);
  const chans = collectChannelNodes(nodes);
  for (const ch of chans) {
    if (!isWatchesChannel(ch)) continue;
    const t = tables.get((readLiteralIdentAttr(ch, "watches") || "").toLowerCase());
    if (t) ch._rowChangeSynth = synthesizeRowChange({ name: t.name, columns: t.columns }, readLiteralIdentAttr(ch, "key"));
  }
  return { nodes, chans };
}

/** Extract a balanced `{...}` block starting at the first occurrence of `head`. */
function extractBalancedBlock(text, head) {
  const s = text.indexOf(head);
  if (s < 0) return "";
  let i = text.indexOf("{", s);
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(s, i + 1); }
  }
  return text.slice(s);
}

// ---------------------------------------------------------------------------
// (i) Trigger + function DDL install string
// ---------------------------------------------------------------------------

describe("§38.13.7 (i) trigger + function DDL install", () => {
  const ddl = buildWatchesTriggerDDL("orders_feed", "orders", "id");

  test("CREATE OR REPLACE FUNCTION notifies the PK via pg_notify + json_build_object", () => {
    expect(ddl.fnDDL).toContain("CREATE OR REPLACE FUNCTION scrml_notify_orders_feed()");
    expect(ddl.fnDDL).toContain("pg_notify('scrml_orders_feed'");
    expect(ddl.fnDDL).toContain("json_build_object('op', TG_OP");
    // DELETE forwards OLD.pk; INSERT/UPDATE forward NEW.pk.
    expect(ddl.fnDDL).toContain(`CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END`);
    expect(ddl.fnDDL).toContain("LANGUAGE plpgsql");
  });

  test("DROP + CREATE TRIGGER (PG<14 compatible) AFTER INSERT OR UPDATE OR DELETE", () => {
    expect(ddl.dropTrigDDL).toBe('DROP TRIGGER IF EXISTS scrml_trg_orders_feed ON "orders";');
    expect(ddl.createTrigDDL).toContain("CREATE TRIGGER scrml_trg_orders_feed AFTER INSERT OR UPDATE OR DELETE ON \"orders\"");
    expect(ddl.createTrigDDL).toContain("EXECUTE FUNCTION scrml_notify_orders_feed()");
  });

  test("identifiers are quoted (table + PK column)", () => {
    const d = buildWatchesTriggerDDL("weird_ch", "My Table", "Row Id");
    expect(d.fnDDL).toContain('OLD."Row Id"');
    expect(d.createTrigDDL).toContain('ON "My Table"');
  });

  test("notifyChannel is scrml_<safeName>", () => {
    expect(ddl.notifyChannel).toBe("scrml_orders_feed");
  });
});

// ---------------------------------------------------------------------------
// (ii) LISTEN-bridge server JS
// ---------------------------------------------------------------------------

describe("§38.13.7 (ii) LISTEN bridge server JS", () => {
  const r = compileToDir(SAMPLE);

  test("compiles clean (no errors)", () => {
    expect(r.errors).toEqual([]);
    r.cleanup();
  });

  test("server emits the capture block: conn, install, LISTEN, re-SELECT, publish", () => {
    const rr = compileToDir(SAMPLE);
    const s = rr.server;
    expect(s).toContain("§38.13.7 realtime watches= feed");
    expect(s).toContain('const _SCRML_WATCHES_CONN = "postgres://localhost/app";');
    // trigger install via Bun.SQL
    expect(s).toContain("_scrml_sql.unsafe(");
    expect(s).toContain("CREATE OR REPLACE FUNCTION scrml_notify_orders_feed()");
    // dedicated pg connection + LISTEN
    expect(s).toContain('import("pg")');
    expect(s).toContain("new _PgClient({ connectionString: _SCRML_WATCHES_CONN })");
    expect(s).toContain('_client.query("LISTEN scrml_orders_feed")');
    // re-SELECT by PK (parameterized), variant map, publish frame
    expect(s).toContain('_scrml_sql.unsafe("SELECT * FROM \\"orders\\" WHERE \\"id\\" = $1", [_p.key])');
    expect(s).toContain('_p.op === "INSERT" ? "Inserted" : "Updated"');
    expect(s).toContain('_server.publish("orders-feed", JSON.stringify({ __type: "__change", op: _variant, row: _row }))');
    // DELETE → forward key, no re-SELECT
    expect(s).toContain('_server.publish("orders-feed", JSON.stringify({ __type: "__change", op: "Deleted", key: _p.key }))');
    // reconnect-on-drop
    expect(s).toContain("setTimeout(_scrml_watches_listen_orders_feed, _SCRML_WATCHES_RECONNECT_MS)");
    rr.cleanup();
  });

  test("server-only data does NOT leak to client.js", () => {
    const rr = compileToDir(SAMPLE);
    expect(rr.client.includes("postgres://")).toBe(false);
    expect(rr.client.includes("pg_notify")).toBe(false);
    expect(rr.client.includes("LISTEN")).toBe(false);
    expect(rr.client.includes("_scrml_sql")).toBe(false);
    rr.cleanup();
  });
});

// ---------------------------------------------------------------------------
// (iii) client __change dispatch
// ---------------------------------------------------------------------------

describe("§38.13.3 (iii) client __change dispatch", () => {
  const { chans } = astWithSynth(SAMPLE);
  const errors = [];
  const lines = emitChannelClientJs(chans[0], errors, "app.scrml");
  const js = lines.join("\n");

  test("emits an unconditional __change branch", () => {
    expect(errors).toEqual([]);
    expect(js).toContain('if (_d.__type === "__change") {');
  });

  test("dispatches all three variants, binding row / key correctly", () => {
    expect(js).toContain('if (_d.op === "Inserted") { const row = _d.row;');
    expect(js).toContain('if (_d.op === "Updated") { const row = _d.row;');
    expect(js).toContain('if (_d.op === "Deleted") { const key = _d.key;');
  });

  test("arm bodies lower @-cells to reactive get/set with === / !==", () => {
    expect(js).toContain('_scrml_reactive_set("orders", [..._scrml_reactive_get("orders"), row])');
    expect(js).toContain('_scrml_reactive_get("orders").map(r => r.id === row.id ? row : r)');
    expect(js).toContain('_scrml_reactive_get("orders").filter(r => r.id !== key)');
  });
});

// ---------------------------------------------------------------------------
// (iv) node --check parse-proof
// ---------------------------------------------------------------------------

describe("§38.13 (iv) emitted JS parses (node --check)", () => {
  test("server + client .js both parse", () => {
    const r = compileToDir(SAMPLE);
    const sPath = join(r.dir, "server-check.mjs");
    const cPath = join(r.dir, "client-check.js");
    writeFileSync(sPath, r.server);
    writeFileSync(cPath, r.client);
    // execFileSync throws on non-zero exit (syntax error) — a clean run == parses.
    execFileSync("node", ["--check", sPath]);
    execFileSync("node", ["--check", cPath]);
    expect(true).toBe(true);
    r.cleanup();
  });
});

// ---------------------------------------------------------------------------
// (v) mock-SQL notification flow (bridge logic) + client branch runtime
// ---------------------------------------------------------------------------

describe("§38.13.7 (v) mock-SQL notification → re-SELECT → publish", () => {
  test("INSERT notification re-SELECTs by PK and publishes an Inserted __change frame; DELETE publishes without re-SELECT", async () => {
    const errors = [];
    const boot = emitChannelWatchesServerBoot(astWithSynth(SAMPLE).chans, "postgres://localhost/app", errors, "app.scrml");
    expect(errors).toEqual([]);
    // The boot block runs `import("pg")` — substitute a mock module for the unit
    // test of the bridge LOGIC (the `import("pg")` shape itself is asserted above).
    const block = boot.join("\n").replace(/import\("pg"\)/g, "Promise.resolve(globalThis.__MOCK_PG)");

    const harness = `
      return (async () => {
        const published = [];
        const selectCalls = [];
        const notifHandlers = [];
        class MockClient {
          constructor(o) { this.o = o; }
          on(evt, cb) { if (evt === "notification") notifHandlers.push(cb); }
          removeAllListeners() {}
          async connect() { return; }
          async query(q) { this.lastQ = q; return { rows: [] }; }
        }
        globalThis.__MOCK_PG = { Client: MockClient };
        globalThis._scrml_active_server = { publish: (t, m) => published.push([t, JSON.parse(m)]) };
        const _scrml_sql = {
          unsafe: async (sql, params) => {
            if (/^SELECT/.test(sql)) { selectCalls.push([sql, params]); return [{ id: params[0], status: "new", total: 42 }]; }
            return [];
          },
        };
        ${block}
        // allow install + connect + LISTEN microtasks to settle
        await new Promise((res) => setTimeout(res, 25));
        await notifHandlers[0]({ payload: JSON.stringify({ op: "INSERT", key: 7 }) });
        await notifHandlers[0]({ payload: JSON.stringify({ op: "DELETE", key: 9 }) });
        return { published, selectCalls };
      })();
    `;
    // eslint-disable-next-line no-new-func
    const { published, selectCalls } = await new Function(harness)();

    // INSERT → one re-SELECT by PK 7 → Inserted frame with the re-SELECTed row.
    expect(selectCalls.length).toBe(1);
    expect(selectCalls[0][1]).toEqual([7]);
    expect(selectCalls[0][0]).toContain('SELECT * FROM "orders" WHERE "id" = $1');
    const inserted = published.find((p) => p[1].op === "Inserted");
    expect(inserted).toBeDefined();
    expect(inserted[0]).toBe("orders-feed");
    expect(inserted[1]).toEqual({ __type: "__change", op: "Inserted", row: { id: 7, status: "new", total: 42 } });

    // DELETE → publish key, NO extra re-SELECT.
    const deleted = published.find((p) => p[1].op === "Deleted");
    expect(deleted).toBeDefined();
    expect(deleted[1]).toEqual({ __type: "__change", op: "Deleted", key: 9 });
    expect(selectCalls.length).toBe(1); // still 1 — DELETE did not re-SELECT
  });

  test("client __change branch runs the matching arm and patches the cell", () => {
    const { chans } = astWithSynth(SAMPLE);
    const lines = emitChannelClientJs(chans[0], [], "app.scrml");
    const branch = extractBalancedBlock(lines.join("\n"), 'if (_d.__type === "__change") {');
    expect(branch).toContain('_d.op === "Inserted"');

    const run = (frame, initial) => {
      const harness = `
        return (function (_d) {
          const store = ${JSON.stringify(initial)};
          const _scrml_reactive_get = (k) => store[k];
          const _scrml_reactive_set = (k, v) => { store[k] = v; };
          // The <onchange> arm bodies end in \`return;\` — contain them in an inner
          // IIFE so the dispatch returns to us and we can read the patched store.
          (function () { ${branch} })();
          return store;
        })(${JSON.stringify(frame)});
      `;
      // eslint-disable-next-line no-new-func
      return new Function(harness)();
    };

    const afterInsert = run(
      { __type: "__change", op: "Inserted", row: { id: 2, status: "new" } },
      { orders: [{ id: 1, status: "old" }] },
    );
    expect(afterInsert.orders).toEqual([{ id: 1, status: "old" }, { id: 2, status: "new" }]);

    const afterUpdate = run(
      { __type: "__change", op: "Updated", row: { id: 1, status: "shipped" } },
      { orders: [{ id: 1, status: "old" }, { id: 2, status: "new" }] },
    );
    expect(afterUpdate.orders).toEqual([{ id: 1, status: "shipped" }, { id: 2, status: "new" }]);

    const afterDelete = run(
      { __type: "__change", op: "Deleted", key: 1 },
      { orders: [{ id: 1, status: "old" }, { id: 2, status: "new" }] },
    );
    expect(afterDelete.orders).toEqual([{ id: 2, status: "new" }]);
  });
});

// ---------------------------------------------------------------------------
// (vi) regression — non-watches channels are unperturbed
// ---------------------------------------------------------------------------

describe("§38.13 (vi) non-watches regression", () => {
  test("a §38.4 synced-cell channel emits NO __change branch + NO capture block; __sync preserved", () => {
    const r = compileToDir(`<program>
  <channel name="room">
    <messages> = []
  </channel>
</program>`);
    expect(r.errors).toEqual([]);
    expect(r.client.includes("__change")).toBe(false);
    expect(r.server.includes("§38.13.7")).toBe(false);
    expect(r.server.includes("__sync")).toBe(true);
    r.cleanup();
  });
});

// ---------------------------------------------------------------------------
// (vii) no-PK feed — server capture skipped, client dispatch inert
// ---------------------------------------------------------------------------

describe("§38.13.2 (vii) no-PK watches feed", () => {
  const NOPK = `<program db="postgres://localhost/app">
  <schema>
    events {
      label: text
      ts: real
    }
  </schema>
  <channel name="events-feed" watches=events>
      <onchange>
          <Inserted(row) : { @rows = [...@rows, row] }>
          <Updated(row) : { @rows = @rows }>
          <Deleted(key) : { @rows = @rows }>
      </onchange>
  </channel>
</program>`;

  test("W-CHANNEL-WATCHES-NO-PK fires; server capture SKIPPED; client dispatch present-but-inert", () => {
    const r = compileToDir(NOPK);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toContain("W-CHANNEL-WATCHES-NO-PK");
    // No PK → the feed cannot key deltas → no server capture emitted.
    expect(r.server.includes("§38.13.7")).toBe(false);
    // The client <onchange> dispatch is still emitted (harmlessly inert).
    expect(r.client.includes("__change")).toBe(true);
    r.cleanup();
  });

  test("emitChannelWatchesServerBoot returns [] for a no-PK feed", () => {
    const nodes = buildAST(splitBlocks("app.scrml", NOPK)).ast?.nodes ?? [];
    const tables = collectSchemaTables(nodes);
    const chans = collectChannelNodes(nodes);
    for (const ch of chans) {
      if (!isWatchesChannel(ch)) continue;
      const t = tables.get((readLiteralIdentAttr(ch, "watches") || "").toLowerCase());
      if (t) ch._rowChangeSynth = synthesizeRowChange({ name: t.name, columns: t.columns }, readLiteralIdentAttr(ch, "key"));
    }
    const boot = emitChannelWatchesServerBoot(chans, "postgres://localhost/app", [], "app.scrml");
    expect(boot).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// (viii) §14.8.9 protect-egress — a protect= column must NOT reach the feed
// ---------------------------------------------------------------------------

describe("§14.8.9 (viii) protected-column egress on the watches feed", () => {
  const USERS = `<program db="postgres://localhost/app">
  <schema>
    users {
      id: integer primary key
      email: text
      passwordHash: text
    }
  </schema>
  <channel name="users-feed" watches=users>
      <onchange>
          <Inserted(row) : { @users = [...@users, row] }>
          <Updated(row) : { @users = @users }>
          <Deleted(key) : { @users = @users }>
      </onchange>
  </channel>
</program>`;

  function usersChans() {
    const nodes = buildAST(splitBlocks("app.scrml", USERS)).ast?.nodes ?? [];
    const tables = collectSchemaTables(nodes);
    const chans = collectChannelNodes(nodes);
    for (const ch of chans) {
      if (!isWatchesChannel(ch)) continue;
      const t = tables.get((readLiteralIdentAttr(ch, "watches") || "").toLowerCase());
      if (t) ch._rowChangeSynth = synthesizeRowChange({ name: t.name, columns: t.columns }, readLiteralIdentAttr(ch, "key"));
    }
    return chans;
  }

  test("emits tag-then-redact when the watched table has a protected column", () => {
    const protMap = new Map([["users", new Set(["passwordHash"])]]);
    const boot = emitChannelWatchesServerBoot(usersChans(), "postgres://localhost/app", [], "app.scrml", protMap).join("\n");
    // hand-emitted SELECT * is TAGGED with the protected column, then the
    // published row is REDACTED (mirror of the SSR /__serverLoad Tier-1 sink).
    expect(boot).toContain('_scrml_protect_tag(await _scrml_sql.unsafe("SELECT * FROM \\"users\\" WHERE \\"id\\" = $1", [_p.key]), ["passwordHash"])');
    expect(boot).toContain("row: _scrml_protect_redact(_row)");
  });

  test("byte-identical (no _scrml_protect_ refs) when no protected column", () => {
    const boot = emitChannelWatchesServerBoot(usersChans(), "postgres://localhost/app", [], "app.scrml", null).join("\n");
    expect(boot.includes("_scrml_protect_")).toBe(false);
    // still a plain re-SELECT + publish
    expect(boot).toContain("const _rows = await _scrml_sql.unsafe(");
    expect(boot).toContain("row: _row }");
  });

  test("RUNTIME: the published __change frame OMITS the protected column, keeps the rest", async () => {
    const protMap = new Map([["users", new Set(["passwordHash"])]]);
    const boot = emitChannelWatchesServerBoot(usersChans(), "postgres://localhost/app", [], "app.scrml", protMap).join("\n");
    const block = boot.replace(/import\("pg"\)/g, "Promise.resolve(globalThis.__MOCK_PG)");

    // Inject the REAL server protect helper so _scrml_protect_tag/redact are defined.
    const harness = `
      ${SERVER_PROTECT_HELPER}
      return (async () => {
        const published = [];
        const notifHandlers = [];
        class MockClient {
          constructor(o) { this.o = o; }
          on(evt, cb) { if (evt === "notification") notifHandlers.push(cb); }
          removeAllListeners() {}
          async connect() { return; }
          async query() { return { rows: [] }; }
        }
        globalThis.__MOCK_PG = { Client: MockClient };
        globalThis._scrml_active_server = { publish: (t, m) => published.push(JSON.parse(m)) };
        const _scrml_sql = {
          unsafe: async (sql, params) => {
            if (/^SELECT/.test(sql)) return [{ id: params[0], email: "a@b.co", passwordHash: "SECRET-HASH" }];
            return [];
          },
        };
        ${block}
        await new Promise((res) => setTimeout(res, 25));
        await notifHandlers[0]({ payload: JSON.stringify({ op: "INSERT", key: 3 }) });
        return published;
      })();
    `;
    // eslint-disable-next-line no-new-func
    const published = await new Function(harness)();
    const inserted = published.find((p) => p.op === "Inserted");
    expect(inserted).toBeDefined();
    // The protected column is stripped from the published row...
    expect(inserted.row.passwordHash).toBeUndefined();
    expect("passwordHash" in inserted.row).toBe(false);
    // ...while the non-protected columns are intact.
    expect(inserted.row.id).toBe(3);
    expect(inserted.row.email).toBe("a@b.co");
  });
});
