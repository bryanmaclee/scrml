/**
 * S441 declared-prose — round 4: the body-top COVERAGE INVARIANT (SPEC §40.8
 * S441 bullet). Every non-whitespace byte of a `<program>` / `<page>` /
 * `<channel>` body-top run ends up in exactly one of (a) a statement that is
 * compiled or (b) a diagnostic. The compiler CHECKS this after parsing, in
 * both front ends; a byte in neither is E-INTERNAL-BODY-TOP-DROPPED
 * (fail-closed) instead of vanishing.
 *
 *   §1 the check itself (live `assertBodyTopCoverage`, native
 *      `assertBodyTopCoverageNative`) fires on a synthetic drop;
 *   §2 the round-3 review reproducers, both front ends;
 *   §3 the round-4 fuzz finds (a prose line kept after a statement split;
 *      a native prose line exempted by a cascaded declaration);
 *   §4 a seeded fuzz with an INDEPENDENT oracle (not the compiler's check).
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { assertBodyTopCoverage } from "../../src/ast-builder.js";
import { assertBodyTopCoverageNative } from "../../native-parser/parse-markup.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const DIR = "/tmp/s441-coverage-invariant-fixtures";
mkdirSync(DIR, { recursive: true });
let n = 0;
function compile(source, parser) {
  const f = join(DIR, `c-${++n}.scrml`);
  writeFileSync(f, source);
  const out = join(DIR, `out-${n}`);
  if (existsSync(out)) rmSync(out, { recursive: true });
  const r = compileScrml({ inputFiles: [f], outputDir: out, write: true, log: () => {}, parser: parser ?? null });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && /^E-/.test(e.code ?? ""));
  const read = (ext) => (existsSync(join(out, `c-${n}.${ext}`)) ? readFileSync(join(out, `c-${n}.${ext}`), "utf8") : "");
  return { errors, codes: errors.map((e) => e.code), html: read("html"), client: read("client.js") };
}
const at = (e) => e.tabSpan ?? e.span ?? {};
const BOTH = [["default", null], ["scrml-native", "scrml-native"]];
const DROPPED = "E-INTERNAL-BODY-TOP-DROPPED";

// ---------------------------------------------------------------------------
// §1 — the check fires on a drop no parser path reported
// ---------------------------------------------------------------------------
describe("§1 the coverage check (live)", () => {
  test("bytes outside every statement's consumed tokens are E-INTERNAL-BODY-TOP-DROPPED", () => {
    const text = "a b\nc";
    const node = { kind: "bare-expr" };
    Object.defineProperty(node, "_s441Cover", { value: [[100, 101]], enumerable: false, writable: true });
    const errors = [];
    const k = assertBodyTopCoverage([node], [], text, 100, errors, "/t.scrml", 5, 1);
    expect(k).toBe(1); // `b` and `c` are on consecutive lines: one diagnostic
    expect(errors.map((e) => e.code)).toEqual([DROPPED]);
    expect(at(errors[0]).start).toBe(102);
    expect(at(errors[0]).line).toBe(5);
    expect(errors[0].message).toContain("`b`");
  });
  test("an error diagnostic on a line covers that line", () => {
    const errors = [{ code: "E-UNQUOTED-DISPLAY-TEXT", tabSpan: { start: 102, end: 103 } }];
    assertBodyTopCoverage([], [], "a b", 100, errors, "/t.scrml", 1, 1);
    expect(errors.map((e) => e.code)).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
  });
  test("a warning does NOT cover (only an error stops the build)", () => {
    const errors = [{ code: "W-SOMETHING", tabSpan: { start: 100, end: 103 } }];
    assertBodyTopCoverage([], [], "a b", 100, errors, "/t.scrml", 1, 1);
    expect(errors.map((e) => e.code)).toEqual(["W-SOMETHING", DROPPED]);
  });
  test("comments and `;` are formatting, not content", () => {
    const errors = [];
    const tokens = [
      { kind: "COMMENT", text: " x\n", span: { start: 102, end: 105 } },
      { kind: "PUNCT", text: ";", span: { start: 105, end: 106 } },
    ];
    assertBodyTopCoverage([], tokens, "// x\n;", 100, errors, "/t.scrml", 1, 1);
    expect(errors).toEqual([]);
  });
  test("a statement whose HEAD expression lost text is not compiled unless an error reports the loss", () => {
    const mk = () => {
      const node = { kind: "bare-expr", exprNode: { kind: "ident" } };
      Object.defineProperty(node.exprNode, "_s441Trailing", { value: true });
      Object.defineProperty(node, "_s441Cover", { value: [[0, 3]], enumerable: false, writable: true });
      return node;
    };
    const errors = [];
    assertBodyTopCoverage([mk()], [], "abc", 0, errors, "/t.scrml", 1, 1);
    expect(errors.map((e) => e.code)).toEqual([DROPPED]);
    const reported = [{ code: "E-UNQUOTED-DISPLAY-TEXT", tabSpan: { start: 0, end: 3 } }];
    assertBodyTopCoverage([mk()], [], "abc", 0, reported, "/t.scrml", 1, 1);
    expect(reported.map((e) => e.code)).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
  });
});

describe("§1 the coverage check (native)", () => {
  test("a token outside every statement span is E-INTERNAL-BODY-TOP-DROPPED", () => {
    const source = "a b\nc";
    const ctx = { diagnostics: [] };
    assertBodyTopCoverageNative({ span: { start: 0, end: 5, line: 1, col: 1 }, body: [{ span: { start: 0, end: 1 } }] }, source, ctx);
    expect(ctx.diagnostics.map((d) => d.code)).toEqual([DROPPED]);
    expect(ctx.diagnostics[0].span.start).toBe(2);
  });
  test("a character the lexer dropped is not covered by the statement span around it", () => {
    const source = "x ★ y";
    const ctx = { diagnostics: [] };
    assertBodyTopCoverageNative({ span: { start: 0, end: source.length, line: 1, col: 1 }, body: [{ span: { start: 0, end: source.length } }] }, source, ctx);
    expect(ctx.diagnostics.map((d) => d.code)).toEqual([DROPPED]);
    expect(ctx.diagnostics[0].message).toContain("`★`");
  });
  test("statements + comments + error lines cover the run", () => {
    const source = "a // c\nb b";
    const ctx = { diagnostics: [{ code: "E-UNQUOTED-DISPLAY-TEXT", span: { start: 7, end: 10 } }] };
    assertBodyTopCoverageNative({ span: { start: 0, end: source.length, line: 1, col: 1 }, body: [{ span: { start: 0, end: 1 } }] }, source, ctx);
    expect(ctx.diagnostics.map((d) => d.code)).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
  });
});

// ---------------------------------------------------------------------------
// §2 — the round-3 review reproducers (PA-reproduced), both front ends
// ---------------------------------------------------------------------------
for (const [label, parser] of BOTH) {
  describe(`§2 round-3 reproducers (${label})`, () => {
    test("`★ ✓ →` after markup is reported at its own line (was: vanished, exit 0)", () => {
      const r = compile("<program>\n<p>a</p>\n★ ✓ →\n<p id=\"z\">end</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(at(r.errors[0]).line).toBe(3);
    });
    test("`<count> = 0⏎© 2026 Acme Inc⏎<code line>`: the prose is reported, the code line survives", () => {
      const r = compile("<program>\n<count> = 0\n© 2026 Acme Inc\n\"a,b\".split(\",\").forEach(x => console.log(x))\n<p id=\"z\">${@count}</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(at(r.errors[0]).line).toBe(3);
      expect(r.errors[0].message).toContain("© 2026 Acme Inc");
    });
    test("prose then a declaration: the prose is reported, the declaration survives", () => {
      const r = compile("<program>\nWelcome to the dashboard\n<count> = 0\n<p id=\"z\">${@count}</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(at(r.errors[0]).line).toBe(2);
    });
  });
}
test("§2 `Hello, ${name}` in a body-top template renders its value, not an empty fold (default)", () => {
  const r = compile("<program>\nconst name = \"world\"\nconst msg = `Hello, ${name}`\n<p id=\"z\">${msg}</p>\n</program>\n");
  expect(r.codes).toEqual([]);
  expect(r.client).toContain("`Hello, ${name}`");
});

// ---------------------------------------------------------------------------
// §3 — round-4 fuzz finds
// ---------------------------------------------------------------------------
for (const [label, parser] of BOTH) {
  describe(`§3 fuzz finds (${label})`, () => {
    test("a prose line that swallowed the next CODE line is reported once cut back to its own line", () => {
      // Was (default): the split kept `careful, world` as code — emitted as
      // `careful , world;`, compiled clean, ReferenceError at boot.
      const r = compile("<program>\ncareful, world\n\"a,b\".split(\",\").forEach(x => console.log(\"m3\"))\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(at(r.errors[0]).line).toBe(2);
      expect(r.errors[0].message).toContain("`careful, world`");
    });
    test("a prose line is not exempted by a declaration a parse-error cascade flagged on a later line", () => {
      // Was (native): raw E-STMT-* / E-EXPR-* cascade, `orders, data` unreported.
      const r = compile("<program>\n<c1> = 1\nconsole.log(\"m2\")\nloading loading!\n<c4> = 4\norders, data\n<c6> = 6\n<p>x</p>\n</program>\n", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT", "E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors.map((e) => at(e).line).sort()).toEqual([4, 6]);
    });
    test("a `server function` / `const <x>` / `const X = <markup>` at body top is fully covered (no false drop)", () => {
      const r = compile("<program>\n<count> = 1\nconst <doubled> = @count * 2\nserver function isOk(n) { return n > 100 }\nconst Badge = <span class=\"b\">\n    hi\n</>\n<p>${@doubled}</p>\n<Badge/>\n</program>\n", parser);
      expect(r.codes).not.toContain(DROPPED);
    });
  });
}

test("§3 native: a parse diagnostic at the run's END belongs to its statement, not to an empty 'prose' line", () => {
  // Was (round-4 WIP): `import stuff` → E-UNQUOTED-DISPLAY-TEXT quoting ``
  // on the NEXT line (the markup), hiding the real E-STMT-EXPECT-FROM.
  const r = compile("<program>\nimport stuff\n<p>x</p>\n</program>\n", "scrml-native");
  expect(r.codes).not.toContain("E-UNQUOTED-DISPLAY-TEXT");
  expect(r.codes).toContain("E-STMT-EXPECT-FROM");
  const f = compile("<program>\nfn heading\n<p>x</p>\n</program>\n", "scrml-native");
  expect(f.codes).toEqual(["E-STMT-FUNCTION-BODY"]);
});

// ---------------------------------------------------------------------------
// §4 — seeded fuzz, independent oracle
// ---------------------------------------------------------------------------
function fuzzBodies(count, seed0) {
  let seed = seed0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const W = ["Welcome", "to", "the", "dashboard", "items", "total", "Price", "Acme", "careful", "loading", "hello", "world", "orders"];
  const SYMS = ["★ ✓ →", "©", "🎉🎉", "— • —", "±", "§ ¶"];
  const prose = () => {
    switch (Math.floor(rnd() * 7)) {
      case 0: return `${pick(W)} ${pick(W)} ${pick(W)}`;
      case 1: return pick(SYMS);
      case 2: return `${pick(W)}, ${pick(W)}`;
      case 3: return `© 2026 ${pick(W)} ${pick(W)}`;
      case 4: return `${100 + Math.floor(rnd() * 900)} ${pick(W)} ${pick(W)}`;
      case 5: return `${pick(W)} ${pick(W)}.`;
      default: return `${pick(W)} ${pick(W)}!`;
    }
  };
  const bodies = [];
  for (let b = 0; b < count; b++) {
    const items = [];
    const cells = [];
    const proseFree = rnd() < 0.5;
    const L = 3 + Math.floor(rnd() * 6);
    for (let i = 0; i < L; i++) {
      const m = b * 100 + i;
      const r = proseFree ? 0.3 + rnd() * 0.7 : rnd();
      if (r < 0.3) items.push({ kind: "prose", text: prose() });
      else if (r < 0.72) {
        const k = Math.floor(rnd() * 5);
        if (k === 0) { cells.push(`c${m}`); items.push({ kind: "code", text: `<c${m}> = ${m}`, marker: `c${m}` }); }
        else if (k === 1) items.push({ kind: "code", text: `console.log("m${m}")`, marker: `m${m}` });
        else if (k === 2) items.push({ kind: "code", text: `"a,b".split(",").forEach(x => console.log("m${m}"))`, marker: `m${m}` });
        else if (k === 3) items.push({ kind: "code", text: `if (${m} > 0) { console.log("m${m}") }`, marker: `m${m}` });
        else items.push({ kind: "code", text: cells.length ? `@${pick(cells)} = ${m}` : `console.log("m${m}")`, marker: cells.length ? null : `m${m}` });
      } else if (r < 0.86) items.push({ kind: "declared", text: rnd() < 0.5 ? `<p>d${m} ${pick(W)}</p>` : `"d${m} ${pick(W)}"`, marker: `d${m}` });
      else items.push({ kind: "comment", text: `// note ${pick(W)} ${pick(W)}` });
    }
    bodies.push(items);
  }
  return bodies;
}

for (const [label, parser] of BOTH) {
  test(`§4 seeded fuzz: every prose line is reported; every code/declared marker survives a clean compile (${label})`, () => {
    const violations = [];
    let internal = 0;
    const bodies = fuzzBodies(40, 4401);
    for (const items of bodies) {
      let src = "<program>\n";
      let line = 2;
      const placed = items.map((it) => ({ ...it, line: line++ }));
      for (const it of placed) src += it.text + "\n";
      src += "</program>\n";
      const r = compile(src, parser);
      internal += r.codes.filter((c) => c === DROPPED).length;
      const lineOf = (off) => src.slice(0, off).split("\n").length;
      const ranges = r.errors.map((e) => {
        const sp = at(e);
        const a = typeof sp.line === "number" ? sp.line : lineOf(sp.start ?? 0);
        const b = typeof sp.end === "number" && sp.end > (sp.start ?? 0) ? lineOf(sp.end) : a;
        return [a, Math.max(a, b)];
      });
      for (const it of placed) {
        if (r.errors.length > 0) {
          if (it.kind === "prose" && !ranges.some(([a, b]) => a <= it.line && it.line <= b)) violations.push(`unreported prose line ${it.line} \`${it.text}\`\n${src}`);
        } else {
          if (it.kind === "prose") violations.push(`prose compiled clean: \`${it.text}\`\n${src}`);
          if (it.kind === "code" && it.marker && !r.client.includes(it.marker)) violations.push(`code marker ${it.marker} missing\n${src}`);
          if (it.kind === "declared" && !r.html.includes(it.marker) && !r.client.includes(it.marker)) violations.push(`declared marker ${it.marker} missing\n${src}`);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(internal).toBe(0);
  });
}
