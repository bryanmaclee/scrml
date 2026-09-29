/**
 * S441 — a `<program>` / `<page>` / `<channel>` body carries no loose prose;
 * displayed text is DECLARED (SPEC §40.8 S441 bullet, §4.18.1 S441 amendment,
 * §4.18.7). Ruling: user-voice-scrml.md S441 "prose should be declared as such"
 * + "declared-prose implementation: yes to all four".
 *
 * Every behavioural case runs through BOTH front ends (the default
 * splitBlocks+buildAST pipeline and `--parser=scrml-native`), because the rule
 * is a language rule, not a pipeline feature.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { segmentBodyTopItems, bodyTopQuoteStartsStatement, scanBodyTopLiteralClose } from "../../native-parser/body-top-prose.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const DIR = "/tmp/s441-declared-prose-body-fixtures";
mkdirSync(DIR, { recursive: true });

let n = 0;
function compile(source, parser) {
  const f = join(DIR, `case-${++n}.scrml`);
  writeFileSync(f, source);
  const out = join(DIR, `out-${n}`);
  if (existsSync(out)) rmSync(out, { recursive: true });
  const r = compileScrml({ inputFiles: [f], outputDir: out, write: true, log: () => {}, parser: parser ?? null });
  const errors = r.errors ?? [];
  const html = existsSync(join(out, `case-${n}.html`)) ? readFileSync(join(out, `case-${n}.html`), "utf8") : "";
  const m = html.match(/<body>([\s\S]*?)<script/);
  const body = (m ? m[1] : "").replace(/\s+/g, " ").trim();
  const client = existsSync(join(out, `case-${n}.client.js`)) ? readFileSync(join(out, `case-${n}.client.js`), "utf8") : "";
  return { errors, codes: errors.map((e) => e.code), body, client };
}

const PIPELINES = [["default", null], ["scrml-native", "scrml-native"]];

describe("S441 — body-top segmenter (shared by both front ends)", () => {
  test("a statement-start `\"...\"` is a literal; the rest is code", () => {
    const r = segmentBodyTopItems([{ type: "text", raw: "\n<x> = 1\n\"hi there\"\nfoo()\n" }]);
    const segs = r.segments[0];
    expect(segs.map((s) => s.kind)).toEqual(["code", "literal", "code"]);
    expect(segs[1].value).toBe("hi there");
  });
  test("an operand `\"...\"` (after `=`, or followed by `+`/`.`) stays code", () => {
    for (const raw of ["const s =\n  \"x\"\n", "\"a\" + b\n", "\"x\".length\n", "f(\"x\")\n"]) {
      const segs = segmentBodyTopItems([{ type: "text", raw }]).segments[0];
      expect(segs.every((s) => s.kind === "code")).toBe(true);
    }
  });
  test("escapes decode and `<` `>` `&` are HTML-escaped (§4.18.3 / §4.18.6)", () => {
    const segs = segmentBodyTopItems([{ type: "text", raw: "\"say \\\"hi\\\" a<b & c\"\n" }]).segments[0];
    expect(segs[0].value).toBe("say \"hi\" a&lt;b &amp; c");
  });
  test("a `${…}` inside a literal is an interpolation; after it the literal continues", () => {
    const r = segmentBodyTopItems([
      { type: "text", raw: "\n\"Count is " }, { type: "interp" }, { type: "text", raw: " now\"\n" },
    ]);
    expect(r.interpInLiteral).toEqual([false, true, false]);
    expect(r.segments[0].map((s) => s.kind)).toEqual(["code", "literal"]);
    expect(r.segments[2][0]).toMatchObject({ kind: "literal", value: " now", closes: true });
  });
  test("an unterminated literal is reported at its opening quote", () => {
    const r = segmentBodyTopItems([{ type: "text", raw: "\n\"oops" }, { type: "break" }]);
    expect(r.unterminated).toEqual([{ itemIndex: 0, offset: 1 }]);
  });
  test("scanner predicates: statement start + close (a line opening with `<` ends the search)", () => {
    const src = "x = 1\n  \"a <b> c\"\n";
    const at = src.indexOf("\"");
    expect(bodyTopQuoteStartsStatement(src, at, 0)).toBe(true);
    expect(scanBodyTopLiteralClose(src, at)).toBe(src.lastIndexOf("\""));
    expect(bodyTopQuoteStartsStatement("x =\n \"a\"", 5, 0)).toBe(false);
    expect(scanBodyTopLiteralClose("\"open\n<p>x</p>", 0)).toBe(-1);
  });
});

for (const [label, parser] of PIPELINES) {
  describe(`S441 — ${label}`, () => {
    test("loose prose is ONE E-UNQUOTED-DISPLAY-TEXT naming both declared forms, and nothing else", () => {
      const r = compile("<program>\nWelcome to the dashboard.\n<p>x</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain("<p>Welcome to the dashboard.</p>");
      expect(r.errors[0].message).toContain("\"Welcome to the dashboard.\"");
      expect(r.body).toBe("<p>x</p>");
    });
    test("prose after a declaration in the same run is rejected; the declaration still lifts", () => {
      const r = compile("<program>\n<count> = 0\nHello world, this is prose.\n<p>${@count}</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    });
    test("a `<page>` body and a `<channel>` body follow the same rule", () => {
      expect(compile("<page>\nPage prose here.\n<p>x</p>\n</page>\n", parser).codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(compile("<program>\n<channel name=\"c\">\n  <msgs> = []\n  hello channel prose\n</>\n<p>x</p>\n</program>\n", parser).codes)
        .toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    });
    test("a lone identifier is code: E-SCOPE-001, whose message names the declared-prose forms", () => {
      const r = compile("<program>\nCounter\n<p>x</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-SCOPE-001"]);
      expect(r.errors[0].message).toContain("<p>Counter</p>");
    });
    for (const [src, code] of [
      ["try\n{\n  log(1)\n} catch (e) { }", "E-TRY-NOT-IN-SCRML"],
      ["throw \"x\"", "E-THROW-NOT-IN-SCRML"],
      ["function g() { return 1 }\nawait g()", "E-AWAIT-NOT-IN-SCRML"],
      ["import(\"./x.js\")", "E-DYNAMIC-IMPORT-NOT-IN-SCRML"],
      ["class Foo { }", "E-CLASS-NOT-IN-SCRML"],
    ]) {
      test(`${code}: the §7.2.1 construct at body-top gets its own code and never ships as text`, () => {
        const r = compile(`<program>\n${src}\n<p>x</p>\n</program>\n`, parser);
        expect(r.codes).toContain(code);
        expect(r.codes).not.toContain("E-UNQUOTED-DISPLAY-TEXT");
        expect(r.body).toBe("<p>x</p>");
      });
    }
    test("a bare `?{…}` SQL statement at body-top is code and never reaches the HTML", () => {
      const r = compile("<program>\n?{`CREATE TABLE t (id INTEGER)`}\n<p>x</p>\n</program>\n", parser);
      expect(r.errors).toHaveLength(0);
      expect(r.body).toBe("<p>x</p>");
      expect(r.client).not.toContain("CREATE TABLE");
    });
    test("declared prose renders: `\"...\"` without quotes, escaped, with a rendering `${}`", () => {
      const r = compile("<program>\n<count> = 3\n\"Hello there\"\n\"Count is ${@count} now\"\n\"a < b & c\"\n<p>x</p>\n</program>\n", parser);
      expect(r.errors).toHaveLength(0);
      expect(r.body).toContain("Hello there");
      expect(r.body).not.toContain("\"Hello there\"");
      expect(r.body).toMatch(/Count is <span data-scrml-logic="[^"]+"><\/span> now/);
      expect(r.body).toContain("a &lt; b &amp; c");
      expect(r.client).toContain("_scrml_render_value");
    });
    test("markup-looking text and `//` inside a literal stay literal text", () => {
      const r = compile("<program>\n\"see <b>this</b> // not a comment\"\n<p>x</p>\n</program>\n", parser);
      expect(r.errors).toHaveLength(0);
      expect(r.body).toBe("see &lt;b&gt;this&lt;/b&gt; // not a comment <p>x</p>");
    });
    test("an unterminated literal is E-CTX-001 and does not swallow the next element", () => {
      const r = compile("<program>\n\"unterminated\n<p>x</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-CTX-001"]);
      expect(r.body).toContain("<p>x</p>");
    });
    test("a bare expression statement is evaluated, not rendered", () => {
      const r = compile("<program>\n<count> = 3\n@count\n<p>done</p>\n</program>\n", parser);
      expect(r.errors).toHaveLength(0);
      expect(r.body).toBe("<p>done</p>");
    });
    test("a bare write at body-top is legal (E-WRITE-NOT-IN-LOGIC-CONTEXT retired)", () => {
      const r = compile("<program>\n<count> = 0\n@count = 5\n<p>${@count}</p>\n</program>\n", parser);
      expect(r.errors).toHaveLength(0);
      expect(r.client).toMatch(/_scrml_cs_reactive_set\("count", 5\)/);
    });
    test("a bare `if` statement is checked code, not page text", () => {
      const r = compile("<program>\n<p>a</p>\nif (1) { }\n</program>\n", parser);
      expect(r.errors).toHaveLength(0);
      expect(r.body).toBe("<p>a</p>");
    });
  });
}
