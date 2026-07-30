/**
 * GH #263 — a cross-file `.scrml` module's exported top-level `const` was DROPPED
 * from that module's CLIENT bundle: never declared, absent from the registry
 * footer, while the exported `fn`s that CLOSE OVER it WERE emitted client-side.
 * The emitted client fn then referenced an undeclared binding
 * (`return GREETING;` with no `const GREETING`) — a silent runtime
 * `ReferenceError`, zero compile errors/warnings, passing `node --check`.
 *
 * ROOT CAUSE. `export const X = …` parses to an `export-decl` (exportKind:"const")
 * with NO companion `const-decl` (unlike `export fn` → function-decl). No
 * `emitLogicNode` case handles export-decl (falls to `default: return ""`), so
 * the top-level-logic walker emitted nothing for it. A PLAIN `const` emits fine
 * via that same walker — the divergence is purely the export-decl shape.
 *
 * FIX (emit-client.ts `emitReferencedModuleExportConstLines`) — the direct CLIENT
 * analogue of emit-server's D-5 `emitReferencedModuleConstLines` (GH #242,
 * 88f9745e): emit a module-level `export const`/`export let` VALUE binding into
 * the client bundle when — and only when — client-reachable code references it.
 *
 * Coverage:
 *   §1  cross-file: the module `.client.js` DECLARES the const and the footer
 *       registers it; the bundle parses as a CLASSIC script (vm.Script).
 *   §2  confidentiality (§14.8): an `export const` referenced ONLY by a `server
 *       fn` (a client-side fetch STUB that never names it) is NOT emitted into
 *       any `.client.js`.
 *   §3  transitive const→const: `export const B = A + …` closed over by a client
 *       fn emits BOTH A and B, in dependency order (A before B).
 *   §4  same-file regression guard: a PLAIN `const` closed over by a local fn
 *       still emits exactly one declaration (no double-emit from the new pass).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import vm from "vm";
import { compileScrml } from "../../src/api.js";

const TMP_ROOT = "/tmp/scrml-263-export-const-tests";
const OPEN = "${";
const CLOSE = "}";

function setupDir(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "models"), { recursive: true });
  return dir;
}
function teardownDir(name) {
  rmSync(join(TMP_ROOT, name), { recursive: true, force: true });
}

/** Compile a temp dir (no disk writes) and return { errors, out(rel) }. */
function compileDir(entry) {
  const result = compileScrml({ inputFiles: [entry], write: false, log: () => {} });
  const out = (rel) => {
    for (const [fp, o] of result.outputs ?? new Map()) {
      if (fp.endsWith(`/${rel}`) || fp.endsWith(rel)) return o;
    }
    return null;
  };
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    out,
  };
}

describe("GH #263 §1 — cross-file module export const reaches the client bundle", () => {
  const NAME = "cross";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models", "m.scrml"), `${OPEN}
    export const GREETING = "hello"

    export fn greet() {
        return GREETING
    }
${CLOSE}
`);
    writeFileSync(join(dir, "index.scrml"), `<page>
  ${OPEN}
      import { greet } from './models/m.scrml'
      <msg> = ""
      on mount { @msg = greet() }
  ${CLOSE}
  <p>${OPEN}@msg${CLOSE}</p>
</page>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("the module .client.js DECLARES the const and registers it in the footer", () => {
    const c = compileDir(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("m.scrml");
    expect(m).not.toBeNull();
    // The fn that closes over it is still emitted...
    expect(m.clientJs).toMatch(/return GREETING;/);
    // ...and now the const is actually DECLARED (the bug: it never was).
    expect(m.clientJs).toMatch(/^\s*const GREETING = "hello";/m);
    // ...and the registry footer picks it up (directly-importable).
    expect(m.clientJs).toMatch(
      /_scrml_modules\["models\/m\.client\.js"\] = \{[^}]*GREETING: GREETING[^}]*\}/,
    );
    // Classic-script parse guard (a raw import/export would throw here).
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });
});

describe("GH #263 §2 — confidentiality: a server-only export const does NOT leak to the client", () => {
  const NAME = "serveronly";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models", "m.scrml"), `${OPEN}
    export const SECRET = "top-secret-value"

    export server fn reveal() -> string {
        return SECRET
    }
${CLOSE}
`);
    writeFileSync(join(dir, "index.scrml"), `<page>
  ${OPEN}
      import { reveal } from './models/m.scrml'
      <msg> = ""
      on mount { @msg = reveal() }
  ${CLOSE}
  <p>${OPEN}@msg${CLOSE}</p>
</page>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("SECRET is absent from every .client.js (present only server-side)", () => {
    const c = compileDir(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("m.scrml");
    const idx = c.out("index.scrml");
    expect(m).not.toBeNull();
    expect(m.clientJs).not.toMatch(/SECRET/);
    expect(idx.clientJs).not.toMatch(/SECRET/);
    // Server bundle DOES hold it (the value is legitimately server-side).
    expect(m.serverJs ?? "").toMatch(/SECRET/);
  });
});

describe("GH #263 §3 — transitive const→const chain emits in dependency order", () => {
  const NAME = "transitive";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "models", "m.scrml"), `${OPEN}
    export const BASE = "base"
    export const DERIVED = BASE + "-derived"

    export fn getDerived() {
        return DERIVED
    }
${CLOSE}
`);
    writeFileSync(join(dir, "index.scrml"), `<page>
  ${OPEN}
      import { getDerived } from './models/m.scrml'
      <msg> = ""
      on mount { @msg = getDerived() }
  ${CLOSE}
  <p>${OPEN}@msg${CLOSE}</p>
</page>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("both BASE and DERIVED are declared, BASE before DERIVED", () => {
    const c = compileDir(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const m = c.out("m.scrml");
    expect(m).not.toBeNull();
    const baseAt = m.clientJs.search(/^\s*const BASE = /m);
    const derivedAt = m.clientJs.search(/^\s*const DERIVED = /m);
    expect(baseAt).toBeGreaterThanOrEqual(0);
    expect(derivedAt).toBeGreaterThanOrEqual(0);
    expect(baseAt).toBeLessThan(derivedAt); // dependency (topological) order
    expect(() => new vm.Script(m.clientJs)).not.toThrow();
  });
});

describe("GH #263 §4 — same-file plain const closed over by a local fn (no double-emit)", () => {
  const NAME = "samefile";
  let dir;
  beforeEach(() => {
    dir = setupDir(NAME);
    writeFileSync(join(dir, "index.scrml"), `<page>
  ${OPEN}
      const GREETING = "hello"

      fn greet() {
          return GREETING
      }

      <msg> = ""
      on mount { @msg = greet() }
  ${CLOSE}
  <p>${OPEN}@msg${CLOSE}</p>
</page>
`);
  });
  afterEach(() => teardownDir(NAME));

  test("emits exactly one `const GREETING` declaration", () => {
    const c = compileDir(join(dir, "index.scrml"));
    expect(c.errors).toEqual([]);
    const idx = c.out("index.scrml");
    expect(idx).not.toBeNull();
    const decls = (idx.clientJs.match(/^\s*const GREETING = "hello";/gm) ?? []).length;
    expect(decls).toBe(1);
    expect(idx.clientJs).toMatch(/return GREETING;/);
  });
});
