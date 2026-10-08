/**
 * S459 — the host-global alias (`_scrml_g`, S457 ruling 2a) meets the runtime `^{}` executed-text
 * boundary (§22.12, #1359 codegen/meta-capture-rewrite.ts).
 *
 * The boundary admits a free `_scrml_*` name because the reserved prefix (§47.1.1) names fixed
 * compiler helpers no author can spell. `_scrml_g` is not a helper: it IS the global object, and
 * compiler lowerings spell their host-global reads through it. Admitting it by prefix would let any
 * lowering that reaches a host global inside a runtime `^{}` body pass the boundary that, before the
 * alias, refused the same read spelled bare. So `_scrml_g.<name>` is judged as `<name>`, and a bare
 * or computed `_scrml_g` as `globalThis`.
 *
 * Measured at merge time (main 49b7fcc1d vs the alias branch): samples/compilation-tests/
 * gauntlet-s20-meta/meta-lift-006.scrml — `lift <p>…</>` inside `^{}` — reports E-META-006 +
 * E-META-001 ("reads 'document'") on main; with the alias admitted by prefix it reported only
 * E-META-006 (the lift lowering's `_scrml_g.document.createElement` passed the boundary).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { rewriteMetaBodyCaptures } from "../../src/codegen/meta-capture-rewrite.ts";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/s459-meta-alias-boundary");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  return { codes: errors.map((e) => e.code), messages: errors.map((e) => e.message) };
}

describe("meta-capture-rewrite: `_scrml_g` is the global object, not a helper", () => {
  test("`_scrml_g.<name>` is refused as the host global `<name>`", () => {
    const r = rewriteMetaBodyCaptures(`const p = _scrml_g.document.createElement("p");`, new Set(), false);
    expect(r.ok).toBe(false);
    expect(r.refused).toEqual(["document"]);
  });

  test("a call through the alias is refused under the global's own name", () => {
    const r = rewriteMetaBodyCaptures(`_scrml_g.fetch("/x");`, new Set(), false);
    expect(r.ok).toBe(false);
    expect(r.refused).toEqual(["fetch"]);
  });

  test("a bare `_scrml_g` (the object itself, passed as a value) is refused as globalThis", () => {
    const r = rewriteMetaBodyCaptures(`const g = _scrml_g;`, new Set(), false);
    expect(r.ok).toBe(false);
    expect(r.refused).toEqual(["globalThis"]);
  });

  test("a computed member on the alias is refused as globalThis (its key is a value)", () => {
    const r = rewriteMetaBodyCaptures(`const k = "fetch"; _scrml_g[k]("/x");`, new Set(), false);
    expect(r.ok).toBe(false);
    expect(r.refused).toEqual(["globalThis"]);
  });

  test("a fixed runtime helper (`_scrml_*`) is still admitted", () => {
    const r = rewriteMetaBodyCaptures(`_scrml_reactive_set("x", 1); meta.emit("<p>ok</p>");`, new Set(), false);
    expect(r.ok).toBe(true);
  });

  test("a member read on a helper's RESULT is not the alias (no false refusal)", () => {
    const r = rewriteMetaBodyCaptures(`const v = _scrml_reactive_get("x").length;`, new Set(), false);
    expect(r.ok).toBe(true);
  });
});

describe("parity with main: a lowering's host-global read inside a runtime ^{} is still E-META-001", () => {
  test("lift inside ^{} reports E-META-006 AND E-META-001 reads 'document' (as on main 49b7fcc1d)", () => {
    const r = compile(`<program>\n<div>\n  ^{\n    lift <p>This should be illegal</>\n  }\n</div>\n</program>\n`);
    expect(r.codes).toContain("E-META-006");
    expect(r.codes).toContain("E-META-001");
    const m001 = r.messages.find((m) => m.startsWith("E-META-001"));
    expect(m001).toContain("reads 'document'");
  });
});
