/**
 * cell-assign-server-call-awaited.test.js — s441 (g-cell-assign-server-call-fired-detached)
 *
 * SPEC §13.2: "The compiler SHALL insert `await` at every call site where a
 * server-generated fetch call is made" and SHALL "Sequence dependent operations
 * using `await`". RULING (S440 JS-WAT #12): `@cell = serverFn()` fired detached is
 * fixed in impl#1 as a §13.2 conformance restoration.
 *
 * THE DEFECT. emit-expr already awaited a client->server call at its call site in
 * an async host (U1), so the body arrived at emit-client's
 * `post-server-fn-iife-wrap` pass as `_scrml_reactive_set("out", await stub(21))`
 * — correct. That pass ABSORBED the `await` and re-emitted the site as a DETACHED
 * `(async () => _scrml_reactive_set(…, await stub(…)))().catch(…)`, so the next
 * statement read the pre-fetch value and successive writes raced. Every other
 * write form (`@x.f = s()`, `@x += s()`, `[...@l, s()]`, `s().field`) was already
 * awaited in place — only the WHOLE-RESULT form was un-done.
 *
 * Same mechanism, fixed together:
 *   - the `!{}` failable cell-assign (g-failable-cell-load-fire-and-forget-stale-
 *     read-dead-return; S435 ruling "lift") — awaited in place, so an arm's
 *     `return` returns from the author's function and a later read sees the
 *     resolved cell; the result binding is `let` (a value arm assigns it — the
 *     old `const` threw "Assignment to constant variable" on the error path);
 *   - the engine opener `effect=` (§51.0.H Form 3) — lowered as an async function
 *     body, so the README flagship boots to `.Editing` when rows exist (it always
 *     booted to `.Empty`);
 *   - a `<request>` body cell reassigned in a FUNCTION no longer has the §6.7.7
 *     settle machine spliced into that function.
 *
 * Where the host genuinely cannot await (a module-init statement of a classic
 * script), the IIFE survives — that is the case it was built for.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import { run } from "../../../conformance/adapters/impl1-ts.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const REPO = join(import.meta.dir, "../../..");

function clientJs(src) {
  const dir = mkdtempSync(join(tmpdir(), "s441-cell-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], outputDir: join(dir, "dist"), write: false });
  expect(result.errors).toEqual([]);
  return result.outputs.get(file).clientJs;
}

/** The body text of the emitted client function whose source name is `name`. */
function fnBody(js, name) {
  const re = new RegExp(`async function _scrml_${name}_\\d+\\([^)]*\\) \\{\\n([\\s\\S]*?)\\n\\}\\n`);
  const m = js.match(re);
  expect(m).not.toBeNull();
  return m[1];
}

