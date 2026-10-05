// server-call-runtime.test.js — s454 bootstrap unit U1b, slice S4: the
// runtime half (slice-m1/runtime/runtime.js `call` / `classify`, `suspend`,
// `waiting`, handler tasks, the deadline) and the EMPIRICAL run of the design's
// notes-editor worked program — compiled from SOURCE by the bootstrap, printed,
// and run in happy-dom with a stubbed `fetch` answering every design Item-3.2
// row (SPEC §19.9.10 "Classification").

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { join } from "node:path";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
});

// A fresh runtime module instance for the unit tests (the empirical runs load their own).
const rtUnit = await import(join(import.meta.dir, "..", "slice-m1", "runtime", "runtime.js"));

// Wire tables (codec.scrml's literal shape) for a route like the worked program's saveNote.
const INT = { defs: [], root: { k: "int" } };
const STR = { defs: [], root: { k: "str" } };
const SAVE_ERROR = {
  defs: [{ k: "enum", name: "SaveError", variants: [
    { name: "Conflict", fields: [{ name: "current", ty: { k: "int" } }] },
    { name: "TooLong", fields: [{ name: "limit", ty: { k: "int" } }] },
    { name: "Storage", fields: [] },
  ] }],
  root: { k: "ref", def: 0 },
};
const SAVE_ROUTE = { path: "/_scrml/call/24", params: [STR, STR, INT], result: INT, error: SAVE_ERROR };
const VOID_ROUTE = { path: "/_scrml/call/9", params: [], result: null, error: null };

const ok = (v) => ({ failed: rtUnit.failed(v), value: rtUnit.failed(v) ? v.error : v });
const transport = (sce) => ({ failed: true, value: { variant: "Transport", data: [sce] } });
const malformedAny = (x) => {
  expect(x.failed).toBe(true);
  expect(x.value.variant).toBe("Transport");
  expect(x.value.data[0].variant).toBe("Malformed");
  return x.value.data[0].data[0];
};

describe("S4 — `classify`: every design Item-3.2 row is a VALUE (§19.9.10 Classification, §57.4 strict)", () => {
  const c = (route, status, text) => ok(rtUnit.classify(route, status, text));
  test("200 + a body that decodes strictly against the return type → the value", () => {
    expect(c(SAVE_ROUTE, 200, "2")).toEqual({ failed: false, value: 2 });
  });
  test("204 for a function that yields no value → success (no value)", () => {
    expect(c(VOID_ROUTE, 204, "")).toEqual({ failed: false, value: null });
  });
  test("2xx anything else → Transport(Malformed): a non-decoding body, non-JSON, a body for a no-value function, 204 for a value function, an envelope on a 2xx", () => {
    malformedAny(c(SAVE_ROUTE, 200, '"two"'));
    malformedAny(c(SAVE_ROUTE, 200, "not json"));
    malformedAny(c(VOID_ROUTE, 200, "1"));
    malformedAny(c(SAVE_ROUTE, 204, ""));
    malformedAny(c(SAVE_ROUTE, 200, JSON.stringify({ __scrml_error: true, type: "SaveError", variant: "Storage", data: {} })));
  });
  test("strict, not dual: a raw `null` is not absence on an internal route (R10, canonicalOnly)", () => {
    const MAYBE = { path: "/m", params: [], result: { defs: [], root: { k: "maybe", inner: { k: "int" } } }, error: null };
    expect(c(MAYBE, 200, JSON.stringify({ __scrml_absent: true }))).toEqual({ failed: false, value: null });
    malformedAny(c(MAYBE, 200, "null"));
  });
  test("non-2xx + the callee's own §57.8 `fail` envelope → that declared variant (payload positional)", () => {
    const env = (variant, data) => JSON.stringify({ __scrml_error: true, type: "SaveError", variant, data });
    expect(c(SAVE_ROUTE, 409, env("Conflict", { current: 7 }))).toEqual({ failed: true, value: { variant: "Conflict", data: [7] } });
    expect(c(SAVE_ROUTE, 500, env("Storage", {}))).toEqual({ failed: true, value: "Storage" });
  });
  test("non-2xx + an envelope failing a check → Transport(Malformed): a foreign `type` (impl#1's CpsError), an unknown variant, bad data, a callee not declared `!`", () => {
    malformedAny(c(SAVE_ROUTE, 500, JSON.stringify({ __scrml_error: true, type: "CpsError", variant: "ServerError", data: { message: "x", fn: "f" } })));
    malformedAny(c(SAVE_ROUTE, 500, JSON.stringify({ __scrml_error: true, type: "SaveError", variant: "Nope", data: {} })));
    malformedAny(c(SAVE_ROUTE, 409, JSON.stringify({ __scrml_error: true, type: "SaveError", variant: "Conflict", data: { current: "seven" } })));
    malformedAny(c(VOID_ROUTE, 500, JSON.stringify({ __scrml_error: true, type: "X", variant: "Y", data: {} })));
  });
  test("4xx not an envelope → Transport(Refused(status)); 5xx → Transport(ServerFault(status))", () => {
    expect(c(SAVE_ROUTE, 403, "forbidden")).toEqual(transport({ variant: "Refused", data: [403] }));
    expect(c(SAVE_ROUTE, 503, "<html>down</html>")).toEqual(transport({ variant: "ServerFault", data: [503] }));
  });
  test("no server text reaches a ServerCallError: Malformed.reason is the client's own check (a foreign type name is bounded)", () => {
    const long = "X".repeat(200);
    const r = malformedAny(c(SAVE_ROUTE, 500, JSON.stringify({ __scrml_error: true, type: long, variant: "Storage", data: {} })));
    expect(r.length).toBeLessThan(200);
    expect(r).not.toContain(long);
  });
});

