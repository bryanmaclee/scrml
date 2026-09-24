/**
 * defer-statement.test.js — SPEC §19.16 (S430 P3 stage 1): the `defer <stmt>`
 * scope-exit statement.
 *
 * Coverage map (one describe per normative statement):
 *   §1 parse — live front-end: contextual keyword, single + block form, `!{}` binds
 *              to the deferred statement, identifier uses of `defer` untouched
 *   §2 parse — native front-end produces the same live `defer-stmt` shape
 *   §3 restrictions (validators/lint-defer.ts) — E-DEFER-CONTROL-FLOW (return /
 *              fail / ? / break+continue leaving; inner-loop + nested-fn carve-outs),
 *              E-DEFER-NESTED, E-DEFER-OUTSIDE-FUNCTION
 *   §4 E-DEFER-UNHANDLED-FAILABLE (type-system) replaces E-ERROR-002
 *   §5 lowering (codegen/lower-defer.ts) — LIFO nesting shape, idempotence,
 *              split-function top level skipped
 *   §6 emitted JS — try/finally, LIFO order, return value computed first, fn tail
 *   §7 body-split / CPS — the finally closes AFTER the LAST batch await; a
 *              server-tier deferred body in a split fn is E-DEFER-SERVER-IN-SPLIT
 *   §8 both front-ends compile the same program to the same client JS
 *
 * The runtime halves (LIFO, every exit path, CPS after-last-continuation and
 * intermediate-batch failure) are pinned as conformance cases under
 * conformance/cases/defer/ and run through the gated corpus bridge.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { compileScrml } from "../../src/api.js";
import { runDeferChecks } from "../../src/validators/lint-defer.ts";
import { runRedeclareChecks } from "../../src/validators/lint-redeclare.ts";
import { lowerDeferList, lowerDefers, isDeferLoweredTry } from "../../src/codegen/lower-defer.ts";
import { deferStackRunnerLines } from "../../src/codegen/emit-control-flow.ts";
import { normalizeChunkToken } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function liveAST(src, file = "/tmp/defer-test.scrml") {
  const bs = splitBlocks(file, src);
  return buildAST(bs);
}

function nativeAST(src, file = "/tmp/defer-test.scrml") {
  return nativeParseFile(file, src);
}

function findAll(root, pred, out = []) {
  const seen = new WeakSet();
  const walk = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (pred(n)) out.push(n);
    for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
  };
  walk(root);
  return out;
}

function fnBody(ast, name) {
  const fn = findAll(ast, (n) => n.kind === "function-decl" && n.name === name)[0];
  return fn ? fn.body : null;
}

function compile(src, opts = {}) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve("/tmp", `scrml-defer-${uniq}`);
  const input = resolve(tmpDir, `app.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(input, src);
  try {
    const result = compileScrml({ inputFiles: [input], write: false, outputDir: resolve(tmpDir, "out"), ...opts });
    const out = [...(result.outputs?.values?.() ?? [])][0] ?? {};
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: out.clientJs ?? "",
      serverJs: out.serverJs ?? "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codesOf = (r) => [...r.errors, ...r.warnings].map((e) => e.code);
const count = (r, code) => codesOf(r).filter((c) => c === code).length;

const wrap = (logic, markup = `<p>x</p>`) => `\${\n${logic}\n}\n<program>\n${markup}\n</program>\n`;

// ---------------------------------------------------------------------------
// §1 — live parse
// ---------------------------------------------------------------------------

describe("§1 live parse — `defer` is a contextual statement keyword", () => {
  const src = wrap(`
    <log> = ""
    function f(x) {
      let c = x + 1
      defer @log = @log + "a"
      defer closeAll(c)
      defer {
        @log = @log + "b"
        @log = @log + "c"
      }
      defer(c)
      defer = 3
      c
    }
    function closeAll(c) { @log = @log + c }
  `);
  const { ast, errors } = liveAST(src);
  const body = fnBody(ast, "f");

  test("parses without errors", () => {
    expect(errors ?? []).toEqual([]);
  });
  test("single-statement form -> defer-stmt with a one-element body", () => {
    expect(body[1].kind).toBe("defer-stmt");
    expect(body[1].blockForm).toBe(false);
    expect(body[1].body.length).toBe(1);
    expect(body[2].kind).toBe("defer-stmt");
    expect(body[2].body[0].kind).toBe("bare-expr");
  });
  test("block form -> defer-stmt whose body holds every braced statement", () => {
    expect(body[3].kind).toBe("defer-stmt");
    expect(body[3].blockForm).toBe(true);
    expect(body[3].body.length).toBe(2);
  });
  test("`defer(c)` stays a CALL and `defer = 3` stays a write (identifier untouched)", () => {
    expect(body[4].kind).toBe("bare-expr");
    expect(String(body[4].expr)).toContain("defer");
    expect(body[5].kind).not.toBe("defer-stmt");
  });
  test("a `defer` whose next token is on the NEXT line is not a defer statement", () => {
    const r = liveAST(wrap(`function g() {\n  let defer = 1\n  defer\n  foo()\n}\nfunction foo() {}`));
    expect(findAll(r.ast, (n) => n.kind === "defer-stmt").length).toBe(0);
  });
  test("a `!{}` written after the deferred call binds to the CALL, inside the defer", () => {
    const r = liveAST(wrap(`
      type E:enum = { Busy }
      function closeAll()! -> E { fail E.Busy }
      function g() {
        defer closeAll() !{
          | ::Busy :> log("x")
        }
        log("y")
      }`));
    const d = findAll(r.ast, (n) => n.kind === "defer-stmt")[0];
    expect(d).toBeDefined();
    expect(d.body.length).toBe(1);
    expect(d.body[0].kind).toBe("guarded-expr");
  });
});

// ---------------------------------------------------------------------------
// §2 — native parse produces the same shape
// ---------------------------------------------------------------------------

describe("§2 native parse — the Defer stmt bridges to the live defer-stmt", () => {
  const src = wrap(`
    function f(x) {
      defer closeAll(x)
      defer {
        log("a")
        log("b")
      }
      if (x > 1) {
        defer log("inner")
        return 5
      }
      defer(x)
      x
    }
    function closeAll(c) { log(c) }
  `);
  const { ast, errors } = nativeAST(src);
  const body = fnBody(ast, "f");

  test("no native parse errors", () => {
    expect((errors ?? []).map((e) => e.code)).toEqual([]);
  });
  test("single + block forms", () => {
    expect(body[0].kind).toBe("defer-stmt");
    expect(body[0].blockForm).toBe(false);
    expect(body[0].body.length).toBe(1);
    expect(body[1].kind).toBe("defer-stmt");
    expect(body[1].blockForm).toBe(true);
    expect(body[1].body.length).toBe(2);
  });
  test("a defer nested in an if-branch lands in the branch's statement list", () => {
    const inner = body[2].consequent;
    expect(inner[0].kind).toBe("defer-stmt");
  });
  test("`defer(x)` stays a call", () => {
    expect(body[3].kind).not.toBe("defer-stmt");
  });
});

// ---------------------------------------------------------------------------
// §3 — structural restrictions
// ---------------------------------------------------------------------------

describe("§3 restrictions — validators/lint-defer.ts", () => {
  const check = (logic) => runDeferChecks(liveAST(wrap(logic)).ast).map((d) => d.code);

  test("return / fail / ? inside a deferred body -> E-DEFER-CONTROL-FLOW", () => {
    const codes = check(`
      type E:enum = { Bad }
      function risky()! -> E { fail E.Bad }
      function a() { defer return }
      function b()! -> E { defer fail E.Bad }
      function c()! -> E {
        defer {
          let v = risky()?
        }
      }`);
    expect(codes.filter((c) => c === "E-DEFER-CONTROL-FLOW").length).toBe(3);
  });
  test("break / continue leaving the deferred body -> E-DEFER-CONTROL-FLOW", () => {
    const codes = check(`
      function d() {
        for (const i of [1, 2]) {
          defer {
            if (i == 1) { break }
          }
          defer {
            if (i == 2) { continue }
          }
        }
      }`);
    expect(codes).toEqual(["E-DEFER-CONTROL-FLOW", "E-DEFER-CONTROL-FLOW"]);
  });
  test("break/continue targeting a loop INSIDE the deferred body is legal", () => {
    expect(check(`
      function d() {
        defer {
          for (const i of [1, 2]) {
            if (i == 1) { continue }
            break
          }
        }
      }`)).toEqual([]);
  });
  test("a function nested in a deferred body is its own scope (its return is legal)", () => {
    expect(check(`
      function d() {
        defer {
          let h = function(v) { return v + 1 }
          log(h(1))
        }
      }`)).toEqual([]);
  });
  test("defer inside a deferred body -> E-DEFER-NESTED", () => {
    expect(check(`
      function d() {
        defer {
          defer log("x")
        }
      }`)).toEqual(["E-DEFER-NESTED"]);
  });
  test("top-level defer (no enclosing function) -> E-DEFER-OUTSIDE-FUNCTION", () => {
    expect(check(`
      <n> = 0
      defer @n = 1`)).toEqual(["E-DEFER-OUTSIDE-FUNCTION"]);
  });
  test("defer inside an arrow / function-expression body -> E-DEFER-OUTSIDE-FUNCTION (stage-1 limitation, named — not an E-CODEGEN-INVALID-LOGIC)", () => {
    const logic = `
      <trace> = ""
      function go() {
        const run = () => {
          defer @trace = @trace + "L;"
          @trace = @trace + "b;"
        }
        run()
        const f2 = function() {
          defer @trace = @trace + "F;"
        }
        f2()
      }`;
    expect(check(logic)).toEqual(["E-DEFER-OUTSIDE-FUNCTION", "E-DEFER-OUTSIDE-FUNCTION"]);
    const nat = runDeferChecks(nativeAST(wrap(logic)).ast).map((d) => d.code);
    expect(nat).toEqual(["E-DEFER-OUTSIDE-FUNCTION", "E-DEFER-OUTSIDE-FUNCTION"]);
    const r = compile(wrap(logic, `<button onclick=go()>go</button><p>\${@trace}</p>`));
    expect(count(r, "E-DEFER-OUTSIDE-FUNCTION")).toBe(2);
  });
  test("defer in an `on mount` body -> E-DEFER-OUTSIDE-FUNCTION (live front-end)", () => {
    expect(check(`
      <trace> = ""
      on mount {
        defer @trace = @trace + "m;"
        @trace = @trace + "x;"
      }`)).toEqual(["E-DEFER-OUTSIDE-FUNCTION"]);
  });
  test("a lambda that merely calls a function named `defer` is not flagged", () => {
    expect(check(`
      function defer(x) { return x }
      function go() {
        const f = () => {
          defer(1)
          return 2
        }
        f()
      }`)).toEqual([]);
  });
  test("defer in a function, in a fn, and in nested blocks is legal", () => {
    expect(check(`
      function a(x) {
        defer log("a")
        if (x) { defer log("b") }
        for (const i of [1]) { defer log("c") }
      }
      fn b(x) -> number {
        let r = x
        defer r = 0
        r
      }`)).toEqual([]);
  });
  test("the native front-end feeds the same checker (same codes)", () => {
    const src = wrap(`
      type E:enum = { Bad }
      function risky()! -> E { fail E.Bad }
      function a() { defer return }
      function c()! -> E {
        defer {
          let v = risky()?
        }
      }
      function d() {
        defer {
          defer log("x")
        }
      }`);
    const codes = runDeferChecks(nativeAST(src).ast).map((d) => d.code).sort();
    expect(codes).toEqual(["E-DEFER-CONTROL-FLOW", "E-DEFER-CONTROL-FLOW", "E-DEFER-NESTED"]);
  });
});

// ---------------------------------------------------------------------------
// §4 — E-DEFER-UNHANDLED-FAILABLE (type system)
// ---------------------------------------------------------------------------

describe("§4 failable calls in a deferred body must be handled in place", () => {
  const base = `
    type CloseError:enum = { Busy }
    function closeAll()! -> CloseError { fail CloseError.Busy }
  `;
  test("bare failable call -> E-DEFER-UNHANDLED-FAILABLE, and NOT E-ERROR-002", () => {
    const r = compile(wrap(`${base}
      function work()! -> CloseError {
        defer closeAll()
        log("w")
      }`, `<button onclick=work()>go</button>`));
    expect(count(r, "E-DEFER-UNHANDLED-FAILABLE")).toBe(1);
    expect(count(r, "E-ERROR-002")).toBe(0);
  });
  test("handled in place with `!{}` -> clean", () => {
    const r = compile(wrap(`${base}
      function work() {
        defer closeAll() !{
          | ::Busy :> log("close failed")
          | _ :> log("other")
        }
        log("w")
      }`, `<button onclick=work()>go</button>`));
    expect(codesOf(r).filter((c) => c.startsWith("E-DEFER-") || c === "E-ERROR-002")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §5 — lowering shape
// ---------------------------------------------------------------------------

describe("§5 lowering — codegen/lower-defer.ts", () => {
  const S = (name) => ({ kind: "bare-expr", expr: name });
  const D = (name) => ({ kind: "defer-stmt", body: [S(name)], blockForm: false });

  test("[a, defer D1, b, defer D2, c] -> ONE try-stmt whose body is the whole block, in place; defers become markers", () => {
    const out = lowerDeferList([S("a"), D("D1"), S("b"), D("D2"), S("c")]);
    expect(out.length).toBe(1);
    const t = out[0];
    expect(isDeferLoweredTry(t)).toBe(true);
    expect(t.body.map((x) => x.kind === "defer-stmt" ? `defer#${x.deferStart}` : x.expr)).toEqual(["a", "defer#0", "b", "defer#1", "c"]);
    expect(t.body[1].lowered).toBe(true);
    expect(t.finallyNode.body.map((x) => x.expr)).toEqual(["D1", "D2"]);
  });
  test("a list with no defer is returned unchanged", () => {
    const list = [S("a"), S("b")];
    expect(lowerDeferList(list)).toBe(list);
  });
  test("lowerDefers mutates nested lists in place and is idempotent", () => {
    const fn = { kind: "function-decl", body: [S("a"), { kind: "if-stmt", consequent: [D("X"), S("y")] }] };
    lowerDefers({ nodes: [fn] }, new Set());
    const cons = fn.body[1].consequent;
    expect(cons.length).toBe(1);
    expect(cons[0].body.map((x) => x.kind)).toEqual(["defer-stmt", "bare-expr"]);
    lowerDefers({ nodes: [fn] }, new Set());
    expect(fn.body[1].consequent.length).toBe(1);
  });
  test("the TOP-LEVEL body of a CPS-split function is NOT restructured (its indices are the split's contract); nested lists still are", () => {
    const fn = { kind: "function-decl", body: [S("a"), D("X"), S("b"), { kind: "if-stmt", consequent: [D("Y"), S("z")] }] };
    lowerDefers({ nodes: [fn] }, new Set([fn]));
    expect(fn.body.length).toBe(4);
    expect(fn.body[1].kind).toBe("defer-stmt");
    expect(isDeferLoweredTry(fn.body[3].consequent[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — emitted JS
// ---------------------------------------------------------------------------

describe("§6 emitted client JS", () => {
  test("a defer lowers to a per-block stack: registration in place, one try/finally around the whole block", () => {
    const r = compile(wrap(`
      <trace> = ""
      function go() {
        @trace = @trace + "a"
        defer @trace = @trace + "1"
        defer @trace = @trace + "2"
        @trace = @trace + "b"
      }`, `<button onclick=go()>go</button><p>\${@trace}</p>`));
    expect(r.errors.map((e) => e.code)).toEqual([]);
    const js = r.clientJs;
    const m = js.match(/const (_scrml_defers_\d+) = \[\];\s*try \{/);
    expect(m).not.toBeNull();
    const st = m[1];
    const ia = js.indexOf(`+ "a")`);
    const p1 = js.indexOf(`${st}.push(() => {`);
    const i1 = js.indexOf(`+ "1")`);
    const i2 = js.indexOf(`+ "2")`);
    const ib = js.indexOf(`+ "b")`);
    // in source order, in place: a, push(1), push(2), b; then the runner.
    expect(ia).toBeGreaterThan(js.indexOf(m[0]));
    expect(p1).toBeGreaterThan(ia);
    expect(i1).toBeGreaterThan(p1);
    expect(i2).toBeGreaterThan(i1);
    expect(ib).toBeGreaterThan(i2);
    expect(js.indexOf("} finally {", ib)).toBeGreaterThan(ib);
    expect(js).toContain(`for (let ${st}_i = ${st}.length - 1; ${st}_i >= 0; ${st}_i--)`);
    expect(js).not.toContain("defer_not_lowered");
  });
  test("a fn with an implicit tail after a defer returns the tail INSIDE the try (value computed before the finally)", () => {
    const r = compile(wrap(`
      <got> = 0
      fn settle(x: number) -> number {
        let acc = x * 2
        defer acc = 0
        acc + 1
      }
      function go() { @got = settle(20) }`, `<button onclick=go()>go</button><p>\${@got}</p>`));
    expect(r.errors.map((e) => e.code)).toEqual([]);
    // The tail stays in place inside the try; the deferred write is a closure
    // registered before it and run by the finally.
    expect(r.clientJs).toMatch(/\.push\(\(\) => \{\s*acc = 0;\s*\}\);\s*return acc \+ 1;\s*\} finally \{/);
  });
  test("a server function's defer lowers on the server side", () => {
    const r = compile(`<program db="sqlite::memory:">
<schema>
    t { id: integer primary key, x: integer }
</schema>
\${
    <out> = 0
    server function bump(id: number) {
        defer log("released")
        ?{\`UPDATE t SET x = 1 WHERE id = \${id}\`}.run()
        return 1
    }
    function go() { @out = bump(1) }
}
<button onclick=go()>go</button>
<p>\${@out}</p>
</program>`);
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.serverJs).toContain("finally {");
    expect(r.clientJs).not.toContain("released");
  });
});

// ---------------------------------------------------------------------------
// §7 — body-split / CPS
// ---------------------------------------------------------------------------

const cpsProgram = (deferLine) => `<program db="sqlite::memory:">
<schema>
    tasks { id: integer primary key, done: integer }
    log { id: integer primary key, msg: text }
</schema>
\${
    <trace> = ""
    function save(id: number) {
        @trace = @trace + "start;"
        ${deferLine}
        ?{\`UPDATE tasks SET done = 1 WHERE id = \${id}\`}.run()
        @trace = @trace + "mid;"
        ?{\`INSERT INTO log (msg) VALUES ('saved')\`}.run()
        @trace = @trace + "end;"
    }
}
<button onclick=save(1)>go</button>
<p>\${@trace}</p>
</program>`;

describe("§7 body-split — the deferred body runs after the LAST continuation", () => {
  test("multi-batch: the finally closes AFTER the last batch await and the trailing client write", () => {
    const r = compile(cpsProgram(`defer @trace = @trace + "D;"`));
    expect(r.errors.map((e) => e.code)).toEqual([]);
    const js = r.clientJs;
    const wrapperStart = js.indexOf("async function _scrml_cps_save");
    expect(wrapperStart).toBeGreaterThan(-1);
    const w = js.slice(wrapperStart);
    const lastAwait = w.lastIndexOf("await _scrml_fetch_save_batch_1");
    const endWrite = w.indexOf(`+ "end;"`);
    const m = w.match(/const (_scrml_defers_\d+) = \[\];\s*try \{/);
    expect(m).not.toBeNull();
    const st = m[1];
    const push = w.indexOf(`${st}.push(async () => {`);
    const fin = w.indexOf("} finally {", endWrite);
    const runner = w.indexOf(`await ${st}[${st}_i]()`);
    expect(lastAwait).toBeGreaterThan(-1);
    // The stack's try opens at the TOP of the wrapper (before the first batch
    // await, so a batch-0 failure still runs it) and registration sits at the
    // defer's position; the finally closes after the LAST batch await and the
    // trailing client write.
    expect(w.indexOf(m[0])).toBeLessThan(w.indexOf("await _scrml_fetch_save_batch_0"));
    expect(push).toBeGreaterThan(w.indexOf(`+ "start;"`));
    expect(push).toBeLessThan(w.indexOf("await _scrml_fetch_save_batch_0"));
    expect(endWrite).toBeGreaterThan(lastAwait);
    expect(fin).toBeGreaterThan(endWrite);
    expect(runner).toBeGreaterThan(fin);
  });
  test("no server stub contains the deferred body", () => {
    const r = compile(cpsProgram(`defer @trace = @trace + "D;"`));
    expect(r.serverJs).not.toContain(`"D;"`);
  });
  test("a server-tier deferred body in a split function -> E-DEFER-SERVER-IN-SPLIT (no silent wrong lowering)", () => {
    const r = compile(cpsProgram("defer ?{`UPDATE tasks SET done = 0 WHERE id = ${id}`}.run()"));
    expect(count(r, "E-DEFER-SERVER-IN-SPLIT")).toBe(1);
    expect(count(r, "E-RI-002")).toBe(0);
  });
  test("a split function whose ONLY reactive write is deferred is still split (the write stays client)", () => {
    const r = compile(`<program db="sqlite::memory:">
<schema>
    tasks { id: integer primary key, done: integer }
</schema>
\${
    <busy> = true
    function finish(id: number) {
        defer @busy = false
        ?{\`UPDATE tasks SET done = 1 WHERE id = \${id}\`}.run()
    }
}
<button onclick=finish(1)>go</button>
<p>\${@busy}</p>
</program>`);
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).toContain("async function _scrml_cps_finish");
    expect(r.serverJs).not.toContain(`"busy"`);
  });
});

// ---------------------------------------------------------------------------
// §8 — front-end parity
// ---------------------------------------------------------------------------

describe("§8 live and native front-ends emit the same client JS for defer", () => {
  test("LIFO + nested block + early return program", () => {
    const src = wrap(`
      <trace> = ""
      function step(x: number) {
        defer @trace = @trace + "outer;"
        if (x > 0) {
          defer @trace = @trace + "inner;"
          @trace = @trace + "body;"
        }
        if (x > 5) {
          return
        }
        defer {
          @trace = @trace + "late1;"
          @trace = @trace + "late2;"
        }
        @trace = @trace + "end;"
      }`, `<button onclick=step(1)>go</button><p>\${@trace}</p>`);
    const live = compile(src);
    const nat = compile(src, { parser: "scrml-native" });
    expect(live.errors.map((e) => e.code)).toEqual([]);
    expect(nat.errors.map((e) => e.code)).toEqual([]);
    expect(normalizeChunkToken(nat.clientJs)).toBe(normalizeChunkToken(live.clientJs));
  });
});

// ---------------------------------------------------------------------------
// §9 — S430 review fix round (F1-F6)
// ---------------------------------------------------------------------------

describe("§9 F3 — E-DEFER-CONTROL-FLOW reaches value-form arms and handler arms", () => {
  const check = (logic) => runDeferChecks(liveAST(wrap(logic)).ast).map((d) => d.code);
  const header = `type Mode:enum = { A, B }\ntype E:enum = { Bad }\nfunction risky()! -> E { fail E.Bad }\n`;

  test("return in a value-form match arm block (`:>`)", () => {
    expect(check(header + `
      function f(m: Mode) {
        defer {
          let k = match m {
            .A :> { return 5 }
            .B :> 3
          }
        }
        return 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("return in a value-form match arm block with the legacy `=>` arm arrow (not mistaken for a lambda)", () => {
    expect(check(header + `
      function f() {
        defer {
          let k = match 1 {
            1 => { return 5 }
            else => 3
          }
        }
        return 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("fail in a value-form match arm block", () => {
    expect(check(header + `
      function f(m: Mode)! -> E {
        defer {
          let k = match m {
            .A :> { fail E.Bad }
            .B :> 3
          }
        }
        return 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("return in an if-as-expression arm", () => {
    expect(check(header + `
      function f(x: number) {
        defer {
          let k = if (x > 0) { return 7 } else { 2 }
        }
        return 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("return in a match-STATEMENT arm", () => {
    expect(check(header + `
      function f(m: Mode) {
        defer {
          match m {
            .A :> { return 9 }
            .B :> { log("b") }
          }
        }
        return 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("return in a `!{}` handler arm on the deferred call", () => {
    expect(check(header + `
      function f() {
        defer risky() !{
          | _ :> { return 9 }
        }
        return 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("a lambda inside a value arm is a boundary; plain value arms are clean", () => {
    expect(check(header + `
      function f(m: Mode) {
        defer {
          let k = match m {
            .A :> { [1].map((x) => { return x }) }
            .B :> 3
          }
          let q = [1, 2].map((x) => { return x + 1 })
          let t = m == .A ? 1 : 2
        }
        return 1
      }`)).toEqual([]);
  });

  // Round 3 — the text path (a body carried as text: a `!{}` handler arm or a
  // value-form match arm) is PARSED and walked by the same structural check the
  // tree path (the same body in an `if` block) goes through: same answer, pair
  // by pair.
  const TREE = (body) => `
      function f(m: Mode, x: number) {
        defer {
          if (x > 0) {
${body}
          }
        }
        return 1
      }`;
  const HANDLER = (body) => `
      function f(m: Mode, x: number) {
        defer risky() !{
          | _ :> {
${body}
          }
        }
        return 1
      }`;
  const MATCH_ARM = (body) => `
      function f(m: Mode, x: number) {
        defer {
          let k = match m {
            .A :> {
${body}
            }
            .B :> 3
          }
        }
        return 1
      }`;
  const bodies = {
    "return": `return 5`,
    "fail-free plain": `log("x")`,
    "regex with a quote": `let s = "a".replace(/'/g, "x")\nlog(s)`,
    "regex with a quote + return": `let s = "a".replace(/'/g, "x")\nreturn s`,
    "regex with a double quote + return": `let s = "q".replace(/"/g, "x")\nreturn s`,
    "regex [/*] + return": `let s = "a/*b".replace(/[/*]/g, "x")\nreturn s`,
    "backtick in a template + return": "let s = `a${\"`\"}b`\nreturn s",
    "object key named return": `let o = { return: 1 }\nlog(o.return)`,
    "end-of-line ternary": `let t = x > 0 ?\n "p" : "n"\nlog(t)`,
    "keywords inside a string": `log("return fail ? break")`,
    "lambda return (a boundary)": `let q = [1, 2].map((v) => { return v + 1 })\nlog(q)`,
    "inner loop break": `for (const i of [1, 2]) {\n if (i == 2) { break }\n log(i)\n}`,
    "break leaving the defer": `break`,
  };
  for (const [name, body] of Object.entries(bodies)) {
    test(`tree vs text parity — ${name}`, () => {
      const tree = check(header + TREE(body));
      const handler = check(header + HANDLER(body)).filter((c) => c !== "E-DEFER-UNHANDLED-FAILABLE");
      const arm = check(header + MATCH_ARM(body));
      // `break` with no loop is illegal in a statement position the TREE path
      // can't even build without a loop (the parser keeps it); every other body
      // must give the same answer on all three paths.
      expect(handler).toEqual(tree);
      expect(arm).toEqual(tree);
    });
  }
  test("a text body that does not parse FAILS CLOSED (never silently accepted)", () => {
    const codes = check(header + `
      function f() {
        defer risky() !{
          | _ :> { let = = = }
        }
        return 1
      }`);
    expect(codes).toContain("E-DEFER-CONTROL-FLOW");
  });
});

describe("§9 F1 / round 4 — nothing moves: declarations stay in their block", () => {
  test("lowerDeferList keeps every statement — function declarations included — in place, in order", () => {
    const S = (name) => ({ kind: "bare-expr", expr: name });
    const fn = (name, body = []) => ({ kind: "function-decl", name, body });
    const out = lowerDeferList([S("a"), { kind: "defer-stmt", body: [S("D")] }, S("b"), fn("helper"), { kind: "let-decl", name: "late" }, fn("useLate")]);
    expect(out.length).toBe(1);
    expect(out[0].body.map((x) => x.kind === "function-decl" ? `fn:${x.name}` : x.kind)).toEqual(
      ["bare-expr", "defer-stmt", "bare-expr", "fn:helper", "let-decl", "fn:useLate"]);
  });
  test("client: the helper is declared inside the same block as its earlier call (no hoisting across a boundary)", () => {
    const r = compile(wrap(`
      <trace> = ""
      function add(s: string) { @trace = @trace + s }
      function f() {
        add(helper())
        defer add("D")
        function helper() { return "H" }
      }`, `<button onclick=f()>go</button><p>\${@trace}</p>`));
    expect(r.errors.map((e) => e.code)).toEqual([]);
    const fnJs = r.clientJs.slice(r.clientJs.indexOf("function _scrml_f_"));
    const tryAt = fnJs.indexOf("try {");
    expect(fnJs.indexOf("helper()")).toBeGreaterThan(tryAt);
    expect(fnJs.indexOf("function helper()")).toBeGreaterThan(tryAt);
  });
  test("server: the helper stays in the handler body's block too", () => {
    const r = compile(`<program db="sqlite::memory:">
<schema>
    t { id: integer primary key, x: integer }
</schema>
\${
    <srv> = ""
    server function sv() {
        let out = helperS()
        defer log("deferred")
        function helperS() {
            return "S"
        }
        return out
    }
    function go() { @srv = sv() }
}
<button onclick=go()>go</button>
<p>\${@srv}</p>
</program>`);
    expect(r.errors.map((e) => e.code)).toEqual([]);
    const tryAt = r.serverJs.indexOf("try {", r.serverJs.indexOf("_scrml_defers_"));
    expect(r.serverJs.indexOf("let out = helperS()")).toBeGreaterThan(tryAt);
    expect(r.serverJs.indexOf("function helperS()")).toBeGreaterThan(tryAt);
    // server closures are async and awaited (the handler body is async)
    expect(r.serverJs).toMatch(/_scrml_defers_\d+\.push\(async \(\) => \{/);
  });
});

describe("§9 F2 — `~` initialised before a defer resolves after it", () => {
  test("return ~ + 1 and let r = ~ lower to the SAME accumulator (no E-CG-TILDE-UNRESOLVED)", () => {
    const r = compile(wrap(`
      <trace> = ""
      function add(s: string) { @trace = @trace + s }
      function two(x: number) { return x * 2 }
      function f() {
        two(5)
        defer add("D")
        return ~ + 1
      }
      function g() {
        two(4)
        defer add("E")
        let r = ~
        return r
      }`, `<button onclick=f()>go</button><button onclick=g()>go2</button><p>\${@trace}</p>`));
    expect(codesOf(r)).not.toContain("E-CG-TILDE-UNRESOLVED");
    expect(r.errors.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).toMatch(/let (_scrml_tilde_\d+) = _scrml_two_\d+\(5\);[\s\S]*?\}\);\s*return \1 \+ 1;/);
    expect(r.clientJs).toMatch(/let (_scrml_tilde_\d+) = _scrml_two_\d+\(4\);[\s\S]*?\}\);\s*let r = \1;/);
  });
});

describe("§9 F4 — a defer nested in a server-side statement of a split function fails closed", () => {
  test("`if (…) { defer @busy = false; ?{…} }` -> E-DEFER-SERVER-IN-SPLIT, and nothing is lowered into the server batch", () => {
    const r = compile(`<program db="sqlite::memory:">
<schema>
    tasks { id: integer primary key, done: integer }
</schema>
\${
    <busy> = false
    function save(id: number) {
        @busy = true
        if (id > 0) {
            defer @busy = false
            ?{\`UPDATE tasks SET done = 1 WHERE id = \${id}\`}.run()
        }
    }
}
<button onclick=save(1)>go</button>
<p>\${@busy}</p>
</program>`);
    expect(count(r, "E-DEFER-SERVER-IN-SPLIT")).toBe(1);
    const msg = r.errors.find((e) => e.code === "E-DEFER-SERVER-IN-SPLIT").message;
    expect(msg).toContain("`if` statement");
  });
  test("a defer nested in a CLIENT-side statement of a split function is fine", () => {
    const r = compile(`<program db="sqlite::memory:">
<schema>
    tasks { id: integer primary key, done: integer }
</schema>
\${
    <busy> = false
    <n> = 0
    function save(id: number) {
        @busy = true
        if (id > 0) {
            defer @n = @n + 1
            @busy = true
        }
        ?{\`UPDATE tasks SET done = 1 WHERE id = \${id}\`}.run()
    }
}
<button onclick=save(1)>go</button>
<p>\${@busy} \${@n}</p>
</program>`);
    expect(count(r, "E-DEFER-SERVER-IN-SPLIT")).toBe(0);
    expect(r.errors.map((e) => e.code)).toEqual([]);
  });
});

describe("§9 F5 — E-DEFER-SERVER-IN-SPLIT names the concrete trigger", () => {
  test("a callee the compiler placed server-side is named, without claiming it does server work", () => {
    const r = compile(`<program db="sqlite::memory:">
<schema>
    tasks { id: integer primary key, done: integer }
</schema>
\${
    <busy> = false
    function save(id: number) {
        @busy = true
        defer note(id)
        ?{\`UPDATE tasks SET done = 1 WHERE id = \${id}\`}.run()
        function note(x: number) {
            return x + 1
        }
    }
}
<button onclick=save(1)>go</button>
<p>\${@busy}</p>
</program>`);
    const e = r.errors.find((x) => x.code === "E-DEFER-SERVER-IN-SPLIT");
    expect(e).toBeDefined();
    expect(e.message).toContain("calls `note`, which the compiler placed server-side");
    expect(e.message).not.toContain("runs server-side work");
  });
});

describe("§9 F6 — the in-place handling hint uses a form that compiles", () => {
  test("E-DEFER-UNHANDLED-FAILABLE suggests `!{ | _ :> … }`, and that form compiles and runs at exit", () => {
    const base = `
      type CloseError:enum = { Busy, Gone }
      <trace> = ""
      function closeAll()! -> CloseError { fail CloseError.Busy }`;
    const bad = compile(wrap(`${base}
      function work() {
        defer closeAll()
        @trace = @trace + "w;"
      }`, `<button onclick=work()>go</button><p>\${@trace}</p>`));
    const e = bad.errors.find((x) => x.code === "E-DEFER-UNHANDLED-FAILABLE");
    expect(e.message).toContain("!{ | _ :> ... }");
    expect(e.message).not.toContain("else :>");
    const good = compile(wrap(`${base}
      function work() {
        defer closeAll() !{ | _ :> @trace = @trace + "close-failed;" }
        @trace = @trace + "w;"
      }`, `<button onclick=work()>go</button><p>\${@trace}</p>`));
    expect(good.errors.map((x) => x.code)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10 — S430 round 3 (H3): a deferred `!{}` handler is TOTAL, and the lowering
// never propagates out of the `finally`
// ---------------------------------------------------------------------------

describe("§10 H3 — deferred handlers are total; no return from inside the finally", () => {
  const base = `
    type CloseError:enum = { Busy, Gone }
    <trace> = ""
    function closeAll()! -> CloseError { fail CloseError.Busy }`;

  test("a deferred handler without a `_` arm -> E-DEFER-UNHANDLED-FAILABLE (even if it lists every declared variant)", () => {
    const r = compile(wrap(`${base}
      function work() {
        defer closeAll() !{
          | ::Busy :> @trace = @trace + "b;"
          | ::Gone :> @trace = @trace + "g;"
        }
        @trace = @trace + "w;"
      }`, `<button onclick=work()>go</button><p>\${@trace}</p>`));
    expect(count(r, "E-DEFER-UNHANDLED-FAILABLE")).toBe(1);
  });

  test("the same handler NOT deferred is unaffected (the rule is scoped to deferred bodies)", () => {
    const r = compile(wrap(`${base}
      function work() {
        closeAll() !{
          | ::Busy :> @trace = @trace + "b;"
          | ::Gone :> @trace = @trace + "g;"
        }
      }`, `<button onclick=work()>go</button><p>\${@trace}</p>`));
    expect(count(r, "E-DEFER-UNHANDLED-FAILABLE")).toBe(0);
  });

  test("lowering: a deferred handler never emits `return` inside the finally (even without a `_` arm)", async () => {
    const { emitLogicNode } = await import("../../src/codegen/emit-logic.ts");
    const { ast } = liveAST(wrap(`${base}
      function work() {
        defer closeAll() !{
          | ::Busy :> @trace = @trace + "b;"
        }
        @trace = @trace + "w;"
      }`));
    const fn = findAll(ast, (n) => n.kind === "function-decl" && n.name === "work")[0];
    lowerDefers({ nodes: [fn] }, new Set());
    const js = emitLogicNode(fn.body[0], { insideFunctionBody: true, declaredNames: new Set() });
    // the deferred statement is the registered closure's body
    const clo = js.slice(js.indexOf(".push(() => {"), js.indexOf("} finally {"));
    expect(clo).toContain("__scrml_error");
    expect(clo).not.toMatch(/\breturn\b/);
  });

  test("the same non-deferred handler still propagates the unmatched error (unchanged)", async () => {
    const { emitLogicNode } = await import("../../src/codegen/emit-logic.ts");
    const { ast } = liveAST(wrap(`${base}
      function work() {
        closeAll() !{
          | ::Busy :> @trace = @trace + "b;"
        }
      }`));
    const fn = findAll(ast, (n) => n.kind === "function-decl" && n.name === "work")[0];
    const js = emitLogicNode(fn.body[0], { insideFunctionBody: true, declaredNames: new Set() });
    expect(js).toMatch(/else \{ return /);
  });
});

// ---------------------------------------------------------------------------
// §11 — round 4: the defer STACK runner, executed
// ---------------------------------------------------------------------------

describe("§11 round 4 — the per-block defer stack, executed", () => {
  const runStack = (pushes, isAsync = false) => {
    const lines = deferStackRunnerLines("S", isAsync);
    const src = `const S = []; const log = [];\n${pushes}\ntry {\n} finally {\n${lines.join("\n")}\n}\nreturn log;`;
    return new Function(src);
  };

  test("LIFO: last-registered runs first", () => {
    const f = runStack(`S.push(() => log.push(1)); S.push(() => log.push(2)); S.push(() => log.push(3));`);
    expect(f()).toEqual([3, 2, 1]);
  });

  test("a host error in one deferred statement does not stop the others; the FIRST error is rethrown after all ran", () => {
    const log = [];
    const src = `const S = [];
S.push(() => log.push("a"));
S.push(() => { log.push("b"); throw new Error("first"); });
S.push(() => { log.push("c"); throw new Error("second-registered-last"); });
try {} finally {
${deferStackRunnerLines("S", false).join("\n")}
}`;
    let err = null;
    try { new Function("log", src)(log); } catch (e) { err = e; }
    // c runs first (LIFO) and throws; b and a still run; c's error (the first
    // thrown) is the one rethrown.
    expect(log).toEqual(["c", "b", "a"]);
    expect(err && err.message).toBe("second-registered-last");
  });

  test("async host: the runner awaits each closure in order", async () => {
    const log = [];
    const src = `return (async () => { const S = [];
S.push(async () => { await null; log.push(1); });
S.push(async () => { await null; log.push(2); });
try {} finally {
${deferStackRunnerLines("S", true).join("\n")}
}
log.push("after"); })();`;
    await new Function("log", src)(log);
    expect(log).toEqual([2, 1, "after"]);
  });

  test("a loop body is its own block: one stack instance per iteration", () => {
    const r = compile(wrap(`
      <trace> = ""
      function go() {
        for (const i of [1, 2]) {
          defer @trace = @trace + "e" + i + ";"
          @trace = @trace + "b" + i + ";"
        }
      }`, `<button onclick=go()>go</button><p>\${@trace}</p>`));
    expect(r.errors.map((e) => e.code)).toEqual([]);
    const js = r.clientJs;
    const forAt = js.indexOf("for (const i of");
    const stackAt = js.search(/const _scrml_defers_\d+ = \[\];/);
    expect(forAt).toBeGreaterThan(-1);
    expect(stackAt).toBeGreaterThan(forAt); // declared INSIDE the loop body
  });

  test("N3: inDeferredBody does not leak into a function declared in a deferred body", async () => {
    const { emitLogicNode } = await import("../../src/codegen/emit-logic.ts");
    const { ast } = liveAST(wrap(`
      type E:enum = { Busy, Gone }
      function risky()! -> E { fail E.Gone }
      function work() {
        defer {
          function inner()! -> E {
            risky() !{
              | ::Busy :> log("busy")
            }
            log("past")
          }
          inner() !{ | _ :> log("x") }
        }
      }`));
    const fn = findAll(ast, (n) => n.kind === "function-decl" && n.name === "work")[0];
    lowerDefers({ nodes: [fn] }, new Set());
    const js = emitLogicNode(fn.body[0], { insideFunctionBody: true, declaredNames: new Set() });
    const innerJs = js.slice(js.indexOf("function inner("));
    // the nested function's own non-total handler keeps its propagation
    expect(innerJs).toMatch(/else \{ return /);
  });
});

// ---------------------------------------------------------------------------
// §12 — round 5: later-shadow, redeclaration, unsupported sites, yield
// ---------------------------------------------------------------------------

describe("§12 F1 — E-DEFER-LATER-SHADOW (a deferred read of a name declared later)", () => {
  const codes = (logic) => runDeferChecks(liveAST(wrap(logic)).ast).map((d) => d.code);
  test("const declared after the defer, shadowing a file-level one", () => {
    expect(codes(`
      const x = "outer"
      function D(s) { log(s) }
      function f() {
        defer D("x=" + x + ";")
        const x = "inner"
        return x
      }`)).toEqual(["E-DEFER-LATER-SHADOW"]);
  });
  test("TDZ variant — the later declaration after an early return", () => {
    expect(codes(`
      const x = "outer"
      function D(s) { log(s) }
      function f(c) {
        defer D(x)
        if (c) { return "early" }
        const x = "inner"
        return x
      }`)).toEqual(["E-DEFER-LATER-SHADOW"]);
  });
  test("a later declaration in an ENCLOSING block of the chain", () => {
    expect(codes(`
      function D(s) { log(s) }
      function f(c) {
        if (c) {
          defer D(y)
        }
        let y = "later"
        return y
      }`)).toEqual(["E-DEFER-LATER-SHADOW"]);
  });
  test("a destructured later declaration", () => {
    expect(codes(`
      function D(s) { log(s) }
      function f() {
        defer D(a)
        const { a } = { a: "A" }
        return a
      }`)).toEqual(["E-DEFER-LATER-SHADOW"]);
  });
  test("clean: declared BEFORE the defer; declared inside the deferred body; a later function; an unrelated later name", () => {
    expect(codes(`
      function D(s) { log(s) }
      function f() {
        const z = "z"
        defer D(z)
        defer {
          const q = "q"
          D(q)
        }
        defer helper()
        const q = "other"
        const unrelated = 1
        function helper() { D("h") }
        return q + unrelated
      }`)).toEqual([]);
  });
  test("the message names the binding and both sites", () => {
    const d = runDeferChecks(liveAST(wrap(`
      const x = "outer"
      function D(s) { log(s) }
      function f() {
        defer D(x)
        const x = "inner"
        return x
      }`)).ast)[0];
    expect(d.message).toContain("`x`");
    expect(d.message).toMatch(/line \d+\).*line \d+/s);
  });
  test("both front-ends agree", () => {
    const src = wrap(`
      const x = "outer"
      function D(s) { log(s) }
      function f() {
        defer D(x)
        const x = "inner"
        return x
      }`);
    expect(runDeferChecks(nativeAST(src).ast).map((d) => d.code)).toEqual(["E-DEFER-LATER-SHADOW"]);
  });
});

describe("§12 F2 — E-SCOPE-REDECLARE (a block binds each name once), independent of defer", () => {
  const codes = (logic) => runRedeclareChecks(liveAST(wrap(logic)).ast).map((d) => d.code);
  test("let redeclaring a parameter; let redeclaring a same-block let; function redeclaring a const", () => {
    expect(codes(`
      function p1(x) { let x = "inner"
        return x }
      function p2() { let y = 1
        let y = 2
        return y }
      function p3() { const z = 1
        function z() { return 2 }
        return z }`)).toEqual(["E-SCOPE-REDECLARE", "E-SCOPE-REDECLARE", "E-SCOPE-REDECLARE"]);
  });
  test("nested-block shadowing of a parameter or outer binding is legal", () => {
    expect(codes(`
      function p4(w) {
        let v = 1
        if (true) {
          let w = 3
          let v = 2
          return w + v
        }
        return w
      }`)).toEqual([]);
  });
  test("adding a defer does not make a redeclared parameter compile", () => {
    const withDefer = compile(wrap(`
      <trace> = ""
      function D(s: string) { @trace = @trace + s }
      function f(x) {
        defer D("x=" + x + ";")
        let x = "inner"
        return x
      }`, `<button onclick=f("a")>go</button><p>\${@trace}</p>`));
    expect(count(withDefer, "E-SCOPE-REDECLARE")).toBe(1);
  });
  test("both front-ends agree", () => {
    const src = wrap(`
      function p1(x) {
        let x = "inner"
        return x
      }`);
    expect(runRedeclareChecks(nativeAST(src).ast).map((d) => d.code)).toEqual(["E-SCOPE-REDECLARE"]);
  });
});

describe("§12 F3/F4 — bare blocks and single-statement arms are not defer sites (fail closed)", () => {
  const codes = (logic) => runDeferChecks(liveAST(wrap(logic)).ast).map((d) => d.code);
  const nativeCodes = (logic) => runDeferChecks(nativeAST(wrap(logic)).ast).map((d) => d.code);
  const bare = `
      function D(s) { log(s) }
      function f() {
        {
          defer D("x;")
          D("b;")
        }
        D("after;")
      }`;
  test("defer in a bare { } block -> E-DEFER-UNSUPPORTED-SITE (live + native)", () => {
    expect(codes(bare)).toEqual(["E-DEFER-UNSUPPORTED-SITE"]);
    expect(nativeCodes(bare)).toEqual(["E-DEFER-UNSUPPORTED-SITE"]);
  });
  test("defer as a single-statement match arm -> E-DEFER-UNSUPPORTED-SITE", () => {
    expect(codes(`
      type Mode:enum = { A, B }
      function D(s) { log(s) }
      function f(m: Mode) {
        match m {
          .A :> defer D("a;")
          .B :> D("b;")
        }
      }`)).toEqual(["E-DEFER-UNSUPPORTED-SITE"]);
  });
  test("a braced match arm block IS a defer site", () => {
    expect(codes(`
      type Mode:enum = { A, B }
      function D(s) { log(s) }
      function f(m: Mode) {
        match m {
          .A :> {
            defer D("a;")
            D("in;")
          }
          .B :> D("b;")
        }
      }`)).toEqual([]);
  });
  test("a bare block / arm that merely mentions the word defer is not flagged", () => {
    expect(codes(`
      function defer(x) { return x }
      function f() {
        {
          log("defer me")
          defer(1)
        }
      }`)).toEqual([]);
  });
});

describe("§12 F5 — yield in a deferred body", () => {
  const codes = (logic) => runDeferChecks(liveAST(wrap(logic)).ast).map((d) => d.code);
  test("`defer yield 99` in a generator -> E-DEFER-CONTROL-FLOW", () => {
    expect(codes(`
      function* gen() {
        defer yield 99
        yield 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("a yield in a deferred block / an expression position -> E-DEFER-CONTROL-FLOW", () => {
    expect(codes(`
      function* other() { yield 2 }
      function* gen() {
        defer {
          let v = yield* other()
        }
        yield 1
      }`)).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });
  test("a yield in a generator NESTED in the deferred body is its own scope", () => {
    expect(codes(`
      function* gen() {
        defer {
          function* inner() { yield 1 }
          log(inner)
        }
        yield 1
      }`)).toEqual([]);
  });
});

describe("§12 value-producing arms are not defer sites (the value would be captured)", () => {
  const codes = (logic) => runDeferChecks(liveAST(wrap(logic)).ast).map((d) => d.code);
  test("value-form match arm, value-form if arm, fn-tail match statement arm", () => {
    expect(codes(`
      type Mode:enum = { A, B }
      function D(s) { log(s) }
      function f(m: Mode) {
        let k = match m {
          .A :> {
            defer D("a;")
            let t = 7
            t
          }
          .B :> 2
        }
        return k
      }
      function h(c: boolean) {
        let k = if (c) {
          defer D("h;")
          5
        } else {
          6
        }
        return k
      }
      fn g(m: Mode) -> number {
        match m {
          .A :> {
            defer log("g")
            let t = 7
            t
          }
          .B :> 2
        }
      }`)).toEqual(["E-DEFER-UNSUPPORTED-SITE", "E-DEFER-UNSUPPORTED-SITE", "E-DEFER-UNSUPPORTED-SITE"]);
  });
  test("a match STATEMENT arm that is not a value tail stays a defer site", () => {
    expect(codes(`
      type Mode:enum = { A, B }
      function D(s) { log(s) }
      function f(m: Mode) {
        match m {
          .A :> {
            defer D("a;")
            D("in;")
          }
          .B :> D("b;")
        }
        return 1
      }`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §13 — round 6: the narrow fail-closed set
// ---------------------------------------------------------------------------

describe("§13 round 6", () => {
  const live = (logic) => runDeferChecks(liveAST(wrap(logic)).ast);
  const nat = (logic) => runDeferChecks(nativeAST(wrap(logic)).ast);
  const codesOfDiags = (ds) => ds.map((d) => d.code);

  test("B: duplicate function declarations in a block WITH a defer -> E-DEFER-DUPLICATE-FUNCTION naming both (live + native)", () => {
    const logic = `
      function go2() { log("g2") }
      function f() {
        defer go2()
        function g() { return 1 }
        function g() { return 2 }
        return g()
      }`;
    const ds = live(logic);
    expect(codesOfDiags(ds)).toEqual(["E-DEFER-DUPLICATE-FUNCTION"]);
    expect(ds[0].message).toMatch(/function g.*line \d+.*first at line \d+/s);
    expect(codesOfDiags(nat(logic))).toEqual(["E-DEFER-DUPLICATE-FUNCTION"]);
  });
  test("B: the same duplicates WITHOUT a defer are untouched (§7.3.3 unchanged)", () => {
    const logic = `
      function f() {
        function g() { return 1 }
        function g() { return 2 }
        return g()
      }`;
    expect(codesOfDiags(live(logic))).toEqual([]);
    expect(runRedeclareChecks(liveAST(wrap(logic)).ast)).toEqual([]);
  });

  test("F: a defer as the unbraced body of if / else / for / while -> E-DEFER-UNSUPPORTED-SITE (live + native)", () => {
    const logic = `
      function D(s) { log(s) }
      function a(c) {
        if (c) defer D("a;")
        D("x;")
      }
      function b(c) {
        if (c) {
          D("y;")
        } else defer D("b;")
      }
      function l() {
        for (const i of [1, 2]) defer D("l;")
      }
      function w(c) {
        while (c) defer D("w;")
      }`;
    expect(codesOfDiags(live(logic))).toEqual(Array(4).fill("E-DEFER-UNSUPPORTED-SITE"));
    expect(codesOfDiags(nat(logic))).toEqual(Array(4).fill("E-DEFER-UNSUPPORTED-SITE"));
  });
  test("F: a braced arm and a defer after a call's `)` are still defer sites", () => {
    expect(codesOfDiags(live(`
      function D(s) { log(s) }
      function a(c) {
        if (c) {
          defer D("a;")
        }
        D("x")
        defer D("y")
      }`))).toEqual([]);
  });

  test("A (native): a declaration inside a bare block shadowing an outer one is NOT E-SCOPE-REDECLARE", () => {
    const logic = `
      function f() {
        let x = 1
        {
          let x = 2
          log(x)
        }
        return x
      }`;
    expect(runRedeclareChecks(nativeAST(wrap(logic)).ast)).toEqual([]);
    expect(runRedeclareChecks(liveAST(wrap(logic)).ast)).toEqual([]);
  });

  test("D (live): a doubly-nested bare block reports ONE unsupported site, no spurious lambda error", () => {
    expect(codesOfDiags(live(`
      function D(s) { log(s) }
      function dd() {
        {
          {
            defer D("x;")
          }
        }
      }`))).toEqual(["E-DEFER-UNSUPPORTED-SITE"]);
  });

  test("E (native): a single-statement match-arm defer is E-DEFER-UNSUPPORTED-SITE, not a parse-error cascade", () => {
    const src = wrap(`
      type Mode:enum = { A, B }
      function D(s) { log(s) }
      function arm(m: Mode) {
        match m {
          .A :> defer D("a;")
          .B :> D("b;")
        }
      }`);
    const r = nativeAST(src);
    const all = [...(r.errors ?? []).map((e) => e.code), ...codesOfDiags(runDeferChecks(r.ast))];
    expect(all).toContain("E-DEFER-UNSUPPORTED-SITE");
    expect(all.filter((c) => c.startsWith("E-EXPR-MATCH"))).toEqual([]);
  });

  test("G (live): a yield inside a parenthesised expression is reported at its statement's line", () => {
    const ds = live(`
      function* gen() {
        defer {
          let v = (yield 5)
        }
        yield 1
      }`);
    expect(codesOfDiags(ds)).toEqual(["E-DEFER-CONTROL-FLOW"]);
    expect(ds[0].span.line).toBeGreaterThan(1);
  });

  test("`defer [` — a separated `[` is a defer statement, an adjacent `defer[0]` is an index (live + native)", () => {
    const src = wrap(`
      function f() {
        defer ["a"].forEach((s) => log(s))
        let defer = [7]
        log(defer[0])
      }`);
    for (const r of [liveAST(src), nativeAST(src)]) {
      const body = fnBody(r.ast, "f");
      expect(body[0].kind).toBe("defer-stmt");
      expect(body.slice(1).some((s) => s.kind === "defer-stmt")).toBe(false);
    }
  });

  test("C: the unanalysable later-shadow message tells the author how to fix it", () => {
    const ds = live(`
      function D(s) { log(s) }
      function f() {
        defer D([1].map((x) => { return x }))
        const late = 1
        return late
      }`);
    expect(codesOfDiags(ds)).toEqual(["E-DEFER-LATER-SHADOW"]);
    expect(ds[0].message).toMatch(/move the later declaration/);
    expect(ds[0].message).toMatch(/rename/);
  });
});
