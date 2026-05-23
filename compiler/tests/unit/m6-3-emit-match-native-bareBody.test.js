/**
 * m6-3-emit-match-native-bareBody.test.js — M6.3 (M6 Wave 1, S122) regression
 * suite.
 *
 * Covers the post-migration bare-body arm re-parse path at
 * `compiler/src/codegen/emit-match.ts:513` after switching from the lazy
 * `splitBlocks` + `buildAST` synthesis re-invocation to a static
 * `nativeParseFile` route.
 *
 * Per M6 cutover plan §M6.3 ("+6 unit tests covering each match-form arm
 * shape"). One test per arm shape that exercises the migrated nativeParseFile
 * code path:
 *
 *   1. Bare-body — simple text only (smallest path)
 *   2. Bare-body — `${@cell}` interpolation (logic-escape inside markup)
 *   3. Bare-body — nested tag (`<p>` child)
 *   4. Bare-body — positional payload binding `<Ready(rows)>`
 *   5. Wildcard `<_>` arm with bare-body (S109 Phase 5 path)
 *   6. Bare-body — event handler attribute (`on:click=...`)
 *
 * Each test asserts that `emitMatchBodyRenderForFile` produces a dispatcher
 * + at least one render fn, and that the bare-body content reaches the emitted
 * render fn unchanged (the proof that the native parser re-parsed it
 * faithfully). The migration is observationally transparent — these tests
 * pass identically against the pre-M6.3 BS+TAB path AND the post-M6.3 native
 * path.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitMatchBodyRenderForFile } from "../../src/codegen/emit-match.ts";

function parse(src) {
  const bs = splitBlocks("/tmp/m6-3-test.scrml", src);
  const tab = buildAST(bs, null);
  return tab;
}

function makeCtx(fileAST) {
  return {
    fileAST,
    registry: {
      logicBindings: [],
      eventBindings: [],
      pushArmContext: () => {},
      popArmContext: () => {},
      addLogicBinding: () => {},
      // Test 6 (event-handler arm body) triggers addEventBinding via
      // generateHtml's `on:click=` path.
      addEventBinding: () => {},
    },
    derivedNames: new Set(),
    encodingCtx: null,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — Bare-body: simple text only
// ---------------------------------------------------------------------------

describe("M6.3 §1: bare-body arm — simple text", () => {
  test("native re-parse handles plain text arm body", () => {
    const src = `\${
    type Phase:enum = { Idle, Done }
    @phase = .Idle
}
<match for=Phase on=@phase>
    <Idle>idle-text-marker</>
    <Done>done-text-marker</>
</match>
`;
    const tab = parse(src);
    const ctx = makeCtx(tab.ast);
    const out = emitMatchBodyRenderForFile(tab.ast, ctx);
    expect(out.renderFunctions.length).toBeGreaterThan(0);
    const allRenderJs = out.renderFunctions.join("\n");
    // The bare-body text must reach the emitted render fn (proves
    // nativeParseFile produced the expected ASTNode shape that generateHtml
    // walks).
    expect(allRenderJs).toContain("idle-text-marker");
    expect(allRenderJs).toContain("done-text-marker");
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Bare-body: `${@cell}` interpolation
// ---------------------------------------------------------------------------

describe("M6.3 §2: bare-body arm — `${@cell}` interpolation", () => {
  test("native re-parse handles interp inside arm body", () => {
    const src = `\${
    type Phase:enum = { Idle, Done }
    @phase = .Idle
    @count = 0
}
<match for=Phase on=@phase>
    <Idle>count is \${@count}</>
    <Done>final \${@count}</>
</match>
`;
    const tab = parse(src);
    const ctx = makeCtx(tab.ast);
    const out = emitMatchBodyRenderForFile(tab.ast, ctx);
    expect(out.renderFunctions.length).toBeGreaterThan(0);
    const allRenderJs = out.renderFunctions.join("\n");
    // Interp should surface as a reactive-get or placeholder slot ref.
    // Either the cell name appears in a reactive_get call OR a placeholder
    // attribute carries the cellName.
    const referencesCount = allRenderJs.includes("count") || allRenderJs.includes("data-scrml-cell");
    expect(referencesCount).toBe(true);
    // Static prefix text from the arm body must reach the render fn.
    expect(allRenderJs).toContain("count is ");
    expect(allRenderJs).toContain("final ");
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Bare-body: nested tag
// ---------------------------------------------------------------------------

describe("M6.3 §3: bare-body arm — nested tag", () => {
  test("native re-parse handles nested `<p>` element", () => {
    const src = `\${
    type Phase:enum = { Idle, Done }
    @phase = .Idle
}
<match for=Phase on=@phase>
    <Idle>
        <p>idle-paragraph</p>
    </>
    <Done>
        <p>done-paragraph</p>
    </>
</match>
`;
    const tab = parse(src);
    const ctx = makeCtx(tab.ast);
    const out = emitMatchBodyRenderForFile(tab.ast, ctx);
    expect(out.renderFunctions.length).toBeGreaterThan(0);
    const allRenderJs = out.renderFunctions.join("\n");
    // Nested `<p>` opener + closer must reach the rendered HTML literal.
    expect(allRenderJs).toContain("<p>");
    expect(allRenderJs).toContain("</p>");
    expect(allRenderJs).toContain("idle-paragraph");
    expect(allRenderJs).toContain("done-paragraph");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Bare-body: positional payload binding
// ---------------------------------------------------------------------------

describe("M6.3 §4: bare-body arm — positional payload binding", () => {
  test("native re-parse handles arm with payload-binding declaration", () => {
    const src = `\${
    type Status:enum = { Idle, Ready(rows:int) }
    @status = .Idle
}
<match for=Status on=@status>
    <Idle>idle-marker</>
    <Ready(rows)>
        ready-marker
    </>
</match>
`;
    const tab = parse(src);
    const ctx = makeCtx(tab.ast);
    const out = emitMatchBodyRenderForFile(tab.ast, ctx);
    expect(out.renderFunctions.length).toBeGreaterThan(0);
    const allRenderJs = out.renderFunctions.join("\n");
    // The bare-body content of the payload-binding arm must reach the render fn.
    expect(allRenderJs).toContain("ready-marker");
    expect(allRenderJs).toContain("idle-marker");
    // Dispatcher should branch on both Ready + Idle variants.
    const dispJs = out.dispatchers.join("\n");
    expect(dispJs).toContain(`_tag === "Ready"`);
    expect(dispJs).toContain(`_tag === "Idle"`);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Wildcard `<_>` arm with bare-body
// ---------------------------------------------------------------------------

describe("M6.3 §5: wildcard arm with bare-body", () => {
  test("native re-parse handles `<_>` bare-body", () => {
    const src = `\${
    type Phase:enum = { Idle, Loading, Done }
    @phase = .Idle
}
<match for=Phase on=@phase>
    <Idle>idle-marker</>
    <_>wildcard-marker</>
</match>
`;
    const tab = parse(src);
    const ctx = makeCtx(tab.ast);
    const out = emitMatchBodyRenderForFile(tab.ast, ctx);
    expect(out.renderFunctions.length).toBeGreaterThan(0);
    const allRenderJs = out.renderFunctions.join("\n");
    // Wildcard arm body must reach the emitted render fn.
    expect(allRenderJs).toContain("wildcard-marker");
    expect(allRenderJs).toContain("idle-marker");
    // Dispatcher carries the wildcard catch-all `else` branch (S109 Phase 5).
    const dispJs = out.dispatchers.join("\n");
    expect(dispJs).toContain(`_tag === "Idle"`);
    // The wildcard branch surfaces as either a default `else` OR an
    // explicit `_tag` branch — both shapes are valid; assert that one
    // of them references the wildcard tag.
    expect(dispJs.includes("else") || dispJs.includes(`_tag === "_"`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Bare-body: event handler attribute
// ---------------------------------------------------------------------------

describe("M6.3 §6: bare-body arm — event handler attribute", () => {
  test("native re-parse handles `on:click=` event handler inside arm body", () => {
    const src = `\${
    type Phase:enum = { Idle, Done }
    @phase = .Idle
    function go() { @phase = .Done }
}
<match for=Phase on=@phase>
    <Idle>
        <button on:click=\${go()}>idle-button</button>
    </>
    <Done>done-text</>
</match>
`;
    const tab = parse(src);
    const ctx = makeCtx(tab.ast);
    const out = emitMatchBodyRenderForFile(tab.ast, ctx);
    expect(out.renderFunctions.length).toBeGreaterThan(0);
    const allRenderJs = out.renderFunctions.join("\n");
    // Button element + body text must reach the emitted render fn.
    expect(allRenderJs).toContain("<button");
    expect(allRenderJs).toContain("idle-button");
    // Done arm bare-body present.
    expect(allRenderJs).toContain("done-text");
    // Render output is non-empty for both arms — non-zero string content
    // proves the native parser handled the on:click= attribute without
    // bailing out the arm body.
    expect(allRenderJs.length).toBeGreaterThan(100);
  });
});