// A stub fetch answering with (status, text), or rejecting / hanging.
const answer = (status, text) => () => Promise.resolve({ status, text: () => Promise.resolve(text) });

describe("S4 — `call`: never rejects; the request; the deadline", () => {
  test("the request: POST to the route path, a JSON ARRAY of the arguments encoded against the parameter types (Item 3.1)", async () => {
    let seen;
    globalThis.fetch = (path, init) => { seen = { path, init }; return answer(200, "2")(); };
    const v = await rtUnit.call(SAVE_ROUTE, ["n1", "draft", 1], null);
    expect(v).toBe(2);
    expect(seen.path).toBe("/_scrml/call/24");
    expect(seen.init.method).toBe("POST");
    expect(JSON.parse(seen.init.body)).toEqual(["n1", "draft", 1]);
  });

  test("a rejected fetch → Transport(Unreachable) — resolved, never rejected", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(ok(await rtUnit.call(SAVE_ROUTE, ["n1", "x", 1], null))).toEqual(transport("Unreachable"));
  });

  test("a fetch that THROWS synchronously, and a body that cannot be read → Transport(Unreachable)", async () => {
    globalThis.fetch = () => { throw new Error("no network stack"); };
    expect(ok(await rtUnit.call(SAVE_ROUTE, ["n1", "x", 1], null))).toEqual(transport("Unreachable"));
    globalThis.fetch = () => Promise.resolve({ status: 200, text: () => Promise.reject(new Error("reset mid-body")) });
    expect(ok(await rtUnit.call(SAVE_ROUTE, ["n1", "x", 1], null))).toEqual(transport("Unreachable"));
  });

  test("THE DEADLINE (§19.9.10 S454): a hung server → Transport(Unreachable) when SERVER_CALL_DEADLINE_MS passes", async () => {
    expect(rtUnit.SERVER_CALL_DEADLINE_MS).toBe(30000);     // the PA placeholder — the value is not ruled
    const timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    globalThis.fetch = () => new Promise(() => {});          // never answers
    const p = rtUnit.call(SAVE_ROUTE, ["n1", "x", 1], null);
    expect(timers.map((t) => t.ms)).toEqual([30000]);
    timers[0].fn();                                          // the deadline passes
    expect(ok(await p)).toEqual(transport("Unreachable"));
  });

  test("an answer before the deadline wins; the deadline firing later changes nothing", async () => {
    const timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    globalThis.fetch = answer(200, "5");
    const v = await rtUnit.call(SAVE_ROUTE, ["n1", "x", 1], null);
    timers[0].fn();
    expect(v).toBe(5);
  });
});

