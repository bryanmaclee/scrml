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
  "type S:enum = { Empty, Unknown, Full }",
  "type F:enum = { Bad(msg: string), Other }",
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
  return new Function(`const _scrml_g = globalThis;\n${body}\nreturn ${m[1]}(${JSON.stringify(n)});`)();
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
    // §19.4.5 (S452): the paren-free binder exists ONLY after a `|`; its
    // canonical pipe-less spelling is `.V(m)`.
    name: "legacy paren-free binder `| .V m :>` ≡ canonical `.V(m) :>`",
    pipeless: VALUE(["        .Bad(m) :> m", "        _ :> \"other\""]),
    piped: VALUE(["        | .Bad m :> m", "        | _ :> \"other\""]),
  },
  {
    name: "type-qualified heads `T.V(a) :>` / `T::V :>`",
    pipeless: VALUE(["        E.Bad(m) :> m", "        E::Pair(a, b) :> \"pair\"", "        E.Gone :> \"gone\""]),
    piped: VALUE(["        | E.Bad(m) :> m", "        | E::Pair(a, b) :> \"pair\"", "        | E.Gone :> \"gone\""]),
  },
  {
    name: "arm bodies ending in `S.V` / `S::V` before `_` / `.V` heads (r1 HIGH shape)",
    pipeless: VALUE(["        .Pair(a, b) :> S.Full", "        .Gone :> S::Full", "        .Bad(m) :> S.Empty", "        _ :> S.Unknown"]),
    piped: VALUE(["        | .Pair(a, b) :> S.Full", "        | .Gone :> S::Full", "        | .Bad(m) :> S.Empty", "        | _ :> S.Unknown"]),
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
  {
    name: "r3 — whole-error arm `_ err :>` ≡ `| _ err :>`",
    pipeless: VALUE(["        .Bad(m) :> m", "        _ err :> \"other\""]),
    piped: VALUE(["        | .Bad(m) :> m", "        | _ err :> \"other\""]),
  },
  {
    name: "legacy `| ::V m :>` followed by pipe-less `.V :>` / `else :>` heads",
    pipeless: VALUE(["        | ::Bad m :> m", "        .Pair(a, b) :> \"pair\"", "        else :> \"other\""]),
    piped: VALUE(["        | ::Bad m :> m", "        | .Pair(a, b) :> \"pair\"", "        | _ :> \"other\""]),
  },
];

