/**
 * S457 — ONE reader, JS-accurate (§8.1.2 "One reader of a slot's extent").
 *
 * (1) g-sql-slot-reader-regex-division-misreads-s456: a `?{}` `${…}` slot is ended by the JS
 *     PARSER (codegen/sql-lex.ts `jsInterpolationEnd`, acorn + the scrml `@` / `::` tokens),
 *     not by the preceding-character regex-vs-division heuristic that misread
 *     `${ x.if(1) / 2 }`, `${ g("if(") / 2 }`, `${ x // (⏎ / 2 }` and refused valid statements.
 *     A payload in scrml-only syntax (`is not`, `not x`) is read by the same parser's tokenizer;
 *     no reading → -1 (fail closed).
 * (2) g-rewrite-sql-refs-lowers-inside-js-literals-s456: codegen's text-path lowering
 *     (`rewrite.ts` `rewriteSqlRefs`) lowers exactly the `?{}` sites the compile checks read
 *     (`sql-in-expression-text.ts`) — a `?{` inside a JS string, comment, regex literal or
 *     template-literal text is left as written.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as acorn from "acorn";
import { compileScrml } from "../../src/api.js";
import { jsInterpolationEnd, liveSqlInterpolations } from "../../src/codegen/sql-lex.ts";
import { programStatementCount } from "../../src/schema-differ.js";
import { rewriteSqlRefs } from "../../src/codegen/rewrite.ts";
import { sqlSitesInExpressionText } from "../../src/sql-in-expression-text.ts";

const BT = "`";

function compileToServer(source) {
  const dir = mkdtempSync(join(tmpdir(), "s457-one-reader-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, gather: true, log: () => {} });
    const codes = [...new Set((r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code))];
    let serverJs = "";
    for (const out of r.outputs?.values() ?? []) if (out?.serverJs) serverJs += out.serverJs;
    return { codes, serverJs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const app = (stmt) => `<program db="./app.db">
  <schema>
    notes {
      id: integer primary key
      v: text
    }
  </schema>
  \${
    function f(x) {
      ?{${BT}INSERT INTO notes (v) VALUES (\${x})${BT}}.run()
      ${stmt}
      return 1
    }
  }
  <button onclick=\${ f("a") }>s</button>
</program>`;

/**
 * JavaScript's own answer: the end (just past `}`) of the first substitution of the template
 * `\`${…\`` built from `src` (which begins with `${`), or -1 when JS rejects it.
 */
function jsAnswer(src) {
  const t = BT + src + BT;
  try {
    const tl = acorn.parseExpressionAt(t, 0, { ecmaVersion: "latest" });
    if (tl.type !== "TemplateLiteral" || tl.expressions.length === 0) return -1;
    // The quasi after the first expression starts just past its `}` (t coordinates); src = t - 1.
    return tl.quasis[1].start - 1;
  } catch {
    return -1;
  }
}

const span = (sql) => liveSqlInterpolations(sql).map((s) => sql.slice(s.start, s.end));