const DETACHED = /\(async \(\) => _scrml_cs_reactive_set\(/;

const WRITE_FORMS = `\${
    type Rec:struct = { v: number }
    <out> : number = 0
    <rec> : Rec = { v: 0 }
    <list> : number[] = []
    <seen> : string = ""
    <flag> : boolean = true
    server fn double(n: number) : number {
        return n * 2
    }
    server fn rec(n: number) : Rec {
        return { v: n }
    }
    function whole() {
        @out = double(21)
        @seen = "whole:" + @out
    }
    function field() {
        @rec.v = double(5)
        @seen = "field:" + @rec.v
    }
    function plusEq() {
        @out = 1
        @out += double(5)
        @seen = "plusEq:" + @out
    }
    function spread() {
        @list = [...@list, double(3)]
        @seen = "spread:" + @list.length
    }
    function member() {
        @out = rec(7).v
        @seen = "member:" + @out
    }
    function inIf() {
        if (@flag) {
            @out = double(4)
            @seen = "inIf:" + @out
        }
    }
    function inLoop() {
        for (let i = 0; i < 2; i = i + 1) {
            @out = double(i + 10)
            @seen = @seen + "loop:" + @out + ";"
        }
    }
}
<button id="whole" onclick=whole()>w</>
<button id="field" onclick=field()>f</>
<button id="plusEq" onclick=plusEq()>p</>
<button id="spread" onclick=spread()>s</>
<button id="member" onclick=member()>m</>
<button id="inIf" onclick=inIf()>i</>
<button id="inLoop" onclick=inLoop()>l</>
<p id="seen">\${@seen}</>
`;

describe("s441 §1 — every write form of a server call inside a function is awaited IN PLACE", () => {
  const js = clientJs(WRITE_FORMS);

  test("whole-result `@out = double(21)` — awaited in place, not a detached IIFE", () => {
    const body = fnBody(js, "whole");
    expect(body).toMatch(/_scrml_cs_reactive_set\("out", await _scrml_fetch_double_\d+\(21\)\);/);
    expect(body).not.toMatch(DETACHED);
  });

  test("`@out = double(4)` inside an `if` arm — awaited in place", () => {
    const body = fnBody(js, "inIf");
    expect(body).toMatch(/_scrml_cs_reactive_set\("out", await _scrml_fetch_double_\d+\(4\)\);/);
    expect(body).not.toMatch(DETACHED);
  });

  test("`@out = double(i + 10)` inside a `for` loop — awaited in place (each iteration sequenced)", () => {
    const body = fnBody(js, "inLoop");
    expect(body).toMatch(/_scrml_cs_reactive_set\("out", await _scrml_fetch_double_\d+\(i \+ 10\)\);/);
    expect(body).not.toMatch(DETACHED);
  });

  test("the other write forms stay awaited in place (field / += / spread / member tail)", () => {
    expect(fnBody(js, "field")).toMatch(/_scrml_deep_set\([^;]*await _scrml_fetch_double_\d+\(5\)\)\);/);
    expect(fnBody(js, "plusEq")).toMatch(/_scrml_cs_reactive_get\("out"\) \+ await _scrml_fetch_double_\d+\(5\)\);/);
    expect(fnBody(js, "spread")).toMatch(/await _scrml_fetch_double_\d+\(3\)\]\)\);/);
    expect(fnBody(js, "member")).toMatch(/\(await _scrml_fetch_rec_\d+\(7\)\)\.v\);/);
  });

  test("no detached cell-set IIFE survives anywhere in the file (every write is in an async host)", () => {
    expect(js).not.toMatch(DETACHED);
  });
});

describe("s441 §2 — execution: the write lands before the next statement reads it", () => {
  test("each write form: the statement after the write sees the resolved value", async () => {
    const cases = [
      ["#whole", "whole:42", 21],
      ["#field", "field:10", 5],
      ["#member", "member:7", null],
      ["#inIf", "inIf:8", 4],
    ];
    for (const [sel, expected] of cases) {
      const stub = sel === "#member" ? { rec: { v: 7 } } : { double: sel === "#whole" ? 42 : sel === "#field" ? 10 : 8 };
      const r = await run(WRITE_FORMS, [{ click: sel }, { wait: "settle" }], {}, stub);
      expect(r.state.cells.seen).toBe(expected);
    }
  });

  test("`@out = double(1); @out = double(2); @out = @out + 100` — source order, not arrival order", async () => {
    const src = `\${
    <out> : number = 0
    <final> : number = -1
    server fn double(n: number) : number {
        return n * 2
    }
    function seq() {
        @out = double(1)
        @out = double(2)
        @out = @out + 100
        @final = @out
    }
}
<button id="seq" onclick=seq()>Seq</>
<p id="final">\${@final}</>
`;
    const r = await run(src, [{ click: "#seq" }, { wait: "settle" }], {}, { double: 7 });
    // Pre-fix: final = 100 (stale 0 + 100) and out = 7 (a detached write resolved last).
    expect(r.state.cells.final).toBe(107);
    expect(r.state.cells.out).toBe(107);
  });
});

const FAILABLE = `\${
    type LoadError:enum = {
        Boom(msg: string)
    }
    <out> : number = 0
    <seen> : string = "none"
    <after> : string = "not-run"
    <result> : string = "init"
    server function risky(n: number)! LoadError {
        if (n < 0) { fail LoadError.Boom("neg") }
        return n * 3
    }
    function load() {
        @out = risky(2) !{
            | .Boom(m) :> { @seen = "boom:" + m; return }
        }
        @after = "ran:" + @out
    }
    function recover() {
        @result = risky(-1) !{
            | .Boom(m) :> "recovered: " + m
        }
        @after = "saw " + @result
    }
}
<button id="load" onclick=load()>Load</>
<button id="recover" onclick=recover()>Recover</>
<p id="after">\${@after}</>
`;

const BOOM = { __serverError: { type: "LoadError", variant: "Boom", data: { msg: "neg" } } };