describe("S452 — pipe-less `!{}` handler arms compile identically to `|`-prefixed arms", () => {
  for (const c of CASES) {
    test(c.name, () => {
      const a = compileSrc(program(c.pipeless));
      const b = compileSrc(program(c.piped));
      expect(errorCodes(b.result)).toEqual([]);
      expect(errorCodes(a.result)).toEqual([]);
      // Same diagnostics, aside from W-ARM-PIPE-LEGACY (§19.4.5): exactly one
      // per `|`-led arm, on either side.
      // (the case lines carry no `|` in strings / bodies: every `| ` is an arm lead)
      const pipeLed = (lines) => lines.reduce((n, l) => n + (l.match(/(^|\s)\|\s/g) ?? []).length, 0);
      const noPipeLint = (r) => codes(r).filter((c) => c !== "W-ARM-PIPE-LEGACY");
      const pipeLints = (r) => codes(r).filter((c) => c === "W-ARM-PIPE-LEGACY").length;
      expect(noPipeLint(a.result)).toEqual(noPipeLint(b.result));
      expect(pipeLints(a.result)).toBe(pipeLed(c.pipeless));
      expect(pipeLints(b.result)).toBe(pipeLed(c.piped));
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

// ---------------------------------------------------------------------------
// S452 review r1 (HIGH, silent miscompile): an arm body ending in `X.V` /
// `X::V` followed by an arm starting `_` or a bare name was mis-split — the
// r1 head recognizer read `.Empty _ :>` as head `.Empty` + paren-free binder
// `_`, emitting `_result = S;`, a fake `variant === "Empty"` arm, and a
// wildcard that returned the raw error. Root fix: a pipe-less head never takes
// a paren-free binder (§19.4.5), and a `.`/`::` glued to the previous token is
// never a head. Each repro asserts the correct JS AND the run-time arm.
// ---------------------------------------------------------------------------

describe("S452 r2 — arm-body tail `X.V` / `X::V` is never read as the next arm's head", () => {
  const assertShape = (clientJs) => {
    expect(clientJs).not.toMatch(/=\s*S;/);
    expect(clientJs).not.toContain('variant === "Empty"');
    expect(clientJs).not.toContain('variant === "Full"');
    expect(clientJs).not.toContain('variant === "Unknown"');
  };

  test("pipe-less: `.Bad(m) :> S.Empty` then `_ :> S.Unknown` (the PA repro)", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        .Pair(a, b) :> S.Full",
      "        .Gone :> S.Full",
      "        .Bad(m) :> S.Empty",
      "        _ :> S.Unknown",
    ])));
    expect(errorCodes(result)).toEqual([]);
    assertShape(clientJs);
    expect(clientJs).toMatch(/= S\.Empty;/);
    expect(runGo(clientJs, 1)).toBe("Empty");
    expect(runGo(clientJs, 2)).toBe("Full");
    expect(runGo(clientJs, 3)).toBe("Full");
    expect(runGo(clientJs, 5)).toBe(5);
  });

  test("pipe-less: wildcard after an `S.V` tail catches the remaining variants", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        .Bad(m) :> S.Empty",
      "        _ :> S.Unknown",
    ])));
    expect(errorCodes(result)).toEqual([]);
    assertShape(clientJs);
    expect(runGo(clientJs, 1)).toBe("Empty");
    expect(runGo(clientJs, 2)).toBe("Unknown");
    expect(runGo(clientJs, 3)).toBe("Unknown");
  });

  test("mixed: `| .Bad(m) :> S.Empty` then pipe-less `_ :> S.Unknown`", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        | .Bad(m) :> S.Empty",
      "        _ :> S.Unknown",
    ])));
    expect(errorCodes(result)).toEqual([]);
    assertShape(clientJs);
    expect(runGo(clientJs, 1)).toBe("Empty");
    expect(runGo(clientJs, 2)).toBe("Unknown");
  });

  test("`::` tail: `.Bad(m) :> E::Gone` then `_ :> 0`", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        .Bad(m) :> E::Gone",
      "        _ :> 0",
    ])));
    expect(errorCodes(result)).toEqual([]);
    expect(clientJs).not.toMatch(/=\s*E;/);
    expect(runGo(clientJs, 1)).toBe("Gone");
    expect(runGo(clientJs, 2)).toBe(0);
    expect(runGo(clientJs, 3)).toBe(0);
  });

  test("mixed `::` tail: `| .Bad(m) :> S::Empty` then `_ :> S.Unknown`", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        | .Bad(m) :> S::Empty",
      "        _ :> S.Unknown",
    ])));
    expect(errorCodes(result)).toEqual([]);
    assertShape(clientJs);
    expect(runGo(clientJs, 1)).toBe("Empty");
    expect(runGo(clientJs, 3)).toBe("Unknown");
  });

  test("`S.Empty` tail then the old short form `Gone :> …` (short form unchanged)", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        | .Bad(m) :> S.Empty",
      "        | .Pair(a, b) :> S.Unknown",
      "        Gone :> S.Full",
    ])));
    expect(errorCodes(result)).toEqual([]);
    assertShape(clientJs);
    expect(runGo(clientJs, 1)).toBe("Empty");
    expect(runGo(clientJs, 2)).toBe("Unknown");
    expect(runGo(clientJs, 3)).toBe("Full");
  });

  test("pipe-less `S.Empty` tail then pipe-less `.Gone :>`", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        .Bad(m) :> S.Empty",
      "        .Pair(a, b) :> S.Unknown",
      "        .Gone :> S.Full",
    ])));
    expect(errorCodes(result)).toEqual([]);
    assertShape(clientJs);
    expect(runGo(clientJs, 1)).toBe("Empty");
    expect(runGo(clientJs, 3)).toBe("Full");
  });
});

