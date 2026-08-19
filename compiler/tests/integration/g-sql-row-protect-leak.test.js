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
  // NOT parity with `main` for the rebinding spelling: on `origin/main`
  // `let R = Response` fails E-SCOPE-001 (`Response` is not allowlisted there),
  // so that program does not compile at all. This branch allowlists `Response`
  // for §40.3.5, which makes the spelling reachable — a WIDENING of this
  // residual, not a carry-forward. The `let R = globalThis.Response` and
  // `globalThis[k]` spellings ARE carry-forwards (verified: silent on
  // `origin/main` too).
  test("RESIDUAL (documented): a dynamic bracket key `globalThis[k]` is not resolved", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let k = "Response"\n        return new globalThis[k](JSON.stringify(u))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
  });

  test("RESIDUAL (documented, WIDENED by this branch): a local rebinding `let R = Response` is not resolved", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let R = Response\n        return new R(JSON.stringify(u))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
    // ...and it no longer build-blocks either, which is the widening: on
    // `origin/main` this same source fails E-SCOPE-001.
    expect(all.some((d) => d.code === "E-SCOPE-001")).toBe(false);
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
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
  });

  // Population guard: a raw egress with NO protected query must stay silent —
  // the gate is a CO-OCCURRENCE test, and widening it to "any manual Response"
  // would reject every §40.3.5 early-return in an app that happens to declare a
  // `protect=` column elsewhere.
  test("a manual `Response` with NO protected query -> NO E-PROTECT-004", () => {
    const { result } = compileSource(protectProgram(
      `      function getName(id) {\n        let u = ?{\`SELECT name FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }`,
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
