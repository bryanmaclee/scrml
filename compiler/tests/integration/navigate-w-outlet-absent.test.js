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
 *
 * §5 (S425) pins the message CONTENT, not the fire condition. The lint's text
 * used to claim it was "informational only — no action required", which is
 * false: with no `<outlet>` marker, §40.8.2 composition takes the shell's first
 * `<main>` as the route slot and REPLACES its children on every composed page.
 * §5 pins the discard clause, its survival under the CLI's 120-char message
 * slice, and the absence of the old false claim.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
// §5 reads the real CLI formatter helper rather than re-implementing it — the
// slice budget the adopter actually sees has to be the one under test.
import { stripRedundantCode } from "../../src/commands/diagnostic-format.js";

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

// ---------------------------------------------------------------------------
// §5 — THE MESSAGE MUST NAME THE DISCARD (S425 ruling, option (c))
//
// This lint used to close with "If SSR-first hard navigation is your intent,
// this lint is informational only — no action required." That sentence is
// FALSE: with no `data-scrml-outlet` marker, §40.8.2 composition resolves the
// route slot BY TAG (the shell's first `<main>`) and REPLACES that element's
// children on every composed route page. An adopter read exactly that sentence,
// removed their `<outlet/>`, and lost a generated 73-link sidebar from all 99
// pages of their site. Nothing warned them.
//
// These are PINS, not coverage. The failure this change repairs is a message
// that describes a performance trade while content is being deleted, so a
// future reword that drops the discard clause — or demotes it below the CLI's
// 120-char slice — must turn this suite RED.
// ---------------------------------------------------------------------------

describe("W-OUTLET-ABSENT-SOFT-NAV-DISABLED — the message names the discard", () => {
  function fireLint() {
    const dir = makeProjectDir("outlet-absent-msg");
    mkdirSync(join(dir, "pages"), { recursive: true });
    // The shape that loses content: a `<main>` holding authored children and
    // no `<outlet/>`. Mirrors the adopter's own reproducer.
    const src =
      "<program>\n  <header>site header</header>\n  <main>\n    <div>shell-authored-child</div>\n  </main>\n</program>";
    const fp = stageFile(dir, "app.scrml", src);
    const { errors } = compileAtPath(fp, src);
    const hits = errorsByCode(errors, "W-OUTLET-ABSENT-SOFT-NAV-DISABLED");
    expect(hits.length).toBe(1);
    return hits[0];
  }

  test("names the commandeered <main> AND that its children are replaced", () => {
    const hit = fireLint();
    // The three facts the old text omitted, each pinned independently so a
    // partial reword cannot drop one silently.
    expect(hit.message).toMatch(/first `<main>`/);        // WHICH element
    expect(hit.message).toMatch(/REPLACED/);              // WHAT happens to it
    expect(hit.message).toMatch(/authored children/);     // WHAT is lost
    expect(hit.message).toMatch(/composed page/);         // WHERE the loss lands
  });

  test("the false 'no action required' clause is GONE", () => {
    const hit = fireLint();
    expect(hit.message).not.toMatch(/no action required/);
    // "informational only" survives ONLY as a CONDITIONAL. If a reword ever
    // restores the bare claim, this fails.
    expect(hit.message).toMatch(/informational only IF/);
  });

  test("names the no-<main> shape too (whole shell dropped, not just children)", () => {
    // Measured, S425: with no `<main>` anywhere in the shell, `shellAvailable`
    // is false, composition no-ops, and each route page emits standalone with
    // NONE of the shell's chrome. A message that mentions only the `<main>`
    // children case is false for the shape where the loss is total.
    const hit = fireLint();
    expect(hit.message).toMatch(/NO `<main>` at all/);
    expect(hit.message).toMatch(/emits standalone/);
  });

  test("keeps the remedy sentence and the §20.8.1 pointer", () => {
    const hit = fireLint();
    expect(hit.message).toMatch(/add a single `<outlet\/>`/);
    expect(hit.message).toMatch(/§20\.8\.1/);
    // Pre-existing pins from §1 — the reword must not have cost these.
    expect(hit.message).toMatch(/soft navigation/);
  });

  test("INERT: the code string and info severity are unchanged", () => {
    const hit = fireLint();
    expect(hit.code).toBe("W-OUTLET-ABSENT-SOFT-NAV-DISABLED");
    expect(hit.severity).toBe("info");
  });

  test("the discard clause SURVIVES the CLI's message slice", async () => {
    // ⚑ THE PIN THAT MAKES THE FIX REAL. `build.js` and `dev.js` both print
    // `stripRedundantCode(code, message)?.slice(0, N)`. On the base commit the
    // surviving window ended at "...shell with no `<outlet>" — so a discard
    // warning appended at the END of the message would have been invisible on
    // the two surfaces an adopter actually watches. The clause is front-loaded
    // deliberately; this test is why a future reword cannot bury it.
    //
    // N is READ FROM build.js rather than hand-copied: a hand-copied budget
    // goes stale silently, which is the same class of defect as the stale line
    // number this brief warned about. If the formatter's shape changes, this
    // fails LOUDLY with a named reason instead of quietly passing.
    const buildSrc = await Bun.file(
      new URL("../../src/commands/build.js", import.meta.url),
    ).text();
    const m = buildSrc.match(
      /stripRedundantCode\(\s*w\.code\s*,\s*w\.message\s*\)\s*\?\.slice\(\s*0\s*,\s*(\d+)\s*\)/,
    );
    expect(
      m,
      "build.js no longer prints `stripRedundantCode(w.code, w.message)?.slice(0, N)` — " +
        "re-derive the warning budget before trusting this pin",
    ).not.toBe(null);
    const budget = Number(m[1]);

    const hit = fireLint();
    const visible = stripRedundantCode(hit.code, hit.message).slice(0, budget);

    // Everything an adopter sees of this lint on a `scrml build` / `scrml dev`
    // run must already tell them content is being replaced.
    expect(visible).toMatch(/first `<main>`/);
    expect(visible).toMatch(/REPLACED/);
    expect(visible).toMatch(/composed page/);
  });
});
