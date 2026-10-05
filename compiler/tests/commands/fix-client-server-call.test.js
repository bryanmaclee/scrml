/**
 * fix-client-server-call.test.js — the `scrml fix` rule `client-server-call` (SPEC §19.9.10,
 * S454 F8). change-id: s454-scrml-fix-f8-r11.
 *
 * An UNHANDLED client call of a server function not declared `!` gets the local handler
 * `!{ .Transport(t) :> { return } }` (braced arm body, §18.2); an unbraced / `${…}` handler value is
 * written braced; a client-function-body site carries an INFO (callers no longer abort). Sites the
 * rule cannot rewrite are LISTED. Every rewritten file passes a gate (re-parse + same impl#1 codes).
 */

import { describe, test, expect } from "bun:test";
import { fixClientServerCall, armsCoverTransport, TRANSPORT_HANDLER, CLIENT_SERVER_CALL_RULE } from "../../src/commands/fix-client-server-call.js";
import { fixS66, S66_RULES, IMPL1_SAFE_RULES } from "../../src/commands/fix-s66.js";
import { runFixCommand } from "../../src/commands/fix.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SQ = "?" + "{";
const H = TRANSPORT_HANDLER;
const DECLS = [
  "  <count> = 0",
  "  <msg> = \"\"",
  "  type SaveError:enum = { Boom }",
  `  \${ function touch() {`,
  `      ${SQ}\`UPDATE t SET n = n + 1\`}.run() !{ _ :> {} }`,
  "  } }",
  `  \${ function getN() -> int {`,
  `      ${SQ}\`UPDATE t SET n = n\`}.run() !{ _ :> {} }`,
  "      return 0",
  "  } }",
  `  \${ function save()! SaveError {`,
  `      ${SQ}\`UPDATE t SET n = 0\`}.run() !{ _ :> { fail .Boom } }`,
  "      return 1",
  "  } }",
];
const program = (lines) => ["<program db=\"sqlite:./app.db\">", ...DECLS, ...lines, "</program>", ""].join("\n");
const fix = (src, opts = {}) => fixClientServerCall(src, { filePath: "/virtual/app.scrml", ...opts });
const reasons = (r) => r.blockers.map((b) => b.reason);

describe("client-server-call — rewrites", () => {
  test("a client function body: statement, cell write, declaration, return — each gets the handler + an INFO", () => {
    const src = program([
      "  ${ function go() {",
      "      touch()",
      "      @count = getN()",
      "      const v = getN()",
      "      @msg = \"done \" + v",
      "  } }",
      "  ${ function again() {",
      "      return getN()",
      "  } }",
      "  <button onclick=go()>Go</button>",
      "  <button onclick=again()>Again</button>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(true);
    expect(r.output).toContain(`      touch() ${H}\n`);
    expect(r.output).toContain(`      @count = getN() ${H}\n`);
    expect(r.output).toContain(`      const v = getN() ${H}\n`);
    expect(r.output).toContain(`      return getN() ${H}\n`);
    expect(r.applied.length).toBe(4);
    expect(r.infos.length).toBe(4);
    expect(r.infos.every((i) => i.rule === CLIENT_SERVER_CALL_RULE && /callers no longer abort/.test(i.message))).toBe(true);
    expect(r.infos.map((i) => i.line)).toEqual(r.applied.map((a) => a.line));
  });

  test("handler values: braced block (one or more statements), bare call, bare assignment, `${…}` — all end braced", () => {
    const src = program([
      "  <button onclick={ touch() }>A</button>",
      "  <button onclick={ @count = getN(); @msg = \"x\" }>B</button>",
      "  <button onclick=touch()>C</button>",
      "  <button onclick=@count = getN()>D</button>",
      "  <button onclick=${ @count = getN() }>E</button>",
    ]);
    const r = fix(src);
    expect(r.output).toContain(`<button onclick={ touch() ${H} }>A</button>`);
    expect(r.output).toContain(`<button onclick={ @count = getN() ${H}; @msg = "x" }>B</button>`);
    expect(r.output).toContain(`<button onclick={ touch() ${H} }>C</button>`);
    expect(r.output).toContain(`<button onclick={ @count = getN() ${H} }>D</button>`);
    expect(r.output).toContain(`<button onclick={ @count = getN() ${H} }>E</button>`);
    expect(r.applied.length).toBe(5);
    expect(r.infos).toEqual([]); // handler sites keep their meaning — no INFO
    expect(r.blockers).toEqual([]);
  });

  test("the arm body is BRACED — never a bare `:> return` (§18.2 arm-body ::= expression | block-body)", () => {
    expect(H).toBe("!{ .Transport(t) :> { return } }");
    const r = fix(program(["  <button onclick=touch()>A</button>"]));
    expect(r.output).not.toMatch(/:>\s*return\b/);
  });

  test("idempotent — a second run changes nothing", () => {
    const src = program([
      "  ${ function go() {",
      "      touch()",
      "  } }",
      "  <button onclick=go()>Go</button>",
      "  <button onclick=touch()>C</button>",
    ]);
    const r1 = fix(src);
    expect(r1.changed).toBe(true);
    const r2 = fix(r1.output);
    expect(r2.changed).toBe(false);
    expect(r2.applied).toEqual([]);
  });

  test("an imported server function is judged by impl#1's whole-program placement", () => {
    const api = [
      `\${ export function stamp() {`,
      `    ${SQ}\`UPDATE t SET n = 1\`}.run() !{ _ :> {} }`,
      "} }",
      "",
    ].join("\n");
    const app = [
      "<program db=\"sqlite:./app.db\">",
      "  ${ import { stamp } from \"./api.scrml\" }",
      "  <button onclick=stamp()>Stamp</button>",
      "</program>",
      "",
    ].join("\n");
    const r = fixClientServerCall(app, { filePath: "/virtual/app.scrml", auxSources: { "/virtual/api.scrml": api } });
    expect(r.output).toContain(`<button onclick={ stamp() ${H} }>Stamp</button>`);
  });
});

describe("client-server-call — sites left alone", () => {
  test("a server→server call, a handled call, a `!` callee's covering handler, and a non-server call are untouched", () => {
    const src = program([
      `  \${ function both() {`,
      `      ${SQ}\`UPDATE t SET n = 2\`}.run() !{ _ :> {} }`,
      "      touch()",
      "  } }",
      "  ${ function local() { return 1 } }",
      "  ${ function go() {",
      `      touch() ${H}`,
      "      @count = getN() !{ _ :> { return } }",
      "      save() !{ .Boom :> { @msg = \"b\" }\n          _ :> { return } }",
      "      @count = local()",
      "  } }",
      "  <button onclick=go()>Go</button>",
    ]);
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.blockers).toEqual([]);
  });

  test("a `<channel>` onserver:* handler runs on the server — not a client call", () => {
    const src = [
      "<program db=\"sqlite:./app.db\">",
      "  <channel name=\"chat\" onserver:message=record(msg)>",
      "    ${",
      "      function record(msg) {",
      `        ${SQ}\`INSERT INTO msgs (body) VALUES (\${msg})\`}.run() !{ _ :> {} }`,
      "      }",
      "    }",
      "  </channel>",
      "</program>",
      "",
    ].join("\n");
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.blockers).toEqual([]);
  });
});

describe("client-server-call — sites LISTED for a human (never rewritten)", () => {
  test("a call inside a larger expression (a value position)", () => {
    const r = fix(program([
      "  ${ function go() {",
      "      @count = getN() + 1",
      "  } }",
      "  <button onclick=go()>Go</button>",
    ]));
    expect(r.changed).toBe(false);
    expect(reasons(r).some((x) => /inside a larger expression/.test(x))).toBe(true);
  });

  test("a closure, a handler reference, and a handled `! E` call whose `!{}` covers neither Transport nor `_`", () => {
    const r = fix(program([
      "  <button onclick=${() => touch()}>A</button>",
      "  <button onclick=touch>B</button>",
      "  <button onclick={ save() !{ .Boom :> { @msg = \"b\" } } }>C</button>",
    ]));
    expect(r.changed).toBe(false);
    const rs = reasons(r);
    expect(rs.some((x) => /inside a closure/.test(x))).toBe(true);
    expect(rs.some((x) => /handler reference/.test(x))).toBe(true);
    expect(rs.some((x) => /names neither `\.Transport\(t\)` nor a catch-all/.test(x))).toBe(true);
  });

  test("a `defer` body (a `return` there is E-DEFER-CONTROL-FLOW) and a handler arm; the statements after the defer are rewritten", () => {
    const r = fix(program([
      "  ${ function go() {",
      "      defer {",
      "          touch()",
      "      }",
      "      save() !{ .Boom :> { touch() }\n          _ :> { return } }",
      "      touch()",
      "  } }",
      "  <button onclick=go()>Go</button>",
    ]));
    expect(r.applied.length).toBe(1);
    expect(r.output).toContain(`      }\n      save()`);
    expect(r.output).toContain(`          touch()\n      }`);
    expect(r.output).toContain(`      touch() ${H}\n  } }`);
    const rs = reasons(r);
    expect(rs.some((x) => /`defer-stmt` body/.test(x))).toBe(true);
    expect(rs.some((x) => /handler \/ match arm/.test(x))).toBe(true);
  });

  test("a module / route file (entry: false): function bodies are listed (placement is whole-program, F5); handler values are still rewritten", () => {
    const src = program([
      "  ${ function go() {",
      "      touch()",
      "  } }",
      "  <button onclick=go()>Go</button>",
      "  <button onclick=touch()>T</button>",
    ]);
    const r = fix(src, { entry: false });
    expect(r.output).toContain("      touch()\n  } }");
    expect(r.output).toContain(`<button onclick={ touch() ${H} }>T</button>`);
    expect(r.infos).toEqual([]);
    expect(reasons(r).some((x) => /module \/ route file.*whole-program/.test(x))).toBe(true);
  });

  test("a `${…}` handler value that reads `event` stays as written", () => {
    const r = fix(program(["  <button onclick=${ @count = getN() + event.detail }>A</button>"]));
    expect(r.changed).toBe(false);
  });
});

describe("client-server-call — the transactional gate", () => {
  test("a rewrite after which impl#1 reports different codes is reverted for the WHOLE file and reported", () => {
    // impl#1 reads a cell passed ONLY as an argument of a `!{}`-handled call as never consumed
    // (E-DG-002 appears after the rewrite), so the gate withdraws it.
    const src = [
      "<program db=\"sqlite:./app.db\">",
      "  <cat> = \"x\"",
      `  \${ function addC(c) {`,
      `      ${SQ}\`INSERT INTO t (c) VALUES (\${c})\`}.run() !{ _ :> {} }`,
      "  } }",
      "  ${ function go() {",
      "      addC(@cat)",
      "  } }",
      "  ${ function go2() {",
      "      addC(\"y\")",
      "  } }",
      "  <button onclick=go()>Go</button>",
      "  <button onclick=go2()>Go2</button>",
      "</program>",
      "",
    ].join("\n");
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(src);
    expect(r.applied).toEqual([]);
    expect(r.infos).toEqual([]);
    expect(reasons(r).some((x) => /impl#1 reports different codes after the rewrite .*E-DG-002.* no call in this file rewritten/.test(x))).toBe(true);
  });
});

describe("client-server-call — helpers + registration", () => {
  test("armsCoverTransport: `_`, `else`, `.Transport` / `::Transport` / `T.Transport`, a bare binder", () => {
    expect(armsCoverTransport([{ pattern: ".Boom" }])).toBe(false);
    expect(armsCoverTransport([{ pattern: ".Boom" }, { pattern: "_" }])).toBe(true);
    expect(armsCoverTransport([{ pattern: "else" }])).toBe(true);
    expect(armsCoverTransport([{ pattern: ".Transport" }])).toBe(true);
    expect(armsCoverTransport([{ pattern: "::Transport" }])).toBe(true);
    expect(armsCoverTransport([{ pattern: "SaveError.Transport" }])).toBe(true);
    expect(armsCoverTransport([{ pattern: "e" }])).toBe(true);
  });

  test("a default rule, chained right after arm-pipe; fixS66 carries its INFOs", () => {
    expect(IMPL1_SAFE_RULES).toContain("client-server-call");
    expect(S66_RULES.indexOf("client-server-call")).toBe(S66_RULES.indexOf("arm-pipe") + 1);
    const src = program([
      "  ${ function go() {",
      "      touch()",
      "  } }",
      "  <button onclick=go()>Go</button>",
    ]);
    const r = fixS66(src, { filePath: "/virtual/app.scrml", rules: ["client-server-call"] });
    expect(r.output).toContain(`touch() ${H}`);
    expect(r.infos.length).toBe(1);
  });

  test("the CLI: --dry-run writes nothing and prints the diff + the info line; a plain run writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-fix-csc-cli-"));
    try {
      const f = join(dir, "app.scrml");
      const src = program([
        "  ${ function go() {",
        "      touch()",
        "  } }",
        "  <button onclick=go()>Go</button>",
      ]);
      writeFileSync(f, src);
      const out = [];
      const err = [];
      const io = { out: (s) => out.push(s), err: (s) => err.push(s) };
      expect(runFixCommand([f, "--rules=client-server-call", "--dry-run"], io)).toBe(0);
      expect(readFileSync(f, "utf8")).toBe(src);
      expect(out.join("\n")).toContain(`+      touch() ${H}`);
      expect(err.join("\n")).toMatch(/client-server-call: info — callers no longer abort/);
      expect(runFixCommand([f, "--rules=client-server-call"], { out: () => {}, err: () => {} })).toBe(0);
      expect(readFileSync(f, "utf8")).toContain(`touch() ${H}`);
      expect(runFixCommand([f, "--rules=client-server-call", "--check"], { out: () => {}, err: () => {} })).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
