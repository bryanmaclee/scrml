/**
 * s432 — db connection-value redaction is SHAPE-INDEPENDENT.
 *
 * PR #1047's redactor recognised a denylist of well-formed shapes (userinfo
 * only after a leading `scheme://`; only five named password keys), so it
 * leaked exactly when a diagnostic fired on a MALFORMED value:
 *
 *   F1  `postgres:/u:p@h` (one-slash typo), `jdbc:postgresql://u:p@h`, a
 *       zero-width char before the scheme — E-PA-002 path + `db-migrate`
 *       remedy + source frame, `scrml introspect`;
 *   F2  `?authToken=`, `?token=`, `?%70assword=` — E-SQL-005 + frame,
 *       `scrml introspect`, the `scrml dev` compile-error overlay;
 *   F3  an UNQUOTED `db=` value is split into attribute NAMES, which
 *       W-ATTR-001 / E-PAGE-INVALID-ATTR echo — the password in pieces.
 *
 *   §1  table: displayConnectionValue (what is hidden, what stays visible)
 *   §2  SecretRedactor: messages vs source excerpts, multiple values
 *   §3  END-TO-END `scrml compile` of every repro: the secret appears NOWHERE
 *   §4  `scrml introspect` / `scrml db-migrate`
 *   §5  the `scrml dev` overlay (HTML + JSON) and the LSP
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { displayConnectionValue, SecretRedactor, connectionFragmentAttrs } from "../../src/diagnostic-secrets.ts";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.js");
const BS = String.fromCharCode(92);
const ZWSP = "​";

// ---------------------------------------------------------------------------
// §1 display form
// ---------------------------------------------------------------------------

// [name, value, secrets that must be gone, substrings that must stay visible]
const TABLE = [
  ["F1 one-slash typo", "postgres:/app:Pw9sec@db.internal/app", ["Pw9sec", "app:"], ["postgres:/", "@db.internal/app"]],
  ["F1 jdbc:", "jdbc:postgresql://app:Pw9sec@db.internal/app", ["Pw9sec"], ["jdbc:postgresql://", "@db.internal/app"]],
  ["F1 zero-width prefix", `${ZWSP}postgres://u:ZwSEC1@h/app`, ["ZwSEC1"], ["postgres://", "@h/app"]],
  ["F1 zero-width inside the userinfo", `postgres://u:Zw${ZWSP}SEC2@h/app`, ["SEC2", "u:Zw"], ["@h/app"]],
  ["F2 ?authToken=", "libsql://mydb.turso.io?authToken=TOKsecret9Q", ["TOKsecret9Q"], ["libsql://mydb.turso.io?authToken="]],
  ["F2 ?token=", "redis://cache:6379?token=RedTok55x", ["RedTok55x"], ["redis://cache:6379?token="]],
  ["F2 ?%70assword=", "postgres://h/app?%70assword=PctPw66y", ["PctPw66y"], ["postgres://h/app?%70assword="]],
  ["F2 encoded ?/= (%3F %3D)", "postgres://h/app%3Fpassword%3DEncSep7", ["EncSep7"], ["postgres://h/app"]],
  ["F2 every param value, names kept", "postgres://h/app?sslmode=require&api_key=K3y9", ["K3y9", "require"], ["sslmode=", "api_key="]],
  ["keyword DSN", "host=h password=Kw8x dbname=app", ["Kw8x"], ["host=", "password=", "dbname="]],
  ["quoted keyword value", "host=h password='a b Qv9' dbname=app", ["a b Qv9", "Qv9"], ["password="]],
  ["unterminated quote runs to the end", "host=h password='Unt3rm dbname=app", ["Unt3rm"], ["password="]],
  ["ODBC ;k=v with {braces}", "Server=h;Database=d;Pwd={a;B9r}x;", ["B9r"], ["Server=", "Pwd="]],
  ["JDBC ;k=v", "jdbc:sqlserver://h:1433;databaseName=d;password=JdSc7", ["JdSc7"], ["jdbc:sqlserver://h:1433;"]],
  ["@ in the password", "mysql://u:p@ss:w0rd@h/db", ["p@ss", "w0rd"], ["mysql://", "@h/db"]],
  [": in the password", "postgres://u:a:b:C0l@h/db", ["a:b:C0l", "C0l"], ["postgres://", "@h/db"]],
  ["/ in the password (F3 shape, quoted)", "postgres://app:ab/Sl4sh@h/app", ["Sl4sh", "ab/"], ["postgres://", "@h/app"]],
  ["// in the password", "postgres://app:k3J9//Xq8zz@h/app", ["Xq8zz", "k3J9"], ["postgres://", "@h/app"]],
  ["percent-encoded @ in the password", "postgres://u:p%40Enc1@h/db", ["Enc1"], ["@h/db"]],
  ["IPv6 host", "postgres://u:V6sec@[::1]:5432/app", ["V6sec"], ["@[::1]:5432/app"]],
  ["no // , no scheme separator", "postgres:app:NoSl4@h", ["NoSl4"], ["postgres:", "@h"]],
  ["bare user:pass@host", "app:Bare5@host", ["Bare5"], ["@host"]],
  ["user-only userinfo (a bearer token)", "redis://TokUser7@cache/0", ["TokUser7"], ["redis://", "@cache/0"]],
  ["failover list (two URIs)", "postgres://u:FoA1@h1,postgres://u:FoB2@h2/db", ["FoA1", "FoB2"], ["postgres://", "@h2/db"]],
];

// Values that are NOT secret: returned byte-identical (the E-PA-002 remedy
// stays copy-pasteable for them).
const PLAIN = [
  "./app.db", "sqlite:./app.db", ":memory:", "sqlite://x.db", "data/app.db",
  "./data/me@home.db", `C:${BS}x${BS}a@b.db`, "sqlite:///abs/a@b.db", "sqlite:./x@y.db",
  "postgres://db.example:5432/app", "postgres://[::1]:5432/app",
];

describe("§1 displayConnectionValue — shape-independent", () => {
  for (const [name, value, gone, kept] of TABLE) {
    test(name, () => {
      const shown = displayConnectionValue(value);
      expect(shown).toContain("<redacted>");
      for (const s of gone) expect(shown).not.toContain(s);
      for (const k of kept) expect(shown).toContain(k);
    });
  }

  for (const v of PLAIN) {
    test(`plain value unchanged: ${JSON.stringify(v)}`, () => {
      expect(displayConnectionValue(v)).toBe(v);
    });
  }

  test("postgres://user@host (no password): the user is hidden — a user-only userinfo is routinely a token", () => {
    expect(displayConnectionValue("postgres://appuser@db.example/app")).toBe("postgres://<redacted>@db.example/app");
  });
});

// ---------------------------------------------------------------------------
// §2 the redactor
// ---------------------------------------------------------------------------

describe("§2 SecretRedactor", () => {
  test("every TABLE value echoed in a message is redacted (whole, trimmed, and as its fragments)", () => {
    for (const [, value, gone] of TABLE) {
      const r = new SecretRedactor([value]);
      const msg = r.redact(`E-X: \`${value}\` and trimmed ${value.trim()} end`);
      for (const s of gone) expect(msg).not.toContain(s);
    }
  });

  test("multiple connection values in one text are all redacted", () => {
    const a = "postgres:/u:MultA1@h1/app";
    const b = "libsql://t.io?authToken=MultB2";
    const r = new SecretRedactor([a, b]);
    const out = r.redact(`first ${a} then ${b} done`);
    expect(out).not.toContain("MultA1");
    expect(out).not.toContain("MultB2");
    expect(out).toContain("first postgres:/<redacted>@h1/app then libsql://t.io?authToken=<redacted> done");
  });

  test("a source excerpt: the attribute value is redacted at its span, ordinary k=v code is untouched", () => {
    const v = "postgres://h/app?x=1&authToken=SrcTok3";
    const r = new SecretRedactor([v]);
    const src = `<program db="${v}">\n  let x=1\n  const s = "a:b"\n</program>`;
    const out = r.redactSource(src);
    expect(out).not.toContain("SrcTok3");
    expect(out).toContain("  let x=1\n");
    expect(out).toContain('  const s = "a:b"');
  });

  test("a frame scan survives an unquoted `${… > …}` attribute before db= (does not end the tag early)", () => {
    const src = `<program onload=\${() => 1 > 0} db="postgres://bu:BrSec4@h/app">\n</program>`;
    const out = new SecretRedactor().redactSource(src);
    expect(out).not.toContain("BrSec4");
  });

  test("connectionFragmentAttrs is positional: attributes after an UNQUOTED db= value, quoted ones excluded", () => {
    const attrs = [
      { name: "db", value: { kind: "variable-ref", name: "postgres" } },
      { name: "app:ab", value: { kind: "absent" } },
      { name: "cd@h", value: { kind: "absent" } },
      { name: "tables", value: { kind: "string-literal", value: "users" } },
    ];
    const r = connectionFragmentAttrs("program", attrs);
    expect(r.via).toBe("db");
    expect(r.fragments.map((a) => a.name)).toEqual(["app:ab", "cd@h"]);
    expect(connectionFragmentAttrs("program", [{ name: "db", value: { kind: "string-literal", value: "x" } }, { name: "y", value: { kind: "absent" } }]).fragments).toEqual([]);
    expect(connectionFragmentAttrs("p", attrs).fragments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 end to end
// ---------------------------------------------------------------------------

function run(args, cwd) {
  const r = Bun.spawnSync([process.execPath, CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return r.stdout.toString() + "\n" + r.stderr.toString();
}

const USE_DB = "  function getUsers() {\n      return ?{`SELECT id FROM users`}.all()\n  }\n";

// [name, source, secret substrings, a code the output must carry]
const E2E = [
  ["F1 typo (program db + <db src>)", (v) => `<program db="${v}">\n  < db src="${v}" tables="users">\n${USE_DB}  </>\n  <p>hi</p>\n</program>\n`,
    "postgres:/app:Pw9sec@db.internal/app", ["Pw9sec"], "E-PA-002"],
  ["F1 jdbc: (program db + <db src>)", (v) => `<program db="${v}">\n  < db src="${v}" tables="users">\n${USE_DB}  </>\n  <p>hi</p>\n</program>\n`,
    "jdbc:postgresql://app:Pw9sec@db.internal/app", ["Pw9sec"], "E-PA-002"],
  ["F1 zero-width prefix", (v) => `<program db="${v}">\n  < db src="${v}" tables="users">\n${USE_DB}  </>\n  <p>hi</p>\n</program>\n`,
    `${ZWSP}postgres://u:ZwSecret44@db.internal/app`, ["ZwSecret44"], "E-PA-002"],
  ["F2 ?authToken= (E-SQL-005 + frame)", (v) => `<program db="${v}">\n${USE_DB}  <p>hi</p>\n</program>\n`,
    "libsql://mydb.turso.io?authToken=TOKsecret9Q", ["TOKsecret9Q"], "E-SQL-005"],
  ["F2 ?token=", (v) => `<program db="${v}">\n  <p>hi</p>\n</program>\n`,
    "redis://cache.internal:6379?token=RedTok55x&user=a", ["RedTok55x"], "E-SQL-005"],
  ["F2 ?%70assword=", (v) => `<program db="${v}">\n  < db src="${v}" tables="users">\n${USE_DB}  </>\n  <p>hi</p>\n</program>\n`,
    "postgres://db.internal/app?%70assword=PctPw66y", ["PctPw66y"], "E-PA-002"],
  ["keyword DSN with a quoted password", (v) => `<program db="${v}">\n  < db src="${v}" tables="users">\n${USE_DB}  </>\n  <p>hi</p>\n</program>\n`,
    "host=db.internal password='Dsn Pw 77' dbname=app", ["Dsn Pw 77", "Pw 77"], "E-PA-002"],
  ["F3 unquoted db= with / in the password", () => `<program db=postgres://app:ab/cd@h/app>\n${USE_DB}  <p>hi</p>\n</program>\n`,
    null, ["app:ab", "cd@h", "ab/cd"], "W-ATTR-001"],
  ["F3 unquoted db= — a middle piece carries no : or @", () => `<program db=postgres://app:ab/Mid9Piece/cd@h/app>\n${USE_DB}  <p>hi</p>\n</program>\n`,
    null, ["Mid9Piece", "app:ab"], "W-ATTR-001"],
  ["F3 unquoted <page db=> (E-PAGE-INVALID-ATTR echoes the names)", () => `<program>\n  <page route="/" db=postgres://pu:pq/PgMid7Piece/x@h2/app>\n    <p>hello</p>\n  </page>\n</program>\n`,
    null, ["PgMid7Piece", "pu:pq", "x@h2"], "E-PAGE-INVALID-ATTR"],
  ["frame context line carries a malformed value (error elsewhere)", (v) => `<program db="${v}">\n  <p>\${undefinedThing}</p>\n</program>\n`,
    "postgres:/fu:FrameCtx9@db.internal/app", ["FrameCtx9"], "E-SCOPE-001"],
];

describe("§3 END-TO-END scrml compile: the secret appears nowhere in stdout+stderr", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-s432-e2e-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  E2E.forEach(([name, body, value, secrets, code], i) => {
    test(name, () => {
      const sub = join(dir, `c${i}`);
      mkdirSync(sub, { recursive: true });
      const f = join(sub, "app.scrml");
      writeFileSync(f, body(value));
      const out = run(["compile", f, "-o", join(sub, "out")], sub);
      const outV = run(["compile", f, "-o", join(sub, "outv"), "--verbose"], sub);
      expect(out).toContain(code);
      for (const s of secrets) {
        expect(out).not.toContain(s);
        expect(outV).not.toContain(s);
      }
    });
  });

  test("E-PA-002 remedy stays copy-pasteable for a plain sqlite path", () => {
    const sub = join(dir, "plain");
    mkdirSync(sub, { recursive: true });
    const f = join(sub, "app.scrml");
    writeFileSync(f, `<program db="./missing.db">\n  < db src="./missing.db" tables="users">\n${USE_DB}  </>\n  <p>hi</p>\n</program>\n`);
    const out = run(["compile", f, "-o", join(sub, "out")], sub);
    expect(out).toContain("E-PA-002");
    expect(out).toMatch(/scrml db-migrate \. --db \S*missing\.db/);
    expect(out).not.toContain("<redacted>");
  });
});

// ---------------------------------------------------------------------------
// §4 introspect / db-migrate
// ---------------------------------------------------------------------------

describe("§4 scrml introspect / scrml db-migrate", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "scrml-s432-cli-"));
    writeFileSync(join(dir, "app.scrml"),
      `<program db="./x.db">\n  < schema>\n    users { id: integer primary key, name: text }\n  </>\n  <p>hello</p>\n</program>\n`);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const URLS = [
    ["jdbc:postgresql://app:IntJd1x@db.internal/app", "IntJd1x"],
    ["postgres:/app:IntTy2x@db.internal/app", "IntTy2x"],
    ["libsql://mydb.turso.io?authToken=IntTok3x", "IntTok3x"],
    [`${ZWSP}postgres://u:IntZw4x@db.internal/app`, "IntZw4x"],
  ];
  for (const [url, secret] of URLS) {
    test(`introspect ${JSON.stringify(url)}`, () => {
      const out = run(["introspect", url], dir);
      expect(out).toContain("error");
      expect(out).not.toContain(secret);
    });
    test(`db-migrate --db ${JSON.stringify(url)}`, () => {
      const out = run(["db-migrate", ".", "--db", url, "--dry-run"], dir);
      expect(out).toContain("error");
      expect(out).not.toContain(secret);
    });
  }
});

// ---------------------------------------------------------------------------
// §5 dev overlay + LSP
// ---------------------------------------------------------------------------

describe("§5 scrml dev overlay and LSP", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-s432-dev-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const CASES = [
    ["libsql://mydb.turso.io?authToken=DevTok9Q", "DevTok9Q", (v) => `<program db="${v}">\n${USE_DB}  <p>hi</p>\n</program>\n`],
    ["postgres:/app:DevTy8x@db.internal/app", "DevTy8x", (v) => `<program db="${v}">\n  < db src="${v}" tables="users">\n${USE_DB}  </>\n  <p>hi</p>\n</program>\n`],
    [null, "DevMid7Piece", () => `<program>\n  <page route="/" db=postgres://pu:pq/DevMid7Piece/x@h2/app>\n    <p>hello</p>\n  </page>\n</program>\n`],
  ];

  CASES.forEach(([value, secret, body], i) => {
    test(`overlay (HTML + JSON) carries no secret — ${secret}`, async () => {
      const { compileScrml } = await import("../../src/api.js");
      const { buildCompileErrorResponse } = await import("../../src/commands/dev.js");
      const f = join(dir, `d${i}.scrml`);
      writeFileSync(f, body(value));
      const orig = process.stderr.write;
      process.stderr.write = () => true;
      let result;
      try {
        result = compileScrml({ inputFiles: [f], outputDir: join(dir, `out${i}`), write: false, log: () => {} });
      } finally {
        process.stderr.write = orig;
      }
      expect(result.errors.length).toBeGreaterThan(0);
      const failure = { errors: result.errors, warnings: result.warnings };
      const html = await buildCompileErrorResponse(new Request("http://x/", { headers: { accept: "text/html" } }), failure).text();
      const json = await buildCompileErrorResponse(new Request("http://x/api", { headers: { accept: "application/json" } }), failure).text();
      expect(html).toContain("compile failed");
      expect(html).not.toContain(secret);
      expect(json).not.toContain(secret);
      const all = [...result.errors, ...result.warnings, ...(result.lintDiagnostics ?? [])];
      expect(JSON.stringify(all.map((d) => d.message))).not.toContain(secret);
    });

    test(`LSP analyzeText carries no secret — ${secret}`, async () => {
      const { analyzeText } = await import("../../../lsp/handlers.js");
      const orig = process.stderr.write;
      process.stderr.write = () => true;
      let res;
      try {
        res = analyzeText(join(dir, `l${i}.scrml`), body(value));
      } finally {
        process.stderr.write = orig;
      }
      expect(res.diagnostics.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.diagnostics.map((d) => d.message))).not.toContain(secret);
    });
  });
});

// ---------------------------------------------------------------------------
// §6 round 2 — regressions the first cut introduced
// ---------------------------------------------------------------------------

describe("§6 r2: drive-letter exemption, long-secret precision, file params, fail-safe scan, F3 scope", () => {
  test("a one-letter user + `/`-leading password after `//` is userinfo, not a drive letter", () => {
    for (const [v, secret] of [
      ["postgres://u:/etc/PathSec6@h/app", "PathSec6"],
      ["postgres://x:/S3dr@h", "S3dr"],
      ["redis://r:/S4dr@h:6379", "S4dr"],
      [`postgres://u:${BS}S5dr@h/app`, "S5dr"],
    ]) {
      const shown = displayConnectionValue(v);
      expect(shown).not.toContain(secret);
      expect(shown).toContain("<redacted>@h");
    }
  });

  test("a real drive letter at the START of a path stays unredacted", () => {
    for (const v of [`C:${BS}x${BS}a@b.db`, "C:/x/a@b.db", "sqlite:C:/x/a@b.db", `sqlite:C:${BS}x${BS}a@b.db`, "file:///C:/x/a@b.db"]) {
      expect(displayConnectionValue(v)).toBe(v);
    }
  });

  test("the long-secret backstop never holds a username, db name or ordinary param value", () => {
    const r = new SecretRedactor([
      "postgres://orders_service:pw@h/orders_service",
      "postgres://h/db?application_name=inventory-api-v2",
    ]);
    expect(r.redact("SELECT id FROM orders_service")).toBe("SELECT id FROM orders_service");
    expect(r.redact("app inventory-api-v2 started")).toBe("app inventory-api-v2 started");
    const src = "  <p>${orders_service + missingThing}</p>\n  ?{`SELECT id FROM orders_service`}";
    expect(r.redactSource(src)).toBe(src);
  });

  test("the long-secret backstop keeps password-class material (userinfo password, secret-named or token-shaped param)", () => {
    const r = new SecretRedactor([
      "postgres://app:Longpassw0rd!!@h/app",
      "libsql://t.io?authToken=abc123def456ghi",
      "redis://h?x=AbCdEf0123456789Zz",
    ]);
    const out = r.redact("normalized: Longpassw0rd!! abc123def456ghi AbCdEf0123456789Zz");
    expect(out).not.toContain("Longpassw0rd");
    expect(out).not.toContain("abc123def456ghi");
    expect(out).not.toContain("AbCdEf0123456789Zz");
  });

  test("e2e: a username equal to a table/identifier name does not shred the frame or messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-s432-over-"));
    try {
      const f = join(dir, "app.scrml");
      writeFileSync(f, `<program db="postgres://orders_service:pw@h/orders_service">\n  const orders_service = 1\n  function getUsers() {\n      return ?{\`SELECT id FROM orders_service\`}.all()\n  }\n  <p>\${orders_service + missingThing}</p>\n</program>\n`);
      const out = run(["compile", f, "-o", join(dir, "out")], dir);
      expect(out).toContain("missingThing");
      expect(out).toContain("SELECT id FROM orders_service");
      expect(out).toContain("${orders_service + missingThing}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("local file values keep open flags (copy-pasteable); a SQLCipher key is still hidden", () => {
    for (const v of ["sqlite:./data/app.db?mode=ro", "./my db=1.db", "file:./a.db?cache=shared&immutable=1", "sqlite:///abs/a.db?mode=ro", "app.db?mode=ro"]) {
      expect(displayConnectionValue(v)).toBe(v);
    }
    expect(displayConnectionValue("sqlite:./a.db?key=SqlCiph9")).toBe("sqlite:./a.db?key=<redacted>");
    expect(displayConnectionValue("file:./a.db?cache=shared&hexkey=ABCD1234")).toBe("file:./a.db?cache=shared&hexkey=<redacted>");
    // Not a file: a keyword DSN, a typo'd URI, an authority URI — every value hidden.
    expect(displayConnectionValue("host=h dbname=app")).toBe("host=<redacted> dbname=<redacted>");
    expect(displayConnectionValue("postgres:/h/app?mode=Mx1")).not.toContain("Mx1");
    expect(displayConnectionValue("sqlite://h/app?mode=Mx2")).not.toContain("Mx2");
  });

  test("e2e: E-PA-002 remedy for sqlite:./data/app.db?mode=ro stays copy-pasteable", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-s432-mode-"));
    try {
      const f = join(dir, "app.scrml");
      writeFileSync(f, `<program db="./a.db">\n  < db src="sqlite:./data/app.db?mode=ro" tables="users">\n${USE_DB}  </>\n</program>\n`);
      const out = run(["compile", f, "-o", join(dir, "out")], dir);
      expect(out).toContain("E-PA-002");
      expect(out).toContain("mode=ro");
      expect(out).not.toContain("<redacted>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the text scan fails SAFE: quotes inside braces, and an unterminated ${, cannot hide db=", () => {
    const q = '"';
    for (const [src, secret] of [
      [`<program x={/${q}/.test(y)} db=${q}postgres://u:R1sc@h${q}>`, "R1sc"],
      [`<program x={a /* ${q} */} db=${q}postgres://u:R2sc@h${q}>`, "R2sc"],
      [`<program x={don't} db=${q}postgres://u:R3sc@h${q}>`, "R3sc"],
      [`<program x=\${\`a\${b}\`} db=${q}postgres://u:R4sc@h${q}>`, "R4sc"],
      [`<program x={a}}} db=${q}postgres://u:R5sc@h${q}>`, "R5sc"],
      [`<program x=\${unterminated db=${q}postgres://u:R6sc@h${q}>\n<p>rest</p>`, "R6sc"],
      [`<program on:load=\${() => a > b} db=${q}postgres://u:R7sc@h${q}>`, "R7sc"],
    ]) {
      expect(new SecretRedactor().redactSource(src)).not.toContain(secret);
    }
  });

  test("F3 fires only for an unquoted TEXT db= value — not db=${…} or db=@ref", () => {
    const after = [{ name: "bogusattr", value: { kind: "absent" } }];
    expect(connectionFragmentAttrs("program", [{ name: "db", value: { kind: "expr", raw: "conn" } }, ...after]).fragments).toEqual([]);
    expect(connectionFragmentAttrs("program", [{ name: "db", value: { kind: "variable-ref", name: "@conn" } }, ...after]).fragments).toEqual([]);
    expect(connectionFragmentAttrs("program", [{ name: "db", value: { kind: "variable-ref", name: "postgres" } }, ...after]).fragments.length).toBe(1);
    const dir = mkdtempSync(join(tmpdir(), "scrml-s432-f3-"));
    try {
      const f = join(dir, "app.scrml");
      writeFileSync(f, "<program db=${conn} bogusattr>\n  <p>x</p>\n</program>\n");
      const out = run(["compile", f, "-o", join(dir, "out")], dir);
      expect(out).toContain("Attribute `bogusattr=` is not recognized");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
