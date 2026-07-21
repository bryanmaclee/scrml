/**
 * `<script>` in scrml SOURCE is a HARD ERROR — `E-SCRIPT-001` (S277 ruling).
 *
 * scrml does not admit `<script>` AT ALL. JS lives in logic-context `${...}`;
 * genuine foreign code has the `_{...}` escape hatch (SPEC §23). This mirrors
 * `<style>` -> `E-STYLE-001` exactly, including the fire site
 * (`block-splitter.js`, markup-opener path) and the scan-to-close recovery.
 *
 * Before this rule, a `<script>` element compiled CLEAN and its body passed
 * through VERBATIM into the emitted document — a probe body containing
 * `window.__pwned = 1` reached the output untouched.
 *
 * The must-NOT-fire cases below are the load-bearing half of this file. A
 * source-side element rejection is exactly the shape that leaks into comments,
 * strings, raw-content bodies, and the compiler's own emitted output.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { splitBlocks, BSError } from "../../src/block-splitter.js";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorsOf(source) {
  return splitBlocks("test.scrml", source).errors;
}

function codesOf(source) {
  return errorsOf(source).map((e) => e.code);
}

/** Assert `source` produces at least one E-SCRIPT-001, returning it. */
function expectScriptError(source) {
  const errs = errorsOf(source);
  const match = errs.find((e) => e.code === "E-SCRIPT-001");
  expect(
    match,
    `Expected E-SCRIPT-001 but got: ${JSON.stringify(errs.map((e) => e.code))}`,
  ).toBeDefined();
  expect(match).toBeInstanceOf(BSError);
  return match;
}

/** Assert `source` produces NO E-SCRIPT-001 (other pre-existing codes are OK). */
function expectNoScriptError(source) {
  const codes = codesOf(source);
  expect(
    codes.includes("E-SCRIPT-001"),
    `Expected NO E-SCRIPT-001 but got: ${JSON.stringify(codes)}`,
  ).toBe(false);
}

/** A canonical, clean-compiling program (the examples/02-counter.scrml shape). */
const CANONICAL_PROGRAM = `<program>

  <count> = 0

  function increment() { @count = @count + 1 }

<div class="p-8">
  <h1 class="text-3xl font-bold">Counter</h1>
  <p class="text-6xl">\${@count}</p>
  <button class="px-5 py-2" onclick=increment()>+</button>
</div>

</program>
`;

