/**
 * known-gaps-#6 (S152) — codegen unit tests for cross-file CLIENT
 * module-loading via the `_scrml_modules` registry (Approach B, §21.3).
 *
 * Closes the C5 coverage gap that let #6 ship: NO test asserted the emitted
 * shape of a multi-file `.client.js` that imports from a dependency `.client.js`.
 *
 * Test plan (per the deep-dive):
 *   §2  vm.Script regression guard — every emitted `.client.js` parses as a
 *       CLASSIC script (no "Cannot use import statement outside a module").
 *       `node --check` is a FALSE oracle (Node ≥22 auto-detects ESM); a classic
 *       <script> parses as a Script, never a Module — so we use `vm.Script`.
 *   §3  Exporter-footer assertion — the dependency `.client.js` has the
 *       `_scrml_modules[...] = {...}` footer and NO raw `^import` / `^export`.
 *   §4  Importer-read assertion — the page `.client.js` has the
 *       `const { ... } = _scrml_modules[...]` read and NO raw `import`.
 *
 * SPEC anchors: §21.3 (cross-file imports), §40 (client emit).
 */

import { describe, test, expect } from "bun:test";
import vm from "vm";
import { compileScrml } from "../../src/api.js";
import { resolve } from "path";

const APP = resolve(import.meta.dir, "../../../examples/22-multifile/app.scrml");

/**
 * Compile the canonical multi-file example (auto-gathers types.scrml +
 * components.scrml) WITHOUT writing to disk. Returns the per-file client.js +
 * the entry HTML.
 */
function compileMultifile() {
  const result = compileScrml({ inputFiles: [APP], write: false, log: () => {} });
  const out = (rel) => {
    for (const [fp, o] of result.outputs ?? new Map()) {
      if (fp.endsWith(`/${rel}`) || fp.endsWith(rel)) return o;
    }
    return null;
  };
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    types: out("types.scrml"),
    components: out("components.scrml"),
    app: out("app.scrml"),
  };
}

describe("known-gaps-#6 §2 — vm.Script regression guard (classic-script parse)", () => {
  test("every emitted .client.js for a multi-file compile parses as a CLASSIC script", () => {
    const c = compileMultifile();
    expect(c.errors).toEqual([]);
    for (const o of [c.types, c.components, c.app]) {
      expect(o).not.toBeNull();
      expect(o.clientJs).toBeTruthy();
      // A bare `import`/`export` would throw "Cannot use import statement
      // outside a module" here; vm.Script parses as a Script, never a Module.
      expect(() => new vm.Script(o.clientJs)).not.toThrow();
    }
  });

  test("no emitted .client.js contains a raw `import`/`export` statement", () => {
    const c = compileMultifile();
    const rawImportExport = /^\s*(import|export)[ {]/m;
    for (const o of [c.types, c.components, c.app]) {
      expect(o.clientJs).not.toMatch(rawImportExport);
    }
  });
});

describe("known-gaps-#6 §3 — exporter footer assertion", () => {
  test("types.client.js registers its fn + enum exports in _scrml_modules", () => {
    const c = compileMultifile();
    // types.scrml exports `fn badgeColor` (mangled) + `enum UserRole` (const).
    expect(c.types.clientJs).toMatch(
      /_scrml_modules\["types\.client\.js"\] = \{[^}]*UserRole: UserRole[^}]*\}/,
    );
    expect(c.types.clientJs).toMatch(
      /_scrml_modules\["types\.client\.js"\] = \{[^}]*badgeColor: _scrml_badgeColor_\d+[^}]*\}/,
    );
  });

  test("types.client.js exporter has NO raw `^import`/`^export`", () => {
    const c = compileMultifile();
    expect(c.types.clientJs).not.toMatch(/^\s*import[ {]/m);
    expect(c.types.clientJs).not.toMatch(/^\s*export[ {]/m);
  });

  test("components.client.js (importer AND exporter) emits an empty footer for its markup-only component export", () => {
    const c = compileMultifile();
    // UserBadge is a cross-file COMPONENT — resolved at markup-mount time, no
    // client-side JS binding. The footer is still emitted (= {}) so the
    // importer's read never destructures `undefined`; UserBadge is simply not
    // registered (no JS value to register).
    expect(c.components.clientJs).toMatch(
      /_scrml_modules\["components\.client\.js"\] = \{\s*\}/,
    );
  });
});

describe("known-gaps-#6 §4 — importer read assertion", () => {
  test("app.client.js reads its cross-file imports from _scrml_modules (not a raw import)", () => {
    const c = compileMultifile();
    // The destructure reads from `_scrml_modules` (not a raw ESM import). It binds
    // at least `UserRole`; S201 (g-each-inline two-hop helper-hoist) AUGMENTS this
    // same `types.client.js` destructure with `badgeColor` — the helper UserBadge's
    // inlined body calls (`${badgeColor(role)}`), which the loop-emitter ${} lowering
    // now evaluates — so the binding allows additional names beyond `UserRole`.
    expect(c.app.clientJs).toMatch(
      /const \{[^}]*\bUserRole\b[^}]*\} = _scrml_modules\["types\.client\.js"\];/,
    );
    // The two-hop helper IS bound on that destructure (not left unbound).
    expect(c.app.clientJs).toMatch(
      /const \{[^}]*\bbadgeColor\b[^}]*\} = _scrml_modules\["types\.client\.js"\];/,
    );
    // g-static-component-import-dead-destructure (S285): `UserBadge` is a
    // markup-only COMPONENT (components.client.js registers `{}` for it). The
    // importer no longer emits a dead `const { UserBadge } = _scrml_modules[...]`
    // read — the component is inlined at mount by CE and is never referenced as a
    // JS value, so the destructure was pure dead code that yielded `undefined`
    // (and a page-killing TypeError the moment the dep <script> is stripped on the
    // composition path). Since `UserBadge` was the ONLY import from
    // components.scrml, the whole `_scrml_modules["components.client.js"]` read is
    // elided.
    expect(c.app.clientJs).not.toMatch(/const \{[^}]*\bUserBadge\b[^}]*\} = _scrml_modules/);
    expect(c.app.clientJs).not.toMatch(/_scrml_modules\["components\.client\.js"\]/);
    expect(c.app.clientJs).not.toMatch(/^\s*import[ {]/m);
  });

  test("components.client.js reads its types import from _scrml_modules", () => {
    const c = compileMultifile();
    // components.scrml imports { UserRole, badgeColor } from './types.scrml'.
    expect(c.components.clientJs).toMatch(
      /const \{ UserRole, badgeColor \} = _scrml_modules\["types\.client\.js"\];/,
    );
  });
});
