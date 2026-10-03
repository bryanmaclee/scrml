/**
 * M6.7-C1 — native→CE component-def / registration parity.
 *
 * Closes the dominant E-COMPONENT-020 flip cluster: under a native-parser
 * default, a same-file `const Upper = <markup>` component-def PARSED fine but
 * was fed to the component-expander (CE) with a BROKEN `raw` field, so CE's
 * `parseComponentBody` re-parse failed (E-COMPONENT-021), the component never
 * registered, and every use-site raised E-COMPONENT-020 (and the post-CE
 * invariant E-COMPONENT-035).
 *
 * ROOT CAUSE (collect-hoisted.js::synthComponentDef): the native
 * `MarkupValue.init.span` is bodyText-RELATIVE — an index INTO the enclosing
 * LogicEscape/Meta `bodyText`, NOT a host-absolute source offset. The pre-fix
 * code subtracted `blockSpan.start` as if `init.span` were host-absolute; for a
 * `${ }` LogicEscape (`blockSpan.start` points at `$`, > 0) this shifted the
 * slice LEFT and truncated the markup, leaking the LHS `nst Name =` prefix into
 * `raw`. The defect was masked for `^{ }` Meta blocks only because their
 * `blockSpan.start === 0` makes the subtraction a no-op.
 *
 * FIX LOCUS: the native→live shape boundary (collect-hoisted.js), not CE — CE
 * stays parser-agnostic. The corrected `raw` is the verbatim markup body, which
 * CE's `normalizeTokenizedRaw` (idempotent on already-canonical markup) +
 * `parseComponentBody` re-parse cleanly — the same shape the live ast-builder's
 * token-joined `component-def.raw` resolves to.
 *
 * S449: the first block used to DRIVE BOTH PIPELINES (live default + the
 * retired full-pipeline parser:"scrml-native") and assert parity. It now runs
 * the default pipeline only; the native fix (collect-hoisted.js
 * synthComponentDef — reached through `nativeParseFile`) is guarded by the
 * second block, which asserts the native component-def `raw` directly.
 *
 * SCOPE: same-file component-defs. The cross-file `export const Name = <markup>`
 * path (synthExportDecl `raw` slice) is a DISTINCT sub-cause split to a named
 * follow-on unit (M6.7-C1-followon: native export-decl raw slice) and is NOT
 * covered here.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";

function compileBoth(source) {
  const dir = mkdtempSync(join(tmpdir(), "m67-c1-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, source);
  try {
    const out = {};
    for (const parser of [null]) {
      const r = compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out") });
      let html = null;
      for (const [fp, output] of r.outputs) {
        if (fp.includes("app")) html = output.html ?? null;
      }
      const codes = (r.errors ?? []).map((e) => e && e.code).filter(Boolean);
      out[parser ?? "live"] = {
        e020: codes.filter((c) => c === "E-COMPONENT-020").length,
        e021: codes.filter((c) => c === "E-COMPONENT-021").length,
        e035: codes.filter((c) => c === "E-COMPONENT-035").length,
        html,
      };
    }
    return out;
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

// Assert: no component-registration errors on the default pipeline.
function expectClean(r) {
  expect(r.live.e020).toBe(0);
  expect(r.live.e021).toBe(0);
  expect(r.live.e035).toBe(0);
}

describe("M6.7-C1 — same-file component-def resolves (default pipeline)", () => {
  test("simple component: const Card = <div class=\"card\">hi</div>", () => {
    const r = compileBoth(`<program>
\${
  const Card = <div class="card">hi</div>
}
<div><Card/></div>
</program>`);
    expectClean(r);
    expect(r.live.html).toContain("card");
    expect(r.live.html).toContain("hi");
  });

  test("two sibling components in one logic block both register", () => {
    const r = compileBoth(`<program>
\${
  const Foo = <div>foo-body</div>

  const Bar = <div>bar-body</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`);
    expectClean(r);
    expect(r.live.html).toContain("foo-body");
    expect(r.live.html).toContain("bar-body");
  });

  test("void element in body + sibling (A7/A8 shape): <div><br></div> + Bar", () => {
    const r = compileBoth(`<program>
\${
  const Foo = <div><br></div>

  const Bar = <div>tail-x</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`);
    expectClean(r);
    expect(r.live.html).toContain("tail-x");
  });

  test("void element with bind:value + sibling", () => {
    const r = compileBoth(`<program>
\${ @x = "" }
\${
  const Foo = <div>
    <input bind:value=@x>
  </div>

  const Bar = <div>after-input</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`);
    expectClean(r);
    expect(r.live.html).toContain("after-input");
  });

  test("multi-line body with nested elements", () => {
    const r = compileBoth(`<program>
\${
  const Card = <div class="card">
    <h2>Title</h2>
    <p>Body text</p>
  </div>
}
<div><Card/></div>
</program>`);
    expectClean(r);
    expect(r.live.html).toContain("Title");
    expect(r.live.html).toContain("Body text");
  });

  test("component-def NOT at offset-0 block: leading content before the logic block", () => {
    // Reproduces the exact off-by-blockSpan.start bug: the logic block does not
    // start at source offset 0, so blockSpan.start > 0 and the old subtraction
    // produced garbage raw.
    const r = compileBoth(`<program>
<h1>Header</h1>
\${
  const Card = <div class="boxed">contents-here</div>
}
<div><Card/></div>
</program>`);
    expectClean(r);
    expect(r.live.html).toContain("contents-here");
  });

  test("multiple components after a sibling import in same block", () => {
    const r = compileBoth(`<program>
\${
  const Alpha = <div>alpha-one</div>
  const Beta = <section>beta-two</section>
  const Gamma = <article>gamma-three</article>
}
<div><Alpha/></div>
<div><Beta/></div>
<div><Gamma/></div>
</program>`);
    expectClean(r);
    expect(r.live.html).toContain("alpha-one");
    expect(r.live.html).toContain("beta-two");
    expect(r.live.html).toContain("gamma-three");
  });
});

// ---------------------------------------------------------------------------
// Parse-level raw-slice correctness — guards the ROOT-CAUSE fix directly at the
// native→live boundary (independent of CE / full-compile). The native
// component-def `raw` must be the EXACT verbatim markup body, for both `${ }`
// LogicEscape blocks (blockSpan.start > 0 — the broken case) and `^{ }` Meta
// blocks (blockSpan.start === 0 — the previously-masked case). This is the
// regression guard for the masked meta path: the fix must not break it.
// ---------------------------------------------------------------------------
describe("M6.7-C1 — native component-def raw is the verbatim markup body", () => {
  function nativeComponents(source) {
    const r = nativeParseFile("/tmp/m67c1.scrml", source);
    return r.ast.components ?? [];
  }

  test("LogicEscape ${ } block (blockSpan.start > 0): raw is full markup, no LHS leak", () => {
    const comps = nativeComponents(`<program>
\${
  const Card = <div class="card">hi</div>
}
<div><Card/></div>
</program>`);
    const card = comps.find((c) => c.name === "Card");
    expect(card).toBeTruthy();
    expect(card.raw).toBe('<div class="card">hi</div>');
    // Regression assertions for the specific defect: no truncation, no LHS leak.
    expect(card.raw.startsWith("<")).toBe(true);
    expect(card.raw).not.toContain("const");
    expect(card.raw).not.toContain("Card =");
  });

  test("Meta ^{ } block (blockSpan.start === 0, masked path): raw is full markup", () => {
    const comps = nativeComponents(`^{
  const Widget = <span class="w">widget-body</span>
}
<program><div/></program>`);
    const w = comps.find((c) => c.name === "Widget");
    expect(w).toBeTruthy();
    expect(w.raw).toBe('<span class="w">widget-body</span>');
  });

  test("multiple sibling component-defs each get their own correct raw", () => {
    const comps = nativeComponents(`<program>
\${
  const Foo = <div>foo</div>
  const Bar = <section>bar</section>
}
<div><Foo/></div><div><Bar/></div>
</program>`);
    const foo = comps.find((c) => c.name === "Foo");
    const bar = comps.find((c) => c.name === "Bar");
    expect(foo.raw).toBe("<div>foo</div>");
    expect(bar.raw).toBe("<section>bar</section>");
  });
});
