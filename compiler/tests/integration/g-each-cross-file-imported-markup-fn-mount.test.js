/**
 * g-each-nested-markup-interp-stringifies — residual (2): cross-file IMPORTED
 * markup fns. | §1.4/§7.4 markup-as-value
 *
 * A nested `<each>` interp of a call to a markup-returning fn mounts the returned
 * DOM node (`<span data-scrml-mv>` wrapper, GH #161). The detector
 * `collectMarkupReturningFnNames` was SAME-FILE only, so an IMPORTED `badge`
 * used as `${badge(it.name)}` emitted `textContent = String(badge(...))` →
 * `[object HTMLSpanElement]`. Silent, clean compile.
 *
 * FIX (S367): the markup-return scan moved to the shared `markup-return-scan.js`;
 * module-resolver.js runs it per module and flags each markup-returning export
 * with `returnsMarkup:true` on its export-registry entry. Codegen seeds the
 * per-file markup-fn set with the imported names carrying that flag (resolved via
 * ctx.importGraph) BEFORE the transitive fixpoint, so a cross-file
 * `${badge(it)}` — and a local wrapper of an imported markup fn — mounts.
 * Fail-safe: an imported STRING-returning fn is never flagged, so it stays a
 * text node (never over-wrapped → restricted-parent safe).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const D = "$";
let ROOT;

beforeEach(() => { ROOT = mkdtempSync(join(tmpdir(), "scrml-xfile-markup-")); });
afterEach(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

// Write a `badges.scrml` module + an `app.scrml` entry, compile the entry
// (auto-gather pulls in the import), return the emitted app client JS.
function compileApp(badgesSrc, appSrc) {
  writeFileSync(join(ROOT, "badges.scrml"), badgesSrc);
  const app = join(ROOT, "app.scrml");
  writeFileSync(app, appSrc);
  const outDir = join(ROOT, "dist");
  const result = compileScrml({ inputFiles: [app], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const js = readFileSync(join(outDir, "app.client.js"), "utf8");
  return { errors: errors.map((e) => e.code), js };
}

const BADGES = `${D}{
  export fn badge(n: string) { return <span class="b">${D}{n}</span> }
  export fn plain(n: string) { return "hi " + n }
}
`;

function appUsing(interpBody, importClause = "badge, plain") {
  return `<program>
${D}{
  import { ${importClause} } from './badges.scrml'
}
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<ul>
  <each in=@rows as it key=it.id>
    <li>${interpBody}</li>
  </each>
</ul>
</program>
`;
}

describe("g-each cross-file imported markup fn — mounts (not String())", () => {
  test("imported markup fn `${badge(it.name)}` MOUNTS via the instanceof-Node wrapper", () => {
    const { errors, js } = compileApp(BADGES, appUsing(`${D}{badge(it.name)}`));
    expect(errors).toEqual([]);
    // mounted: built into a `_scrml_mv_v_N = ( badge(...) )` + instanceof Node guard
    expect(js).toMatch(/_scrml_mv_v_\d+ = \(\s*badge\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
    // NOT stringified
    expect(js).not.toMatch(/textContent = String\(\s*badge\s*\(/);
  });

  test("FAIL-SAFE: imported STRING fn `${plain(it.name)}` stays a text node", () => {
    const { errors, js } = compileApp(BADGES, appUsing(`${D}{plain(it.name)}`));
    expect(errors).toEqual([]);
    // string-returning import must NOT be wrapped as a markup value
    expect(js).not.toMatch(/_scrml_mv_v_\d+ = \(\s*plain\s*\(/);
    expect(js).toMatch(/String\(\s*plain\s*\(/);
  });

  test("renamed import `{ badge as b }` — `${b(it.name)}` MOUNTS (local-name resolution)", () => {
    const { errors, js } = compileApp(BADGES, appUsing(`${D}{b(it.name)}`, "badge as b, plain"));
    expect(errors).toEqual([]);
    expect(js).toMatch(/_scrml_mv_v_\d+ = \(\s*b\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
    expect(js).not.toMatch(/textContent = String\(\s*b\s*\(/);
  });

  test("local wrapper of an imported markup fn closes via the seeded fixpoint", () => {
    const appSrc = `<program>
${D}{
  import { badge } from './badges.scrml'
}
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn localWrap(n: string) { return badge(n) }
<ul>
  <each in=@rows as it key=it.id>
    <li>${D}{localWrap(it.name)}</li>
  </each>
</ul>
</program>
`;
    const { errors, js } = compileApp(BADGES, appSrc);
    expect(errors).toEqual([]);
    // a same-file fn is name-mangled to `_scrml_localWrap_N`
    expect(js).toMatch(/_scrml_mv_v_\d+ = \(\s*_scrml_localWrap_\d+\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
    expect(js).not.toMatch(/textContent = String\(\s*_scrml_localWrap_\d+\s*\(/);
  });

  test("exported WRAPPER of an imported markup fn mounts downstream (cross-module fixpoint)", () => {
    // badges.scrml -> wrap.scrml (import badge; export wrap = badge(n)) -> app.scrml (${wrap(it)})
    writeFileSync(join(ROOT, "badges.scrml"), BADGES);
    writeFileSync(
      join(ROOT, "wrap.scrml"),
      `${D}{\n  import { badge } from "./badges.scrml"\n  export fn wrap(n: string) { return badge(n) }\n}\n`,
    );
    const app = join(ROOT, "app.scrml");
    writeFileSync(app, `<program>
${D}{
  import { wrap } from './wrap.scrml'
}
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<ul><each in=@rows as it key=it.id><li>${D}{wrap(it.name)}</li></each></ul>
</program>
`);
    const outDir = join(ROOT, "distw");
    const result = compileScrml({ inputFiles: [app], outputDir: outDir, write: true, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const js = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toMatch(/_scrml_mv_v_\d+ = \(\s*wrap\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
    expect(js).not.toMatch(/textContent = String\(\s*wrap\s*\(/);
  });

  test("N-hop chain of exported wrappers closes (badge -> wrap -> wrap2)", () => {
    writeFileSync(join(ROOT, "badges.scrml"), BADGES);
    writeFileSync(
      join(ROOT, "wrap.scrml"),
      `${D}{\n  import { badge } from "./badges.scrml"\n  export fn wrap(n: string) { return badge(n) }\n}\n`,
    );
    writeFileSync(
      join(ROOT, "wrap2.scrml"),
      `${D}{\n  import { wrap } from "./wrap.scrml"\n  export fn wrap2(n: string) { return wrap(n) }\n}\n`,
    );
    const app = join(ROOT, "app.scrml");
    writeFileSync(app, `<program>
${D}{
  import { wrap2 } from './wrap2.scrml'
}
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<ul><each in=@rows as it key=it.id><li>${D}{wrap2(it.name)}</li></each></ul>
</program>
`);
    const outDir = join(ROOT, "distn");
    const result = compileScrml({ inputFiles: [app], outputDir: outDir, write: true, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const js = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toMatch(/_scrml_mv_v_\d+ = \(\s*wrap2\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
  });

  test("direct consumption of a NAMED-RE-EXPORTED markup fn mounts (barrel -> app)", () => {
    // badges -> barrel (export { badge } from) -> app imports badge from barrel.
    writeFileSync(join(ROOT, "badges.scrml"), BADGES);
    writeFileSync(join(ROOT, "barrel.scrml"), `${D}{\n  export { badge } from "./badges.scrml"\n}\n`);
    const app = join(ROOT, "app.scrml");
    writeFileSync(app, `<program>
${D}{
  import { badge } from './barrel.scrml'
}
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<ul><each in=@rows as it key=it.id><li>${D}{badge(it.name)}</li></each></ul>
</program>
`);
    const outDir = join(ROOT, "distre");
    const result = compileScrml({ inputFiles: [app], outputDir: outDir, write: true, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const js = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toMatch(/_scrml_mv_v_\d+ = \(\s*badge\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
  });

  test("FAIL-SAFE: a NESTED markup fn does not falsely flag a same-named string EXPORT", () => {
    // badges exports a STRING `badge`, and a DIFFERENT fn contains a nested markup
    // `fn badge` — the collector must not let the nested one flag the export.
    writeFileSync(
      join(ROOT, "badges.scrml"),
      `${D}{\n  export fn badge(n: string) { return "plain " + n }\n  export fn other(n: string) {\n    fn badge(x: string) { return <b>${D}{x}</b> }\n    return badge(n)\n  }\n}\n`,
    );
    const app = join(ROOT, "app.scrml");
    writeFileSync(app, appUsing(`${D}{badge(it.name)}`, "badge"));
    const outDir = join(ROOT, "distc");
    const result = compileScrml({ inputFiles: [app], outputDir: outDir, write: true, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const js = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(errors.map((e) => e.code)).toEqual([]);
    // the imported EXPORT badge returns a string -> stays text, NOT mounted
    expect(js).toMatch(/String\(\s*badge\s*\(/);
    expect(js).not.toMatch(/_scrml_mv_v_\d+ = \(\s*badge\s*\(/);
  });

  test("REGRESSION GATE: a SAME-FILE markup fn still mounts (refactor to shared util)", () => {
    const appSrc = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn sameFileBadge(n: string) { return <span class="s">${D}{n}</span> }
<ul>
  <each in=@rows as it key=it.id>
    <li>${D}{sameFileBadge(it.name)}</li>
  </each>
</ul>
</program>
`;
    writeFileSync(join(ROOT, "solo.scrml"), appSrc);
    const outDir = join(ROOT, "dist2");
    const result = compileScrml({ inputFiles: [join(ROOT, "solo.scrml")], outputDir: outDir, write: true, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const js = readFileSync(join(outDir, "solo.client.js"), "utf8");
    expect(errors.map((e) => e.code)).toEqual([]);
    // same-file fn is name-mangled to `_scrml_sameFileBadge_N`
    expect(js).toMatch(/_scrml_mv_v_\d+ = \(\s*_scrml_sameFileBadge_\d+\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
  });
});
