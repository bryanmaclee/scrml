/**
 * E-SESSION-AMBIENT-SERVER — a server-context `@session` read is a compile error
 * (§6.6.9 / §20.5; ruling:user-voice-scrml.md S449 "RULED — 'your recs.'" item 1,
 * interim; closes g-session-ambient-unlowered-trust-boundary-inversion).
 *
 * Before S449 every server lowering of `@session.<field>` read the CLIENT request
 * body (`_scrml_body["session"].<field>`), so a caller could write any identity —
 * MEASURED: an authenticated POST `{"body":"spoofed","session":{"userId":"victim"}}`
 * answered 200 and wrote the row with sid "victim". §6.6.9: "`@session` is
 * server-only identity and SHALL NEVER be marshalled from the client".
 *
 * Covered here:
 *   - the front-end refusal on every server context (wholly-server fn, CPS-split fn,
 *     SSE generator, a function nested in a server fn, a `<cell server>` load
 *     query, no-auth programs, bare `@session`), and its message names the fix;
 *   - nothing reads the request body for `@session` in the emitted server;
 *   - client `@session` (the §20.5 projection) still compiles;
 *   - a file's own `<session>` cell keeps ordinary cell semantics (E-REACTIVE-003);
 *   - the codegen backstop (server-session-guard.ts) on every lowering path;
 *   - the migrated `session.<field>` form writes the REAL session's id over HTTP,
 *     whatever the body claims.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";

import { compileScrml } from "../../src/api.js";
import { rewriteServerReactiveRefs, serverRewriteEmitted } from "../../src/codegen/rewrite.ts";
import { rewriteServerReactiveRefsAST } from "../../src/expression-parser.ts";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import {
  SERVER_SESSION_REFUSED,
  setServerSessionUserCell,
  resetServerAmbientSessionRefusals,
  drainServerAmbientSessionRefusals,
  drainServerAmbientSessionRefusalErrors,
  setServerSessionContextSpan,
  fileScopeDeclaresSessionCell,
} from "../../src/codegen/server-session-guard.ts";
import { detectServerAmbientSessionReadsInText } from "../../src/route-inference.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_session_ambient_server");
let n = 0;

beforeAll(() => { if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(() => { if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true }); });

function compile(src, write = true) {
  const tag = `c${++n}`;
  const dir = resolve(TMP_ROOT, tag);
  const out = resolve(dir, "dist");
  mkdirSync(out, { recursive: true });
  const input = resolve(dir, `${tag}.scrml`);
  writeFileSync(input, src);
  const r = compileScrml({ inputFiles: [input], write, outputDir: out, log: () => {} });
  const serverJsPath = join(out, `${tag}.server.js`);
  const clientJsPath = join(out, `${tag}.client.js`);
  return {
    clientJs: existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "",
    errors: (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "")),
    serverJs: existsSync(serverJsPath) ? readFileSync(serverJsPath, "utf8") : "",
    serverJsPath,
    dir,
  };
}
const codes = (errs) => errs.map((e) => e.code);

describe("E-SESSION-AMBIENT-SERVER — every server context", () => {
  test("the gap reproducer: `@session.userId` inside a ?{} of a server fn", () => {
    const r = compile(`<program db="./notes.db" auth="required">
function saveNote(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${@session.userId}, \${body})\`}.run()
}
<button onclick=saveNote("x")>save</>
</program>
`);
    expect(codes(r.errors)).toEqual(["E-SESSION-AMBIENT-SERVER"]);
    const msg = r.errors[0].message;
    expect(msg).toContain("`session.userId`");
    expect(msg).toContain("`@session` is not read on the server");
    expect(msg).toContain("saveNote");
    // The emitted server never reads identity from the request body.
    expect(r.serverJs).not.toContain('_scrml_body["session"]');
  });

  const shapes = {
    "an ExprNode read in a wholly-server fn": `<program db="./a.db" auth="required">
function who() {
    let n = ?{\`SELECT count(*) AS c FROM sqlite_master\`}.get()
    return @session.userId
}
<button onclick=who()>who</>
</program>
`,
    "a CPS-split fn (it also writes a client cell)": `<program db="./b.db" auth="required">
<msg> = ""
function save(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${@session.userId}, \${body})\`}.run()
    @msg = "saved"
}
<button onclick=save("x")>save</>
<p>\${@msg}</p>
</program>
`,
    "an SSE generator": `<program db="./e.db" auth="required">
server function* ticks() {
    yield @session.userId
}
<p>t</p>
</program>
`,
    "a function nested in a server fn": `<program db="./f.db" auth="required">
function outer() {
    function inner() {
        return @session.userId
    }
    let r = ?{\`SELECT 1 AS one\`}.get()
    return inner()
}
<button onclick=outer()>o</>
</program>
`,
    "a bare `@session` in a program with no auth": `<program db="./g.db">
function save(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${@session}, \${body})\`}.run()
}
<button onclick=save("x")>save</>
</program>
`,
    "an `<endpoint>` arm body": `<program auth="required">
type FspMethod:enum = {
  FleetStatus
  Who
}
<endpoint path="/fsp" method="POST" accepts=FspMethod>
  <FleetStatus : { jsonrpc: "2.0", result: { active: 3, note: "ops@session.example" } }>
  <Who : { jsonrpc: "2.0", result: { who: @session.userId } }>
</endpoint>
</program>
`,
    "a channel `onserver:` handler": `<program db="sqlite:./app.db" auth="required">
  <db src="sqlite:./app.db" tables="msgs">
    \${ ?{\`CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY, sid TEXT, body TEXT)\`}.run() }
    <channel name="chat" onserver:message=handleMessage(msg)>
      \${
        function handleMessage(msg) {
          ?{\`INSERT INTO msgs (sid, body) VALUES (\${@session.userId}, \${msg})\`}.run()
        }
      }
    </channel>
    <p>x</p>
  </db>
</program>
`,
    "a `<cell server>` load query": `<program auth="required" db="sqlite:./c.db">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id TEXT, item TEXT)\`}.run()
    <orders server> = ?{\`SELECT * FROM orders WHERE user_id = \${@session.userId}\`}.all()
  }
  <main><ul><each in=@orders key=@.id><li : @.item></each></ul></main>
</program>
`,
  };
  for (const [name, src] of Object.entries(shapes)) {
    test(name, () => {
      const r = compile(src);
      expect(codes(r.errors)).toContain("E-SESSION-AMBIENT-SERVER");
      // one report per read — the backstop does not stack a second message
      expect(codes(r.errors)).not.toContain("E-INTERNAL-SESSION-AMBIENT-SERVER");
      expect(r.errors.filter((e) => e.code === "E-SESSION-AMBIENT-SERVER").length).toBe(1);
      expect(r.serverJs).not.toContain('_scrml_body["session"]');
    });
  }

  test("a bare `@session` read names the server session's members as the fix", () => {
    const r = compile(shapes["a bare `@session` in a program with no auth"]);
    const msg = r.errors.find((e) => e.code === "E-SESSION-AMBIENT-SERVER").message;
    expect(msg).toContain("`session.userId` / `session.role` / `session.isAuth` / `session.get(key)`");
  });
});

describe("what stays legal", () => {
  test("client `@session` (the §20.5 projection) compiles and lowers to the projection", () => {
    const r = compile(`<program db="./d.db" auth="required">
function logout() {
    @session.destroy()
}
<p>\${@session.current}</p>
<button onclick=logout()>out</>
</program>
`);
    expect(r.errors).toEqual([]);
  });

  test("the migrated `session.userId` form compiles clean and reads the server session", () => {
    const r = compile(`<program db="./notes.db" auth="required">
function saveNote(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${session.userId}, \${body})\`}.run()
}
<button onclick=saveNote("x")>save</>
</program>
`);
    expect(r.errors).toEqual([]);
    expect(r.serverJs).not.toContain('_scrml_body["session"]');
    expect(r.serverJs).toContain("${session.userId}");
    expect(r.serverJs).toContain("_scrml_session_bind(");
  });

  test("a file that declares its own `<session>` cell: ordinary cell rules (E-REACTIVE-003)", () => {
    const r = compile(`<program db="./h.db">
<session> = "draft-1"
function save(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${@session}, \${body})\`}.run()
}
<button onclick=save("x")>save</>
</program>
`, false);
    expect(codes(r.errors)).not.toContain("E-SESSION-AMBIENT-SERVER");
    expect(codes(r.errors)).toContain("E-REACTIVE-003");
  });
});

describe("codegen backstop — no server lowering path reads `@session` from the body", () => {
  test("rewrite.ts regex + AST paths, post-emit rewrite, and emitIdent all refuse and record", () => {
    setServerSessionUserCell(false);
    resetServerAmbientSessionRefusals();
    expect(rewriteServerReactiveRefs("@session.userId + @count")).toBe(`${SERVER_SESSION_REFUSED}.userId + _scrml_body["count"]`);
    expect(rewriteServerReactiveRefsAST("@session.userId").result).toBe(`${SERVER_SESSION_REFUSED}.userId`);
    expect(serverRewriteEmitted('_scrml_reactive_get("session").current')).toBe(`${SERVER_SESSION_REFUSED}.current`);
    expect(emitExpr({ kind: "ident", name: "@session", span: { start: 0, end: 8 } }, { mode: "server" })).toContain(SERVER_SESSION_REFUSED);
    const hits = drainServerAmbientSessionRefusals();
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(drainServerAmbientSessionRefusals()).toEqual([]);
  });

  test("hits drain as E-INTERNAL-SESSION-AMBIENT-SERVER build errors", () => {
    setServerSessionUserCell(false);
    resetServerAmbientSessionRefusals();
    rewriteServerReactiveRefs("@session");
    const errs = drainServerAmbientSessionRefusalErrors("/x/app.scrml");
    expect(errs.length).toBe(1);
    expect(errs[0].code).toBe("E-INTERNAL-SESSION-AMBIENT-SERVER");
    expect(errs[0].severity).toBe("error");
    expect(errs[0].span.file).toBe("/x/app.scrml");
  });

  test("a user `<session>` cell owns the name: the guard stands down", () => {
    setServerSessionUserCell(true);
    resetServerAmbientSessionRefusals();
    expect(rewriteServerReactiveRefs("@session")).toBe('_scrml_body["session"]');
    expect(drainServerAmbientSessionRefusals()).toEqual([]);
    setServerSessionUserCell(false);
  });
});

describe("HTTP — the migrated form writes the real session's id, whatever the body claims", () => {
  test("POST {session:{userId:'victim'}} as authenticated u-real writes sid=u-real", async () => {
    if (typeof globalThis.document !== "undefined") return; // native Request only (Cookie header)
    const r = compile(`<program db="./notes.db" auth="required">
\${
    function setup() {
        ?{\`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, sid TEXT, body TEXT)\`}.run()
    }
    function saveNote(body: string) {
        ?{\`INSERT INTO notes (sid, body) VALUES (\${session.userId}, \${body})\`}.run()
        return "ok"
    }
}
<button onclick=setup()>setup</>
<button onclick=saveNote("hi")>save</>
</program>
`);
    expect(r.errors).toEqual([]);
    const mod = await import(`file://${r.serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const routes = Object.values(mod).filter((v) => v && typeof v === "object" && typeof v.path === "string" && v.handler);
    const routeFor = (f) => routes.find((x) => x.path.includes(f));
    // A read-only session program uses the in-process Map store (the durable
    // per-path store is emitted only for session WRITES). Pin that, so the seed
    // lands in the store THIS module reads (other tests in the same process may
    // have created durable stores).
    expect(r.serverJs).toContain("globalThis.__scrml_session_store ??= new Map()");
    const store = globalThis.__scrml_session_store;
    expect(store).toBeTruthy();
    const SID = `sid-${Math.random().toString(36).slice(2)}`;
    const TOKEN = `tok-${Math.random().toString(36).slice(2)}`;
    store.set(SID, { userId: "u-real", role: "user", csrfToken: TOKEN }, 3600);
    const post = (route, body) => route.handler(new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `__Host-scrml_sid=${SID}`, "X-CSRF-Token": TOKEN },
      body: JSON.stringify(body),
    }));
    expect((await post(routeFor("setup"), {})).status).toBe(200);
    const resp = await post(routeFor("saveNote"), { body: "spoofed", session: { userId: "victim" } });
    expect(resp.status).toBe(200);
    const db = new Database(join(r.dir, "notes.db"));
    try {
      const rows = db.query("SELECT sid, body FROM notes").all();
      expect(rows).toEqual([{ sid: "u-real", body: "spoofed" }]);
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// S449 review fix round (F1-F6 on 54e3cb542)
// ---------------------------------------------------------------------------

const lineOf = (src, needle) => src.split("\n").findIndex((l) => l.includes(needle)) + 1;

describe("F2 — only a FILE-SCOPE `<session>` cell exempts", () => {
  // The reviewer's program: a component-local `<session>` used to switch off both
  // the front-end check and the codegen backstop file-wide.
  const SRC = `<program db="./n.db" auth="required">
const Box = <div props={}>
    \${ <session> = {userId: "local"} }
    <p>\${@session.userId}</p>
</>
<msg> = ""
function save(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${@session.userId}, \${body})\`}.run()
    @msg = "saved"
}
<Box/>
<button onclick=save("x")>save</>
</program>
`;
  test("a component-local `<session>` does not exempt a top-level server read", () => {
    const r = compile(SRC);
    expect(codes(r.errors)).toEqual(["E-SESSION-AMBIENT-SERVER"]);
    expect(r.serverJs).not.toContain('_scrml_body["session"]');
  });
  test("fileScopeDeclaresSessionCell: top-level yes; component-def / expanded-component / function body no", () => {
    expect(fileScopeDeclaresSessionCell([{ kind: "markup", tag: "program", children: [{ kind: "logic", body: [{ kind: "state-decl", name: "session" }] }] }])).toBe(true);
    expect(fileScopeDeclaresSessionCell([{ kind: "markup", tag: "program", children: [
      { kind: "logic", body: [{ kind: "component-def", name: "Box", defChildren: [{ kind: "state-decl", name: "session" }] }] },
      { kind: "markup", tag: "div", _expandedFrom: "Box", children: [{ kind: "logic", body: [{ kind: "state-decl", name: "session" }] }] },
      { kind: "logic", body: [{ kind: "function-decl", name: "f", body: [{ kind: "state-decl", name: "session" }] }] },
    ] }])).toBe(false);
  });
});

describe("F1 — a CPS split: only the server half is a server context", () => {
  test("a client-tail `@msg = @session.userId` compiles and the client reads the projection", () => {
    const r = compile(`<program db="./n.db" auth="required">
<msg> = ""
function save(body: string) {
    ?{\`INSERT INTO notes (body) VALUES (\${body})\`}.run()
    @msg = @session.userId
}
<button onclick=save("x")>save</>
<p>\${@msg}</p>
</program>
`);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_cs_reactive_set("msg", session.userId)');
    expect(r.serverJs).not.toContain('_scrml_body["session"]');
    expect(r.serverJs).not.toContain("_scrml_server_session_refused");
  });
  test("a server-half read in the same function still fires (once — the client tail is not reported)", () => {
    const src = `<program db="./n.db" auth="required">
<msg> = ""
function save(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${@session.userId}, \${body})\`}.run()
    @msg = @session.userId
}
<button onclick=save("x")>save</>
<p>\${@msg}</p>
</program>
`;
    const r = compile(src);
    expect(codes(r.errors)).toEqual(["E-SESSION-AMBIENT-SERVER"]);
    expect(r.errors[0].span.line).toBe(lineOf(src, "INSERT INTO notes"));
  });
});

describe("F3 — the front end reports these shapes itself, at the read's line", () => {
  const SRC = `<program db="./n.db" auth="required">
type Kind:enum = { A, B }
function f2(k: Kind) {
    let n = ?{\`SELECT 1 AS one\`}.get()
    match k {
        .A => { let z = @session.role
                return z }
        .B => { return 0 }
    }
}
function f3() {
    let n = ?{\`SELECT 1 AS one\`}.get()
    if (@session.isAuth) { return 1 }
    return 0
}
function f4() {
    let n = ?{\`SELECT 1 AS one\`}.get()
    @session.userId = "x"
    return 0
}
function f5() {
    let n = ?{\`SELECT 1 AS one\`}.get()
    let s = \`id=\${@session.userId} and \${\`inner \${@session.role}\`}\`
    return s
}
<button onclick=f2(Kind.A)>a</>
<button onclick=f3()>b</>
<button onclick=f4()>c</>
<button onclick=f5()>d</>
</program>
`;
  test("match block arm, if condition, member assignment, nested template literal", () => {
    const r = compile(SRC);
    expect(codes(r.errors)).not.toContain("E-INTERNAL-SESSION-AMBIENT-SERVER");
    const e = r.errors.filter((x) => x.code === "E-SESSION-AMBIENT-SERVER");
    const got = e.map((x) => `${x.message.match(/Server function \`(\w+)\`/)[1]}:${x.span.line}`).sort();
    expect(got).toEqual([
      `f2:${lineOf(SRC, "let z = @session.role")}`,
      `f3:${lineOf(SRC, "if (@session.isAuth)")}`,
      `f4:${lineOf(SRC, '@session.userId = "x"')}`,
      `f5:${lineOf(SRC, "let s = ")}`,
      `f5:${lineOf(SRC, "let s = ")}`,
    ].sort());
    expect(e.map((x) => x.message).some((m) => m.includes("`@session.role`"))).toBe(true);
    expect(r.serverJs).not.toContain('_scrml_body["session"]');
  });
});

describe("F4 — update and (logical) assignment lowerings are guarded", () => {
  test("front end: `@session ??= 5` and `@session++` in a server fn", () => {
    const src = `<program db="./n.db" auth="required">
function g1() {
    let n = ?{\`SELECT 1 AS one\`}.get()
    @session ??= 5
    return 0
}
function g2() {
    let n = ?{\`SELECT 1 AS one\`}.get()
    @session++
    return 0
}
<button onclick=g1()>a</>
<button onclick=g2()>b</>
</program>
`;
    const r = compile(src);
    expect(codes(r.errors)).toEqual(["E-SESSION-AMBIENT-SERVER", "E-SESSION-AMBIENT-SERVER"]);
    expect(r.serverJs).not.toContain('_scrml_body["session"]');
  });
  test("backstop: emitExpr server-mode assign / logical-assign / postfix update never emit the body", () => {
    setServerSessionUserCell(false);
    resetServerAmbientSessionRefusals();
    const id = { kind: "ident", name: "@session", span: { start: 0, end: 8 } };
    const five = { kind: "lit", raw: "5", value: 5, litType: "number", span: { start: 0, end: 1 } };
    for (const op of ["=", "??=", "||="]) {
      const out = emitExpr({ kind: "assign", op, target: id, value: five, span: { start: 0, end: 10 } }, { mode: "server" });
      expect(out).toContain(SERVER_SESSION_REFUSED);
      expect(out).not.toContain("_scrml_body");
    }
    const upd = emitExpr({ kind: "unary", op: "++", prefix: false, argument: id, span: { start: 0, end: 10 } }, { mode: "server" });
    expect(upd).toContain(SERVER_SESSION_REFUSED);
    expect(upd).not.toContain("_scrml_body");
    expect(drainServerAmbientSessionRefusals().length).toBe(4);
  });
});

describe("F5 — raw-text scan is comment-, string- and template-aware", () => {
  test("not reads: comments, strings, template static text", () => {
    for (const t of [
      "{ a: 1 /* @session.x */ }",
      "{ a: 1 } // it's @session.userId",
      '{ a: "ops@session.example" }',
      "{ a: 'x @session' }",
      "{ a: `static @session text` }",
    ]) expect(`${t} ${detectServerAmbientSessionReadsInText(t).length}`).toBe(`${t} 0`);
  });
  test("reads: after an apostrophe in a comment, inside nested template interpolations", () => {
    expect(detectServerAmbientSessionReadsInText("// don't\n{ who: @session.role }")).toEqual([{ member: "role" }]);
    expect(detectServerAmbientSessionReadsInText("`a ${@session.isAuth} ${`n ${@session.userId}`}`")).toEqual([{ member: "isAuth" }, { member: "userId" }]);
  });
  test("an <endpoint> arm: a commented mention is not a read, a real one after an apostrophe comment is", () => {
    const r = compile(`<program auth="required">
type M:enum = {
  A
  B
}
<endpoint path="/e" method="POST" accepts=M>
  <A : { jsonrpc: "2.0", result: { n: 1 /* not @session.userId */ } }>
  <B : { jsonrpc: "2.0", result: { who: @session.role } }>
</endpoint>
</program>
`);
    const e = r.errors.filter((x) => x.code === "E-SESSION-AMBIENT-SERVER");
    expect(e.length).toBe(1);
    expect(e[0].message).toContain("`@session.role`");
    expect(codes(r.errors)).not.toContain("E-INTERNAL-SESSION-AMBIENT-SERVER");
  });
});

