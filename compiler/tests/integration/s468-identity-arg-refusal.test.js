/**
 * s468 (ruling S468 (2)(b)) — E-ARG-SERVER-IDENTITY: an identity passed as an
 * ARGUMENT to a server function is a compile error.
 *
 * `<button onclick=add("hi", @session.userId)>` with
 * `function add(name, uid) { ?{INSERT … ${uid} …}.run() }`: the browser computes
 * `@session.userId` and sends it; the server binds `uid` from the request body.
 * Measured on origin/main bbddfd7b9: compiles, and a request carrying the
 * attacker's session cookie and `uid: "victim"` writes a row authored `victim`.
 * §6.6.9: "`@session` is server-only identity and SHALL NEVER be marshalled from
 * the client". The value is refused at every route the identity follower
 * (free-name.ts `identityReadInDefaultDeep` over identity-flow.ts) follows; the
 * fix — reading the session on the server — compiles and writes the REAL id
 * whatever the request says (executed below).
 *
 * Also: the original gap `g-param-default-identity-via-param-or-mutation-s467` —
 * a CPS default reaching an identity through a PARAMETER of a client function or a
 * MUTATING call — is now E-PARAM-DEFAULT-SERVER-IDENTITY (the default check uses
 * the same resolver).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const T = 30_000;
const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_s468_identity_arg");
let n = 0;
beforeAll(() => { if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(() => { if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true }); });

/** Compile `files` ({ name: source }); the first is the entry. */
function compileFiles(files) {
  const tag = `c${++n}`;
  const dir = resolve(TMP_ROOT, tag);
  const out = resolve(dir, "dist");
  mkdirSync(out, { recursive: true });
  const inputs = [];
  for (const [name, src] of Object.entries(files)) {
    const p = resolve(dir, name);
    writeFileSync(p, src);
    inputs.push(p);
  }
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, author TEXT, body TEXT)");
  db.close();
  const r = compileScrml({ inputFiles: inputs, write: true, outputDir: out, log: () => {} });
  const entry = Object.keys(files)[0].replace(/\.scrml$/, "");
  const serverJsPath = join(out, `${entry}.server.js`);
  return {
    errors: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? "")),
    serverJs: existsSync(serverJsPath) ? readFileSync(serverJsPath, "utf8") : "",
    serverJsPath,
    dir,
  };
}
const compile = (src) => compileFiles({ "app.scrml": src });
const codes = (errs) => [...new Set(errs.map((e) => e.code))];
const rows = (dir) => {
  const db = new Database(join(dir, "app.db"));
  try { return db.query("SELECT author, body FROM posts ORDER BY id").all(); } finally { db.close(); }
};

const ADD = `function add(name, uid) {
    ?{\`INSERT INTO posts (author, body) VALUES (\${uid}, \${name})\`}.run()
  }`;
const APP = (body, button = "") => `<program db="./app.db" auth="required">
  <last> = ""
  <draft> = "d"
  ${ADD}
  ${body}
  ${button}
</program>
`;

// A server call inside a `.forEach` callback is ALSO E-SERVER-FN-IN-SYNC-CALLBACK (§13.2); a
// lambda bound to a name that calls a server function is ALSO E-ASYNC-FN-ESCAPES-AS-VALUE where
// §13.9.6 F4 is enforced (#1434).
const ALSO = new Set(["E-SERVER-FN-IN-SYNC-CALLBACK", "E-ASYNC-FN-ESCAPES-AS-VALUE"]);
function expectRefused(r, frag) {
  expect(codes(r.errors).filter((c) => !ALSO.has(c))).toEqual(["E-ARG-SERVER-IDENTITY"]);
  const msg = r.errors.map((e) => e.message).join("\n");
  expect(msg).toContain("server function `add`");
  expect(msg).toContain("SHALL NEVER be marshalled from the client");
  expect(msg).toContain("read the identity on the server");
  if (frag) expect(msg).toContain(frag);
  expect(r.serverJs).toBe("");
}

