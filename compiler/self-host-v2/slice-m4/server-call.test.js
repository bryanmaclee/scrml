// server-call.test.js — s454 bootstrap unit U1b: the CLIENT half of a call
// from client code to a server function (SPEC §19.9.10 as amended S454, §19.9.5,
// §19.4.3, §19.5.3, §13.7, §57.8). Design authority:
// scrml-support/docs/deep-dives/bootstrap-u1b-client-server-call-design-2026-10-04.md
// (Item 1 B, Items 2–5). Governing sentences + readings:
// docs/changes/s454-bootstrap-u1b/progress.md.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const v = (x) => (x && typeof x === "object" ? x.variant : x);
const SQ = "?" + "{";   // the sigil, for building sources in JS strings
const P = (decls, main = "") => `<program db="./app.db">\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;

// A TypeInfo by name, and its enum variants as `Name(field: <type variant>)` strings.
const typeNamed = (r, name) => r.typed.tables.types.find((t) => t.name === name);
const variantsOf = (ti) =>
  ti.def.data.variants.map((vd) =>
    vd.sym.hint + (vd.fields.length === 0 ? "" : "(" + vd.fields.map((f) => f.sym.hint + ": " + (v(f.ty) === "Named" ? f.ty.data.sym.hint : v(f.ty))).join(", ") + ")"));
const fnInfo = (r, name) => r.typed.tables.fns.find((f) => f.name === name);

const SAVE_ERROR = `    type SaveError:enum = {\n        Conflict(current: int)\n        TooLong(limit: int)\n        Storage\n    }`;
const SAVE_NOTE = `    function saveNote(id: string, text: string, base: int)! SaveError {\n        ${SQ}\`UPDATE notes SET body = \${text} WHERE id = \${id}\`}.run()\n        return base + 1\n    }`;
const WORD_COUNT = `    function wordCount(id: string) -> int {\n        const row = ${SQ}\`SELECT body FROM notes WHERE id = \${id}\`}.get() !{ _ :> not }\n        return 0\n    }`;

describe("S1 — §19.9.10 the built-in `ServerCallError`", () => {
  test("it is a built-in enum with the four S454 variants and their payloads", () => {
    const r = run(P(""));
    const sce = typeNamed(r, "ServerCallError");
    expect(sce).toBeDefined();
    expect(sce.file).toBe("scrml:builtin");
    expect(variantsOf(sce)).toEqual(["Unreachable", "Refused(status: Int)", "ServerFault(status: Int)", "Malformed(reason: Str)"]);
  });

  test("\"the developer SHALL NOT redefine it\" — a user `ServerCallError` is refused", () => {
    expect(codes(P(`    type ServerCallError:enum = {\n        Down\n    }`))).toContain("E-BOOTSTRAP-REDECLARE");
  });

  test("a program with no server function ships no ServerCallError in Core (a built-in ships when Core names it)", () => {
    const r = run(P(""));
    expect(r.core.types.map((t) => t.data.sym.hint)).not.toContain("ServerCallError");
  });
});

describe("S1 — §19.9.10 the failure enum of a client call (Item 1 B: minted `E + Transport`, shared `Transport`)", () => {
  test("a `! SaveError` server function: SaveError's variants FIRST, then ONE `Transport(t: ServerCallError)`", () => {
    const r = run(P(SAVE_ERROR + "\n" + SAVE_NOTE));
    const f = fnInfo(r, "saveNote");
    expect(f.serverOwn).toBe(true);
    const rt = r.typed.tables.types.find((t) => t.def.data.sym.id === f.rerr.id);
    expect(rt.name).toBe("SaveError + Transport");
    expect(variantsOf(rt)).toEqual(["Conflict(current: Int)", "TooLong(limit: Int)", "Storage", "Transport(t: ServerCallError)"]);
    // fresh Syms: no variant Sym is shared with SaveError's own (one declaration site per Sym)
    const own = typeNamed(r, "SaveError").def.data.variants.map((x) => x.sym.id);
    expect(rt.def.data.variants.some((x) => own.includes(x.sym.id))).toBe(false);
  });

  test("a server function NOT declared `!` fails at a client site with `Transport` alone — one shared enum", () => {
    const WC2 = WORD_COUNT.replace(/wordCount/g, "lineCount");
    const r = run(P(WORD_COUNT + "\n" + WC2));
    const a = fnInfo(r, "wordCount");
    const b = fnInfo(r, "lineCount");
    expect(a.rerr.id).toBe(b.rerr.id);
    const rt = r.typed.tables.types.find((t) => t.def.data.sym.id === a.rerr.id);
    expect(variantsOf(rt)).toEqual(["Transport(t: ServerCallError)"]);
  });

  test("two server functions declared with ONE enum share ONE minted enum", () => {
    const S2 = SAVE_NOTE.replace("saveNote", "saveDraft");
    const r = run(P(SAVE_ERROR + "\n" + SAVE_NOTE + "\n" + S2));
    expect(fnInfo(r, "saveNote").rerr.id).toBe(fnInfo(r, "saveDraft").rerr.id);
    expect(r.typed.tables.types.filter((t) => t.name === "SaveError + Transport").length).toBe(1);
  });

  test("\"a variant `Transport` whose payload is exactly `(t: ServerCallError)` … IS the wrapper\" — no mint, the enum itself", () => {
    const E = `    type SyncError:enum = {\n        Storage\n        Transport(t: ServerCallError)\n    }`;
    const F = SAVE_NOTE.replace("SaveError", "SyncError");
    const r = run(P(E + "\n" + F));
    const f = fnInfo(r, "saveNote");
    expect(f.rerr.id).toBe(typeNamed(r, "SyncError").def.data.sym.id);
    expect(r.typed.tables.types.some((t) => t.name.endsWith("+ Transport"))).toBe(false);
  });

  test("a client function (no server trigger of its own) has no client-call failure enum", () => {
    const r = run(P(`    function local(n: int) -> int {\n        return n + 1\n    }`));
    expect(fnInfo(r, "local").serverOwn).toBe(false);
    expect(fnInfo(r, "local").rerr).toBe(null);
  });
});

describe("S1 — E-ERROR-016 (§19.9.10 \"A declared variant named `Transport`\")", () => {
  const BAD = `    type SaveError:enum = {\n        Storage\n        Transport(code: int)\n    }`;
  test("a declared `Transport` of another payload, called from the client: E-ERROR-016 at the call site, naming f, its enum, the payload", () => {
    const src = P(BAD + "\n" + SAVE_NOTE, `        <button onclick={ saveNote("n1", "x", 1) !{ _ :> {} } }>Save</button>`);
    const r = run(src);
    const d = r.diags.find((x) => x.code === "E-ERROR-016");
    expect(d).toBeDefined();
    expect(src.slice(d.span.start, d.span.end)).toContain("saveNote(");
    expect(d.message).toContain("saveNote");
    expect(d.message).toContain("SaveError");
    expect(d.message).toContain("Transport(t: ServerCallError)");
    expect(d.severity).toBe("Error");
    expect(fnInfo(r, "saveNote").rerr).toBe(null);
  });

  test("a `Transport` with NO payload is \"any other payload (or none)\" — E-ERROR-016 too", () => {
    const NONE = `    type SaveError:enum = {\n        Storage\n        Transport\n    }`;
    expect(codes(P(NONE + "\n" + SAVE_NOTE, `        <button onclick={ saveNote("n1", "x", 1) !{ _ :> {} } }>Save</button>`))).toContain("E-ERROR-016");
  });

  test("the same enum on a server function nobody calls from the client: no E-ERROR-016 (it fires at a CLIENT call site)", () => {
    expect(codes(P(BAD + "\n" + SAVE_NOTE))).not.toContain("E-ERROR-016");
  });
});
