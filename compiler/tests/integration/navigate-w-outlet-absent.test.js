/**
 * navigate-soft-nav Wave-1a — W-OUTLET-ABSENT-SOFT-NAV-DISABLED integration tests
 *
 * SPEC §20.8.1 / §20.8.7 + §34 row. The info-level lint fires at the entry-file
 * `<program>` opener when BOTH:
 *   1. A `pages/` directory exists at the project root (the multi-page signal —
 *      the SAME filesystem convention W-PROGRAM-SPA-INFERRED keys on, §40.8.1).
 *   2. The `<program>` shell declares NO `<outlet>` anywhere in its subtree
 *      (children / logic-body markup / control-flow branches — §20.8.1).
 *
 * It is the complementary branch to W-PROGRAM-SPA-INFERRED: SPA-inferred fires
 * when `pages/` is ABSENT, this fires when `pages/` is PRESENT but the shell has
 * no outlet. The two are mutually exclusive by the `pages/` condition.
 *
 * This lint is filesystem-dependent (it probes `<root>/pages/`), so it cannot be
 * exercised from the conformance corpus (which compiles from an in-memory temp
 * dir with no `pages/` subdir). These tests stage real files under a tmpdir.
 *
 * The finding-4 regression case (an outlet nested INSIDE an if/else chain must
 * count as PRESENT — no false "absent") is exercised in §3: the TAB shell scan
 * descends the markup if-chain `branches[].element` + `elseBranch` edges (the
 * twin of `collectOutlets` in symbol-table.ts).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const createdDirs = [];

function makeProjectDir(prefix = "outlet-absent") {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

function stageFile(dir, name, contents) {
  const fp = join(dir, name);
  writeFileSync(fp, contents, "utf8");
  return fp;
}

function compileAtPath(filePath, source) {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs);
}

function errorsByCode(errors, code) {
  return (errors || []).filter((e) => e && e.code === code);
}

afterAll(() => {
  for (const d of createdDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// §1 — POSITIVE: lint fires (pages/ present + shell has no <outlet>)
// ---------------------------------------------------------------------------

describe("W-OUTLET-ABSENT-SOFT-NAV-DISABLED — positive (fires)", () => {
  test("entry <program> + pages/ dir + no <outlet> → fires (info)", () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, "pages"), { recursive: true });
    const src = "<program>\n  <nav>links</nav>\n  <footer>f</footer>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    const hits = errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED");

    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].message).toMatch(/soft navigation/);
    expect(hits[0].message).toMatch(/§20\.8/);
  });

  test("mutually exclusive with W-PROGRAM-SPA-INFERRED (pages/ present)", () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, "pages"), { recursive: true });
    const src = "<program>\n  <nav>links</nav>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(1);
    // SPA-inferred is suppressed by the pages/ dir — the two never co-fire.
    expect(errorsByCode(errors, "W-PROGRAM-SPA-INFERRED").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — NEGATIVE: outlet present (direct child of shell)
// ---------------------------------------------------------------------------

describe("W-OUTLET-ABSENT-SOFT-NAV-DISABLED — negative (outlet present)", () => {
  test("entry <program> + pages/ dir + direct <outlet/> → does NOT fire", () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, "pages"), { recursive: true });
    const src = "<program>\n  <nav>links</nav>\n  <outlet/>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(0);
  });

  test("outlet nested inside shell layout markup → does NOT fire", () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, "pages"), { recursive: true });
    const src = "<program>\n  <div class=\"layout\"><outlet/></div>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3 — NEGATIVE: outlet inside control-flow (finding-4 regression)
// ---------------------------------------------------------------------------

describe("W-OUTLET-ABSENT-SOFT-NAV-DISABLED — negative (outlet in conditional)", () => {
  test("single <outlet if=@x/> (plain markup node) → does NOT fire", () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, "pages"), { recursive: true });
    const src = "<program>\n  <ready> = true\n  <outlet if=@ready/>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(0);
  });

  test("outlet inside an if/else CHAIN branch (branches[].element) → does NOT fire", () => {
    // Finding-4 regression: the shell scan must descend the markup if-chain
    // branch edges so an outlet inside a branch counts as PRESENT. Before the
    // fix, scanForOutlet skipped branches[]/elseBranch → false "absent".
    const dir = makeProjectDir();
    mkdirSync(join(dir, "pages"), { recursive: true });
    const src =
      "<program>\n  <ready> = true\n  <outlet if=@ready/>\n  <p else>Loading</p>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(0);
  });

  test("outlet as the else-branch element (elseBranch) → does NOT fire", () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, "pages"), { recursive: true });
    const src =
      "<program>\n  <ready> = true\n  <p if=@ready>Ready</p>\n  <outlet else/>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — NEGATIVE: no pages/ dir (SPA shape) / synthetic path (impl guard)
// ---------------------------------------------------------------------------

describe("W-OUTLET-ABSENT-SOFT-NAV-DISABLED — negative (no multi-page signal)", () => {
  test("entry <program> + NO pages/ dir + no <outlet> → does NOT fire (SPA)", () => {
    const dir = makeProjectDir();
    const src = "<program>\n  <nav>links</nav>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);

    const { errors } = compileAtPath(fp, src);
    // W-OUTLET-ABSENT stays silent; SPA-inferred is the relevant lint here.
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(0);
    expect(errorsByCode(errors, "W-PROGRAM-SPA-INFERRED").length).toBe(1);
  });

  test("synthetic filePath (file not on disk) → does NOT fire", () => {
    const { errors } = compileAtPath("test.scrml", "<program><nav>x</nav></program>");
    expect(errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED").length).toBe(0);
  });
});
