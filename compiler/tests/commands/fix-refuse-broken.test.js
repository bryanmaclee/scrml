/**
 * `scrml fix` refuses a file that does not compile (change-id s466-fix-refuse-broken).
 *
 * S464 ruling (user-voice-scrml.md, "your recs"): the client-server-call / sql-failable / §66 rules
 * SHALL refuse — no rewrite, a message naming the compile errors — any file that does not compile
 * before the rewrite; a rewrite of a file the compiler cannot fully read cannot be verified. The CLI
 * applies it to EVERY rule (commands/fix.js, `compileErrorsInPlace` in fix-verify-shared.js);
 * client-server-call and sql-failable also refuse in-rule, like arm-pipe / is-some / given-presence.
 *
 *   §1 the S464 repro: unwrap-logic + sql-failable rewrote a file whose OTHER function emits invalid
 *      JS — the `${` / `}` lines were really deleted on disk (not a diff-printer artefact)
 *   §2 the refusal message names the code + source line; exit status 3 in every mode
 *   §3 a file that compiles with warnings is not refused (and is rewritten)
 *   §4 directory mode: refused files are skipped and listed; the rest proceed
 *   §5 the rules themselves (direct callers)
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFixCommand } from "../../src/commands/fix.js";
import { compileErrorsInPlace, formatCompileError } from "../../src/commands/fix-verify-shared.js";
import { fixSqlFailable } from "../../src/commands/fix-sql-failable.js";
import { compileScrml } from "../../src/api.js";

/** The S464 PA repro: `bad` emits invalid client JS (`@nope +`), `load` holds an unhandled read. */
const BROKEN = [
  "<program db=\"./app.db\">",
  "${",
  "  function load() { return ?{`SELECT 1 AS a`}.get() }",
  "  function bad() { return @nope + }",
  "}",
  "<p>x</p>",
  "</program>",
  "",
].join("\n");

/** The same file without `bad`: it compiles (with warnings) and IS rewritten. */
const GOOD = [
  "<program db=\"./app.db\">",
  "${",
  "  function load() { return ?{`SELECT 1 AS a`}.get() }",
  "}",
  "<p>x</p>",
  "</program>",
  "",
].join("\n");

/** A front-end error carrying a source line: an import of a file that does not exist (line 2). */
const MISSING_IMPORT = [
  "<program>",
  "${ import { Nope } from \"./nope.scrml\" }",
  "<x> = 0",
  "<p>${@x}</p>",
  "</program>",
  "",
].join("\n");

