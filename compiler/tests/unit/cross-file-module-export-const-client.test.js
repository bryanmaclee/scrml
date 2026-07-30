/**
 * GH #263 — a cross-file `.scrml` module's exported top-level `const` was DROPPED
 * from that module's CLIENT bundle: never declared, absent from the
 * `_scrml_modules` registry footer, while the exported `fn`s that CLOSE OVER it
 * WERE emitted client-side. The emitted client fn then referenced an undeclared
 * binding (`return GREETING;` with no `const GREETING`) — a silent runtime
 * `ReferenceError`, zero compile errors/warnings, passing `node --check`.
 *
 * ROOT CAUSE. `export const X = …` parses to an `export-decl` (exportKind:"const")
 * with NO companion `const-decl` (unlike `export fn` → function-decl). No
 * `emitLogicNode` case handles export-decl (falls to `default: return ""`), so
 * the top-level-logic walker emitted nothing for it. A PLAIN `const` emits fine
 * via that same walker — the divergence is purely the export-decl shape.
 *
 * FIX (emit-client.ts `emitReferencedModuleExportConstLines`) — emit a
 * module-level `export const`/`export let` VALUE binding into the client bundle
 * when — and ONLY when — a §14.8-confidentiality-safe AST reachability gate
 * (`collectClientReferencedIdents`) proves a CLIENT-EMITTED USER node references
 * the identifier as a REAL identifier node. Because the gate walks real
 * IdentExpr nodes in client fn bodies / client top-level reactive wiring (never
 * a text scan over the assembled bundle), a server-only const's identifier —
 * which appears only inside a `server fn` body (lowered to a fetch stub) or a
 * server-only node — can NEVER enter the client bundle.
 *
 * Coverage — BOTH directions are pinned:
 *   §1  cross-file: the module `.client.js` DECLARES the const and the footer
 *       registers it; the bundle parses as a CLASSIC script (vm.Script).
 *   §2  CONFIDENTIALITY (§14.8): an `export const` referenced ONLY by a `server
 *       fn` (a client-side fetch STUB that never names it) is NOT emitted into
 *       any `.client.js`. Regression pins for the two CONFIRMED first-attempt
 *       leaks: (a) the const NAMES `body`/`path`/`method` collide with the CSRF
 *       fetch-stub boilerplate's PARAM names; (b) a const NAME that appears in a
 *       client fn STRING literal.
 *   §3  transitive const→const: `export const B = A + …` closed over by a client
 *       fn emits BOTH A and B, in dependency order (A before B).
 *   §4  same-file regression guard: a PLAIN `const` closed over by a local fn
 *       still emits exactly one declaration (no double-emit from the new pass).
 *   §5  parse-defect fail-closed: multi-declarator, type-annotated, and
 *       reassigned-`export let` shapes emit VALID JS (never a truncated init or
 *       a double declaration); a clean sibling const still reaches the client.
 *
 * SPEC anchors: §14.8 (confidentiality / trust boundary), §21.3 (cross-file
 * imports), §40 (client emit).
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

const importerPage = (importNames, effectFn) => `<page>
  ${OPEN}
      import { ${importNames} } from './models/m.scrml'
      <msg> = ""
      on mount { @msg = ${effectFn} }
  ${CLOSE}
  <p>${OPEN}@msg${CLOSE}</p>
</page>
`;

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
    writeFileSync(join(dir, "index.scrml"), importerPage("greet", "greet()"));
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
  // The two CONFIRMED first-attempt leaks were a STRING-BLIND regex over the
  // assembled client TEXT matching (a) the CSRF fetch-stub's `path`/`method`/
  // `body` PARAM names and (b) a name inside a client string literal. Both are
  // pinned here — the AST gate matches neither by construction.
  for (const nm of ["body", "path", "method"]) {
    describe(`server-only export const named \`${nm}\` (CSRF-stub param collision)`, () => {
      const NAME = `serveronly_${nm}`;
      let dir;
      beforeEach(() => {
        dir = setupDir(NAME);
        writeFileSync(join(dir, "models", "m.scrml"), `${OPEN}
    export const ${nm} = "LEAK-CANARY-${nm}"

    export server fn reveal() -> string {
        return ${nm}
    }
${CLOSE}
`);
        writeFileSync(join(dir, "index.scrml"), importerPage("reveal", "reveal()"));
      });
      afterEach(() => teardownDir(NAME));

      test(`the value is absent from every .client.js (present only server-side)`, () => {
        const c = compileDir(join(dir, "index.scrml"));
        expect(c.errors).toEqual([]);
        const m = c.out("m.scrml");
        const idx = c.out("index.scrml");
        expect(m).not.toBeNull();
        const canary = new RegExp(`LEAK-CANARY-${nm}`);
        expect(m.clientJs).not.toMatch(canary);
        expect(idx.clientJs).not.toMatch(canary);
        // Server bundle DOES hold it (the value is legitimately server-side).
        expect(m.serverJs ?? "").toMatch(canary);
        // node --check / classic-script parse still clean.
        expect(() => new vm.Script(m.clientJs)).not.toThrow();
      });
    });
  }

  describe("server-only export const whose NAME appears in a client string literal", () => {
    const NAME = "serveronly_str";
    let dir;
    beforeEach(() => {
      dir = setupDir(NAME);
      writeFileSync(join(dir, "models", "m.scrml"), `${OPEN}
    export const SECRET = "sk-LEAK-CANARY-value"

    export server fn reveal() -> string {
        return SECRET
    }

    export fn label() {
        return "please type your SECRET here"
    }
${CLOSE}
`);
      writeFileSync(join(dir, "index.scrml"), importerPage("reveal, label", "label()"));
    });
    afterEach(() => teardownDir(NAME));

    test("the SECRET value stays out of every .client.js even though its NAME is in a client string", () => {
      const c = compileDir(join(dir, "index.scrml"));
      expect(c.errors).toEqual([]);
      const m = c.out("m.scrml");
      const idx = c.out("index.scrml");
      expect(m.clientJs).not.toMatch(/sk-LEAK-CANARY-value/);
      expect(idx.clientJs).not.toMatch(/sk-LEAK-CANARY-value/);
      // The client string that merely NAMES it is unaffected (it is client UI).
      expect(m.clientJs).toMatch(/please type your SECRET here/);
      // And the value is present server-side.
      expect(m.serverJs ?? "").toMatch(/sk-LEAK-CANARY-value/);
    });
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
    writeFileSync(join(dir, "index.scrml"), importerPage("getDerived", "getDerived()"));
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

describe("GH #263 §5 — parse-defect shapes fail closed (valid JS, never invalid/double)", () => {
  // Each nasty shape sits next to a clean `export const GREETING` reached by a
  // client fn. The clean sibling must still reach the client; the nasty shape
  // must be SKIPPED (never a truncated init or a redeclaration). node --check /
  // classic-script parse must stay clean.
  const cases = {
    "multi-declarator (export const A = 1, B = 2)": `${OPEN}
    export const A = 1, B = 2
    export const GREETING = "hi"
    export fn readAll() { return A + B + GREETING }
${CLOSE}
`,
    "type-annotated (export const REC: Record<...> = ...)": `${OPEN}
    export const REC: Record<string, number> = { x: 1 }
    export const GREETING = "hi"
    export fn readAll() { return REC.x + GREETING }
${CLOSE}
`,
    "reassigned export let (export let counter = 0; counter = 5)": `${OPEN}
    export let counter = 0
    counter = 5
    export const GREETING = "hi"
    export fn readAll() { return counter + GREETING }
${CLOSE}
`,
  };
  for (const [label, module] of Object.entries(cases)) {
    describe(label, () => {
      const NAME = "parsedefect_" + label.replace(/\W+/g, "_").slice(0, 24);
      let dir;
      beforeEach(() => {
        dir = setupDir(NAME);
        writeFileSync(join(dir, "models", "m.scrml"), module);
        writeFileSync(join(dir, "index.scrml"), importerPage("readAll", "readAll()"));
      });
      afterEach(() => teardownDir(NAME));

      test("emits valid JS; clean sibling reaches client; no truncated/double decl", () => {
        const c = compileDir(join(dir, "index.scrml"));
        const m = c.out("m.scrml");
        expect(m).not.toBeNull();
        // Never a truncated multi-declarator init.
        expect(m.clientJs).not.toMatch(/const A = 1 ,/);
        // Never a double `counter` declaration.
        const counterDecls = (m.clientJs.match(/^\s*(?:const|let) counter\b/gm) ?? []).length;
        expect(counterDecls).toBeLessThanOrEqual(1);
        // The clean sibling const still reaches the client.
        expect(m.clientJs).toMatch(/^\s*const GREETING = "hi";/m);
        // Classic-script parse (node --check surrogate) stays clean.
        expect(() => new vm.Script(m.clientJs)).not.toThrow();
      });
    });
  }
});
