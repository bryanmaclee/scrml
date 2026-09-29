/**
 * §14.8.9 — a `protect=` column must not leave the server OUTSIDE its row.
 * S441, `g-protected-column-escapes-redaction-as-scalar` (SECURITY, HIGH).
 *
 * THE DEFECT, MEASURED: `return u.passwordHash` compiled at exit 0 and the
 * emitted route served HTTP 200 body `"SECRET-HASH-123"`, while
 * `I-PROTECT-STRIP-001` reported the column stripped. The floor tags the ROW; a
 * value pulled out of the row carries no descriptor, and the sink has nothing
 * to read. The same held for every shape that re-houses the extracted value.
 *
 * THE FIX: the §14.8.9 provenance flow (`compiler/src/codegen/protect-flow.ts`)
 * reads the emitted server module and rejects, as `E-PROTECT-006`, any value
 * with protected provenance that reaches a client-egress sink outside a
 * descriptor-bearing row. `I-PROTECT-STRIP-001` now fires only for a query whose
 * row the sink actually stripped.
 *
 * Three layers:
 *   1. the shape matrix — every laundering shape the brief names, compiled;
 *   2. the negatives — rows, non-protected fields, derived values, `reveal`,
 *      and the canonical login (`verifyPassword(pw, u.passwordHash)`) compile;
 *   3. EXECUTED — the negatives that compile still serve the right bytes.
 */
import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const HEAD = `<program db="./app.db">
<schema>
  users {
    id: integer primary key
    name: text
    passwordHash: text
  }
</schema>
<db src="./app.db" tables="users" protect="passwordHash"/>
`;
const TAIL = `<resultCell> = ""
<button onclick=\${ @resultCell = getIt() }>x</button>
<p>\${@resultCell}</p>
</program>
`;
const ONE = "const u = ?{`SELECT * FROM users WHERE id = 1`}.get()";
const ALL = "const rows = ?{`SELECT * FROM users`}.all()";
const prog = (body) => HEAD + body + "\n" + TAIL;
const fnBody = (lines) => `function getIt() {\n    ${lines.join("\n    ")}\n}`;

function compileMem(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-protect-scalar-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  const diags = [...(result.errors ?? []), ...(result.warnings ?? [])];
  return { result, diags, codes: diags.map((d) => d.code) };
}

// ---------------------------------------------------------------------------
// 1. every laundering shape is rejected at compile time
// ---------------------------------------------------------------------------
const LEAKS = {
  "scalar (the reported shape)": fnBody([ONE, "return u.passwordHash"]),
  "field of a new object": fnBody([ONE, "return { h: u.passwordHash }"]),
  "array element": fnBody([ONE, "return [u.passwordHash]"]),
  "string concatenation": fnBody([ONE, 'return "x" + u.passwordHash']),
  "template interpolation": fnBody([ONE, "return `h=${u.passwordHash}`"]),
  "destructure": fnBody([ONE, "const { passwordHash } = u", "return passwordHash"]),
  "destructure with alias": fnBody([ONE, "const { passwordHash: hv } = u", "return hv"]),
  "via a local, nested in a container": fnBody([ONE, "const hv = u.passwordHash", "return { data: { deep: hv } }"]),
  "ternary": fnBody([ONE, 'return u.id > 0 ? u.passwordHash : ""']),
  "computed key": fnBody([ONE, 'const k = "passwordHash"', "return u[k]"]),
  "JSON.stringify of the row": fnBody([ONE, "return JSON.stringify(u)"]),
  "push into an array": fnBody([ONE, "const out = []", "out.push(u.passwordHash)", "return out"]),
  ".map to the column": fnBody([ALL, "return rows.map(r => r.passwordHash)"]),
  ".map to a re-keyed object": fnBody([ALL, "return rows.map(r => ({ n: r.name, h: r.passwordHash }))"]),
  ".map then .join": fnBody([ALL, 'return rows.map(r => r.passwordHash).join(",")']),
  "index then field": fnBody([ALL, "return rows[0].passwordHash"]),
  "aliased SELECT (`AS h`) — keyed on origin": fnBody([
    "const u = ?{`SELECT passwordHash AS h FROM users WHERE id = 1`}.get()", "return u.h",
  ]),
  "helper extracts from a row passed in":
    "function pick(r) {\n    return r.passwordHash\n}\n" + fnBody([ONE, "return pick(u)"]),
  "helper returns the row, caller extracts":
    "function load() {\n    return ?{`SELECT * FROM users WHERE id = 1`}.get()\n}\n" +
    fnBody(["return load().passwordHash"]),
};

