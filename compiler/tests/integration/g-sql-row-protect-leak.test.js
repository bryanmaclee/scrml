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

// --- THE FILE-WIDE ANTI-VACUITY FLOOR (F4, round 6) -------------------------
//
// `expect(fires(result)).toBe(false)` is satisfied by a fixture that never
// compiled: every green shape in this file would pass on a syntax error. Round 5
// answered that with a helper — and then carried TWO SEPARATE COPIES of it, in
// two describe blocks, while a third describe had none. Worse, both copies only
// EXCLUDED two codes, so any OTHER hard error walked straight through: adding
// `let n:number = "not a number"` to a green fixture raises `E-TYPE-031` and
// every assertion still passed.
//
// So there is one helper, it lives here, and it asserts an EQUALITY on the error
// set. `E-SCHEMA-001` is the fixture-wide constant — `protectProgram`'s
// `<program>` carries no `db=` attribute, so every fixture in this file raises
// it. Anything else in `result.errors` means the fixture is broken and its green
// half proves nothing.
const codesOf = (result) => [...(result.warnings ?? []), ...(result.errors ?? [])];
const fires = (result) => codesOf(result).some((d) => d.code === "E-PROTECT-004");
const e004 = (result) => codesOf(result).find((d) => d.code === "E-PROTECT-004");
const serverJsOf = (result) =>
  (result.outputs ? [...result.outputs.values()][0]?.serverJs : "") ?? "";
const errorCodesOf = (result) =>
  [...new Set((result.errors ?? []).map((d) => d.code))].sort();

/** The fixture COMPILED and raised NOTHING but the fixture-wide `E-SCHEMA-001`.
 *  Every shape asserted not to fire gets this. */
const expectCompiledCleanly = (result) => {
  expect(errorCodesOf(result)).toEqual(["E-SCHEMA-001"]);
  expect(serverJsOf(result).length).toBeGreaterThan(0);
};

/** ...and the protect machinery genuinely ENGAGED: the strip info named a
 *  column, and the row left through the redacting path. Every green shape whose
 *  fixture selects a protected column IN THIS FILE gets this one. */
const expectCompiledAndProtecting = (result) => {
  expectCompiledCleanly(result);
  expect(codesOf(result).map((d) => d.code)).toContain("I-PROTECT-STRIP-001");
  expect(serverJsOf(result)).toContain("_scrml_protect_redact");
};

/** The RED half's mirror: the fixture fired for THIS gate's reason and for no
 *  other — the error set is exactly the fixture-wide constant plus
 *  `E-PROTECT-004`. */