describe("F6 — the backstop carries a location", () => {
  test("a hit with no node span points at the server function being emitted", () => {
    setServerSessionUserCell(false);
    resetServerAmbientSessionRefusals();
    setServerSessionContextSpan({ file: "/x/app.scrml", start: 40, end: 90, line: 3, col: 1 });
    rewriteServerReactiveRefs("@session.userId");
    setServerSessionContextSpan(null);
    const [err] = drainServerAmbientSessionRefusalErrors("/x/app.scrml", () => null);
    expect(err.span.line).toBe(3);
    expect(err.span.start).toBe(40);
  });
  test("a node span inside that function is resolved to its own line; nothing resolvable = no fake 1:1", () => {
    setServerSessionUserCell(false);
    resetServerAmbientSessionRefusals();
    setServerSessionContextSpan({ file: "/x/app.scrml", start: 40, end: 90, line: 3, col: 1 });
    emitExpr({ kind: "ident", name: "@session", span: { start: 55, end: 63, line: 1, col: 1 } }, { mode: "server" });
    setServerSessionContextSpan(null);
    emitExpr({ kind: "ident", name: "@session", span: { start: 5, end: 13, line: 1, col: 1 } }, { mode: "server" });
    const errs = drainServerAmbientSessionRefusalErrors("/x/app.scrml", (sp) => (sp.start === 55 ? { line: 4, col: 9 } : null));
    expect([errs[0].span.line, errs[0].span.col]).toEqual([4, 9]);
    expect(errs[1].span.line).toBeUndefined();
  });
});
