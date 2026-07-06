/**
 * 6nz-F4 — reactive `${}` inside `<textarea>` (RCDATA content model) — Unit Tests
 *
 * Bug (MED, silent-wrong-output): `<textarea>${@x}</textarea>` emitted
 * `<textarea><span data-scrml-logic="…"></span></textarea>`. `<textarea>` has an
 * RCDATA content model — its body is raw text — so the reactive placeholder span
 * leaked as the textarea's literal string value (never a reactive mount). The
 * same `${@x}` in a `<div>` is correct (control).
 *
 * Fix (codegen; no SPEC amendment): a reactive content interpolation inside an
 * RCDATA element (`<textarea>`, flagged `rcdata:true` in the §24 element registry)
 * does NOT emit the span placeholder. Instead the concatenated content binds to
 * the element's `.value` reactively (the one-way read-side of the bind:value
 * machinery) with a `data-scrml-rcdata` selector, and const-known parts render as
 * the textarea's static first-paint content.
 *
 * Coverage (the 6 brief edges):
 *   §1  Reactive `${@x}` in <textarea> → .value bind, NO span leak, node-check clean (the repro)
 *   §2  Static text <textarea>hello</textarea> → literal content, unchanged (no regression)
 *   §3  Mixed static + interp → concatenated into .value, static parts as initial content
 *   §4  Multiple interps → all concatenated reactively into .value
 *   §5  bind:value + content ${} conflict → bind:value wins + W-RCDATA-BIND-VALUE-CONTENT-CONFLICT, no double-bind
 *   §6  Inside <each> → per-item .value bind (each render path), NO span / no text-node leak
 *   §7  Control: same ${@x} in a <div> still uses the span path (no regression)
 *   §8  Registry: isRcdataElement flag is textarea-only
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";
import { isRcdataElement, getElementShape } from "../../src/html-elements.js";

// ---------------------------------------------------------------------------
// Helpers — full-pipeline compile (source string → { html, clientJs }) via the
// public compiler entry, so the real logic-node lowering is exercised.
// ---------------------------------------------------------------------------

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-6nz-f4-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    return {
      html: out.html ?? "",
      clientJs: out.clientJs ?? "",
      errors: r.errors ?? [],
      warnings: r.warnings ?? [],
      lints: r.lintDiagnostics ?? [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Extract the first `<textarea …>…</textarea>` (or self-closed) from HTML. */
function textareaOf(html) {
  const m = html.match(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/);
  return m ? m[0] : (html.match(/<textarea\b[^>]*\/>/)?.[0] ?? null);
}

