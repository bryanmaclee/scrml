/**
 * CONF-ATTR-WRITER-CONFLICT | §5.5.3 / §5.5.4 / §34 — E-ATTR-WRITER-CONFLICT
 *
 * Axiom ① (bryan's #81 ruling, S268): each physical DOM surface (className /
 * style / .value / each generic attribute) has AT MOST ONE wholesale owner. A
 * reactive value writer (`class=(expr)` / `style=(expr)` / `value=(expr)`) is a
 * WHOLESALE writer — it replaces the whole surface on every reactive update. It
 * must be the SOLE writer of its surface; a co-occurring composer (`class:`,
 * transition, `if=`/`show=`, `bind:value`) is a compile error naming both sites.
 *
 * CODES-HALF   — POS: the wholesale + composer mix fires E-ATTR-WRITER-CONFLICT
 *                (severity error, in result.errors, both sites named).
 *                NEG: a SOLE wholesale writer does NOT fire.
 * RUNTIME-HALF — the sole wholesale writer (the #81 fix) EMITS a reactive
 *                binding, and the emitted client bundle parses as a valid ES
 *                module (Acorn sourceType:"module" — S267: NOT new Function(),
 *                which false-passes in sloppy mode).
 *
 * Firing site: compiler/src/codegen/emit-html.ts `analyzeWriterConflict`.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import * as acorn from "acorn";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out"), log: () => {} });
    let html = null;
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(name)) {
        html = output.html ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const writerConflict = (r) => r.errors.find((e) => (e.code ?? "") === "E-ATTR-WRITER-CONFLICT");

describe("CONF-ATTR-WRITER-CONFLICT — codes-half", () => {
  test("POS: class=(expr) + class:name= fires E-ATTR-WRITER-CONFLICT naming both sites", () => {
    const src = `<program>
      <mode> = "a"
      <active> = false
      <button class=(@mode == "a" ? "tab on" : "tab") class:active=@active>A</button>
    </program>`;
    const r = compile(src, "awc-class-pos");
    const e = writerConflict(r);
    expect(e).toBeDefined();
    // Fatal — an E- code with severity "error" partitions into result.errors.
    expect(e.severity).toBe("error");
    expect(r.errors).toContain(e);
    // Both sites named, plus the axiom reference.
    expect(e.message).toContain("class=");
    expect(e.message).toContain("class:active=");
    expect(e.message).toContain("Axiom ①");
  });

  test("POS: style=(expr) + show= fires (subsumes the retired W-CG-VALUE-ATTR-STYLE-CONFLICT)", () => {
    const src = `<program>
      <open> = false
      <theme> = "color: red"
      <div show=@open style=(@theme)>panel</div>
    </program>`;
    const r = compile(src, "awc-style-pos");
    const e = writerConflict(r);
    expect(e).toBeDefined();
    expect(e.message).toContain("style=");
    expect(e.message).toContain("show=");
    // The retired warning must NOT surface.
    expect([...r.errors, ...r.warnings].map((x) => x.code)).not.toContain("W-CG-VALUE-ATTR-STYLE-CONFLICT");
  });

  test("POS: value=(expr) + bind:value= fires on a form control (.value surface)", () => {
    const src = `<program>
      <name> = "x"
      <disp> = "y"
      <input type="text" bind:value=@name value=(@disp)/>
    </program>`;
    const r = compile(src, "awc-value-pos");
    const e = writerConflict(r);
    expect(e).toBeDefined();
    expect(e.message).toContain("bind:value=");
  });

  test("NEG: a SOLE class=(expr) does NOT fire (different surfaces don't conflict)", () => {
    const src = `<program>
      <mode> = "a"
      <shown> = true
      <div show=@shown class=(@mode == "a" ? "on" : "off")>x</div>
    </program>`;
    const r = compile(src, "awc-neg");
    // show= writes style.display; class=(expr) writes className — independent
    // surfaces, no conflict.
    expect(writerConflict(r)).toBeUndefined();
  });
});

describe("CONF-ATTR-WRITER-CONFLICT — runtime-half (sole wholesale owner emits, #81 fix)", () => {
  test("a sole class=(expr) emits a reactive binding and the bundle is a valid ES module", () => {
    const src = `<program>
      <tab> = "assets"
      <button class=(@tab == "assets" ? "nav active" : "nav")>Assets</button>
    </program>`;
    const r = compile(src, "awc-runtime");
    expect(writerConflict(r)).toBeUndefined();
    expect(r.errors).toEqual([]);
    // HTML placeholder present (pre-#81 the whole attribute vanished).
    expect(r.html).toMatch(/data-scrml-bind-attr-class="[^"]+"/);
    // Reactive DOM write wired, subscribing to the cell.
    expect(r.clientJs).toContain('setAttribute("class", String(');
    expect(r.clientJs).toContain('_scrml_reactive_get("tab")');
    // Emitted bundle parses as an ES module (S267: sourceType:"module", not
    // new Function() which parses sloppy-mode and false-passes).
    expect(() =>
      acorn.parse(r.clientJs, { ecmaVersion: 2022, sourceType: "module" }),
    ).not.toThrow();
  });
});
