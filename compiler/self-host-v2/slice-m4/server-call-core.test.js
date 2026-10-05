// server-call-core.test.js — s454 bootstrap unit U1b, slice S2: Core
// (Expr.ServerCall, Failable.FSettled, Suspend in client owners, Join / Jump,
// Fn.waits), the site judgement (SPEC §19.9.10 F5 a — "remote" is a
// whole-program placement fact) and the lowering positions (design §2.2).
// Governing sentences: docs/changes/s454-bootstrap-u1b/progress.md.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const v = (x) => (x && typeof x === "object" ? x.variant : x);
const SQ = "?" + "{";
const P = (decls, main = "") => `<program db="./app.db">\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const fnInfo = (r, name) => r.typed.tables.fns.find((f) => f.name === name);
const fnCore = (r, name) => r.core.fns.find((f) => f.sym.hint === name);
const errCodes = (src) => run(src).diags.filter((d) => d.severity === "Error").map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.filter((d) => d.severity === "Error").map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  return r;
};

export const NOTES = `    type SaveError:enum = {
        Conflict(current: int)
        TooLong(limit: int)
        Storage
    }
    let <body:string=""/>
    let <version:int=0/>
    let <words:int=0/>
    let <status:string=""/>
    let <flag:boolean=false/>
    function saveNote(id: string, text: string, base: int)! SaveError {
        if (text.length > 10000) fail .TooLong(10000)
        ${SQ}\`UPDATE notes SET body = \${text} WHERE id = \${id}\`}.run() !{ _ :> { fail .Storage } }
        return base + 1
    }
    function wordCount(id: string) -> int {
        const row = ${SQ}\`SELECT body FROM notes WHERE id = \${id}\`}.get() !{ _ :> not }
        return 0
    }`;
export const SAVE = `    function save() {
        @version = saveNote("n1", @body, @version) !{
            .Conflict(cur) :> { @status = "edited elsewhere"; return }
            .TooLong(n)    :> { @status = "too long"; return }
            .Storage       :> { @status = "could not store"; return }
            .Transport(t)  :> { @status = "transport"; return }
        }
        @status = "saved"
    }`;
export const RECOUNT = `    function recount() {
        @words = wordCount("n1") !{ .Transport(t) :> @words }
    }`;

describe("S2 — the worked program lowers to Suspend → Attempt(FSettled) (design §2.1)", () => {
  test("save(): ServerCall(saveNote, args) is a Suspend's `on`; its `then` begins with the Attempt over the settled outcome", () => {
    const r = clean(P(NOTES + "\n" + SAVE));
    const f = fnCore(r, "save");
    expect(f.waits).toBe(true);
    expect(f.body.stmts.length).toBe(1);
    const sus = f.body.stmts[0];
    expect(v(sus)).toBe("Suspend");
    expect(v(sus.data.on)).toBe("ServerCall");
    expect(sus.data.on.data.fn.hint).toBe("saveNote");
    expect(sus.data.on.data.args.length).toBe(3);
    const then = sus.data.then.stmts;
    expect(v(then[0])).toBe("Attempt");
    expect(v(then[0].data.call)).toBe("FSettled");
    expect(then[0].data.call.data.outcome.id).toBe(sus.data.bind.id);       // C-S7: the bind, read only there
    expect(then[0].data.err.hint).toBe("SaveError + Transport");
    expect(then[0].data.arms.map((a) => a.pat.data.idx)).toEqual([0, 1, 2, 3]);
    expect(then.slice(1).map(v)).toEqual(["Write", "Write", "Return"]);    // the rest of the body IS the continuation
    expect(r.core.serverCallError.hint).toBe("ServerCallError");
    expect(r.core.types.map((t) => t.data.sym.hint)).toContain("SaveError + Transport");
  });

  test("the `!` callee's wire type is the success type its returns prove (§19.4.1 / §19.4.2 — no annotation slot)", () => {
    const r = clean(P(NOTES + "\n" + SAVE));
    const sf = r.core.server.find((s) => s.sym.hint === "saveNote");
    expect(v(sf.ret)).toBe("Int");
  });

  test("recount(): a callee not declared `!` — the Attempt handles the shared `Transport` enum", () => {
    const r = clean(P(NOTES + "\n" + RECOUNT));
    const at = fnCore(r, "recount").body.stmts[0].data.then.stmts[0];
    expect(at.data.err.hint).toBe("Transport");
    expect(at.data.arms.length).toBe(1);
  });

  test("a handler calling a waiting client function suspends on it (`on: Call(save)`, no Attempt — save is not `!`)", () => {
    const r = clean(P(NOTES + "\n" + SAVE, `        <button onclick=save()>Save</button>`));
    const views = JSON.stringify(r.core.decls[0].renders);
    expect(views).toContain('"variant":"Suspend"');
    expect(views).toContain('"variant":"Call"');
  });

  test("two waiting calls in a row nest: the second is the first's continuation (source order, F6)", () => {
    const r = clean(P(NOTES + "\n" + SAVE + "\n" + RECOUNT + `\n    function both() {\n        save()\n        recount()\n    }`));
    const b = fnCore(r, "both");
    expect(b.waits).toBe(true);
    const s1 = b.body.stmts[0];
    expect(v(s1)).toBe("Suspend");
    expect(s1.data.on.data.callee.hint).toBe("save");
    const s2 = s1.data.then.stmts[0];
    expect(v(s2)).toBe("Suspend");
    expect(s2.data.on.data.callee.hint).toBe("recount");
    expect(s2.data.then.stmts.map(v)).toEqual(["Return"]);
  });

  test("a client function that waits for nothing is not `waits`", () => {
    const r = clean(P(NOTES + `\n    function plain() {\n        @status = "x"\n    }`));
    expect(fnCore(r, "plain").waits).toBe(false);
  });
});

describe("S2 — §19.9.10 the client call is failable: E-ERROR-002, totality, `?` + E-ERROR-010", () => {
  test("an unhandled client call in a function body: E-ERROR-002 naming the wire", () => {
    const src = P(NOTES + `\n    function go() {\n        @words = wordCount("n1")\n    }`);
    expect(errCodes(src)).toEqual(["E-ERROR-002"]);
    expect(run(src).diags.find((d) => d.code === "E-ERROR-002").message).toContain("Transport");
  });

  test("an unhandled client call in an event handler, and a handler REFERENCE to a server function: E-ERROR-002", () => {
    expect(errCodes(P(NOTES, `        <button onclick={ wordCount("n1") }>c</button>`))).toEqual(["E-ERROR-002"]);
    const ref = P(NOTES + `\n    function ping() {\n        const r = ${SQ}\`SELECT 1\`}.get() !{ _ :> not }\n    }`, `        <button onclick=ping>c</button>`);
    expect(errCodes(ref)).toEqual(["E-ERROR-002"]);
  });

  test("a handler that names only the declared variants is NOT total on the client — E-TYPE-080 names Transport", () => {
    const src = P(NOTES + `\n    function go() {\n        saveNote("n1", "x", 1) !{\n            .Conflict(c) :> { @status = "c" }\n            .TooLong(n) :> { @status = "l" }\n            .Storage :> { @status = "s" }\n        }\n    }`);
    expect(errCodes(src)).toEqual(["E-TYPE-080"]);
    expect(run(src).diags.find((d) => d.code === "E-TYPE-080").message).toContain("Transport");
  });

  test("a catch-all `_ :>` / `_ err :>` covers the transport half (the S451 interim advice stays valid)", () => {
    clean(P(NOTES + `\n    function go() {\n        saveNote("n1", "x", 1) !{ _ :> { @status = "failed" } }\n    }`));
    clean(P(NOTES + `\n    function go() {\n        saveNote("n1", "x", 1) !{ _ err :> { @status = "failed" } }\n    }`));
  });

  test("`?` needs `Transport(t: ServerCallError)` in the enclosing enum — else E-ERROR-010 naming the line to add (SPEC wording)", () => {
    const E = `\n    type SyncError:enum = {\n        Conflict(current: int)\n        TooLong(limit: int)\n        Storage\n    }\n    function sync()! SyncError {\n        @version = saveNote("n1", @body, @version)?\n    }`;
    const src = P(NOTES + E);
    expect(errCodes(src)).toEqual(["E-ERROR-010"]);
    const m = run(src).diags.find((d) => d.code === "E-ERROR-010").message;
    expect(m).toContain("`saveNote` is a server function: a call to it from the client can also fail on the wire. Add `Transport(t: ServerCallError)` to `SyncError`");
  });

  test("with the wrapper declared, `?` re-fails every variant of the client set — the four retags", () => {
    const E = `\n    type SyncError:enum = {\n        Conflict(current: int)\n        TooLong(limit: int)\n        Storage\n        Transport(t: ServerCallError)\n    }\n    function sync()! SyncError {\n        @version = saveNote("n1", @body, @version)?\n        @words = wordCount("n1")?\n    }`;
    const r = clean(P(NOTES + E));
    const s1 = fnCore(r, "sync").body.stmts[0];
    const at = s1.data.then.stmts[0];
    expect(at.data.arms.map((a) => [a.pat.data.idx, a.body.stmts[0].data.idx])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    // the non-`!` callee: `?` on a failable call (no E-ERROR-004) — its one variant re-fails as Transport
    const s2 = s1.data.then.stmts.find((x) => v(x) === "Suspend");
    const at2 = s2.data.then.stmts[0];
    expect(at2.data.err.hint).toBe("Transport");
    expect(at2.data.arms.map((a) => a.body.stmts[0].data.idx)).toEqual([3]);
  });
});

describe("S2 — §19.9.10 F5 (a): \"remote\" is a whole-program placement fact", () => {
  test("server→server (the caller's own body places it on the server): a non-`!` callee's call needs no handling", () => {
    clean(P(NOTES + `\n    function srv(id: string) -> int {\n        const r = ${SQ}\`SELECT 1\`}.get() !{ _ :> not }\n        return wordCount(id)\n    }`));
  });

  test("server→server: a `!{}` on a non-`!` callee is E-ERROR-013 (\"the whole handler is attached to a call that cannot fail\")", () => {
    const src = P(NOTES + `\n    function srv(id: string) -> int {\n        const r = ${SQ}\`SELECT 1\`}.get() !{ _ :> not }\n        const n = wordCount(id) !{ .Transport(t) :> 0 }\n        return n\n    }`);
    expect(errCodes(src)).toContain("E-ERROR-013");
    expect(run(src).diags.find((d) => d.code === "E-ERROR-013").message).toContain("server→server");
  });

  test("Trigger 5: a helper called ONLY from server functions is server-placed — its call is server→server, valid unhandled; the client artifact omits it", () => {
    const src = P(NOTES + `\n    function helper(id: string) -> int {\n        return wordCount(id)\n    }\n    function srv(id: string) -> int {\n        const r = ${SQ}\`SELECT 1\`}.get() !{ _ :> not }\n        return helper(id)\n    }`);
    const r = clean(src);
    expect(r.typed.tables.server.inherited).toContain(fnInfo(r, "helper").sym.id);
    expect(fnCore(r, "helper").waits).toBe(false);
    expect(v(fnCore(r, "helper").body.stmts[0].data.e)).toBe("Call");       // a plain call, in place
    const out = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js");
    expect(out.js).not.toContain("function helper");
  });

  test("Trigger 5: a `!` callee's `.Transport` arm in an inherited helper handles nothing — reported as dead handling (E-ERROR-013 manner)", () => {
    const src = P(NOTES + `\n    function helper(id: string) -> int {\n        const n = saveNote(id, "x", 1) !{\n            .Transport(t) :> 0\n            _ :> 1\n        }\n        return n\n    }\n    function srv(id: string) -> int {\n        const r = ${SQ}\`SELECT 1\`}.get() !{ _ :> not }\n        return helper(id)\n    }`);
    const d = run(src).diags.find((x) => x.code === "E-ERROR-013");
    expect(d).toBeDefined();
    expect(d.message).toContain("`.Transport` arm handles nothing");
    expect(d.message).toContain("server→server");
  });

  test("the flip: a client caller makes the helper client-placed — E-ERROR-002 inside it NAMES that caller (file:line)", () => {
    const src = P(NOTES + `\n    function helper(id: string) -> int {\n        return wordCount(id)\n    }\n    function srv(id: string) -> int {\n        const r = ${SQ}\`SELECT 1\`}.get() !{ _ :> not }\n        return helper(id)\n    }\n    function refresh() {\n        @words = helper("n1")\n    }`);
    const d = run(src).diags.find((x) => x.code === "E-ERROR-002");
    expect(d).toBeDefined();
    const line = src.split("\n").findIndex((l) => l.includes('@words = helper("n1")')) + 1;
    expect(d.message).toContain("`refresh()` calls it (t.scrml:" + line + ")");
    expect(d.message).toContain("Trigger 5");
  });

  test("a value position is E-VALUE-SERVER-CALL alone — \"not reported a second time as E-ERROR-002\"", () => {
    expect(errCodes(P(NOTES, `        <p>\${wordCount("n1")}</p>`))).toEqual(["E-VALUE-SERVER-CALL"]);
  });

  test("a server function calling a client function that waits → refused (an ambient function emitted per side is U1c)", () => {
    const src = P(NOTES + "\n" + RECOUNT + `\n    function srv() -> int {\n        const r = ${SQ}\`SELECT 1\`}.get() !{ _ :> not }\n        recount()\n        return 1\n    }`);
    const d = run(src).diags.find((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED");
    expect(d).toBeDefined();
    expect(d.message).toContain("U1c");
  });
});

describe("S2 — design §2.2 positions: lowered (ANF, Join) / refused (named)", () => {
  const H = `wordCount("n1") !{ .Transport(t) :> 0 }`;
  test("an operand: everything evaluated before the call becomes a temporary (left-to-right kept)", () => {
    const r = clean(P(NOTES + `\n    function go() {\n        @words = @version + (${H})\n    }`));
    const st = fnCore(r, "go").body.stmts;
    expect(st.map(v)).toEqual(["Let", "Suspend"]);
    const tmp = st[0].data.sym;
    const w = st[1].data.then.stmts[1];
    expect(v(w)).toBe("Write");
    expect(w.data.value.data.args[0].data.sym.id).toBe(tmp.id);
  });

  test("a call argument: the earlier argument is a temporary, a literal is not", () => {
    const r = clean(P(NOTES + `\n    function sum(a: int, b: int, c: int) -> int {\n        return a + b + c\n    }\n    function go() {\n        @words = sum(@version, ${H}, 2)\n    }`));
    const st = fnCore(r, "go").body.stmts;
    expect(st.map(v)).toEqual(["Let", "Suspend"]);
  });

  test("inside an `if` branch with statements after it: a Join, each branch ends in Jump(k)", () => {
    const r = clean(P(NOTES + `\n    function go() {\n        if (@flag) {\n            @words = ${H}\n        }\n        @status = "done"\n    }`));
    const st = fnCore(r, "go").body.stmts;
    expect(st.map(v)).toEqual(["Join", "If"]);
    const k = st[0].data.k;
    expect(st[0].data.body.stmts.map(v)).toEqual(["Write", "Return"]);
    const sus = st[1].data.thenB.stmts[0];
    expect(v(sus)).toBe("Suspend");
    const tail = sus.data.then.stmts[sus.data.then.stmts.length - 1];
    expect(v(tail)).toBe("Jump");
    expect(tail.data.k.id).toBe(k.id);
    expect(st[1].data.elseB.stmts.map(v)).toEqual(["Jump"]);
  });

  const refused = (body, word) => {
    const src = P(NOTES + `\n    function go() {\n${body}\n    }`);
    const d = run(src).diags.filter((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED");
    expect(d.length).toBeGreaterThan(0);
    expect(d.map((x) => x.message).join("\n")).toContain(word);
  };
  test("the right operand of `&&` → refused, naming the follow-up", () => refused(`        const ok = @flag && (${H} > 0)`, "right operand"));
  test("a ternary branch → refused", () => refused(`        @words = @flag ? (${H}) : 0`, "branch of `? :`"));
  test("a `!{}` arm → refused (first cut)", () => refused(`        saveNote("n1", "x", 1) !{ _ :> { @words = ${H} } }`, "arm"));
  test("a lambda → refused (awaited combinator)", () => refused(`        const xs = [1, 2].map(x => ${H})`, "lambda"));
  test("a `defer` body → refused (C16)", () => refused(`        defer {\n            @words = ${H}\n        }`, "`defer` body"));
  test("a `defer` in a function that waits → refused (§19.16.2 exit timing)", () => refused(`        defer {\n            @status = "x"\n        }\n        @words = ${H}`, "function that waits"));
});
