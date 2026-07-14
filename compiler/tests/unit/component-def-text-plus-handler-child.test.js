/**
 * fix-component-def-text-plus-handler-child — regression suite (Scope C A3)
 *
 * Bug class: component-def whose root is a wrapper element (e.g. <div>) with
 * direct text content followed by a child element bearing an event-handler
 * attribute (e.g. onclick=fn()) failed to register, producing E-COMPONENT-020
 * on every reference. Bisected (S42) to a `collectExpr` angle-tracking flaw —
 * the `>` of an opening wrapper tag decremented angleDepth back to 0, then
 * the IDENT-text-before-child-tag gated `<` from re-incrementing because of
 * the prevEndsValue guard (the value-token test that protects `base < limit`
 * from being parsed as a tag opener). With angleDepth==0, the inner attribute
 * handler `onclick = fn()` triggered the IDENT-`=` "new statement" boundary
 * and `collectExpr` truncated the component body mid-token-stream.
 *
 * Fix: track angleDepth as element-nesting depth (not delimiter depth). When
 * we are already inside a markup element (angleDepth > 0), `<` IDENT/KEYWORD
 * unconditionally opens a child element regardless of prevEndsValue (text
 * content can sit between `>` and `<`). And `>` no longer decrements — only
 * `</…>` (close-tag start) and `…/>` (self-close) do.
 *
 * The existing "Bug 3" guard (collectExpr-lt-vs-tag-open.test.js) covers the
 * outside-markup case where prevEndsValue prevents `<` from being a tag opener.
 * That stays.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `defth-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_defth_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let html = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        html = output.html ?? null;
      }
    }
    return { errors: result.errors ?? [], html };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

function noE020(errors) {
  return errors.filter(e => e && e.code === "E-COMPONENT-020");
}

describe("component-def: text + handler-bearing child (A3 fix)", () => {
  test("verified bisected trigger: <div>label <button onclick=fn()>...</button></div>", () => {
    const src = `<program>
\${ function fn() { } }
\${ const Foo = <div>label <button onclick=fn()>x</button></div> }
<div><Foo/></div>
</program>`;
    const { errors, html } = compileSource(src, "trigger-canonical");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    // The expanded Foo body should appear in the markup output
    expect(html).toContain("label");
    expect(html).toContain("button");
  });

  test("variation: different wrapper tag (<section>) and handler attr", () => {
    const src = `<program>
\${ function fn() { } }
\${ const Foo = <section>title <a href="/x" onclick=fn()>link</a></section> }
<div><Foo/></div>
</program>`;
    const { errors, html } = compileSource(src, "wrapper-section");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("title");
  });

  test("variation: onchange handler on input child", () => {
    const src = `<program>
\${ function fn() { } }
\${ const Foo = <div>info <input onchange=fn()/></div> }
<div><Foo/></div>
</program>`;
    const { errors, html } = compileSource(src, "handler-onchange");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("info");
  });

  test("variation: multiple text-then-handler children", () => {
    const src = `<program>
\${ function fn() { } }
\${ const Foo = <div>a <button onclick=fn()>b</button> c <button onclick=fn()>d</button></div> }
<div><Foo/></div>
</program>`;
    const { errors, html } = compileSource(src, "multi-text-handler");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
  });

  test("sanity: usage via match-with-lift after def works", () => {
    const src = `<program>
\${ function fn() { } }
\${ const Foo = <div>label <button onclick=fn()>x</button></div> }
\${ const x = .A }
<div>
\${ match @x {
  .A => { lift <Foo> }
  else => { }
} }
</div>
</program>`;
    const { errors } = compileSource(src, "match-with-lift");
    expect(noE020(errors)).toEqual([]);
  });

  test("sanity: pre-fix passing case (single-element root with handler) still passes", () => {
    const src = `<program>
\${ function fn() { } }
\${ const Bar = <button onclick=fn()>x</button> }
<div><Bar/></div>
</program>`;
    const { errors, html } = compileSource(src, "single-root-handler");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
  });
});