describe("s441 §3 — the `!{}` failable cell-assign (same mechanism; S435 ruling: lift)", () => {
  test("emit: awaited in place with a `let` result binding — no IIFE around the handler", () => {
    const body = fnBody(clientJs(FAILABLE), "load");
    expect(body).toMatch(/let (_scrml__scrml_result_\d+) = await _scrml_fetch_risky_\d+\(2\);/);
    expect(body).not.toMatch(/\(async \(\) => \{/);
    // The success path writes the cell only in the `else` (never the envelope).
    expect(body).toMatch(/\} else \{\n\s*_scrml_cs_reactive_set\("out", _scrml__scrml_result_\d+\);\n\s*\}/);
  });

  test("error path: the arm's `return` returns from the AUTHOR's function", async () => {
    const r = await run(FAILABLE, [{ click: "#load" }, { wait: "settle" }], {}, { risky: BOOM });
    expect(r.state.cells.seen).toBe("boom:neg");
    expect(r.state.cells.after).toBe("not-run"); // pre-fix: "ran:0"
    expect(r.state.cells.out).toBe(0); // the envelope never lands in the cell
  });

  test("success path: the statement after the handler reads the resolved cell", async () => {
    const r = await run(FAILABLE, [{ click: "#load" }, { wait: "settle" }], {}, { risky: 9 });
    expect(r.state.cells.out).toBe(9);
    expect(r.state.cells.after).toBe("ran:9"); // pre-fix: "ran:0"
  });

  test("value-form recovery arm lands in the cell (pre-fix: `const` binding threw on the arm's assignment)", async () => {
    const r = await run(FAILABLE, [{ click: "#recover" }, { wait: "settle" }], {}, { risky: BOOM });
    expect(r.state.cells.result).toBe("recovered: neg");
    expect(r.state.cells.after).toBe("saw recovered: neg");
  });

  test("module-init (no async host) keeps the IIFE, now with a `let` binding so a value arm can assign it", async () => {
    const src = `\${
    type LoadError:enum = {
        Boom(msg: string)
    }
    server function risky(n: number)! LoadError {
        if (n < 0) { fail LoadError.Boom("neg") }
        return "ok"
    }
    @data = risky(-1) !{
        | .Boom(m) :> "recovered: " + m
    }
}
<p id="out">\${@data}</p>
`;
    const js = clientJs(src);
    expect(js).toMatch(/\(async \(\) => \{\n\s*let _scrml__scrml_result_\d+ = await _scrml_fetch_risky_\d+\(-1\);/);
    const r = await run(src, [{ wait: "settle" }], {}, { risky: BOOM });
    expect(r.state.cells.data).toBe("recovered: neg");
  });
});

describe("s441 §4 — module-init has no async host: the IIFE is the only legal shape and stays", () => {
  test("a top-level `@top = double(50)` keeps the auto-await IIFE + `.catch` backstop", () => {
    const js = clientJs(`\${
    <top> : number = 0
    server fn double(n: number) : number {
        return n * 2
    }
    @top = double(50)
}
<p id="top">\${@top}</p>
`);
    expect(js).toMatch(/\(async \(\) => _scrml_cs_reactive_set\("top", await _scrml_fetch_double_\d+\(50\)\)\)\(\)\.catch\(_scrml_async_err => _scrml_error_boundary_log\("top", _scrml_async_err\)\);/);
  });
});

describe("s441 §5 — a `<request>` body cell reassigned inside a function", () => {
  const src = `<program>

\${
  server function loadValue() {
    lift 42
  }
  function refresh() {
    @data = loadValue()
    @seen = @data
  }
  @seen = 0
}

<div>
  <request id="req1">
    \${ @data = loadValue() }
  </>
  <p id="out">\${@data}</p>
  <button id="refresh" onclick=refresh()>r</button>
</div>

</program>
`;
  test("the function's write is awaited in place; the settle machine drives the MOUNT fetch, not the function", () => {
    const js = clientJs(src);
    const body = fnBody(js, "refresh");
    expect(body).toMatch(/_scrml_cs_reactive_set\("data", await _scrml_fetch_loadValue_\d+\(\)\);/);
    expect(body).not.toContain("_scrml_request_req1_fetch");
    // Exactly one settle machine, at module scope.
    expect(js.match(/async function _scrml_request_req1_fetch\(\)/g)?.length).toBe(1);
    expect(js).toMatch(/^_scrml_request_req1_fetch\(\);$/m);
  });
});

describe("s441 §6 — README flagship: engine opener `effect=` boots to the loaded phase", () => {
  const src = readFileSync(join(REPO, "docs/readme-snippets/tasks-app.scrml"), "utf8");
  const rows = [{ id: 1, text: "a", completed_at: null }, { id: 2, text: "b", completed_at: null }];

  test("emit: the boot effect is an async function awaiting the load in place", () => {
    const js = clientJs(src);
    const m = js.match(/\/\/ §51\.0\.H Form 3 opener effect=[^\n]*\n([\s\S]*?)\n\/\/ --- ref=/);
    expect(m).not.toBeNull();
    const effect = m[1];
    expect(effect.startsWith("(async function () {")).toBe(true);
    expect(effect).toMatch(/let _scrml__scrml_result_\d+ = await _scrml_fetch_loadTasks_\d+\(/);
    expect(effect).not.toMatch(/\(async \(\) => \{/);
    // The arm's `return` stays a real return (it was rewritten to `<result> = null`).
    expect(effect).not.toMatch(/_scrml__scrml_result_\d+ = null;/);
    expect(effect).toContain(`.catch(_scrml_async_err => _scrml_error_boundary_log("phase effect=", _scrml_async_err));`);
  });

  test("rows exist -> phase is Editing (pre-fix: always Empty)", async () => {
    const r = await run(src, [{ wait: "settle" }], {}, { loadTasks: rows });
    expect(r.state.cells.tasks).toEqual(rows);
    expect(r.state.cells.phase).toBe("Editing");
  });

  test("no rows -> phase is Empty", async () => {
    const r = await run(src, [{ wait: "settle" }], {}, { loadTasks: [] });
    expect(r.state.cells.phase).toBe("Empty");
  });

  test("Network failure -> ErrorState, and the list is left untouched (pre-fix: TypeError on the error path)", async () => {
    const r = await run(src, [{ wait: "settle" }], {}, {
      loadTasks: { __serverError: { type: "LoadError", variant: "Network", data: { msg: "down" } } },
    });
    expect(r.state.cells.phase).toEqual({ variant: "ErrorState", data: { msg: "down" } });
    expect(r.state.cells.tasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// s441 fix round (review F1/F2/F4)
// ---------------------------------------------------------------------------


/**
 * Run with the adapter's stub fetch WRAPPED so every server call logs
 * `start <fn>` when issued and `end <fn>` when answered (the answer is held
 * for a few microtasks, so two concurrent calls interleave start/start/end/end
 * and two sequential ones start/end/start/end).
 */
async function runLoggingCallOrder(src, steps, stub) {
  const log = [];
  const bodies = [];
  const RE = /__ri_route_(.+?)_\d+/;
  const origRegister = GlobalRegistrator.register.bind(GlobalRegistrator);
  GlobalRegistrator.register = (...a) => {
    const r = origRegister(...a);
    let inner = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      get: () => inner,
      set: (v) => {
        inner = v && v.__s441 ? v : Object.assign(async (u, init) => {
          const n = String(typeof u === "string" ? u : u?.url).match(RE)?.[1] ?? "?";
          log.push("start " + n);
          bodies.push(n + " " + String(init?.body ?? ""));
          for (let i = 0; i < 5; i++) await Promise.resolve();
          const res = await v(u, init);
          log.push("end " + n);
          return res;
        }, { __s441: true });
      },
    });
    return r;
  };
  try {
    const r = await run(src, steps, {}, stub);
    return { r, log, bodies };
  } finally {
    GlobalRegistrator.register = origRegister;
  }
}

const BATCH = readFileSync(join(REPO, "docs/changes/s441-cell-assign-server-call-awaited/repro/parallel-batch.scrml"), "utf8");

describe("s441 F1 — independent whole-result cell writes are parallelized (§13.2), dependent ones stay sequential", () => {
  const js = clientJs(BATCH);

  test("independent `@a = one(1); @b = two(2)` → one Promise.all, then the writes in source order", () => {
    const body = fnBody(js, "indep");
    expect(body).toMatch(/const \[(_scrml_tmp_\d+), (_scrml_tmp_\d+)\] = await _scrml_g\.Promise\.all\(\[\n\s*_scrml_fetch_one_\d+\(1\),\n\s*_scrml_fetch_two_\d+\(2\)\n\s*\]\);\n\s*_scrml_cs_reactive_set\("a", \1\);\n\s*_scrml_cs_reactive_set\("b", \2\);/);
  });

  test("execution: both calls are in flight together, and the read after the batch sees both writes", async () => {
    const { r, log } = await runLoggingCallOrder(BATCH, [{ click: "#indep" }, { wait: "settle" }], { one: 1, two: 2 });
    expect(log.slice(0, 2)).toEqual(["start one", "start two"]);
    expect(r.state.cells.seen).toBe("indep:1,2");
  });

  test("data dependency (`two(@a)`), an intervening statement, a decl reading the write, a `!{}` load — all stay sequential", async () => {
    for (const name of ["dep", "between", "declReads", "failable"]) {
      expect(fnBody(js, name)).not.toContain("Promise.all");
    }
    const { r, log } = await runLoggingCallOrder(BATCH, [{ click: "#dep" }, { wait: "settle" }], { one: 5, two: 6 });
    expect(log).toEqual(["start one", "end one", "start two", "end two"]);
    expect(r.state.cells.seen).toBe("dep:6");
  });
});

describe("s441 F2 — an engine opener `effect=` with no server call keeps its reset registration", () => {
  const src = `\${
    type Phase:enum = { Loading, Empty, Editing }
    function grow() {
        @tasks.push(3)
    }
    function doReset() {
        reset(@tasks)
    }
}
const loadTasks = () => [1, 2]
<engine for=Phase initial=.Loading effect=\${
    @tasks = loadTasks()
    @phase = @tasks.length == 0 ? .Empty : .Editing
}>
    <Loading rule=(.Empty | .Editing)>Loading…</>
    <Empty rule=.Loading>None.</>
    <Editing rule=.Loading>\${@tasks.length} tasks</>
</>
<program>
<button id="grow" onclick=grow()>g</>
<button id="rst" onclick=doReset()>r</>
<p id="count">Tasks: \${@tasks.length}</>
</program>
`;
  test("the synchronous wrapper registers the init thunk; reset(@tasks) restores [1, 2]", async () => {
    const js = clientJs(src);
    expect(js).toContain(`(function () {`);
    expect(js).toMatch(/_scrml_cs_init_set\("tasks", \(\) => _scrml_loadTasks_\d+\(\)\);|_scrml_cs_init_set\("tasks", \(\) => loadTasks\(\)\);/);
    const r = await run(src, [{ click: "#grow" }, { wait: "settle" }, { click: "#rst" }, { wait: "settle" }], {}, {});
    expect(r.state.cells.tasks).toEqual([1, 2]);
  });
});

describe("s441 F4 — `while` / `do…while` bodies in an async function await in place", () => {
  const src = `\${
    <out> : number = 0
    <seen> : string = ""
    server fn double(n: number) : number {
        return n * 2
    }
    function w() {
        let i = 0
        while (i < 2) { @out = double(i); i = i + 1 }
        @seen = "w:" + @out
    }
    function d() {
        let i = 0
        do { @out = double(i); i = i + 1 } while (i < 2)
        @seen = "d:" + @out
    }
}
<button id="w" onclick=w()>w</>
<button id="d" onclick=d()>d</>
<p>\${@seen}</>
`;
  test("no detached write in either loop; the read after the loop sees the last write", async () => {
    const js = clientJs(src);
    expect(fnBody(js, "w")).toMatch(/_scrml_cs_reactive_set\("out", await _scrml_fetch_double_\d+\(i\)\);/);
    expect(fnBody(js, "d")).toMatch(/_scrml_cs_reactive_set\("out", await _scrml_fetch_double_\d+\(i\)\);/);
    expect(js).not.toMatch(DETACHED);
    const r1 = await run(src, [{ click: "#w" }, { wait: "settle" }], {}, { double: 5 });
    expect(r1.state.cells.seen).toBe("w:5"); // pre-fix: "w:0"
    const r2 = await run(src, [{ click: "#d" }, { wait: "settle" }], {}, { double: 5 });
    expect(r2.state.cells.seen).toBe("d:5");
  });
});

// ---------------------------------------------------------------------------
// s441 fix round 3 — batch membership is decided on the AST and fails CLOSED
// (review findings 1-5), and only proven read-only server fns share a batch
// with a cell write (finding 8). Probes: docs/changes/…/repro/r3/.
// ---------------------------------------------------------------------------

const R3 = join(REPO, "docs/changes/s441-cell-assign-server-call-awaited/repro/r3");
const SEQ = ["start one", "end one", "start two", "end two"];

describe("s441 round 3 — a statement whose call args are not provably cell-free never joins a cell-write batch", () => {
  const cases = [
    // [probe, expected @seen, the body the SECOND server call must receive]
    ["helper", "a=2 b=20", 'two {"n":2}'],       // two(readA()) — a helper reads @a
    ["derived", "a=2 b=20", 'two {"n":4}'],      // two(@dbl) — derived cell over @a
    ["direct", "a=2 b=20", 'two {"n":2}'],       // two(@a) — direct read of the member's cell
    ["declhelper", "a=2 x=20", 'two {"n":2}'],   // const x = two(readA())
    ["sidew", "a=50 r=20", 'two {"n":1}'],       // const r = two(bump()) — the helper WRITES @a
  ];
  for (const [probe, seen, secondBody] of cases) {
    test(`${probe}: sequential, and every read sees the resolved value`, async () => {
      const src = readFileSync(join(R3, probe + ".scrml"), "utf8");
      const { r, log, bodies } = await runLoggingCallOrder(src, [{ click: "#b" }, { wait: "settle" }], { one: 2, two: 20 });
      expect(log).toEqual(SEQ);
      expect(bodies[1]).toBe(secondBody);
      expect(r.state.cells.seen).toBe(seen);
    });
  }

  test("declplain: `const y = @dbl` after the write reads the derived value of the resolved cell", async () => {
    const src = readFileSync(join(R3, "declplain.scrml"), "utf8");
    const { r } = await runLoggingCallOrder(src, [{ click: "#b" }, { wait: "settle" }], { one: 2 });
    expect(r.state.cells.seen).toBe("a=2 y=4");
  });
});

describe("s441 round 3 — only PROVABLY read-only server fns batch with a cell write (bryan S441)", () => {
  test("`@a = addRow(5)` (INSERT) then `@b = countRows()` (SELECT) stays in source order", async () => {
    const src = readFileSync(join(R3, "insel.scrml"), "utf8");
    const { r, log } = await runLoggingCallOrder(src, [{ click: "#b" }, { wait: "settle" }], { addRow: 5, countRows: 1 });
    expect(log).toEqual(["start addRow", "end addRow", "start countRows", "end countRows"]);
    expect(r.state.cells.seen).toBe("b=1");
  });

  test("two provably read-only loads (no calls in their bodies) still batch", () => {
    const js = clientJs(BATCH);
    expect(fnBody(js, "indep")).toContain("await _scrml_g.Promise.all([");
  });

  test("KNOWN (gap g-const-batch-parallelizes-side-effecting-server-calls, not fixed here): the pre-existing CONST-form batch still parallelizes INSERT + SELECT", () => {
    const src = readFileSync(join(R3, "inselc.scrml"), "utf8");
    const js = clientJs(src);
    expect(fnBody(js, "go")).toContain("await _scrml_g.Promise.all([");
  });
});

describe("s441 round 3 — engine opener effect=", () => {
  test("F6: a `!{}` arm `return` nested in an `if` exits the effect (no null write; the statements after it do not run)", async () => {
    const src = readFileSync(join(R3, "efffail.scrml"), "utf8");
    const r = await run(src, [{ wait: "settle" }], {}, {
      risky: { __serverError: { type: "LoadError", variant: "Boom", data: { msg: "neg" } } },
    });
    expect(r.state.cells.seen).toBe("nested:neg");
    expect(r.state.cells.after).toBe("not-run");
    expect(r.state.cells.out).toBe(0);
  });

  test("F7: the reset thunk of an effect write with a server call inside a larger expression is async and resolves", async () => {
    const src = `\${
    type Phase:enum = { Loading, Empty, Editing }
    server fn loadTasks() : number[] {
        return [1, 2]
    }
    function grow() {
        @m.push(9)
    }
    function doReset() {
        reset(@m)
    }
}
<engine for=Phase initial=.Loading effect=\${
    @m = [0, ...loadTasks()]
    @phase = @m.length == 0 ? .Empty : .Editing
}>
    <Loading rule=(.Empty | .Editing)>Loading…</>
    <Empty rule=.Loading>None.</>
    <Editing rule=.Loading>ok</>
</>
<program>
<button id="grow" onclick=grow()>g</>
<button id="rst" onclick=doReset()>r</>
</program>
`;
    const js = clientJs(src);
    expect(js).toMatch(/_scrml_cs_init_set\("m", async \(\) => /);
    const r = await run(src, [{ wait: "settle" }, { click: "#grow" }, { wait: "settle" }, { click: "#rst" }, { wait: "settle" }], {}, { loadTasks: [1, 2] });
    expect(r.state.cells.m).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// s441 fix round 4 — a SQL FUNCTION call is not provably read-only (review F1),
// and while / for…of bodies inside an engine effect= await in place (F2).
// Probes: docs/changes/…/repro/r4/.
// ---------------------------------------------------------------------------

const R4 = join(REPO, "docs/changes/s441-cell-assign-server-call-awaited/repro/r4");

describe("s441 round 4 — a SELECT that calls a non-allowlisted SQL function never batches with a cell write", () => {
  const SEQ_RD = ["start rd1", "end rd1", "start rd2", "end rd2"];
  // proc: SELECT place_order(5) · nextval: SELECT nextval('s') · advlock: pg_advisory_lock(1)
  // setcfg: set_config(...) · subq: SELECT (SELECT place_order(1)) · cte: WITH x AS (INSERT …)
  // forupd: SELECT … FOR UPDATE · run: a SELECT executed with .run()
  for (const probe of ["sq_proc", "sq_nextval", "sq_advlock", "sq_setcfg", "sq_subq", "sq_cte", "sq_forupd", "sq_run"]) {
    test(`${probe}: sequential`, async () => {
      const src = readFileSync(join(R4, probe + ".scrml"), "utf8");
      expect(fnBody(clientJs(src), "go")).not.toContain("Promise.all");
      const { log } = await runLoggingCallOrder(src, [{ click: "#b" }, { wait: "settle" }], { rd1: 1, rd2: 2 });
      expect(log).toEqual(SEQ_RD);
    });
  }

  test("sq_plain (`SELECT max(v)` + `SELECT count(*)`, allowlisted pure functions) still batches", async () => {
    const src = readFileSync(join(R4, "sq_plain.scrml"), "utf8");
    expect(fnBody(clientJs(src), "go")).toContain("await _scrml_g.Promise.all([");
    const { log } = await runLoggingCallOrder(src, [{ click: "#b" }, { wait: "settle" }], { rd1: 1, rd2: 2 });
    expect(log.slice(0, 2)).toEqual(["start rd1", "start rd2"]);
  });

  test("pgproc: `@orderId = placeOrder(5)` (SELECT place_order(…)) then `@count = orderCount()` stays in source order", async () => {
    const src = readFileSync(join(R4, "pgproc.scrml"), "utf8");
    const { r, log } = await runLoggingCallOrder(src, [{ click: "#b" }, { wait: "settle" }], { placeOrder: 7, orderCount: 1 });
    expect(log).toEqual(["start placeOrder", "end placeOrder", "start orderCount", "end orderCount"]);
    expect(r.state.cells.orderId).toBe(7);
    expect(r.state.cells.count).toBe(1);
  });
});

describe("s441 round 4 — while / for…of inside an engine effect= await in place", () => {
  test("whileeff: every loop write lands before the loop's next read", async () => {
    const src = readFileSync(join(R4, "whileeff.scrml"), "utf8");
    expect(clientJs(src)).not.toMatch(DETACHED);
    const r = await run(src, [{ wait: "settle" }], {}, { double: 7 });
    expect(r.state.cells.elog).toBe(",7,7,7;7;7"); // pre-fix: ",0,0,0;7;7"
  });

  test("efffor: a `!{}` arm `return` inside for…of exits the effect", async () => {
    const src = readFileSync(join(R4, "efffor.scrml"), "utf8");
    const r = await run(src, [{ wait: "settle" }], {}, {
      risky: { __serverError: { type: "LoadError", variant: "Boom", data: { msg: "neg" } } },
    });
    expect(r.state.cells.seen).toBe("loop:neg");
    expect(r.state.cells.after).toBe("not-run");
  });
});

// DOM-global hygiene: happy-dom's GlobalRegistrator (registered above, or by the conformance adapter's
// run()) replaces Bun's native Response/Request/Headers/fetch/URL/setTimeout/... on globalThis.
// Unregister at file end so every later file in the same `bun test` process sees Bun's natives.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
