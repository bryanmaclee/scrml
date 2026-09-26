/* SPDX-License-Identifier: MIT
 * A PascalCase element closed with `</>` INSIDE a lowercase element in an engine
 * state-child body (`<div><Card>…</></div>`, a block `<match>`'s arms, an unknown
 * capitalised tag) broke state-child closer-pairing.
 *
 * THE BUG: the three body closer-finders in `engine-statechild-parser.ts`
 * (`findStateChildCloser` / `findEngineCloser` / `findOnTransitionCloser`) kept
 * one counter per opener kind and let `</>` pop the LOWERCASE counter first.
 * `</>` closes the most-recently-opened element, so in
 *
 *     <On> <div><Card>inner</></div> </>
 *
 * the component's `</>` popped `<div>`, the state-child's own `</>` was consumed
 * one level early, the finder ran off the end, and `<Card>` was then read as a
 * SIBLING state-child: a false `E-ENGINE-STATE-CHILD-MISSING` for `.On` plus
 * `E-ENGINE-STATE-CHILD-INVALID-VARIANT` naming `<Card>`.
 *
 * THE FIX (split out of hold/s429-match-in-engine-state-child e0ac22d6 — the
 * fork-independent parser half only): one open-element stack (`closeNamed`),
 * `</>` pops the top. Plus:
 *   - `parseEngineStateChildren` skips an engine-DIRECT `<onTransition>` body
 *     wholesale (a PascalCase tag in it is not a state-child);
 *   - VP-2 (post-CE invariant) walks engine state-child bodies, so an
 *     unresolved capitalised tag there is `E-COMPONENT-035` (as at file level)
 *     instead of a phantom `<foo>` element — the parse fix must not make that
 *     shape silent.
 *
 * FORK-NEUTRALITY: a block `<match>` in a state-child is the subject of the open
 * (A) refuse / (B) support ruling (`g-nested-block-match-in-dispatched-arm-
 * silently-drops`). The match assertions here are deliberately PARSE-level only
 * (the state-child is found; no false `E-ENGINE-STATE-CHILD-*`) — they do not
 * assert that such a program compiles clean, so either ruling can land on top.
 *
 * SPEC: §51.0.B (state-child body is markup-as-value), §4.18 (body modes nest),
 * §51.0.Q (nested engines), §51.0.H (`<onTransition>`).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseEngineStateChildren } from "../../src/engine-statechild-parser.ts";
import { compileScrml } from "../../src/api.js";

const tagsOf = (entries) => entries.map((e) => e.tag);
const ENGINE_FALSE_CODES = ["E-ENGINE-STATE-CHILD-MISSING", "E-ENGINE-STATE-CHILD-INVALID-VARIANT", "E-ENGINE-RULE-INVALID-VARIANT"];

function compileErrors(source) {
  const dir = mkdtempSync(join(tmpdir(), "sc-closer-"));
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

const CARD_DECL = `  const Card = <div class="card">\${children}</div>
  const Chip = <div class="chip">C</div>`;

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

// `<Card>` inside `depth` lowercase wrappers, then a sibling after them.
function nested(depth, cardForm, wrapClose) {
  const card =
    cardForm === "self" ? `<Chip/>` :
    cardForm === "named" ? `<Card><p class="inner">IN</p></Card>` :
    `<Card><p class="inner">IN</p></>`;
  let s = card;
  for (let d = depth; d >= 1; d--) s = `<div class="w${d}">${s}${wrapClose === "generic" ? "</>" : "</div>"}`;
  return `${s}<p class="after">AFTER</p>`;
}

describe("parser: interleaved PascalCase-in-lowercase closes correctly", () => {
  test("a component closed with `</>` inside a lowercase element", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><div><Card><p>inner</p></></div></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  for (const depth of [1, 2, 3]) {
    for (const cardForm of ["generic", "named", "self"]) {
      for (const wrapClose of ["named", "generic"]) {
        test(`component (${cardForm}) in ${depth} lowercase wrapper(s) closed ${wrapClose}, state-child closed \`</>\``, () => {
          const raw = `<Off rule=.On><p>off</p></><On rule=.Off><section>${nested(depth, cardForm, wrapClose)}</section></>`;
          const sc = parseEngineStateChildren(raw);
          expect(tagsOf(sc)).toEqual(["Off", "On"]);
          expect(sc[1].bodyRaw).toContain(`<p class="after">AFTER</p>`);
        });
      }
    }
  }

  test("component-in-component inside a lowercase element", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><div><Card><Card><p>x</p></></></div><p>after</p></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  test("mixed: `</>`-closed component in a `</>`-closed span, a named-closed component, named state-child closer", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><div><span><Card>a</></><Card>z</Card></div><p>after</p></On>`;
    const sc = parseEngineStateChildren(raw);
    expect(tagsOf(sc)).toEqual(["Off", "On"]);
    expect(sc[1].bodyRaw).toContain("<p>after</p>");
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

  // Fork-neutral: the state-child holding a block <match> must be FOUND whatever
  // the (A)/(B) ruling decides the match itself means there.
  test("a block <match> with `</>` arm closers directly in a state-child: the state-child is found", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off>${MATCH_ARMS}</>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  test("the same match wrapped in a <div>: the state-child is found and holds the whole match", () => {
    const raw = `<Off rule=.On><p>off</p></><On rule=.Off><div class="w">${MATCH_ARMS}</div></>`;
    const sc = parseEngineStateChildren(raw);
    expect(tagsOf(sc)).toEqual(["Off", "On"]);
    expect(sc[1].bodyRaw).toContain("</match>");
  });

  // Malformed bodies keep the pre-fix counter semantics (closeNamed fallback).
  test("a stray lowercase closer cannot close the state-child", () => {
    const raw = `<Off rule=.On><p>off</span></><On rule=.Off><p>on</p></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });

  test("a named closer pops through unclosed lowercase elements", () => {
    const raw = `<Off rule=.On><ul><li>a<li>b</ul></Off><On rule=.Off><p>on</p></>`;
    expect(tagsOf(parseEngineStateChildren(raw))).toEqual(["Off", "On"]);
  });
});

describe("full compile: no false engine diagnostics; the right one where due", () => {
  for (const depth of [1, 2, 3]) {
    for (const cardForm of ["generic", "named", "self"]) {
      for (const wrapClose of ["named", "generic"]) {
        test(`component (${cardForm}) in ${depth} wrapper(s) closed ${wrapClose}, inside <section> in a state-child: compiles clean`, () => {
          expect(compileErrors(engineWith(`<section>${nested(depth, cardForm, wrapClose)}</section>`, CARD_DECL))).toEqual([]);
        });
      }
    }
  }

  test("nested engine whose state-child holds <div><Card>…</></div>: compiles clean", () => {
    const body = `<engine for=Sub initial=.A>
        <A rule=.B><div><Card><p>A</p></></div></>
        <B rule=.A><p class="b">B</p></>
      </>`;
    expect(compileErrors(engineWith(body, CARD_DECL))).toEqual([]);
  });

  // Fork-neutral: no assertion on what the match lowers to — only that the
  // engine is no longer mis-parsed around it.
  for (const [label, body] of [
    ["bare", MATCH_ARMS],
    ["div-wrapped", `<div class="w">${MATCH_ARMS}</div>`],
  ]) {
    test(`match (${label}) in a state-child: no false E-ENGINE-STATE-CHILD-* diagnostics`, () => {
      const codes = compileErrors(engineWith(body));
      for (const c of ENGINE_FALSE_CODES) expect(codes).not.toContain(c);
    });
  }

  test("an UNKNOWN capitalised tag in a state-child is E-COMPONENT-035 (all three layouts)", () => {
    for (const body of [
      `<div><Foo class="f">hi</></div>`,
      `<div><Foo class="f">hi</Foo></div>`,
      `<Foo class="f">hi</>`,
    ]) {
      const codes = compileErrors(engineWith(body));
      expect(codes).toContain("E-COMPONENT-035");
      for (const c of ENGINE_FALSE_CODES) expect(codes).not.toContain(c);
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
    for (const c of ENGINE_FALSE_CODES) expect(codes).not.toContain(c);
  });
});

// The same interleaving in every OTHER body context never went through the engine
// closer-finders and was already correct; these guard that it stays so.
describe("sibling contexts: `</>`-closed component inside lowercase wrappers", () => {
  const head = `<program>
  type Kind:enum = { X, Y }
  <k>: Kind = .X
  <show> = true
  <items> = [{ id: 1 }]
${CARD_DECL}`;
  const contexts = {
    "match arm": (b) => `${head}\n  <match for=Kind on=@k>\n    <X><section>${b}</section></>\n    <Y><p>Y</p></>\n  </match>\n</program>`,
    "each body": (b) => `${head}\n  <section><each in=@items key=@.id>${b}</each></section>\n</program>`,
    "if= element": (b) => `${head}\n  <section if=@show>${b}</section>\n</program>`,
    "component body": (b) => `${head}\n  const Wrap = <section>${b}</section>\n  <Wrap/>\n</program>`,
    "plain markup": (b) => `${head}\n  <section>${b}</section>\n</program>`,
  };
  for (const [ctx, wrap] of Object.entries(contexts)) {
    for (const depth of [1, 2, 3]) {
      test(`${ctx}, depth ${depth}, mixed closers: compiles clean`, () => {
        for (const cardForm of ["generic", "named", "self"]) {
          for (const wrapClose of ["named", "generic"]) {
            expect(compileErrors(wrap(nested(depth, cardForm, wrapClose)))).toEqual([]);
          }
        }
      });
    }
  }
});

// W-ENGINE-MATCH-IN-STATE-CHILD — a block <match> in a state-child renders only
// at page load (blank on every later entry until its on= changes). The warning
// names the limitation without deciding the open (A)/(B) ruling on
// g-nested-block-match-in-dispatched-arm-silently-drops: (A) upgrades it to an
// error, (B) deletes it. Fired from the post-CE AST, so both pipelines.
describe("W-ENGINE-MATCH-IN-STATE-CHILD", () => {
  const W = "W-ENGINE-MATCH-IN-STATE-CHILD";
  const NAMED_ARMS = `<match for=Kind on=@k><X><p>X</p></X><Y><p>Y</p></Y></match>`;

  function diagnostics(source, parser) {
    const dir = mkdtempSync(join(tmpdir(), "sc-warn-"));
    try {
      const file = join(dir, "app.scrml");
      writeFileSync(file, source);
      const result = compileScrml({ inputFiles: [file], parser, write: true, outputDir: join(dir, "out"), log: () => {} });
      return [...(result.errors ?? []), ...(result.warnings ?? [])];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const warnings = (src, parser) => diagnostics(src, parser).filter((d) => d.code === W);
  const errorCodes = (src, parser) =>
    diagnostics(src, parser).filter((d) => (d.severity ?? "error") === "error").map((d) => d.code);

  const KV_DECL = `  const KV = <div>${MATCH_ARMS}</div>`;
  const outside = (body) => `<program>
  type Phase:enum = { Off, On }
  type Kind:enum = { X, Y }
  <k>: Kind = .X
  <engine for=Phase initial=.On>
    <Off rule=.On><p>off</p></>
    <On rule=.Off><p>on</p></>
  </>
  ${body}
</program>
`;

  for (const parser of [undefined, "scrml-native"]) {
    const label = parser ?? "default";
    describe(`pipeline: ${label}`, () => {
      for (const [shape, body, decl] of [
        ["`</>` arms, directly in the state-child", MATCH_ARMS, ""],
        ["named `</X>` arms, directly in the state-child", NAMED_ARMS, ""],
        ["`</>` arms inside a <div>", `<div>${MATCH_ARMS}</div>`, ""],
        ["named arms inside <section><div>", `<section><div>${NAMED_ARMS}</div></section>`, ""],
        ["a component whose body is the match", `<KV/>`, KV_DECL],
        ["a nested engine's state-child", `<engine for=Sub initial=.A><A rule=.B>${MATCH_ARMS}</><B rule=.A><p>b</p></></>`, ""],
      ]) {
        test(`warns: ${shape}`, () => {
          const src = engineWith(body, decl);
          const w = warnings(src, parser);
          expect(w.length).toBe(1);
          expect(w[0].severity).toBe("warning");
          expect(w[0].message).toContain("g-nested-block-match-in-dispatched-arm-silently-drops");
          expect(w[0].message).toContain("BLANK on every entry after page load");
          expect(errorCodes(src, parser)).toEqual([]);
        });
      }

      test("does NOT warn: a match outside the engine", () => {
        expect(warnings(outside(MATCH_ARMS), parser)).toEqual([]);
      });

      test("does NOT warn: the workaround — the match outside the engine, gated on the engine variable", () => {
        expect(warnings(outside(`<div if=(@phase == .On)>${NAMED_ARMS}</div>`), parser)).toEqual([]);
      });

      test("does NOT warn: a component (no match) closed with `</>` inside a state-child", () => {
        expect(warnings(engineWith(`<div><Card><p>x</p></></div>`, CARD_DECL), parser)).toEqual([]);
      });

      test("does NOT warn: a match inside an <each> in a state-child (re-mounts on entry; renders correctly)", () => {
        expect(warnings(engineWith(`<each in=@items key=@.id>${MATCH_ARMS}</each>`, `  <items> = [{ id: 1 }]`), parser)).toEqual([]);
      });
    });
  }
});