describe("(1) the slot ends where the JavaScript parser ends it — the reviewer's misread shapes", () => {
  test("after `x.if(…)` — a keyword spelling after `.` is a property, so `/` divides", () => {
    expect(span("VALUES (${ x.if(1) / 2 }) /* } */")).toEqual(["${ x.if(1) / 2 }"]);
  });
  test("after `)` when a keyword sits in a string inside the parentheses", () => {
    expect(span('VALUES (${ g("if(") / 2 }) /* } */')).toEqual(['${ g("if(") / 2 }']);
    expect(span("VALUES (${ g(')', 'while(') / 2 }) X /}/")).toEqual(["${ g(')', 'while(') / 2 }"]);
  });
  test("after an object-literal `}` — division, not a regex", () => {
    expect(span("VALUES (${ ({a: 1}).a / 2 }) X /}/")).toEqual(["${ ({a: 1}).a / 2 }"]);
    expect(span("VALUES (${ {a: 1}.a / 2 }) X /}/")).toEqual(["${ {a: 1}.a / 2 }"]);
    expect(span("VALUES (${ [{a: 1}][0].a / 2 }) X /}/")).toEqual(["${ [{a: 1}][0].a / 2 }"]);
  });
  test("after comment text — a comment's words and brackets are not code", () => {
    expect(span("VALUES (${ x // (\n / 2 }) X")).toEqual(["${ x // (\n / 2 }"]);
    expect(span("VALUES (${ x // return\n / 2 }) X /}/")).toEqual(["${ x // return\n / 2 }"]);
    expect(span("VALUES (${ x /* ( */ / 2 }) X /}/")).toEqual(["${ x /* ( */ / 2 }"]);
  });
  test("regex literals holding `}` or `${` stay one token", () => {
    expect(span("VALUES (${ /}/.test(a) }) X")).toEqual(["${ /}/.test(a) }"]);
    expect(span("VALUES (${ /\\${/.test(a) }) X")).toEqual(["${ /\\${/.test(a) }"]);
    expect(span("VALUES (${ (/[}]/).source }) X")).toEqual(["${ (/[}]/).source }"]);
  });
  test("a CRLF line continuation inside a slot string is one string (was read as unterminated)", () => {
    const sql = "VALUES (${ 'a\\\r\nb' }) X";
    expect(span(sql)).toEqual(["${ 'a\\\r\nb' }"]);
  });
  test("the scrml `@` sigil and `Type::Variant` are read by the same parser", () => {
    expect(span("WHERE a = ${@x} AND b = ${ @user.id / 2 } AND c = ${ Kind::A }")).toEqual(["${@x}", "${ @user.id / 2 }", "${ Kind::A }"]);
  });
  test("scrml-only payloads (not JavaScript) are read with the same parser's tokenizer", () => {
    expect(span('VALUES (${ x is not ? "}" : "b" }) X')).toEqual(['${ x is not ? "}" : "b" }']);
    expect(span("VALUES (${ not x }), (${ y is some })")).toEqual(["${ not x }", "${ y is some }"]);
  });
  test("fail closed: no reading reaches a `}` → -1 (the slot runs to the end of the body)", () => {
    expect(jsInterpolationEnd("x ${ 'a }", 2)).toBe(-1);
    expect(jsInterpolationEnd("x ${ a /* } ", 2)).toBe(-1);
    expect(jsInterpolationEnd("x ${ `a${b}", 2)).toBe(-1);
    expect(jsInterpolationEnd("x ${ a", 2)).toBe(-1);
    expect(liveSqlInterpolations("x ${ 'a }")[0].end).toBe(9);
  });
  test("the F1 bypass shape stays closed: two statements, the second read", () => {
    const create = "INSERT INTO notes (v) VALUES (${ x + '{' }); CREATE TABLE leak (tenant_id text) /* } */";
    expect(programStatementCount(create).statements).toBe(2);
  });
  test("the program-body walk now reads the misread shapes as ONE readable statement", () => {
    for (const body of [
      "INSERT INTO notes (v) VALUES (${ x.if(1) / 2 }) /* } */",
      'INSERT INTO notes (v) VALUES (${ g("if(") / 2 }) /* } */',
      "INSERT INTO notes (v) VALUES (${ x // (\n / 2 })",
    ]) {
      const r = programStatementCount(body);
      expect(r.unreadable).toBe(null);
      expect(r.statements).toBe(1);
    }
  });
});

describe("(1) differential — the reader agrees with JavaScript on a generated battery", () => {
  // Payload heads that end a value (so `/` divides) or leave an operand expected (so `/` opens a
  // regex), crossed with tails that would end the slot at a different `}` under a wrong reading.
  const heads = [
    "x", "x.if(1)", "x.return", "x.of", "g(\"if(\")", "g('while(')", "({a: 1})", "({a: 1}).a", "{a: 1}.a",
    "[1]", "a++", "a--", "(a)", "(() => {})", "x // (\n", "x // return\n", "x /* ( */", "x /* if */",
    "1", "'}'", "`}`", "`${'}'}`", "a ? b : c", "typeof x", "await x", "x in y", "void 0",
  ];
  const tails = [" / 2 }) X /}/", " / 2 / 3 }) X", " /}/.test(a) }) X", "}) /* } */", " / 2 }); DELETE FROM t /* } */"];
  const leads = ["", "!", "typeof ", "(", "a + ", "a, "];
  const cases = [];
  for (const lead of leads) for (const head of heads) for (const tail of tails) cases.push("${ " + lead + head + tail);
  test(`${cases.length} slots: the reader's end equals JavaScript's whenever JavaScript accepts the template`, () => {
    let compared = 0;
    const disagreements = [];
    for (const c of cases) {
      const truth = jsAnswer(c);
      if (truth === -1) continue; // JS rejects the template — nothing to agree with
      compared++;
      const got = jsInterpolationEnd(c, 0);
      if (got !== truth) disagreements.push({ c, got, truth });
    }
    expect(disagreements).toEqual([]);
    expect(compared).toBeGreaterThan(cases.length / 3);
  });
});

