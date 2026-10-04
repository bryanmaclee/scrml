/**
 * error-handler-pipeless-arms-s452.test.js
 *
 * S452 (ruling: user-voice-scrml.md S452 "c looks right"; impl#1 freeze
 * exception "yes exception granted") — `!{}` handler arms use the §18.2
 * `match`-arm grammar: `arm-pattern (':>' | '=>' | '->') arm-body` with NO
 * leading `|`. The `|`-prefixed spelling stays accepted unchanged.
 *
 * Pre-fix, impl#1's `parseErrorTokens` (ast-builder.js) only opened an arm on
 * `|`, a `::` head, or a short-form `Name :>`. A pipe-less `.Bad(m) :>` arm was
 * skipped token by token until the next recognizable head, so it was silently
 * DROPPED (→ E-TYPE-080 "Missing variant(s): Bad").
 *
 * The contract tested here: for every shape, the pipe-less spelling compiles
 * to client JS BYTE-IDENTICAL to the `|`-prefixed spelling, with the same
 * diagnostics. FULL-PIPELINE (compileScrml) per the R26 doctrine.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileSrc(src) {
  const tmp = join(tmpdir(), `scrml-pipeless-arms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  // Same basename for both spellings so artifact names cannot differ.
  const srcFile = join(tmp, "h.scrml");
  writeFileSync(srcFile, src);
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
  let clientJs = "";
  try { clientJs = readFileSync(join(outDir, "h.client.js"), "utf8"); } catch { /* compile failed */ }
  rmSync(tmp, { recursive: true, force: true });
  return { result, clientJs };
}

const codes = (result) =>
  [...(result.errors ?? []), ...(result.warnings ?? [])].map((e) => e.code).sort();
const errorCodes = (result) => (result.errors ?? []).map((e) => e.code);

const PRELUDE = [
  "<program>",
  "type E:enum = { Bad(msg: string), Pair(a: number, b: number), Gone }",
  "function risky(n)! -> E {",
  "    if (n < 2) fail E::Bad(\"bad-msg\")",
  "    if (n < 3) fail E::Pair(3, 4)",
  "    if (n < 4) fail E::Gone",
  "    return n",
  "}",
];

/** Build a program whose `go(n)` body is `body` (lines). */
function program(bodyLines) {
  return [...PRELUDE, "export function go(n) {", ...bodyLines, "}", "</program>", ""].join("\n");
}

/**
 * Run the emitted `go(n)` (client JS is an IIFE; evaluate its body with a
 * trailing call). Used to show the matched pipe-less arm actually runs.
 */