describe("S4 — `suspend`: one batch, one reporter, cancellation drops", () => {
  const owner = () => ({ settledN: 0, settled() { this.settledN++; } });
  const newTask = (o) => ({ owner: o, cancelled: false, pending: 0, cancel() { this.cancelled = true; } });

  test("the continuation's two writes flush ONCE (it runs inside `batch`)", async () => {
    const a = rtUnit.cell(0);
    const b = rtUnit.cell(0);
    let runs = 0;
    rtUnit.effect(rtUnit.root, () => { a.get(); b.get(); runs++; });
    const before = runs;
    const t = newTask(owner());
    rtUnit.suspend(t, Promise.resolve(1), () => { a.set(1); b.set(1); });
    await new Promise((r) => realSetTimeout(r, 0));
    expect(runs - before).toBe(1);
  });

  test("a host error thrown in a continuation goes to the ONE reporter — no unhandled rejection", async () => {
    const seen = [];
    const prev = rtUnit.setHostErrorReporter((e) => seen.push(String(e.message)));
    try {
      const t = newTask(owner());
      rtUnit.suspend(t, Promise.resolve(1), () => { throw new Error("a scrml bug"); });
      rtUnit.suspend(newTask(owner()), Promise.reject(new Error("rejected value")), () => {});
      await new Promise((r) => realSetTimeout(r, 0));
      expect(seen).toEqual(["a scrml bug", "rejected value"]);
    } finally {
      rtUnit.setHostErrorReporter(prev);
    }
  });

  test("a cancelled task's continuation never runs (nothing aborts the call — its result is dropped)", async () => {
    const t = newTask(owner());
    let ran = false;
    rtUnit.suspend(t, Promise.resolve(1), () => { ran = true; });
    t.cancel();
    await new Promise((r) => realSetTimeout(r, 0));
    expect(ran).toBe(false);
  });

  test("handler tasks: each invocation gets its own task; tearing the scope down cancels the live ones (their continuations never run)", async () => {
    const scope = rtUnit.root.child();
    const el = document.createElement("button");
    const tasks = [];
    let ran = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    rtUnit.on(scope, el, "click", (task) => { tasks.push(task); rtUnit.suspend(task, gate, () => { ran++; }); });
    el.dispatchEvent(new window.MouseEvent("click"));
    el.dispatchEvent(new window.MouseEvent("click"));
    expect(tasks.length).toBe(2);
    expect(tasks[0]).not.toBe(tasks[1]);
    expect(tasks[0].cancelled).toBe(false);                 // the second event did not cancel the first
    scope.dispose();
    expect(tasks.every((t) => t.cancelled)).toBe(true);
    release(1);
    await new Promise((r) => realSetTimeout(r, 0));
    expect(ran).toBe(0);
  });

  test("`waiting`: the body's ret$ settles the Promise — also from a continuation", async () => {
    const t = newTask(owner());
    const p = rtUnit.waiting((ret) => { rtUnit.suspend(t, Promise.resolve(41), (v) => ret(v + 1)); });
    expect(await p).toBe(42);
  });
});