describe("(1) compile — false refusals of valid single statements are gone", () => {
  // [label, payload, SQL text after the slot]. Base (0d8e9d8ce) emitted each as a site that throws
  // E-SQL-001 (the first, with no compile diagnostic) or refused it E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED.
  for (const [label, payload, after] of [
    ['`)` after a keyword in a string, a SQL comment holding `}`', 'g("if(") / 2', ") /* } */"],
    ["a `//` comment holding `(`", "x // (\n / 2", ")"],
    ["a `//` comment ending in a keyword", "x // return\n / 2", ")"],
  ]) {
    test(label, () => {
      const r = compileToServer(app(`let r = ?{${BT}INSERT INTO notes (v) VALUES (\${ ${payload} }${after}${BT}}.run()`));
      expect(r.codes).toEqual([]);
      expect(r.serverJs).not.toContain("E-SQL-001");
      expect(r.serverJs).toContain(`let r = await _scrml_sql${BT}INSERT INTO notes (v) VALUES (\${ ${payload.split("\n")[0]}`);
    });
  }
  test("a scrml-only payload still compiles and lowers (`is not`)", () => {
    const r = compileToServer(app(`let r = ?{${BT}INSERT INTO notes (v) VALUES (\${ x is not ? "a" : "b" })${BT}}.run()`));
    expect(r.codes).toEqual([]);
    expect(r.serverJs).toContain("_scrml_sql`INSERT INTO notes (v) VALUES (${ (x === null || x === undefined) ? \"a\" : \"b\" })`");
  });
});

describe("(2) rewriteSqlRefs lowers only the sites the checks read", () => {
  test("a `?{` inside a JS string, comment, regex or template text is left exactly as written", () => {
    for (const text of [
      'x == "?{`SELECT 1; DELETE FROM log`}"',
      "x == '?{`DELETE FROM log`}.run()'",
      "x // ?{`DELETE FROM log`}",
      "x /* ?{`DELETE FROM log`}.get() */",
      "/?{`DELETE FROM log`}/.test(x)",
      "`a ?{`",
    ]) {
      expect(sqlSitesInExpressionText(text)).toEqual([]);
      expect(rewriteSqlRefs(text, "_scrml_sql")).toBe(text);
    }
  });
  test("a `?{` in code — and in a template literal's `${…}` slot — is lowered", () => {
    expect(rewriteSqlRefs("let r = ?{`SELECT v FROM notes`}.get()", "_scrml_sql")).toBe("let r = (await _scrml_sql`SELECT v FROM notes`)[0] ?? null");
    expect(rewriteSqlRefs("`a ${?{`SELECT v FROM notes`}.get()} b`", "_scrml_sql")).toBe("`a ${(await _scrml_sql`SELECT v FROM notes`)[0] ?? null} b`");
  });
  test("a string beside a real site: the site is lowered, the string is not", () => {
    const out = rewriteSqlRefs('f("?{`DELETE FROM log`}", ?{`SELECT v FROM notes`}.all())', "_scrml_sql");
    expect(out).toBe('f("?{`DELETE FROM log`}", await _scrml_sql`SELECT v FROM notes`)');
  });
  test("`.nobatch()` / `.acrossTenants()` are read from the site's own chain only", () => {
    expect(rewriteSqlRefs("?{`SELECT v FROM notes`}.nobatch().get()", "_scrml_sql")).toBe("(await _scrml_sql`SELECT v FROM notes`)[0] ?? null");
    expect(rewriteSqlRefs("?{`SELECT v FROM notes`}.get().nobatch()", "_scrml_sql")).toBe("(await _scrml_sql`SELECT v FROM notes`)[0] ?? null");
    expect(rewriteSqlRefs('"a.nobatch()" + ?{`SELECT v FROM notes`}.run()', "_scrml_sql")).toBe('"a.nobatch()" + await _scrml_sql`SELECT v FROM notes`');
  });
  test("compile: `if (x == \"?{`…; DELETE …`}\")` keeps its string (was lowered into a broken string)", () => {
    const r = compileToServer(app(`if (x == "?{${BT}SELECT 1; DELETE FROM log${BT}}") { return 2 }`));
    expect(r.serverJs).not.toContain("E-SQL-MULTIPLE-STATEMENTS");
    expect(r.serverJs).not.toContain('unsafe("DELETE FROM log")');
    expect(r.serverJs).toContain('"?{`SELECT 1; DELETE FROM log`}"');
  });
});

