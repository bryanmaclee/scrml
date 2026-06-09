/**
 * opener-arrow-truncation-bug48.test.js — S177 bug-48 (LOW).
 *
 * An inline `=>` arrow inside an `on=` (or any attribute) expression in a
 * `<match>` / `<engine>` / `<machine>` opener truncated the opener header. Three
 * opener-end finders in ast-builder.js (`_findMatchOpenerEnd` x2, `_findOpenerEnd`
 * for machine/engine) tracked only brace + string depth — NOT paren/bracket
 * depth, which the FIXED `_findEachOpenerEnd` already has. So a `>` inside an
 * `=>` arrow within `on=@nums.filter(c => c == 1)` was read as the opener's
 * closing `>`, truncating the header at `@nums.filter(c =`.
 *
 * Fix (ast-builder.js): port the parenDepth + bracketDepth pattern to the three
 * sibling finders AND to the two `on=expr` capture loops (whose attribute-
 * boundary scan also lacked paren/bracket tracking, so the arrow BODY `c == 1`
 * looked like a `c=` attribute and truncated the capture).
 *
 * Fix (emit-match.ts): the complex-expression `on=` fall-through emitted the raw
 * scrml text VERBATIM into the dispatch call, leaking the `@` sigil + scrml
 * operators (`==`) into emitted JS (E-CODEGEN-INVALID-JS). It now lowers the
 * expression through parseExprToNode + emitExpr (the same helpers the arm-body
 * path uses), so `@nums` -> `_scrml_reactive_get("nums")` and `==` ->
 * `_scrml_structural_eq`.
 *
 * Coverage:
 *   §1 — `<match on=@nums.filter(c => c == 1)>` compiles clean + lowers correctly
 *   §2 — `<engine ... on=@nums.filter(c => c == 1)>` compiles clean
 *   §3 — `<machine ... on=@nums.filter(c => c == 1)>` compiles clean
 *   §4 — control: `<match on=@nums>` (no arrow) still lowers to reactive_get
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "bug48-arrow-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: true, log: () => {} });
  return result;
}
function fatalCodes(result) {
  return (result.errors || [])
    .filter((e) => e && e.severity !== "warning" && e.severity !== "info")
    .map((e) => e.code);
}
function clientJs(filename) {
  const base = filename.replace(/\.scrml$/, "");
  const p = join(TMP, "dist", base + ".client.js");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

describe("§1 <match> opener with inline `=>` arrow in on=", () => {
  test("`<match on=@nums.filter(c => c == 1)>` compiles clean (no E-CODEGEN-INVALID-JS)", () => {
    const result = compile("m.scrml", `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready }
        <nums>: list of int = []
        <phase>: Phase = .Idle
    }
    <h1>Loader</h1>
    <match for=Phase on=@nums.filter(c => c == 1)>
        <Idle><p data-arm="idle">Press to load</p></>
        <Loading><p data-arm="loading">Loading now</p></>
        <Ready><p data-arm="ready">All set</p></>
        <_><p data-arm="fallback">Something else</p></>
    </match>
</div>`);
    expect(fatalCodes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    expect(fatalCodes(result)).toEqual([]);
    // The arrow + @cell + == lowered, not emitted verbatim.
    const js = clientJs("m.scrml");
    expect(js).toContain('_scrml_reactive_get("nums")');
    expect(js).not.toContain("@nums");
  });
});

describe("§2 <engine> opener with inline `=>` arrow in on=", () => {
  test("`<engine ... on=@nums.filter(c => c == 1)>` compiles clean", () => {
    const result = compile("e.scrml", `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready }
        <nums>: list of int = []
    }
    <h1>Loader</h1>
    <engine for=Phase initial=.Idle on=@nums.filter(c => c == 1)>
        <Idle rule=.Loading><p>Idle</p></>
        <Loading rule=.Ready><p>Loading</p></>
        <Ready><p>Ready</p></>
    </engine>
</div>`);
    expect(fatalCodes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    expect(fatalCodes(result)).toEqual([]);
  });
});

describe("§3 <machine> opener with inline `=>` arrow in on=", () => {
  test("`<machine ... on=@nums.filter(c => c == 1)>` compiles clean", () => {
    const result = compile("ma.scrml", `<div>
    \${
        type Light:enum = { Red, Green }
        <nums>: list of int = []
    }
    <machine for=Light initial=.Red on=@nums.filter(c => c == 1)>
        <Red rule=.Green><p>red</p></>
        <Green><p>green</p></>
    </machine>
</div>`);
    expect(fatalCodes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    expect(fatalCodes(result)).toEqual([]);
  });
});

describe("§4 control: <match on=@nums> (no arrow) unchanged", () => {
  test("bare `on=@nums` still lowers to a reactive subscribe", () => {
    const result = compile("ctrl.scrml", `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready }
        <nums>: list of int = []
    }
    <match for=Phase on=@nums>
        <Idle><p>idle</p></>
        <Loading><p>loading</p></>
        <Ready><p>ready</p></>
        <_><p>fallback</p></>
    </match>
</div>`);
    expect(fatalCodes(result)).toEqual([]);
    const js = clientJs("ctrl.scrml");
    expect(js).toContain('_scrml_reactive_get("nums")');
  });
});