function runGo(clientJs, n) {
  const m = clientJs.match(/function (_scrml_go_\d+)\(/);
  if (!m) throw new Error("go() not found in emitted JS");
  const start = clientJs.indexOf("(function() {") + "(function() {".length;
  const end = clientJs.lastIndexOf("})();");
  const body = clientJs.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn ${m[1]}(${JSON.stringify(n)});`)();
}

/** Each case: [name, pipe-less handler lines, piped handler lines, prefix, suffix]. */
const STMT = (arms) => ["    risky(n) !{", ...arms, "    }"];
const VALUE = (arms) => ["    const r = risky(n) !{", ...arms, "    }", "    return r"];

const CASES = [
  {
    name: "reproducer — `.V(a) :> { … }` + unit `.V :> { … }`, statement position",
    pipeless: STMT(["        .Bad(m) :> { return }", "        .Pair(a, b) :> { return }", "        .Gone :> { return }"]),
    piped: STMT(["        | .Bad(m) :> { return }", "        | .Pair(a, b) :> { return }", "        | .Gone :> { return }"]),
  },
  {
    name: "`.V(a)` / `.V(a, b)` / `.V` expression bodies, value position",
    pipeless: VALUE(["        .Bad(m) :> m", "        .Pair(a, b) :> \"pair\"", "        .Gone :> \"gone\""]),
    piped: VALUE(["        | .Bad(m) :> m", "        | .Pair(a, b) :> \"pair\"", "        | .Gone :> \"gone\""]),
  },
  {
    name: "paren-free binder `.V m :>`",
    pipeless: VALUE(["        .Bad m :> m", "        _ :> \"other\""]),
    piped: VALUE(["        | .Bad m :> m", "        | _ :> \"other\""]),
  },
  {
    name: "`::V(a) :>` head",
    pipeless: VALUE(["        ::Bad(m) :> m", "        ::Pair(a, b) :> \"pair\"", "        ::Gone :> \"gone\""]),
    piped: VALUE(["        | ::Bad(m) :> m", "        | ::Pair(a, b) :> \"pair\"", "        | ::Gone :> \"gone\""]),
  },
  {
    name: "wildcard `_ :>`",
    pipeless: VALUE(["        .Bad(m) :> m", "        _ :> \"other\""]),
    piped: VALUE(["        | .Bad(m) :> m", "        | _ :> \"other\""]),
  },
  {
    name: "wildcard `else :>` (≡ `| _ :>`)",
    pipeless: VALUE(["        .Bad(m) :> m", "        else :> \"other\""]),
    piped: VALUE(["        | .Bad(m) :> m", "        | _ :> \"other\""]),
  },
  {
    name: "`| else :>` (≡ `| _ :>`)",
    pipeless: VALUE(["        | .Bad(m) :> m", "        | else :> \"other\""]),
    piped: VALUE(["        | .Bad(m) :> m", "        | _ :> \"other\""]),
  },
  {
    name: "mixed pipe / pipe-less in one handler",
    pipeless: VALUE(["        .Bad(m) :> m", "        | .Pair(a, b) :> \"pair\"", "        .Gone :> \"gone\""]),
    piped: VALUE(["        | .Bad(m) :> m", "        | .Pair(a, b) :> \"pair\"", "        | .Gone :> \"gone\""]),
  },
  {
    name: "multi-statement block bodies with member access + nested braces",
    pipeless: STMT([
      "        .Bad(m) :> {",
      "            const s = { k: m }",
      "            console.log(s.k.length)",
      "        }",
      "        .Pair(a, b) :> { console.log([a, b].length) }",
      "        else :> { console.log(\"x\") }",
    ]),
    piped: STMT([
      "        | .Bad(m) :> {",
      "            const s = { k: m }",
      "            console.log(s.k.length)",
      "        }",
      "        | .Pair(a, b) :> { console.log([a, b].length) }",
      "        | _ :> { console.log(\"x\") }",
    ]),
  },
  {
    name: "legacy arrows `=>` / `->`",
    pipeless: VALUE(["        .Bad(m) => m", "        .Pair(a, b) -> \"pair\"", "        _ :> \"gone\""]),
    piped: VALUE(["        | .Bad(m) => m", "        | .Pair(a, b) -> \"pair\"", "        | _ :> \"gone\""]),
  },
  {
    name: "single-line arm list",
    pipeless: VALUE(["        .Bad(m) :> m .Pair(a, b) :> \"pair\" _ :> \"gone\""]),
    piped: VALUE(["        | .Bad(m) :> m | .Pair(a, b) :> \"pair\" | _ :> \"gone\""]),
  },
];

describe("S452 — pipe-less `!{}` handler arms compile identically to `|`-prefixed arms", () => {
  for (const c of CASES) {
    test(c.name, () => {
      const a = compileSrc(program(c.pipeless));
      const b = compileSrc(program(c.piped));
      expect(errorCodes(b.result)).toEqual([]);
      expect(errorCodes(a.result)).toEqual([]);
      expect(codes(a.result)).toEqual(codes(b.result));
      expect(a.clientJs.length).toBeGreaterThan(0);
      expect(a.clientJs).toBe(b.clientJs);
    });
  }
});

describe("S452 — the matched pipe-less arm runs", () => {
  const src = program(VALUE([
    "        .Bad(m) :> m",
    "        .Pair(a, b) :> \"pair\"",
    "        .Gone :> \"gone\"",
  ]));
  const { result, clientJs } = compileSrc(src);

  test("compiles with no errors (pre-fix: E-TYPE-080 Missing variant(s): Bad)", () => {
    expect(errorCodes(result)).toEqual([]);
  });
  test("go(1) takes the `.Bad(m)` arm and yields its payload", () => {
    expect(runGo(clientJs, 1)).toBe("bad-msg");
  });
  test("go(2) takes the `.Pair(a, b)` arm", () => {
    expect(runGo(clientJs, 2)).toBe("pair");
  });
  test("go(3) takes the unit `.Gone` arm", () => {
    expect(runGo(clientJs, 3)).toBe("gone");
  });
  test("go(5) succeeds — no arm runs, the value passes through", () => {
    expect(runGo(clientJs, 5)).toBe(5);
  });
});

describe("S452 — pipe-less arms are still checked", () => {
  test("a missing variant is still E-TYPE-080 (no arm silently swallowed)", () => {
    const { result } = compileSrc(program(STMT(["        .Bad(m) :> { return }"])));
    expect(errorCodes(result)).toContain("E-TYPE-080");
  });
  test("a member access in an arm body is not read as an arm head", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        .Bad(m) :> m.length",
      "        _ :> 0",
    ])));
    expect(errorCodes(result)).toEqual([]);
    expect(runGo(clientJs, 1)).toBe(7);
  });
});