// ---------------------------------------------------------------------------
// S452 r3 — the arm list never drops a token silently (E-PARSE-001); the
// whole-error arm; a type qualifier must name the handled error type.
// ---------------------------------------------------------------------------

const allDiags = (result) => [...(result.errors ?? []), ...(result.warnings ?? [])];

describe("S452 r3 — no silent token skipping in a `!{}` arm list", () => {
  test("pipe-less paren-free binder `.Bad m :>` is E-PARSE-001 naming the fix (was: arm dropped, wildcard ran)", () => {
    const { result } = compileSrc(program(VALUE(["        .Bad m :> m", "        _ :> \"other\""])));
    const e = (result.errors ?? []).find((x) => x.code === "E-PARSE-001");
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("Write `.Bad(m) :>`");
  });

  test("r4 — pipe-less `::Bad m :>` is E-PARSE-001 too (§19.4.5: paren-free binder only after `|`)", () => {
    const { result } = compileSrc(program(VALUE(["        ::Bad m :> m", "        _ :> \"other\""])));
    const e = (result.errors ?? []).find((x) => x.code === "E-PARSE-001");
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("Write `::Bad(m) :>`, or add the legacy `|`");
  });

  test("r4 — the legacy `| ::Bad m :>` is still accepted", () => {
    const { result } = compileSrc(program(VALUE(["        | ::Bad m :> m", "        | _ :> \"other\""])));
    expect(errorCodes(result)).toEqual([]);
  });

  test("an unrecognized arm head inside a body (`S` + newline `.Full(1) :> 5`) is E-PARSE-001 (was: `:> 5` dropped)", () => {
    const { result } = compileSrc(program(VALUE([
      "        .Bad(m) :> S",
      "        .Full(1) :> 5",
      "        _ :> 0",
    ])));
    const e = (result.errors ?? []).find((x) => x.code === "E-PARSE-001");
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("`:>`");
  });

  test("a stray token before the first arm is E-PARSE-001 naming it", () => {
    const { result } = compileSrc(program(VALUE(["        junk", "        .Bad(m) :> m", "        _ :> \"other\""])));
    const e = (result.errors ?? []).find((x) => x.code === "E-PARSE-001");
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("unexpected `junk`");
  });

  test("a comment between arms is not an error", () => {
    const { result } = compileSrc(program(VALUE(["        .Bad(m) :> m", "        // fallback", "        _ :> \"other\""])));
    expect(errorCodes(result)).toEqual([]);
  });
});

describe("S452 r3 — whole-error arm `_ err :>` (pipe-less) runs", () => {
  test("`_ err :>` binds the whole error and catches the remaining variants", () => {
    const { result, clientJs } = compileSrc(program(VALUE([
      "        .Bad(m) :> m",
      "        _ err :> \"caught\"",
    ])));
    expect(errorCodes(result)).toEqual([]);
    expect(runGo(clientJs, 1)).toBe("bad-msg");
    expect(runGo(clientJs, 2)).toBe("caught");
    expect(runGo(clientJs, 3)).toBe("caught");
  });
});