function withDir(files, body) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-refuse-"));
  try {
    for (const [p, s] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), s);
    }
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(args) {
  const out = [];
  const err = [];
  const code = runFixCommand(args, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function compiles(file) {
  return compileErrorsInPlace(file).length === 0;
}

describe("§1 the S464 brace-loss repro", () => {
  test("before the ruling, unwrap-logic deleted the `${` and `}` lines on disk; now the file is refused, byte-identical", () => {
    withDir({ "b3.scrml": BROKEN }, (dir) => {
      const f = join(dir, "b3.scrml");
      const r = run([f]);
      expect(r.code).toBe(3);
      expect(readFileSync(f, "utf8")).toBe(BROKEN);
      expect(r.err).toContain("refused — the file does not compile");
      expect(r.err).toContain("E-CODEGEN-INVALID-LOGIC");
      expect(r.err).toContain("1 refused (does not compile)");
    });
  });

  test("--dry-run prints no diff for the refused file (no proposed `-${` / `-}`)", () => {
    withDir({ "b3.scrml": BROKEN }, (dir) => {
      const f = join(dir, "b3.scrml");
      const r = run([f, "--dry-run"]);
      expect(r.code).toBe(3);
      expect(r.out).toBe("");
      expect(readFileSync(f, "utf8")).toBe(BROKEN);
    });
  });

  test("--s66 (preview and --write) refuses it too", () => {
    withDir({ "b3.scrml": BROKEN }, (dir) => {
      const f = join(dir, "b3.scrml");
      expect(run([f, "--s66"]).code).toBe(3);
      expect(run([f, "--s66", "--write"]).code).toBe(3);
      expect(readFileSync(f, "utf8")).toBe(BROKEN);
    });
  });

  test("each rule alone refuses it (sql-failable, unwrap-logic, client-server-call, pre-migrate)", () => {
    withDir({ "b3.scrml": BROKEN }, (dir) => {
      const f = join(dir, "b3.scrml");
      for (const rule of ["sql-failable", "unwrap-logic", "client-server-call", "pre-migrate", "arm-pipe", "is-some", "given-presence", "program-move"]) {
        const r = run([f, `--rules=${rule}`]);
        expect(r.code).toBe(3);
        expect(readFileSync(f, "utf8")).toBe(BROKEN);
      }
    });
  });
});

describe("§2 the refusal names the errors; exit status", () => {
  test("code + source line, the file path:line prefix", () => {
    withDir({ "app.scrml": MISSING_IMPORT }, (dir) => {
      const f = join(dir, "app.scrml");
      const errs = compileErrorsInPlace(f);
      expect(errs.map((d) => d.code)).toContain("E-IMPORT-006");
      const d = errs.find((x) => x.code === "E-IMPORT-006");
      expect(d.line).toBe(2);
      expect(formatCompileError(d)).toMatch(/^E-IMPORT-006 \(line 2\): Cannot resolve import/);
      const r = run([f]);
      expect(r.code).toBe(3);
      expect(r.err).toMatch(/app\.scrml:2 E-IMPORT-006 \(line 2\): Cannot resolve import/);
      expect(readFileSync(f, "utf8")).toBe(MISSING_IMPORT);
    });
  });

  test("--check: 3 (ahead of 1 / 2); --json: the file is `refused` with its compileErrors", () => {
    withDir({ "a.scrml": BROKEN, "b.scrml": GOOD }, (dir) => {
      expect(run([dir, "--check"]).code).toBe(3);
      const j = run([dir, "--json"]);
      expect(j.code).toBe(3);
      const rep = JSON.parse(j.out);
      const a = rep.files.find((x) => x.file.endsWith("a.scrml"));
      const b = rep.files.find((x) => x.file.endsWith("b.scrml"));
      expect(a.refused).toBe(true);
      expect(a.changed).toBe(false);
      expect(a.compileErrors.map((d) => d.code)).toContain("E-CODEGEN-INVALID-LOGIC");
      expect(b.refused).toBeUndefined();
      expect(b.changed).toBe(true);
    });
  });

  test("a run with nothing refused keeps its old exit status (0)", () => {
    withDir({ "b.scrml": GOOD }, (dir) => {
      expect(run([join(dir, "b.scrml"), "--dry-run"]).code).toBe(0);
    });
  });
});

describe("§3 warnings do not refuse", () => {
  test("the compiling twin has warnings and is rewritten (unwrap-logic + sql-failable), and still compiles", () => {
    withDir({ "b.scrml": GOOD }, (dir) => {
      const f = join(dir, "b.scrml");
      const res = compileScrml({ inputFiles: [f], write: false, outputDir: join(dir, "out"), log: () => {} });
      expect((res.warnings ?? []).length).toBeGreaterThan(0);
      expect(compileErrorsInPlace(f)).toEqual([]);
      const r = run([f]);
      expect(r.code).toBe(0);
      expect(r.err).not.toContain("refused");
      const out = readFileSync(f, "utf8");
      expect(out).toContain("?{`SELECT 1 AS a`}.get() !{ _ :> not }");
      expect(out).not.toContain("${");
      expect(compiles(f)).toBe(true);
    });
  });
});

describe("§4 directory mode", () => {
  test("refused files are skipped and listed; the rest proceed", () => {
    withDir({ "src/a.scrml": BROKEN, "src/b.scrml": GOOD, "src/c.scrml": MISSING_IMPORT }, (dir) => {
      const r = run([dir]);
      expect(r.code).toBe(3);
      expect(readFileSync(join(dir, "src/a.scrml"), "utf8")).toBe(BROKEN);
      expect(readFileSync(join(dir, "src/c.scrml"), "utf8")).toBe(MISSING_IMPORT);
      expect(readFileSync(join(dir, "src/b.scrml"), "utf8")).toContain("!{ _ :> not }");
      expect(r.err).toContain("3 file(s) · 1 changed");
      expect(r.err).toContain("2 refused (does not compile)");
      const list = r.err.slice(r.err.indexOf("scrml fix: refused"));
      expect(list).toMatch(/a\.scrml/);
      expect(list).toMatch(/c\.scrml/);
      expect(list).not.toMatch(/b\.scrml/);
    });
  });
});

describe("§5 the rules themselves refuse (direct callers)", () => {
  test("sql-failable on the repro: no rewrite, the reason names the error", () => {
    withDir({ "b3.scrml": BROKEN }, (dir) => {
      const f = join(dir, "b3.scrml");
      const r = fixSqlFailable(BROKEN, { filePath: f });
      expect(r.changed).toBe(false);
      expect(r.output).toBe(BROKEN);
      expect(r.blockers.map((b) => b.reason).join("\n")).toMatch(/file does not compile; cannot verify \(impl#1 reports E-CODEGEN-INVALID-LOGIC/);
    });
  });

  test("sql-failable on the compiling twin still rewrites", () => {
    withDir({ "b.scrml": GOOD }, (dir) => {
      const r = fixSqlFailable(GOOD, { filePath: join(dir, "b.scrml") });
      expect(r.changed).toBe(true);
      expect(r.output).toContain("!{ _ :> not }");
    });
  });
});
