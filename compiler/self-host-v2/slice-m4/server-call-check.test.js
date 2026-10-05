// server-call-check.test.js — s454 bootstrap unit U1b, slice S3: the Core
// restatements of the client half of a server call (design §2.6): C-S3, C-S7,
// C-S8, C-E2 extended, C12 widened. Each check is proven to BITE: a lowered
// Core is corrupted the one way the check forbids and the check fires; the
// uncorrupted Core is clean.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { NOTES, SAVE, RECOUNT } from "./server-call-fixtures.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const v = (x) => (x && typeof x === "object" ? x.variant : x);
const P = (decls, main = "") => `<program db="./app.db">\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const H = `wordCount("n1") !{ .Transport(t) :> 0 }`;
const PROGRAM = P(NOTES + "\n" + SAVE + "\n" + RECOUNT
  + `\n    function both() {\n        save()\n        recount()\n    }`
  + `\n    function branchy() {\n        if (@flag) {\n            @words = ${H}\n        }\n        @status = "done"\n    }`
  + `\n    function operand() {\n        @words = @version + (${H})\n    }`,
  `        <button onclick=save()>Save</button>\n        <button onclick={ @words = ${H} }>Count</button>`);

const core = () => {
  const r = run(PROGRAM);
  expect(r.diags.filter((d) => d.severity === "Error").map((d) => d.code + ": " + d.message)).toEqual([]);
  return structuredClone(r.core);
};
const issues = (c, tag) => mods.check.checkCore(c).filter((s) => s.startsWith(tag));
const fnOf = (c, name) => c.fns.find((f) => f.sym.hint === name);
const st = (variant, data) => ({ variant, data });

describe("S3 — the lowered client calls are well-formed Core", () => {
  test("checkCore is clean on the worked program (handlers, waiting functions, Join, ANF)", () => {
    expect(mods.check.checkCore(core())).toEqual([]);
  });
});

describe("S3 — C-S3: a ServerCall stands only as a Suspend's `on`; no client-reachable plain call of a ServerFn", () => {
  test("bite: a ServerCall evaluated in a Let (outside a Suspend's `on`)", () => {
    const c = core();
    const save = fnOf(c, "save");
    const sc = save.body.stmts[0].data.on;
    save.body.stmts.unshift(st("Let", { sym: { id: 99001, hint: "raw" }, init: sc }));
    expect(issues(c, "C-S3").length).toBeGreaterThan(0);
  });

  test("bite: a client-reachable function calls the server function as a PLAIN call", () => {
    const c = core();
    const save = fnOf(c, "save");
    const sus = save.body.stmts[0];
    save.body.stmts = [st("Eval", { e: st("Call", { callee: sus.data.on.data.fn, args: sus.data.on.data.args }) })];
    save.waits = false;
    expect(issues(c, "C-S3").join("\n")).toContain("as a plain call");
  });

  test("bite: a ServerCall naming something that is not a server function", () => {
    const c = core();
    const sus = fnOf(c, "save").body.stmts[0];
    sus.data.on.data.fn = fnOf(c, "recount").sym;
    expect(issues(c, "C-S3").join("\n")).toContain("not a server function");
  });
});

describe("S3 — C-S7: the outcome is inspected by the Attempt that begins the `then`, and read nowhere else", () => {
  test("bite: the `then` does not begin with the Attempt", () => {
    const c = core();
    const then = fnOf(c, "save").body.stmts[0].data.then.stmts;
    const at = then.shift();
    then.splice(1, 0, at);
    expect(issues(c, "C-S7").length).toBeGreaterThan(0);
  });

  test("bite: the raw outcome is read after the Attempt (it would hand a Failure to a cell)", () => {
    const c = core();
    const sus = fnOf(c, "save").body.stmts[0];
    sus.data.then.stmts.splice(1, 0, st("Eval", { e: st("Local", { sym: sus.data.bind }) }));
    expect(issues(c, "C-S7").join("\n")).toContain("raw outcome");
  });
});

describe("S3 — C-S8: Fn.waits ⟺ the body holds a Suspend; a waiting call stands only as a Suspend's `on`", () => {
  test("bite: a function that suspends is not marked `waits`", () => {
    const c = core();
    fnOf(c, "save").waits = false;
    expect(issues(c, "C-S8").join("\n")).toContain("not `waits`");
  });

  test("bite: a function marked `waits` holds no Suspend", () => {
    const c = core();
    const f = fnOf(c, "both");
    f.body.stmts = [];
    expect(issues(c, "C-S8").join("\n")).toContain("holds no Suspend");
  });

  test("bite: a waiting function's call read in place (its value arrives later)", () => {
    const c = core();
    const both = fnOf(c, "both");
    both.body.stmts.unshift(st("Eval", { e: st("Call", { callee: fnOf(c, "save").sym, args: [] }) }));
    expect(issues(c, "C-S8").join("\n")).toContain("outside a Suspend");
  });
});

describe("S3 — C-E2 extended: the Attempt over a client call handles the callee's CLIENT failure set", () => {
  test("bite: the Attempt names the declared enum (no Transport)", () => {
    const c = core();
    const at = fnOf(c, "save").body.stmts[0].data.then.stmts[0];
    const decl = c.types.find((t) => t.data.sym.hint === "SaveError").data.sym;
    at.data.err = decl;
    at.data.arms = at.data.arms.slice(0, 3).map((a) => ({ ...a, pat: st("PVariant", { enumSym: decl, idx: a.pat.data.idx, binds: a.pat.data.binds }) }));
    expect(issues(c, "C-E2").join("\n")).toContain("client failure set");
  });

  test("bite: the arms stop being total over the client set (the Transport arm dropped)", () => {
    const c = core();
    const at = fnOf(c, "save").body.stmts[0].data.then.stmts[0];
    at.data.arms = at.data.arms.slice(0, 3);
    expect(issues(c, "C-E2").join("\n")).toContain("do not cover variant #3");
  });
});

describe("S3 — C12 widened: a Suspend / Jump at the tail of a client owner's continuation; a Join before the If that ends its block", () => {
  test("bite: a statement after a Suspend in its block", () => {
    const c = core();
    fnOf(c, "save").body.stmts.push(st("Return", { e: st("Lit", { lit: "Absent" }) }));
    expect(issues(c, "C12").join("\n")).toContain("not the last statement");
  });

  test("bite: a Suspend inside an Attempt arm (no owner continuation there)", () => {
    const c = core();
    const at = fnOf(c, "save").body.stmts[0].data.then.stmts[0];
    const rec = fnOf(c, "recount").body.stmts[0];
    at.data.arms[0].body.stmts = [structuredClone(rec)];
    expect(issues(c, "C12").join("\n")).toContain("outside a client owner's continuation");
  });

  test("bite: a Join not followed by the If that ends its block", () => {
    const c = core();
    const b = fnOf(c, "branchy");
    b.body.stmts.push(st("Return", { e: st("Lit", { lit: "Absent" }) }));
    expect(issues(c, "C12").join("\n")).toContain("not immediately followed");
  });

  test("bite: a Jump naming a continuation that no enclosing If owns", () => {
    const c = core();
    const b = fnOf(c, "branchy");
    const ifs = b.body.stmts[1];
    ifs.data.elseB.stmts = [st("Jump", { k: { id: 99002, hint: "elsewhere" } })];
    expect(issues(c, "C12").join("\n")).toContain("not the Join of an enclosing If");
  });

  test("bite: a Suspend in a server function", () => {
    const c = core();
    const sf = c.server.find((s) => s.sym.hint === "wordCount");
    sf.body.stmts.push(structuredClone(fnOf(c, "recount").body.stmts[0]));
    expect(mods.check.checkCore(c).join("\n")).toContain("server function wordCount() suspends");
  });
});
