/**
 * url-comment-match-engine (2026-07-09) — a bare URL in `<match>` / `<engine>`
 * arm PROSE must COMPILE CLEAN and survive to output.
 *
 * Follow-on to url-comment-context (the block-splitter half). BS now captures
 * the arm body raw (findStructuralBodyEnd URL-exemption), but the arm
 * RE-TOKENIZERS have their OWN `//` line-comment scanners:
 *   - match-statechild-parser.ts `skipMatchComment`
 *   - engine-statechild-parser.ts `skipCommentOrString`
 * Pre-fix, a `//` inside a URL (`http://` / `https://`) in arm prose was eaten
 * to end-of-line, swallowing the arm's `</p>` / `</>` closer:
 *   - match → E-MATCH-PARSE-001 ("arm has no matching closer") + E-MATCH-NOT-EXHAUSTIVE
 *   - engine → E-ENGINE-STATE-CHILD-MISSING (scanner walked past the real closer)
 *
 * SPEC §27.1 keeps `//` a UNIVERSAL comment valid in ALL contexts, so the fix is
 * the SAME narrow URL-exemption the BS half used (shared `urlSlashesAt`): only a
 * genuine URL (scheme `://` or a `url(...)` token) is exempted. A real
 * `// comment` (whitespace/line-start before the `//`) is STILL a comment — the
 * regression tests below guard that a `//` comment inside an arm body still
 * strips and does not derail arm parsing.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "url-comment-me-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  const read = (ext) => {
    try { return readFileSync(join(outDir, `${name}.${ext}`), "utf8"); }
    catch { return ""; }
  };
  return { errors, html: read("html"), clientJs: read("client.js") };
}

// The URL-comment failure surfaces as arm-parse / state-child structural errors.
// Filter to those code families so unrelated fragment advisories don't confuse.
function armErrors(errors) {
  return errors.filter(e =>
    typeof e.code === "string" &&
    (e.code.startsWith("E-MATCH") || e.code.startsWith("E-ENGINE")),
  );
}

describe("url-comment-match-engine: URLs in match/engine arm prose compile clean", () => {
  test("<match> arm prose with http:// compiles (no E-MATCH-PARSE-001) and preserves the URL", () => {
    const src =
      "<div>\n" +
      "    ${\n" +
      "        type Phase:enum = { Idle, Loading, Ready, Failed }\n" +
      "        <phase>: Phase = .Idle\n" +
      "    }\n" +
      "    <match for=Phase on=@phase>\n" +
      "        <Idle> <p>See http://example.com/x here</p> </>\n" +
      "        <Loading> <p>Loading</p> </>\n" +
      "        <Ready> <p>Ready</p> </>\n" +
      "        <_> <p>Other</p> </>\n" +
      "    </match>\n" +
      "</div>";
    const { errors, html, clientJs } = compileSource("match-url", src);
    expect(armErrors(errors)).toEqual([]);
    expect(html + clientJs).toContain("http://example.com/x");
  });

  test("<engine> state-child prose with https:// compiles (no E-ENGINE-STATE-CHILD-MISSING) and preserves the URL", () => {
    const src =
      "${\n" +
      "    type PhaseTag:enum = { Idle, Loading, Done }\n" +
      "}\n" +
      "<engine for=PhaseTag initial=.Idle>\n" +
      "    <Idle rule=.Loading> <p>Docs at https://example.com/guide here</p> </>\n" +
      "    <Loading rule=.Done> <p>Loading</p> </>\n" +
      "    <Done rule=.Idle> <p>Done</p> </>\n" +
      "</>\n" +
      "<program>\n" +
      "<div><h1>${@phaseTag.variant}</h1></div>\n" +
      "</program>";
    const { errors, html, clientJs } = compileSource("engine-url", src);
    expect(armErrors(errors)).toEqual([]);
    expect(html + clientJs).toContain("https://example.com/guide");
  });

  // ---- Regression guards: a genuine // comment in an arm body still strips ----

  test("a genuine // comment inside a <match> arm body is still stripped (no derail)", () => {
    const src =
      "<div>\n" +
      "    ${\n" +
      "        type Phase:enum = { Idle, Loading, Ready, Failed }\n" +
      "        <phase>: Phase = .Idle\n" +
      "    }\n" +
      "    <match for=Phase on=@phase>\n" +
      "        <Idle>\n" +
      "            // a real comment mentioning <form> and <each>\n" +
      "            <p>Idle</p>\n" +
      "        </>\n" +
      "        <Loading> <p>Loading</p> </>\n" +
      "        <Ready> <p>Ready</p> </>\n" +
      "        <_> <p>Other</p> </>\n" +
      "    </match>\n" +
      "</div>";
    const { errors, html, clientJs } = compileSource("match-comment", src);
    expect(armErrors(errors)).toEqual([]);
    // The comment text (and the tag-fragments inside it) did NOT reach output.
    expect(html + clientJs).not.toContain("a real comment");
  });

  test("a genuine // comment inside an <engine> state-child body is still stripped (no derail)", () => {
    const src =
      "${\n" +
      "    type PhaseTag:enum = { Idle, Loading, Done }\n" +
      "}\n" +
      "<engine for=PhaseTag initial=.Idle>\n" +
      "    <Idle rule=.Loading>\n" +
      "        // a real comment mentioning <form>\n" +
      "        <p>Idle</p>\n" +
      "    </>\n" +
      "    <Loading rule=.Done> <p>Loading</p> </>\n" +
      "    <Done rule=.Idle> <p>Done</p> </>\n" +
      "</>\n" +
      "<program>\n" +
      "<div><h1>${@phaseTag.variant}</h1></div>\n" +
      "</program>";
    const { errors, html, clientJs } = compileSource("engine-comment", src);
    expect(armErrors(errors)).toEqual([]);
    expect(html + clientJs).not.toContain("a real comment");
  });
});
