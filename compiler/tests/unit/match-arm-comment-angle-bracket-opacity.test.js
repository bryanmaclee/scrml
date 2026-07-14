/**
 * match-arm-comment-angle-bracket-opacity.test.js
 *
 * Regression for g-markup-comment-angle-bracket-parsed-as-tag (ss39 item 1).
 *
 * Bug: BS captures a `<match>` body as a single raw text run
 * (STRUCTURAL_RAW_BODY_ELEMENTS), so any comment inside an arm body survives
 * verbatim into `armsRaw`. The arm scanners in match-statechild-parser.ts
 * (`findArmCloser`, `findNextArmOpener`, and the main loop's stray-content
 * advance) treated every `<` as a structural opener/closer — including
 * angle-bracket FRAGMENTS inside a line comment, block comment, or HTML
 * comment. So an arm body of:
 *
 *     <Idle>
 *         // NOT a <form> — use the <each> helper instead
 *         <p>...</p>
 *     </>
 *
 * had its `<form>` / `<each>` consumed as openers; the close-finder's nesting
 * depth never unwound, the arm looked unclosed, and a misleading
 * E-MATCH-PARSE-001 ("arm has no matching closer") + E-MATCH-NOT-EXHAUSTIVE
 * fired on an otherwise well-formed arm/match.
 *
 * Fix: a local `skipMatchComment` helper (mirroring BS's findStructuralBodyEnd
 * skip-zones EXACTLY — skipLineComment / skipBlockComment / skipHtmlComment)
 * is consulted at the top of each arm scanner. Comment text is inert trivia
 * (SPEC §27.1 universal line comment; §27.2 markup-native HTML comment; the
 * block-comment form is matched for body-span parity with the BS raw-body scan).
 *
 * Contrast with engine-statechild-comment-opacity.test.js (ss4 item 2) — that
 * test's header claimed the `<match>` scanner was "NOT affected"; it WAS
 * (the engine fix used computeCommentRegions; the match scanner had no
 * comment handling at all). This test closes the match locus.
 *
 * Two layers:
 *   - Direct `parseMatchArms(armsRaw)` — precise per-form coverage.
 *   - Full-pipeline `compileScrml` (R26) — real .scrml through BS to CG; the
 *     bug is upstream at the scanner, so a hand-built AST would miss it.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { parseMatchArms } from "../../src/match-statechild-parser.ts";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Compile a scrml source string through the full pipeline and return
 * { errors, html, clientJs }.
 */
function compileSource(scrmlSource, testName) {
  const tag = testName ?? `match-comment-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_match_comment_${tag}`);
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
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        html = output.html ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

const variantsOf = (armsRaw) => parseMatchArms(armsRaw).arms.map((a) => a.variantName);
const diagsOf = (armsRaw) => parseMatchArms(armsRaw).diagnostics.map((d) => d.code);

// ---------------------------------------------------------------------------
// Direct parseMatchArms — comment opacity in every arm scanner position
// ---------------------------------------------------------------------------

describe("match arm scanner — comment opacity (ss39 item 1)", () => {
  test("baseline: no comment, two bare-body arms parse", () => {
    const arms = `
      <Idle><p>idle</p></>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
  });

  test("`//` comment with <form>/<each> fragments inside an arm body is inert", () => {
    const arms = `
      <Idle>
        // NOT a <form> — use the <each> helper instead
        <p>idle</p>
      </>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
  });

  test("`/* */` block comment with fragments inside an arm body is inert", () => {
    const arms = `
      <Idle>
        /* NOT a <form> — use the <each> helper */
        <p>idle</p>
      </>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
  });

  test("`<!-- -->` HTML comment with fragments inside an arm body is inert", () => {
    const arms = `
      <Idle>
        <!-- not a <form> nor <each> -->
        <p>idle</p>
      </>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
  });

  test("multiple tag-fragments incl. a closer fragment on one comment line are inert", () => {
    const arms = `
      <Idle>
        // a <x> b <y> c </z> all inert
        <p>idle</p>
      </>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
  });

  test("between-arms comment mentioning a PascalCase tag is not read as an arm-opener", () => {
    const arms = `
      // see the <Loading> form? use <Each> instead
      <Idle><p>idle</p></>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
  });

  test("block comment then real markup on one line — the real opener still parses", () => {
    const arms = `
      <Idle>/* <x> */ <p>idle</p></>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
  });

  test("`//` inside an attribute value is NOT a comment (URL-ish href preserved)", () => {
    const arms = `
      <Idle><a href="//cdn.example.com/x.js">cdn</a></>
      <Ready><p>ready</p></>
    `;
    expect(variantsOf(arms)).toEqual(["Idle", "Ready"]);
    expect(diagsOf(arms)).toEqual([]);
    // The href attr value survives intact in the parsed arm body.
    expect(parseMatchArms(arms).arms[0].bodyRaw).toContain('href="//cdn.example.com/x.js"');
  });
});

// ---------------------------------------------------------------------------
// Full-pipeline (R26) — real .scrml compile; bug is upstream at the scanner
// ---------------------------------------------------------------------------

const matchFile = (armBody, extraArms) => `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready, Failed }
        <phase>: Phase = .Idle
    }
    <match for=Phase on=@phase>
        <Idle>
${armBody}
        </>
        <Loading><p data-arm="loading">l</p></>
        <Ready><p data-arm="ready">r</p></>
        <_><p data-arm="fallback">f</p></>
    </match>
</div>
`;

const matchParseErrors = (errs) =>
  errs.filter((e) => /^E-(MATCH|CTX)/.test(e.code ?? ""));

describe("match arm comment opacity — full pipeline (R26)", () => {
  test("primary repro: `//` comment with <form>/<each> compiles clean (no spurious E-MATCH-*)", () => {
    const src = matchFile(`            // NOT a <form> — use the <each> helper instead
            <p data-arm="idle">Press to load</p>`);
    const { errors, html, clientJs } = compileSource(src, "primary-line-comment");
    expect(matchParseErrors(errors)).toEqual([]);
    // The comment's angle-bracket fragments must NOT have leaked as elements.
    const out = `${html ?? ""}\n${clientJs ?? ""}`;
    expect(out).not.toMatch(/createElement\(["']form["']\)/);
    expect(out).not.toMatch(/createElement\(["']each["']\)/);
  });

  test("block comment with fragments compiles clean", () => {
    const src = matchFile(`            /* NOT a <form> — use the <each> helper */
            <p data-arm="idle">Press to load</p>`);
    const { errors } = compileSource(src, "block-comment");
    expect(matchParseErrors(errors)).toEqual([]);
  });

  test("HTML comment with fragments compiles clean", () => {
    const src = matchFile(`            <!-- not a <form> nor <each> -->
            <p data-arm="idle">Press to load</p>`);
    const { errors } = compileSource(src, "html-comment");
    expect(matchParseErrors(errors)).toEqual([]);
  });

  test("attribute `//` (URL href) still compiles and is preserved in output", () => {
    const src = matchFile(`            <a href="//cdn.example.com/x.js">cdn</a>`);
    const { errors, html, clientJs } = compileSource(src, "attr-url");
    expect(matchParseErrors(errors)).toEqual([]);
    // Match arms render client-side into the mount slot, so the href lives in
    // the emitted clientJs (the static HTML carries only the mount <div>).
    const out = `${html ?? ""}\n${clientJs ?? ""}`;
    expect(out).toContain("//cdn.example.com/x.js");
  });
});
