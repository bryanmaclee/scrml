/**
 * Regression pin for the `<each>` parse-safe COMMENT-FENCE mount
 * (Approach A-unified, g-each-mount-div-foster-parented-in-table).
 *
 * The root invariant this fix restores: a top-level `<each>` must NOT emit a
 * `<div data-scrml-each-mount>` wrapper into the served HTML. Under `<select>`
 * the "in select" insertion mode DROPS a `<div>` start tag (→ empty dropdown,
 * GH #131, Firefox); under `<table>/<tbody>/<tr>` a `<div>` is FOSTER-PARENTED
 * out of the table (→ 0 rows, aM report). A comment `<!--scrml-each:N-->` is
 * inserted normally in EVERY insertion mode, so the mount survives and the
 * runtime inserts rows as legal `<option>`/`<tr>` SIBLINGS of the anchor.
 *
 * The gated test suite runs on happy-dom, which does NOT model "in select" /
 * "in table" token handling — so it cannot execute the foster/drop behavior. This
 * file pins the CODEGEN invariant instead (no `<div>` mount emitted for a
 * restricted parent; the fence is emitted INSIDE the select/tbody). The full
 * foster-EXECUTION proof is a real-browser / parse5 harness recorded in the change
 * dir, not gated here.
 *
 * NOTE: the NESTED-each mount is intentionally a runtime `createElement("div")`
 * (immune to parse-time foster-parenting) and is out of this invariant's scope —
 * covered by a separate follow-up gap (nested-under-restricted-parent).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { emitEachMountHtml } from "../../src/codegen/emit-each.ts";

function compileHtml(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-fence-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${name}.html`);
    const html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
    return { errors: result.errors ?? [], html };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** The single-element substring between an opening `<tag ...>` and its `</tag>`. */
function regionOf(html, tag) {
  const open = html.search(new RegExp(`<${tag}[\\s>]`));
  const close = html.indexOf(`</${tag}>`, open);
  return open === -1 || close === -1 ? "" : html.slice(open, close + `</${tag}>`.length);
}

describe("each mount is a parse-safe comment fence, never a <div> (FIX D pin)", () => {
  test("emitEachMountHtml returns a comment fence, not a <div data-scrml-each-mount>", () => {
    const node = { kind: "each-block", id: 42, templateChildren: [{ kind: "markup", tag: "li" }], emptyChild: null };
    const out = emitEachMountHtml(node, {});
    expect(out).toBe('<!--scrml-each:42--><!--/scrml-each:42-->');
    expect(out).not.toContain("data-scrml-each-mount");
    expect(out).not.toContain("<div");
  });

  test("emitEachMountHtml keeps the tree-shake empty-guard (no template + no empty → \"\")", () => {
    expect(emitEachMountHtml({ kind: "each-block", id: 1, templateChildren: [], emptyChild: null }, {})).toBe("");
  });

  test("<each>→<option> under <select> emits the fence INSIDE <select>, no <div> mount", () => {
    const src = `<program>
<items> = [{ id: 1, label: "A" }, { id: 2, label: "B" }]
<picked> = ""
<select bind:value=@picked>
  <option value="">pick</option>
  <each in=@items as it key=@.id>
    <option value=${"$"}{it.id}>${"$"}{it.label}</option>
  </each>
</select>
</program>`;
    const { errors, html } = compileHtml(src, "select");
    expect(errors).toEqual([]);
    const sel = regionOf(html, "select");
    expect(sel).toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);
    // The critical invariant: NO <div> mount anywhere inside the <select>.
    expect(sel).not.toContain("data-scrml-each-mount");
    expect(html).not.toMatch(/<div data-scrml-each-mount/);
  });

  test("<each>→<tr> under <tbody> emits the fence INSIDE <tbody>, no <div> mount", () => {
    const src = `<program>
<rows> = [{ id: 1, name: "A" }, { id: 2, name: "B" }]
<table>
  <tbody>
    <each in=@rows as r key=@.id>
      <tr><td>${"$"}{r.name}</td></tr>
    </each>
  </tbody>
</table>
</program>`;
    const { errors, html } = compileHtml(src, "tbody");
    expect(errors).toEqual([]);
    const tb = regionOf(html, "tbody");
    expect(tb).toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);
    expect(tb).not.toContain("data-scrml-each-mount");
    expect(html).not.toMatch(/<div data-scrml-each-mount/);
  });
});
