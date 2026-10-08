/**
 * arm-pipe-legacy-lint-s452.test.js
 *
 * §19.4.5 / §51.0.S.2.3 / §34 — W-ARM-PIPE-LEGACY (S452, ruling: user-voice-scrml.md
 * S452 "c looks right" + "a. one spelling"). A `!{}` handler arm or an engine
 * `(state × message)` message arm led by `|` is SOFT-DEPRECATED (§63.1 Stage 1):
 * it parses identically to the pipe-less §18.2 match arm and surfaces one
 * info-level W-ARM-PIPE-LEGACY per arm, naming the canonical arm, `scrml fix`
 * and §19.4.5.
 *
 * Emit sites (impl#1): `!{}` arms — type-system.ts `guarded-expr` (from the arm
 * record's `legacyPipe`, set by ast-builder.js `parseErrorTokens`); message arms
 * — symbol-table.ts message-arm validation (from `legacyPipe`, set by
 * engine-statechild-parser.ts `parseMessageArms`).
 *
 * FULL-PIPELINE (compileScrml) per the R26 doctrine.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ONE fixed directory per test-file run: the engine-derived names carry a token
// hashed from the SOURCE PATH (chunk namespacing), so a byte-identity compare of
// two spellings must compile them at the same path.
const RUN_DIR = join(tmpdir(), `scrml-arm-pipe-lint-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
function compileSrc(src) {
  const tmp = RUN_DIR;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const srcFile = join(tmp, "h.scrml");
  writeFileSync(srcFile, src);
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir, log: () => {} });
  const p = join(outDir, "h.client.js");
  const clientJs = existsSync(p) ? readFileSync(p, "utf8") : "";
  rmSync(tmp, { recursive: true, force: true });
  return { result, clientJs };
}

const pipeLints = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])].filter((d) => d.code === "W-ARM-PIPE-LEGACY");
const errorCodes = (r) => (r.errors ?? []).map((e) => e.code);

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
const VALUE = (arms) => ["    const r = risky(n) !{", ...arms, "    }", "    return r"];

describe("W-ARM-PIPE-LEGACY — `!{}` handler arms", () => {
  test("one info-level lint per `|`-led arm, in result.warnings, never an error", () => {
    const { result } = compileSrc(program(VALUE([
      "        | .Bad(m) :> m",
      "        | .Pair(a, b) :> \"pair\"",
      "        | .Gone :> \"gone\"",
    ])));
    expect(errorCodes(result)).toEqual([]);
    const ws = pipeLints(result);
    expect(ws.length).toBe(3);
    for (const w of ws) expect(w.severity).toBe("info");
    expect((result.errors ?? []).some((e) => e.code === "W-ARM-PIPE-LEGACY")).toBe(false);
    expect((result.warnings ?? []).filter((e) => e.code === "W-ARM-PIPE-LEGACY").length).toBe(3);
  });

  test("the message names the arm, the canonical spelling, `scrml fix` and §19.4.5", () => {
    const { result } = compileSrc(program(VALUE(["        | .Bad(m) :> m", "        | _ :> \"x\""])));
    const [w] = pipeLints(result);
    expect(w.message).toContain("'| .Bad(m) :>'");
    expect(w.message).toContain("write '.Bad(m) :>'");
    expect(w.message).toContain("scrml fix");
    expect(w.message).toContain("§19.4.5");
    expect(w.message).toContain("§18.2");
  });

  test("the canonical spelling of a parenthesis-free binder is `.V(m)` / `::V(m)` / `T.V(m)`", () => {
    const { result } = compileSrc(program(VALUE([
      "        | .Bad m :> m",
      "        | ::Pair p :> \"pair\"",
      "        | E.Gone g :> \"gone\"",
    ])));
    const msgs = pipeLints(result).map((w) => w.message);
    expect(msgs.length).toBe(3);
    expect(msgs[0]).toContain("'| .Bad m :>'");
    expect(msgs[0]).toContain("write '.Bad(m) :>'");
    expect(msgs[1]).toContain("write '::Pair(p) :>'");
    expect(msgs[2]).toContain("write 'E.Gone(g) :>'");
  });

  test("the whole-error arm `| _ e :>` → `_ e :>`; a bare binder `| e :>` → `_ e :>`", () => {
    const a = compileSrc(program(VALUE(["        | .Bad(m) :> m", "        | _ e :> \"x\""])));
    expect(pipeLints(a.result)[1].message).toContain("write '_ e :>'");
    const b = compileSrc(program(VALUE(["        | .Bad(m) :> m", "        | e :> \"x\""])));
    expect(pipeLints(b.result)[1].message).toContain("'| e :>'");
    expect(pipeLints(b.result)[1].message).toContain("write '_ e :>'");
  });

  test("the separator is quoted as written (it has its own lint, W-MATCH-ARROW-LEGACY)", () => {
    const { result } = compileSrc(program(VALUE(["        | .Bad(m) => m", "        | _ -> \"x\""])));
    const msgs = pipeLints(result).map((w) => w.message);
    expect(msgs[0]).toContain("write '.Bad(m) =>'");
    expect(msgs[1]).toContain("write '_ ->'");
    const all = [...(result.errors ?? []), ...(result.warnings ?? [])].map((d) => d.code);
    expect(all.filter((c) => c === "W-MATCH-ARROW-LEGACY").length).toBe(2);
  });

  test("two `|`-led arms on one line are two lints", () => {
    const { result } = compileSrc(program(VALUE(["        | .Bad(m) :> m | _ :> \"x\""])));
    expect(pipeLints(result).length).toBe(2);
  });

  test("pipe-less arms: no lint; mixed handler: one per `|`-led arm only", () => {
    const a = compileSrc(program(VALUE(["        .Bad(m) :> m", "        .Pair(a, b) :> \"pair\"", "        _ :> \"x\""])));
    expect(errorCodes(a.result)).toEqual([]);
    expect(pipeLints(a.result).length).toBe(0);
    const b = compileSrc(program(VALUE(["        .Bad(m) :> m", "        | .Pair(a, b) :> \"pair\"", "        _ :> \"x\""])));
    expect(pipeLints(b.result).length).toBe(1);
  });

  test("a `||` / string `|` inside an arm body, and `match` alternation, do not lint", () => {
    const { result } = compileSrc(program([
      "    const r = risky(n) !{",
      "        .Bad(m) :> (m || \"a | b\")",
      "        _ :> \"x\"",
      "    }",
      "    const k = match r { \"a\" | \"b\" :> 1",
      "        _ :> 2 }",
      "    return k",
    ]));
    expect(pipeLints(result).length).toBe(0);
  });

  test("info-level: the piped and pipe-less spellings emit byte-identical client JS", () => {
    const a = compileSrc(program(VALUE(["        | .Bad m :> m", "        | _ :> \"x\""])));
    const b = compileSrc(program(VALUE(["        .Bad(m) :> m", "        _ :> \"x\""])));
    expect(errorCodes(a.result)).toEqual([]);
    expect(a.clientJs.length).toBeGreaterThan(0);
    expect(a.clientJs).toBe(b.clientJs);
  });
});

describe("W-ARM-PIPE-LEGACY — every handler impl#1 parses (S452 review r1)", () => {
  test("a handler NESTED in another arm's `{…}` body: its `|`-led arms lint too", () => {
    const { result } = compileSrc(program([
      "    const r = risky(n) !{",
      "        | .Bad(m) :> {",
      "            const x = risky(2) !{",
      "                | .Gone :> 1",
      "                | _ :> 2",
      "            }",
      "            return x",
      "        }",
      "        | _ :> 3",
      "    }",
      "    return r",
    ]));
    expect(errorCodes(result)).toEqual([]);
    const ws = pipeLints(result);
    expect(ws.length).toBe(4);
    expect(ws.map((w) => w.span.line)).toEqual([11, 13, 14, 18]);
  });

  test("a standalone `!{ … }` error-effect block lints", () => {
    const { result } = compileSrc([
      "<div>",
      "    !{",
      "        | ::ValidationError(err) -> let msg = \"Validation failed\"",
      "        | _ err -> let msg = \"Something went wrong\"",
      "    }",
      "    <p>Typed error handler</>",
      "</div>",
      "",
    ].join("\n"));
    const ws = pipeLints(result);
    expect(ws.length).toBe(2);
    expect(ws[0].message).toContain("write '::ValidationError(err) ->'");
  });

  test("one lint per arm SITE: a component instantiated twice lints its arms once", () => {
    const { result } = compileSrc([
      "type LoadError:enum = { Empty, Bad }",
      "${",
      "    function risky()! -> LoadError { fail LoadError.Empty }",
      "    const Btn = <button onclick={ risky() !{ | .Empty :> @r = 1 | .Bad :> @r = 2 } }>go</>",
      "}",
      "<r> = 0",
      "<Btn/>",
      "<Btn/>",
      "",
    ].join("\n"));
    expect(pipeLints(result).length).toBe(2);
  });

  test("in a component body the lint does NOT tell the author to drop the `|` (impl#1 gap)", () => {
    const { result } = compileSrc([
      "type LoadError:enum = { Empty, Bad }",
      "${",
      "    function risky()! -> LoadError { fail LoadError.Empty }",
      "    const Btn = <button onclick={ risky() !{ | .Empty :> @r = 1 | .Bad :> @r = 2 } }>go</>",
      "}",
      "<r> = 0",
      "<Btn/>",
      "",
    ].join("\n"));
    const [w] = pipeLints(result);
    expect(w.message).toContain("component body");
    expect(w.message).toContain("keep the '|'");
    expect(w.message).not.toContain("Run 'scrml fix'");
  });

  test("an arm with no separator of its own (attempted alternation) gets no rewrite suggestion", () => {
    const { result } = compileSrc(program(VALUE([
      "        | .Bad(m) :> m",
      "        | .Pair(a, b) | .Gone :> \"x\"",
    ])));
    const msgs = pipeLints(result).map((w) => w.message);
    expect(msgs.length).toBe(3);
    const alt = msgs.find((m) => m.includes("'| .Pair(a, b)'"));
    expect(alt).toContain("no arm separator");
    expect(alt).not.toContain("write '.Pair(a, b) :>'");
  });
});

const ENGINE = (arms) => [
  "<program>",
  "type Phase:enum = { Idle, Busy(id: number) }",
  "type Msg:enum = { Start(id: number), Stop }",
  "<engine for=Phase initial=.Idle accepts=Msg>",
  "  <Idle rule=.Busy>",
  ...arms.idle,
  "  </>",
  "  <Busy(id) rule=.Idle>",
  ...arms.busy,
  "  </>",
  "</>",
  "<button onclick=${@phase.advance(.Start(1))}>go</button>",
  "</program>",
  "",
].join("\n");

describe("W-ARM-PIPE-LEGACY — engine message arms (§51.0.S.2.3)", () => {
  test("one info-level lint per `|`-led message arm, naming the arm and its state-child", () => {
    const { result } = compileSrc(ENGINE({
      idle: ["    | .Start(id) :> .Busy(id)", "    | _ :> @phase"],
      busy: ["    | .Stop :> .Idle", "    | _ :> @phase"],
    }));
    expect(errorCodes(result)).toEqual([]);
    const ws = pipeLints(result);
    expect(ws.length).toBe(4);
    for (const w of ws) expect(w.severity).toBe("info");
    expect(ws[0].message).toContain("'| .Start(id) :>'");
    expect(ws[0].message).toContain("write '.Start(id) :>'");
    expect(ws[0].message).toContain("<Idle>");
    expect(ws[0].message).toContain("§19.4.5");
    // Each lint carries its OWN arm's span (line:col of its `|`), not the engine's.
    expect(ws.map((w) => [w.span.line, w.span.col])).toEqual([[6, 5], [7, 5], [10, 5], [11, 5]]);
  });

  test("E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE suggests the pipe-less wildcard `_ :>`", () => {
    const { result } = compileSrc(ENGINE({
      idle: ["    .Start(id) :> .Busy(id)"],
      busy: ["    .Stop :> .Idle", "    _ :> @phase"],
    }));
    const e = (result.errors ?? []).find((d) => d.code === "E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE");
    expect(e).toBeDefined();
    expect(e.message).toContain("`_ :>`");
    expect(e.message).not.toContain("`| _");
  });

  test("pipe-less message arms: no lint, and byte-identical client JS to the piped spelling", () => {
    const piped = compileSrc(ENGINE({
      idle: ["    | .Start(id) :> .Busy(id)", "    | _ :> @phase"],
      busy: ["    | .Stop :> .Idle", "    | _ :> @phase"],
    }));
    const bare = compileSrc(ENGINE({
      idle: ["    .Start(id) :> .Busy(id)", "    _ :> @phase"],
      busy: ["    .Stop :> .Idle", "    _ :> @phase"],
    }));
    expect(errorCodes(bare.result)).toEqual([]);
    expect(pipeLints(bare.result).length).toBe(0);
    expect(bare.clientJs.length).toBeGreaterThan(0);
    expect(bare.clientJs).toBe(piped.clientJs);
  });
});