describe("s468 — identity passed as an argument to a server function is refused", () => {
  test("the reproducer: `onclick=add(\"hi\", @session.userId)`", () => {
    const r = compile(APP("", `<button id="go" onclick=add("hi", @session.userId)>add</button>`));
    expectRefused(r, "`const uid = session.userId`");
    expect(r.errors[0].message).toContain("argument 2 (`uid`)");
  });

  const handlerShapes = {
    "a braced handler `onclick={ add(…) }`": `<button onclick={ add("hi", @session.userId) }>a</button>`,
    "a lambda handler `onclick=${() => add(…)}`": `<button onclick=\${() => add("hi", @session.userId)}>a</button>`,
    "a template argument": "<button onclick=${add(\"hi\", `u:${@session.userId}`)}>a</button>",
    "a concatenation": `<button onclick={ add("hi", "u:" + @session.userId) }>a</button>`,
    "an object wrapping it": `<button onclick={ add("hi", { u: @session.userId }) }>a</button>`,
    "an array wrapping it": `<button onclick={ add("hi", [@session.userId]) }>a</button>`,
    "a spread argument list": `<button onclick={ add(...["hi", @session.userId]) }>a</button>`,
    "`@currentUser.role`": `<button onclick={ add("hi", @currentUser.role) }>a</button>`,
    "`@currentUser.tenantId`": `<button onclick={ add("hi", @currentUser.tenantId) }>a</button>`,
    "`@session.isAuth`": `<button onclick={ add("hi", @session.isAuth) }>a</button>`,
  };
  for (const [label, button] of Object.entries(handlerShapes)) {
    test(label, () => expectRefused(compile(APP("", button))));
  }

  const fnShapes = {
    "a local (`const u = @session.userId`)": `const u = @session.userId\n    add("hi", u)`,
    "an alias of `@session` (`const s = @session`)": `const s = @session\n    add("hi", s.userId)`,
    "a helper's result": `add("hi", who())`,
    "a nested object field": `const o = { a: { u: @session.userId } }\n    add("hi", o.a.u)`,
    "`Object.assign` into a local": `const o = {}\n    Object.assign(o, { u: @session.userId })\n    add("hi", o)`,
    "`.push` into a local": `const xs = []\n    xs.push(@session.userId)\n    add("hi", xs)`,
    "`Map.set` then `.get`": `const m = new Map()\n    m.set("u", @session.userId)\n    add("hi", m.get("u"))`,
    "a reassigned local": `let k = "x"\n    k = @session.userId\n    add("hi", k)`,
    "a `for … of` variable": `for (const u of [@session.userId]) { add("hi", u) }`,
    "a block-bodied callback (raw text)": `[1].forEach((x) => { add("hi", @session.userId) })`,
    "a block-bodied callback's parameter": `[@session.userId].forEach((u) => { add("hi", u) })`,
    "an expression-bodied callback's parameter": `[@session.userId].forEach((u) => add("hi", u))`,
  };
  for (const [label, body] of Object.entries(fnShapes)) {
    test(`in a client function — ${label}`, () => {
      const r = compile(APP(`function who() { return @session.userId }\n  function go() {\n    ${body}\n  }`, `<button onclick=go()>g</button>`));
      expectRefused(r);
    });
  }

  test("`@currentUser.id` — the message names the field and the server-side read", () => {
    const r = compile(APP("", `<button onclick=add("hi", @currentUser.id)>a</button>`));
    expectRefused(r, "computed in the browser from `@currentUser.id`");
    expect(r.errors[0].message).toContain("`const uid = @currentUser.id`");
  });

  test("a derived cell (`const <me> = @session.userId`)", () => {
    expectRefused(compile(APP(`const <me> = @session.userId`, `<button onclick=add("hi", @me)>a</button>`)), "`@me`");
  });

  test("a cell mutated with the identity (`@ids.push(@session.userId)`)", () => {
    expectRefused(compile(APP(`<ids> = []\n  function grab() { @ids.push(@session.userId) }`, `<button onclick=grab()>g</button><button onclick=add("hi", @ids)>a</button>`)));
  });

  test("a cell assigned the identity in another function", () => {
    expectRefused(compile(APP(`<who> = ""\n  function grab() { @who = @session.userId }`, `<button onclick=grab()>g</button><button onclick=add("hi", @who)>a</button>`)));
  });

  test("through a parameter of a client function (`go(@session.userId)` → `add(…, u)`)", () => {
    const r = compile(APP(`function go(u) { add("hi", u) }`, `<button onclick=go(@session.userId)>g</button>`));
    expectRefused(r, "`@session.userId`");
  });

  test("through two client functions' parameters", () => {
    const r = compile(APP(`function go(u) { relay(u) }\n  function relay(v) { add("hi", v) }`, `<button onclick=go(@session.userId)>g</button>`));
    expectRefused(r);
  });

  test("an `<each>` row variable over a list built from the identity", () => {
    const r = compile(APP(`<ids> = [@session.userId]`, `<each in=@ids as u><button onclick=add("hi", u)>a</button></each>`));
    expectRefused(r);
  });

  test("through a `const` lambda's parameter (`const w = (u) => add(\"hi\", u)` + `w(@session.userId)`)", () => {
    expectRefused(compile(APP(`const w = (u) => add("hi", u)`, `<button onclick=w(@session.userId)>w</button>`)), "(through `u`)");
  });

  test("through a function passed to a component prop (the component calls it with the identity)", () => {
    const r = compileFiles({
      "app.scrml": `<program db="./app.db" auth="required">
  \${ import { Btn } from "./btn.scrml" }
  ${ADD}
  function relay(u) { add("hi", u) }
  \${ lift <div><Btn onGo=relay/></div> }
</program>
`,
      "btn.scrml": `\${
    export const Btn = <div props={
        onGo: asIs,
    }>
        <button onclick=onGo(@session.userId)>go</button>
    </div>
}
`,
    });
    expect(codes(r.errors)).toEqual(["E-ARG-SERVER-IDENTITY"]);
    expect(r.errors[0].message).toContain("(through `u`)");
  });

  test("a CPS-split server function is a server function too", () => {
    const r = compile(`<program db="./app.db" auth="required">
  <last> = ""
  function add(name, uid) {
    ?{\`INSERT INTO posts (author, body) VALUES (\${uid}, \${name})\`}.run()
    @last = name
  }
  <button onclick=add("hi", @session.userId)>a</button>
</program>
`);
    expectRefused(r);
  });

  test("across a `.scrml` import (the server function declared in another file)", () => {
    const r = compileFiles({
      "app.scrml": `<program db="./app.db" auth="required">
  \${ import { add } from "./api.scrml" }
  <button onclick=add("hi", @session.userId)>a</button>
</program>
`,
      "api.scrml": `\${ export function add(name, uid) {
    ?{\`INSERT INTO posts (author, body) VALUES (\${uid}, \${name})\`}.run()
  } }
`,
    });
    expect(codes(r.errors)).toContain("E-ARG-SERVER-IDENTITY");
  });

  test("a function passed by reference to a method of an identity-holding list (`[@session.userId].forEach(save1)`)", () => {
    const r = compile(`<program db="./app.db" auth="required">
  function save1(uid) {
    ?{\`INSERT INTO posts (author, body) VALUES (\${uid}, 'x')\`}.run()
  }
  <button onclick=\${() => [@session.userId].forEach(save1)}>g</button>
</program>
`);
    expect(codes(r.errors)).toContain("E-ARG-SERVER-IDENTITY");
    expect(r.serverJs).toBe("");
  });
});

