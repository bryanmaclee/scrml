/**
 * W-DISPLAY-TEXT-OVERQUOTE — over-quoted display text in a nested plain-markup
 * free-text body inside a code-default-body context (§4.18.7 / §34, S181).
 *
 * The §4.18 code-default-body model: in an engine state-child / match-arm /
 * `:`-shorthand body a bare run is CODE and display text needs `"..."` quoting.
 * BUT a plain-markup element opened *inside* that body (`<p>`, `<span>`, any HTML
 * element) opens a FREE-TEXT body (§4.18.1, "body modes nest") — its content is
 * verbatim. An adopter who carries the code-default `"..."` habit into a nested
 * plain-markup element writes `<p>"loading..."</p>` and gets LITERAL quote marks
 * in the output with no diagnostic (spec-CORRECT but surprising). This info-level
 * lint surfaces it. It is the MIRROR of E-UNQUOTED-DISPLAY-TEXT (the under-quoting
 * case — bare prose in the code-default body itself).
 *
 * W- prefix → result.warnings (non-fatal, info). Tests assert over BOTH streams
 * (the S92 cross-stream rule) so a partition regression (a W- code silently moving
 * to result.errors, or vice-versa) is caught rather than silently passing.
 *
 * Fire site: type-system.ts `checkDisplayTextOverquote`. Ratified S181 (user:
 * "a lint is the right move there").
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "overquote-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// Cross-stream collector (S92): the lint is W-/Info → result.warnings, but
// collect over BOTH streams so a partition regression is caught. A
// `result.errors.filter(...)` on a W- code would silently pass when the code is
// (correctly) in result.warnings — the false-negative class this guards against.
function overquoteDiags(res) {
  return [...(res.errors || []), ...(res.warnings || [])]
    .filter((d) => d.code === "W-DISPLAY-TEXT-OVERQUOTE");
}

// ---------------------------------------------------------------------------
// POSITIVE — fires on a `"..."` sole-content nested plain-markup element in each
// of the actionable code-default-body loci
// ---------------------------------------------------------------------------

describe("W-DISPLAY-TEXT-OVERQUOTE — positive", () => {
  test("engine state-child: `<p>\"...\"</p>` fires (the verified reproducer)", () => {
    const res = compile(
`<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>
            <p>"loading..."</p>
        </Loading>
        <Ready rule=.Loading>
            <p>ready now</p>
        </Ready>
    </engine>
</program>`);
    const diags = overquoteDiags(res);
    expect(diags.length).toBe(1); // only the Loading arm's `<p>"..."</p>`
    // W- partition → result.warnings, never result.errors.
    expect((res.warnings || []).some((d) => d.code === "W-DISPLAY-TEXT-OVERQUOTE")).toBe(true);
    expect((res.errors || []).some((d) => d.code === "W-DISPLAY-TEXT-OVERQUOTE")).toBe(false);
    // Info severity.
    expect(diags[0].severity).toBe("info");
    // Message cites the §4.18 model + suggests bare text.
    expect(diags[0].message).toContain("§4.18");
    expect(diags[0].message).toContain("render");
  });

  test("markup-form `<match>` arm: `<p>\"...\"</p>` fires (armsRaw scan)", () => {
    const res = compile(
`<div>
    \${
        type Phase:enum = { Idle, Ready }
        <phase>: Phase = .Idle
    }
    <match for=Phase on=@phase>
        <Idle>
            <p>"please wait"</p>
        </>
        <Ready>
            <p>all set</p>
        </>
        <_>
            <p>other</p>
        </>
    </match>
</div>`);
    expect(overquoteDiags(res).length).toBeGreaterThanOrEqual(1);
    expect((res.warnings || []).some((d) => d.code === "W-DISPLAY-TEXT-OVERQUOTE")).toBe(true);
  });

  test("expression-form `match` arm: `<p>\"...\"</p>` fires (match-arm result scan)", () => {
    const res = compile(
`<program>
    type Phase:enum = { Loading, Ready }
    @phase: Phase = .Loading

    \${
        match @phase {
            .Loading => <p>"please wait"</p>
            .Ready => <p>all set</p>
        }
    }
</program>`);
    expect(overquoteDiags(res).length).toBeGreaterThanOrEqual(1);
    expect((res.warnings || []).some((d) => d.code === "W-DISPLAY-TEXT-OVERQUOTE")).toBe(true);
  });

  test("a `<span>` (different HTML element) fires identically", () => {
    const res = compile(
`<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>
            <span>"on the way"</span>
        </Loading>
        <Ready rule=.Loading>
            <span>done</span>
        </Ready>
    </engine>
</program>`);
    expect(overquoteDiags(res).length).toBe(1);
  });

  test("nested deeper (`<div><p>\"...\"</p></div>`) inside a state-child still fires", () => {
    const res = compile(
`<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>
            <div><p>"hold on"</p></div>
        </Loading>
        <Ready rule=.Loading>
            <div><p>done</p></div>
        </Ready>
    </engine>
</program>`);
    expect(overquoteDiags(res).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — the controls that MUST stay silent
// ---------------------------------------------------------------------------

describe("W-DISPLAY-TEXT-OVERQUOTE — negative (must stay silent)", () => {
  test("bare text in the same nested plain-markup element does NOT fire", () => {
    const res = compile(
`<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>
            <p>loading now</p>
        </Loading>
        <Ready rule=.Loading>
            <p>ready now</p>
        </Ready>
    </engine>
</program>`);
    expect(overquoteDiags(res).length).toBe(0);
  });

  test("a `\"...\"` literal DIRECTLY in the code-default body (the CORRECT §4.18.3 form) does NOT fire", () => {
    const res = compile(
`<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>"loading..."</Loading>
        <Ready rule=.Loading>"all set"</Ready>
    </engine>
</program>`);
    expect(overquoteDiags(res).length).toBe(0);
  });

  test("a quoted string in plain markup OUTSIDE any code-default body does NOT fire", () => {
    const res = compile(
`<program>
    <div>
        <p>"This is fine outside any code-default body"</p>
    </div>
</program>`);
    expect(overquoteDiags(res).length).toBe(0);
  });

  test("a NON-sole-content quoted string (`<p>\"a\" and \"b\"</p>`) does NOT fire", () => {
    const res = compile(
`<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>
            <p>"a" and "b"</p>
        </Loading>
        <Ready rule=.Loading>
            <p>done</p>
        </Ready>
    </engine>
</program>`);
    expect(overquoteDiags(res).length).toBe(0);
  });

  test("a `:`-shorthand display-text literal (quotes stripped by §4.18.3 — correct) does NOT fire", () => {
    const res = compile(
`<program>
    @label = "x"
    <div>
        <span : "On the way.">
    </div>
</program>`);
    expect(overquoteDiags(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EMIT BYTE-IDENTITY — the lint is purely additive; it does NOT change codegen.
// The literal quotes STILL render (spec-correct free-text verbatim); the lint
// only ADDS the info diagnostic. This is the R26-style no-codegen-change proof.
// ---------------------------------------------------------------------------

describe("W-DISPLAY-TEXT-OVERQUOTE — emit unchanged (lint-only)", () => {
  test("the literal quotes still render in the emitted HTML + client.js", () => {
    const fp = join(TMP, `emit-${Math.random().toString(36).slice(2)}.scrml`);
    const dist = join(TMP, `emit-dist-${Math.random().toString(36).slice(2)}`);
    writeFileSync(fp,
`<program>
    type Phase:enum = { Loading, Ready }

    <engine for=Phase initial=.Loading>
        <Loading rule=.Ready>
            <p>"loading..."</p>
        </Loading>
        <Ready rule=.Loading>
            <p>ready now</p>
        </Ready>
    </engine>
</program>`);
    const res = compileScrml({ inputFiles: [fp], outputDir: dist, write: true, log: () => {} });
    // The lint fired (info) ...
    expect(overquoteDiags(res).length).toBe(1);
    // ... AND the emit is unchanged: the literal quotes still render verbatim in
    // the free-text body (the footgun output we are diagnosing, NOT rewriting).
    const htmlFile = readdirSync(dist).find((f) => f.endsWith(".html"));
    const html = readFileSync(join(dist, htmlFile), "utf8");
    // The engine renders its INITIAL state (.Loading) into the server HTML — the
    // over-quoted `<p>"loading..."</p>` renders with LITERAL quote marks (the
    // footgun output we diagnose but do NOT rewrite).
    expect(html).toContain('<p>"loading..."</p>');     // literal quotes preserved
    // The .Ready arm (`<p>ready now</p>`) swaps in client-side, so it lives in
    // the client.js arm table — both arms carry their verbatim body text.
    const clientFile = readdirSync(dist).find((f) => f.endsWith(".client.js"));
    const client = readFileSync(join(dist, clientFile), "utf8");
    expect(client).toContain('<p>\\"loading...\\"</p>'); // escaped literal quotes preserved
    expect(client).toContain('<p>ready now</p>');           // control body verbatim
  });
});