const expectFiredCleanly = (result) => {
  expect(errorCodesOf(result)).toEqual(["E-PROTECT-004", "E-SCHEMA-001"]);
};

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
    const { serverJs, result } = compileSource(src);

    // POSITIVE assertions FIRST. `not.toContain(...)` + `parseClean("")` are
    // BOTH satisfied by a fixture that never compiled — `serverJs` is `""` when
    // compilation fails, which contains nothing and parses fine. So the absence
    // claim is only worth stating once the presence of a real emission is
    // established: the file compiled, it emitted the query this fixture is
    // about, and it emitted it WITHOUT the protect machinery.
    // `E-SCHEMA-001` is the file-wide constant (no `db=` on `<program>`), the
    // same one `expectCompiledCleanly` pins — anything ELSE means broken.
    expect(errorCodesOf(result)).toEqual(["E-SCHEMA-001"]);
    expect(serverJs.length).toBeGreaterThan(0);
    expect(serverJs).toContain("SELECT * FROM products WHERE id =");
    expect(serverJs).toContain("_scrml_sql");

    // ...and now the byte-unchanged claim means something.
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

  // dpa-033 (c), S352 — the `reveal` suppressor is DELETED. §14.8.9 scopes
  // declassification to the VALUE ("at the value" / "declassified-at-this-value"
  // / "at the sink" / "here only", SPEC.md:8506-8513); a body-wide suppressor
  // admitted a value bearing no stamp. The raw-egress gate is now a floor with
  // NO exit — sink-level lowering (the value-scoped exit) is a separate arc.
  // provenance: ruling:user-voice-scrml.md S352
  test("a `reveal` on the RETURNED value does NOT suppress the raw-egress gate (dpa-033 c)", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u.reveal("passwordHash")))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  // The defect the deletion closes: the suppressor was body-wide, so a reveal on
  // a COMPLETELY DIFFERENT query's row silenced the gate for the actually-
  // returned, never-revealed row. Pre-fix this compiled with no E-PROTECT-004.
  test("a `reveal` on a DIFFERENT query's row does not silence the returned row's gate", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let other = ?{\`SELECT * FROM users WHERE id = 999\`}.get()\n        let decoy = other.reveal("passwordHash")\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  // dpa-029 Q1, S352 — the detector resolves the constructor callee through its
  // MEMBER CHAIN, so an aliasing spelling reaches the same conclusion as the bare
  // one. Pre-fix `/\bnew\s+Response\b/` missed this: the file compiled at exit 0
  // with ZERO diagnostics, and the emitted handler's `instanceof Response`
  // passthrough returned the manual response BEFORE `_scrml_protect_redact`, so
  // `{"id":1,"name":"ada","passwordHash":"…"}` shipped to the client.
  test("`new globalThis.Response(...)` fires E-PROTECT-004 (member-chain callee)", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new globalThis.Response(JSON.stringify(u))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  test("`new window.Response(...)` fires E-PROTECT-004 (any aliasing receiver)", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new window.Response(JSON.stringify(u))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // H2 (S353 adversarial round 3) — a BRACKET with a static string key denotes
  // exactly the property the dot form denotes, so it has to answer the same.
  // `a["b"]` parses to an INDEX node (`types/ast.ts`: MemberExpr.property is a
  // plain string; computed access is IndexExpr), which `terminalName` did not
  // resolve, so every bracket spelling was a non-match.
  //
  // Measured before the fix: each of these compiled at exit 0 with zero
  // diagnostics, and the emitted handler, executed verbatim against a stubbed
  // `_scrml_sql`, answered
  //   STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}
  const bracketShapes = {
    'new globalThis["Response"](...)': `return new globalThis["Response"](JSON.stringify(u))`,
    "new globalThis['Response'](...)": `return new globalThis['Response'](JSON.stringify(u))`,
    'new window["Response"](...)': `return new window["Response"](JSON.stringify(u))`,
    'new globalThis["foo"]["Response"](...)': `return new globalThis["foo"]["Response"](JSON.stringify(u))`,
    'globalThis["Response"].json(...)': `return globalThis["Response"].json(u)`,
    'Response["json"](...)': `return Response["json"](u)`,
  };
  for (const [label, ret] of Object.entries(bracketShapes)) {
    test(`\`${label}\` fires E-PROTECT-004 (static bracket key resolves)`, () => {
      const { result } = compileSource(protectProgram(
        `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        ${ret}\n      }`,
      ));
      const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
      expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
    });
  }

  // The DOCUMENTED RESIDUAL, pinned so it is visible rather than assumed closed.
  // Callee resolution is SYNTACTIC: a key whose value is not in the tree
  // (`globalThis[k]`) and a local rebinding (`let R = Response; new R()`) are
  // both unresolved, and both need the name resolver / constant propagation, not
  // a wider callee test. If a later arc closes either, THESE TESTS GO RED — that
  // is the point: the residual paragraph in `protect-egress.ts` must be updated
  // in the same change.
  //
  // ALL THREE spellings are parity with `main` — this branch widens nothing.
  // Measured on an extracted `origin/main` tree (`git archive origin/main` plus
  // the real `node_modules`): `let R = Response`, `let R = globalThis.Response`
  // and `globalThis[k]` each compile there with NO E-SCOPE-001, and
  // E-PROTECT-004 is absent on both trees. `Response` / `Request` / `Headers`
  // are in `LOGIC_SCOPE_GLOBAL_ALLOWLIST` ON MAIN (#590, S355) — this branch's
  // `type-system.ts` diff is comment-only and allowlists nothing. The earlier
  // "WIDENED by this branch" label was measured against a base tree that did
  // not have main's allowlist, and was wrong.
  test("RESIDUAL (documented): a dynamic bracket key `globalThis[k]` is not resolved", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let k = "Response"\n        return new globalThis[k](JSON.stringify(u))\n      }`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  test("RESIDUAL (documented, carry-forward): a local rebinding `let R = Response` is not resolved", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let R = Response\n        return new R(JSON.stringify(u))\n      }`,
    ));
    expect(fires(result)).toBe(false);
    // ...and it does not build-block, on this tree OR on `origin/main` — the
    // allowlist entry that makes the spelling reachable is main's, not this
    // branch's. This assertion pins a CARRY-FORWARD, not a widening.
    expectCompiledAndProtecting(result);
  });

  // The foreign-block egress kind is a NODE KIND, so every opener level answers
  // the same. Pre-fix `/(^|[^A-Za-z0-9_$])_\{/` matched only the LEVEL-0 opener,
  // so the canonical `_={ … }=` form SPEC §23.2.4a's own worked example uses
  // walked past the gate at exit 0.
  test("a level-1 `_={ … }=` foreign block fires E-PROTECT-004", () => {
    const src = `<program lang="ts">

  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>

  <db src="app.db" protect="passwordHash" tables="users">

    \${
      function getUser(id) {
        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
        let out = _={ in: { u }
          JSON.stringify(u)
        }=
        return out
      }
    }

  </db>

  <div><p>hi</p></div>
</program>`;
    const { result } = compileSource(src);
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  // The other direction of the same root cause: a source-text regex fires on a
  // token that is not code. Pre-fix this REJECTED valid source (E-PROTECT-004 on
  // a `new Response` living only in a comment and a string literal) — invariant
  // 55's canonical failure mode, and a fail-CLOSED false positive.
  test("`new Response` in a COMMENT and a STRING does NOT fire E-PROTECT-004", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        // a comment naming new Response and asIs must not fire the gate\n        let label = "new Response / asIs"\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return { name: u.name, label: label }\n      }`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  test("no raw egress + protected query -> NO E-PROTECT-004 (the floor strips)", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n      }`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  // -------------------------------------------------------------------------
  // H1 (S353 adversarial round 3) — the depth cap must FAIL CLOSED.
  //
  // The structural walk carries a `MAX_DEPTH` cap for call-stack safety. A cap
  // on a fail-CLOSED check is only safe if EXCEEDING it reports rather than
  // returns: silently truncating the walk is a fail-OPEN.
  //
  // Measured on this exact shape before the fix: 250 nested array literals fired
  // E-PROTECT-004 and 255 did NOT — `scrml compile` exited 0 ("Compiled 1 file")
  // with zero diagnostics, and the emitted handler, executed verbatim against a
  // stubbed `_scrml_sql`, answered
  //   STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}
  // That made this branch strictly WORSE than the source-text scan it replaces,
  // which had no depth limit at all and so failed CLOSED at any nesting.
  //
  // Raising the number does not fix this: ANY finite cap has a boundary, so the
  // boundary BEHAVIOUR is what these two tests pin — under the cap the gate
  // answers on the merits, past it the gate refuses to answer at all.
  const nestedRawEgressProgram = (n) => protectProgram(
    `      function getUser(id) {\n` +
    `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
    `        let deep = ${"[".repeat(n)}new Response(JSON.stringify(u))${"]".repeat(n)}\n` +
    `        return deep.flat(Infinity)[0]\n` +
    `      }`,
  );

  test("a raw egress UNDER the depth cap fires on the merits (250 nestings)", () => {
    const { result } = compileSource(nestedRawEgressProgram(250));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    const hit = all.find((d) => d.code === "E-PROTECT-004");
    expect(hit).toBeDefined();
    // The ordinary form: it names the offending SELECT and the egress kind.
    expect(hit.message).toContain("SELECT * FROM users");
    expect(hit.message).toContain("a manual `Response`");
    expect(hit.message).not.toContain("depth cap");
  });

  test("a raw egress PAST the depth cap still fires — truncation fails CLOSED (255 nestings)", () => {
    const { result } = compileSource(nestedRawEgressProgram(255));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    const hit = all.find((d) => d.code === "E-PROTECT-004");
    // Pre-fix this was `undefined` and the secret shipped at exit 0.
    expect(hit).toBeDefined();
    // The truncation form: no SELECT is named (the truncation may be what hid
    // it), and the resolution is to reduce nesting, not to project a column out.
    expect(hit.message).toContain("could not analyse in full");
    expect(hit.message).toContain("depth cap");
    expect(hit.message).toContain("fails CLOSED");
  });

  test("a DEEPER body past the cap fires too — the cap is not a one-off boundary (500 nestings)", () => {
    const { result } = compileSource(nestedRawEgressProgram(500));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  // The other side of the cap change: it must not manufacture a diagnostic on a
  // body the walk DOES reach in full. A nesting depth well inside the cap with
  // no raw egress at all stays silent (the floor redacts at the normal sink).
  test("a deep body WITHIN the cap and with no raw egress stays silent", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        let deep = ${"[".repeat(120)}u.name${"]".repeat(120)}\n` +
      `        return deep.flat(Infinity)[0]\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  // Population guard: a raw egress with NO protected query must stay silent —
  // the gate is a CO-OCCURRENCE test, and widening it to "any manual Response"
  // would reject every §40.3.5 early-return in an app that happens to declare a
  // `protect=` column elsewhere.
  test("a manual `Response` with NO protected query -> NO E-PROTECT-004", () => {
    const { result } = compileSource(protectProgram(
      `      function getName(id) {\n        let u = ?{\`SELECT name FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }`,
    ));
    expect(fires(result)).toBe(false);
    // The fixture compiled, and the SELECT genuinely projects no protected
    // column — so the strip info is ABSENT here, and that absence is the point.
    expectCompiledCleanly(result);
    expect(codesOf(result).map((d) => d.code)).not.toContain("I-PROTECT-STRIP-001");
  });
});

