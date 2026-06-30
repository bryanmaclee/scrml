/**
 * §14.8.9 — Server→client confidentiality: protected-column egress redaction.
 *
 * Covers the S215 adversarial attack matrix (A1/A2/A3/A4 + reveal round-trip +
 * raw-egress fail-closed) at three layers:
 *   1. the pure origin resolver (resolveProtectedOutputColumns) — alias-safe,
 *      star-expansion, unresolvable -> strip-all, no-protect -> null;
 *   2. the SHIPPED runtime helper (SERVER_PROTECT_HELPER, eval'd) — tag/redact/
 *      reveal, descriptor survives spread, JSON-invisible;
 *   3. end-to-end compilation — the emitted server JS tags + redacts, fires
 *      I-PROTECT-STRIP-001 / E-PROTECT-004, and never ships the protected column.
 */
import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { compileScrml } from "../../src/api.js";
import {
  resolveProtectedOutputColumns,
  buildProtectContext,
  SERVER_PROTECT_HELPER,
} from "../../src/codegen/protect-egress.ts";

// --- helpers ----------------------------------------------------------------

function ctxOf(protectedByTable, schemaByTable = new Map()) {
  return { protectedByTable, schemaByTable };
}
const usersProtect = () => ctxOf(new Map([["users", new Set(["passwordHash"])]]));

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-protect-floor-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out, serverJs: out?.serverJs ?? "" };
}
const parseClean = (js) =>
  expect(() => acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();

// Eval the SHIPPED helper block into three callables so we exercise the exact
// runtime the server bundle ships (not a re-implementation).
function loadHelper() {
  const fn = new Function(SERVER_PROTECT_HELPER + "\nreturn { _scrml_protect_tag, _scrml_protect_redact, _scrml_protect_reveal };");
  return fn();
}

// A program whose `<db protect=...>` table the PA stage resolves, with a server
// fn returning the protected row through `pattern`.
function protectProgram(serverBody) {
  return `<program>

  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>

  <db src="app.db" protect="passwordHash" tables="users">

    \${
${serverBody}
    }

  </db>

  <div><p>hi</p></div>
</program>`;
}

// A `<channel>` (§38) whose channel-owned server fn SELECTs the protected row
// and reaches the `broadcast()` client-egress sink via `channelBody`.
function protectChannelProgram(channelBody) {
  return `<program>

  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>

  <db src="app.db" protect="passwordHash" tables="users">
    \${
      function noop() { return 1 }
    }
  </db>

  <channel name="chat" topic="lobby">
    \${
      <messages> = []
${channelBody}
    }
  </>

  <div><p>hi</p></div>
</program>`;
}

// A `server function*` (§37 SSE) whose generator SELECTs the protected row and
// reaches the `data:` client-egress frame via `sseBody`.
function protectSseProgram(sseBody) {
  return `<program>

  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>

  <db src="app.db" protect="passwordHash" tables="users">
    \${
${sseBody}
    }
  </db>

  <div><p>hi</p></div>
</program>`;
}

// ---------------------------------------------------------------------------
// LAYER 1 — the pure origin resolver
// ---------------------------------------------------------------------------
describe("§14.8.9 resolveProtectedOutputColumns — alias-safe origin resolution", () => {
  test("A1: SELECT * over a protected table carries the protected column", () => {
    const r = resolveProtectedOutputColumns("SELECT * FROM users", usersProtect());
    expect(r && "cols" in r && r.cols).toEqual(["passwordHash"]);
  });

  test("A2: SELECT passwordHash AS h is keyed on ORIGIN, output name `h`", () => {
    const r = resolveProtectedOutputColumns("SELECT id, passwordHash AS h FROM users", usersProtect());
    expect(r && "cols" in r && r.cols).toEqual(["h"]);
  });

  test("explicit safe projection (no protected column) -> null (no tag)", () => {
    const r = resolveProtectedOutputColumns("SELECT id, name FROM users", usersProtect());
    expect(r).toBeNull();
  });

  test("non-protected table -> null", () => {
    const r = resolveProtectedOutputColumns("SELECT * FROM products", usersProtect());
    expect(r).toBeNull();
  });

  test("unresolvable dynamic SELECT -> strip-all (fail-closed)", () => {
    const r = resolveProtectedOutputColumns("SELECT ${cols} FROM users", usersProtect());
    expect(r && "all" in r && r.all).toBe(true);
  });

  test("CTE/UNION SELECT -> strip-all (fail-closed)", () => {
    const r = resolveProtectedOutputColumns("SELECT a FROM users UNION SELECT b FROM users", usersProtect());
    expect(r && "all" in r && r.all).toBe(true);
  });

  test("non-SELECT (INSERT/DELETE) -> null (no client row egress)", () => {
    expect(resolveProtectedOutputColumns("DELETE FROM users WHERE id = ${id}", usersProtect())).toBeNull();
    expect(resolveProtectedOutputColumns("INSERT INTO users (name) VALUES (${n})", usersProtect())).toBeNull();
  });

  test("aliased JOIN keeps each output column's own origin", () => {
    const ctx = ctxOf(new Map([["users", new Set(["passwordHash"])]]));
    const r = resolveProtectedOutputColumns(
      "SELECT u.id, u.passwordHash AS secret, o.total FROM users u JOIN orders o ON o.uid = u.id",
      ctx,
    );
    expect(r && "cols" in r && r.cols).toEqual(["secret"]);
  });
});

// ---------------------------------------------------------------------------
// LAYER 2 — the SHIPPED runtime helper (eval'd)
// ---------------------------------------------------------------------------
describe("§14.8.9 runtime helper — tag/redact/reveal (the shipped block)", () => {
  test("A1: tag + redact strips the protected column", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, name: "a", passwordHash: "secret" }, ["passwordHash"]);
    const out = _scrml_protect_redact(row);
    expect(out).toEqual({ id: 1, name: "a" });
    expect(out.passwordHash).toBeUndefined();
  });

  test("A3: descriptor survives {...spread} and .map -> still stripped", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const rows = _scrml_protect_tag([{ id: 1, passwordHash: "x" }, { id: 2, passwordHash: "y" }], ["passwordHash"]);
    // launder through a helper that spreads each row
    const laundered = rows.map((r) => ({ ...r, extra: true }));
    const out = _scrml_protect_redact(laundered);
    expect(out).toEqual([{ id: 1, extra: true }, { id: 2, extra: true }]);
  });

  test("descriptor is JSON-invisible (never serialized as data)", () => {
    const { _scrml_protect_tag } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, passwordHash: "x" }, ["passwordHash"]);
    expect(JSON.parse(JSON.stringify(row))).toEqual({ id: 1, passwordHash: "x" });
  });

  test("reveal round-trip: revealed column is admitted", () => {
    const { _scrml_protect_tag, _scrml_protect_redact, _scrml_protect_reveal } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, passwordHash: "secret" }, ["passwordHash"]);
    const revealed = _scrml_protect_reveal(row, "passwordHash");
    expect(_scrml_protect_redact(revealed)).toEqual({ id: 1, passwordHash: "secret" });
    // the ORIGINAL row (server-retained) is unmutated — still redacts
    expect(_scrml_protect_redact(row)).toEqual({ id: 1 });
  });

  test("strip-all ('*') drops every column (unresolvable dynamic SQL)", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, name: "a", passwordHash: "x" }, "*");
    expect(_scrml_protect_redact(row)).toEqual({});
  });

  test("untagged value passes through unchanged (no protected origin)", () => {
    const { _scrml_protect_redact } = loadHelper();
    expect(_scrml_protect_redact({ a: 1, b: [2, 3] })).toEqual({ a: 1, b: [2, 3] });
    expect(_scrml_protect_redact(null)).toBeNull();
    expect(_scrml_protect_redact("hi")).toBe("hi");
  });

  test("Response instance passes through (raw egress not double-handled)", () => {
    const { _scrml_protect_redact } = loadHelper();
    const r = new Response("body");
    expect(_scrml_protect_redact(r)).toBe(r);
  });

  test("nested tagged row inside a wrapper object is redacted", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const u = _scrml_protect_tag({ id: 1, passwordHash: "x" }, ["passwordHash"]);
    expect(_scrml_protect_redact({ user: u, ok: true })).toEqual({ user: { id: 1 }, ok: true });
  });
});