describe("S441 E-PROTECT-006 — a protected value leaving outside its row is a compile error", () => {
  for (const [name, body] of Object.entries(LEAKS)) {
    test(name, () => {
      const { codes, diags } = compileMem(prog(body));
      expect(codes).toContain("E-PROTECT-006");
      const e = diags.find((d) => d.code === "E-PROTECT-006");
      expect(e.severity ?? "error").toBe("error");
      expect(e.message).toMatch(/outside its row/);
    });
  }

  test("the reported shape no longer claims the column was stripped", () => {
    const { codes } = compileMem(prog(LEAKS["scalar (the reported shape)"]));
    // Nothing reached a sink as a row, so nothing was stripped — the old info
    // said it was, and that claim is what made the leak look handled.
    expect(codes).not.toContain("I-PROTECT-STRIP-001");
  });

  test("the diagnostic names the column and the extraction site", () => {
    const { diags } = compileMem(prog(LEAKS["helper extracts from a row passed in"]));
    const e = diags.find((d) => d.code === "E-PROTECT-006");
    expect(e.message).toContain("`passwordHash`");
    expect(e.message).toContain("`r.passwordHash` in `pick`");
    expect(e.message).toContain('reveal("passwordHash")');
  });
});

// ---------------------------------------------------------------------------
// 2. no false positives — the row, non-protected fields, derived values, reveal
// ---------------------------------------------------------------------------
const CLEAN = {
  "the row itself (the floor strips it)": [fnBody([ONE, "return u"]), true],
  "a non-protected field of the same row": [fnBody([ONE, "return u.name"]), false],
  "spread of the row": [fnBody([ONE, "return { ...u, extra: 1 }"]), true],
  "the row nested in a container": [fnBody([ONE, "return { user: u, n: u.name }"]), true],
  ".map to a non-protected field": [fnBody([ALL, "return rows.map(r => r.name)"]), false],
  ".map spreading each row": [fnBody([ALL, 'return rows.map(r => ({ ...r, tag: "t" }))']), true],
  "a comparison (derived)": [fnBody([ONE, 'return u.passwordHash == "x"']), false],
  "index then non-protected field": [fnBody([ALL, "return rows[0].name"]), false],
  "length": [fnBody([ALL, "return rows.length"]), false],
  "reveal, then read (the declassify path)": [fnBody([ONE, 'return u.reveal("passwordHash").passwordHash']), false],
};

const LOGIN = `<program db="./app.db">
<schema>
  users {
    id: integer primary key
    name: text
    passwordHash: text
  }
</schema>
<db src="./app.db" tables="users" protect="passwordHash"/>
\${
  import { verifyPassword } from 'scrml:auth'
  function login(name, pw) {
    const u = ?{\`SELECT id, name, passwordHash FROM users WHERE name = \${name}\`}.get()
    if (u is not) return { ok: false }
    const ok = verifyPassword(pw, u.passwordHash)
    if (!ok) return { ok: false }
    return { ok: true, user: { id: u.id, name: u.name } }
  }
}
<resultCell> = ""
<button onclick=\${ @resultCell = login("ada", "pw") }>x</button>
<p>\${@resultCell}</p>
</program>
`;

describe("S441 no false positives", () => {
  for (const [name, [body, strips]] of Object.entries(CLEAN)) {
    test(name, () => {
      const { codes, result } = compileMem(prog(body));
      expect(codes).not.toContain("E-PROTECT-006");
      expect((result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""))).toEqual([]);
      // The info is TRUE now: present iff a row reached the sink carrying an
      // unrevealed protected column.
      if (strips) expect(codes).toContain("I-PROTECT-STRIP-001");
      else expect(codes).not.toContain("I-PROTECT-STRIP-001");
    });
  }

  test("the canonical login — verifyPassword(pw, u.passwordHash) returning a bool — compiles clean", () => {
    const { codes, result } = compileMem(LOGIN);
    expect(codes).not.toContain("E-PROTECT-006");
    expect((result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""))).toEqual([]);
    // The row is only VERIFIED, never returned — nothing is stripped, so no info.
    expect(codes).not.toContain("I-PROTECT-STRIP-001");
  });
});

// ---------------------------------------------------------------------------
// 2b. every client-egress SINK, not just the server-fn response
// ---------------------------------------------------------------------------
const SCHEMA = "<schema>\n  ?{`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)`}\n</schema>";
const sseProg = (yieldExpr) => `<program>
  ${SCHEMA}
  <db src="app.db" protect="passwordHash" tables="users">
    \${
      server function* streamIt() route="/s" {
        let u = ?{\`SELECT * FROM users WHERE id = 1\`}.get()
        yield ${yieldExpr}
      }
    }
  </db>
  <div><p>hi</p></div>
</program>`;
const channelProg = (arg) => `<program>
  ${SCHEMA}
  <db src="app.db" protect="passwordHash" tables="users">
    \${ function noop() { return 1 } }
  </db>
  <channel name="chat" topic="lobby">
    \${
      <messages> = []
      function pushUser(id) {
        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
        broadcast(${arg})
      }
    }
  </>
  <div><p>hi</p></div>
</program>`;
const mountProg = (ret) => `<program db="sqlite:./app.db" auth="none">
${SCHEMA}
<db src="app.db" protect="passwordHash" tables="users"></db>
\${
  server function loadOne() {
    let u = ?{\`SELECT * FROM users WHERE id = 1\`}.get()
    return ${ret}
  }
  server function loadUsers() { return ?{\`SELECT * FROM users\`}.all() }
  <oneCell server> = loadOne()
  <userCell server> = loadUsers()
}
<main><p>\${@oneCell}</p><ul><each in=@userCell key=@.id as x><li>\${x.name}</li></each></ul></main>
</program>`;
const endpointProg = (ret) => `<program>
  ${SCHEMA}
  <db src="app.db" protect="passwordHash" tables="users">
    \${
      function loadOne(id) {
        let u = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
        return ${ret}
      }
    }
  </db>

type Op:enum = {
  Fetch(id: int)
}

<endpoint path="/gate" method="POST" accepts=Op>
  <Fetch(id) : loadOne(id)>
</endpoint>

</program>`;