// =============================================================================
// THE EMPIRICAL RUN — the design's worked program, compiled by the bootstrap.
// =============================================================================
const SQ = "?" + "{";
// The design's notes editor (Item 1, Approach B: `save()` + `recount()`), adapted
// to the bootstrap (progress.md lists each adaptation): the queries' rows are not
// read (no row types); a declared variant's payload is recorded in `@seen`
// (scrml has no implicit string + int); `callProblem`'s inner `match t` is
// replaced by recording `t` in `@cause` (no `match` over a non-failable value —
// the §18 match unit).
const NOTES_SRC = `<program db="./notes.db">
    type SaveError:enum = {
        Conflict(current: int)
        TooLong(limit: int)
        Storage
    }
    let <body:string="draft"/>
    let <version:int=1/>
    let <words:int=0/>
    let <seen:int=0/>
    let <status:string=""/>
    let <cause:ServerCallError=.Unreachable/>

    function saveNote(id: string, text: string, base: int)! SaveError {
        if (text.length > 10000) fail .TooLong(10000)
        ${SQ}\`UPDATE notes SET body = \${text}, version = \${base + 1} WHERE id = \${id}\`}.run() !{ _ :> { fail .Storage } }
        return base + 1
    }

    function wordCount(id: string) -> int {
        const row = ${SQ}\`SELECT body FROM notes WHERE id = \${id}\`}.get() !{ _ :> not }
        return 0
    }

    function save() {
        @status = "saving"
        @version = saveNote("n1", @body, @version) !{
            .Conflict(cur) :> { @status = "conflict"; @seen = cur; return }
            .TooLong(n)    :> { @status = "too long"; @seen = n; return }
            .Storage       :> { @status = "the server could not store it"; return }
            .Transport(t)  :> { @status = "transport"; @cause = t; return }
        }
        @status = "saved"
    }

    function recount() {
        @words = wordCount("n1") !{ .Transport(t) :> @words }
    }

    function touch(id: string) {
        ${SQ}\`UPDATE notes SET seen = 1 WHERE id = \${id}\`}.run() !{ _ :> {} }
    }

    function stamp() {
        touch("n1") !{ .Transport(t) :> { @status = "stamp failed"; @cause = t; return } }
        @status = "stamped"
    }

    <main>
        <button id="save" onclick=save()>Save</button>
        <button id="stamp" onclick=stamp()>Stamp</button>
        <button id="recount" onclick=recount()>Count</button>
        <p id="status">\${@status}</p>
        <p id="version">\${@version}</p>
        <p id="words">\${@words}</p>
    </main>
</program>
`;

const settle = () => new Promise((r) => realSetTimeout(r, 0)).then(() => new Promise((r) => realSetTimeout(r, 0)));
let loads = 0;

