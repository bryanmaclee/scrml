/**
 * g-static-component-import-dead-destructure.test.js — importing a purely-static
 * component must NOT emit a client-side `const { X } = _scrml_modules[...]`
 * destructure the dep module can never satisfy.
 *
 * A cross-file component (`export const SideNav = <aside>…`) is inlined into the
 * markup at mount by CE — its `<aside>` lands in the server HTML — so the dep
 * `.client.js` registers NO client-side JS binding for it (its footer is `{}`).
 * The consumer was emitting `const { SideNav } = _scrml_modules["…side.client.js"]`
 * anyway: dead code that reads `undefined` in a flat layout, but a page-killing
 * `const { SideNav } = undefined` TypeError the moment the dep <script> is absent
 * (the composition dep-script strip). Reported by scrml-site (66 of 74 reference
 * pages threw); their whole build was screenshot-perfect, exit 0.
 *
 * Fix (`emit-client.ts`): drop import specifiers that resolve to a user COMPONENT,
 * using the same `exportIsUserComponent` predicate CE uses to decide inlining
 * (so the consumer skip and the CE inline cannot drift). Non-component exports
 * (functions / values / enums, incl. helpers CE hoists onto a component import)
 * keep their binding.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as acornParse } from "acorn";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/g-static-comp-import");

beforeAll(() => { if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compile(files) {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  const inputs = [];
  for (const [rel, src] of Object.entries(files)) {
    const p = join(FIXTURE_DIR, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, src);
    inputs.push(p);
  }
  const outDir = join(FIXTURE_DIR, "dist");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  compileScrml({ inputFiles: inputs, outputDir: outDir, write: true, log: () => {} });
  const read = (suffix) => {
    let hit = "";
    (function walk(dir) {
      if (!existsSync(dir)) return;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const fp = join(dir, ent.name);
        if (ent.isDirectory()) walk(fp);
        else if (ent.name.endsWith(suffix)) hit = readFileSync(fp, "utf-8");
      }
    })(outDir);
    return hit;
  };
  return { page: read("page.client.js"), html: read("page.html") };
}

describe("g-static-component-import: a purely-static component import emits no dead destructure", () => {
  const out = compile({
    "components/side.scrml": `\${ export const SideNav = <aside class="x">nav</aside> }\n`,
    "page.scrml": `<program>\n\${ import { SideNav } from "./components/side.scrml" }\n<div><SideNav/><p>body</p></div>\n</program>\n`,
  });

  test("no `const { SideNav } = _scrml_modules[...]` destructure is emitted", () => {
    expect(out.page).toBeTruthy();
    expect(out.page).not.toMatch(/const \{[^}]*SideNav[^}]*\} = _scrml_modules/);
    // The whole registry read is elided (SideNav was the only import).
    expect(out.page).not.toMatch(/_scrml_modules\[[^\]]*side\.client\.js[^\]]*\]/);
  });

  test("the component markup is still inlined into the server HTML", () => {
    expect(out.html).toMatch(/<aside[^>]*data-scrml="SideNav"[^>]*class="x"/);
  });

  test("the emitted client JS is valid (no `const {} = undefined` shape)", () => {
    expect(() => acornParse(out.page, { ecmaVersion: 2024, sourceType: "script" })).not.toThrow();
  });
});

describe("g-static-component-import: non-component imports are NOT dropped", () => {
  // A component whose body calls a helper, imported alongside a value/function.
  const out = compile({
    "components/lib.scrml": `\${\n  export function fmt(x) { return "v" + x }\n  export const Badge = <span class="b">\${fmt(1)}</span>\n}\n`,
    "page.scrml": `<program>\n\${\n  import { fmt, Badge } from "./components/lib.scrml"\n  @out = fmt(2)\n}\n<div><Badge/><p>\${@out}</p></div>\n</program>\n`,
  });

  test("the function helper keeps its `_scrml_modules` binding; the component is dropped", () => {
    // `fmt` (function, has a client binding) is destructured…
    expect(out.page).toMatch(/const \{[^}]*\bfmt\b[^}]*\} = _scrml_modules\[[^\]]*lib\.client\.js[^\]]*\]/);
    // …but the component `Badge` is not.
    expect(out.page).not.toMatch(/const \{[^}]*\bBadge\b[^}]*\} = _scrml_modules/);
    expect(() => acornParse(out.page, { ecmaVersion: 2024, sourceType: "script" })).not.toThrow();
  });
});
