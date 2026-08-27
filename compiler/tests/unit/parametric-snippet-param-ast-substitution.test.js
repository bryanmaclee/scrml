/**
 * g-parametric-snippet-param-substitution-is-textual-not-ast (S380-peter).
 *
 * A parametric snippet `foo={ (v) => … }` rendered via `${render foo(arg)}` used
 * to substitute the param with a global `\b<param>\b` string-replace over the raw
 * lambda body. Two failure modes on HEAD before this fix:
 *   (a) the param name was replaced where it appears as author TEXT
 *       (`the v value is ${v}` → "the ARGVAL value is ARGVAL");
 *   (b) a `$`-prefixed param (`($x) => …`) never matched (`\b$x\b` treats `$` as
 *       an anchor), so the arg was not substituted → `$x` unbound → E-SCOPE-001.
 *
 * Fix: parse the body into AST first, then rename the param IDENTIFIER (expression
 * positions only) to the arg expression via the node-level substitution component
 * expansion uses — markup / text literals are left untouched. A body that IS
 * exactly the bare param is replaced wholesale with the arg (it would otherwise be
 * classified as text and render the param name literally).
 *
 * Deterministic (emitted-HTML inspection); the execution path is covered by
 * compiler/tests/browser/g-render-snippet-parametric-renders.browser.test.js.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let tmpDir;
beforeEach(() => {
  tmpDir = join(tmpdir(), `scrml-snip-param-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpDir, "src"), { recursive: true });
});
afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function render(source) {
  const input = join(tmpDir, "src", "t.scrml");
  writeFileSync(input, source);
  const out = join(tmpDir, "out");
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  let html = "";
  for (const f of readdirSync(out)) if (f.endsWith(".html")) html += readFileSync(join(out, f), "utf8");
  const errs = (r.errors ?? []).map((e) => e.code);
  // Strip tags inside the marker span to get the rendered text.
  const m = html.match(/<span class="fv">([\s\S]*?)<\/span>/);
  const text = m ? m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "(no snippet)";
  return { errs, text };
}

describe("g-parametric-snippet-param-substitution-is-textual-not-ast", () => {
  test("MODE A — a param name appearing as author TEXT is NOT rewritten, only `${param}` is", () => {
    const { errs, text } = render(
      "<program>\n" +
      '${ const Card = <div props={ foot: snippet(v: string) }><div>${render foot("ARGVAL")}</div></div> }\n' +
      '<Card foot={ (v) => <span class="fv">the v value: ${v}</span> } />\n' +
      "</program>\n",
    );
    expect(errs).toEqual([]);
    // The literal word "v" survives; only the interpolation is substituted.
    expect(text).toBe("the v value: ARGVAL");
  });

  test("MODE B — a `$`-prefixed param is substituted (the old `\\b$x\\b` regex never matched)", () => {
    const { errs, text } = render(
      "<program>\n" +
      '${ const Tag = <div props={ lbl: snippet($x: string) }><div>${render lbl("XVAL")}</div></div> }\n' +
      '<Tag lbl={ ($x) => <span class="fv">[${$x}]</span> } />\n' +
      "</program>\n",
    );
    expect(errs).toEqual([]);
    expect(text).toBe("[XVAL]");
  });

  test("a bare-param body `(v) => v` renders the arg VALUE, not the literal param name", () => {
    const { errs, text } = render(
      "<program>\n" +
      '${ const B = <div props={ p: snippet(v: string) }><span class="fv">${render p("BAREVAL")}</span></div> }\n' +
      "<B p={ (v) => v } />\n" +
      "</program>\n",
    );
    expect(errs).toEqual([]);
    expect(text).toBe("BAREVAL");
  });

  test("a param name repeated in surrounding markup text is preserved (only the interp substitutes)", () => {
    const { errs, text } = render(
      "<program>\n" +
      '${ const F = <div props={ p: snippet(name: string) }><div>${render p("WORLD")}</div></div> }\n' +
      '<F p={ (name) => <span class="fv"><b>Hello ${name}, name welcome</b></span> } />\n' +
      "</program>\n",
    );
    expect(errs).toEqual([]);
    // `${name}` → WORLD; the two literal "name" words are untouched (exactly one WORLD).
    expect(text).toBe("Hello WORLD, name welcome");
    expect((text.match(/WORLD/g) ?? []).length).toBe(1);
  });
});
