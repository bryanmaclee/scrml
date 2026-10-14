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
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Database } from "bun:sqlite";
import { runFixCommand, judgeTargets, resolveProject } from "../../src/commands/fix.js";
import {
  compileErrorsInPlace, compileErrorsTogether, formatCompileError, namedDatabaseFiles, writeScratchProject,
  scratchRefusalReason, SCRATCH_DIVERGES,
} from "../../src/commands/fix-verify-shared.js";
import { fixSqlFailable } from "../../src/commands/fix-sql-failable.js";
import { fixS66, S66_RULES } from "../../src/commands/fix-s66.js";
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
      expect(r.err).toMatch(/app\.scrml:2 E-IMPORT-006: Cannot resolve import/);
      expect(readFileSync(f, "utf8")).toBe(MISSING_IMPORT);
    });
  });

  test("an error with no source line (E-CODEGEN-INVALID-LOGIC) prints the file alone — never `line null`", () => {
    withDir({ "b3.scrml": BROKEN }, (dir) => {
      const f = join(dir, "b3.scrml");
      const d = compileErrorsInPlace(f).find((x) => x.code === "E-CODEGEN-INVALID-LOGIC");
      expect(d.line).toBe(null);
      expect(formatCompileError(d)).toMatch(/^E-CODEGEN-INVALID-LOGIC: /);
      const r = run([f]);
      expect(r.err).toMatch(/b3\.scrml E-CODEGEN-INVALID-LOGIC: the compiler could not lower/);
      expect(r.err).not.toContain("null");
      expect(r.err).not.toMatch(/b3\.scrml:\d/);
    });
  });

  test("the emitted-JS check is not run twice: one E-CODEGEN-INVALID-LOGIC per artifact, not two", () => {
    withDir({ "b3.scrml": BROKEN }, (dir) => {
      const n = compileErrorsInPlace(join(dir, "b3.scrml")).filter((x) => x.code === "E-CODEGEN-INVALID-LOGIC").length;
      expect(n).toBe(1);
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

  test("a scratch compile that errors on a file that compiles in place says `diverges`, never `does not compile`", () => {
    expect(scratchRefusalReason(["E-PA-002"], "/virtual/x.scrml", "", true)).toBe(`${SCRATCH_DIVERGES} (E-PA-002)`);
    expect(scratchRefusalReason(["E-PA-002"], "/virtual/x.scrml", "", false)).toContain("file does not compile; cannot verify");
    // the file is on disk with this exact text and compiles in place → diverges, decided by an in-place compile
    withDir({ "b.scrml": GOOD }, (dir) => {
      expect(scratchRefusalReason(["E-X"], join(dir, "b.scrml"), GOOD)).toBe(`${SCRATCH_DIVERGES} (E-X)`);
    });
  });
});

// ---------------------------------------------------------------------------
// §6 S466 review (HIGH): a database the source names by a path outside its directory
// ---------------------------------------------------------------------------

function makeDb(path, ddl) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(ddl);
  db.close();
}

/** The review repro (repro/updb2): `../app.db` from sub/, with a `protect=` read. */
const UP_PAGE = [
  "<program db=\"../app.db\">",
  "<db src=\"../app.db\" protect=\"secret\" tables=\"users\">",
  "${",
  "  import { K } from \"../lib.scrml\"",
  "  function one() {",
  "    const r = ?{`SELECT name FROM users WHERE id = 1`}.get()",
  "    return K",
  "  }",
  "}",
  "</db>",
  "<p>x</p>",
  "</program>",
  "",
].join("\n");

/** The trucking shape: a page two directories below its database. */
const TRUCK_PAGE = [
  "<program db=\"../../dispatch.db\">",
  "<db src=\"../../dispatch.db\" tables=\"loads\">",
  "${",
  "  function count() {",
  "    const r = ?{`SELECT id FROM loads WHERE id = 1`}.get()",
  "    return 1",
  "  }",
  "}",
  "</db>",
  "<p>x</p>",
  "</program>",
  "",
].join("\n");

describe("§6 databases named by a path outside the file's directory", () => {
  test("namedDatabaseFiles: `db=` and `<db src=>` resolved from the declaring file; :memory: / drivers / missing files skipped", () => {
    withDir({}, (dir) => {
      makeDb(join(dir, "app.db"), "CREATE TABLE t(id integer)");
      makeDb(join(dir, "x.sqlite"), "CREATE TABLE t(id integer)");
      const f = join(dir, "a", "b", "page.scrml");
      const src = `<program db="sqlite:../../app.db">\n<db src='../../x.sqlite' tables="t">\n<db src=":memory:">\n<db src="postgres://u@h/d">\n<db src="../../nope.db">\n`;
      expect(namedDatabaseFiles(f, src).sort()).toEqual([join(dir, "app.db"), join(dir, "x.sqlite")].sort());
    });
  });

  test("the scratch project places a `../../dispatch.db` at the same relative spot", () => {
    withDir({ "app/pages/board.scrml": TRUCK_PAGE }, (dir) => {
      makeDb(join(dir, "dispatch.db"), "CREATE TABLE loads(id integer primary key)");
      const scratch = mkdtempSync(join(tmpdir(), "scrml-fix-scratch-test-"));
      try {
        const { target } = writeScratchProject(scratch, join(dir, "app/pages/board.scrml"), TRUCK_PAGE, {});
        expect(existsSync(join(dirname(target), "../../dispatch.db"))).toBe(true);
        expect(target.startsWith(scratch)).toBe(true);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  });

  for (const [label, files, page, ddl, dbAt] of [
    ["the review repro (`../app.db`, protect=)", { "lib.scrml": "${ export const K = 2 }\n", "sub/page.scrml": UP_PAGE }, "sub/page.scrml",
      "CREATE TABLE users(id integer primary key, name text, secret text)", "app.db"],
    ["the trucking shape (`../../dispatch.db`)", { "app/pages/board.scrml": TRUCK_PAGE }, "app/pages/board.scrml",
      "CREATE TABLE loads(id integer primary key)", "dispatch.db"],
  ]) {
    test(`${label}: compiles in place, so it is rewritten — not refused, no "does not compile"`, () => {
      withDir(files, (dir) => {
        makeDb(join(dir, dbAt), ddl);
        const f = join(dir, page);
        expect(compileErrorsInPlace(f)).toEqual([]);
        const src = readFileSync(f, "utf8");
        const direct = fixSqlFailable(src, { filePath: f, auxSources: resolveProject(f) });
        expect(direct.blockers.map((b) => b.reason)).toEqual([]);
        expect(direct.output).toContain(".get() !{ _ :> not }");
        const r = run([f, "--dry-run"]);
        expect(r.code).toBe(0);
        expect(r.err).not.toContain("does not compile");
        expect(r.err).not.toContain("diverges");
        expect(r.out).toContain("+    const r = ?{`SELECT");
      });
    });
  }
});

// ---------------------------------------------------------------------------
// §7 S466 review (MED): judged the way `scrml compile` judges the target
// ---------------------------------------------------------------------------

describe("§7 a component module that compiles as part of its project", () => {
  const EX = join(import.meta.dir, "../../../examples/22-multifile");
  const files = () => Object.fromEntries(["app.scrml", "components.scrml", "types.scrml"].map((n) => [n, readFileSync(join(EX, n), "utf8")]));

  test("directory mode (`scrml compile <dir>` compiles it): not refused, exit 0", () => {
    withDir(files(), (dir) => {
      expect(compileErrorsTogether(["app.scrml", "components.scrml", "types.scrml"].map((n) => join(dir, n)))).toEqual([]);
      const r = run([dir, "--check"]);
      expect(r.err).not.toContain("refused");
      expect(r.code).toBe(0);
    });
  });

  test("file mode mirrors `scrml compile <file>`: that compile fails (a standalone-compile codegen defect), so it is refused", () => {
    withDir(files(), (dir) => {
      const f = join(dir, "components.scrml");
      expect(compileErrorsInPlace(f).map((d) => d.code)).toContain("E-CODEGEN-INVALID-LOGIC");
      const r = run([f, "--check"]);
      expect(r.code).toBe(3);
      expect(readFileSync(f, "utf8")).toBe(files()["components.scrml"]);
    });
  });

  // Two unrelated programs are two applications: each is compiled on its own (in one joint compile
  // the front-end error of one skips the emitted-JS check of the other — measured S466).
  test("two unrelated programs are judged by their own compiles: one's error neither hides nor causes the other's", () => {
    withDir({ "a.scrml": BROKEN, "c.scrml": MISSING_IMPORT }, (dir) => {
      const g = judgeTargets([join(dir, "a.scrml"), join(dir, "c.scrml")], true, ["sql-failable"]);
      expect([...g.refused.keys()].sort()).toEqual([join(dir, "a.scrml"), join(dir, "c.scrml")]);
      expect(g.refused.get(join(dir, "a.scrml")).map((d) => d.code)).toEqual(["E-CODEGEN-INVALID-LOGIC"]);
      expect(g.refused.get(join(dir, "c.scrml")).map((d) => d.code)).toContain("E-IMPORT-006");
    });
  });
});

describe("§7a route pages without `<program>` import components that do not compile alone", () => {
  // examples/23-trucking-dispatch: components/*.scrml fail `scrml compile <component>` alone
  // (E-CODEGEN-INVALID-LOGIC, the standalone library-output defect) but compile inside the pages
  // that import them; the pages have no `<program>` (route files), so a module is judged inside
  // every ROOT that reaches it, not only inside `<program>` files. The S466 review counted 8.
  test("the trucking app: no component refused, the 105 sql-failable rewrites proposed", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-fix-truck-"));
    try {
      cpSync(join(import.meta.dir, "../../../examples/23-trucking-dispatch"), dir, { recursive: true });
      const comp = join(dir, "components/load-card.scrml");
      expect(compileErrorsInPlace(comp).map((d) => d.code)).toContain("E-CODEGEN-INVALID-LOGIC");
      const r = run([dir, "--dry-run", "--json"]);
      expect(r.code).toBe(0);
      const rep = JSON.parse(r.out);
      expect(rep.files.filter((f) => f.refused)).toEqual([]);
      expect(rep.files.flatMap((f) => f.applied).filter((a) => a.rule === "sql-failable").length).toBe(105);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300000);
});

describe("§7c review cases from conformance/cases", () => {
  const CASES = join(import.meta.dir, "../../../conformance/cases");
  const copyCase = (rel, body) => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-fix-case-"));
    try {
      cpSync(join(CASES, rel), dir, { recursive: true });
      return body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("engine/mount-not-engine-neg: lib.scrml compiles inside case.scrml — not refused (S466 review)", () => {
    copyCase("engine/mount-not-engine-neg", (dir) => {
      const r = run([dir, "--check", "--json"]);
      expect(r.code).not.toBe(3);
      expect(JSON.parse(r.out).files.filter((f) => f.refused)).toEqual([]);
    });
  });

  test("module/e-import-002-reexport-cycle-named-reject: the cycle error names no file, so x / y are judged alone and refused", () => {
    copyCase("module/e-import-002-reexport-cycle-named-reject", (dir) => {
      const g = judgeTargets(["case.scrml", "x.scrml", "y.scrml"].map((n) => join(dir, n)), true, ["sql-failable"]);
      expect([...g.refused.keys()].map((f) => f.slice(dir.length + 1)).sort()).toEqual(["case.scrml", "x.scrml", "y.scrml"]);
    });
  });
});

describe("§7b a directory of unrelated applications is not one program", () => {
  // Measured S466: compiling conformance/cases as ONE program reports protect conflicts
  // (E-PROTECT-006) and route collisions (E-CG-001) between unrelated cases, errors that name no
  // file (E-IMPORT-002, …), and `scrml compile samples` crashes — any of which refused files that
  // compile on their own. Each `<program>` is its own application (§40.8).
  const A = "${ import { B } from \"./b.scrml\"\n  export const A = 1 }\n";
  const B = "${ import { A } from \"./a.scrml\"\n  export const B = 2 }\n";

  test("a module cycle no program imports is refused by its own compiles; an unrelated program is rewritten", () => {
    withDir({ "a.scrml": A, "b.scrml": B, "g.scrml": GOOD }, (dir) => {
      const r = run([dir]);
      expect(r.code).toBe(3);
      expect(readFileSync(join(dir, "a.scrml"), "utf8")).toBe(A);
      expect(readFileSync(join(dir, "b.scrml"), "utf8")).toBe(B);
      expect(readFileSync(join(dir, "g.scrml"), "utf8")).toContain("!{ _ :> not }");
      const list = r.err.slice(r.err.indexOf("scrml fix: refused"));
      expect(list).toMatch(/a\.scrml/);
      expect(list).not.toMatch(/g\.scrml/);
    });
  });

  // One program's protect= leaks into another's verdict only when both are compiled as one:
  // the joint compile reports E-CG-001 ("protected field `name` found in client JS") against p1,
  // which compiles clean on its own (measured S466; the conformance/cases run had 43 such files).
  test("one program's protect= does not refuse an unrelated program", () => {
    const prog = (prot, col) => `<program db="./x.db">\n<db src="./x.db" protect="${prot}" tables="users">\n\${\n  function f() { return ?{\`SELECT ${col} FROM users WHERE id = 1\`}.get() }\n}\n</db>\n<p>x</p>\n</program>\n`;
    withDir({ "p1/app.scrml": prog("secret", "name"), "p2/app.scrml": prog("name", "secret") }, (dir) => {
      for (const n of ["p1", "p2"]) makeDb(join(dir, n, "x.db"), "CREATE TABLE users(id integer primary key, name text, secret text)");
      const p1 = join(dir, "p1/app.scrml");
      const p2 = join(dir, "p2/app.scrml");
      expect(compileErrorsInPlace(p1)).toEqual([]);
      // precondition: compiled as ONE program, p1 is blamed
      expect(compileErrorsTogether([p1, p2]).some((d) => d.file === p1 && d.code === "E-CG-001")).toBe(true);
      const g = judgeTargets([p1, p2], true, ["sql-failable"]);
      expect(g.refused.has(p1)).toBe(false);
      expect(g.clean.has(p1)).toBe(true);
      expect(g.refused.has(p2)).toBe(compileErrorsInPlace(p2).length > 0);
    });
  });
});

// ---------------------------------------------------------------------------
// §8 pre-migrate clears a hard error: E-DEPRECATED-001 (`<machine>`) alone does not refuse
// ---------------------------------------------------------------------------

const MACHINE = [
  "<program>",
  "${",
  "  type FlowState:enum = { Idle, Done }",
  "}",
  "<machine name=Flow for=FlowState>",
  "  .Idle => .Done",
  "</>",
  "<p>x</p>",
  "</program>",
  "",
].join("\n");

describe("§8 a `<machine>` file (E-DEPRECATED-001) is migrated, and the result compiles", () => {
  test("default rules: rewritten to `<engine>`, exit 0, compiles after", () => {
    withDir({ "m.scrml": MACHINE }, (dir) => {
      const f = join(dir, "m.scrml");
      expect(compileErrorsInPlace(f).map((d) => d.code)).toEqual(["E-DEPRECATED-001"]);
      const r = run([f]);
      expect(r.code).toBe(0);
      const out = readFileSync(f, "utf8");
      expect(out).toContain("<engine name=Flow for=FlowState>");
      expect(compileErrorsInPlace(f)).toEqual([]);
    });
  });

  test("without pre-migrate (--rules=unwrap-logic) the same file is refused", () => {
    withDir({ "m.scrml": MACHINE }, (dir) => {
      const f = join(dir, "m.scrml");
      expect(run([f, "--rules=unwrap-logic"]).code).toBe(3);
      expect(readFileSync(f, "utf8")).toBe(MACHINE);
    });
  });

  test("a `<machine>` file with ANOTHER error is refused", () => {
    withDir({ "m.scrml": MACHINE.replace("<p>x</p>", "<p>x</p>\n${ import { Nope } from \"./nope.scrml\" }") }, (dir) => {
      expect(run([join(dir, "m.scrml")]).code).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// §9 S466 r2 N1: E-DEPRECATED-001 is a front-end error — it hides every later error
// ---------------------------------------------------------------------------

/** r1repro/b1/machbad.scrml: a `<machine>` file whose `bad` also emits invalid JS (hidden behind E-DEPRECATED-001). */
const MACH_BODY = (opener, extra) => [
  "<program>",
  "type Book:enum = {",
  "    Idle,",
  "    Loaded(title: string, author: string, count: int)",
  "}",
  "",
  "<count> = 0",
  ...(extra ? [extra] : []),
  "",
  `<${opener} for=Book initial=.Idle>`,
  "    <Idle rule=.Loaded></>",
  "    <Loaded title=t rule=.Idle>",
  "        <p>${t}</p>",
  "    </>",
  "</>",
  "",
  "<div class=\"library\">",
  "    <button onclick=${@book = Book.Loaded(\"t\", \"a\", 1)}>Load</button>",
  "    <p>${@count}</p>",
  "</div>",
  "</program>",
  "",
].join("\n");
const MACHBAD = MACH_BODY("machine", "${ function bad() { return @nope + } }");
const MACHOK = MACH_BODY("machine", null);

describe("§9 a `<machine>` file with an error hidden behind E-DEPRECATED-001 is refused", () => {
  test("precondition: the in-place compile shows ONLY E-DEPRECATED-001 (the front end stops there)", () => {
    withDir({ "m.scrml": MACHBAD }, (dir) => {
      expect(compileErrorsInPlace(join(dir, "m.scrml")).map((d) => d.code)).toEqual(["E-DEPRECATED-001"]);
    });
  });

  for (const args of [["--s66"], ["--s66", "--write"], [], ["--dry-run"]]) {
    test(`scrml fix ${args.join(" ") || "(default rules)"}: refused, exit 3, nothing proposed or written`, () => {
      withDir({ "m.scrml": MACHBAD }, (dir) => {
        const f = join(dir, "m.scrml");
        const r = run([f, ...args]);
        expect(r.code).toBe(3);
        expect(r.out).toBe("");
        expect(r.err).toContain("pre-migrate could not migrate its `<machine>`");
        expect(r.err).toContain("E-CODEGEN-INVALID-LOGIC");
        expect(readFileSync(f, "utf8")).toBe(MACHBAD);
      });
    });
  }

  test("fixS66 called directly with every rule: no rewrite once pre-migrate is blocked", () => {
    withDir({ "m.scrml": MACHBAD }, (dir) => {
      const r = fixS66(MACHBAD, { filePath: join(dir, "m.scrml"), rules: [...S66_RULES] });
      expect(r.changed).toBe(false);
      expect(r.output).toBe(MACHBAD);
    });
  });

  test("the same file without the hidden error still migrates to `<engine>`", () => {
    withDir({ "m.scrml": MACHOK }, (dir) => {
      const f = join(dir, "m.scrml");
      const r = run([f]);
      expect(r.code).toBe(0);
      expect(readFileSync(f, "utf8")).toContain("<engine for=Book initial=.Idle>");
      expect(compileErrorsInPlace(f)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// §10 S466 r2 N2: a root's front-end error hides its module's codegen error
// ---------------------------------------------------------------------------

describe("§10 a module reached only by roots that stop with an error is judged by its own compile", () => {
  // r1repro/a2: app.scrml has E-SCOPE-001 (stops before the emitted-JS check); mod.scrml alone is
  // E-CODEGEN-INVALID-LOGIC.
  const APP = "<program>\n${\n  import { h } from \"./mod.scrml\"\n  function go() { return undefinedThing + h(1) }\n}\n<button onclick=go()>go</button>\n</program>\n";
  const MOD = "${\n  export function h(x) {\n    if (x is some) { return 1 }\n    return 0\n  }\n  export function bad() { return @nope + }\n}\n";

  test("both refused; mod.scrml untouched (its `is some` is not rewritten)", () => {
    withDir({ "app.scrml": APP, "mod.scrml": MOD }, (dir) => {
      expect(compileErrorsInPlace(join(dir, "mod.scrml")).map((d) => d.code)).toContain("E-CODEGEN-INVALID-LOGIC");
      const g = judgeTargets([join(dir, "app.scrml"), join(dir, "mod.scrml")], true, ["is-some"]);
      expect(g.refused.get(join(dir, "mod.scrml")).map((d) => d.code)).toContain("E-CODEGEN-INVALID-LOGIC");
      const r = run([dir]);
      expect(r.code).toBe(3);
      expect(readFileSync(join(dir, "mod.scrml"), "utf8")).toBe(MOD);
      expect(readFileSync(join(dir, "app.scrml"), "utf8")).toBe(APP);
    });
  });
});