/** `node --check` the emitted client JS — the syntax gate from the brief. */
function nodeCheck(clientJs) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-6nz-f4-check-"));
  try {
    const file = join(dir, "check.js");
    writeFileSync(file, clientJs);
    execFileSync("node", ["--check", file], { stdio: "pipe" });
    return { ok: true, err: "" };
  } catch (e) {
    return { ok: false, err: String(e?.stderr ?? e) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — the repro: reactive interp binds .value, no span leak
// ---------------------------------------------------------------------------

describe("§1: reactive ${@x} in <textarea> binds .value (the repro)", () => {
  const src = `<program>\n\${ @x = "hello" }\n<div class="app">\n    <textarea class="ta" rows="2">\${@x}</textarea>\n    <div class="ctl">control: \${@x}</div>\n</div>\n</program>\n`;

  test("emitted <textarea> contains NO data-scrml-logic span (RCDATA leak fixed)", () => {
    const { html } = compileSource(src);
    const ta = textareaOf(html);
    expect(ta).not.toBeNull();
    expect(ta).not.toContain("data-scrml-logic");
    expect(ta).not.toContain("<span");
  });

  test("emitted <textarea> carries the data-scrml-rcdata .value selector", () => {
    const { html } = compileSource(src);
    expect(textareaOf(html)).toContain("data-scrml-rcdata=");
  });

  test("client JS binds el.value to the reactive cell inside an effect", () => {
    const { clientJs } = compileSource(src);
    expect(clientJs).toContain("data-scrml-rcdata=");
    expect(clientJs).toMatch(/el\.value\s*=\s*""\s*\+\s*\(_scrml_reactive_get\("x"\)\)/);
    // The bind re-runs reactively.
    expect(clientJs).toContain("_scrml_effect(function() { _scrml_set_rcdata(); })");
  });

  test("emitted client JS is `node --check` clean", () => {
    const { clientJs } = compileSource(src);
    const r = nodeCheck(clientJs);
    expect(r.err).toBe("");
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — static text: unchanged (no regression)
// ---------------------------------------------------------------------------

describe("§2: static <textarea>hello</textarea> stays literal (no regression)", () => {
  const src = `<program>\n<div class="app">\n    <textarea class="ta">just static text</textarea>\n</div>\n</program>\n`;

  test("static content stays literal, no span, no rcdata selector", () => {
    const { html } = compileSource(src);
    const ta = textareaOf(html);
    expect(ta).toContain("just static text");
    expect(ta).not.toContain("<span");
    expect(ta).not.toContain("data-scrml-rcdata");
  });
});

// ---------------------------------------------------------------------------
// §3 — mixed static + interp
// ---------------------------------------------------------------------------

describe("§3: mixed static + interp → concatenated into .value", () => {
  const src = `<program>\n\${ @x = "hello" }\n<div class="app">\n    <textarea class="ta">pre \${@x} post</textarea>\n</div>\n</program>\n`;

  test("static parts render as initial content; NO span leak", () => {
    const { html } = compileSource(src);
    const ta = textareaOf(html);
    expect(ta).not.toContain("<span");
    expect(ta).toContain("data-scrml-rcdata=");
    // The literal "pre " / " post" runs appear as first-paint content.
    expect(ta).toContain("pre ");
    expect(ta).toContain(" post");
  });

  test("client JS concatenates static + reactive into el.value", () => {
    const { clientJs } = compileSource(src);
    expect(clientJs).toMatch(/el\.value\s*=\s*""\s*\+\s*"pre "\s*\+\s*\(_scrml_reactive_get\("x"\)\)\s*\+\s*" post"/);
  });

  test("client JS is node --check clean", () => {
    expect(nodeCheck(compileSource(src).clientJs).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — multiple interps
// ---------------------------------------------------------------------------

describe("§4: multiple interps → all concatenated reactively", () => {
  const src = `<program>\n\${ @first = "a" }\n\${ @last = "b" }\n<div class="app">\n    <textarea class="ta">\${@first} and \${@last}!</textarea>\n</div>\n</program>\n`;

  test("both cells bind into el.value; no span leak", () => {
    const { html, clientJs } = compileSource(src);
    expect(textareaOf(html)).not.toContain("<span");
    expect(clientJs).toContain(`_scrml_reactive_get("first")`);
    expect(clientJs).toContain(`_scrml_reactive_get("last")`);
    expect(clientJs).toContain("el.value =");
    expect(nodeCheck(clientJs).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 — bind:value + content conflict (edge 4 ruling: bind:value wins + lint)
// ---------------------------------------------------------------------------

describe("§5: bind:value + content ${} → bind:value wins + warning (no double-bind)", () => {
  const src = `<program>\n\${ @x = "hello" }\n<div class="app">\n    <textarea class="ta" bind:value=@x>\${@x}</textarea>\n</div>\n</program>\n`;

  test("W-RCDATA-BIND-VALUE-CONTENT-CONFLICT warning is emitted", () => {
    const { warnings } = compileSource(src);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("W-RCDATA-BIND-VALUE-CONTENT-CONFLICT");
  });

  test("bind:value wins: bind wiring present, NO rcdata content binding, NO span leak", () => {
    const { html, clientJs } = compileSource(src);
    const ta = textareaOf(html);
    expect(ta).not.toContain("<span");
    expect(ta).not.toContain("data-scrml-rcdata");
    expect(ta).toContain("data-scrml-bind-value");
    // No rcdata content double-bind.
    expect(clientJs).not.toContain("data-scrml-rcdata");
    expect(nodeCheck(clientJs).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — inside <each> (per-item .value bind, each render path)
// ---------------------------------------------------------------------------

describe("§6: reactive <textarea> inside <each> binds .value per item", () => {
  const src = `<program>\n\${ @notes = ["one", "two", "three"] }\n<div class="app">\n    <each in=@notes as note>\n        <textarea class="ta" rows="2">\${@.}</textarea>\n    </each>\n</div>\n</program>\n`;

  test("each per-item factory creates a textarea and sets .value (no text-node/span leak)", () => {
    const { clientJs } = compileSource(src);
    expect(clientJs).toContain('document.createElement("textarea")');
    // .value is set from the item, NOT appended as a child text node.
    expect(clientJs).toMatch(/\.value\s*=\s*String\(/);
    expect(clientJs).not.toContain("data-scrml-logic");
    expect(nodeCheck(clientJs).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 — control: ${@x} in a <div> still uses the span path (no regression)
// ---------------------------------------------------------------------------

describe("§7: control — ${@x} in a <div> still uses the reactive span", () => {
  const src = `<program>\n\${ @x = "hello" }\n<div class="app">\n    <div class="ta">\${@x}</div>\n</div>\n</program>\n`;

  test("the <div> still gets a data-scrml-logic span (unchanged)", () => {
    const { html } = compileSource(src);
    expect(html).toContain("data-scrml-logic=");
    expect(html).not.toContain("data-scrml-rcdata");
  });
});

// ---------------------------------------------------------------------------
// §8 — registry flag
// ---------------------------------------------------------------------------

describe("§8: RCDATA registry flag", () => {
  test("isRcdataElement is true for <textarea>, false for others", () => {
    expect(isRcdataElement("textarea")).toBe(true);
    expect(isRcdataElement("TEXTAREA")).toBe(true);
    expect(isRcdataElement("div")).toBe(false);
    expect(isRcdataElement("input")).toBe(false);
    expect(isRcdataElement("pre")).toBe(false);
    expect(isRcdataElement("select")).toBe(false);
  });

  test("textarea element shape carries rcdata:true", () => {
    expect(getElementShape("textarea").rcdata).toBe(true);
    expect(getElementShape("div").rcdata).toBe(false);
  });
});
