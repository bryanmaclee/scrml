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
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
  });

  test("RESIDUAL (documented, carry-forward): a local rebinding `let R = Response` is not resolved", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let R = Response\n        return new R(JSON.stringify(u))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
    // ...and it does not build-block, on this tree OR on `origin/main` — the
    // allowlist entry that makes the spelling reachable is main's, not this
    // branch's. This assertion pins a CARRY-FORWARD, not a widening.
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
  const codesOf = (result) =>
    [...(result.warnings ?? []), ...(result.errors ?? [])];

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
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(false);
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
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(false);
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
  const codesOf = (result) => [...(result.warnings ?? []), ...(result.errors ?? [])];
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
    expect(codesOf(result).some((d) => d.code === "E-PROTECT-004")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE S354 RULING — an egress whose arguments are SYNTACTICALLY ALL LITERALS is
// not an egress. `E-PROTECT-004` fires on CO-OCCURRENCE within a call-reachable
// set, not on flow, and that is what makes it sound; but a `Response` built
// entirely from literals cannot carry caller data, so counting it was a defect,
// not conservatism.
//
// The reproduced shape: clean on base, fired on the round-3 head.
//
// Full flow analysis was REJECTED on DIRECTION, not cost — it trades a precision
// bug for a soundness bug, because every gap in a dataflow analysis is a
// fail-OPEN. So the test is SYNTACTIC and the still-firing half below is as
// load-bearing as the newly-silent half.
// provenance: ruling:user-voice-scrml.md S354 (delta-log [1606])
// ---------------------------------------------------------------------------
describe("§14.8.9 raw-egress — an ALL-LITERAL egress carries no caller data (S354)", () => {
  const codesOf = (result) => [...(result.warnings ?? []), ...(result.errors ?? [])];
  const fires = (result) => codesOf(result).some((d) => d.code === "E-PROTECT-004");
  const serverJsOf = (result) =>
    (result.outputs ? [...result.outputs.values()][0]?.serverJs : "") ?? "";

  // --- the GREEN half: shapes that must NOT fire ---------------------------

  test("THE RULING'S SHAPE: `dispatch` reaching a protected query AND a constant `deny()` is CLEAN", () => {
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n` +
      `        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `      }\n` +
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      export server function dispatch(id) {\n` +
      `        if (id < 0) { return deny() }\n` +
      `        let u = loadUser(id)\n` +
      `        return { name: u.name }\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    // ...and it is not silenced by some OTHER gate rejecting the file first: the
    // §40.3.5 `Response` name resolves, so the deny arm genuinely compiles.
    // (`protectProgram`'s `<program>` carries no `db=`, so E-SCHEMA-001 is a
    // constant of every fixture in this file and is not asserted away here.)
    expect(codesOf(result).some((d) => d.code === "E-SCOPE-001")).toBe(false);
    // The row that DOES leave goes out the compiler-emitted path, where the
    // floor redacts — this gate's silence is not what protects it.
    expect(serverJsOf(result)).toContain("_scrml_protect_redact");
  });

  test("the same-BODY form: a protected SELECT beside a constant 403 is CLEAN", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        if (id < 0) { return new Response("Forbidden", { status: 403 }) }\n` +
      `        return { name: u.name }\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
  });

  const cleanShapes = {
    "a bare string argument": `return new Response("nope")`,
    "no arguments at all": `return new Response()`,
    "an un-interpolated template": "return new Response(`Forbidden`, { status: 403 })",
    "a nested literal array": `return new Response("x", { status: 403, headers: ["a", "b"] })`,
    "a nested literal object": `return new Response("x", { status: 403, headers: { ct: "text/plain" } })`,
    "an absence literal": `return new Response(not, { status: 204 })`,
    "a number argument": `return new Response(0, { status: 200 })`,
    "Response.json of a literal object": `return Response.json({ ok: true })`,
  };
  for (const [label, ret] of Object.entries(cleanShapes)) {
    test(`CLEAN — ${label} is not an egress`, () => {
      const { result } = compileSource(protectProgram(
        `      export server function getUser(id) {\n` +
        `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
        `        if (id < 0) { ${ret} }\n` +
        `        return { name: u.name }\n` +
        `      }`,
      ));
      expect(fires(result)).toBe(false);
    });
  }

  // --- the RED half: the boundary, stated as tests -------------------------
  //
  // Every one of these is a shape the narrowing must NOT swallow. If any goes
  // green, the ruling has been over-applied into the flow analysis it rejected.

  const firingShapes = {
    "JSON.stringify(row) — the canonical leak": `return new Response(JSON.stringify(u))`,
    "a NAMED BINDING whose initializer is a literal": `let msg = "Forbidden"\n        return new Response(msg, { status: 403 })`,
    "an INTERPOLATED template": "return new Response(`user ${u.name}`, { status: 200 })",
    "a literal FIRST argument with a non-literal second": `return new Response("x", u)`,
    "an object SHORTHAND property (it reads a binding)": `let status = 403\n        return new Response("x", { status })`,
    "a literal object holding a member expression": `return new Response("x", { status: u.id })`,
    "a literal array holding a member expression": `return new Response("x", { headers: ["ct", u.name] })`,
    "a `+` of two string literals (an expression, not a literal)": `return new Response("For" + "bidden", { status: 403 })`,
    "Response.json of the row": `return Response.json(u)`,
    "a spread of a non-literal": `return new Response("x", { ...u })`,
  };
  for (const [label, ret] of Object.entries(firingShapes)) {
    test(`STILL FIRES — ${label}`, () => {
      const { result } = compileSource(protectProgram(
        `      export server function getUser(id) {\n` +
        `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
        `        ${ret}\n` +
        `      }`,
      ));
      expect(fires(result)).toBe(true);
    });
  }

  // The ADVERSARIAL matrix — shapes probed AFTER the narrowing was written, to
  // look for a fail-OPEN it introduced rather than to confirm the shapes it was
  // written against. Pinned rather than measured-once, which is the same lesson
  // this round applied to the residual list: an unpinned measurement decays.
  //
  // Two of these are the fail-CLOSED corners the implementation states rather
  // than hides: a COMPUTED key built with `+` is an expression (the fold is
  // available for a bracket KEY, where a wrong answer is a fail-OPEN, and is
  // deliberately not taken for an ARGUMENT, where it would be), and a
  // unary-negated number is an operator node, not a literal.
  const adversarial = {
    "a deeply nested all-literal object (3 levels)":
      [`return new Response("x", { a: { b: { c: [1, 2, "z"] } } })`, false],
    "the same shape with a member expression at the bottom":
      [`return new Response("x", { a: { b: { c: [1, u.name] } } })`, true],
    "a COMPUTED key that is a plain string literal":
      [`return new Response("x", { ["status"]: 403 })`, false],
    "a COMPUTED key built with `+` (an expression — fail-CLOSED)":
      [`return new Response("x", { ["st" + "atus"]: 403 })`, true],
    "a spread of a literal object":
      [`return new Response("x", { ...{ status: 403 } })`, false],
    "an array spread of a literal array":
      [`return new Response("x", { h: [...["a", "b"]] })`, false],
    "a member-chain callee with all-literal arguments":
      [`return new globalThis.Response("nope", { status: 403 })`, false],
    "a member-chain callee with a row argument":
      [`return new globalThis.Response(JSON.stringify(u))`, true],
    "a bracket-chain callee with all-literal arguments":
      [`return new globalThis["Response"]("nope", { status: 403 })`, false],
    "a bracket-chain callee with a row argument":
      [`return new globalThis["Response"](JSON.stringify(u))`, true],
    "a FOLDED-key callee with all-literal arguments":
      [`return new globalThis["Resp" + "onse"]("nope", { status: 403 })`, false],
    "Response.json of a literal, through a member-chain receiver":
      [`return globalThis.Response.json({ ok: true })`, false],
    "Response.json of the row, through a member-chain receiver":
      [`return globalThis.Response.json(u)`, true],
    "a unary-negated number (an operator node — fail-CLOSED)":
      [`return new Response("x", { status: -1 })`, true],
    "a call inside an otherwise-literal array":
      [`return new Response("x", { h: [JSON.stringify(u)] })`, true],
    "a call inside a nested literal object value":
      [`return new Response("x", { a: { b: JSON.stringify(u) } })`, true],
  };
  for (const [label, [ret, mustFire]] of Object.entries(adversarial)) {
    test(`ADVERSARIAL — ${label} ${mustFire ? "FIRES" : "is CLEAN"}`, () => {
      const { result } = compileSource(protectProgram(
        `      export server function getUser(id) {\n` +
        `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
        `        ${ret}\n` +
        `      }`,
      ));
      expect(fires(result)).toBe(mustFire);
    });
  }

  // An `asIs`-typed value is an egress KIND of its own, so it fires even when the
  // only `Response` in the body is all-literal — the narrowing must not leak
  // across egress kinds.
  test("an `asIs` value beside an all-literal Response STILL fires", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        let v:asIs = u\n` +
      `        return new Response("nope", { status: 403 })\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  // The narrowing is scoped to ARGUMENT-BEARING constructions. A `_{}` foreign
  // block and an `asIs` value have no argument list to test, so they remain
  // egresses unconditionally — even when their visible content is all literal.
  test("a `_{}` foreign block with an all-literal body STILL fires (no argument list to test)", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        _{ const x = 1; }\n` +
      `        return { name: u.name }\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  // --- RETURN POSITION: the S355 narrowing of the S354 narrowing -----------
  //
  // The all-literal test is true of the CONSTRUCTION and false of the BINDING.
  // A `Response` is a live mutable handle — its headers are writable after it is
  // built — so "every argument is a literal" says nothing about what the object
  // carries when it leaves the function.
  //
  // Reproduced: with the narrowing applied everywhere, the first shape below
  // compiled at exit 0 with NO E-PROTECT-004 (it fires on `origin/main`), and
  // the emitted handler, executed against a stubbed `_scrml_sql`, answered
  // `[["x-user","$argon2id$SECRET"]]` on the response HEADERS. The redaction
  // floor cannot catch it: `_scrml_protect_redact` passes a `Response` instance
  // through untouched (it cannot introspect one), so the gate is the only thing
  // between that shape and the wire.
  //
  // The rule: the narrowing applies ONLY where the construction is the RETURN
  // VALUE — §40.3.5's own worked example, and the one shape the ruling was
  // granted for. It stays purely syntactic (is this node the `exprNode` of a
  // `return-stmt`?), so it does not drift toward the flow analysis the ruling
  // rejected, and it is strictly fail-CLOSED relative to applying it everywhere.
  // provenance: ruling:user-voice-scrml.md S354, narrowed S355 (round 5)

  const boundShapes = {
    "bound then HEADER-MUTATED — the executed leak":
      `let r = new Response("ok", { status: 200 })\n        r.headers.set("x-user", u.passwordHash)\n        return r`,
    "bound then header-APPENDED":
      `let r = new Response("ok", { status: 200 })\n        r.headers.append("x-user", u.passwordHash)\n        return r`,
    "bound with NO arguments, then header-mutated":
      `let r = new Response()\n        r.headers.set("x-user", u.passwordHash)\n        return r`,
    "`Response.json` bound then header-mutated":
      `let r = Response.json({ ok: true })\n        r.headers.set("x-user", u.passwordHash)\n        return r`,
    // We do NOT track mutation, so an UNMUTATED binding fires too. That is the
    // fail-CLOSED half of the rule and it is as load-bearing as the mutated one:
    // deciding "this binding was never mutated" is the flow analysis the ruling
    // rejected, and every gap in that analysis would be a fail-OPEN.
    "bound then returned UNMUTATED (we do not track mutation)":
      `let r = new Response("Forbidden", { status: 403 })\n        return r`,
    "bound with no arguments then returned UNMUTATED":
      `let r = new Response()\n        return r`,
    "`Response.json` of a literal, bound then returned UNMUTATED":
      `let r = Response.json({ ok: true })\n        return r`,
  };
  for (const [label, body] of Object.entries(boundShapes)) {
    test(`RETURN POSITION — a BINDING is not return position: ${label} FIRES`, () => {
      const { result } = compileSource(protectProgram(
        `      export server function getUser(id) {\n` +
        `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
        `        ${body}\n` +
        `      }`,
      ));
      expect(fires(result)).toBe(true);
      // ...and the file is otherwise well-formed: the fire is this gate's, not a
      // fixture that failed to compile for an unrelated reason.
      expect(codesOf(result).some((d) => d.code === "E-SCOPE-001")).toBe(false);
    });
  }

  // The OTHER half — §40.3.5's shape is untouched.
  test("RETURN POSITION — §40.3.5's own `return new Response(\"Forbidden\", { status: 403 })` stays SILENT", () => {
    const { result } = compileSource(protectProgram(
      `      function deny() {\n` +
      `        return new Response("Forbidden", { status: 403 })\n` +
      `      }\n` +
      `      export server function getUser(id) {\n` +
      `        if (id < 0) { return deny() }\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        return { name: u.name }\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    expect(codesOf(result).some((d) => d.code === "E-SCOPE-001")).toBe(false);
    // the row that DOES leave goes out the compiler-emitted, redacting path
    expect(serverJsOf(result)).toContain("_scrml_protect_redact");
  });

  // A shape one syntactic step from the ruling's, deliberately CLOSED: it is not
  // `return <construction>`, and admitting it would start the walk down the flow
  // analysis the ruling rejected.
  test("RETURN POSITION — NOT the returned value itself: a ternary inside the return FIRES", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n` +
      `        return id < 0 ? new Response("Forbidden", { status: 403 }) : new Response("ok")\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(true);
    expect(codesOf(result).some((d) => d.code === "E-SCOPE-001")).toBe(false);
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
  const codesOf = (result) => [...(result.warnings ?? []), ...(result.errors ?? [])];
  const fires = (result) => codesOf(result).some((d) => d.code === "E-PROTECT-004");
  const e004 = (result) => codesOf(result).find((d) => d.code === "E-PROTECT-004");
  const serverJsOf = (result) =>
    (result.outputs ? [...result.outputs.values()][0]?.serverJs : "") ?? "";

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
    // anti-vacuity: the fixture really compiled, and the row really went out the
    // redacting path
    expect(codesOf(result).some((d) => d.code === "E-SCOPE-001")).toBe(false);
    expect(codesOf(result).some((d) => d.code === "I-PROTECT-STRIP-001")).toBe(true);
    expect(serverJsOf(result)).toContain("_scrml_protect_redact");
  });

  test("SILENT — a benign `!{}` arm (the canonical failure idiom) is not build-blocked", () => {
    const { result } = compileSource(protectProgram(armProgram(
      `log(e.message)\n            return not`,
    )));
    expect(fires(result)).toBe(false);
    expect(codesOf(result).some((d) => d.code === "E-SCOPE-001")).toBe(false);
    expect(codesOf(result).some((d) => d.code === "I-PROTECT-STRIP-001")).toBe(true);
    expect(serverJsOf(result)).toContain("_scrml_protect_redact");
  });

  test("SILENT — an unparsed expression in a body whose SELECT projects no protected column", () => {
    const { result } = compileSource(protectProgram(
      `      export server function getUser(id) {\n` +
      `        let n = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n` +
      `        return new Response(JSON.stringify(n.name), { status: 200 + ~0 + 1 })\n` +
      `      }`,
    ));
    expect(fires(result)).toBe(false);
    expect(codesOf(result).some((d) => d.code === "E-SCOPE-001")).toBe(false);
    expect(serverJsOf(result).length).toBeGreaterThan(0);
  });

  test("SILENT — an `import()` expression carries no egress and no `?{}`", () => {
    const { result } = compileSource(protectProgram(inBody(
      `let m = import("./x.js")\n        return { name: u.name }`,
    )));
    expect(fires(result)).toBe(false);
    expect(codesOf(result).some((d) => d.code === "I-PROTECT-STRIP-001")).toBe(true);
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