function compileSource(source, basename = "app") {
  const dir = mkdtempSync(join(tmpdir(), "scrml-script-reject-"));
  try {
    const file = join(dir, `${basename}.scrml`);
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    return {
      html: out.html ?? "",
      clientJs: out.clientJs ?? "",
      errors: r.errors ?? [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// MUST FIRE
// ---------------------------------------------------------------------------

describe("E-SCRIPT-001 — <script> is rejected in scrml source", () => {
  test("<script> with a JS body fires E-SCRIPT-001", () => {
    const err = expectScriptError(
      `<program>\n<script>\nwindow.__pwned = 1;\n</script>\n<p>hi</>\n</program>`,
    );
    // The message must name the resolution, the way E-STYLE-001 names `#{}`.
    expect(err.message).toContain("${...}");
  });

  test("message points at the `_{...}` foreign-code block for genuine JS (§23)", () => {
    const err = expectScriptError(`<program>\n<script>x()</script>\n</program>`);
    expect(err.message).toContain("_{...}");
    expect(err.message).toContain("§23");
  });

  test("message invents no --convert-legacy-* hint (none exists for <script>)", () => {
    const err = expectScriptError(`<program>\n<script>x()</script>\n</program>`);
    expect(err.message).not.toContain("--convert-legacy");
  });

  test("<script src=…></script> fires E-SCRIPT-001", () => {
    expectScriptError(
      `<program>\n<script src="https://cdn.example/x.js"></script>\n<p>hi</>\n</program>`,
    );
  });

  test("rejection is case-insensitive (<Script> / <SCRIPT>)", () => {
    expectScriptError(`<program>\n<Script>x()</Script>\n</program>`);
    expectScriptError(`<program>\n<SCRIPT>x()</SCRIPT>\n</program>`);
  });

  test("recovery: a brace-heavy JS body yields ONE error, not a cascade", () => {
    // Without scan-to-</script> recovery, every `{`/`}`/`<` in this body would
    // derail the splitter into a storm of unrelated parse errors.
    const source = `<program>
<script>
  function f(a) { if (a < 1) { return { x: 1, y: [2, 3] }; } }
  const g = (b) => { for (let i = 0; i < b; i++) { console.log(i); } };
  if (a < b && c > d) { f({ nested: { deep: true } }); }
</script>
<p>after</>
</program>`;
    const codes = codesOf(source);
    expect(codes).toEqual(["E-SCRIPT-001"]);
  });

  test("recovery resumes: markup AFTER </script> still splits normally", () => {
    const result = splitBlocks(
      "test.scrml",
      `<program>\n<script>if (x) { y(); }</script>\n<p>after</>\n</program>`,
    );
    expect(result.errors.map((e) => e.code)).toEqual(["E-SCRIPT-001"]);
    // The trailing <p> must survive the recovery scan.
    const flat = JSON.stringify(result.blocks);
    expect(flat).toContain("after");
  });
});

// ---------------------------------------------------------------------------
// MUST NOT FIRE — the false-positive guard rail
// ---------------------------------------------------------------------------

describe("E-SCRIPT-001 — must NOT fire", () => {
  // Case 1. Real ecosystem text. Every `<script` occurrence across the scrml
  // ecosystem lives inside a `//` comment comparing scrml to Svelte/Vue. If the
  // rule fired here it would break prose that mentions the rejected element.
  // (S264's E-SQL-003 shipped a comment-cloak bypass in this exact area.)
  test("<script> inside a `//` comment — verbatim gauntlet-teams/team-4/app.scrml:852", () => {
    expectNoScriptError(
      `<program>\n// Svelte equivalent: let statements in <script> block\n<p>hi</>\n</program>`,
    );
  });

  test("<script setup> inside a `//` comment — verbatim round3/twitter/vue/app.scrml:158", () => {
    expectNoScriptError(
      `<program>\n// Vue's <script setup> = \${} block. Vue's <template> = markup.\n<p>hi</>\n</program>`,
    );
  });

  test("<script src=…> inside a `//` comment — verbatim round10/bun/response-graph.scrml:140", () => {
    expectNoScriptError(
      `<program>\n//   - No <script src="..."> for CDN libraries\n<p>hi</>\n</program>`,
    );
  });

  test("<script> inside an HTML comment", () => {
    expectNoScriptError(
      `<program>\n<!-- <script>alert(1)</script> -->\n<p>hi</>\n</program>`,
    );
  });

  // Case 2. String literal in a logic context.
  test("<script> inside a string literal in a logic context", () => {
    expectNoScriptError(
      `<program>\n\${\n  @tag = "<script>alert(1)</script>"\n}\n<p>hi</>\n</program>`,
    );
  });

  test("<script> inside a single-quoted string literal", () => {
    expectNoScriptError(
      `<program>\n\${\n  @tag = '<script src="x.js"></script>'\n}\n<p>hi</>\n</program>`,
    );
  });

  // Case 3. §4.17 raw-content elements — their bodies are a single text run and
  // scrml tokens are not recognized inside.
  test("<script> text inside <pre> (§4.17 raw-content)", () => {
    expectNoScriptError(
      `<program>\n<pre><script>alert(1)</script></pre>\n</program>`,
    );
  });

  test("<script> text inside <code> (§4.17 raw-content)", () => {
    expectNoScriptError(
      `<program>\n<code><script>alert(1)</script></code>\n</program>`,
    );
  });

  // Case 4. `<noscript>` is a DIFFERENT element. readIdent() accumulates the
  // full `[A-Za-z0-9_-]+` ident, so an exact `=== "script"` compare cannot
  // prefix-match it. This test pins that exactness.
  test("<noscript> is untouched (no prefix match on readIdent)", () => {
    expectNoScriptError(
      `<program>\n<noscript><p>enable js</></noscript>\n</program>`,
    );
  });

  test("other script-prefixed idents are untouched", () => {
    expectNoScriptError(`<program>\n<scriptish>x</scriptish>\n</program>`);
    expectNoScriptError(`<program>\n<script-host>x</script-host>\n</program>`);
  });

  // Regression pin: the sibling rule must be unaffected by this change.
  test("<style> still fires E-STYLE-001 and NOT E-SCRIPT-001", () => {
    const codes = codesOf(
      `<program>\n<style>body { color: red }</style>\n</program>`,
    );
    expect(codes).toContain("E-STYLE-001");
    expect(codes).not.toContain("E-SCRIPT-001");
  });
});

// ---------------------------------------------------------------------------
// Case 5. The compiler's OWN emitted output.
//
// The emitter produces `<script src="scrml-runtime.<hash>.js">` and
// `<script src="<page>.client.js">`. This rule is SOURCE-side only and must
// never see those. This is the check that catches a source-side rule wrongly
// applied to emitted output.
// ---------------------------------------------------------------------------

describe("E-SCRIPT-001 — the compiler's own emitted <script> tags survive", () => {
  test("a canonical program compiles clean", () => {
    const { errors } = compileSource(CANONICAL_PROGRAM);
    expect(errors.map((e) => e.code ?? String(e))).toEqual([]);
  });

  test("emitted HTML still carries the runtime + client-bundle <script> tags", () => {
    const { html } = compileSource(CANONICAL_PROGRAM);

    // Non-empty guard: a broken compile emits "" and every `toContain` below
    // would fail confusingly rather than reporting the real cause.
    expect(html.length).toBeGreaterThan(0);

    expect(html).toMatch(/<script\s+src="scrml-runtime\.[^"]+\.js"/);
    expect(html).toMatch(/<script\s+src="app\.client\.js"/);
  });

  test("the emitted <script> tags are not stripped or rewritten", () => {
    const { html } = compileSource(CANONICAL_PROGRAM);
    const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    // Exactly the two emitter-owned tags, in emit order.
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain("scrml-runtime.");
    expect(tags[1]).toContain("app.client.js");
  });
});