describe("s468 — the CPS default routes the original gap left open (E-PARAM-DEFAULT-SERVER-IDENTITY)", () => {
  const CPS = (extra, def) => `<program db="./app.db" auth="required">
  <last> = ""
  <s> = ""
  ${extra}
  function add(name, uid = ${def}) {
    ?{\`INSERT INTO posts (author, body) VALUES (\${uid}, \${name})\`}.run()
    @last = name
  }
  <button onclick=add("hi")>a</button>
</program>
`;
  test("a cell written through a client function's parameter (`setIt(@session.userId)`)", () => {
    const r = compile(CPS(`function setIt(v) { @s = v }\n  <button onclick=setIt(@session.userId)>s</button>`, "@s"));
    expect(codes(r.errors)).toContain("E-PARAM-DEFAULT-SERVER-IDENTITY");
  });
  test("a cell mutated with the identity (`Object.assign`)", () => {
    const r = compile(CPS(`<o> = {}\n  function grab() { Object.assign(@o, { u: @session.userId }) }\n  <button onclick=grab()>g</button>`, "@o.u"));
    expect(codes(r.errors)).toContain("E-PARAM-DEFAULT-SERVER-IDENTITY");
  });
});

describe("s468 — NOT refused", () => {
  test("the fix: the server function reads the session itself — writes the REAL id whatever the request says", async () => {
    if (typeof globalThis.document !== "undefined") return; // native Request only (Cookie header)
    const r = compile(`<program db="./app.db" auth="required">
  function add(name) {
    const uid = session.userId
    ?{\`INSERT INTO posts (author, body) VALUES (\${uid}, \${name})\`}.run()
  }
  <button onclick=add("hi")>add</button>
</program>
`);
    expect(r.errors).toEqual([]);
    const mod = await import(`file://${r.serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const route = mod.routes.find((x) => /__ri_route_add_\d+/.test(x.path));
    expect(route).toBeTruthy();
    const store = globalThis.__scrml_session_store;
    const SID = `sid-${Math.random().toString(36).slice(2)}`;
    const TOKEN = `tok-${Math.random().toString(36).slice(2)}`;
    store.set(SID, { userId: "u-real", role: "user", csrfToken: TOKEN }, 3600);
    const resp = await route.handler(new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `__Host-scrml_sid=${SID}`, "X-CSRF-Token": TOKEN },
      body: JSON.stringify({ name: "hi", uid: "victim" }),
    }));
    expect(resp.status).toBe(200);
    expect(rows(r.dir)).toEqual([{ author: "u-real", body: "hi" }]);
  }, T);

  const ok = {
    "non-identity data (`add(\"hi\", @draft)`)": APP("", `<button onclick=add("hi", @draft)>a</button>`),
    "`@session` used only in the browser": APP(`function show() { @last = @session.userId }`, `<button onclick=show()>s</button><p>\${@session.userId}</p><button onclick=add("hi", @draft)>a</button>`),
    "a same-named local in ANOTHER function holds the identity": APP(`function a() { const u = @session.userId\n    @last = u }\n  function b() { const u = "x"\n    add("hi", u) }`, `<button onclick=a()>a</button><button onclick=b()>b</button>`),
    "a client function's parameter that is never passed an identity": APP(`function go(u) { add("hi", u) }`, `<button onclick=go(@draft)>g</button>`),
    "a callback parameter over non-identity data": APP(`function go() { [@draft].forEach((u) => add("hi", u)) }`, `<button onclick=go()>g</button>`),
    "a file-declared `<currentUser>` cell is the author's data, not the ambient identity": `<program db="./app.db" auth="required">
  <currentUser> = { id: "x" }
  ${ADD}
  <button onclick=add("hi", @currentUser.id)>a</button>
</program>
`,
    // security-await-pack m4/appExportConstAnn, m1/topLetAssignLater: a lambda bound to a name
    // (an exported `const`, a reassigned `let`) whose only calls are in a server function —
    // its parameters hold what those calls pass, nothing the browser computed.
    "an exported `const` lambda called only from server code": `<program db="./app.db" auth="required">
  ${ADD}
  export const w = (a, b) => add(a, b)
  function f(n) { w(n, "x") }
  <button onclick=f("hi")>f</button>
</program>
`,
    "a reassigned `let` lambda called only from server code": `<program db="./app.db" auth="required">
  ${ADD}
  let w = (a, b) => false
  w = (a, b) => add(a, b)
  function f(n) { w(n, "x") }
  <button onclick=f("hi")>f</button>
</program>
`,
    "a function passed to a component prop the component calls with non-identity data": `<program db="./app.db" auth="required">
  ${ADD}
  function relay(u) { add("hi", u) }
  const Btn = <div props={ onGo: asIs }><button onclick=onGo("plain")>go</button></div>
  \${ lift <div><Btn onGo=relay/></div> }
</program>
`,
    "a server function passing the server's own session to another (in-process)": `<program db="./app.db" auth="required">
  ${ADD}
  function outer(name) { add(name, session.userId) }
  <button onclick=outer("hi")>a</button>
</program>
`,
  };
  for (const [label, src] of Object.entries(ok)) {
    test(label, () => {
      const r = compile(src);
      expect(codes(r.errors).filter((c) => !ALSO.has(c))).toEqual([]);
    });
  }
});
