/**
 * reserved-prefix-e-name-collides.test.js — SPEC §47.1.1, S439 ruling #7 + S440 ruling #9.
 *
 * A user-authored scrml program SHALL NOT declare, and SHALL NOT reference, a
 * name beginning with `_scrml_` (the compiler/runtime namespace):
 * E-NAME-COLLIDES-RESERVED-PREFIX (Error). stdlib/ source is exempt by path.
 *
 * The security case this closes: `return _scrml_sql.unsafe("SELECT ...")` in a
 * server function compiled clean and called the raw driver handle around every
 * `?{}`-lowering floor (§14.8.10 tenant filter, §14.8.9 protect, the
 * transaction gate). Gap: g-tenant-floor-raw-driver-handle-callable-s452.
 *
 * Coverage: one test per declaration position and per reference position; the
 * raw-driver repro end to end; string / comment / object-key / foreign / prose
 * occurrences NOT flagged; the stdlib-path exemption (real path, Windows
 * separators, a symlink) and a lookalike `.../stdlib/...` user path NOT exempt;
 * compiler-emitted `_scrml_` names never flagged (the examples/ corpus).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runReservedPrefixCheck,
  isReservedPrefixName,
  isReservedPrefixExemptPath,
  reservedPrefixMessage,
} from "../../src/validators/reserved-prefix.ts";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, symlinkSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CODE = "E-NAME-COLLIDES-RESERVED-PREFIX";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const STDLIB = join(REPO, "stdlib");

/** Names flagged by the check on a one-file source (post-TAB, the pipeline's own call). */
function flagged(src, filePath = "/app/case.scrml") {
  const r = buildAST(splitBlocks(filePath, src));
  return runReservedPrefixCheck(r.ast).map((d) => d.message.match(/`([^`]+)`/)[1]);
}

/** Full compile; returns every E-NAME-COLLIDES-RESERVED-PREFIX diagnostic. */
function compileHits(src) {
  const dir = mkdtempSync(join(tmpdir(), "rsvprefix-"));
  const f = join(dir, "case.scrml");
  writeFileSync(f, src);
  const r = compileScrml({ inputFiles: [f], outputDir: join(dir, "dist"), write: false, log: () => {} });
  return [...(r.errors || []), ...(r.warnings || [])].filter((d) => d.code === CODE);
}

const prog = (body) => `<program>\n${body}\n</program>\n`;

// ---------------------------------------------------------------------------
// The security repro
// ---------------------------------------------------------------------------

describe("the raw driver handle is unreachable from author code", () => {
  test("`_scrml_sql.unsafe(...)` in a server function is refused at compile time", () => {
    const hits = compileHits(prog(`  <db src="./notes.db" tables="notes">
    \${
      server function leak() {
        return _scrml_sql.unsafe("SELECT body FROM notes")
      }
    }
    <button onclick=leak()>leak</button>
  </db>`));
    expect(hits.length).toBe(1);
    expect(hits[0].severity ?? "error").toBe("error");
    expect(hits[0].message).toContain("`_scrml_sql`");
    expect(hits[0].span.line).toBe(5);
  });

  test("the message names the identifier, the reservation, and the fix", () => {
    const m = reservedPrefixMessage("_scrml_sql");
    expect(m).toContain(CODE);
    expect(m).toContain("`_scrml_sql`");
    expect(m).toContain("reserved for the compiler's and the runtime's own names");
    expect(m).toContain("Rename it");
    expect(m).toContain("`sql`");
  });
});

// ---------------------------------------------------------------------------
// Declaration positions
// ---------------------------------------------------------------------------

describe("declarations with the prefix are refused", () => {
  const cases = [
    ["let", "${ let _scrml_a = 1 }", "_scrml_a"],
    ["const", "${ const _scrml_a = 1 }", "_scrml_a"],
    ["lin", "${ function f() { lin _scrml_a = 1\n return _scrml_a } }", "_scrml_a"],
    ["state cell", "<_scrml_cell> = 0", "_scrml_cell"],
    ["derived cell", "<n> = 1\nconst <_scrml_d> = @n + 1", "_scrml_d"],
    ["function name", "${ function _scrml_f() { return 1 } }", "_scrml_f"],
    ["fn name", "${ fn _scrml_f() { return 1 } }", "_scrml_f"],
    ["function parameter", "${ function f(_scrml_p) { return 1 } }", "_scrml_p"],
    ["lambda parameter", "${ const g = (_scrml_p) => 1 }", "_scrml_p"],
    ["object destructuring binder", "${ const { a: _scrml_b } = { a: 1 } }", "_scrml_b"],
    ["array destructuring binder", "${ const [_scrml_b] = [1] }", "_scrml_b"],
    ["for-of variable", "${ function f() { for (const _scrml_i of [1]) { log(1) } } }", "_scrml_i"],
    ["<each as>", "<items> = [1]\n<ul><each in=@items as _scrml_it><li>x</li></each></ul>", "_scrml_it"],
    ["type name", "type _scrml_T:struct = { a: string }", "_scrml_T"],
    ["enum variant", "type C:enum = { Red, _scrml_Green }", "_scrml_Green"],
    ["struct field", "type S:struct = { _scrml_f: string }", "_scrml_f"],
    ["component name", "${ const _scrml_Card = <div>x</div> }", "_scrml_Card"],
    ["import binding", '${ import { _scrml_x } from "./other.scrml" }', "_scrml_x"],
    ["match-expression arm binder", "type P:enum = { A, B(n: int) }\n${ function f(p) { return match p { .A :> 0\n .B(_scrml_n) :> 1 } } }", "_scrml_n"],
    ["<match> arm payload binder", "type P:enum = { A, B(n: int) }\n<p2>: P = .A\n<match for=P on=@p2>\n<A><p>a</p></>\n<B(_scrml_n)><p>b</p></>\n</match>", "_scrml_n"],
  ];
  for (const [label, body, name] of cases) {
    test(label, () => {
      expect(flagged(prog(body))).toContain(name);
    });
  }
});

// ---------------------------------------------------------------------------
// Reference positions
// ---------------------------------------------------------------------------

describe("references to a prefixed name are refused", () => {
  const cases = [
    ["bare identifier in a function body", "${ function f() { return _scrml_x } }", "_scrml_x"],
    ["call of a runtime helper", '${ function f() { return _scrml_reactive_get("n") } }', "_scrml_reactive_get"],
    ["`@` reactive read", "${ function f() { return @_scrml_x } }", "_scrml_x"],
    ["dot-member property", "${ function f(o) { return o._scrml_x } }", "_scrml_x"],
    ["optional-member property", "${ function f(o) { return o?._scrml_x } }", "_scrml_x"],
    ["template-literal interpolation", "${ function f() { return `a ${_scrml_x} b` } }", "_scrml_x"],
    ["SQL `${}` interpolation", '<db src="./a.db" tables="t">\n${ server function f() { return ?{`SELECT a FROM t WHERE id = ${_scrml_x}`}.all() } }\n</db>', "_scrml_x"],
    ["markup interpolation", "<p>${_scrml_x}</p>", "_scrml_x"],
    ["attribute expression", "<p class=${_scrml_x}>a</p>", "_scrml_x"],
    ["bare attribute variable", "<p if=_scrml_x>a</p>", "_scrml_x"],
    ["call-ref event handler", "<button onclick=_scrml_h()>a</button>", "_scrml_h"],
    ["handler expression", "<button onclick=${_scrml_h()}>a</button>", "_scrml_h"],
    ["handler lambda body", "<button onclick=${() => _scrml_h(1)}>a</button>", "_scrml_h"],
    ["parameter default", "${ function f(a = _scrml_x) { return a } }", "_scrml_x"],
    ["`<each in=>`", "<ul><each in=_scrml_rows as r><li>x</li></each></ul>", "_scrml_rows"],
    ["`<each key=>`", "<items> = [1]\n<ul><each in=@items key=_scrml_k as r><li>x</li></each></ul>", "_scrml_k"],
    ["`^{}` meta block", "${ ^{ const z = _scrml_x } }", "_scrml_x"],
    ["component body", "${ const Card = <div>${_scrml_x}</div> }\n<Card/>", "_scrml_x"],
    ["`<match>` shorthand arm body", "type P:enum = { A, B }\n<p2>: P = .A\n<match for=P on=@p2>\n<A : _scrml_x>\n<B><p>b</p></>\n</match>", "_scrml_x"],
    ["`<match>` bare-body arm", "type P:enum = { A, B }\n<p2>: P = .A\n<match for=P on=@p2>\n<A><p>${_scrml_x}</p></>\n<B><p>b</p></>\n</match>", "_scrml_x"],
    ["engine `effect=`", "type P:enum = { A, B }\n<engine for=P initial=.A effect=${_scrml_x()}>\n<A rule=.B></>\n<B rule=.A></>\n</>", "_scrml_x"],
    ["engine message-arm body", "type P:enum = { A, B(n: int) }\n<engine for=P initial=.A>\n<A rule=.B>\n.B(n) :> _scrml_x(n)\n</>\n<B rule=.A></>\n</>", "_scrml_x"],
    ["nested engine `:` shorthand body", "type A:enum = { T, P }\ntype B:enum = { X, Y }\n<engine for=A initial=.T>\n<T rule=.P>\n\"hi\"\n</>\n<P rule=.T>\n<engine for=B initial=.X>\n<X rule=.Y : _scrml_x>\n<Y rule=.X : \"y\">\n</>\n</>\n</>", "_scrml_x"],
    ["endpoint arm body", "type M:enum = { Ping }\n<endpoint path=\"/x\" method=\"POST\" accepts=M>\n<Ping : { v: _scrml_x }>\n</endpoint>", "_scrml_x"],
  ];
  for (const [label, body, name] of cases) {
    test(label, () => {
      expect(flagged(prog(body))).toContain(name);
    });
  }
});

// ---------------------------------------------------------------------------
// S239 fix round — positions the first cut missed. Each is asserted through the
// FULL compile: the exit-relevant error count separately from the message.
// ---------------------------------------------------------------------------

function compileOutcome(src) {
  const dir = mkdtempSync(join(tmpdir(), "rsvprefix-fr-"));
  const f = join(dir, "case.scrml");
  writeFileSync(f, src);
  const r = compileScrml({ inputFiles: [f], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const errors = r.errors || [];
  return {
    failed: errors.some((e) => (e.severity ?? "error") === "error"),
    names: errors.filter((d) => d.code === CODE).map((d) => d.message.match(/`([^`]+)`/)[1]),
  };
}