// ---------------------------------------------------------------------------
// LAYER 3 — end-to-end compilation (the floor lands)
// ---------------------------------------------------------------------------
describe("§14.8.9 end-to-end — the egress floor strips at compile time", () => {
  test("A1: bare return of SELECT * tags + redacts; passwordHash absent from emitted JS data", () => {
    const { serverJs, result } = compileSource(protectProgram(
      `      function getUser(id) {\n        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n      }`,
    ));
    expect(serverJs).toContain("_scrml_protect_tag(");
    expect(serverJs).toContain("_scrml_protect_redact(");
    expect(serverJs).toContain("_scrml_protect_tag((await _scrml_sql`SELECT * FROM users WHERE id = ${id}`)[0] ?? null, [\"passwordHash\"])");
    // the helper is injected
    expect(serverJs).toContain("function _scrml_protect_redact(value)");
    parseClean(serverJs);
    // I-PROTECT-STRIP-001 info fired (cross-stream — warnings OR errors)
    const allDiag = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(allDiag.some((d) => d.code === "I-PROTECT-STRIP-001")).toBe(true);
  });

  test("A2: SELECT passwordHash AS h tags the alias `h`", () => {
    const { serverJs } = compileSource(protectProgram(
      `      function getUser(id) {\n        return ?{\`SELECT id, passwordHash AS h FROM users WHERE id = \${id}\`}.get()\n      }`,
    ));
    expect(serverJs).toContain('_scrml_protect_tag((await _scrml_sql`SELECT id, passwordHash AS h FROM users WHERE id = ${id}`)[0] ?? null, ["h"])');
    parseClean(serverJs);
  });

  test("safe explicit projection is NOT tagged (no protected column selected)", () => {
    // In a protect-ACTIVE app, the egress sink still applies a DEFENSIVE redact
    // (no value-flow analysis tells the sink the row is clean), but the safe
    // query's RESULT carries no protected-origin descriptor — so the redact is a
    // runtime no-op. The meaningful per-query property: this SELECT is not tagged.
    const { serverJs } = compileSource(protectProgram(
      `      function getUser(id) {\n        return ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n      }`,
    ));
    expect(serverJs).not.toContain("_scrml_protect_tag((await _scrml_sql`SELECT id, name");
    expect(serverJs).toContain("_scrml_protect_redact("); // defensive sink redact present
    parseClean(serverJs);
  });

  test("reveal: return u.reveal(\"passwordHash\") lowers to _scrml_protect_reveal", () => {
    const { serverJs } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return u.reveal("passwordHash")\n      }`,
    ));
    expect(serverJs).toContain('_scrml_protect_reveal(');
    expect(serverJs).toContain('"passwordHash"');
    parseClean(serverJs);
  });

  test("a non-protect app is byte-unchanged (no protect helpers)", () => {
    const src = `<program>
  <schema>
    ?{\`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)\`}
  </schema>
  <db src="app.db" tables="products">
    \${
      function getProduct(id) {
        return ?{\`SELECT * FROM products WHERE id = \${id}\`}.get()
      }
    }
  </db>
  <div><p>hi</p></div>
</program>`;
    const { serverJs } = compileSource(src);
    expect(serverJs).not.toContain("_scrml_protect");
    parseClean(serverJs);
  });
});

