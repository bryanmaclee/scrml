/**
 * ss22 item 5 (g-enum-toenum-not-lowered-server-side) — a `<Enum>.toEnum(raw)`
 * call inside a `server function` body must be LOWERED to a `<Enum>_toEnum[...]`
 * lookup AND the `<Enum>_toEnum` / `<Enum>_variants` lookup tables must be
 * emitted into the SERVER bundle (reachability-gated).
 *
 * ROOT CAUSE (distinct from Bug-51, which is enum DEFINITION emission):
 *   - The structured-AST emit path (`emitExpr`) emits a `<Enum>.toEnum(raw)`
 *     call VERBATIM. Only the STRING-rewrite pass `rewriteEnumToEnum`
 *     (rewrite.ts) lowers it, and a `return <Enum>.toEnum(raw)` / a
 *     `.map(row => ({ ... <Enum>.toEnum(x) ... }))` body reaches codegen as a
 *     structured call-expr (or an arrow nested inside one), which bypasses the
 *     string pass. The call therefore leaks un-lowered.
 *   - The `<Enum>_toEnum` / `<Enum>_variants` lookup tables (emitEnumLookupTables
 *     @ emit-client.ts) were emitted into the CLIENT bundle only.
 *   Net: the server bundle compiles exit-0 and `node --check`-passes (a frozen
 *   enum object + a free identifier are both syntactically valid), then throws
 *   `TypeError: <Enum>.toEnum is not a function` at RUNTIME. SILENT compile-time.
 *
 * FIX (emit-server.ts generateServerJs):
 *   PART 1 — post-process the assembled server body, lowering
 *     `<Enum>.toEnum(...)` / `toEnum(<Enum>, ...)` → `(<Enum>_toEnum[...] ?? null)`
 *     for statically-known enum names only.
 *   PART 2 — emit the `<Enum>_toEnum` / `<Enum>_variants` tables into the server
 *     bundle, REACHABILITY-GATED on the table identifier appearing in the
 *     assembled body (mirrors the Bug-51 variant-object gate).
 *
 * §14.4.3 (giti DB-coerce idiom) is the canonical adopter: `?{...}.all().map(row
 * => ({ ...row, status: TaskStatus.toEnum(row.status) ?? row.status }))` inside a
 * server function.
 *
 * Asserts: server-side lowering + table presence + reachability gate + RUNTIME
 * resolution (the call returns the coerced variant / `null` on no match, no
 * TypeError) + no client regression.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ss22-toenum-server-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({
    inputFiles: [file],
    write: false,
    validateEmit: true,
    log: () => {},
  });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out };
}

const TABLE_RE = (name) => new RegExp("const\\s+" + name + "_toEnum\\s*=\\s*\\{");
const VARIANTS_RE = (name) => new RegExp("const\\s+" + name + "_variants\\s*=\\s*\\[");
const parseClean = (js) =>
  expect(() => acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();

// ---------------------------------------------------------------------------
// §1. `return <Enum>.toEnum(raw)` in a server fn — lowered + table present.
// ---------------------------------------------------------------------------
describe("ss22 §1: bare `return Enum.toEnum(raw)` in a server fn", () => {
  test("the call is lowered to a table lookup and the table is emitted server-side", () => {
    const src = `<program>
type Load:enum = {
  Pending
  Ok
  Loaded
  Bad
}
\${
  server function coerce(raw) { return Load.toEnum(raw) }
}
<div><p>s1</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    // PART 1: the call is lowered (no un-lowered `Load.toEnum(` survives).
    expect(out.serverJs).not.toMatch(/Load\.toEnum\s*\(/);
    expect(out.serverJs).toContain("Load_toEnum[raw] ?? null");
    // PART 2: the lookup table is present in the SERVER bundle.
    expect(out.serverJs).toMatch(TABLE_RE("Load"));
    // The table must precede its first use (module-init order).
    const defIdx = out.serverJs.indexOf("const Load_toEnum");
    const refIdx = out.serverJs.indexOf("Load_toEnum[raw]");
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(defIdx).toBeLessThan(refIdx);
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §2. §14.4.3 DB-coerce idiom — `toEnum()` inside `.map()` in a server fn.
// ---------------------------------------------------------------------------
describe("ss22 §2: §14.4.3 .map() coerce idiom in a server fn", () => {
  test("the `.map()` arrow `Enum.toEnum(...)` is lowered + table emitted server-side", () => {
    const src = `<program>
type Load:enum = {
  Pending
  Ok
  Bad
}
\${
  server function coerceAll(rows) { return rows.map(row => ({ ...row, status: Load.toEnum(row.status) ?? row.status })) }
}
<div><p>s2</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    expect(out.serverJs).not.toMatch(/Load\.toEnum\s*\(/);
    expect(out.serverJs).toContain("Load_toEnum[row.status] ?? null");
    expect(out.serverJs).toMatch(TABLE_RE("Load"));
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §3. RUNTIME — the lowered handler actually resolves (no TypeError); coerce
//     returns the matching variant, or `null` (scrml `not`) on no match.
// ---------------------------------------------------------------------------
describe("ss22 §3: server-runtime toEnum resolution (R26)", () => {
  test("the handler returns the coerced variant on a match and null on no match", async () => {
    const src = `<program>
type Load:enum = {
  Pending
  Ok
  Loaded
  Bad
}
\${
  server function coerce(raw) { return Load.toEnum(raw) }
}
<div><p>s3</p></div>
</program>`;
    const dir = mkdtempSync(join(tmpdir(), "scrml-ss22-rt-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, src);
    const result = compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
    const out = [...result.outputs.values()][0];
    // Write the server bundle to disk and dynamically import it.
    const serverFile = join(dir, "app.server.mjs");
    writeFileSync(serverFile, out.serverJs);
    const mod = await import(serverFile);
    expect(Array.isArray(mod.routes)).toBe(true);
    // Derive the route from the emitted routes array rather than hardcoding a
    // `coerce_N` name (the genVar counter is process-shared, so the index varies
    // under the full suite). There is exactly one route here.
    const route = mod.routes[0];
    expect(route).toBeTruthy();
    expect(typeof route.handler).toBe("function");

    // Use a self-shimmed request rather than the global `Request`/`Headers`. A
    // sibling integration test may have called happy-dom's GlobalRegistrator,
    // which strips the forbidden `Cookie` REQUEST header on construction — the
    // emitted CSRF check then sees an empty cookie token and returns 403. The
    // shim makes this runtime R26 env-independent (we are asserting toEnum
    // resolution, not the CSRF machinery): cookie + header carry the same token.
    const token = "ss22-csrf";
    const mk = (raw) => ({
      url: "http://localhost" + route.path,
      headers: {
        get(name) {
          const n = name.toLowerCase();
          if (n === "cookie") return "scrml_csrf=" + token;
          if (n === "x-csrf-token") return token;
          return null;
        },
      },
      json: async () => ({ raw }),
      // dpa-030 D4 — the emitted JSON prologue stream-counts `req.body` against a
      // size ceiling rather than calling `req.json()`; a duck-typed request needs
      // a real `body` ReadableStream (every real `Request` has one).
      body: new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify({ raw }))); c.close(); },
      }),
    });

    // Match → coerced variant string (no TypeError — the whole point).
    const okRes = await route.handler(mk("Ok"));
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toBe(JSON.stringify("Ok"));

    // No match → null (scrml `not` per §14.4.1).
    const badRes = await route.handler(mk("NOPE"));
    expect(badRes.status).toBe(200);
    expect(await badRes.text()).toBe(JSON.stringify(null));
  });
});

// ---------------------------------------------------------------------------
// §4. enum used ONLY server-side — its table appears in the server bundle.
//     (adversarial S215 — the server-only reachability case.)
// ---------------------------------------------------------------------------
describe("ss22 §4: server-only enum table is emitted server-side", () => {
  test("a server-only `toEnum` enum gets its `_toEnum` table in the server bundle", () => {
    const src = `<program>
type ServerOnly:enum = {
  SA
  SB
}
\${
  server function coerce(raw) { return ServerOnly.toEnum(raw) }
}
<div><p>s4</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    expect(out.serverJs).toMatch(TABLE_RE("ServerOnly"));
    expect(out.serverJs).toContain("ServerOnly_toEnum[raw] ?? null");
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §5. reachability gate — a client-only enum must NOT get a table in the server
//     bundle. The server bundle stays minimal.
// ---------------------------------------------------------------------------
describe("ss22 §5: reachability gate keeps the server bundle minimal", () => {
  test("a client-only `toEnum` enum is absent from the server bundle; the server one is present", () => {
    const src = `<program>
type ServerUsed:enum = {
  SA
  SB
}
type ClientUsed:enum = {
  CA
  CB
}
<picked> = ClientUsed.toEnum("CA")
\${
  server function coerce(raw) { return ServerUsed.toEnum(raw) }
}
<div><p>\${@picked}</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    // Server-used enum table present server-side.
    expect(out.serverJs).toMatch(TABLE_RE("ServerUsed"));
    // Client-only enum table GATED OUT of the server bundle.
    expect(out.serverJs).not.toMatch(TABLE_RE("ClientUsed"));
    expect(out.serverJs).not.toMatch(VARIANTS_RE("ClientUsed"));
    // Both present client-side (legacy client behavior — full table set).
    expect(out.clientJs).toMatch(TABLE_RE("ServerUsed"));
    expect(out.clientJs).toMatch(TABLE_RE("ClientUsed"));
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §6. enum used on BOTH sides — table in both bundles, exactly once server-side
//     (no double-emit corruption).
// ---------------------------------------------------------------------------
describe("ss22 §6: enum used both client- and server-side", () => {
  test("the table appears in both bundles and exactly once server-side", () => {
    const src = `<program>
type Both:enum = {
  BA
  BB
}
<picked> = Both.toEnum("BA")
\${
  server function coerce(raw) { return Both.toEnum(raw) }
}
<div><p>\${@picked}</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    expect(out?.clientJs).toBeTruthy();
    const serverTables = (out.serverJs.match(/const Both_toEnum\s*=/g) || []).length;
    const clientTables = (out.clientJs.match(/const Both_toEnum\s*=/g) || []).length;
    expect(serverTables).toBe(1);
    expect(clientTables).toBe(1);
    // Server call lowered.
    expect(out.serverJs).toContain("Both_toEnum[raw] ?? null");
    parseClean(out.serverJs);
    parseClean(out.clientJs);
  });
});

// ---------------------------------------------------------------------------
// §7. non-enum `.toEnum(...)` is NOT touched — the lowering is name-scoped to
//     statically-known enum types only (no false rewrite of a user method).
// ---------------------------------------------------------------------------
describe("ss22 §7: non-enum `.toEnum` is left intact", () => {
  test("a `<Enum>.toEnum` lowers but a sibling non-enum `Other.foo()` is untouched", () => {
    // `Helper` is NOT an enum — a `Helper.toEnum(...)` (were one written) must
    // not be lowered. Here we assert the enum lowers while an unrelated member
    // call on a non-enum identifier survives verbatim.
    const src = `<program>
type Load:enum = {
  Ok
  Bad
}
\${
  server function coerce(raw) {
    const ext = globalThis.External
    return ext.normalize(Load.toEnum(raw))
  }
}
<div><p>s7</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    // The enum `.toEnum` lowered.
    expect(out.serverJs).toContain("Load_toEnum[raw] ?? null");
    // The non-enum member call survives verbatim (name-scoped lowering).
    expect(out.serverJs).toContain("ext.normalize(");
    parseClean(out.serverJs);
  });
});