async function loadNotes() {
  const r = frontEnd(mods, [{ path: "notes.scrml", src: NOTES_SRC }]);
  expect(r.diags.filter((d) => d.severity === "Error").map((d) => d.code + ": " + d.message)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  const loaded = await loadProgram(r.core, "notes-" + loads++);
  const program = () => [...loaded.rt.devtools.instances.values()].find((i) => i.decl.name === "program");
  const cells = () => loaded.rt.snapshot(program());
  return { ...loaded, cells };
}

// The Item-3.2 rows, as the stub server answers them.
const env = (variant, data) => JSON.stringify({ __scrml_error: true, type: "SaveError", variant, data });
const ROWS = [
  { row: "200 + a decodable body", fetch: answer(200, "2"), status: "saved", version: 2 },
  { row: "2xx + a body that does not decode (a string for an int)", fetch: answer(200, '"two"'), status: "transport", cause: "Malformed" },
  { row: "2xx + a `__scrml_error` envelope (a fail on a success status)", fetch: answer(200, env("Storage", {})), status: "transport", cause: "Malformed" },
  { row: "non-2xx + the declared envelope: Conflict(current: 7)", fetch: answer(409, env("Conflict", { current: 7 })), status: "conflict", seen: 7 },
  { row: "non-2xx + the declared envelope: Storage (unit)", fetch: answer(500, env("Storage", {})), status: "the server could not store it" },
  { row: "non-2xx + a FOREIGN envelope (impl#1's CpsError)", fetch: answer(500, JSON.stringify({ __scrml_error: true, type: "CpsError", variant: "ServerError", data: { message: "boom", fn: "saveNote" } })), status: "transport", cause: "Malformed" },
  { row: "4xx, not an envelope (a CSRF / auth refusal)", fetch: answer(403, "forbidden"), status: "transport", cause: { variant: "Refused", data: [403] } },
  { row: "5xx, not an envelope (an exception on the server)", fetch: answer(500, "Internal Server Error"), status: "transport", cause: { variant: "ServerFault", data: [500] } },
  { row: "fetch rejects (offline)", fetch: () => Promise.reject(new TypeError("Failed to fetch")), status: "transport", cause: "Unreachable" },
];

describe("EMPIRICAL — the notes editor, compiled by the bootstrap, each Item-3.2 row handled", () => {
  for (const r of ROWS) {
    test(`save() — ${r.row} → status "${r.status}"`, async () => {
      const { cells } = await loadNotes();
      globalThis.fetch = r.fetch;
      document.querySelector("#save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(document.querySelector("#status").textContent).toBe("saving");     // the handler ran up to the suspension
      await settle();
      expectNoPageErrors();
      const c = cells();
      expect(c.status).toBe(r.status);
      expect(document.querySelector("#status").textContent).toBe(r.status);
      if (r.version !== undefined) expect(c.version).toBe(r.version);
      else expect(c.version).toBe(1);                                         // a failure writes nothing
      if (r.seen !== undefined) expect(c.seen).toBe(r.seen);
      if (r.cause !== undefined) {
        if (typeof r.cause === "string" && r.cause === "Malformed") expect(c.cause.variant).toBe("Malformed");
        else expect(c.cause).toEqual(r.cause);
      }
    });
  }

  test("save() — the DEADLINE passes with no answer → Transport(Unreachable)", async () => {
    const { cells, rt } = await loadNotes();
    const timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return realSetTimeout(() => {}, 0); };
    globalThis.fetch = () => new Promise(() => {});
    document.querySelector("#save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const deadline = timers.find((t) => t.ms === rt.SERVER_CALL_DEADLINE_MS);
    expect(deadline).toBeDefined();
    globalThis.setTimeout = realSetTimeout;
    deadline.fn();
    await settle();
    expect(cells().status).toBe("transport");
    expect(cells().cause).toBe("Unreachable");
  });

  test("recount() — a non-`!` server function: 200 writes the count; a failure keeps the old one (`.Transport(t) :> @words`)", async () => {
    const { cells } = await loadNotes();
    globalThis.fetch = answer(200, "12");
    document.querySelector("#recount").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();
    expect(cells().words).toBe(12);
    globalThis.fetch = answer(503, "down");
    document.querySelector("#recount").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();
    expect(cells().words).toBe(12);
    expect(document.querySelector("#words").textContent).toBe("12");
  });

  test("stamp() — a server function that yields NO value: 204 → success; a 200 with a body → Transport(Malformed) (the 204 contract)", async () => {
    const { cells, out } = await loadNotes();
    expect(out.routes.find((r) => r.fn === "touch").value).toBe(false);
    globalThis.fetch = answer(204, "");
    document.querySelector("#stamp").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();
    expect(cells().status).toBe("stamped");
    globalThis.fetch = answer(200, "1");
    document.querySelector("#stamp").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();
    expect(cells().status).toBe("stamp failed");
    expect(cells().cause.variant).toBe("Malformed");
  });

  test("a second click does NOT cancel the first (handler tasks are per invocation — design §2.3 reading)", async () => {
    const { cells } = await loadNotes();
    const pending = [];
    globalThis.fetch = () => new Promise((res) => pending.push(res));
    const click = () => document.querySelector("#recount").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    click();
    click();
    expect(pending.length).toBe(2);
    pending[0]({ status: 200, text: () => Promise.resolve("3") });
    await settle();
    expect(cells().words).toBe(3);
    pending[1]({ status: 200, text: () => Promise.resolve("4") });
    await settle();
    expect(cells().words).toBe(4);
  });

  test("the printed client artifact: no server function body, no SQL, no database path; the route manifest names both calls", async () => {
    const { out } = await loadNotes();
    expect(out.js).not.toContain("UPDATE notes");
    expect(out.js).not.toContain("notes.db");
    expect(out.js).not.toContain("function saveNote");
    expect(out.routes.map((r) => r.fn).sort()).toEqual(["saveNote", "touch", "wordCount"]);
    expect(out.js).toContain("rt.call(route$saveNote, [");
  });
});