// ---------------------------------------------------------------------------
// buildProtectContext duck-typing
// ---------------------------------------------------------------------------
describe("§14.8.9 buildProtectContext", () => {
  test("extracts protectedByTable + schemaByTable from ProtectAnalysis views", () => {
    const analysis = {
      views: new Map([
        ["db1", {
          tables: new Map([
            ["users", {
              protectedFields: new Set(["passwordHash"]),
              fullSchema: [{ name: "id" }, { name: "name" }, { name: "passwordHash" }],
            }],
          ]),
        }],
      ]),
    };
    const ctx = buildProtectContext(analysis);
    expect(ctx.protectedByTable.get("users")).toEqual(new Set(["passwordHash"]));
    expect(ctx.schemaByTable.get("users")).toEqual(["id", "name", "passwordHash"]);
  });

  test("empty / undefined analysis -> empty maps (protect inactive)", () => {
    expect(buildProtectContext(undefined).protectedByTable.size).toBe(0);
    expect(buildProtectContext({ views: new Map() }).protectedByTable.size).toBe(0);
  });
});
// ---------------------------------------------------------------------------
// A4 — DERIVED flows are OUT OF SCOPE (documented, NOT silently "caught")
// ---------------------------------------------------------------------------
describe("§14.8.9 A4 — derived/implicit flows are out of scope (honest bound)", () => {
  test("a value DERIVED from a protected column carries no descriptor (not caught)", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, passwordHash: "secret" }, ["passwordHash"]);
    // `{ hasPw: row.passwordHash != "" }` — a value of INDEPENDENT identity built
    // from the protected column. It carries no protected-origin descriptor, so
    // the structural floor does NOT (and does not claim to) strip it. Catching
    // this would require full expression-label IFC (§14.8.9 deferred bound).
    const derived = { hasPw: row.passwordHash !== "" };
    expect(_scrml_protect_redact(derived)).toEqual({ hasPw: true });
  });

  test("member-extraction into a re-keyed literal `{ secret: row.pw }` is the same boundary", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, passwordHash: "secret" }, ["passwordHash"]);
    // A fresh literal that re-keys the column value loses the descriptor — the
    // derived-flow boundary. The floor catches WHOLE-ROW-IDENTITY flows, not
    // per-value member extraction (documented; the deferred A-layer / IFC).
    const rekeyed = { secret: row.passwordHash };
    expect(_scrml_protect_redact(rekeyed)).toEqual({ secret: "secret" });
  });
});

