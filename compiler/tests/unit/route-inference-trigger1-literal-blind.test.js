/**
 * §12.4 — route inference "SHALL NOT classify a function based on the names of
 * identifiers that appear inside string-literal contents of its body."
 *
 * s451-ri-string-literal: the §12.2 Trigger-1 text-pattern table
 * (`SERVER_ONLY_PATTERNS` in route-inference.ts — `?{`, `new Database(`,
 * `new SQL(`, `fs.*(`, `readFileSync(` / `writeFileSync(`, `env(`, bare
 * `session`) was matched against the rendered expression text, which carries a
 * string literal's quoted content. `function label(x) { return "your session
 * ended: " + x }` was server-placed (and crashed the bootstrap build). The fix
 * matches the SAME patterns against the CODE-ONLY text (literal / template-quasi
 * / comment text blanked), so:
 *   - every family's token inside a string, a template literal's text, or a
 *     comment does NOT escalate;
 *   - every family's token as real code STILL escalates (no new fail-open);
 *   - real code inside a template `${ … }` interpolation still escalates.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { runRI } from "../../src/route-inference.ts";
import { blankLiteralTextInSource } from "../../src/expression-parser.ts";

/** Compile `src`; return the RI boundary of the function named `name`. */
function boundaryOf(src, name) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ri-litblind-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  let ri = null;
  compileScrml({
    inputFiles: [file],
    write: false,
    log: () => {},
    stageOverrides: { RI: (input) => { ri = runRI(input); return ri; } },
  });
  expect(ri).not.toBeNull();
  const hits = [...ri.routeMap.functions.values()].filter((r) => r.functionName === name);
  expect(hits.length).toBe(1);
  return hits[0].boundary;
}

/** A program whose function `f` has `body` and is called from a button. */
const prog = (body) => `<program>
<msg> = ""
\${
  function f(x) {
${body}
  }
  function go() { @msg = f("now") }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
</program>`;

// The reported reproducer, verbatim shape.
const REPRO = `<program>
<msg> = ""
\${
  function label(x) { return "your session ended: " + x }
  function go() { @msg = label("now") }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
</program>`;

describe("s451 reproducer", () => {
  test("`return \"your session ended: \" + x` stays on the client", () => {
    expect(boundaryOf(REPRO, "label")).toBe("client");
  });
});

// Each family: [label, token-as-text, real-code statement(s)]
const FAMILIES = [
  ["sql ?{", "?{ select }", "    let rows = ?{`SELECT 1`}.all()\n    return rows"],
  ["new Database(", "new Database(x)", "    let d = new Database(\"a.db\")\n    return d"],
  ["new SQL(", "new SQL(x)", "    let d = new SQL(\"postgres://h/db\")\n    return d"],
  ["fs.readFile(", "fs.readFile(p)", "    return fs.readFile(x)"],
  ["fs.writeFileSync(", "fs.writeFileSync(p)", "    return fs.writeFileSync(x, x)"],
  ["readFileSync(", "readFileSync(p)", "    return readFileSync(x)"],
  ["env(", "env(\"KEY\")", "    let k = env(\"API_KEY\")\n    return k"],
  ["session", "your session ended", "    let u = session.userId\n    return u"],
];

describe("§12.4 — Trigger-1 text patterns do NOT fire on literal / comment text", () => {
  for (const [label, tok] of FAMILIES) {
    const safeTok = tok.replace(/"/g, "'");
    test(`${label}: inside a double-quoted string`, () => {
      expect(boundaryOf(prog(`    return "${tok.replace(/"/g, "'")} " + x`), "f")).toBe("client");
    });
    test(`${label}: inside a single-quoted string`, () => {
      expect(boundaryOf(prog(`    return '${tok.replace(/'/g, "\"")} ' + x`), "f")).toBe("client");
    });
    test(`${label}: inside a static template literal`, () => {
      expect(boundaryOf(prog(`    return \`${safeTok}\` + x`), "f")).toBe("client");
    });
    test(`${label}: inside an interpolated template literal's text`, () => {
      expect(boundaryOf(prog(`    return \`${safeTok} \${x} ${safeTok}\``), "f")).toBe("client");
    });
    test(`${label}: inside a string in a block-body callback (escape-hatch path)`, () => {
      expect(boundaryOf(prog(`    return [x].map(function(y) { return "${safeTok} " + y })`), "f")).toBe("client");
    });
    test(`${label}: inside a trailing // comment`, () => {
      expect(boundaryOf(prog(`    return x // ${safeTok}`), "f")).toBe("client");
    });
    test(`${label}: inside a /* block */ comment`, () => {
      expect(boundaryOf(prog(`    return String(/* ${safeTok} */ x)`), "f")).toBe("client");
    });
  }
});

describe("§12.2 Trigger 1 — the same tokens as REAL code still escalate (no fail-open)", () => {
  for (const [label, , code] of FAMILIES) {
    test(`${label}: real code escalates`, () => {
      expect(boundaryOf(prog(code), "f")).toBe("server");
    });
  }

  test("session: a real read inside a template `${ … }` interpolation escalates", () => {
    expect(boundaryOf(prog("    return `user ${session.userId}`"), "f")).toBe("server");
  });

  test("env(: a real call inside a template interpolation escalates", () => {
    expect(boundaryOf(prog("    return `key ${env(\"API_KEY\")}`"), "f")).toBe("server");
  });

  test("session: a real read alongside a string mentioning it escalates", () => {
    expect(boundaryOf(prog("    return \"session \" + session.userId"), "f")).toBe("server");
  });

  test("session: a real read inside a block-body callback escalates (escape-hatch path)", () => {
    expect(boundaryOf(prog("    return [x].map(function(y) { return session.userId + y })"), "f")).toBe("server");
  });

  test("the client `@session` projection still does NOT escalate", () => {
    expect(boundaryOf(prog("    return @session.userId + x"), "f")).toBe("client");
  });
});

describe("blankLiteralTextInSource — the raw-text lexer", () => {
  test("blanks string, template-quasi and comment text; keeps code", () => {
    const out = blankLiteralTextInSource('a("session", `t ${session.x} u`) // session');
    expect(out).not.toMatch(/"session"/);
    expect(out).toContain("session.x");
    expect(out.match(/session/g).length).toBe(1);
  });

  test("a regex literal containing a quote does not blank later code", () => {
    const out = blankLiteralTextInSource('x.replace(/"/g, "") + session.id');
    expect(out).toContain("session.id");
  });

  test("division is not mistaken for a regex", () => {
    const out = blankLiteralTextInSource('a / b + "q" / session.n');
    expect(out).toContain("session.n");
    expect(out).not.toContain("q");
  });

  test("a `?{ … }` SQL block survives as `?{}`", () => {
    expect(blankLiteralTextInSource('f(?{`SELECT "x"`}, "s")')).toContain("?{}");
  });

  test("`Type::Variant` enum access is not blanked", () => {
    expect(blankLiteralTextInSource('Kind::session == "a"')).toContain("::session");
  });

  test("unlexable text is returned unchanged (fail-closed)", () => {
    const bad = '"unterminated session';
    expect(blankLiteralTextInSource(bad)).toBe(bad);
  });
});