describe("fix round — crossing header, quoted attribute interpolations, component `${}` attrs, test bodies", () => {
  test("1b: a `_scrml_` name in a foreign block's `in: { … }` crossing HEADER is refused", () => {
    const o = compileOutcome(`<program lang="js">
  <db src="./a.db" tables="notes">
    \${
      server function leak() {
        let v = _={ in: { _scrml_sql } return _scrml_sql }=
        return v
      }
    }
  </db>
</program>
`);
    expect(o.failed).toBe(true);
    expect(o.names).toEqual(["_scrml_sql"]);
  });

  test("1b: the foreign BODY stays opaque — a `_scrml_` name only inside the body is not inspected", () => {
    expect(flagged(`<program lang="js">\n\${ function f(a) { return _={ in: { a } return a + _scrml_inside }= } }\n</program>\n`)).toEqual([]);
  });

  test("2: quoted attribute values — the `${}` interpolations are checked, the literal text is not", () => {
    const o = compileOutcome(prog(`  <count> = 0
  <p style="color: \${_scrml_q1}">a</p>
  <p class="a \${_scrml_reactive_get("count")}">b</p>
  <p title="plain _scrml_ text">c</p>`));
    expect(o.failed).toBe(true);
    expect(o.names).toEqual(["_scrml_q1", "_scrml_reactive_get"]);
  });

  test("2: …also inside <each>, a <match> arm, an engine state body, and `lift`", () => {
    const names = flagged(prog(`  type P:enum = { A, B }
  <p2>: P = .A
  <items> = [1]
  <ul><each in=@items as r><li class="x \${_scrml_e1}">i</li></each></ul>
  <match for=P on=@p2>
    <A><p class="m \${_scrml_m1}">a</p></>
    <B><p>b</p></>
  </match>
  <engine for=P initial=.A>
    <A rule=.B><p class="g \${_scrml_g1}">a</p></>
    <B rule=.A></>
  </>
  \${ function f() { lift <p class="z \${_scrml_l1}">l</p> } }`));
    for (const n of ["_scrml_e1", "_scrml_m1", "_scrml_g1", "_scrml_l1"]) expect(names).toContain(n);
  });

  test("3: a `${}` attribute inside a COMPONENT body is checked", () => {
    const o = compileOutcome(prog(`  <count> = 0
  \${ const Card = <div><button onclick=\${() => _scrml_reactive_set("count", 7)}>x</button></div> }
  <Card/>`));
    expect(o.failed).toBe(true);
    expect(o.names).toEqual(["_scrml_reactive_set"]);
  });

  test("5: a `~{}` test body is checked", () => {
    expect(flagged(prog(`<p>x</p>
~{ "t"
    test "uses a runtime name" { let k = _scrml_reactive_get("x")
 assert k == 1 }
}`))).toContain("_scrml_reactive_get");
  });

  test("controls — the same shapes with ordinary names compile with zero hits", () => {
    const o = compileOutcome(prog(`  <count> = 0
  <p style="color: \${@count}">a</p>
  \${ const Card = <div><button onclick=\${() => @count = 7}>x</button></div> }
  <Card/>`));
    expect(o.names).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Occurrences that are NOT names
// ---------------------------------------------------------------------------

describe("occurrences that are not names are not flagged", () => {
  test("string literals, template quasi text and comments", () => {
    const src = prog(`\${
  // _scrml_line_comment
  /* _scrml_block_comment */
  function f() {
    const a = "_scrml_double"
    const b = '_scrml_single'
    const c = \`quasi _scrml_text \${a}\`
    return a + b + c
  }
}
<!-- _scrml_html_comment -->
<p>${"${f()}"}</p>`);
    expect(flagged(src)).toEqual([]);
    expect(compileHits(src)).toEqual([]);
  });

  test("markup prose, attribute string values and SQL text", () => {
    const src = prog(`<p title="_scrml_title">the _scrml_ prefix is reserved</p>
<db src="./a.db" tables="t">
\${ server function g() { return ?{\`SELECT _scrml_col FROM t\`}.all() } }
</db>`);
    expect(flagged(src)).toEqual([]);
  });

  test("object-literal keys (bare or quoted — a property of a value, not a binding)", () => {
    expect(flagged(prog('${ const o = { _scrml_k: 1, "_scrml_q": 2 } }'))).toEqual([]);
  });

  test("the prefix only counts at the START of a name", () => {
    expect(flagged(prog("${ const my_scrml_x = 1\nconst ___scrml_y = 2\nconst scrml_z = 3 }"))).toEqual([]);
  });

  test("`_{}` foreign code is opaque (§23.2.3) and is not inspected", () => {
    expect(flagged(prog("${ _{ const w = _scrml_foreign } }"))).toEqual([]);
  });

  test("isReservedPrefixName", () => {
    expect(isReservedPrefixName("_scrml_x")).toBe(true);
    expect(isReservedPrefixName("@_scrml_x")).toBe(true);
    expect(isReservedPrefixName("_scrml")).toBe(false);
    // S457 "a for __scrml_" — the double-underscore prefix is reserved too.
    expect(isReservedPrefixName("__scrml_x")).toBe(true);
    expect(isReservedPrefixName("@__scrml_x__")).toBe(true);
    expect(isReservedPrefixName("___scrml_x")).toBe(false);
    expect(isReservedPrefixName("x_scrml_")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stdlib exemption — by path
// ---------------------------------------------------------------------------

describe("stdlib/ source is exempt by path; a lookalike is not", () => {
  const messagesPath = join(STDLIB, "data", "messages.scrml");
  const messagesSrc = readFileSync(messagesPath, "utf8");

  test("a real stdlib file that references `_scrml_` runtime names is exempt", () => {
    expect(messagesSrc).toContain("_scrml_messages_register");
    expect(flagged(messagesSrc, messagesPath)).toEqual([]);
  });

  test("the SAME source under a user directory named `stdlib` is NOT exempt", () => {
    const dir = mkdtempSync(join(tmpdir(), "rsvprefix-lookalike-"));
    const fake = join(dir, "stdlib", "data", "messages.scrml");
    mkdirSync(dirname(fake), { recursive: true });
    writeFileSync(fake, messagesSrc);
    expect(isReservedPrefixExemptPath(fake)).toBe(false);
    expect(flagged(messagesSrc, fake)).toContain("_scrml_messages_register");
  });

  test("a path that merely CONTAINS the stdlib root as a prefix string is NOT exempt", () => {
    expect(isReservedPrefixExemptPath(STDLIB + "-evil/x.scrml")).toBe(false);
    expect(isReservedPrefixExemptPath(STDLIB + "/../app/x.scrml")).toBe(false);
  });

  test("Windows separators under the stdlib root are still exempt", () => {
    expect(isReservedPrefixExemptPath(STDLIB + "\\data\\messages.scrml")).toBe(true);
  });

  test("a stdlib file reached through a symlink is exempt", () => {
    const dir = mkdtempSync(join(tmpdir(), "rsvprefix-link-"));
    const link = join(dir, "linked-stdlib");
    symlinkSync(STDLIB, link, "dir");
    expect(isReservedPrefixExemptPath(join(link, "data", "messages.scrml"))).toBe(true);
  });

  test("a USER directory symlinked INTO stdlib/ is NOT exempt (decided on the real path)", () => {
    const userDir = mkdtempSync(join(tmpdir(), "rsvprefix-userdir-"));
    writeFileSync(join(userDir, "evil.scrml"), "${ function f() { return _scrml_sql } }\n");
    const linkInStdlib = join(STDLIB, `.rsvprefix-test-link-${process.pid}`);
    symlinkSync(userDir, linkInStdlib, "dir");
    try {
      const p = join(linkInStdlib, "evil.scrml");
      expect(isReservedPrefixExemptPath(p)).toBe(false);
      expect(flagged(readFileSync(p, "utf8"), p)).toEqual(["_scrml_sql"]);
    } finally {
      unlinkSync(linkInStdlib);
    }
  });

  test("relative and empty paths", () => {
    expect(isReservedPrefixExemptPath("")).toBe(false);
    expect(isReservedPrefixExemptPath(undefined)).toBe(false);
    expect(isReservedPrefixExemptPath("app/case.scrml")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The compiler's own emitted names never trip it
// ---------------------------------------------------------------------------

describe("compiler-emitted `_scrml_` names are never flagged", () => {
  test("a program with <db> + ?{} + an engine + handlers + each + match compiles with zero hits", () => {
    const src = prog(`  type Phase:enum = { Idle, Loading, Ready }
  <phase>: Phase = .Idle
  <rows> = []
  <db src="./a.db" tables="notes">
    \${
      server function load() {
        return ?{\`SELECT id, body FROM notes WHERE id > \${0}\`}.all()
      }
      function refresh() {
        @phase = .Loading
        @rows = load()
        @phase = .Ready
      }
    }
    <button onclick=refresh()>go</button>
    <ul><each in=@rows as r key=@.id><li>\${r.body}</li></each></ul>
    <match for=Phase on=@phase>
      <Idle><p>idle</p></>
      <Loading><p>loading</p></>
      <Ready><p>\${@rows.length}</p></>
    </match>
  </db>`);
    expect(compileHits(src)).toEqual([]);
  });

  test("the AST builder's own `<#name>` desugar (`_scrml_worker_*` / `_scrml_input_*_`) is not flagged", () => {
    for (const rel of [
      "examples/13-worker.scrml",
      "samples/compilation-tests/when-002-message-handler.scrml",
      "samples/compilation-tests/input-canvas-demo.scrml",
      "conformance/cases/lifecycle/request-body-client-wrapper-rt/case.scrml",
    ]) {
      const f = join(REPO, rel);
      expect(readFileSync(f, "utf8")).toContain("<#");
      expect(flagged(readFileSync(f, "utf8"), f)).toEqual([]);
    }
  });

  test("…but a DECLARATION spelled like the desugar is still refused (the desugar never declares)", () => {
    expect(flagged(prog("${ const _scrml_worker_x = 1\nconst _scrml_input_y_ = 2 }"))).toEqual(["_scrml_worker_x", "_scrml_input_y_"]);
  });

  test("…and a runtime helper is never mistaken for the desugar shape", () => {
    expect(flagged(prog("${ function f() { return _scrml_input_state_registry } }"))).toEqual(["_scrml_input_state_registry"]);
  });

  test("every examples/*.scrml compiles with zero hits", () => {
    const dir = join(REPO, "examples");
    const files = readdirSync(dir).filter((f) => f.endsWith(".scrml")).map((f) => join(dir, f));
    expect(files.length).toBeGreaterThan(10);
    const offenders = [];
    for (const f of files) {
      const r = compileScrml({ inputFiles: [f], outputDir: join(mkdtempSync(join(tmpdir(), "rsvex-")), "dist"), write: false, log: () => {} });
      if ([...(r.errors || []), ...(r.warnings || [])].some((d) => d.code === CODE)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  }, 180000);
});
