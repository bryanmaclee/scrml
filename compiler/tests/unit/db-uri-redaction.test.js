/**
 * Credentials in a connection value never reach compiler output — and nothing
 * else is touched. (s430-dev-db-stub F4, round 3: redact by VALUE.)
 *
 * Round 1/2 redacted by PATTERN over arbitrary text; every review found a new
 * bypass (scheme case, leading space, other schemes, `#`/`&` in a value,
 * quoting, keyword form, percent-encoding) and the patterns also mangled
 * legitimate code frames. The compiler knows every connection value in the
 * unit, so it now derives each value's secret parts and removes exactly those
 * substrings at ONE output chokepoint (compileScrml), plus the non-compile
 * sinks (generate, introspect, LSP).
 *
 *   §1  deriveSecrets / SecretRedactor — unit level, incl. the no-mangle cases
 *   §2  the shared classifier: a driver-accepted URI is never a file path
 *   §3  END-TO-END `scrml compile`: every review bypass input — stdout+stderr
 *       carry no secret, and the diagnostic that echoes it did fire
 *   §4  END-TO-END negative: legitimate code frames print UNCHANGED
 *   §5  `scrml generate auth` (R2-2) and `scrml introspect`
 *   §6  LSP analyzeText diagnostics
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { deriveSecrets, SecretRedactor, harvestFromSource } from "../../src/diagnostic-secrets.ts";
import { redactDbUri } from "../../src/db-uri-redact.ts";
import { classifyDbTarget } from "../../src/db-target.ts";
import { resolveDbDriver } from "../../src/codegen/db-driver.ts";
import { runPA } from "../../src/protect-analyzer.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.js");

// Every bypass input the round-2 review found. `secret` is the substring that
// must never be printed; `value` is the db=/src= value as written in source.
const BYPASS = [
  { name: "uppercase scheme POSTGRES://", value: "POSTGRES://admin:SecA1upper@db.example/app", secret: "SecA1upper" },
  { name: "leading space", value: " postgres://admin:SecA2lead@db.example/app", secret: "SecA2lead" },
  { name: "mongodb://", value: "mongodb://admin:SecA3mongo@m.example/app", secret: "SecA3mongo" },
  { name: "mariadb://", value: "mariadb://admin:SecA4maria@m.example/app", secret: "SecA4maria" },
  { name: "sqlite:// with userinfo", value: "sqlite://admin:SecA5sqlite@x.db", secret: "SecA5sqlite" },
  { name: "postgres+ssl://", value: "postgres+ssl://admin:SecA6plus@db.example/app", secret: "SecA6plus" },
  { name: "?password= with # inside", value: "postgres://db.example/app?sslmode=require&password=SecA7ab#cd", secret: "SecA7ab" },
  { name: "passwd= keyword", value: "host=db.example passwd=SecA8passwd dbname=app", secret: "SecA8passwd" },
  { name: "percent-encoded password%3D", value: "postgres://db.example/app?password%3DSecA9enc", secret: "SecA9enc" },
  { name: "quoted keyword with a space", value: "host=db.example password='SecB1 s3 cret' dbname=app", secret: "SecB1 s3 cret" },
  { name: "userinfo with quote and space", value: "postgres://admin:SecB2'q s@db.example/app", secret: "SecB2'q s" },
  { name: "userinfo with <", value: "postgres://admin:SecB3<lt@db.example/app", secret: "SecB3<lt" },
];

describe("§1 value-derived secrets", () => {
  for (const c of BYPASS) {
    test(`deriveSecrets finds the secret — ${c.name}`, () => {
      const r = new SecretRedactor([c.value]);
      expect(r.redact(`echo: ${c.value} :end`)).not.toContain(c.secret);
    });
  }

  test("text with no collected secret is returned byte-identical", () => {
    const r = new SecretRedactor(["postgres://admin:Neg1Secret0@db.example/app"]);
    for (const line of [
      "    fetch(`https://api.x.com/u/${@count}`)",
      "import { x } from '@scope/pkg'",
      "    <Login password=@password pwd=@pw/>",
      "<p>see https://user@example.com/a</p>",
      "E-PA-004: Table `items` was not found",
    ]) {
      expect(r.redact(line)).toBe(line);
    }
  });

  test("a short secret is not scrubbed out of unrelated words", () => {
    const r = new SecretRedactor(["postgres://u:pa@db.example/app"]);
    expect(r.redact("parse the path")).toBe("parse the path");
    expect(r.redact("value postgres://u:pa@db.example/app")).not.toContain(":pa@");
  });

  test("redactDbUri display form: userinfo hidden, derived secrets hidden", () => {
    expect(redactDbUri("postgres://admin:S3cretPW@db.example:5432/app")).toBe("postgres://<redacted>@db.example:5432/app");
    expect(redactDbUri("host=h password='a b c' dbname=x")).not.toContain("a b c");
    for (const s of ["./app.db", "sqlite:./app.db", ":memory:"]) expect(redactDbUri(s)).toBe(s);
  });

  test("harvestFromSource finds db= / src= / *-store= values in either quote style", () => {
    const v = harvestFromSource(`<program db="a://1" idempotency-store='b://2'>\n<db src='c://3' tables="t">`);
    expect(v).toEqual(["a://1", "b://2", "c://3"]);
  });
});

describe("§2 one classifier (R2-1)", () => {
  test("a driver-accepted Postgres URI is classified postgres regardless of case / whitespace", () => {
    for (const v of ["POSTGRES://a:b@h/x", " postgres://a:b@h/x", "PostgreSQL://a:b@h/x"]) {
      expect(classifyDbTarget(v).kind).toBe("postgres");
      expect(resolveDbDriver(v).ok).toBe(true);
    }
  });

  test("protect-analyzer does not treat POSTGRES:// or a leading-space URI as a file path", () => {
    for (const v of ["POSTGRES://admin:SecC1@db.example/app", " postgres://admin:SecC1@db.example/app"]) {
      const span = { file: "/v/a.scrml", start: 0, end: 10, line: 1, col: 1 };
      const ast = {
        filePath: "/v/a.scrml",
        nodes: [{ id: 1, kind: "state", stateType: "db", children: [], span, attrs: [
          { name: "src", value: { kind: "string-literal", value: v }, span },
          { name: "tables", value: { kind: "string-literal", value: "items" }, span },
        ] }],
      };
      const notes = [];
      const { errors } = runPA({ files: [ast], onNote: (l) => notes.push(l) });
      const e = errors.find((x) => x.code === "E-PA-002");
      expect(e.message).toContain("Driver URI");
      expect(e.message).not.toContain("Database file");
      expect(e.message).not.toContain("SecC1");
    }
  });

  test("a sqlite: prefix is stripped to its path for the schema read", () => {
    expect(classifyDbTarget("sqlite:./app.db").sqlitePath).toBe("./app.db");
    expect(classifyDbTarget("sqlite://x.db").sqlitePath).toBe("x.db");
  });
});

function compileFile(dir, name, body) {
  const f = join(dir, name);
  writeFileSync(f, body);
  const r = Bun.spawnSync([process.execPath, CLI, "compile", f, "-o", join(dir, "dist-" + name)], {
    stdout: "pipe", stderr: "pipe",
  });
  return r.stdout.toString() + "\n" + r.stderr.toString();
}

describe("§3 END-TO-END: no bypass input prints its secret", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-e2e-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  BYPASS.forEach((c, i) => {
    test(`<program db> + <db src> — ${c.name}`, () => {
      // No DDL: the <db> block fires a diagnostic whose code frame shows the
      // src= line (line 2), so both the message and the excerpt are exercised.
      const out = compileFile(dir, `b${i}.scrml`,
        `<program db="${c.value}">\n  <db src="${c.value}" tables="items">\n    \${\n      function n() {\n        return ?{\`SELECT id FROM items\`}.all()\n      }\n    }\n    <p>x</p>\n  </db>\n</program>\n`);
      expect(out).toMatch(/E-PA-00\d|E-SQL-005|Note\(PA\)/);
      expect(out).toContain("<redacted>");
      expect(out).not.toContain(c.secret);
    });
  });

  test("single-quoted src= (mis-tokenized by the <db> opener — the tree never sees the value)", () => {
    // Pre-existing parse quirk: `<db src='…'>` on a state opener splits the
    // value into attribute NAMES, so only the source harvest knows it.
    const v = "postgres://admin:SecG1single@db.example/app";
    const out = compileFile(dir, "single.scrml",
      `<program db="postgres://db.example/app">\n  <db src='${v}' tables="items">\n    <p>x</p>\n  </db>\n</program>\n`);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("SecG1single");
  });

  test("unquoted db= / src= (shredded into attribute names by the parser)", () => {
    const out = compileFile(dir, "unquoted.scrml",
      `<program db=postgres://admin:SecG2unq@db.example/app>\n  <db src=postgres://admin:SecG2unq@db.example/app tables="items">\n    <p>x</p>\n  </db>\n</program>\n`);
    expect(out).not.toContain("SecG2unq");
  });

  test("a value with an escaped quote (only the TREE has the whole value)", () => {
    const v = 'sqlite://admin:SecG3\\"esc@x.db';
    const out = compileFile(dir, "escq.scrml",
      `<program db="postgres://db.example/app">\n  <db src="${v}" tables="items">\n    <p>x</p>\n  </db>\n</program>\n`);
    expect(out).toContain("E-PA-00");
    expect(out).not.toContain("SecG3");
  });

  test("Note(PA) on the FILE branch (a sqlite-classified value carrying a secret) passes the chokepoint", () => {
    const v = "sqlite://admin:SecH1note@x.db";
    const out = compileFile(dir, "notefile.scrml",
      `<program db="${v}">\n  <db src="${v}" tables="items">\n    \${\n      function mk() {\n        ?{\`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)\`}.run()\n      }\n    }\n    <p>x</p>\n  </db>\n</program>\n`);
    expect(out).toContain("Note(PA)");
    expect(out).not.toContain("SecH1note");
  });

  test("API level: compileScrml's returned diagnostics carry no secret (dev / build / serve read these)", async () => {
    const { compileScrml } = await import("../../src/api.js");
    const v = "sqlite://admin:SecI1api@x.db";
    const f = join(dir, "api.scrml");
    writeFileSync(f, `<program db="${v}">\n  <db src="${v}" tables="items">\n    <p>x</p>\n  </db>\n</program>\n`);
    const orig = process.stderr.write;
    process.stderr.write = () => true;
    let result;
    try {
      result = compileScrml({ inputFiles: [f], outputDir: join(dir, "dist-api"), write: false, log: () => {} });
    } finally {
      process.stderr.write = orig;
    }
    const all = [...result.errors, ...result.warnings, ...(result.lintDiagnostics ?? [])];
    expect(all.some((d) => d.code === "E-PA-002")).toBe(true);
    expect(JSON.stringify(all.map((d) => d.message))).not.toContain("SecI1api");
    expect(result.redact(`x ${v} y`)).not.toContain("SecI1api");
  });

  test("Note(PA) path (DDL present) prints no secret", () => {
    const v = "POSTGRES://admin:SecD1note@db.example/app";
    const out = compileFile(dir, "note.scrml",
      `<program db="${v}">\n  <db src="${v}" tables="items">\n    \${\n      function mk() {\n        ?{\`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)\`}.run()\n      }\n    }\n    <p>x</p>\n  </db>\n</program>\n`);
    expect(out).toContain("Note(PA)");
    expect(out).not.toContain("SecD1note");
  });
});

describe("§4 END-TO-END negative: legitimate code frames print UNCHANGED", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-neg-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("`${@count}` URL, @scope/pkg and password=@password props survive in the excerpt", () => {
    const lines = [
      "    <p>fetch(`https://api.x.com/u/${@count}`)</p>",
      "    <p>@scope/pkg</p>",
      "    <Login password=@password pwd=@pw/>",
    ];
    const out = compileFile(dir, "neg.scrml",
      `<program db="postgres://admin:Neg1Secret0@db.example/app">\n  <db src="postgres://admin:Neg1Secret0@db.example/app" tables="items">\n${lines.join("\n")}\n  </db>\n</program>\n`);
    // The E-PA-002 on line 2 prints lines 1-4 as its excerpt.
    expect(out).toContain("E-PA-002");
    expect(out).not.toContain("Neg1Secret0");
    for (const l of lines) expect(out).toContain(l);
  });
});

describe("§5 generate + introspect", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-gen-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("`scrml generate auth` — the detected <db src> line prints no secret (R2-2)", () => {
    writeFileSync(join(dir, "app.scrml"),
      `<program db="postgres://admin:SecE1gen@db.example/app">\n  <db src="postgres://admin:SecE1gen@db.example/app" tables="users">\n    <p>x</p>\n  </db>\n</program>\n`);
    const r = Bun.spawnSync([process.execPath, CLI, "generate", "auth"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const out = r.stdout.toString() + r.stderr.toString();
    expect(out).toContain("detected <db src=");
    expect(out).not.toContain("SecE1gen");
  });

  test("`scrml introspect` — a non-Postgres URL error prints no secret", () => {
    const r = Bun.spawnSync([process.execPath, CLI, "introspect", "mysql://admin:SecE2intro@h/x"], { stdout: "pipe", stderr: "pipe" });
    const out = r.stdout.toString() + r.stderr.toString();
    expect(out).toContain("Postgres-only");
    expect(out).not.toContain("SecE2intro");
  });
});

describe("§6 LSP diagnostics", () => {
  test("analyzeText messages carry no secret", async () => {
    const { analyzeText } = await import("../../../lsp/handlers.js");
    // sqlite-classified: the protect-analyzer echoes the resolved PATH (with the
    // secret in it), so only the LSP sink's value-based redaction removes it.
    const v = "sqlite://admin:SecF1lsp@x.db";
    const text = `<program db="${v}">\n  <db src="${v}" tables="items">\n    <p>x</p>\n  </db>\n</program>\n`;
    const orig = process.stderr.write;
    let err = "";
    process.stderr.write = (chunk) => { err += String(chunk); return true; };
    let res;
    try {
      res = analyzeText("/virtual/lsp.scrml", text);
    } finally {
      process.stderr.write = orig;
    }
    expect(res.diagnostics.some((d) => d.code === "E-PA-002")).toBe(true);
    for (const d of res.diagnostics) expect(d.message).not.toContain("SecF1lsp");
    expect(err).not.toContain("SecF1lsp");
  });
});
