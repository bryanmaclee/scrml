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
import { lowerDeferList, lowerDefers, isDeferLoweredTry } from "../../src/codegen/lower-defer.ts";
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

  test("[a, defer D1, b, defer D2, c] -> a; try { b; try { c } finally { D2 } } finally { D1 }", () => {
    const out = lowerDeferList([S("a"), D("D1"), S("b"), D("D2"), S("c")]);
    expect(out.length).toBe(2);
    expect(out[0].expr).toBe("a");
    const t1 = out[1];
    expect(isDeferLoweredTry(t1)).toBe(true);
    expect(t1.finallyNode.body[0].expr).toBe("D1");
    expect(t1.body[0].expr).toBe("b");
    const t2 = t1.body[1];
    expect(isDeferLoweredTry(t2)).toBe(true);
    expect(t2.finallyNode.body[0].expr).toBe("D2");
    expect(t2.body.map((s) => s.expr)).toEqual(["c"]);
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
    expect(isDeferLoweredTry(cons[0])).toBe(true);
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
  test("a defer lowers to a host try/finally with LIFO nesting", () => {
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
    const i1 = js.indexOf(`+ "1")`);
    const i2 = js.indexOf(`+ "2")`);
    const ib = js.indexOf(`+ "b")`);
    expect(js).toContain("finally {");
    // LIFO: the "2" finally is INNER, so it is emitted before (above) the "1" finally,
    // and both come after the body statement "b".
    expect(ib).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(ib);
    expect(i1).toBeGreaterThan(i2);
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
    expect(r.clientJs).toMatch(/try \{\s*return acc \+ 1;\s*\} finally \{\s*acc = 0;/);
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
    const fin = w.indexOf("} finally {");
    const deferWrite = w.indexOf(`+ "D;"`);
    expect(lastAwait).toBeGreaterThan(-1);
    expect(endWrite).toBeGreaterThan(lastAwait);
    expect(fin).toBeGreaterThan(endWrite);
    expect(deferWrite).toBeGreaterThan(fin);
    // The try opens BEFORE the first batch await (so a batch-0 failure still runs it).
    const tryOpen = w.indexOf("try {", w.indexOf(`+ "start;"`));
    const firstAwait = w.indexOf("await _scrml_fetch_save_batch_0");
    expect(tryOpen).toBeGreaterThan(-1);
    expect(tryOpen).toBeLessThan(firstAwait);
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
