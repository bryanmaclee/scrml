/**
 * s430-dev-db-stub F4 round 4 — companion to db-uri-redaction.test.js.
 *
 *   §7  A: `--verbose` (and every other write made during a compile) passes
 *       the chokepoint — `compile -v` / `build -v` with file-classified values
 *   §8  B: a thrown compiler error is re-thrown as a NEW redacted value
 *       (frozen Error, filePath, cause, stack, a thrown string)
 *   §9  C: no over-redaction — whole-value + span, never a bare common-word
 *       secret: Docker's postgres:postgres, passwords `PA` / `db` / `admin`,
 *       `<img src="…?pwd=2">`; and the excerpt is redacted by SPAN
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SecretRedactor, redactSourceText, scanConnectionAttrs } from "../../src/diagnostic-secrets.ts";

const CLI = resolve(import.meta.dir, "../../src/cli.js");

function runCli(args, cwd) {
  const r = Bun.spawnSync([process.execPath, CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return r.stdout.toString() + "\n" + r.stderr.toString();
}

const FILE_CLASSIFIED = [
  { value: "sqlite://admin:ZqA5sqlite@x.db", secret: "ZqA5sqlite" },
  { value: "host=db.example passwd=ZqB6passwd dbname=app", secret: "ZqB6passwd" },
  { value: "host=db.example password='Zq C7 cret' dbname=app", secret: "Zq C7 cret" },
];

describe("§7 A: --verbose / every write during a compile passes the chokepoint", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-verbose-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  FILE_CLASSIFIED.forEach((c, i) => {
    const body = `<program db="${c.value}">\n  <db src="${c.value}" tables="items">\n    <p>x</p>\n  </db>\n</program>\n`;
    test(`compile -v — ${c.value}`, () => {
      const f = join(dir, `v${i}.scrml`);
      writeFileSync(f, body);
      const out = runCli(["compile", "-v", f, "-o", join(dir, `dv${i}`)]);
      expect(out).toContain("[PA]");          // the verbose stage lines really ran
      expect(out).toContain("E-PA-002");
      expect(out).not.toContain(c.secret);
    });
    test(`build -v — ${c.value}`, () => {
      const sub = join(dir, `b${i}`);
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, "app.scrml"), body);
      const out = runCli(["build", sub, "-v", "--output", join(dir, `db${i}`)]);
      expect(out).toContain("E-PA-002");
      expect(out).not.toContain(c.secret);
    });
  });
});

describe("§7b A: a stage's DIRECT console / stderr write during a compile is redacted", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-direct-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("console.warn + process.stderr.write from inside a stage", async () => {
    const { compileScrml } = await import("../../src/api.js");
    const V = "sqlite://admin:ZqG2direct@x.db";
    const f = join(dir, "d.scrml");
    writeFileSync(f, `<program db="${V}">\n  <p>x</p>\n</program>\n`);
    let captured = "";
    const origErr = process.stderr.write;
    const origWarn = console.warn;
    process.stderr.write = (chunk) => { captured += String(chunk); return true; };
    console.warn = (...a) => { captured += a.join(" ") + "\n"; };
    try {
      compileScrml({
        inputFiles: [f], outputDir: join(dir, "o"), write: false, log: () => {},
        selfHostModules: {
          runPA: () => {
            console.warn(`[stage] preview near ${V}`);
            process.stderr.write(`[stage] raw ${V}\n`);
            return { protectAnalysis: { views: new Map() }, errors: [] };
          },
        },
      });
    } finally {
      process.stderr.write = origErr;
      console.warn = origWarn;
    }
    expect(captured).toContain("[stage] preview near");
    expect(captured).toContain("[stage] raw");
    expect(captured).not.toContain("ZqG2direct");
  });
});

describe("§8 B: a thrown compiler error is re-thrown as a NEW redacted value", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-throw-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const V = "sqlite://admin:ZqD8thrown@x.db";
  const S = "ZqD8thrown";
  async function compileThrowing(thrower) {
    const { compileScrml } = await import("../../src/api.js");
    const f = join(dir, "t.scrml");
    writeFileSync(f, `<program db="${V}">\n  <db src="${V}" tables="items">\n    <p>x</p>\n  </db>\n</program>\n`);
    try {
      compileScrml({ inputFiles: [f], outputDir: join(dir, "d"), write: false, log: () => {}, selfHostModules: { runPA: thrower } });
    } catch (e) {
      return e;
    }
    throw new Error("expected compileScrml to throw");
  }

  test("a FROZEN Error carrying the value in message, filePath, cause and stack", async () => {
    const e = await compileThrowing(() => {
      const inner = new Error(`inner ${V}`);
      throw Object.freeze(Object.assign(new Error(`boom ${V}`), { filePath: `/x/${V}`, code: "E-TEST-1", cause: inner }));
    });
    expect(Object.isFrozen(e)).toBe(false);
    expect(e.message).toContain("boom");
    expect(e.message).not.toContain(S);
    expect(e.filePath).not.toContain(S);
    expect(e.code).toBe("E-TEST-1");
    expect(String(e.cause?.message)).toContain("inner");
    expect(String(e.cause?.message)).not.toContain(S);
    expect(String(e.stack)).not.toContain(S);
    expect(String(e)).not.toContain(S);
  });

  test("a thrown STRING", async () => {
    const e = await compileThrowing(() => { throw `plain ${V}`; });
    expect(typeof e).toBe("string");
    expect(e).toContain("plain");
    expect(e).not.toContain(S);
  });
});

describe("§9 C: no over-redaction", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-over-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  function compileBody(name, body) {
    const f = join(dir, name);
    writeFileSync(f, body);
    return runCli(["compile", f, "-o", join(dir, "d-" + name)]);
  }
  const dbFile = (v, tables = "items", extra = "    <p>x</p>") =>
    `<program db="${v}">\n  <db src="${v}" tables="${tables}">\n${extra}\n  </db>\n</program>\n`;

  test("unit: a common-word password is never replaced outside its value", () => {
    for (const [v, text] of [
      ["postgres://postgres:postgres@localhost/app", "Real Postgres introspection; driver postgres; E-PA-002"],
      ["postgres://u:PA@h/app", "E-PA-002 and E-PA-004"],
      ["postgres://u:db@h/app", "run `scrml db-migrate`; <db src=…>; <program db=…>"],
      ["postgres://admin:admin@h/app", "for table `admin`; cell @admin"],
    ]) {
      const r = new SecretRedactor([v]);
      expect(r.redact(text)).toBe(text);
    }
  });

  test("unit: <img src> is not scanned as a connection attribute", () => {
    expect(scanConnectionAttrs(`<img src="/logo.png?pwd=2"><script src="x"></script>`)).toEqual([]);
    const src = `<program db="postgres://u:ZqF1span@h/app">\n  <p>postgres://u:ZqF1span@h/app</p>\n`;
    // The span pass replaces only the attribute value …
    expect(redactSourceText(src)).toBe(`<program db="postgres://<redacted>@h/app">\n  <p>postgres://u:ZqF1span@h/app</p>\n`);
    // … and the excerpt redactor then also replaces an exact COPY of the whole value.
    const r = new SecretRedactor(["postgres://u:ZqF1span@h/app"]);
    expect(r.redactSource(src)).toBe(`<program db="postgres://<redacted>@h/app">\n  <p>postgres://<redacted>@h/app</p>\n`);
  });

  test("unit: the excerpt span pass needs no registry (file changed on disk after the compile)", () => {
    const empty = new SecretRedactor();   // nothing registered — e.g. the value was edited in after compiling
    const src = `  <db src="postgres://u:ZqF2fresh@h/app" tables="t">\n`;
    expect(empty.redactSource(src)).toBe(`  <db src="postgres://<redacted>@h/app" tables="t">\n`);
  });

  test("Docker default postgres:postgres — 'postgres' is not shredded, the value still is", () => {
    const out = compileBody("docker.scrml", dbFile("postgres://postgres:postgres@localhost:5432/app"));
    expect(out).toContain("E-PA-002");
    expect(out).toContain("postgres://<redacted>@localhost:5432/app");
    expect(out).not.toContain("postgres:postgres");
    expect(out).not.toContain("<redacted>://");
    expect(out).toContain("scrml db-migrate");
  });

  test("password `PA` — codes print as E-PA-002, not E-<redacted>-002", () => {
    const out = compileBody("pa.scrml", dbFile("postgres://u:PA@db.example/app"));
    expect(out).toContain("E-PA-002");
    expect(out).not.toContain("E-<redacted>");
    expect(out).not.toContain("u:PA@");
  });

  test("password `db` — `scrml db-migrate`, `<db src`, `<program db=` survive", () => {
    const out = compileBody("dbpw.scrml", dbFile("postgres://u:db@db.example/app"));
    expect(out).toContain("scrml db-migrate");
    expect(out).toContain("<db src=");
    expect(out).toContain("<program db=");
    expect(out).not.toContain("u:db@");
  });

  test("admin:admin — a table named `admin` survives", () => {
    const out = compileBody("admin.scrml", dbFile("postgres://admin:admin@db.example/app", "admin"));
    expect(out).toContain("for table `admin`");
    expect(out).not.toContain("admin:admin");
  });

  test("<img src=\"/logo.png?pwd=2\"> — excerpt, line numbers and §-refs print unchanged", () => {
    const img = `    <img src="/logo.png?pwd=2">`;
    const out = compileBody("img.scrml", dbFile("./nope.db", "items", img));
    expect(out).toContain(img);
    expect(out).toMatch(/img\.scrml:2:3/);
    expect(out).toContain("§40.8.1");
    expect(out).not.toContain("<redacted>");
  });

  test("end-to-end excerpt: the attribute value is redacted in place", () => {
    const v = "postgres://admin:ZqE9span@db.example/app";
    const out = compileBody("span.scrml", dbFile(v));
    expect(out).toContain(`<db src="postgres://<redacted>@db.example/app" tables="items">`);
    expect(out).not.toContain("ZqE9span");
  });
});
