/**
 * render-by-tag-nested-compound-bug60.test.js — regression test for Bug 60.
 *
 * Filed S157. A nested compound-field render-by-tag use-site
 * (`<userName/>` inside a `<signupForm>...</signupForm>` compound wrapper)
 * emitted the tags VERBATIM as browser-ignored literal markup, the bound
 * `<input>` never rendered, and a spurious E-DG-002 ("@signupForm declared but
 * never consumed") fired.
 *
 * Root cause: emit-html.ts render-by-tag expansion resolved the BARE leaf tag
 * (`userName`) via lookupStateCell, which only walks the parent-chain
 * `s.stateCells.get(name)` — it never descends into a compound parent's
 * `_scope`. Nested fields resolve ONLY via lookupQualifiedStateCell, which the
 * emitter never called (and tracked no enclosing-compound context). So
 * `decl === null` → the bindable guard failed → literal-tag fallthrough.
 *
 * Fix (SPEC §6.3.5:2209 + §6.4.2):
 *   1. emit-html.ts tracks an `enclosingCompoundStack`. A BLOCK-form
 *      `<signupForm>...</>` whose tag is a registered compound-parent is a
 *      TRANSPARENT namespace wrapper (no render-spec → no DOM element of its
 *      own); it pushes its name for the child walk.
 *   2. A nested `<field/>` self-tag whose bare lookup fails resolves via
 *      lookupQualifiedStateCell(fileScope, [enclosing, tag]) → the qualified
 *      leaf record; reuses the SAME top-level Shape-2 expansion path keyed on
 *      the record's `qualifiedPath` (`signupForm.userName`).
 *   3. dependency-graph.ts credits render-by-tag use sites (tag matching a
 *      declared reactive var) as structural reads → E-DG-002 no longer fires
 *      on the consumed compound (or on a top-level render-by-tag-only cell).
 *
 * Note: E-DG-002 has severity "warning" → it lands in `result.warnings`, NOT
 * `result.errors` (the diagnostic-stream partition). Assertions check the
 * correct stream.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/bug-60");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileSource(name, src) {
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + Math.random().toString(36).slice(2, 8));
  const result = compileScrml({
    inputFiles: [inputPath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  let clientJs = "";
  let html = "";
  let clientJsPath = "";
  function findFiles(dir) {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) findFiles(p);
      else if (ent.name.endsWith(".client.js")) { clientJs = readFileSync(p, "utf-8"); clientJsPath = p; }
      else if (ent.name.endsWith(".html")) html = readFileSync(p, "utf-8");
    }
  }
  findFiles(outDir);
  return {
    clientJs,
    clientJsPath,
    html,
    errors: result?.errors ?? [],
    warnings: result?.warnings ?? [],
  };
}

// Cross-stream helper — a diagnostic may land in errors OR warnings depending
// on severity. E-DG-002 is severity "warning" → warnings. Checking only
// `errors` would silently pass (false-negative). See diagnostic-stream memory.
function hasCode(res, code) {
  return [...(res.errors ?? []), ...(res.warnings ?? [])].some((d) => d.code === code);
}

// ---------------------------------------------------------------------------
// §1: Nested compound-field render-by-tag expands to bound inputs
// ---------------------------------------------------------------------------

describe("Bug 60 §1: nested compound-field render-by-tag (text + email)", () => {
  const SRC =
    `<signupForm>\n` +
    `    <userName req length(>=2)>          = <input type="text"/>\n` +
    `    <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>\n` +
    `</>\n\n` +
    `<div>\n` +
    `  <signupForm>\n` +
    `    <userName/>\n` +
    `    <email/>\n` +
    `  </signupForm>\n` +
    `</div>\n`;

  test("both nested fields expand to bound inputs with correct type", () => {
    const { html } = compileSource("nested-text-email.scrml", SRC);
    // userName → <input type="text">
    expect(html).toMatch(/<input[^>]*type="text"/);
    // email → <input type="email">
    expect(html).toMatch(/<input[^>]*type="email"/);
    // render-by-tag hookpoints present (one per field).
    const hookCount = (html.match(/data-scrml-render-by-tag=/g) ?? []).length;
    expect(hookCount).toBe(2);
  });

  test("validators lower to HTML-native attributes", () => {
    const { html } = compileSource("nested-validators.scrml", SRC);
    // req → required ; length(>=2) → minlength="2".
    expect(html).toMatch(/required/);
    expect(html).toMatch(/minlength="2"/);
  });

  test("ZERO literal compound/field tags survive in HTML", () => {
    const { html } = compileSource("nested-no-literal.scrml", SRC);
    expect(html).not.toMatch(/<signupForm/);
    expect(html).not.toMatch(/<userName/);
    expect(html).not.toMatch(/<email\b/);
  });

  test("bind wiring keys on the QUALIFIED runtime cell (signupForm.userName/.email)", () => {
    const { clientJs } = compileSource("nested-bind-keys.scrml", SRC);
    // The render-by-tag bind dispatch reads/writes the dotted runtime cell.
    expect(clientJs).toMatch(/_scrml_reactive_get\("signupForm\.userName"\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("signupForm\.userName",/);
    expect(clientJs).toMatch(/_scrml_reactive_get\("signupForm\.email"\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("signupForm\.email",/);
    // The input event listener drives the write-back.
    expect(clientJs).toMatch(/addEventListener\("input"/);
  });

  test("emitted client.js is valid JS (node --check)", () => {
    const { clientJsPath } = compileSource("nested-node-check.scrml", SRC);
    expect(clientJsPath.length).toBeGreaterThan(0);
    // node --check throws (non-zero exit) on a parse error.
    expect(() => execFileSync("node", ["--check", clientJsPath])).not.toThrow();
  });

  test("no spurious E-DG-002 on the consumed compound (@signupForm)", () => {
    const res = compileSource("nested-no-edg002.scrml", SRC);
    expect(hasCode(res, "E-DG-002")).toBe(false);
    // No fatal errors either.
    expect(res.errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2: Nested checkbox field — bind:checked dispatch via render-by-tag
// ---------------------------------------------------------------------------

describe("Bug 60 §2: nested compound checkbox field", () => {
  const SRC =
    `<prefs>\n` +
    `    <newsletter> = <input type="checkbox"/>\n` +
    `</>\n\n` +
    `<div>\n` +
    `  <prefs>\n` +
    `    <newsletter/>\n` +
    `  </prefs>\n` +
    `</div>\n`;

  test("checkbox nested field expands to <input type=checkbox> bound checked", () => {
    const { html, clientJs } = compileSource("nested-checkbox.scrml", SRC);
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toMatch(/data-scrml-render-by-tag=/);
    expect(html).not.toMatch(/<newsletter/);
    expect(html).not.toMatch(/<prefs/);
    // bind:checked dispatch — keys on the qualified cell.
    expect(clientJs).toMatch(/_scrml_reactive_get\("prefs\.newsletter"\)/);
    expect(clientJs).toMatch(/\.checked = _scrml_reactive_get\("prefs\.newsletter"\)/);
  });
});

// ---------------------------------------------------------------------------
// §3: NEGATIVE no-regression — top-level Shape-2 render-by-tag unchanged
// ---------------------------------------------------------------------------

describe("Bug 60 §3: top-level Shape-2 render-by-tag no-regression", () => {
  const SRC =
    `<userName req length(>=2)> = <input type="text"/>\n\n` +
    `<div>\n` +
    `  <userName/>\n` +
    `</div>\n`;

  test("top-level <userName/> still expands to the bound input identically", () => {
    const { html, clientJs, errors } = compileSource("toplevel-control.scrml", SRC);
    expect(errors.length).toBe(0);
    expect(html).toMatch(/<input[^>]*type="text"/);
    expect(html).toMatch(/required/);
    expect(html).toMatch(/minlength="2"/);
    expect(html).toMatch(/data-scrml-render-by-tag=/);
    expect(html).not.toMatch(/<userName/);
    // Top-level cells key on the bare name (qualifiedPath === name).
    expect(clientJs).toMatch(/_scrml_reactive_get\("userName"\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("userName",/);
  });

  test("top-level render-by-tag-only cell no longer false-fires E-DG-002", () => {
    const res = compileSource("toplevel-no-edg002.scrml", SRC);
    expect(hasCode(res, "E-DG-002")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4: PRECISION guard — a genuinely-unused cell STILL fires E-DG-002
// ---------------------------------------------------------------------------

describe("Bug 60 §4: E-DG-002 precision (no over-crediting)", () => {
  test("a declared-but-never-rendered cell STILL fires E-DG-002", () => {
    const SRC =
      `<orphan req> = <input type="text"/>\n\n` +
      `<div>\n` +
      `  <p>hello</p>\n` +
      `</div>\n`;
    const res = compileSource("orphan-still-fires.scrml", SRC);
    expect(hasCode(res, "E-DG-002")).toBe(true);
  });
});
