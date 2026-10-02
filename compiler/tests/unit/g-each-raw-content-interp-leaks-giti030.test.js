/**
 * g-each-raw-content-interp-leaks-giti030.test.js — regression for GITI-030.
 *
 * BUG (as filed): `<each in=@rows key=@.id>` with `${@.id}` in the body emitted
 * `createTextNode("${_scrml_each_item.id}")` (a half-rewritten LITERAL) for the
 * key field while non-key fields substituted correctly. The brief framed this as
 * "the key= field is excluded from body-interpolation substitution."
 *
 * EMPIRICAL ROOT CAUSE (this fix): the trigger is NOT the key field — it is the
 * RAW-CONTENT element (`<pre>` / `<code>`, SPEC §4.17). The brief's repro put the
 * `${@.id}` inside a `<code>`. Per SPEC §4.17 (line 1101, normative): inside a
 * `<pre>` / `<code>` body, `${...}` SHALL NOT be recognized as interpolation —
 * the literal `$`, `{`, `}` pass through as text. The block splitter captures the
 * raw-content body as a single text run, so inside an `<each>` body a
 * `<code>${@.id}</code>` child surfaces as a `text` node with value `${@.id}`.
 *
 * The defect was in emit-each.ts `renderTemplateChildToJs`: its text path ran
 * `rewriteContextualSigil` on the raw-content body, half-rewriting `@.id` to
 * `_scrml_each_item.id` and corrupting the §4.17 verbatim literal into the
 * nonsense `${_scrml_each_item.id}`. The fix emits raw-content text VERBATIM
 * (no sigil rewrite), matching the top-level `<code>` behavior.
 *
 * Coverage:
 *   §1 — key field `${@.id}` inside `<code>` ships VERBATIM `${@.id}` (not rewritten).
 *   §2 — sibling NON-raw `<span>${@.label}>` still substitutes (live-keyed) — no regression.
 *   §3 — NON-key field `${@.label}` inside `<code>` also ships verbatim (key= is irrelevant).
 *   §4 — key field `${@.id}` in a NON-raw `<span>` DOES substitute (the brief's
 *        framing was wrong — proves the trigger is raw-content, not key=).
 *   §5 — `<pre>` is also raw-content: `${@.x}` verbatim.
 *   §6 — mixed plain text `Item ${@.id}` (no raw element) interpolates both runs (regression guard).
 *   §7 — no corrupted `${_scrml_each_item...}` literal appears anywhere in the output.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

function compileToOutputs(source, suffix = "giti030") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — key field `${@.id}` inside <code> ships VERBATIM per §4.17.
// ---------------------------------------------------------------------------
describe("GITI-030 §1 — key field ${@.id} inside <code> ships verbatim", () => {
  test("emits createTextNode(\"${@.id}\") verbatim, NOT the rewritten literal", () => {
    const src = `<program>
<rows> = [{ id: "x1", label: "L" }]
<ul><each in=@rows key=@.id><li><code>\${@.id}</code> <span>\${@.label}</span></li></each></ul>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "giti030-s1");
    expect(errors).toEqual([]);
    // §4.17 verbatim — the literal `${@.id}` survives unchanged.
    expect(clientJs).toContain('document.createTextNode("${@.id}")');
    // The pre-fix corruption MUST be gone.
    expect(clientJs).not.toContain('"${_scrml_each_item.id}"');
  });
});

// ---------------------------------------------------------------------------
// §2 — sibling NON-raw <span>${@.label}> still substitutes (live-keyed).
// ---------------------------------------------------------------------------
describe("GITI-030 §2 — sibling non-raw <span> still substitutes (no regression)", () => {
  test("the non-raw <span> label interpolation stays live-keyed", () => {
    const src = `<program>
<rows> = [{ id: "x1", label: "L" }]
<ul><each in=@rows key=@.id><li><code>\${@.id}</code> <span>\${@.label}</span></li></each></ul>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "giti030-s2");
    expect(errors).toEqual([]);
    // The non-raw span uses the live-keyed reactive text node.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.label\)/);
  });
});

// ---------------------------------------------------------------------------
// §3 — NON-key field inside <code> also verbatim (key= is irrelevant to the bug).
// ---------------------------------------------------------------------------
describe("GITI-030 §3 — NON-key field ${@.label} inside <code> also verbatim", () => {
  test("a non-key field inside <code> ships verbatim — proves key= is not the axis", () => {
    const src = `<program>
<rows> = [{ id: "x1", label: "L" }]
<ul><each in=@rows key=@.id><li><code>\${@.label}</code> <span>\${@.id}</span></li></each></ul>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "giti030-s3");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('document.createTextNode("${@.label}")');
    expect(clientJs).not.toContain('"${_scrml_each_item.label}"');
    // And the non-raw <span> with the key field substitutes.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.id\)/);
  });
});

// ---------------------------------------------------------------------------
// §4 — key field in a NON-raw <span> DOES substitute (brief's framing was wrong).
// ---------------------------------------------------------------------------
describe("GITI-030 §4 — key field in a NON-raw <span> substitutes (brief framing was a misdiagnosis)", () => {
  test("the key field interpolates fine when NOT inside a raw-content element", () => {
    const src = `<program>
<rows> = [{ id: "x1", label: "L" }]
<ul><each in=@rows key=@.id><li><span>\${@.id}</span> <span>\${@.label}</span></li></each></ul>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "giti030-s4");
    expect(errors).toEqual([]);
    // Both fields (incl. the key field) substitute — no verbatim ${...} anywhere.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.id\)/);
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.label\)/);
    expect(clientJs).not.toContain('"${@.id}"');
  });
});

// ---------------------------------------------------------------------------
// §5 — <pre> is also raw-content.
// ---------------------------------------------------------------------------
describe("GITI-030 §5 — <pre> is also raw-content", () => {
  test("${@.x} inside <pre> ships verbatim", () => {
    const src = `<program>
<rows> = [{ id: "x1", x: 7 }]
<ul><each in=@rows key=@.id><li><pre>\${@.x}</pre></li></each></ul>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "giti030-s5");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('document.createTextNode("${@.x}")');
    expect(clientJs).not.toContain('"${_scrml_each_item.x}"');
  });
});

// ---------------------------------------------------------------------------
// §6 — mixed plain text (no raw element) interpolates both runs.
// ---------------------------------------------------------------------------
describe("GITI-030 §6 — mixed plain text interpolates (regression guard)", () => {
  test("Item ${@.id} has label ${@.label} both substitute as live-keyed text nodes", () => {
    const src = `<program>
<rows> = [{ id: "x1", label: "L" }]
<ul><each in=@rows key=@.id><li>Item \${@.id} has label \${@.label}</li></each></ul>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "giti030-s6");
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.id\)/);
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.label\)/);
    // The plain-text literal runs are still emitted verbatim.
    expect(clientJs).toContain('document.createTextNode("Item ")');
  });
});

// ---------------------------------------------------------------------------
// §7 — no corrupted `${_scrml_each_item...}` literal anywhere.
// ---------------------------------------------------------------------------
describe("GITI-030 §7 — no half-rewritten ${_scrml_each_item...} literal escapes", () => {
  test("a code+span+pre mix never emits a corrupted ${_scrml_each_item.*} literal string", () => {
    const src = `<program>
<rows> = [{ id: "x1", label: "L", x: 7 }]
<ul><each in=@rows key=@.id><li><code>\${@.id}</code><pre>\${@.x}</pre><span>\${@.label}</span></li></each></ul>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "giti030-s7");
    expect(errors).toEqual([]);
    // No literal text node may contain the half-rewritten form.
    expect(clientJs).not.toMatch(/createTextNode\("\$\{_scrml_each_item\./);
  });
});
