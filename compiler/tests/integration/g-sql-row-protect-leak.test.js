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
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
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

  // ⚑ S405 — THIS ASSERTION IS INVERTED FROM WHAT IT SAID, AND THE INVERSION IS
  // THE FIX. It used to read "Response instance passes through (raw egress not
  // double-handled)" and assert `redact(r) === r`. That is the fail-OPEN shape:
  // the redactor cannot read a `Response` body, so passing one through means
  // shipping whatever the author serialized into it out of an app that declared
  // `protect=` columns. Refuse what the monitor cannot inspect.
  //
  // A THROW rather than a returned refusal because this branch is only reached
  // from INSIDE the value walk (a Response NESTED in the payload); the top-level
  // case is refused deterministically by the compiler-emitted
  // `_scrml_protect_opaque_refusal()` guard at the sink and never gets here.
  test("Response instance is REFUSED, not passed through (fail-closed on an opaque egress)", () => {
    const { _scrml_protect_redact } = loadHelper();
    const r = new Response("body");
    expect(() => _scrml_protect_redact(r)).toThrow(/§14\.8\.9/);
  });

  test("a Response NESTED in the payload is refused too (the walk reaches it)", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const u = _scrml_protect_tag({ id: 1, passwordHash: "x" }, ["passwordHash"]);
    // The author hand-serialized a TAGGED row into an opaque Response and hung
    // it off a wrapper. The top-level guard sees an object, not a Response, so
    // only the walk can catch this one.
    const nested = { receipt: new Response(JSON.stringify(u)), ok: true };
    expect(() => _scrml_protect_redact(nested)).toThrow(/§14\.8\.9/);
  });

  test("a NULL-body Response nested in the payload is NOT refused (nothing to inspect)", () => {
    const { _scrml_protect_redact } = loadHelper();
    const r = new Response(null, { status: 204 });
    expect(_scrml_protect_redact({ receipt: r, ok: true }).receipt).toBe(r);
  });

  // ⚑ MEDIUM 3 — the refusal must be RECOGNIZABLE, not just thrown. The §37 SSE
  // stream wrapper catches every stream error in a deliberately empty `catch`;
  // without a structural tag the refusal was swallowed there and the stream
  // ended with a silent 200. Matching the message TEXT would be the wrong fix —
  // it makes the emitted stream handler depend on prose.
  test("the refusal error is TAGGED so a catch can tell it from an ordinary failure", () => {
    const { _scrml_protect_redact } = loadHelper();
    let caught = null;
    try { _scrml_protect_redact(new Response("body")); } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    expect(caught.__scrml_protect_opaque).toBe(true);
  });

  // ⚑ HIGH 1's RUNTIME HALF. Fixing only the compile gate would have moved the
  // break from build time to request time — strictly worse. The guard passes a
  // NULL-body Response through and refuses everything else, and the adversarial
  // row is the point: a secret-carrying Response can be dressed to present
  // exactly like a redirect (same `Location`, no `Content-Length`, same `.body`
  // shape), so no runtime heuristic short of consuming the stream can tell them
  // apart — which is why `.body === null` is the only admissible test.
  test("the guard passes a NULL-body Response and refuses a body-carrying look-alike", async () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const refusal = new Function(
      SERVER_PROTECT_HELPER + "\nreturn _scrml_protect_opaque_refusal;",
    )();
    // The guard exactly as `_opaqueResultGuard` emits it.
    const guard = (r) => {
      if (r instanceof Response) {
        if (r.body === null) return r;
        return refusal();
      }
      return new Response(JSON.stringify(_scrml_protect_redact(r) ?? null), { status: 200 });
    };
    const tagged = _scrml_protect_tag([{ id: 1, name: "ada", passwordHash: "s3cret" }], ["passwordHash"]);

    const redirect = guard(new Response(null, { status: 302, headers: { Location: "/home" } }));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe("/home");

    expect(guard(new Response(null, { status: 204 })).status).toBe(204);

    // THE ADVERSARY — indistinguishable from the redirect above at every
    // inspectable property, and carrying the secret in its body.
    const attack = guard(new Response(JSON.stringify(tagged), {
      status: 302, headers: { Location: "/home" },
    }));
    expect(attack.status).toBe(500);
    expect(await attack.text()).not.toContain("s3cret");

    // And the ordinary value path still redacts.
    expect(await guard(tagged).text()).toBe(JSON.stringify([{ id: 1, name: "ada" }]));
  });

  test("the compiler-owned refusal carries a 500 and NO application data", async () => {
    const fn = new Function(
      SERVER_PROTECT_HELPER + "\nreturn { _scrml_protect_opaque_refusal };",
    );
    const { _scrml_protect_opaque_refusal } = fn();
    const res = _scrml_protect_opaque_refusal();
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = JSON.parse(await res.text());
    // The whole point of the refusal is that the payload could not be proven
    // free of a protected column — so none of it, and nothing derived from it,
    // may appear in the refusal.
    expect(body.error.kind).toBe("ProtectOpaqueEgress");
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["kind", "message"]);
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
//
// ⚑ S405 — THE `Response` KIND LEFT THIS GATE. E-PROTECT-004 is a per-body
// SOURCE-TEXT co-occurrence lint over the §14.8.9 derived-flow boundary, and it
// now covers exactly TWO kinds: a `_{}` foreign block (§23) and an `asIs` value
// (§14.1.1). An author-constructed `Response` is enforced STRUCTURALLY instead
// (E-PROTECT-005, below) because a text predicate is defeated by ordinary
// function extraction and therefore cannot carry a confidentiality guarantee.
//
// The foreign blocks below are written at LEVEL 1 (`_={ … }=`) deliberately:
// SPEC §23.2 defines the opener as `_` + zero or more `=` + `{`, and
// W-FOREIGN-001 steers authors away from the level-0 `_{`. Until S405 this
// gate's predicate matched level 0 ONLY, so it recognized only the spelling the
// compiler discourages — these tests are red against that predicate.
// ---------------------------------------------------------------------------
const FOREIGN_LANG_PROGRAM = (serverBody) =>
  protectProgram(serverBody).replace("<program>", '<program lang="js">');

describe("§14.8.9 raw-egress fail-closed — E-PROTECT-004", () => {
  test("protected row reaching a `_={ … }=` foreign block fires E-PROTECT-004", () => {
    const { result } = compileSource(FOREIGN_LANG_PROGRAM(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let payload = _={ JSON.stringify(u) }=\n        return payload\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  test("a `reveal` naming EVERY protected column suppresses the raw-egress gate", () => {
    const { result } = compileSource(FOREIGN_LANG_PROGRAM(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let payload = _={ JSON.stringify(u.reveal("passwordHash")) }=\n        return payload\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(false);
  });

  test("a `reveal` naming a DIFFERENT column does NOT suppress it (column-keyed, not existence-keyed)", () => {
    // The A4 defect: until S405 the suppression tested only for the PRESENCE of
    // a `.reveal(` anywhere in the body, so revealing ANY column disarmed the
    // gate for EVERY protected column in that body. `email` is not protected
    // here; `passwordHash` is, and it is not declassified.
    const src = protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let payload = _={ JSON.stringify(u.reveal("email")) }=\n        return payload\n      }`,
    ).replace("<program>", '<program lang="js">')
      .replace("name TEXT, passwordHash TEXT", "name TEXT, email TEXT, passwordHash TEXT");
    const { result } = compileSource(src);
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
  });

  test("a `reveal` with a NON-LITERAL argument names no column and discharges nothing", () => {
    // Fail-closed: the scanner cannot read which column `col` denotes, so it
    // discharges none. Previously any `.reveal(` — literal or not — disarmed
    // the whole gate.
    const { result } = compileSource(FOREIGN_LANG_PROGRAM(
      `      function getUser(id, col) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let payload = _={ JSON.stringify(u.reveal(col)) }=\n        return payload\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.some((d) => d.code === "E-PROTECT-004")).toBe(true);
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
// §14.8.9 EGRESS-SINK COVERAGE — the sinks, not the redactor.
//
// ⚑ HIGH 2 (S405 fix round) AND THE LESSON UNDER IT. `/__mountHydrate` emitted
// `new Response(JSON.stringify(<server-@var loader results>))` with NO redact,
// while the SSR compose handler forty lines below redacted THE SAME TWO VALUES.
// `JSON.stringify` drops the Symbol tag, so a `protect=` column crossed the wire
// in cleartext on `POST /__mountHydrate` — reproduced end-to-end by executing
// the emitted handler.
//
// It was missed by three "independent" completeness proofs that all enumerated
// over the REDACTOR (its call sites / SPEC's list of boundaries it covers / the
// ways to bypass it). A sink that never adopted the redactor is outside all
// three frames AT ONCE, so their agreement measured nothing. The obligation is
// over the DATA, so the enumeration has to be over the SERIALIZER. These tests
// assert the sinks directly, in the emitted text, one per sink.
// ---------------------------------------------------------------------------
describe("§14.8.9 every client-egress sink redacts (enumerated over serializers)", () => {
  const MH_PROGRAM = `<program db="sqlite:./app.db" auth="none">
<schema>
  ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  ?{\`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)\`}
</schema>
<db src="app.db" protect="passwordHash" tables="users,notes"></db>
\${
  server function loadUsers() { return ?{\`SELECT * FROM users\`}.all() }
  server function loadNotes() { return ?{\`SELECT * FROM notes\`}.all() }
  <userCell server> = loadUsers()
  <noteCell server> = loadNotes()
}
<main>
  <ul><each in=@userCell key=@.id as u><li class="u">\${u.name}</li></each></ul>
  <ul><each in=@noteCell key=@.id as n><li class="n">\${n.body}</li></each></ul>
</main>
</program>`;

  test("HIGH 2: /__mountHydrate redacts every cell (all-public arm)", () => {
    const { serverJs } = compileSource(MH_PROGRAM);
    expect(serverJs).toContain("_scrml_mountHydrate_handler");
    // The premise: the loaders really are protect-tagged, else this asserts nothing.
    expect(serverJs).toContain("_scrml_protect_tag");
    expect(serverJs).toContain('"userCell": _scrml_protect_redact(_scrml_mh_v0)');
    expect(serverJs).toContain('"noteCell": _scrml_protect_redact(_scrml_mh_v1)');
    // and the pre-fix shape is gone
    expect(serverJs).not.toContain('"userCell": _scrml_mh_v0');
  });

  test("HIGH 2: /__mountHydrate redacts every cell (per-cell AUTH-GATED arm)", () => {
    // Auth and the egress floor are ORTHOGONAL: auth decides whether the cell is
    // sent at all, the floor decides which of its columns may cross. An
    // authorized cell still owes the strip, so the gated arm needs its own case.
    const { serverJs } = compileSource(
      MH_PROGRAM.replace('auth="none"', 'auth="required"')
        .replace("<noteCell server>", '<noteCell server auth="none">'),
    );
    expect(serverJs).toContain("_scrml_mh_out");
    expect(serverJs).toContain('_scrml_mh_out["userCell"] = _scrml_protect_redact(_scrml_mh_v0)');
    expect(serverJs).not.toContain('_scrml_mh_out["userCell"] = _scrml_mh_v0;');
  });

  test("HIGH 2: /__mountHydrate ships no protected column, EXECUTED", async () => {
    const { serverJs } = compileSource(MH_PROGRAM);
    // Lift the shipped helper + the shipped handler and drive them, so this is a
    // wire fact rather than a text assertion.
    const hStart = serverJs.indexOf("const _SCRML_PROTECT = Symbol.for");
    const hEnd = serverJs.indexOf("function _scrml_protect_redact");
    const helper = serverJs.slice(hStart, serverJs.indexOf("\n}\n", hEnd) + 3);
    const mhStart = serverJs.indexOf("async function _scrml_mountHydrate_handler");
    const handler = serverJs.slice(mhStart, serverJs.indexOf("\n}\n", mhStart) + 3);
    const { _scrml_mountHydrate_handler } = new Function(`
${helper}
async function loadUsers() { return _scrml_protect_tag([{ id: 1, name: "ada", passwordHash: "s3cret" }], ["passwordHash"]); }
async function loadNotes() { return [{ id: 9, body: "hi" }]; }
${handler}
return { _scrml_mountHydrate_handler };`)();
    const body = await (await _scrml_mountHydrate_handler(
      new Request("http://localhost/__mountHydrate", { method: "POST" }),
    )).text();
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("s3cret");
    expect(JSON.parse(body).userCell).toEqual([{ id: 1, name: "ada" }]);
  });

  // ⛔ THE SEAM TEST. Rounds 3 and 4 of review each found a defect at the SEAM
  // between the compile-time gate and the runtime guard rather than inside
  // either, so this asserts the seam INVARIANT mechanically instead of testing
  // one more crossing:
  //
  //   EVERY `Response` CONSTRUCTED INSIDE A CAPTURE IIFE IS EITHER
  //   AUTHOR-WRITTEN (present in the source) OR MEDIATION-MARKED.
  //
  // The IIFE's value becomes `_scrml_result`, which the guard inspects. The guard
  // may only refuse AUTHOR-owned responses; a compiler-emitted one reaching it
  // unmarked is refused as if an adopter had hand-built it — which is exactly how
  // the §53.9.4 `E-CONTRACT-001-RT` 400 became a 500. Deriving the set from the
  // EMITTED TEXT means a NEW compiler emitter appearing in that window fails here
  // rather than reaching an adopter, which is the property the two previous
  // rounds' point fixes did not have.
  const iifeRegions = (serverJs) => {
    const out = [];
    let i = 0;
    const open = "const _scrml_result = await (async () => {";
    while ((i = serverJs.indexOf(open, i)) !== -1) {
      const end = serverJs.indexOf("\n  })();", i);
      if (end === -1) break;
      out.push(serverJs.slice(i + open.length, end));
      i = end;
    }
    return out;
  };

  test("SEAM: every compiler-emitted Response inside a capture IIFE is mediation-marked", () => {
    // A battery chosen to exercise every emitter that runs inside the IIFE:
    // the §53.9.4 param check, the C18 broadcast injection, and an author body.
    const bodies = [
      ["predicated param (the §53.9.4 400)", `      function a(id: number(>0 && <10000)) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return u\n      }`],
      ["plain body", `      function b(id) {\n        return ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n      }`],
      ["predicated param + author Response", `      function c(id: number(>0)) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return new Response(not, { status: 204 })\n      }`],
    ];
    // Collected as STRINGS so a failure prints the offending sites, not an
    // entire emitted module — a seam test whose output is unreadable does not
    // get acted on.
    const violations = [];
    for (const [label, body] of bodies) {
      const src = protectProgram(body).replace("<program>", '<program auth="none" db="app.db">');
      const { serverJs } = compileSource(src);
      // The author's own Response spellings, so a genuinely author-written one
      // in the window is not reported as compiler drift.
      const authored = /new Response\(|Response\.(json|redirect|error)\(/.test(src);
      for (const region of iifeRegions(serverJs)) {
        const re = /new Response\(|Response\.(?:json|redirect|error)\(/g;
        let m;
        while ((m = re.exec(region)) !== null) {
          const before = region.slice(Math.max(0, m.index - 40), m.index);
          if (before.includes("_scrml_protect_mediated(")) continue; // marked
          if (authored) continue; // the adopter wrote it; the guard SHOULD judge it
          violations.push(
            `${label}: UNMARKED compiler-emitted \`${m[0]}\` inside the capture IIFE — ` +
            `the runtime guard will refuse the compiler's own response. ` +
            `Wrap that emitter's lines with \`_markMediatedResponses\`. Context: ` +
            JSON.stringify(region.slice(Math.max(0, m.index - 90), m.index + 40)),
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("SEAM: the compiler's own 400 survives the guard as a 400, not a 500", async () => {
    // HIGH, at the level it bites: on the wire, not in the emitted text.
    const src = protectProgram(
      `      function getUser(id: number(>0 && <10000)) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return u\n      }`,
    ).replace("<program>", '<program auth="none" db="app.db">');
    const { serverJs } = compileSource(src);
    // Premise pins: baseline-CSRF arm, param check INSIDE the IIFE, guard present.
    expect(serverJs).toContain("_scrml_ensure_csrf_cookie");
    expect(serverJs).toContain("E-CONTRACT-001-RT");
    expect(serverJs).toContain("_scrml_protect_mediated(new Response(");
    // Drive the emitted param check + guard over a violating value.
    const hStart = serverJs.indexOf("const _SCRML_PROTECT = Symbol.for");
    const hEnd = serverJs.indexOf("function _scrml_protect_redact");
    const helper = serverJs.slice(hStart, serverJs.indexOf("\n}\n", hEnd) + 3);
    const { probe } = new Function(`${helper}
function probe(id) {
  const _scrml_result = (() => {
    if (!(((id > 0) && (id < 10000)))) {
      return _scrml_protect_mediated(new Response(JSON.stringify({ error: "E-CONTRACT-001-RT" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    return { id };
  })();
  if (_scrml_result instanceof Response) {
    if (_scrml_result[Symbol.for("scrml.protect.mediated")]) return _scrml_result;
    if (_scrml_result.body === null) return _scrml_result;
    return _scrml_protect_opaque_refusal();
  }
  return new Response(JSON.stringify(_scrml_protect_redact(_scrml_result)), { status: 200 });
}
return { probe };`)();
    const bad = probe(-1);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("E-CONTRACT-001-RT");
    expect(probe(5).status).toBe(200);
  });

  test("MEDIUM: the redact preserves values whose JSON form is not their own keys", () => {
    // A `Date` has no enumerable own keys, so rebuilding it from `Object.keys`
    // produced `{}` — a `TIMESTAMP` column hydrated as `{}` instead of its ISO
    // string. Pre-existing in the redactor, but this arc extended that redactor
    // to `/__mountHydrate`, a sink that was previously lossless.
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const rows = _scrml_protect_tag(
      [{ id: 1, created_at: new Date("2020-01-01"), passwordHash: "s3cret" }],
      ["passwordHash"],
    );
    const out = JSON.stringify(_scrml_protect_redact(rows));
    expect(out).toContain("2020-01-01T00:00:00.000Z");
    expect(out).not.toContain("s3cret");
  });

  // ⛔ THE PRESERVATION MUST NOT BECOME A SHORT-CIRCUIT. The first attempt at
  // keeping `Date`/`toJSON` values intact returned a non-plain object WITHOUT
  // DESCENDING, which turned a cosmetic flaw into a fail-OPEN one: a tagged row
  // inside ANY class-instance wrapper shipped its protected column, and the
  // nested-`Response` refusal — the limb §14.8.9 designates THE GUARANTEE — was
  // never reached. "Do not rebuild" and "do not look" are different instructions;
  // inside a fail-closed floor only the first is safe. These assert BOTH
  // directions at every nesting the walk can meet.
  test("HIGH: a tagged row STRIPS through a non-plain (class) wrapper, at any depth", () => {
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    const row = () => _scrml_protect_tag({ id: 1, name: "a", passwordHash: "s3cret" }, ["passwordHash"]);
    class Wrap {
      constructor(u) { this.u = u; }
      greet() { return "hi"; }
    }
    const shallow = _scrml_protect_redact(new Wrap(row()));
    expect(JSON.stringify(shallow)).not.toContain("s3cret");
    expect(JSON.parse(JSON.stringify(shallow))).toEqual({ u: { id: 1, name: "a" } });
    // the prototype survives the rebuild, so this is preservation AND stripping
    expect(typeof shallow.greet).toBe("function");
    // class > plain > class > row
    const deep = _scrml_protect_redact(new Wrap({ inner: new Wrap(row()) }));
    expect(JSON.stringify(deep)).not.toContain("s3cret");
    // an ARRAY inside a class wrapper
    const arr = _scrml_protect_redact(new Wrap([row(), row()]));
    expect(JSON.stringify(arr)).not.toContain("s3cret");
  });

  test("HIGH: a nested Response inside a non-plain wrapper STILL throws", () => {
    const { _scrml_protect_redact } = loadHelper();
    class Wrap { constructor(r) { this.r = r; } }
    expect(() => _scrml_protect_redact(new Wrap(new Response("s3cret")))).toThrow(/§14\.8\.9/);
    expect(() => _scrml_protect_redact(new Wrap({ a: [new Response("x")] }))).toThrow(/§14\.8\.9/);
  });

  test("HIGH: and the preservation it was protecting still holds", () => {
    // The whole point of the walk/rebuild split: descending must not cost the
    // losslessness the change existed for.
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    class Money {
      constructor(c) { this.cents = c; }
      toJSON() { return this.cents / 100; }
    }
    const out = JSON.stringify(_scrml_protect_redact({
      total: new Money(1250),
      when: new Date("2020-01-01"),
      row: _scrml_protect_tag({ id: 1, passwordHash: "s3cret" }, ["passwordHash"]),
    }));
    expect(out).toContain("12.5");
    expect(out).toContain("2020-01-01T00:00:00.000Z");
    expect(out).not.toContain("s3cret");
  });

  test("MEDIUM: a TAGGED non-plain row is STILL redacted (the preservation is fail-closed)", () => {
    // The tag test runs BEFORE the prototype test on purpose: preserving
    // non-plain values must never become a way to smuggle a tagged row past the
    // strip. A class instance carrying the descriptor is rebuilt and stripped.
    const { _scrml_protect_tag, _scrml_protect_redact } = loadHelper();
    class Row { constructor() { this.id = 1; this.passwordHash = "s3cret"; } }
    const out = JSON.stringify(_scrml_protect_redact(_scrml_protect_tag(new Row(), ["passwordHash"])));
    expect(out).not.toContain("s3cret");
    expect(JSON.parse(out)).toEqual({ id: 1 });
  });

  test("LOW: two offending `<endpoint>` arms report TWICE, not once", () => {
    // Arms carry no distinguishing span — they all fall back to the enclosing
    // `epDecl.span` — so a span-only dedup key collapsed every arm of one
    // endpoint into a single diagnostic naming only the first, costing a rebuild
    // round-trip per arm. The key is now span+name, and the reported name is
    // arm-distinguishing.
    const src = `<program db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users">
    \${
      function loadUser(id) {
        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
        return u
      }
    }
  </db>

type Op:enum = {
  Fetch(id: int)
  Deny
  Nope
}

<endpoint path="/gate" method="POST" accepts=Op>
  <Fetch(id) : loadUser(id)>
  <Deny : Response.json({ error: "no" }, { status: 403 })>
  <Nope : Response.json({ error: "nope" }, { status: 404 })>
</endpoint>

</program>`;
    const { result } = compileSource(src);
    const hits = [...(result.errors ?? [])].filter((d) => d.code === "E-PROTECT-005");
    expect(hits.length).toBe(2);
    expect(hits.map((d) => d.message).join("\n")).toContain("<Deny> arm");
    expect(hits.map((d) => d.message).join("\n")).toContain("<Nope> arm");
  });

  test("MEDIUM: a NON-protect app emits none of the §14.8.9 helper (byte-unchanged)", () => {
    // The mediation mark is only meaningful to a protect-path guard, but emitting
    // it unconditionally referenced `_scrml_protect_mediated`, which satisfies the
    // helper-injection gate and dragged the entire 127-line SERVER_PROTECT_HELPER
    // into apps with no `protect=` column — measured at ~66% of the emitted module,
    // every function in it dead. That gate's own comment promises byte-unchanged.
    const src = protectProgram(
      `      function getUser(id: number(>0 && <10000)) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return u\n      }`,
    ).replace(' protect="passwordHash"', "").replace("<program>", '<program auth="none" db="app.db">');
    const { serverJs } = compileSource(src);
    // the predicated param really is present, else this asserts nothing
    expect(serverJs).toContain("E-CONTRACT-001-RT");
    expect(serverJs).not.toContain("_SCRML_PROTECT");
    expect(serverJs).not.toContain("_scrml_protect_mediated");
    expect(serverJs).not.toContain("_scrml_protect_redact");
  });

  test("MEDIUM: /__mountHydrate refuses a Response cell with a SHAPED 500, not an escaping throw", async () => {
    // `_scrml_mh_v<i>` are AUTHOR server-fn return values, so a loader CAN return
    // a Response — the in-code claim that this sink "feeds on compiler-built SQL"
    // was false. Without a guard the redact's refusal threw out of the handler and
    // the ENTIRE hydration payload was lost, every unrelated cell with it.
    const src = `<program db="sqlite:./app.db" auth="none">
<schema>
  ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  ?{\`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)\`}
</schema>
<db src="app.db" protect="passwordHash" tables="users,notes"></db>
\${
  server function loadUsers() { return ?{\`SELECT * FROM users\`}.all() }
  server function loadNotes() { return ?{\`SELECT * FROM notes\`}.all() }
  <userCell server> = loadUsers()
  <noteCell server> = loadNotes()
}
<main>
  <ul><each in=@userCell key=@.id as u><li class="u">\${u.name}</li></each></ul>
</main>
</program>`;
    const { serverJs } = compileSource(src);
    expect(serverJs).toContain("_scrml_mountHydrate_handler");
    expect(serverJs).toContain("_scrml_mh_cell instanceof Response");

    // Drive the SHIPPED handler with a loader that returns a Response.
    const hStart = serverJs.indexOf("const _SCRML_PROTECT = Symbol.for");
    const hEnd = serverJs.indexOf("function _scrml_protect_redact");
    const helper = serverJs.slice(hStart, serverJs.indexOf("\n}\n", hEnd) + 3);
    const mhStart = serverJs.indexOf("async function _scrml_mountHydrate_handler");
    const handler = serverJs.slice(mhStart, serverJs.indexOf("\n}\n", mhStart) + 3);
    const { h } = new Function(`
${helper}
async function loadUsers() { return _scrml_protect_tag([{ id: 1, name: "ada", passwordHash: "s3cret" }], ["passwordHash"]); }
async function loadNotes() { return Response.redirect("http://x/home", 302); }
${handler}
return { h: _scrml_mountHydrate_handler };`)();
    const res = await h(new Request("http://localhost/__mountHydrate", { method: "POST" }));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body).error.kind).toBe("ProtectOpaqueEgress");
    expect(body).not.toContain("s3cret");
  });

  test("MEDIUM: /__mountHydrate still hydrates normally when no cell is a Response", async () => {
    // The guard must not cost the ordinary path.
    const src = `<program db="sqlite:./app.db" auth="none">
<schema>
  ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  ?{\`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)\`}
</schema>
<db src="app.db" protect="passwordHash" tables="users,notes"></db>
\${
  server function loadUsers() { return ?{\`SELECT * FROM users\`}.all() }
  server function loadNotes() { return ?{\`SELECT * FROM notes\`}.all() }
  <userCell server> = loadUsers()
  <noteCell server> = loadNotes()
}
<main>
  <ul><each in=@userCell key=@.id as u><li class="u">\${u.name}</li></each></ul>
</main>
</program>`;
    const { serverJs } = compileSource(src);
    const hStart = serverJs.indexOf("const _SCRML_PROTECT = Symbol.for");
    const hEnd = serverJs.indexOf("function _scrml_protect_redact");
    const helper = serverJs.slice(hStart, serverJs.indexOf("\n}\n", hEnd) + 3);
    const mhStart = serverJs.indexOf("async function _scrml_mountHydrate_handler");
    const handler = serverJs.slice(mhStart, serverJs.indexOf("\n}\n", mhStart) + 3);
    const { h } = new Function(`
${helper}
async function loadUsers() { return _scrml_protect_tag([{ id: 1, name: "ada", passwordHash: "s3cret" }], ["passwordHash"]); }
async function loadNotes() { return [{ id: 9, body: "hi" }]; }
${handler}
return { h: _scrml_mountHydrate_handler };`)();
    const res = await h(new Request("http://localhost/__mountHydrate", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("s3cret");
    expect(JSON.parse(body).userCell).toEqual([{ id: 1, name: "ada" }]);
    expect(JSON.parse(body).noteCell).toEqual([{ id: 9, body: "hi" }]);
  });

  test("MEDIUM 3: the §37 SSE stream reports a refusal instead of ending silently", () => {
    const { serverJs } = compileSource(protectProgram(
      `      server function* streamUsers() route="/users/stream" {\n        let u = ?{\`SELECT * FROM users\`}.all()\n        yield { event: "user", id: 1, data: u }\n      }`,
    ));
    // The generic stream `catch` is empty by design for ordinary errors; a
    // CONFIDENTIALITY refusal must not look like a clean end-of-stream, so it is
    // recognized by the tag and surfaced on BOTH channels.
    expect(serverJs).toContain("_scrml_err.__scrml_protect_opaque");
    expect(serverJs).toContain("[scrml §14.8.9]");
    expect(serverJs).toContain("ProtectOpaqueEgress");
  });

  test("MEDIUM 3: a NON-protect SSE app is byte-unchanged (no refusal block)", () => {
    const src = protectProgram(
      `      server function* streamUsers() route="/users/stream" {\n        let u = ?{\`SELECT * FROM users\`}.all()\n        yield { event: "user", id: 1, data: u }\n      }`,
    ).replace(' protect="passwordHash"', "");
    const { serverJs } = compileSource(src);
    expect(serverJs).toContain("Stream error — close the controller");
    expect(serverJs).not.toContain("__scrml_protect_opaque");
  });

  // ⚑ LOW 4 IS PINNED AGAINST THE EMITTER SOURCE, NOT AGAINST A COMPILED
  // PROGRAM, AND THE REASON IS ITSELF THE FINDING.
  //
  // The §8.9.2 implicit per-handler transaction (`BEGIN DEFERRED` … `COMMIT` …
  // `catch { ROLLBACK }`) is gated on `needsImplicitEnvelope`, which requires a
  // batch-planner `coalescedHandlers` group with `envelopeKind:
  // "implicit-handler-tx"`. MEASURED at this SHA: that path emits in **0 of the
  // 7,442 artifacts** the corpus produces, and several constructed shapes
  // (multi-statement handlers, `!`-failable handlers with two SELECTs) failed to
  // reach it. So there is no compiled program that can demonstrate the bug OR
  // the fix, and a compile-level test would early-return and assert nothing —
  // which is exactly the hollow-green shape this file's own header warns about.
  //
  // The defect is real in the code: the envelope's `try` spans PAST the COMMIT,
  // so a throw from the redact (newly possible since the S405 runtime refusal)
  // reaches the catch with the transaction already committed; a bare
  // `unsafe("ROLLBACK")` then fails with "no transaction is active" BEFORE
  // `throw _scrml_batch_err`, and the SQL error replaces the §14.8.9 one.
  //
  // Asserting on the emitter source is the honest level: it pins the fix against
  // regression and it does not pretend to be an execution proof. ⚠ The
  // unreachability is surfaced separately — a whole normative transaction
  // envelope that never emits is a bigger question than this arc.
  test("LOW 4: the ROLLBACK cannot mask the error it is cleaning up after", () => {
    const emitter = readFileSync(
      new URL("../../src/codegen/emit-server.ts", import.meta.url),
      "utf8",
    );
    expect(emitter).toContain('try { await _scrml_sql.unsafe("ROLLBACK"); } catch');
    // the bare form, which drops `_scrml_batch_err` on a rollback failure, is gone
    expect(emitter).not.toMatch(/lines\.push\(`\s*await _scrml_sql\.unsafe\("ROLLBACK"\);`\)/);
    // and the original error is still what propagates
    expect(emitter).toContain("throw _scrml_batch_err;");
  });
});

// ---------------------------------------------------------------------------
// authored-`Response` fail-closed — E-PROTECT-005 (S405, arc A item A2)
//
// The compiler owns the egress envelope and mediates it. It cannot mediate a
// body the author serialized themselves, so on a `protect=` path it refuses to
// emit one. Deliberately a HARD ERROR with NO escape hatch — `reveal` does not
// discharge it, because reveal declassifies a column at a value the floor can
// still WALK and a hand-serialized `Response` is not walkable.
// ---------------------------------------------------------------------------
describe("§14.8.9 authored-`Response` fail-closed — E-PROTECT-005", () => {
  const fires = (result) =>
    [...(result.warnings ?? []), ...(result.errors ?? [])].some((d) => d.code === "E-PROTECT-005");

  test("a `new Response` in a protect= server fn fires E-PROTECT-005", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  test("the SAME shape with no `protect=` still compiles (the gate is protect-scoped)", () => {
    const src = protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }`,
    ).replace(' protect="passwordHash"', "");
    const { result } = compileSource(src);
    expect(fires(result)).toBe(false);
    // No PROTECT-family error at all on this arm. (The fixture's `<program>`
    // carries no `db=`, so E-SCHEMA-001 fires here as it does for every case in
    // this file — asserting `errors.length === 0` would be asserting an
    // unrelated fixture property.)
    expect((result.errors ?? []).filter((d) => d.code.startsWith("E-PROTECT-"))).toEqual([]);
  });

  test("EXTRACTION does not defeat it — the query in a helper, the Response in a server fn", () => {
    // THE A3 DEFECT. The retired source-text co-occurrence lint required BOTH
    // facts in ONE body, so moving the query into a helper compiled clean. This
    // gate keys on the `Response` construction alone, in whichever body builds
    // it, so extraction moves the trigger rather than escaping it.
    const { result } = compileSource(protectProgram(
      `      function loadUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return u\n      }\n      server function getUser(id: int) {\n        let u = loadUser(id)\n        return new Response(JSON.stringify(u))\n      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  test("`reveal` does NOT discharge it (no escape hatch, by design)", () => {
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u.reveal("passwordHash")))\n      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  // ⚑ THE SCAN-WINDOW PAIR. The gate scans a SLICE of already-lowered JS, and
  // the compiler emits `new Response(...)` of its own inside a handler — the
  // §53.9.4 `E-CONTRACT-001-RT` 400 (`emitServerParamCheck`). On the
  // baseline-CSRF arm that emission lands INSIDE the capture IIFE, so a window
  // opened at the IIFE swallowed it and every `protect=` app with a predicated
  // server-fn parameter failed its build on the compiler's own code. Found by
  // the arc's own adversarial pass, after the first green run.
  //
  // These two run the SAME arm (`auth="none"` + `protect=` forces
  // `useBaselineCsrf`) and differ ONLY in whether the author writes a Response,
  // so a window regression in either direction fails exactly one of them.
  const CSRF_ARM_PREDICATED = (body) => `<program auth="none" db="app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users">
    \${
${body}
    }
  </db>
  <user> = not
  <button id="load" onclick=\${ @user = getUser(1) }>load</button>
</program>`;

  test("scan window: a predicated param's compiler-emitted 400 Response does NOT fire it", () => {
    const { result, serverJs } = compileSource(CSRF_ARM_PREDICATED(
      `      function getUser(id: number(>0 && <10000)) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return u\n      }`,
    ));
    // Pin the premise: this really is the baseline-CSRF arm and the compiler
    // really did emit its own Response inside it. Without these the test could
    // pass by not exercising the shape at all.
    expect(serverJs).toContain("_scrml_ensure_csrf_cookie");
    expect(serverJs).toContain("E-CONTRACT-001-RT");
    expect(fires(result)).toBe(false);
  });

  test("scan window: the SAME arm still fires on a genuine author Response", () => {
    const { result, serverJs } = compileSource(CSRF_ARM_PREDICATED(
      `      function getUser(id: number(>0 && <10000)) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }`,
    ));
    expect(serverJs === "" || serverJs.includes("_scrml_ensure_csrf_cookie")).toBe(true);
    expect(fires(result)).toBe(true);
  });

  test("the `Response` NAME in a string literal does not fire it (acorn, code position only)", () => {
    // The over-fire class `egress-field-scan.ts` exists to prevent, applied
    // here: a HARD error that fired on inert text would break builds.
    const { result } = compileSource(protectProgram(
      `      function getUser(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        let label = "new Response(x)"\n        return { u: u, label: label }\n      }`,
    ));
    expect(fires(result)).toBe(false);
  });

  // ⚑ THE SSE LIMB WENT QUIET ONCE ALREADY. The gate parses its slice by
  // wrapping it in a probe function; with a plain `async function` wrapper a
  // §37 generator body failed to parse on its `yield`, the fail-open path
  // returned "no fire", and `yield new Response(...)` under `protect=` compiled
  // clean while the whole suite was green. The wrapper is now an async
  // GENERATOR. This is the compile-level pin; `protect-response-scan.test.js`
  // pins the wrapper's grammar construct-by-construct.
  test("a §37 `server function*` yielding a Response fires it (the yield-grammar limb)", () => {
    const { result } = compileSource(protectProgram(
      `      server function* streamUsers() route="/users/stream" {\n        let u = ?{\`SELECT * FROM users\`}.all()\n        yield new Response(JSON.stringify(u))\n      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  test("the same SSE generator yielding a VALUE does not fire it", () => {
    const { result } = compileSource(protectProgram(
      `      server function* streamUsers() route="/users/stream" {\n        let u = ?{\`SELECT * FROM users\`}.all()\n        yield { event: "user", id: 1, data: u }\n      }`,
    ));
    expect(fires(result)).toBe(false);
  });

  // ⛔ THE `handle()` MIDDLEWARE PATH IS OUTSIDE THIS EGRESS SURFACE AND MUST
  // STAY THAT WAY. SPEC §40.3.5 blesses `return new Response("Forbidden",
  // {status: 403})` in a `handle()` body verbatim; that path never runs
  // `_egressRedact`, and its four `instanceof Response` sites are a different
  // emitter. If this test ever goes red, the gate has escaped its population —
  // do not "fix" it by relaxing the gate's message.
  test("SPEC §40.3.5's blessed `handle()` Response does NOT fire it, even under protect=", () => {
    const src = `<program auth="none" db="app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users">
    \${
      function getUser(id) {
        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()
        return u
      }
    }
  </db>
  \${
    function isAllowedIP(request) { return true }
    function handle(request, resolve) {
      if (!isAllowedIP(request)) {
        return new Response("Forbidden", { status: 403 })
      }
      return resolve(request)
    }
  }
  <user> = not
  <button id="load" onclick=\${ @user = getUser(1) }>load</button>
</program>`;
    const { result, serverJs } = compileSource(src);
    // Pin the premise both ways: the middleware Response really did reach the
    // emit, and protect really is active. Either failing would make the
    // assertion vacuous.
    expect(serverJs).toContain('new Response("Forbidden"');
    expect(serverJs).toContain("_scrml_protect_tag");
    expect(fires(result)).toBe(false);
  });

  // ⚑ HIGH 1 (S405 fix round) — THE REDIRECT REGRESSION, AT THE LEVEL IT BITES.
  // The first landing gated the full WHATWG producer set. Because this gate has
  // no escape hatch, that meant a `protect=` app could not issue a redirect from
  // a server fn AT ALL — a build break on the adopter shape this arc exists for,
  // reproduced base-clean / tip-failing. `redirect` and `error` carry a null
  // body, so E-PROTECT-005 firing on them contradicted its own rationale.
  const warns = (result, code) =>
    [...(result.warnings ?? []), ...(result.errors ?? [])].some((d) => d.code === code);

  test("HIGH 1: `Response.redirect` under protect= does NOT hard-error (it has no body)", () => {
    const { result } = compileSource(protectProgram(
      `      function goHome(id) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return Response.redirect("/home", 302)\n      }`,
    ));
    expect(fires(result)).toBe(false);
    // ...but it is NOT silent: the runtime guard still refuses it, so the seam is
    // reported at BUILD time rather than surfacing as a 500 on the first request.
    expect(warns(result, "W-PROTECT-005")).toBe(true);
  });

  test("HIGH 1: `Response.error()` under protect= behaves the same way", () => {
    const { result } = compileSource(protectProgram(
      `      function boom(id) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return Response.error()\n      }`,
    ));
    expect(fires(result)).toBe(false);
    expect(warns(result, "W-PROTECT-005")).toBe(true);
  });

  test("HIGH 1: the W-PROTECT-005 RESOLUTION compiles clean and emits a null body", () => {
    // Never name a working path without compiling it. This is the exact form the
    // warning tells the adopter to write.
    const { result, serverJs } = compileSource(protectProgram(
      `      function goHome(id) {\n        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()\n        return new Response(not, { status: 302, headers: { Location: "/home" } })\n      }`,
    ));
    expect(fires(result)).toBe(false);
    expect(warns(result, "W-PROTECT-005")).toBe(false);
    // `not` is scrml's absence and must lower to a JS `null` body — the thing the
    // runtime guard recognizes exactly.
    expect(serverJs).toContain('new Response(null, {status: 302, headers: {Location: "/home"}})');
    // And the guard must let a null body through rather than refuse it.
    expect(serverJs).toContain("if (_scrml_result.body === null) return _scrml_result;");
  });

  test("HIGH 1: a body-carrying Response is STILL a hard error (the fix did not widen the hole)", () => {
    const { result } = compileSource(protectProgram(
      `      function leak(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u), { status: 302, headers: { Location: "/home" } })\n      }`,
    ));
    expect(fires(result)).toBe(true);
  });

  // ⚑ THE MULTI-KEY `<endpoint>` ARM — the S405 final-round MEDIUM, at compile
  // level. The scanner framed an arm's EXPRESSION as a STATEMENT, so
  // `{ ok: true, r: Response.json({...}) }` parsed as a labeled block and threw;
  // the fail-open path then returned "no fire" and the whole multi-key arm class
  // was UNSCANNED. A single-key `{ r: new Response(x) }` happened to parse as a
  // label and did fire, so the hole presented as coverage.
  test("MEDIUM: a MULTI-KEY `<endpoint>` arm carrying a Response fires it", () => {
    const src = `<program db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users">
    \${
      function loadUser(id) {
        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
        return u
      }
    }
  </db>

type Op:enum = {
  Fetch(id: int)
  Deny
}

<endpoint path="/gate" method="POST" accepts=Op>
  <Fetch(id) : loadUser(id)>
  <Deny : { jsonrpc: "2.0", result: Response.json({ error: "no" }, { status: 403 }) }>
</endpoint>

</program>`;
    const { result } = compileSource(src);
    expect(fires(result)).toBe(true);
  });

  test("MEDIUM: a clean MULTI-KEY arm still compiles (the new frame does not over-fire)", () => {
    const src = `<program db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users">
    \${
      function loadUser(id) {
        let u = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()
        return u
      }
    }
  </db>

type Op:enum = {
  Fetch(id: int)
  Deny
}

<endpoint path="/gate" method="POST" accepts=Op>
  <Fetch(id) : loadUser(id)>
  <Deny : { jsonrpc: "2.0", result: { ok: false, code: 403 } }>
</endpoint>

</program>`;
    const { result } = compileSource(src);
    expect(fires(result)).toBe(false);
    expect((result.errors ?? []).filter((d) => d.code.startsWith("E-PROTECT-"))).toEqual([]);
  });

  // ⚑ ONE AUTHOR DEFECT, ONE DIAGNOSTIC. A server fn is lowered TWICE — as its
  // route handler and as the in-process peer callable — so without the span-keyed
  // dedup a single hand-built body reported E-PROTECT-005 twice. Asserting the
  // COUNT, not just presence: a presence assertion passes on the duplicate.
  //
  // ⚠ THE CALLER MUST BE SERVER-ROUTED IN ITS OWN RIGHT, WHICH IS WHY IT CARRIES
  // ITS OWN `?{}`. My first version of this test had the caller do nothing but
  // call the peer; route inference put it on the CLIENT, so the call went over
  // the wire, no peer callable was emitted, and the test reported 1 WITH OR
  // WITHOUT the dedup — hollow. Verified by disabling the dedup and watching this
  // shape go 1 -> 2 while the hollow one stayed at 1, and by grepping the emitted
  // module for the peer-callable banner.
  test("a fn emitted as BOTH a route handler and a peer callable reports E-PROTECT-005 ONCE", () => {
    const src = protectProgram(
      `      function leak(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }\n      function callsIt(id) {\n        let a = ?{\`SELECT * FROM audit WHERE id = \${id}\`}.get()\n        return leak(id)\n      }`,
    ).replace(
      "?{`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)`}",
      "?{`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)`}\n    ?{`CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT)`}",
    ).replace('tables="users"', 'tables="users,audit"');
    const { result, serverJs } = compileSource(src);
    // Pin the premise: the peer callable really was emitted, else the dedup is
    // untested and this assertion is vacuous.
    expect(serverJs).toContain('in-process peer callable for server function "leak"');
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.filter((d) => d.code === "E-PROTECT-005").length).toBe(1);
  });

  test("TWO distinct offending fns still report TWICE (dedup is per SPAN, not per code)", () => {
    // The dedup must not collapse genuinely separate defects. Span-keyed, so two
    // sites report two diagnostics even though the code and shape are identical.
    const { result } = compileSource(protectProgram(
      `      function leakA(id) {\n        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(u))\n      }\n      function leakB(id) {\n        let v = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()\n        return new Response(JSON.stringify(v))\n      }`,
    ));
    const all = [...(result.warnings ?? []), ...(result.errors ?? [])];
    expect(all.filter((d) => d.code === "E-PROTECT-005").length).toBe(2);
  });

  test("an `<endpoint>` arm constructing a Response fires it, and names the arm", () => {
    const src = `<program db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users">
    \${
      function loadUser(id) {
        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
        return u
      }
    }
  </db>

type Op:enum = {
  Fetch(id: int)
  Deny
}

<endpoint path="/gate" method="POST" accepts=Op>
  <Fetch(id) : loadUser(id)>
  <Deny : Response.json({ error: "no" }, { status: 403 })>
</endpoint>

</program>`;
    const { result } = compileSource(src);
    const d = [...(result.errors ?? [])].find((x) => x.code === "E-PROTECT-005");
    expect(d).toBeTruthy();
    // The diagnostic must name the ARM and the endpoint — an arm has no function
    // identity for the adopter to search for, so "server function `?`" would be
    // useless. It must also name the SPELLING it matched.
    expect(d.message).toContain("<Deny> arm of <endpoint POST /gate>");
    expect(d.message).toContain("Response.json(...)");
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
