/**
 * fix-arm-pipe.test.js — the `scrml fix` rule `arm-pipe` (§19.4.5 / §51.0.S.2.3, S452).
 * change-id: s452-arm-pipe-deprecation. Ruling: user-voice-scrml.md S452 "c looks right" +
 * "a. one spelling".
 *
 * The rule (§19.4.5's table): delete a `|`-led pattern arm's leading `|` (and the space after it);
 * a paren-free binder gains its parentheses (`.V m` → `.V(m)`, `::V m` → `::V(m)`,
 * `T.V m` → `T.V(m)`); arms sharing a line go one per line; separator, prefix and body are left as
 * written. Arms are located from impl#1's arm records, so `match` arms, alternation, `||` and `|`
 * in strings / comments / SQL are never touched. Every rewritten file is verified by compiling it
 * before and after (byte-identical artifacts; the same codes aside from the cleared lint).
 */

import { describe, test, expect } from "bun:test";
import { fixArmPipe } from "../../src/commands/fix-arm-pipe.js";
import { fixS66, S66_RULES, IMPL1_SAFE_RULES } from "../../src/commands/fix-s66.js";
import { runFixCommand } from "../../src/commands/fix.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
const program = (body) => [...PRELUDE, "export function go(n) {", ...body, "}", "</program>", ""].join("\n");

const fix = (src, opts = {}) => fixArmPipe(src, { filePath: "/virtual/app.scrml", ...opts });