describe("S452 r3 — a type-qualified arm must name the handled error type", () => {
  const QM = "E-TYPE-ARM-QUALIFIER-MISMATCH";
  test("`| S.Empty :>` on an `E` handler is an error naming both enums", () => {
    const { result } = compileSrc(program(VALUE(["        | .Bad(m) :> m", "        | S.Empty :> \"x\"", "        | _ :> \"other\""])));
    const e = (result.errors ?? []).find((x) => x.code === QM);
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("`S`");
    expect(String(e.message)).toContain("`E`");
  });
  test("pipe-less `F.Bad(m) :>` (F also declares Bad) is an error, not a silent match of `E.Bad`", () => {
    const { result } = compileSrc(program(VALUE(["        F.Bad(m) :> m", "        _ :> \"other\""])));
    expect(errorCodes(result)).toContain(QM);
  });
  test("`E.Bad(m) :>` on an `E` handler is fine", () => {
    const { result } = compileSrc(program(VALUE(["        E.Bad(m) :> m", "        _ :> \"other\""])));
    expect(errorCodes(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S452 r5 — the qualifier check compares the ENUMS (aliases resolved), and the
// named-field binder gets an honest "not yet supported" message.
// ---------------------------------------------------------------------------

/** Program whose failable `loc` declares `errType`, plus extra type decls. */
function aliasProgram(extraTypes, errType, armLines) {
  return [
    "<program>",
    "type E:enum = { Bad(msg: string), Gone }",
    "type S:enum = { Empty, Unknown, Full }",
    ...extraTypes,
    `function loc(n)! -> ${errType} {`,
    "    if (n < 2) fail E::Bad(\"bad-msg\")",
    "    if (n < 3) fail E::Gone",
    "    return n",
    "}",
    "export function go(n) {",
    "    const r = loc(n) !{",
    ...armLines,
    "    }",
    "    return r",
    "}",
    "</program>",
    "",
  ].join("\n");
}

describe("S452 r5 — E-TYPE-ARM-QUALIFIER-MISMATCH resolves type aliases on both sides", () => {
  const QM = "E-TYPE-ARM-QUALIFIER-MISMATCH";
  test("alias on the handled side: `-> A` (A = E), arms `E.Bad(m)` / `E.Gone` — no error, arms run", () => {
    const { result, clientJs } = compileSrc(aliasProgram(["type A = E"], "A", ["        E.Bad(m) :> m", "        E.Gone :> \"gone\""]));
    expect(errorCodes(result)).toEqual([]);
    expect(runGo(clientJs, 1)).toBe("bad-msg");
    expect(runGo(clientJs, 2)).toBe("gone");
  });
  test("alias on the qualifier side: `-> E`, arms `A.Bad(m)` / `A.Gone` (A = E) — no error", () => {
    const { result } = compileSrc(aliasProgram(["type A = E"], "E", ["        A.Bad(m) :> m", "        A.Gone :> \"gone\""]));
    expect(errorCodes(result)).toEqual([]);
  });
  test("alias chain on both sides (B = A = E) — no error", () => {
    const { result } = compileSrc(aliasProgram(["type A = E", "type B = A"], "B", ["        A.Bad(m) :> m", "        _ :> \"other\""]));
    expect(errorCodes(result)).toEqual([]);
  });
  test("a genuine mismatch through an alias still fires (`-> A`, A = E, arm `S.Empty`)", () => {
    const { result } = compileSrc(aliasProgram(["type A = E"], "A", ["        .Bad(m) :> m", "        S.Empty :> \"x\"", "        _ :> \"other\""]));
    const e = (result.errors ?? []).find((x) => x.code === QM);
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("`A` (= `E`)");
  });
  test("a genuine mismatch where the QUALIFIER is an alias (`T = S`, arm `T.Empty` on `E`) fires", () => {
    const { result } = compileSrc(aliasProgram(["type T = S"], "E", ["        .Bad(m) :> m", "        T.Empty :> \"x\"", "        _ :> \"other\""]));
    expect(errorCodes(result)).toContain(QM);
  });
});

describe("S452 r5 — named-field binder message", () => {
  test("`.Bad(msg: m) :>` is E-PARSE-001 saying the named-field binder is not yet supported", () => {
    const { result } = compileSrc(program(VALUE(["        .Bad(msg: m) :> m", "        _ :> \"other\""])));
    const e = (result.errors ?? []).find((x) => x.code === "E-PARSE-001");
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("named-field binder");
    expect(String(e.message)).toContain("not yet supported");
    expect(String(e.message)).toContain("`.Bad(m) :>`");
    expect(String(e.message)).not.toContain("does not start an arm");
  });
});
