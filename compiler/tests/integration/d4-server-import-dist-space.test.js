/**
 * d4-server-import-dist-space.test.js — D-4 (S296), end-to-end lock.
 *
 * THE ADOPTER-BLOCKING BUG. A `.scrml` file under `pages/` that server-imports
 * another local `.scrml` module emitted its import specifier in SOURCE
 * coordinate space. The dist tree strips a leading `pages/` segment (SPEC
 * §47.9.5 — `pages/customer/home.scrml` -> `dist/customer/home.html`), so the
 * specifier overshot by exactly that one segment and the emitted `.server.js`
 * threw `Cannot find module` at runtime — on a compile that exited 0 with zero
 * errors. The CLIENT half was already correct at every depth
 * (`emit-client-esm.ts` strips both sides), so this was server-only.
 *
 * The bug was not academic: on `main` @ `89db7981`, 20 of the 36 routes in
 * `examples/23-trucking-dispatch/` — the canonical multi-file example app —
 * emitted a `.server.js` that could not be imported.
 *
 * Two changes are locked here:
 *   (1) `emit-server.ts` `distRelativeServerSpecifier` — re-base the emitted
 *       specifier into the post-strip dist space (pure-function locks live in
 *       `compiler/tests/unit/d4-dist-relative-server-specifier.test.js`).
 *   (2) `api.js` `serverImportTargetSource` — reverse a DIST-space specifier
 *       through a forward dist-key index in BOTH consumers
 *       (`checkServerImportInvariant` and, critically,
 *       `emitValueOnlyServerJsForDanglingImports`). Without (2), (1) alone
 *       trades one broken shape for another: the value-only `.server.js` stops
 *       being emitted for a `pages/` importer AND `W-SERVER-IMPORT-UNEMITTED`
 *       goes silent on a genuine dangler. §3 and §4 are those locks.
 *
 * SPEC anchors: §47.9.5 (leading `pages/` strip), §47.9.2 (filesystem-inferred
 * routes), §40 (imports), §34 (`W-SERVER-IMPORT-UNEMITTED`).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve as pathResolve } from "path";
import { pathToFileURL } from "url";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "d4-server-import-dist-space-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function fx(absPath, source) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, source);
  return absPath;
}

function compileAll(dir, files) {
  const outDir = join(dir, "out");
  const result = compileScrml({ inputFiles: files, outputDir: outDir, write: true, log: () => {} });
  return { result, outDir };
}

// Every relative import specifier in every emitted `.server.js` under `root`.
function serverImportsUnder(root) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith(".server.js")) continue;
      const src = readFileSync(p, "utf8");
      const re = /^\s*import\s+[^;]*?\s*from\s*["'](\.\.?\/[^"']+)["']/gm;
      let m;
      while ((m = re.exec(src))) out.push({ file: p, spec: m[1] });
    }
  };
  walk(root);
  return out;
}

const specifiersIn = (file) =>
  [...readFileSync(file, "utf8").matchAll(/^\s*import\s+[^;]*?\s*from\s*["'](\.\.?\/[^"']+)["']/gm)]
    .map((m) => m[1]);

const AUTH_MODULE = `\${
    export const ROLE_PATRON = "patron"

    export fn rolePath(role) {
        if (role == ROLE_PATRON) return "/patron"
        return "/"
    }
}
`;

// ---------------------------------------------------------------------------
// §1 — the reproducer, verbatim: root control + depth-1 page + depth-2 page.
// ---------------------------------------------------------------------------
describe("D-4 §1: a `pages/` project emits DIST-space server import specifiers", () => {
  let outDir, result;
  beforeAll(() => {
    const dir = join(TMP, "pages-project");
    const files = [
      fx(join(dir, "models/auth.scrml"), AUTH_MODULE),
      // The CONTROL — a root-level importer. Worked before the fix; must not move.
      fx(join(dir, "app.scrml"), `<program auth="optional">
\${
  import { rolePath, ROLE_PATRON } from './models/auth.scrml'
  server fn homeFor() { return rolePath(ROLE_PATRON) }
}
<h1>home</h1>
</program>
`),
      // depth-1: dist path is `login.server.js` (the `pages/` segment is stripped).
      fx(join(dir, "pages/login.scrml"), `<page auth="optional">
\${
  import { rolePath, ROLE_PATRON } from '../models/auth.scrml'
  server fn resolveHome() { return rolePath(ROLE_PATRON) }
}
<h1>login</h1>
</page>
`),
      // depth-2: dist path is `auth/deep.server.js`.
      fx(join(dir, "pages/auth/deep.scrml"), `<page auth="optional">
\${
  import { rolePath, ROLE_PATRON } from '../../models/auth.scrml'
  server fn resolveDeep() { return rolePath(ROLE_PATRON) }
}
<h1>deep</h1>
</page>
`),
    ];
    ({ result, outDir } = compileAll(dir, files));
  });

  test("the compile is clean (the bug shipped a GREEN compile — that is the trap)", () => {
    expect(result.errors.filter((e) => e.severity !== "warning").length).toBe(0);
  });

  test("the dist layout strips `pages/` (§47.9.5) — the premise of the whole fix", () => {
    expect(existsSync(join(outDir, "login.server.js"))).toBe(true);
    expect(existsSync(join(outDir, "auth/deep.server.js"))).toBe(true);
    expect(existsSync(join(outDir, "models/auth.server.js"))).toBe(true);
    // NOT under a `pages/` dir — if this ever changes, the specifiers below must too.
    expect(existsSync(join(outDir, "pages"))).toBe(false);
  });

  test("CONTROL — the root importer is unchanged: ./models/auth.server.js", () => {
    expect(specifiersIn(join(outDir, "app.server.js"))).toContain("./models/auth.server.js");
  });

  test("depth-1 page emits ./models/auth.server.js (was ../models/… — above dist/)", () => {
    const specs = specifiersIn(join(outDir, "login.server.js"));
    expect(specs).toContain("./models/auth.server.js");
    expect(specs).not.toContain("../models/auth.server.js");
  });

  test("depth-2 page emits ../models/auth.server.js (was ../../models/…)", () => {
    const specs = specifiersIn(join(outDir, "auth/deep.server.js"));
    expect(specs).toContain("../models/auth.server.js");
    expect(specs).not.toContain("../../models/auth.server.js");
  });

  test("EVERY relative import in EVERY emitted .server.js resolves ON DISK", () => {
    // The invariant that actually matters — a shape assertion can be satisfied by
    // a wrong-but-consistent path; this cannot.
    const dangling = serverImportsUnder(outDir).filter(
      ({ file, spec }) => !existsSync(pathResolve(dirname(file), spec)),
    );
    expect(dangling).toEqual([]);
  });

  test("the emitted bundles actually IMPORT at runtime (no Cannot-find-module)", async () => {
    // The failure mode was a RUNTIME module-resolution error on a green compile,
    // so the only honest lock is to load them.
    await import(pathToFileURL(join(outDir, "login.server.js")).href);
    await import(pathToFileURL(join(outDir, "auth/deep.server.js")).href);
    await import(pathToFileURL(join(outDir, "app.server.js")).href);
  });
});

// ---------------------------------------------------------------------------
// §2 — a project with NO `pages/` segment must be byte-identical to pre-fix.
// ---------------------------------------------------------------------------
describe("D-4 §2: no `pages/` segment — output identical to the pre-fix emit", () => {
  let outDir;
  beforeAll(() => {
    const dir = join(TMP, "no-pages-project");
    const files = [
      fx(join(dir, "models/auth.scrml"), AUTH_MODULE),
      fx(join(dir, "app.scrml"), `<program auth="optional">
\${
  import { rolePath, ROLE_PATRON } from './models/auth.scrml'
  server fn homeFor() { return rolePath(ROLE_PATRON) }
}
<h1>home</h1>
</program>
`),
      // `sub/` is an ordinary directory — NOT `pages/`, so nothing is stripped and
      // the dist tree mirrors the source tree exactly.
      fx(join(dir, "sub/detail.scrml"), `<page auth="optional">
\${
  import { rolePath, ROLE_PATRON } from '../models/auth.scrml'
  server fn resolveDetail() { return rolePath(ROLE_PATRON) }
}
<h1>detail</h1>
</page>
`),
      fx(join(dir, "sub/deeper/more.scrml"), `<page auth="optional">
\${
  import { rolePath, ROLE_PATRON } from '../../models/auth.scrml'
  server fn resolveMore() { return rolePath(ROLE_PATRON) }
}
<h1>more</h1>
</page>
`),
    ];
    ({ outDir } = compileAll(dir, files));
  });

  test("each specifier equals the plain source-space extension swap (= the pre-fix bytes)", () => {
    // Source `./models/auth.scrml` -> `./models/auth.server.js`, etc. These ARE
    // the pre-fix outputs by construction, so this is the byte-identity lock.
    expect(specifiersIn(join(outDir, "app.server.js"))).toContain("./models/auth.server.js");
    expect(specifiersIn(join(outDir, "sub/detail.server.js"))).toContain("../models/auth.server.js");
    expect(specifiersIn(join(outDir, "sub/deeper/more.server.js"))).toContain("../../models/auth.server.js");
  });

  test("the dist tree mirrors the source tree (no strip applied)", () => {
    expect(existsSync(join(outDir, "sub/detail.server.js"))).toBe(true);
    expect(existsSync(join(outDir, "sub/deeper/more.server.js"))).toBe(true);
  });

  test("everything still resolves on disk", () => {
    const dangling = serverImportsUnder(outDir).filter(
      ({ file, spec }) => !existsSync(pathResolve(dirname(file), spec)),
    );
    expect(dangling).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 — api.js part (2), the value-only `.server.js` seam.
//
// `emitValueOnlyServerJsForDanglingImports` materializes a minimal `.server.js`
// for a CONST-ONLY module that is server-imported by name. It finds its target by
// reversing the emitted specifier. With emit-server fixed but that reversal left
// in SOURCE space, a `pages/` importer's target resolves to a path that does not
// exist -> no value-only emission -> `Cannot find module`, and silently, because
// the guard mis-resolves identically and treats the target as external.
// ---------------------------------------------------------------------------
describe("D-4 §3: const-only module server-imported from a `pages/` file", () => {
  let outDir, result;
  beforeAll(() => {
    const dir = join(TMP, "value-only");
    const files = [
      fx(join(dir, "models/consts.scrml"), `\${\n    export const APP_NAME = "venue"\n}\n`),
      fx(join(dir, "app.scrml"), `<program auth="optional">\n<h1>shell</h1>\n</program>\n`),
      fx(join(dir, "pages/login.scrml"), `<page auth="optional">
\${
  import { APP_NAME } from '../models/consts.scrml'
  server fn brandName() { return APP_NAME }
}
<h1>login</h1>
</page>
`),
    ];
    ({ result, outDir } = compileAll(dir, files));
  });

  test("the value-only .server.js IS emitted and exports the imported name", () => {
    const modServer = join(outDir, "models/consts.server.js");
    expect(existsSync(modServer)).toBe(true);
    expect(readFileSync(modServer, "utf8")).toMatch(/export\s+const\s+APP_NAME\b/);
  });

  test("the importer names it in DIST space and it resolves", () => {
    const login = join(outDir, "login.server.js");
    expect(specifiersIn(login)).toContain("./models/consts.server.js");
    expect(existsSync(join(outDir, "models/consts.server.js"))).toBe(true);
  });

  test("W-SERVER-IMPORT-UNEMITTED does NOT false-fire (the import is genuinely fine)", () => {
    expect(result.warnings.some((w) => w.code === "W-SERVER-IMPORT-UNEMITTED")).toBe(false);
  });

  test("the bundle imports at runtime", async () => {
    await import(pathToFileURL(join(outDir, "login.server.js")).href);
  });
});

// ---------------------------------------------------------------------------
// §4 — api.js part (2), the guard must still BITE from a `pages/` importer.
//
// A TYPE-only module has no server-importable value export, so nothing can be
// emitted for it and the by-name server import is genuinely unresolvable — the
// MISSING-FILE branch. With emit-server fixed and the reversal left in SOURCE
// space, this warning goes SILENT (verified by hand against a part-1-only build).
// ---------------------------------------------------------------------------
describe("D-4 §4: the W-SERVER-IMPORT-UNEMITTED gate still bites for a `pages/` importer", () => {
  test("fires on a genuinely-dangling import, naming the DIST-space specifier", () => {
    const dir = join(TMP, "guard-bites");
    const files = [
      fx(join(dir, "models/kinds.scrml"), `\${\n    export type Kind:enum = { Alpha, Beta }\n}\n`),
      fx(join(dir, "app.scrml"), `<program auth="optional">\n<h1>shell</h1>\n</program>\n`),
      fx(join(dir, "pages/login.scrml"), `<page auth="optional">
\${
  import { Kind } from '../models/kinds.scrml'
  server fn firstKind() { return Kind.Alpha }
}
<h1>login</h1>
</page>
`),
    ];
    const { result } = compileAll(dir, files);
    const w = result.warnings.filter((x) => x.code === "W-SERVER-IMPORT-UNEMITTED");
    expect(w.length).toBeGreaterThan(0);
    // The message must quote the specifier the emitter ACTUALLY wrote, or it
    // sends the author looking at the wrong line.
    expect(w[0].message).toContain("./models/kinds.server.js");
    // Non-fatal: it partitions into warnings, so the build still exits 0.
    expect(result.errors.filter((e) => e.severity !== "warning").length).toBe(0);
  });

  test("and goes green once the module gains a server-importable value export", () => {
    const dir = join(TMP, "guard-restored");
    const files = [
      fx(join(dir, "models/kinds.scrml"), `\${
    export type Kind:enum = { Alpha, Beta }

    export const DEFAULT_KIND = "Alpha"
}
`),
      fx(join(dir, "app.scrml"), `<program auth="optional">\n<h1>shell</h1>\n</program>\n`),
      fx(join(dir, "pages/login.scrml"), `<page auth="optional">
\${
  import { DEFAULT_KIND } from '../models/kinds.scrml'
  server fn firstKind() { return DEFAULT_KIND }
}
<h1>login</h1>
</page>
`),
    ];
    const { result, outDir } = compileAll(dir, files);
    expect(result.warnings.some((x) => x.code === "W-SERVER-IMPORT-UNEMITTED")).toBe(false);
    expect(existsSync(join(outDir, "models/kinds.server.js"))).toBe(true);
    expect(specifiersIn(join(outDir, "login.server.js"))).toContain("./models/kinds.server.js");
  });
});