// ---------------------------------------------------------------------------
// M2 (S353 adversarial round 3) — the gate resolves ACROSS the file's function
// set, not per body. `Extract Function` is not a security boundary.
//
// All three leak shapes below were measured by EXECUTING the emitted handler
// (extracted verbatim from the emitted .server.js, with the called helpers, and
// a stubbed `_scrml_sql`). Pre-fix each compiled at exit 0 with zero diagnostics
// and answered
//   STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}
//
// The rule: for each fn F, reach(F) = F plus every fn F transitively CALLS in
// this file; F fires when reach(F) holds BOTH a protected SELECT and a raw
// egress. Forward reachability alone covers both flow directions because it is
// evaluated at every function — see `detectProtectedRawEgressAcrossFns`.
// ---------------------------------------------------------------------------
describe("§14.8.9 raw-egress fail-closed — resolved across the call graph (M2)", () => {
  test("SELECT in the callee, `new Response` in the caller (the row RETURNS into the egress)", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let u = loadUser(id)\n` +
      `        return new Response(JSON.stringify(u))\n` +
      `      }`,
    ));
    const hit = codesOf(result).find((d) => d.code === "E-PROTECT-004");
    expect(hit).toBeDefined();
    // The diagnostic names the call path, because the author has to look in two
    // places and the message should say which two.
    expect(hit.message).toContain("`getUser` -> `loadUser`");
  });

  test("SELECT in the caller, `new Response` in the callee (the row is PASSED IN)", () => {
    const { result } = compileSource(protectProgram(
      `      function ship(u) {\n` +
      `        return new Response(JSON.stringify(u))\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        return ship(u)\n` +
      `      }`,
    ));
    const hit = codesOf(result).find((d) => d.code === "E-PROTECT-004");
    expect(hit).toBeDefined();
    expect(hit.message).toContain("`getUser` -> `ship`");
  });

  test("a TWO-HOP callee chain is reached transitively", () => {
    const { result } = compileSource(protectProgram(
      `      function raw(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      function loadUser(id) {\n` +
      `        return raw(id)\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        return new Response(JSON.stringify(loadUser(id)))\n` +
      `      }`,
    ));
    const hit = codesOf(result).find((d) => d.code === "E-PROTECT-004");
    expect(hit).toBeDefined();
    expect(hit.message).toContain("`getUser` -> `loadUser` -> `raw`");
  });

  // The false-positive guard, and the reason the rule is REACHABILITY and not
  // "anywhere in the file": two functions with no call path between them share
  // no data path. Widening to file scope would reject every §40.3.5 `403`
  // early-return in an app that declares a `protect=` column anywhere.
  test("CONTROL — an unrelated protected query and an unrelated `403` do NOT fire", () => {
    const { result } = compileSource(protectProgram(
      `      function unrelatedQuery(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        return { name: u.name }\n` +
      `      }\n` +
      `      export server function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  // Mutual recursion must terminate the reachability walk (the visited set).
  test("mutually recursive helpers terminate and still fire", () => {
    const { result } = compileSource(protectProgram(
      `      function ping(id) {\n` +
      `        return pong(id)\n` +
      `      }\n` +
      `      function pong(id) {\n` +
      `        if (id > 0) { return ping(id - 1) }\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        return new Response(JSON.stringify(ping(id)))\n` +
      `      }`,
    ));
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  // The bound, pinned: the call graph is by BARE-IDENTIFIER callee, so a call
  // through a value contributes no edge. Documented in
  // `detectProtectedRawEgressAcrossFns`; if a later arc closes it, THIS GOES RED
  // and the bound paragraph must be updated in the same change.
  test("RESIDUAL (documented): a call through a value contributes no call edge", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let f = loadUser\n` +
      `        return new Response(JSON.stringify(f(id)))\n` +
      `      }`,
    ));
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(false);
    // ...and the silence is the RESIDUAL, not a fixture that never compiled.
    expectCompiledAndProtecting(result);
  });

  // The two residuals `docs/known-gaps.md` NAMED as pinned and were NOT (S354).
  // The entry claimed "closing any of them turns a test red"; for these two that
  // guarantee did not hold, so a later arc could have closed them silently and
  // left the bound paragraph in `protect-egress.ts` stale.
  test("RESIDUAL (documented): a call on a MEMBER contributes no call edge", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let handlers = { load: loadUser }\n` +
      `        return new Response(JSON.stringify(handlers.load(id)))\n` +
      `      }`,
    ));
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(false);
    // ...and the silence is the RESIDUAL, not a fixture that never compiled.
    expectCompiledAndProtecting(result);
  });

  // --- THE SAME BOUND, MIRRORED: the EGRESS behind the invisible edge -------
  //
  // The three residuals above put the protected SELECT behind an edge the graph
  // cannot see. These four put the raw EGRESS there, and they are the fifth
  // executed leak from the round-7 adversarial pass — the one it described as
  // "an edge the classifier cannot classify at all".
  //
  // ⚑ THEY ARE NOT AN EXEMPTION LEAK, and deleting the exemption did not close
  // them. MEASURED at round 7 on three trees — `origin/main`, the round-6 head,
  // and this one — every spelling is SILENT on all three. On `origin/main` the
  // gate has no call graph at all; on the round-6 head the exemption ALSO hid
  // them; here neither applies and they are still silent, because
  // `reach(getUser)` simply has no edge to `deny`. That is the intra-file
  // BARE-IDENTIFIER call-graph bound (residual (2) in
  // `detectProtectedRawEgressAcrossFns`), a plain CARRY-FORWARD, and closing it
  // needs the name resolver — it is not a fourth exemption question.
  //
  // Executed on the emitted handler against a stubbed `_scrml_sql`: the first
  // three answered `[["x-user","$argon2id$SECRET"]]` on the response HEADERS
  // with body `"Forbidden"` and status 403 — header-only, so a body-only probe
  // reads them clean. They are pinned HERE so that closing the bound turns these
  // red and forces the bound paragraph to be updated in the same change.
  const invisibleEgressEdges = {
    "an ALIASED callee (`let make = deny; make()`)":
      `let make = deny\n        let r = make()`,
    "a MEMBER callee (`http.deny()`)":
      `let http = { deny: deny }\n        let r = http.deny()`,
    "an INDEX callee (`handlers[\"deny\"]()`)":
      `let handlers = { deny: deny }\n        let r = handlers["deny"]()`,
  };
  for (const [label, bind] of Object.entries(invisibleEgressEdges)) {
    test(`RESIDUAL (documented): the EGRESS behind an invisible edge — ${label}`, () => {
      const { result } = compileSource(protectProgram(
        `      function deny() {\n` +
        `        return new Response("Forbidden", { status: 403 })\n` +
        `      }\n` +
        `      export server function getUser(id) {\n` +
        `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
        `        ${bind}\n` +
        `        r.headers.set("x-user", u.passwordHash)\n` +
        `        return r\n` +
        `      }`,
      ));
      expect(fires(result)).toBe(false);
      // ...and the silence is the RESIDUAL, not a fixture that never compiled.
      expectCompiledAndProtecting(result);
    });
  }

  // The fourth spelling — a PARAMETER callee (`apply(deny)`). It gets its own
  // test because it additionally surfaces a SEPARATE, pre-existing codegen gap:
  // a server fn referenced as a VALUE emits no in-process peer, so the emitted
  // handler dies on `ReferenceError: deny is not defined` rather than shipping
  // the secret. The gate's silence here is still the call-graph bound (`apply`
  // is reached, `deny` is not), which is what this test pins; the peer-emission
  // gap is handed back separately and is NOT a §14.8.9 question.
  test("RESIDUAL (documented): the EGRESS behind an invisible edge — a PARAMETER callee (`apply(deny)`)", () => {
    const { result } = compileSource(protectProgram(
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      function apply(f) {\n` +
      `        return f()\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        let r = apply(deny)\n` +
      `        r.headers.set("x-user", u.passwordHash)\n` +
      `        return r\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  // The cross-FILE half of the same bound. The call graph is built from THIS
  // file's `function-decl` set, so an imported helper contributes no edge even
  // though the row crosses the boundary at runtime exactly as it would in-file.
  // Both files declare the same `<db protect=...>`, so the SELECT is genuinely
  // protected where it sits — the gate simply cannot see it from here.
  test("RESIDUAL (documented): a CROSS-FILE helper contributes no call edge", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-protect-xfile-"));
    const helper = join(dir, "helpers.scrml");
    const app = join(dir, "app.scrml");
    writeFileSync(helper, protectProgram(
      `      export function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }`,
    ));
    writeFileSync(app, protectProgram(
      `      import { loadUser } from "./helpers.scrml"\n` +
      `      export server function getUser(id) {\n` +
      `        return new Response(JSON.stringify(loadUser(id)))\n` +
      `      }`,
    ));
    const result = compileScrml({ inputFiles: [app], write: false, validateEmit: true, log: () => {} });
    expect(fires(result)).toBe(false);
    // ...and the silence is the RESIDUAL, not a fixture that never compiled. The
    // SELECT sits in the IMPORTED file, so the strip info is raised there — what
    // this app half has to show is that it compiled clean and emitted.
    expectCompiledCleanly(result);
  });

  // -------------------------------------------------------------------------
  // F2 (S354, adversarial round 3) — a DUPLICATE function name resolved to the
  // WRONG declaration, and the comment asserted the opposite.
  //
  // The replaced comment read "First declaration wins on a duplicate name (the
  // emitter's own resolution order)". FALSE, measured: the emitter emits the
  // SECOND declaration as the in-process peer while the gate resolved the edge to
  // the FIRST. With a safe `loadUser` declared first and the protected one last,
  // the file compiled at exit 0 with ZERO diagnostics and the executed handler
  // answered
  //   STATUS 200 BODY: {"id":1,"name":"ada","passwordHash":"$argon2id$SECRET"}
  //
  // The index is now a MULTIMAP: every declaration of a name contributes an edge,
  // so whichever one the emitter picks, the gate has already looked at it. Both
  // ORDERINGS are pinned — a fix that only re-ordered the tie-break would pass one
  // and fail the other.
  const DUP_SAFE =
    `      function loadUser(id) {\n` +
    `        return { id: id }\n` +
    `      }\n`;
  const DUP_PROTECTED =
    `      function loadUser(id) {\n` +
    `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
    `      }\n`;
  const DUP_CALLER =
    `      export server function getUser(id) {\n` +
    `        let u = loadUser(id)\n` +
    `        return new Response(JSON.stringify(u))\n` +
    `      }\n`;

  test("a duplicate `loadUser` fires when the PROTECTED declaration is LAST (the measured leak)", () => {
    const { result } = compileSource(protectProgram(DUP_SAFE + DUP_CALLER + DUP_PROTECTED));
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  test("...and when it is FIRST — the edge no longer depends on declaration order", () => {
    const { result } = compileSource(protectProgram(DUP_PROTECTED + DUP_CALLER + DUP_SAFE));
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F3 (S354, adversarial round 3) — a bracket key BUILT from string literals.
//
// The bound both `staticIndexKey` and the `raw-egress-computed-response`
// conformance rationale stated was "the genuinely dynamic key … whose value is
// not in the tree". `"Resp" + "onse"` has both operands in the tree, so the key
// was never dynamic — yet it evaded, and the leak was executed:
//   `new globalThis["Resp" + "onse"](JSON.stringify(u))` compiled exit 0, zero
//   diagnostics, and the emitted handler shipped the secret.
//
// Fixed rather than re-documented, because a fail-closed gate must not carry a
// false bound: `staticIndexKey` folds a `+` of static string keys, recursively.
// ---------------------------------------------------------------------------
describe("§14.8.9 raw-egress fail-closed — a CONCATENATED static bracket key (F3)", () => {
  const withReturn = (ret) => protectProgram(
    `      export server function getUser(id) {\n` +
    `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
    `        ${ret}\n` +
    `      }`,
  );

  const foldedShapes = {
    'new globalThis["Resp" + "onse"](...)': `return new globalThis["Resp" + "onse"](JSON.stringify(u))`,
    'new globalThis["R" + "esp" + "onse"](...)': `return new globalThis["R" + "esp" + "onse"](JSON.stringify(u))`,
    'globalThis["Resp" + "onse"].json(...)': `return globalThis["Resp" + "onse"].json(u)`,
    'Response["js" + "on"](...)': `return Response["js" + "on"](u)`,
  };
  for (const [label, ret] of Object.entries(foldedShapes)) {
    test(`\`${label}\` fires E-PROTECT-004 (the concatenation folds)`, () => {
      const { result } = compileSource(withReturn(ret));
      expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(true);
    });
  }

  // ⚑ RESIDUAL (F3, S356) — the fold is CLOSED ON THE TREE PATH and the entry
  // that called it "CLOSED, not pinned as residual" was wrong. `staticIndexKey`
  // folds nodes; `escapeHatchSurface` tests TEXT and does not fold. Wrapping the
  // identical shape in ANY expression the parser cannot represent (here a
  // bitwise `~` in the status) takes it off the tree path, and the surface test
  // sees no `Response` TOKEN because the name is spelled in two pieces. Measured:
  // silent on BOTH trees, the emitted JS parses, and the executed body ships
  // `passwordHash`. CARRY-FORWARD, not a regression — same class as the
  // `globalThis[k]` residual. If a later arc folds inside `escapeHatchSurface`,
  // THIS TEST GOES RED and the bound paragraph in `protect-egress.ts` and the
  // `docs/known-gaps.md` entry must be corrected in the same change.
  test("RESIDUAL (documented): an ESCAPE-HATCH wrapper bypasses the fold entirely", () => {
    const { result } = compileSource(withReturn(
      `return new globalThis["Resp" + "onse"](JSON.stringify(u), { status: 201 + ~0 })`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
    // ...and the silence is not a fixture that failed to emit: the leak really
    // is in the shipped server JS, which is what makes this a residual and not a
    // curiosity. The emitted handler returns the hand-built `Response` through
    // the `instanceof Response` passthrough — i.e. the TAGGED row is serialized
    // raw, BEFORE `_scrml_protect_redact` is ever reached. (The escape hatch is
    // re-emitted tokenizer-spaced, hence the whitespace-tolerant match.)
    expect(serverJsOf(result)).toMatch(/JSON\s*\.\s*stringify\s*\(\s*u\s*\)/);
    expect(serverJsOf(result)).toContain("if (_scrml_result instanceof Response) return _scrml_result;");
  });

  // The bound the fold does NOT move, pinned so the residual stays honest: an
  // operand whose value is not in the tree leaves the whole key unresolved.
  test("RESIDUAL (documented): a `+` with a DYNAMIC operand is still not a static key", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        let k = "onse"\n` +
      `        return new globalThis["Resp" + k](JSON.stringify(u))\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });
});

// ---------------------------------------------------------------------------
// THE RULING (S354, delta-log [1676], round 7) — THE ALL-LITERAL EXEMPTION IS
// GONE. `E-PROTECT-004` IS CO-OCCURRENCE, FULL STOP.
//
//   "DROP the all-literal exemption. `E-PROTECT-004` returns to CO-OCCURRENCE.
//    The §40.3.5 false positive is ACCEPTED."
//
// This supersedes the original S354 ruling and both of its narrowings. There is
// no flag, no narrow form, and no reachable remnant: the grants, the syntactic-
// literal predicate, the own-scope/return-position machinery and the
// bound/returned call classification with its transitive revocation closure are
// all deleted from `protect-egress.ts`.
//
// WHY, stated so a fourth formulation cannot be written by accident: the
// exemption was a whitelist REVOKED BY PROVING A NEGATIVE — *this value is never
// named* — over a call graph that is provably incomplete. Five executed leaks
// across three formulations, each found one level deeper:
//
//   1. v1 (S354) "the arguments are syntactically all literals" — true of the
//      CONSTRUCTION, false of the BINDING. A `Response` is a live mutable
//      handle whose headers are writable after it is built:
//        let r = new Response("ok", { status: 200 })
//        r.headers.set("x-user", u.passwordHash)
//        return r
//      Executed: `[["x-user","$argon2id$SECRET"]]` on the response HEADERS,
//      exit 0, zero diagnostics.
//   2. v2 (S355) "return position only" — wrong by one syntactic level: a
//      NESTED helper's `return`, whose value the enclosing body then names.
//   3. v2 again, across a file-level call edge (`let r = deny()`).
//   4. v3 (S356) "unnamed in return position" — laundered two frames out
//      through a pass-through (`function passthru() { return deny() }`).
//   5. v3 again, through an edge the classifier cannot classify AT ALL:
//      `let make = deny; make()`, `http.deny()`, `handlers["deny"]()`,
//      `apply(deny)`. See the `RESIDUAL (documented): the EGRESS behind an
//      invisible edge` tests in the M2 describe above — all four are silent on
//      `origin/main` and on the round-6 head too, for the call-GRAPH bound
//      rather than for the exemption, so deleting the exemption does not close
//      them and was never going to. Handed back as residual, pinned so it
//      cannot close silently.
//
// It never converged because it cannot. A build error with a workaround beats a
// fail-open, so the trade is taken in the other direction now: the gate
// over-reports, and the over-report is documented rather than engineered away.
//
// Every all-literal shape below therefore FIRES. They are kept — all of them —
// because they are the proof that the exemption is not reachable by any
// spelling, which is a stronger statement than deleting the tests would leave.
//
// provenance: ruling:user-voice-scrml.md S354 (delta-log [1676], round 7),
// superseding delta-log [1606] (S354 v1) and [1644] (S356 v3).
// ---------------------------------------------------------------------------
describe("§14.8.9 raw-egress — E-PROTECT-004 is CO-OCCURRENCE; there is no all-literal exemption (S354 r7)", () => {
  // A server fn that SELECTS the protected column, with `body` appended.
  const inGetUser = (body) => protectProgram(
    `      export server function getUser(id) {\n` +
    `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
    `        ${body}\n` +
    `      }`,
  );
  // The §40.3.5 helper, declared at file level beside a protected-query helper
  // and a `dispatch` that reaches both — the shape the exemption existed for,
  // and now the ACCEPTED false positive.
  const withDeny = (dispatchBody) => protectProgram(
    `      function loadUser(id) {\n` +
    `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
    `      }\n` +
    `      function deny() {\n` +
    `        return new Response("Forbidden", { status: 403 })\n` +
    `      }\n` +
    `      export server function dispatch(id) {\n` +
    `        ${dispatchBody}\n` +
    `      }`,
  );

  // --- (a) THE ACCEPTED FALSE POSITIVE -------------------------------------
  //
  // SPEC §40.3.5's own worked example returns a bare
  // `new Response("Forbidden", { status: 403 })` under the normative sentence
  // "This is intentional and valid". When that shape CO-OCCURS with a protected
  // read in the same call-reachable set, `E-PROTECT-004` fires — and the row
  // that actually leaves does so through the compiler-emitted redacting path.
  //
  // THIS IS A DELIBERATE, RATIFIED FALSE POSITIVE, NOT A REGRESSION. It is the
  // price of the ruling and it is the point of it. Two workarounds exist and the
  // diagnostic names both: project the protected column out of the SELECT, or
  // return through the compiler-emitted path rather than a manual `Response`.
  //
  // If a future round makes either of these go silent, it has re-introduced the
  // exemption — check the leak pins in (b) before believing the change is safe.
  // Reopening condition: an adopter hits this on a real app and neither
  // workaround is acceptable. See `docs/known-gaps.md`.

  test("ACCEPTED FALSE POSITIVE — §40.3.5's own `return new Response(\"Forbidden\", { status: 403 })` FIRES when it co-occurs with a protected read", () => {
    const { result } = compileSource(inGetUser(
      `if (id < 0) { return new Response("Forbidden", { status: 403 }) }\n` +
      `        return { name: u.name }`,
    ));
    expect(fires(result)).toBe(true);
    expectFiredCleanly(result);
  });

  test("ACCEPTED FALSE POSITIVE — the cross-call form `return deny()` FIRES too", () => {
    const { result } = compileSource(withDeny(
      `if (id < 0) { return deny() }\n` +
      `        let u = loadUser(id)\n` +
      `        return { name: u.name }`,
    ));
    expect(fires(result)).toBe(true);
    expectFiredCleanly(result);
  });

  test("ACCEPTED FALSE POSITIVE — `return Response.json({ ok: true })` FIRES", () => {
    const { result } = compileSource(inGetUser(
      `if (id < 0) { return Response.json({ ok: true }) }\n` +
      `        return { name: u.name }`,
    ));
    expect(fires(result)).toBe(true);
    expectFiredCleanly(result);
  });

  test("the accepted FP names BOTH workarounds in its message", () => {
    const { result } = compileSource(inGetUser(
      `if (id < 0) { return new Response("Forbidden", { status: 403 }) }\n` +
      `        return { name: u.name }`,
    ));
    const d = e004(result);
    expect(d).toBeDefined();
    // workaround 1: project the column out of the SELECT
    expect(d.message).toContain("project the");
    // workaround 2: return through the compiler-emitted path
    expect(d.message).toContain("compiler-emitted response");
  });

  // --- (b) THE LEAK PINS — every formulation's executed leak, still firing --
  //
  // These are the reproducers that killed v1, v2 and v3. Each was compiled AND
  // EXECUTED against a stubbed `_scrml_sql`, and each answered with the secret
  // on the response HEADERS and an innocuous BODY — a body-only probe reads
  // every one of them as clean. They fire now for the plain reason (a
  // `Response` co-occurs with a protected read) rather than for a revocation
  // that had to be computed, which is why they cannot be re-opened by a
  // narrowing: there is nothing left to narrow.

  const leakPins = {
    "v1 — `let r = new Response(...)` then `r.headers.set(secret)`":
      `let r = new Response("ok", { status: 200 })\n` +
      `        r.headers.set("x-user", u.passwordHash)\n` +
      `        return r`,
    "v1 — the same binding returned UNMUTATED":
      `let r = new Response("Forbidden", { status: 403 })\n        return r`,
    "v1 — header-APPENDED rather than set":
      `let r = new Response("ok", { status: 200 })\n` +
      `        r.headers.append("x-user", u.passwordHash)\n` +
      `        return r`,
    "v1 — bound with NO arguments, then header-mutated":
      `let r = new Response()\n` +
      `        r.headers.set("x-user", u.passwordHash)\n` +
      `        return r`,
    "v1 — `Response.json` bound then header-mutated":
      `let r = Response.json({ ok: true })\n` +
      `        r.headers.set("x-user", u.passwordHash)\n` +
      `        return r`,
    "v2 — a NESTED `function-decl`'s return, named by the enclosing body":
      `function noContent() { return new Response("", { status: 204 }) }\n` +
      `        let res = noContent()\n` +
      `        res.headers.set("x-etag", u.passwordHash)\n` +
      `        return res`,
  };
  for (const [label, body] of Object.entries(leakPins)) {
    test(`LEAK PIN — ${label} FIRES`, () => {
      const { result } = compileSource(inGetUser(body));
      expect(fires(result)).toBe(true);
      expect(errorCodesOf(result)).not.toContain("E-SCOPE-001");
    });
  }

  test("LEAK PIN (v2, file-level twin) — a file-level helper's return, named by the caller, FIRES", () => {
    const { result } = compileSource(protectProgram(
      `      function noContent() {\n` +
      `        return new Response("", { status: 204 })\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        let res = noContent()\n` +
      `        res.headers.set("x-etag", u.passwordHash)\n` +
      `        return res\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
    expect(errorCodesOf(result)).not.toContain("E-SCOPE-001");
  });

  test("LEAK PIN (v2, across a call edge) — `let r = deny(); r.headers.set(...)` FIRES", () => {
    const { result } = compileSource(withDeny(
      `let u = loadUser(id)\n` +
      `        let r = deny()\n` +
      `        r.headers.set("x-user", u.passwordHash)\n` +
      `        return r`,
    ));
    expect(fires(result)).toBe(true);
    expect(errorCodesOf(result)).not.toContain("E-SCOPE-001");
  });

  test("LEAK PIN (v3, two frames out) — a PASS-THROUGH helper FIRES", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      function passthru() {\n` +
      `        return deny()\n` +
      `      }\n` +
      `      export server function dispatch(id) {\n` +
      `        let u = loadUser(id)\n` +
      `        let r = passthru()\n` +
      `        r.headers.set("x-user", u.passwordHash)\n` +
      `        return r\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
    expect(errorCodesOf(result)).not.toContain("E-SCOPE-001");
  });

  test("LEAK PIN — `taint(deny(), u)`: an ARGUMENT position FIRES", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      function taint(r, u) {\n` +
      `        r.headers.set("x-user", u.passwordHash)\n` +
      `        return r\n` +
      `      }\n` +
      `      export server function dispatch(id) {\n` +
      `        let u = loadUser(id)\n` +
      `        return taint(deny(), u)\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
    expect(errorCodesOf(result)).not.toContain("E-SCOPE-001");
  });

  // --- (c) THE EXEMPTION IS UNREACHABLE BY ANY SPELLING --------------------
  //
  // The whole shape matrix the exemption was tuned against, inverted. Every one
  // of these WAS silent under some formulation; every one FIRES now. This is the
  // half that a future "small precision fix" would have to turn green again, so
  // it is stated exhaustively rather than sampled.

  const allLiteralShapes = {
    "a bare string argument": `return new Response("nope")`,
    "no arguments at all": `return new Response()`,
    "an un-interpolated template": "return new Response(`Forbidden`, { status: 403 })",
    "a nested literal array": `return new Response("x", { status: 403, headers: ["a", "b"] })`,
    "a nested literal object": `return new Response("x", { status: 403, headers: { ct: "text/plain" } })`,
    "an absence literal": `return new Response(not, { status: 204 })`,
    "a number argument": `return new Response(0, { status: 200 })`,
    "Response.json of a literal object": `return Response.json({ ok: true })`,
    "a deeply nested all-literal object (3 levels)": `return new Response("x", { a: { b: { c: [1, 2, "z"] } } })`,
    "a COMPUTED key that is a plain string literal": `return new Response("x", { ["status"]: 403 })`,
    "a spread of a literal object": `return new Response("x", { ...{ status: 403 } })`,
    "an array spread of a literal array": `return new Response("x", { h: [...["a", "b"]] })`,
    "a member-chain callee, all-literal arguments": `return new globalThis.Response("nope", { status: 403 })`,
    "a bracket-chain callee, all-literal arguments": `return new globalThis["Response"]("nope", { status: 403 })`,
    "a FOLDED-key callee, all-literal arguments": `return new globalThis["Resp" + "onse"]("nope", { status: 403 })`,
    "Response.json of a literal, member-chain receiver": `return globalThis.Response.json({ ok: true })`,
  };
  for (const [label, ret] of Object.entries(allLiteralShapes)) {
    test(`NO EXEMPTION — ${label} FIRES`, () => {
      const { result } = compileSource(inGetUser(ret));
      expect(fires(result)).toBe(true);
      // the fire is THIS gate's, not a fixture that failed to compile
      expect(errorCodesOf(result)).not.toContain("E-SCOPE-001");
      expect(errorCodesOf(result)).toEqual(["E-PROTECT-004", "E-SCHEMA-001"]);
    });
  }

  // --- (d) the shapes that ALWAYS fired, still firing -----------------------
  //
  // The gate's original population. If one of these ever went silent the ruling
  // would have been mis-applied in the other direction.

  const alwaysFiring = {
    "JSON.stringify(row) — the canonical leak": `return new Response(JSON.stringify(u))`,
    "a NAMED BINDING whose initializer is a literal": `let msg = "Forbidden"\n        return new Response(msg, { status: 403 })`,
    "an INTERPOLATED template": "return new Response(`user ${u.name}`, { status: 200 })",
    "a literal FIRST argument with a non-literal second": `return new Response("x", u)`,
    "an object SHORTHAND property": `let status = 403\n        return new Response("x", { status })`,
    "a literal object holding a member expression": `return new Response("x", { status: u.id })`,
    "a literal array holding a member expression": `return new Response("x", { headers: ["ct", u.name] })`,
    "a `+` of two string literals": `return new Response("For" + "bidden", { status: 403 })`,
    "Response.json of the row": `return Response.json(u)`,
    "a spread of a non-literal": `return new Response("x", { ...u })`,
    "a member-chain callee with a row argument": `return new globalThis.Response(JSON.stringify(u))`,
    "a bracket-chain callee with a row argument": `return new globalThis["Response"](JSON.stringify(u))`,
    "Response.json of the row, member-chain receiver": `return globalThis.Response.json(u)`,
    "a ternary inside the return": `return id < 0 ? new Response("Forbidden", { status: 403 }) : new Response("ok")`,
    "an all-literal construction inside an ARROW body": `let rs = [1].map(x => new Response("ok", { status: 200 }))\n        return { name: u.name, n: rs.length }`,
  };
  for (const [label, ret] of Object.entries(alwaysFiring)) {
    test(`STILL FIRES — ${label}`, () => {
      const { result } = compileSource(inGetUser(ret));
      expect(fires(result)).toBe(true);
      expect(errorCodesOf(result)).not.toContain("E-SCOPE-001");
    });
  }

  // --- (e) OTHER egress kinds are unaffected -------------------------------

  test("an `asIs` value beside an all-literal Response STILL fires", () => {
    const { result } = compileSource(inGetUser(
      `let v:asIs = u\n        return new Response("nope", { status: 403 })`,
    ));
    expect(fires(result)).toBe(true);
  });

  test("a `_{}` foreign block STILL fires", () => {
    const { result } = compileSource(inGetUser(
      `_{ const x = 1; }\n        return { name: u.name }`,
    ));
    expect(fires(result)).toBe(true);
  });

  // --- (f) CO-OCCURRENCE IS SCOPED TO THE CALL-REACHABLE SET ---------------
  //
  // Dropping the exemption did NOT make the gate file-wide. Two functions with
  // no call path between them share no data path, so a §40.3.5 `403` in one and
  // a protected read in another stay silent. This is the precision the gate
  // still has, and it is not the exemption — it is the unit the S352 ruling set.
  //
  // ANTI-VACUITY: the same file with a call edge added FIRES (second assertion),
  // so the silence is the missing edge and not a fixture that failed to compile.

  test("no call path between them — a protected read and an unrelated 403 stay SILENT", () => {
    const src = protectProgram(
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        return { name: u.name }\n` +
      `      }`,
    );
    const { result } = compileSource(src);
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);

    // ...and the ONLY difference that matters is the edge.
    const { result: withEdge } = compileSource(protectProgram(
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        if (id < 0) { return deny() }\n` +
      `        return { name: u.name }\n` +
      `      }`,
    ));
    expect(fires(withEdge)).toBe(true);
  });

  test("the diagnostic lands on the function that reaches BOTH, not on its siblings", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      export server function unrelated(id) {\n` +
      `        return { ok: id }\n` +
      `      }\n` +
      `      export server function dispatch(id) {\n` +
      `        let u = loadUser(id)\n` +
      `        if (id < 0) { return deny() }\n` +
      `        return { name: u.name }\n` +
      `      }`,
    ));
    const hits = codesOf(result).filter((d) => d.code === "E-PROTECT-004");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => d.message.includes("`unrelated`"))).toBe(false);
    expect(hits.some((d) => d.message.includes("`dispatch`"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §14.8.9 raw-egress — an UNPARSEABLE expression silently disarmed the gate
// (S355, round 5).
//
// `expression-parser.ts` returns `{ kind: "escape-hatch", nativeKind, raw }` for
// any expression it cannot turn into a tree, and `ast-builder.js` does the same
// for every expression `shouldSkipExprParse` declines. THE NODE CARRIES THE
// EXPRESSION AS A STRING. The structural walk therefore found no `kind:"new"`,
// no `kind:"foreign"`, no `kind:"sql"` and no call edges inside it — and read
// every one of those as "no" when the truth was UNKNOWN.
//
// This is the same class as the depth cap (fixed via `truncated`); the
// escape-hatch path had no equivalent. The source-text detector this rewrite
// replaced never needed a parse, which is why `origin/main` catches all of these.
//
// The fix asks the escape-hatch's OWN `raw` field what the opaque region could
// hold. That is not the source-SLICE scan dpa-029 Q1 rejected — there is no
// better oracle here, because the tree's answer for this node IS a string (same
// standing as `annotationIsAsIs`, which token-tests the `typeAnnotation` field).
// Every error the text test makes is an over-report, which is fail-CLOSED.
//
// provenance: ruling:user-voice-scrml.md S352 (dpa-029 Q1); the hole and this
// resolution are S355 (round 5).
// ---------------------------------------------------------------------------
describe("§14.8.9 raw-egress — an escape-hatch is UNKNOWN, not `no` (S355)", () => {
  const inBody = (stmts) =>
    `      export server function getUser(id) {\n` +
    `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
    `        ${stmts}\n` +
    `      }`;

  // --- THE RED HALF: plain JS whose only offence is a token acorn rejects ---
  //
  // Every one of these emits VALID server JS, compiled at exit 0 with NO
  // E-PROTECT-004 on the round-4 head, and fires on `origin/main`. The second is
  // the canonical leak, silenced by an incidental `~` in an unrelated argument.
  const unparsedEgressShapes = {
    "a bitwise `~` in a ternary test": `return new Response(~u ? JSON.stringify(u) : '')`,
    "a bitwise `~` in the STATUS — the canonical leak, silenced incidentally":
      `return new Response(JSON.stringify(u), { status: 200 + ~0 + 1 })`,
    "`~~x`, the standard truncation idiom": `return new Response(JSON.stringify(u).slice(~~0))`,
    "a BigInt literal": `return new Response(JSON.stringify(u), { status: 200 + 1n })`,
    "a pipeline operator": `return new Response(u |> JSON.stringify)`,
    "a unary base of `**`": `return new Response(JSON.stringify(u), { status: -2 ** 2 })`,
  };
  for (const [label, ret] of Object.entries(unparsedEgressShapes)) {
    test(`FIRES — an unparsed expression that could hold a Response: ${label}`, () => {
      const { result } = compileSource(protectProgram(inBody(ret)));
      expect(fires(result)).toBe(true);
    });
  }

  // The `!{}` error arm (§17) — THE canonical scrml failure idiom — reaches the
  // walk ONLY as an escape-hatch: the arm object carries `handler` as a STRING
  // and `handlerExpr` as an escape-hatch node, and no structured form of the arm
  // body exists anywhere in the tree. Its body is then emitted VERBATIM into the
  // server handler, ahead of the `instanceof Response` passthrough — so a raw
  // egress inside an arm is a live, unredacted leak the tree cannot see.
  const armProgram = (arm) =>
    `      function authenticate(u) {\n` +
    `        let row = ?{\`SELECT * FROM users WHERE id = \${u}\`}.get()\n` +
    `        return row\n` +
    `      }\n` +
    `      export server function getUser(id) {\n` +
    `        let result = authenticate(id) !{\n` +
    `          | AuthError e -> {\n` +
    `            ${arm}\n` +
    `          }\n` +
    `        }\n` +
    `        return { ok: true }\n` +
    `      }`;

  const armEgressShapes = {
    "a manual `Response`": `return new Response(JSON.stringify(result))`,
    "a member-chain `Response`": `return new globalThis.Response(JSON.stringify(result))`,
    "a level-1 `_={}=` foreign block": `_={ leak(result) }=`,
    "an `asIs` binding": `let v:asIs = result\n            return v`,
  };
  for (const [label, arm] of Object.entries(armEgressShapes)) {
    test(`FIRES — a raw egress hidden in an \`!{}\` arm: ${label}`, () => {
      const { result } = compileSource(protectProgram(armProgram(arm)));
      expect(fires(result)).toBe(true);
    });
  }

  // A `?{}` inside an unparsed region makes the QUERY half unknown, not "no" —
  // and the gate's whole predicate rests on the query. That one fails the body
  // CLOSED outright, with its OWN resolution sentence.
  test("FIRES — a protected `?{}` hidden inside an `!{}` arm fails the body CLOSED", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let result = loadIt(id) !{\n` +
      `          | AuthError e -> {\n` +
      `            let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `            return new Response(JSON.stringify(u))\n` +
      `          }\n` +
      `        }\n` +
      `        return { ok: true }\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
    const d = e004(result);
    // The message names the RIGHT cause and the RIGHT remedy. The depth-cap
    // resolution ("reduce the expression nesting") would send the author to fix
    // something that is not broken — a diagnostic that misnames its root cause
    // is itself a defect.
    expect(d.message).toContain("has no tree form");
    expect(d.message).toContain("move the `?{}` out of that expression");
    expect(d.message).not.toContain("reduce the expression nesting");
  });

  // CALL EDGES are the third invisible half. Here the protected SELECT is
  // reachable ONLY through a call the opaque region hides; without edge recovery
  // no query resolves and the gate stays silent.
  test("FIRES — a call edge hidden in an `!{}` arm is recovered, so the SELECT is reachable", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      function doThing(id) { return id }\n` +
      `      export server function getUser(id) {\n` +
      `        let result = doThing(id) !{\n` +
      `          | AuthError e -> {\n` +
      `            return new Response(JSON.stringify(loadUser(id)))\n` +
      `          }\n` +
      `        }\n` +
      `        return { ok: true }\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  // --- THE GREEN HALF: the boundary, and it is the load-bearing half --------
  //
  // Treating EVERY escape-hatch as an unconditional fire was measured first and
  // rejected: it build-blocks 22 of the 1912 corpus sources (all 21
  // `examples/23-trucking-dispatch/` files plus `samples/login.scrml`) on nothing
  // worse than a C-style `for` header, and it does so with the depth-cap message,
  // which is factually wrong for that cause. A gate that cannot be satisfied is
  // not a safety property.

  test("SILENT — a C-style `for` header holds neither an egress nor a `?{}`", () => {
    const { result } = compileSource(protectProgram(inBody(
      `let out = ""\n` +
      `        for (let i = 0; i < 3; i = i + 1) {\n` +
      `          out = out + u.name\n` +
      `        }\n` +
      `        return { name: out }`,
    )));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  test("SILENT — a benign `!{}` arm (the canonical failure idiom) is not build-blocked", () => {
    const { result } = compileSource(protectProgram(armProgram(
      `log(e.message)\n            return not`,
    )));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  test("SILENT — an unparsed expression in a body whose SELECT projects no protected column", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let n = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n` +
      `        return new Response(JSON.stringify(n.name), { status: 200 + ~0 + 1 })\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    // This fixture's SELECT projects no protected column, so the strip info is
    // correctly ABSENT — the floor has nothing to strip and the gate has nothing
    // to co-occur with.
    expectCompiledCleanly(result);
    expect(codesOf(result).map((d) => d.code)).not.toContain("I-PROTECT-STRIP-001");
  });

  test("SILENT — an `import()` expression carries no egress and no `?{}`", () => {
    const { result } = compileSource(protectProgram(inBody(
      `let m = import("./x.js")\n        return { name: u.name }`,
    )));
    expect(fires(result)).toBe(false);
    expectCompiledAndProtecting(result);
  });

  // The depth cap keeps its OWN message. Two truncation reasons, two remedies.
  test("the depth-cap truncation still names the NESTING remedy, not the parse one", () => {
    const deep = "[".repeat(300) + "]".repeat(300);
    const { result } = compileSource(protectProgram(inBody(
      `let big = ${deep}\n        return new Response(JSON.stringify(u))`,
    )));
    expect(fires(result)).toBe(true);
    const d = e004(result);
    expect(d.message).toContain("reduce the expression nesting");
    expect(d.message).not.toContain("has no tree form");
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
