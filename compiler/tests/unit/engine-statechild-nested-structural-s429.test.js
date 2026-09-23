/* SPDX-License-Identifier: MIT
 * S429 — a PascalCase element closed with `</>` INSIDE a lowercase element in an
 * engine state-child body (a block `<match>`'s arms, a component call inside a
 * `<div>`, an unknown capitalised tag) broke state-child closer-pairing.
 *
 * THE BUG: the three body closer-finders in `engine-statechild-parser.ts`
 * (`findStateChildCloser` / `findEngineCloser` / `findOnTransitionCloser`)
 * kept one counter per opener kind and let `</>` pop the LOWERCASE counter
 * first. `</>` closes the most-recently-opened element, so in
 *
 *     <On> <match for=Kind on=@k> <X><p>X</p></> … </match> </>
 *
 * the arm's `</>` popped `<match>`, the state-child's own `</>` was consumed one
 * level early, the finder ran off the end, and the arm tags were then read as
 * SIBLING state-children: a false `E-ENGINE-STATE-CHILD-MISSING` for `.On` plus
 * `E-ENGINE-STATE-CHILD-INVALID-VARIANT` naming `<X>` / `<Y>` / `<Card>`.
 *
 * THE FIX: one open-element stack (`closeNamed`), `</>` pops the top. Plus:
 *   - `parseEngineStateChildren` skips an engine-DIRECT `<onTransition>` body
 *     wholesale (a PascalCase tag in it is not a state-child);
 *   - VP-2 (post-CE invariant) now walks engine state-child bodies, so an
 *     unresolved capitalised tag there is `E-COMPONENT-035` (as it is at file
 *     level) instead of a phantom `<foo>` element — the parse fix must not make
 *     that shape silent.
 *
 * SPEC: §51.0.B — a state-child body "rendered when the engine is in this
 * variant … nested `<tag>` is markup-as-value (§1.4)"; §4.18 "Body modes nest
 * … an engine / match opened inside a free-text body opens code-default bodies
 * for its state-children / arms"; §51.0.Q nested engines.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseEngineStateChildren } from "../../src/engine-statechild-parser.ts";
import { compileScrml } from "../../src/api.js";

const tagsOf = (entries) => entries.map((e) => e.tag);

function compileErrors(source) {
  const dir = mkdtempSync(join(tmpdir(), "s429-sc-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const result = compileScrml({ inputFiles: [file], write: true, outputDir: join(dir, "out"), log: () => {} });
    return (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MATCH_ARMS = `<match for=Kind on=@k>
        <X><p class="x">X</p></>
        <Y><p class="y">Y</p></>
      </match>`;

function engineWith(onBody, extraDecls = "") {
  return `<program>
  type Phase:enum = { Off, On }
  type Kind:enum = { X, Y }
  type Sub:enum = { A, B }
  <k>: Kind = .X
${extraDecls}
  <engine for=Phase initial=.On>
    <Off rule=.On>
      <p class="off">off</p>
    </>
    <On rule=.Off>
      ${onBody}
    </>
  </>
</program>
`;
}

describe("S429 §1 — parser: interleaved PascalCase-in-lowercase closes correctly", () => {
  test("a block <match> with `</>` arm closers directly in a state-child", () => {
    const raw = `
    <Off rule=.On><p>off</p></>
    <On rule=.Off>
      ${MATCH_ARMS}
    </>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  test("the same match wrapped in a <div>", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><div class="w">${MATCH_ARMS}</div></>`;
    const sc = parseEngineStateChildren(raw);
    expect(tagsOf(sc)).toEqual(["Off", "On"]);
    expect(sc[1].bodyRaw).toContain("</match>");
  });

  test("a component closed with `</>` inside a lowercase element", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><div><Card><p>inner</p></></div></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  test("an unknown capitalised tag inside a lowercase element", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><div><Foo class="f">hi</></div></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  test("nested engine whose state-child holds <div><Card>…</></div> (findEngineCloser)", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off>
      <engine for=Sub initial=.A>
        <A rule=.B><div><Card><p>A</p></></div></>
        <B rule=.A><p>B</p></>
      </>
    </>`;
    const sc = parseEngineStateChildren(raw);
    expect(tagsOf(sc)).toEqual(["Off", "On"]);
    expect(sc[1].innerEngines.length).toBe(1);
  });

  test("an <onTransition> in a state-child whose body holds <div><Card>…</></div> (findOnTransitionCloser)", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><p>on</p><onTransition to=.Off><div><Card>x</></div></></>`;
    const sc = parseEngineStateChildren(raw);
    expect(tagsOf(sc)).toEqual(["Off", "On"]);
    expect(sc[1].onTransitionElements.length).toBe(1);
  });

  test("an engine-DIRECT <onTransition> body is not scanned for state-children", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><p>on</p></>
    <onTransition from=.On to=.Off><div><Card>x</></div></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  // Malformed bodies keep the pre-S429 counter semantics (closeNamed fallback).
  test("a stray lowercase closer cannot close the state-child", () => {
    const raw = `<Off rule=.On><p>off</span></><On rule=.Off><p>on</p></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  test("a named closer pops through unclosed lowercase elements", () => {
    const raw = `<Off rule=.On><ul><li>a<li>b</ul></Off><On rule=.Off><p>on</p></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });
});

describe("S429 §2 — full compile: no false engine diagnostics; the right one where due", () => {
  test("match in a state-child compiles clean", () => {
    expect(compileErrors(engineWith(MATCH_ARMS))).toEqual([]);
  });

  test("match in a <div> in a state-child compiles clean", () => {
    expect(compileErrors(engineWith(`<div class="w">${MATCH_ARMS}</div>`))).toEqual([]);
  });

  test("component closed with `</>` inside a <div> in a state-child compiles clean", () => {
    const decl = `  const Card = <div class="card">\${children}</div>`;
    expect(compileErrors(engineWith(`<div class="w"><Card><p>inner</p></></div>`, decl))).toEqual([]);
  });

  test("nested engine with a match in a <div> in its state-child compiles clean", () => {
    const body = `<engine for=Sub initial=.A>
        <A rule=.B><div>${MATCH_ARMS}</div></>
        <B rule=.A><p class="b">B</p></>
      </>`;
    expect(compileErrors(engineWith(body))).toEqual([]);
  });

  test("an UNKNOWN capitalised tag in a state-child is E-COMPONENT-035 (all three layouts)", () => {
    for (const body of [
      `<div><Foo class="f">hi</></div>`,
      `<div><Foo class="f">hi</Foo></div>`,
      `<Foo class="f">hi</>`,
    ]) {
      const codes = compileErrors(engineWith(body));
      expect(codes).toContain("E-COMPONENT-035");
      expect(codes).not.toContain("E-ENGINE-STATE-CHILD-MISSING");
      expect(codes).not.toContain("E-ENGINE-STATE-CHILD-INVALID-VARIANT");
    }
  });

  test("a PascalCase tag in an engine-direct <onTransition> is not a state-child", () => {
    const src = `<program>
  type Phase:enum = { Off, On }
  const Card = <div class="card">\${children}</div>
  <engine for=Phase initial=.On>
    <Off rule=.On><p>off</p></>
    <On rule=.Off><p>on</p></>
    <onTransition from=.On to=.Off>
      <Card><p>x</p></>
    </>
  </>
</program>
`;
    const codes = compileErrors(src);
    expect(codes).not.toContain("E-ENGINE-STATE-CHILD-INVALID-VARIANT");
    expect(codes).not.toContain("E-ENGINE-STATE-CHILD-MISSING");
  });
});