describe("fix round 1 — the slot reader is linear in the body (S457 review: quadratic)", () => {
  // acorn's constructor, given a start offset, re-counted every line before it: 16k one-per-line
  // slots took ~10 s (JS payloads) / ~24 s (scrml-only payloads, the tokenizer branch) vs ~5 ms on
  // base. The reader now parses from a slice at the slot. Bound is ~40x the measured time.
  const body = (n, slot) => "INSERT INTO t (v) VALUES\n" + Array.from({ length: n }, (_, i) => `(${slot(i)})`).join(",\n");
  test("16k one-per-line JS slots", () => {
    const sql = body(16000, (i) => "${v" + i + "}");
    const t = performance.now();
    expect(liveSqlInterpolations(sql).length).toBe(16000);
    expect(performance.now() - t).toBeLessThan(4000);
  });
  test("16k one-per-line scrml-only slots (the tokenizer branch)", () => {
    const sql = body(16000, (i) => "${ v" + i + " is not ? 1 : 2 }");
    const t = performance.now();
    const slots = liveSqlInterpolations(sql);
    expect(slots.length).toBe(16000);
    expect(slots[15999].expr).toBe(" v15999 is not ? 1 : 2 ");
    expect(performance.now() - t).toBeLessThan(4000);
  });
  test("extents stay absolute (the parser reads a slice; the offset is added back)", () => {
    const sql = "A ${x} B\nC ${ y is not } D ${ f('}') }";
    expect(liveSqlInterpolations(sql).map((s) => [s.start, s.end, sql.slice(s.start, s.end)])).toEqual([
      [2, 6, "${x}"], [11, 24, "${ y is not }"], [27, 38, "${ f('}') }"],
    ]);
  });
});

describe("fix round 1 — site location reads regex-vs-division over the CODE read so far", () => {
  // The S239 review: HEAD left these raw (read as a regex holding the query — invalid JS, fail
  // closed) while BASE lowered them (unchecked: the base checker also missed them).
  const LOWERED = "_scrml_sql`";
  for (const text of [
    "x.if(1) / ?{`DELETE FROM notes`}.run()",
    "x // (\n / ?{`DELETE FROM notes`}.run()",
    'g("if(") / ?{`SELECT 1`}.get()',
    "x?.while(1) / ?{`SELECT 1`}.get()",
    "x /* return */ / ?{`SELECT 1`}.get()",
    "if (c) /a/.test(?{`SELECT 1`}.get())",
  ]) {
    test(`checked AND lowered: ${JSON.stringify(text)}`, () => {
      expect(sqlSitesInExpressionText(text).length).toBe(1);
      expect(rewriteSqlRefs(text, "_scrml_sql")).toContain(LOWERED);
    });
  }
  test("linear: 16k sites each after a `)` and a `/` (the code-so-far suffix, not a re-join)", () => {
    const text = Array.from({ length: 16000 }, (_, i) => `f(a${i}) / 2 + "s" + ?{\`SELECT ${i}\`}.get()`).join(" + ");
    const t = performance.now();
    expect(sqlSitesInExpressionText(text).length).toBe(16000);
    expect(performance.now() - t).toBeLessThan(4000);
  });
  test("a query inside a real regex literal is neither checked nor lowered", () => {
    const text = "return /?{`SELECT 1`}/.test(x)";
    expect(sqlSitesInExpressionText(text)).toEqual([]);
    expect(rewriteSqlRefs(text, "_scrml_sql")).toBe(text);
  });
});

describe("fix round 1 — bare `?{}` lowering binds one value per slot", () => {
  test("a comma-operator payload is ONE array element (was two: `expected 2 values, received 3`)", () => {
    expect(rewriteSqlRefs("?{`INSERT INTO notes (v, w) VALUES (${a, b}, ${c})`}", "_scrml_sql"))
      .toBe('await _scrml_sql.unsafe("INSERT INTO notes (v, w) VALUES (?1, ?2)", [(a, b), (c)])');
  });
});
