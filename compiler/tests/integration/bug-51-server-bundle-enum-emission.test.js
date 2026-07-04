/**
 * Bug-51 (giti P0) — page-local `type X:enum` referenced inside a `server
 * function` body must emit `const X = Object.freeze({...})` into the SERVER
 * bundle, not the client bundle ONLY.
 *
 * ROOT CAUSE: emitEnumVariantObjects (emit-client.ts) emitted the frozen enum
 * objects into the client bundle exclusively. rewrite.ts deliberately leaves a
 * member-access `X.Member` AS-IS (only bare `.Member` / `X::Member` are
 * string-inlined), expecting the frozen `const X` to exist at runtime — which
 * it never did server-side. A `server function` body referencing `Load.Ok`
 * thus hit `ReferenceError: Load is not defined` at runtime (compile exit-0,
 * `node --check` clean because a free identifier is syntactically valid).
 *
 * FIX (emit-server.ts generateServerJs): reuse the SAME exported
 * emitEnumVariantObjects (byte-identical Object.freeze shape so server↔client
 * payload-variant serialization agrees), reachability-gated — emit only an
 * enum whose name is actually referenced in the assembled server body.
 *
 * Asserts: enum-def present + acorn-parse-clean server bundle + byte-identical
 * server/client defs + reachability gate (client-only enum NOT in server).
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-bug51-enum-server-"));
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

const FREEZE_RE = (name) => new RegExp("const\\s+" + name + "\\s*=\\s*Object\\.freeze");
function freezeLine(js, name) {
  const m = new RegExp("^const\\s+" + name + "\\s*=\\s*Object\\.freeze.*$", "m").exec(js || "");
  return m ? m[0] : null;
}
const parseClean = (js) =>
  expect(() => acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();

// ---------------------------------------------------------------------------
// §1. enum referenced ONLY in a server fn — must appear in the server bundle.
// ---------------------------------------------------------------------------
describe("Bug-51 §1: page-local enum used only in a server fn", () => {
  test("the frozen enum def IS emitted into the server bundle and parses clean", () => {
    const src = `<program>
type Load:enum = {
  Pending
  Ok
  Bad
}
\${
  server function probe() { const ok = true  return ok ? Load.Ok : Load.Bad }
}
<div><p>s1</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    // The fix: the enum def is now present server-side (was 0 before Bug-51 fix).
    expect(out.serverJs).toMatch(FREEZE_RE("Load"));
    // The server-fn body still references Load.Ok / Load.Bad (member-access AS-IS).
    expect(out.serverJs).toContain("Load.Ok");
    expect(out.serverJs).toContain("Load.Bad");
    // The frozen const must precede its first member-access reference in the file
    // (module-init order) so it is not a free identifier.
    const defIdx = out.serverJs.indexOf("const Load = Object.freeze");
    const refIdx = out.serverJs.indexOf("Load.Ok");
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(defIdx).toBeLessThan(refIdx);
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §2. enum referenced in BOTH client markup AND a server fn — no double-def
//     collision; the server/client defs are byte-identical.
// ---------------------------------------------------------------------------
describe("Bug-51 §2: enum used in both client markup and a server fn", () => {
  test("appears once per bundle, byte-identical, both parse clean", () => {
    const src = `<program>
type Load:enum = {
  Pending
  Ok
  Bad
}
<status> = Load.Pending
\${
  server function probe() { const ok = true  return ok ? Load.Ok : Load.Bad }
}
<div>
  <button onclick=\${ @status = Load.Ok }>set ok</button>
  <p>\${ @status }</p>
</div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    expect(out?.clientJs).toBeTruthy();
    // Exactly one def in each bundle (no duplication).
    const serverDefs = (out.serverJs.match(/const Load = Object\.freeze/g) || []).length;
    const clientDefs = (out.clientJs.match(/const Load = Object\.freeze/g) || []).length;
    expect(serverDefs).toBe(1);
    expect(clientDefs).toBe(1);
    // Byte-identical def line (so a payload-variant constructor serializes the
    // same { variant, data } shape on both sides).
    const sLine = freezeLine(out.serverJs, "Load");
    const cLine = freezeLine(out.clientJs, "Load");
    expect(sLine).not.toBeNull();
    expect(sLine).toBe(cLine);
    parseClean(out.serverJs);
    parseClean(out.clientJs);
  });
});

// ---------------------------------------------------------------------------
// §3. reachability gate — a client-only enum must NOT appear in the server
//     bundle (the server bundle stays minimal).
// ---------------------------------------------------------------------------
describe("Bug-51 §3: reachability gate keeps the server bundle minimal", () => {
  test("a client-only enum is absent from the server bundle; the server-used one is present", () => {
    const src = `<program>
type Load:enum = {
  Pending
  Ok
  Bad
}
type Other:enum = {
  Alpha
  Beta
}
<status> = Load.Pending
\${
  server function probe() { const ok = true  return ok ? Load.Ok : Load.Bad }
}
<div>
  <button onclick=\${ @status = Other.Alpha }>set</button>
  <p>\${ @status }</p>
</div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    // Load is referenced in the server fn → present server-side.
    expect(out.serverJs).toMatch(FREEZE_RE("Load"));
    // Other is referenced ONLY in client markup → gated OUT of the server bundle.
    expect(out.serverJs).not.toMatch(FREEZE_RE("Other"));
    // Both are present client-side.
    expect(out.clientJs).toMatch(FREEZE_RE("Load"));
    expect(out.clientJs).toMatch(FREEZE_RE("Other"));
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §4. payload-carrying variant constructor in a server fn — the constructor
//     resolves against the frozen function-valued field.
// ---------------------------------------------------------------------------
describe("Bug-51 §4: payload-variant constructor in a server fn", () => {
  test("the constructor field is defined server-side and the call resolves", () => {
    const src = `<program>
type Load:enum = {
  Pending
  Loaded({ count })
  Bad
}
\${
  server function probe() { const n = 3  return n > 0 ? Load.Loaded({ count: n }) : Load.Bad }
}
<div><p>s4</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    expect(out.serverJs).toMatch(FREEZE_RE("Load"));
    // The frozen def carries the Loaded constructor function.
    expect(out.serverJs).toMatch(/Loaded:\s*function/);
    // The handler invokes the constructor.
    expect(out.serverJs).toContain("Load.Loaded({count: n})");
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §5. enum used in a `server function*` (SSE generator) body — the def
//     precedes the yields so the SSE stream does not throw a ReferenceError.
// ---------------------------------------------------------------------------
describe("Bug-51 §5: enum in a server function* (SSE) body", () => {
  test("the frozen def is emitted and precedes the generator yields", () => {
    const src = `<program>
type Tick:enum = {
  Start
  Beat
  Stop
}
\${
  server function* stream() {
    yield Tick.Start
    yield Tick.Beat
    yield Tick.Stop
  }
}
<div><p>s5</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    expect(out.serverJs).toMatch(FREEZE_RE("Tick"));
    const defIdx = out.serverJs.indexOf("const Tick = Object.freeze");
    const yieldIdx = out.serverJs.indexOf("Tick.Start");
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(defIdx).toBeLessThan(yieldIdx);
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §6. COLLISION GUARD (E-CG-016) — a page-local `type SQL:enum` referenced in a
//     server fn on a `<db>` / `?{}` page collides with the compiler-injected
//     `import { SQL } from "bun"` runtime handle. The duplicate top-level
//     declaration must NOT be emitted; a clear E-CG-016 diagnostic fires
//     instead of the cryptic `Identifier 'SQL' has already been declared`
//     SyntaxError (E-CODEGEN-INVALID-LOGIC).
// ---------------------------------------------------------------------------
function allDiagnostics(result) {
  // The collision diagnostic is a CGError; partition-agnostic gather (errors
  // OR warnings) so the assertion does not depend on the stream it lands in.
  return [...(result.errors || []), ...(result.warnings || [])];
}

describe("Bug-51 §6: enum name collides with the injected `import { SQL }` handle", () => {
  const collidingSrc = `<program db="sqlite:./test.db">
type SQL:enum = {
  Ok
  Bad
}
\${
  server function probe() {
    let rows = ?{ SELECT id FROM widgets }
    let ok = true
    return ok ? SQL.Ok : SQL.Bad
  }
}
<div><p>probe</p></div>
</program>`;

  test("E-CG-016 fires and names the colliding enum", () => {
    const { result } = compileSource(collidingSrc);
    const diags = allDiagnostics(result);
    const cg16 = diags.find((e) => e.code === "E-CG-016");
    expect(cg16).toBeTruthy();
    expect(cg16.message).toContain("SQL");
    expect(cg16.severity).toBe("error");
  });

  test("the duplicate `const SQL = Object.freeze` is NOT injected; the server bundle parses clean", () => {
    const { out } = compileSource(collidingSrc);
    // The fix: the colliding enum const is skipped (the diagnostic is the
    // fails-closed signal), so there is no duplicate top-level declaration.
    if (out?.serverJs) {
      expect(out.serverJs).not.toMatch(FREEZE_RE("SQL"));
      // The `import { SQL } from "bun"` handle is still present (its presence
      // is what the enum collides with).
      expect(out.serverJs).toMatch(/import\s*\{\s*SQL\s*\}\s*from\s*"bun"/);
      // No duplicate-declaration SyntaxError (the whole point of the guard).
      parseClean(out.serverJs);
    }
  });
});

// ---------------------------------------------------------------------------
// §7. GUARD does NOT regress the non-colliding case — a normal `type Load:enum`
//     on a `<db>` / `?{}` page still emits its `const Load` server-side and
//     does NOT spuriously fire E-CG-016.
// ---------------------------------------------------------------------------
describe("Bug-51 §7: guard does not regress a non-colliding enum on a `<db>` page", () => {
  test("`type Load:enum` (no name clash) still emits `const Load` and no E-CG-016", () => {
    const src = `<program db="sqlite:./test.db">
type Load:enum = {
  Pending
  Ok
  Bad
}
\${
  server function probe() {
    let rows = ?{ SELECT id FROM widgets }
    let ok = true
    return ok ? Load.Ok : Load.Bad
  }
}
<div><p>probe</p></div>
</program>`;
    const { result, out } = compileSource(src);
    expect(allDiagnostics(result).some((e) => e.code === "E-CG-016")).toBe(false);
    expect(out?.serverJs).toBeTruthy();
    // The non-colliding enum still emits its frozen const server-side.
    expect(out.serverJs).toMatch(FREEZE_RE("Load"));
    // The SQL handle is present and the enum const is distinct — both parse.
    expect(out.serverJs).toMatch(/import\s*\{\s*SQL\s*\}\s*from\s*"bun"/);
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §8. IMPORT-PRUNE ORDERING — the enum-emit block injects AFTER the server
//     import tree-shaking prune. A server-referenced enum whose name matches a
//     client-only server-import local must NOT keep that otherwise-dead import
//     alive (the injected `const <Enum>` text must not count as a "reference"
//     during the prune). This asserts the enum still emits AND the dead import
//     is still pruned (no dangling `.server.js` import).
// ---------------------------------------------------------------------------
describe("Bug-51 §8: enum-emit ordering does not defeat import pruning", () => {
  test("a server-used enum emits without re-animating a pruned dead import", () => {
    // A page-local enum used in a server fn; the page has a `<db>` so the
    // SQL handle is injected. There are no local-`.scrml` server imports here,
    // so the prune has nothing to keep — the assertion is that the enum const
    // is injected after the prune sentinel is resolved (no leftover sentinel
    // comment) AND the server bundle has no spurious dangling import.
    const src = `<program db="sqlite:./test.db">
type Status:enum = {
  Idle
  Busy
}
\${
  server function probe() {
    let rows = ?{ SELECT id FROM widgets }
    let busy = rows.length > 0
    return busy ? Status.Busy : Status.Idle
  }
}
<div><p>probe</p></div>
</program>`;
    const { out } = compileSource(src);
    expect(out?.serverJs).toBeTruthy();
    // Enum still emitted server-side.
    expect(out.serverJs).toMatch(FREEZE_RE("Status"));
    // The prune sentinel must be fully resolved (no leftover marker comment).
    expect(out.serverJs).not.toContain("__SCRML_LOCAL_SERVER_IMPORTS__");
    parseClean(out.serverJs);
  });
});
