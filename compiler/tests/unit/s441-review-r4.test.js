/**
 * S441 declared-prose — review round 4 (PA review of 25b38fc8b): the COVERAGE
 * invariant. Every non-whitespace, non-comment byte of a `<program>` / `<page>`
 * / `<channel>` body-top run ends up inside a parsed statement or inside an
 * E-UNQUOTED-DISPLAY-TEXT diagnostic — text never vanishes. Probes:
 * scratchpad prose-r2/p/. Each case asserts an error (quoting its OWN text at
 * its OWN line) or the rendered / emitted result — never silence.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const DIR = "/tmp/s441-review-r4-fixtures";
mkdirSync(DIR, { recursive: true });
let n = 0;
function compile(source, parser) {
  const f = join(DIR, `c-${++n}.scrml`);
  writeFileSync(f, source);
  const out = join(DIR, `out-${n}`);
  if (existsSync(out)) rmSync(out, { recursive: true });
  const r = compileScrml({ inputFiles: [f], outputDir: out, write: true, log: () => {}, parser: parser ?? null });
  const errors = r.errors ?? [];
  const read = (ext) => (existsSync(join(out, `c-${n}.${ext}`)) ? readFileSync(join(out, `c-${n}.${ext}`), "utf8") : "");
  const m = read("html").match(/<body>([\s\S]*?)<script/);
  return { errors, codes: errors.map((e) => e.code), body: (m ? m[1] : "").replace(/\s+/g, " ").trim(), client: read("client.js") };
}
const at = (e) => e.tabSpan ?? e.span ?? {};
const BOTH = [["default", null], ["scrml-native", "scrml-native"]];

for (const [label, parser] of BOTH) {
  describe(`#1 — characters the tokenizer has no token for never vanish (${label})`, () => {
    for (const line of ["★ ✓ →", "🎉🎉", "© 2026 Acme Inc"]) {
      test(`\`<p>a</p>⏎${line}\` → E-UNQUOTED-DISPLAY-TEXT quoting the line`, () => {
        const r = compile(`<program>\n<p>a</p>\n${line}\n</program>\n`, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
        expect(r.errors[0].message).toContain("`" + line + "`");
        expect(at(r.errors[0]).line).toBe(3);
      });
    }
  });

  describe(`#2/#3 — after a declaration, a line the collector would swallow is its own statement (${label})`, () => {
    for (const line of ["© 2026 Acme Inc", "5 items", "2024 was a good year", "!!!", "\"quoted\" he said", "..."]) {
      test(`\`<count> = 0⏎${line}\` → E-UNQUOTED-DISPLAY-TEXT at line 3; the declaration survives`, () => {
        const r = compile(`<program>\n<count> = 0\n${line}\n<p id="z">end \${@count}</p>\n</program>\n`, parser);
        const u = r.errors.filter((e) => e.code === "E-UNQUOTED-DISPLAY-TEXT");
        expect(u.length).toBe(1);
        expect(at(u[0]).line).toBe(3);
        expect(r.codes).not.toContain("E-STATE-UNDECLARED");
      });
    }
    test("`@count = 4⏎5 items` → the write runs, `5 items` is reported", () => {
      const r = compile("<program>\n<count> = 0\n@count = 4\n5 items\n<p id=\"z\">end ${@count}</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain("`5 items`");
    });
    test("the diagnostic names the uncovered text, not a valid neighbour, and keeps both neighbours", () => {
      const r = compile("<program>\nconst k = 3\nconsole.log(\"a\")\n5 items\nconsole.log(\"b\")\n<p id=\"z\">end</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain("`5 items`");
      expect(at(r.errors[0]).line).toBe(4);
    });
    for (const code of ["\"abc\".toUpperCase()", "console.log(\"Count: \" + @count)", "\"a,b\".split(\",\").forEach(x => console.log(x))"]) {
      test(`code line after a declaration runs: \`${code}\``, () => {
        const r = compile(`<program>\n<count> = 0\n${code}\n<p id="z">end \${@count}</p>\n</program>\n`, parser);
        expect(r.errors).toHaveLength(0);
      });
    }
  });
}

describe("#3 — the kept statement is cut at the swallowed line (default)", () => {
  test("no stale diagnostic from the swallowed line leaks onto the declaration", () => {
    const r = compile("<program>\n<count> = 0\n42 is the answer\n<p id=\"z\">end ${@count}</p>\n</program>\n");
    expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
  });
  test("the code line after a declaration is emitted", () => {
    const r = compile("<program>\n<count> = 0\n\"a,b\".split(\",\").forEach(x => console.log(x))\n<p id=\"z\">end</p>\n</program>\n");
    expect(r.client).toContain("forEach");
  });
});

describe("#6 — prose that also parses as a statement shape is E-UNQUOTED-DISPLAY-TEXT with no cascade (default)", () => {
  for (const line of ["Are you sure?", "# Heading", "not available", "let me explain", "(optional) fill this in", "- first item"]) {
    test(`\`${line}\``, () => {
      const r = compile(`<program>\n<count> = 0\n${line}\n<p id="z">end \${@count}</p>\n</program>\n`);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(at(r.errors[0]).line).toBe(3);
    });
  }
});

test("#7 — native never quotes an empty run", () => {
  const r = compile("<program>\n<p>start</p>\ndefault settings\n<p id=\"z\">end</p>\n</program>\n", "scrml-native");
  expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
  expect(r.errors[0].message).not.toContain("``");
  expect(r.errors[0].message).toContain("`default settings`");
});