/** impl#1's codes for a source compiled at a fixed scratch path. */
function codesOf(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-arm-pipe-t-"));
  try {
    const f = join(dir, "app.scrml");
    writeFileSync(f, src);
    const r = compileScrml({ inputFiles: [f], write: false, outputDir: join(dir, "out"), log: () => {} });
    return [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code).sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const count = (codes, c) => codes.filter((x) => x === c).length;

describe("arm-pipe — `!{}` handler arms", () => {
  test("deletes the leading `|` and the space after it; separator, prefix and body as written", () => {
    const src = program([
      "    const r = risky(n) !{",
      "        | .Bad(m) :> m",
      "        | ::Pair(a, b) => \"pair\"",
      "        | E.Gone -> { return \"gone\" }",
      "    }",
      "    return r",
    ]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.output).toContain("\n        .Bad(m) :> m\n");
    expect(r.output).toContain("\n        ::Pair(a, b) => \"pair\"\n");
    expect(r.output).toContain("\n        E.Gone -> { return \"gone\" }\n");
    expect(r.output).not.toMatch(/^\s*\|/m);
    expect(r.applied.length).toBe(3);
    expect(r.applied.every((a) => a.rule === "arm-pipe")).toBe(true);
  });

  test("a paren-free binder gains its parentheses: `.V m` / `::V m` / `T.V m`", () => {
    const src = program([
      "    const r = risky(n) !{",
      "        | .Bad m :> m",
      "        | ::Pair p :> \"pair\"",
      "        | E.Gone g :> \"gone\"",
      "    }",
      "    return r",
    ]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.output).toContain("\n        .Bad(m) :> m\n");
    expect(r.output).toContain("\n        ::Pair(p) :> \"pair\"\n");
    expect(r.output).toContain("\n        E.Gone(g) :> \"gone\"\n");
  });

  test("the whole-error arm `| _ e :>` → `_ e :>`; a headless bare binder `| e :>` → `_ e :>`", () => {
    const a = fix(program(["    const r = risky(n) !{", "        | .Bad(m) :> m", "        | _ e :> \"x\"", "    }", "    return r"]));
    expect(a.output).toContain("\n        _ e :> \"x\"\n");
    const b = fix(program(["    const r = risky(n) !{", "        | .Bad(m) :> m", "        | e :> \"x\"", "    }", "    return r"]));
    expect(b.blockers).toEqual([]);
    expect(b.output).toContain("\n        _ e :> \"x\"\n");
  });

  test("arms sharing a line go one per line, aligned under the first", () => {
    const src = program(["    const r = risky(n) !{ | .Bad(m) :> m | .Pair(a, b) :> \"pair\" | _ :> \"x\" }", "    return r"]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.output).toContain(
      "    const r = risky(n) !{ .Bad(m) :> m\n" +
      "                          .Pair(a, b) :> \"pair\"\n" +
      "                          _ :> \"x\" }\n",
    );
  });

  test("a mixed handler: only the `|`-led arms change", () => {
    const src = program(["    const r = risky(n) !{", "        .Bad(m) :> m", "        | .Pair(a, b) :> \"pair\"", "        _ :> \"x\"", "    }", "    return r"]);
    const r = fix(src);
    expect(r.applied.length).toBe(1);
    expect(r.output).toBe(src.replace("        | .Pair", "        .Pair"));
  });

  test("the W-ARM-PIPE-LEGACY lints are cleared, and nothing else changes", () => {
    const src = program(["    const r = risky(n) !{", "        | .Bad m :> m", "        | .Pair(a, b) :> \"pair\"", "        | _ :> \"x\"", "    }", "    return r"]);
    const before = codesOf(src);
    expect(count(before, "W-ARM-PIPE-LEGACY")).toBe(3);
    const after = codesOf(fix(src).output);
    expect(count(after, "W-ARM-PIPE-LEGACY")).toBe(0);
    expect(after).toEqual(before.filter((c) => c !== "W-ARM-PIPE-LEGACY"));
  });
});

describe("arm-pipe — engine message arms (§51.0.S.2.3)", () => {
  const ENGINE = (idle, busy) => [
    "<program>",
    "type Phase:enum = { Idle, Busy(id: number) }",
    "type Msg:enum = { Start(id: number), Stop }",
    "<engine for=Phase initial=.Idle accepts=Msg>",
    "  <Idle rule=.Busy>",
    ...idle,
    "  </>",
    "  <Busy(id) rule=.Idle>",
    ...busy,
    "    <p>busy</p>",
    "  </>",
    "</>",
    "<button onclick=${@phase.advance(.Start(1))}>go</button>",
    "</program>",
    "",
  ].join("\n");

  test("deletes the `|`; render content after the arms untouched", () => {
    const src = ENGINE(["    | .Start(id) :> .Busy(id)", "    | _          :> @phase"], ["    | .Stop :> .Idle", "    | _ :> @phase"]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.applied.length).toBe(4);
    expect(r.output).toBe(ENGINE(["    .Start(id) :> .Busy(id)", "    _          :> @phase"], ["    .Stop :> .Idle", "    _ :> @phase"]));
  });

  test("message arms sharing a line go one per line (a pipe-less head must start its line)", () => {
    const src = ENGINE(["    | .Start(id) :> .Busy(id) | _ :> @phase"], ["    | .Stop :> .Idle | _ :> @phase"]);
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    expect(r.output).toBe(ENGINE(["    .Start(id) :> .Busy(id)", "    _ :> @phase"], ["    .Stop :> .Idle", "    _ :> @phase"]));
    expect(count(codesOf(r.output), "W-ARM-PIPE-LEGACY")).toBe(0);
  });
});

describe("arm-pipe — handlers in attribute values, and what it reports instead of guessing", () => {
  test("a `!{}` inside an `onclick={…}` (spans re-based by the attribute parse) is rewritten", () => {
    const src = [
      "type LoadError:enum = { Empty, Bad }",
      "${",
      "    function risky()! -> LoadError { fail LoadError.Empty }",
      "}",
      "<r> = 0",
      "<button id=\"one\" onclick={ risky() !{ | .Empty :> @r = 1 | .Bad :> @r = 2 } }>one</button>",
      "<p>${@r}</p>",
      "",
    ].join("\n");
    const r = fix(src);
    expect(r.blockers).toEqual([]);
    const lead = "<button id=\"one\" onclick={ risky() !{ ";
    expect(r.output).toContain(`${lead}.Empty :> @r = 1\n${" ".repeat(lead.length)}.Bad :> @r = 2 } }>one</button>`);
  });

  test("a `|`-led arm in a component body is REPORTED, not rewritten (no confirmable position)", () => {
    const src = [
      "type LoadError:enum = { Empty, Bad }",
      "${",
      "    function risky()! -> LoadError { fail LoadError.Empty }",
      "    const Btn = <button id=\"c\" onclick={ risky() !{ | .Empty :> @r = 1 | .Bad :> @r = 2 } }>go</>",
      "}",
      "<r> = 0",
      "<Btn/>",
      "",
    ].join("\n");
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.blockers.length).toBe(1);
    expect(r.blockers[0].line).toBe(4);
    expect(r.blockers[0].reason).toContain("component body");
  });

  test("a `|`-led head with no arm arrow is REPORTED and its handler left whole", () => {
    const src = program(["    const r = risky(n) !{", "        | Mystery e -> \"x\"", "        | .Gone :> \"g\"", "    }", "    return r"]);
    const r = fix(src, { verify: false });
    expect(r.changed).toBe(false);
    expect(r.blockers.length).toBe(1);
    expect(r.blockers[0].reason).toContain("no arm arrow");
  });
});

describe("arm-pipe — what it never touches", () => {
  test("match arms, `|` alternation, `||`, and `|` in strings / comments / SQL", () => {
    const src = [
      "<program>",
      "type E:enum = { Bad(msg: string), Gone }",
      "type T:enum = { A, B, C }",
      "function risky(n)! -> E {",
      "    if (n < 2) fail E::Bad(\"x | y\")",
      "    return n",
      "}",
      "export function go(n, t) {",
      "    // a | comment | with pipes",
      "    const k = match t {",
      "        .A | .B :> 1",
      "        .C :> 2",
      "    }",
      "    const r = risky(n) !{",
      "        .Bad(m) :> (m || \"a | b\")",
      "        _ :> \"x\"",
      "    }",
      "    return k",
      "}",
      "</program>",
      "",
    ].join("\n");
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(src);
    expect(r.blockers).toEqual([]);
  });

  test("a `|` in a `?{}` SQL block is not an arm", () => {
    const src = [
      "<program db=\"sqlite::memory:\">",
      "<schema>",
      "  users: { id: integer primary key, name: text }",
      "</schema>",
      "server function names() {",
      "    return ?{`SELECT name || '|' || id FROM users`}.all() !{",
      "        | _ e :> []",
      "    }",
      "}",
      "</program>",
      "",
    ].join("\n");
    const r = fix(src, { verify: false });
    expect(r.output).toContain("SELECT name || '|' || id FROM users");
    expect(r.output).toContain("\n        _ e :> []\n");
  });

  test("idempotent: a second run makes no edit", () => {
    const src = program(["    const r = risky(n) !{ | .Bad m :> m | ::Pair(a, b) => \"pair\" | _ :> \"x\" }", "    return r"]);
    const once = fix(src);
    expect(once.changed).toBe(true);
    const twice = fix(once.output);
    expect(twice.changed).toBe(false);
    expect(twice.applied).toEqual([]);
    expect(twice.output).toBe(once.output);
  });

  test("a file with no `|`-led arm is returned unchanged", () => {
    const src = program(["    const r = risky(n) !{ .Bad(m) :> m", "        _ :> \"x\" }", "    return r"]);
    expect(fix(src)).toEqual({ output: src, changed: false, applied: [], blockers: [] });
  });
});

describe("arm-pipe — wiring into `scrml fix`", () => {
  test("arm-pipe is a default (impl#1-compilable) rule, chained after pre-migrate", () => {
    expect(IMPL1_SAFE_RULES).toContain("arm-pipe");
    expect(S66_RULES.indexOf("arm-pipe")).toBe(S66_RULES.indexOf("pre-migrate") + 1);
  });

  test("fixS66 with rules=[arm-pipe] applies only arm-pipe", () => {
    const src = program(["    const r = risky(n) !{", "        | .Bad m :> m", "        | _ :> \"x\"", "    }", "    return r"]);
    const r = fixS66(src, { filePath: "/virtual/app.scrml", rules: ["arm-pipe"] });
    expect(r.applied.map((a) => a.rule)).toEqual(["arm-pipe", "arm-pipe"]);
    expect(r.output).toContain("\n        .Bad(m) :> m\n");
  });

  test("CLI: --check exits 1 on a legacy arm; --rules=arm-pipe writes; a second --check exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-fix-arm-pipe-cli-"));
    const io = { out: () => {}, err: () => {} };
    try {
      mkdirSync(join(dir, "src"));
      const f = join(dir, "src", "app.scrml");
      writeFileSync(f, program(["    const r = risky(n) !{", "        | .Bad m :> m", "        | _ :> \"x\"", "    }", "    return r"]));
      expect(runFixCommand([f, "--rules=arm-pipe", "--check"], io)).toBe(1);
      expect(runFixCommand([f, "--rules=arm-pipe"], io)).toBe(0);
      expect(readFileSync(f, "utf8")).toContain("\n        .Bad(m) :> m\n");
      expect(runFixCommand([f, "--rules=arm-pipe", "--check"], io)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