// ---------------------------------------------------------------------------
// raw-egress fail-closed — E-PROTECT-004
// ---------------------------------------------------------------------------
describe("§14.8.9 raw-egress fail-closed — E-PROTECT-004", () => {
  test("protected row reaching a manual `new Response` fires E-PROTECT-004", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  test("a `reveal` declassification suppresses the raw-egress gate", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u.reveal("passwordHash")))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
  });

  test("no raw egress + protected query -> NO E-PROTECT-004 (the floor strips)", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LAYER 3b — channel `broadcast()` (§38) + SSE `server function*` (§37) egress
// sinks. These are ADDITIONAL compiler-emitted client-egress serializers; the
// floor redacts at them identically to the server-fn return.
// ---------------------------------------------------------------------------
describe("§14.8.9 channel broadcast (§38) egress — strips at the publish sink", () => {
  test("broadcast(protectedRow) wraps the published frame with _scrml_protect_redact", () => {
    const { serverJs, result } = compileSource(protectChannelProgram(
      `      function pushUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        broadcast(u)\n      }`,
    ));
    // the SELECT is tagged at lowering
    expect(serverJs).toContain('_scrml_protect_tag((await _scrml_sql`SELECT * FROM users WHERE id = ${id}`)[0] ?? null, ["passwordHash"])');
    // the broadcast built-in redacts at the publish sink (the wire frame)
    expect(serverJs).toContain("_scrml_srv.publish(\"lobby\", JSON.stringify(_scrml_protect_redact(_scrml_data)));");
    // helper auto-injected via the on-use scan (finalEmitted.includes)
    expect(serverJs).toContain("function _scrml_protect_redact(value)");
    parseClean(serverJs);
    // I-PROTECT-STRIP-001 names the stripped column
    const allDiag = [...(result.warnings ?? []), ...(result.errors ?? [])];
    const strip = allDiag.find((d) => d.code === "I-PROTECT-STRIP-001");
    expect(strip).toBeDefined();
    expect(strip.message).toContain("passwordHash");
  });

  test("reveal round-trip: broadcast(u.reveal(\"passwordHash\")) lowers to _scrml_protect_reveal", () => {
    const { serverJs } = compileSource(protectChannelProgram(
      `      function pushUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        broadcast(u.reveal("passwordHash"))\n      }`,
    ));
    expect(serverJs).toContain("_scrml_protect_reveal(");
    // still wrapped in the publish-sink redact (which honors the reveal list)
    expect(serverJs).toContain("_scrml_srv.publish(\"lobby\", JSON.stringify(_scrml_protect_redact(_scrml_data)));");
    parseClean(serverJs);
  });

  test("a non-protect channel app is byte-unchanged at the publish sink (no redact wrap)", () => {
    const src = `<program>
  <schema>
    ?{\`CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT)\`}
  </schema>
  <db src="app.db" tables="rooms">
    \${ function noop() { return 1 } }
  </db>
  <channel name="chat" topic="lobby">
    \${
      <messages> = []
      function pushRoom(id) {
        let r = ?{\`SELECT * FROM rooms WHERE id = \${id}\`}.get()
        broadcast(r)
      }
    }
  </>
  <div><p>hi</p></div>
</program>`;
    const { serverJs } = compileSource(src);
    expect(serverJs).not.toContain("_scrml_protect");
    // the publish sink is the plain pre-floor form — no redact wrap
    expect(serverJs).toContain("_scrml_srv.publish(\"lobby\", JSON.stringify(_scrml_data));");
    parseClean(serverJs);
  });
});

describe("§14.8.9 SSE server function* (§37) egress — strips at the data: frame", () => {
  test("a generator yielding {event,data:protectedRows} redacts both frame shapes", () => {
    const { serverJs, result } = compileSource(protectSseProgram(
      `      server function* streamUsers() route="/users/stream" {\n        let u = ?{\`SELECT * FROM users\`}.all()\n        yield { event: "user", id: 1, data: u }\n      }`,
    ));
    // the SELECT is tagged at lowering
    expect(serverJs).toContain('_scrml_protect_tag(await _scrml_sql`SELECT * FROM users`, ["passwordHash"])');
    // BOTH SSE data: sinks (the {event,data} shape and the bare-value shape) redact
    expect(serverJs).toContain("`data: ${JSON.stringify(_scrml_protect_redact(_scrml_val.data))}\\n\\n`");
    expect(serverJs).toContain("`data: ${JSON.stringify(_scrml_protect_redact(_scrml_val))}\\n\\n`");
    expect(serverJs).toContain("function _scrml_protect_redact(value)");
    parseClean(serverJs);
    const allDiag = [...(result.warnings ?? []), ...(result.errors ?? [])];
    const strip = allDiag.find((d) => d.code === "I-PROTECT-STRIP-001");
    expect(strip).toBeDefined();
    expect(strip.message).toContain("passwordHash");
  });

  test("a non-protect SSE app is byte-unchanged at the data: frame (no redact wrap)", () => {
    const src = `<program>
  <schema>
    ?{\`CREATE TABLE ticks (id INTEGER PRIMARY KEY, val INTEGER)\`}
  </schema>
  <db src="app.db" tables="ticks">
    \${
      server function* streamTicks() route="/ticks/stream" {
        let rows = ?{\`SELECT * FROM ticks\`}.all()
        yield { event: "tick", id: 1, data: rows }
      }
    }
  </db>
  <div><p>hi</p></div>
</program>`;
    const { serverJs } = compileSource(src);
    expect(serverJs).not.toContain("_scrml_protect");
    // the data: frame is the plain pre-floor form — no redact wrap
    expect(serverJs).toContain("`data: ${JSON.stringify(_scrml_val.data)}\\n\\n`");
    expect(serverJs).toContain("`data: ${JSON.stringify(_scrml_val)}\\n\\n`");
    parseClean(serverJs);
  });
});

// ---------------------------------------------------------------------------
// LAYER 2b — the SHIPPED runtime helper at the channel/SSE wire shapes. Proves
// the EXACT bytes the published frame / SSE chunk carry strip the protected
// column (and that the channel-cell-write `{__sync,__val:row}` lowering — which
// routes through the SAME hardened `broadcast()` built-in — strips transitively
// because redact recurses into nested object values).
// ---------------------------------------------------------------------------
describe("§14.8.9 channel/SSE runtime wire shapes — the published bytes are clean", () => {
  test("broadcast(row): the JSON.stringify(redact(row)) wire frame omits the protected column", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, name: "a", passwordHash: "SECRET" }, ["passwordHash"]);
    const frame = JSON.stringify(_scrml_protect_redact(row));
    expect(frame).not.toContain("SECRET");
    expect(JSON.parse(frame)).toEqual({ id: 1, name: "a" });
  });

  test("channel-cell-write {__type:__sync,__key,__val:row} strips the row transitively (nested recursion)", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, name: "a", passwordHash: "SECRET" }, ["passwordHash"]);
    const frame = JSON.stringify(_scrml_protect_redact({ __type: "__sync", __key: "m", __val: row }));
    expect(frame).not.toContain("SECRET");
    expect(JSON.parse(frame)).toEqual({ __type: "__sync", __key: "m", __val: { id: 1, name: "a" } });
  });

  test("SSE data: frame (an array of rows) strips each protected column", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const rows = _scrml_protect_tag([{ id: 1, passwordHash: "x" }, { id: 2, passwordHash: "y" }], ["passwordHash"]);
    const frame = JSON.stringify(_scrml_protect_redact(rows));
    expect(frame).not.toMatch(/"passwordHash"/);
    expect(JSON.parse(frame)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("reveal-stamped row at the broadcast sink is admitted (reveal round-trip)", () => {
    const { _scrml_protect_tag, _scrml_protect_redact, _scrml_protect_reveal } = loadHelper();
    const row = _scrml_protect_tag({ id: 1, passwordHash: "SECRET" }, ["passwordHash"]);
    const revealed = _scrml_protect_reveal(row, "passwordHash");
    const frame = JSON.stringify(_scrml_protect_redact(revealed));
    expect(JSON.parse(frame)).toEqual({ id: 1, passwordHash: "SECRET" });
  });

  test("untagged broadcast/SSE value passes through unchanged (no over-redaction)", () => {
    const { _scrml_protect_redact } = loadHelper();
    // a broadcast() of a non-protect computed literal — the runtime no-op property
    expect(_scrml_protect_redact({ author: "a", body: "hi", ts: 7 })).toEqual({ author: "a", body: "hi", ts: 7 });
    // an SSE of plain data
    expect(_scrml_protect_redact([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