describe("S441 every egress sink", () => {
  const cases = [
    ["SSE data frame", sseProg('{ event: "user", id: 1, data: u.passwordHash }'), sseProg('{ event: "user", id: 1, data: u }')],
    // `event` / `id` are serialized OUTSIDE the redact — the whole frame is the sink.
    ["SSE event name", sseProg("{ event: u.passwordHash, data: 1 }"), sseProg('{ event: "user", data: u.name }')],
    ["channel broadcast()", channelProg("u.passwordHash"), channelProg("u")],
    ["SSR /__serverLoad + /__mountHydrate", mountProg("u.passwordHash"), mountProg("u")],
    ["<endpoint> arm", endpointProg("u.passwordHash"), endpointProg("u")],
  ];
  for (const [name, leak, safe] of cases) {
    test(`${name}: an extracted scalar is rejected`, () => {
      expect(compileMem(leak).codes).toContain("E-PROTECT-006");
    });
    test(`${name}: the row (or a non-protected field) is not`, () => {
      expect(compileMem(safe).codes).not.toContain("E-PROTECT-006");
    });
  }
});

// ---------------------------------------------------------------------------
// 3. EXECUTED — what compiles still serves the right bytes
// ---------------------------------------------------------------------------
// happy-dom (registered globally by sibling browser tests in a full-suite run)
// strips the `Cookie` header from a spec-strict Request, so no session reaches a
// handler. The runtime exchanges need bun's native Request.
const domPolluted = () => typeof globalThis.document !== "undefined";

async function serveAndCall(src, argsJson, { realHash = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-protect-scalar-run-"));
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const dbPath = join(dir, "app.db");
  const db = new Database(dbPath, { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)");
  db.run("INSERT INTO users VALUES (1, ?, ?)", ["ada", realHash ? await Bun.password.hash("pw") : "SECRET-HASH-123"]);
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const serverJsPath = join(outDir, "app.server.js");
  expect(existsSync(serverJsPath)).toBe(true);
  writeFileSync(serverJsPath, readFileSync(serverJsPath, "utf8").replace(
    'new SQL("sqlite:./app.db")', `new SQL(${JSON.stringify("sqlite:" + dbPath)})`));
  globalThis.__scrml_session_store = new Map([["sid1", { userId: 1, role: "user", csrfToken: "tok1" }]]);
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => r.path.startsWith("/_scrml/__ri_route_"));
  const res = await route.handler(new Request("http://localhost" + route.path, {
    method: "POST",
    headers: { Cookie: "__Host-scrml_sid=sid1", "X-CSRF-Token": "tok1", "Content-Type": "application/json" },
    body: argsJson,
  }));
  return { result, status: res.status, body: await res.text() };
}

describe("S441 EXECUTED — the negatives still work on the wire", () => {
  test("a non-protected field of the protected row flows", async () => {
    if (domPolluted()) return;
    const { status, body } = await serveAndCall(prog(CLEAN["a non-protected field of the same row"][0]), "{}");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toBe("ada");
  });

  test("the row itself: 200, protected column stripped", async () => {
    if (domPolluted()) return;
    const { status, body } = await serveAndCall(prog(CLEAN["the row itself (the floor strips it)"][0]), "{}");
    expect(status).toBe(200);
    expect(body).not.toContain("SECRET-HASH-123");
    expect(JSON.parse(body)).toEqual({ id: 1, name: "ada" });
  });

  test("reveal is still the deliberate admit path", async () => {
    if (domPolluted()) return;
    const { status, body } = await serveAndCall(prog(CLEAN["reveal, then read (the declassify path)"][0]), "{}");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toBe("SECRET-HASH-123");
  });

  test("the canonical login verifies against the protected hash and never ships it", async () => {
    if (domPolluted()) return;
    const ok = await serveAndCall(LOGIN, JSON.stringify({ name: "ada", pw: "pw" }), { realHash: true });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, user: { id: 1, name: "ada" } });
    expect(ok.body).not.toContain("$argon2");
    const bad = await serveAndCall(LOGIN, JSON.stringify({ name: "ada", pw: "wrong" }), { realHash: true });
    expect(JSON.parse(bad.body)).toEqual({ ok: false });
  });
});
