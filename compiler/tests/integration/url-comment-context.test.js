/**
 * url-comment-context (2026-07) — a bare URL in a CSS `url()` value or in markup
 * prose must COMPILE CLEAN and preserve the URL in the emitted output.
 *
 * Pre-fix the block-splitter treated the `//` in `http://` (and a
 * protocol-relative `url(//cdn)`) as a `//` line comment, eating to end-of-line
 * — swallowing the closing `}` of a `#{}` CSS block or the `</p>` closer — and
 * failing with a spurious E-CTX-001/E-CTX-003 unclosed context.
 *
 * SPEC §27.1 keeps `//` a UNIVERSAL comment valid in ALL contexts, so the fix is
 * a narrow URL-exemption (scheme `://` or a CSS `url(...)` token, in CSS +
 * markup-text only). A genuine `// comment` is still a comment (§27) — the last
 * test guards that a CSS `//` comment does not derail compilation.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "url-comment-ctx-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

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
  return { errors, html: read("html"), css: read("css"), clientJs: read("client.js") };
}

// Only URL-comment structural failures matter here — filter the unrelated
// W-PROGRAM / SPA-inference advisory warnings that a bare fragment triggers.
function ctxErrors(errors) {
  return errors.filter(e => typeof e.code === "string" && e.code.startsWith("E-CTX"));
}

describe("url-comment-context: bare URLs compile clean and survive to output", () => {
  test("CSS url(http://…) compiles with no E-CTX and preserves the URL", () => {
    const src = "<div>\n    #{ background: url(http://example.com/a.png) }\n    <p>Styled</>\n</div>";
    const { errors, css } = compileSource("css-url", src);
    expect(ctxErrors(errors)).toEqual([]);
    expect(css).toContain("url(http://example.com/a.png)");
  });

  test("protocol-relative CSS url(//cdn…) compiles with no E-CTX", () => {
    const src = "<div>\n    #{ background: url(//cdn.example.com/x.png) }\n    <p>Styled</>\n</div>";
    const { errors, css } = compileSource("css-protorel", src);
    expect(ctxErrors(errors)).toEqual([]);
    expect(css).toContain("url(//cdn.example.com/x.png)");
  });

  test("markup prose with http:// compiles with no E-CTX and preserves the URL", () => {
    const src = "<div>\n    <p>Visit http://example.com now</p>\n</div>";
    const { errors, html } = compileSource("markup-url", src);
    expect(ctxErrors(errors)).toEqual([]);
    expect(html).toContain("Visit http://example.com now");
  });

  test("a genuine // comment in CSS does not derail compilation (§27 preserved)", () => {
    const src = "<div>\n    #{ color: red; // a real comment\n       font-size: 16px }\n    <p>x</>\n</div>";
    const { errors } = compileSource("css-comment", src);
    expect(ctxErrors(errors)).toEqual([]);
  });
});
