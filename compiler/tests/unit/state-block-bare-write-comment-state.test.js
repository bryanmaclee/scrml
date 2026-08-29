/**
 * S378 — comment handling in the two text-scanning lints of `ast-builder.js`,
 * and the record of an "obvious" fix that was landed and REVERTED TWICE.
 *
 * ── WHAT THE SCANNERS DO ────────────────────────────────────────────────────
 * `scanStateBlockBareWriteDecls`  -> `W-STATE-BLOCK-BARE-WRITE-DECL` on a bare
 *                                    `@name = init` in a `<db>` / `<state>` body.
 * `scanMarkupBodyConstAtDecls`    -> `W-CONST-AT-DEPRECATED` on a legacy
 *                                    `const @name = ...` in a markup body.
 * Both walk direct text children with a `^`-anchored per-line regex. NEITHER
 * masks comment regions, and that is a DECISION, not an omission.
 *
 * ── THE FALSE-FIRE IS REAL, FILED, AND DELIBERATELY LEFT OPEN ──────────────
 * A `@name = init` (or `const @x = ...`) sitting inside a block comment still
 * warns. Filed as `g-state-block-bare-write-scan-has-no-comment-state`. It is a
 * spurious WARNING; compiles still exit 0.
 *
 * ⚑ S379 — CITE THE ID THAT RESOLVES. An earlier draft of this banner named
 * `g-markup-body-const-at-scan-false-fires-inside-a-block-comment`, a wider id
 * proposed alongside this work to cover BOTH scanners. It is not in
 * `docs/known-gaps.md` — the delta that would have created it is PA-owned and
 * did not land here — so every citation of it was a dangling reference. If that
 * wider id is later registered, this banner and the twin at
 * `ast-builder.js` (`scanMarkupBodyConstAtDecls`) both want updating.
 *
 * ── ⚑ WHY THE OBVIOUS FIX IS WRONG, MEASURED TWICE ─────────────────────────
 * The sibling `lint-e-state-block-statement-form.js` closes the identical
 * false-fire with a `maskCommentRegions` state machine, and that machine was
 * imported here — first for the markup scanner, then defended for the `<db>`
 * scanner on the ground that a `<db>` body is "structured" while a markup body
 * is "prose". BOTH were reverted, because BOTH regressed a live lint:
 *
 *   markup body:  `Files under src/[star].js are ignored.` — the glob's slash-star
 *                 opened a block comment that never closed, and a real
 *                 `const @total = 1` below it STOPPED warning.
 *   `<db>` body:  `@pattern = "src/[star].js"` — the same glob, inside a quoted
 *                 STRING VALUE, silenced the rest of the body: 3 warnings -> 1.
 *
 * ⚑ THE DOMAIN DISTINCTION THAT WAS DRAWN DOES NOT EXIST. A `<db>` body holds
 * string values, and a string value holds globs, paths, URLs and regexes — every
 * phantom-comment opener there is.
 *
 * ⚑ THE GENERAL RULE, which is the durable output of getting this wrong twice:
 * **`maskCommentRegions` is only safe over text that CANNOT contain a string
 * literal.** Neither scanner's domain satisfies that. Closing the false-fire
 * needs a STRING-AWARE comment scanner — a different and larger thing than that
 * helper. And the direction matters: masking traded a VISIBLE wrong warning for
 * an INVISIBLE missing one, and for a lint, silence is the worse failure.
 *
 * The tests below are therefore mostly REGRESSION tests against re-applying it.
 *
 * ⛑ S383 — ONE CLAIM IN HERE WAS OVERSTATED AND IS CORRECTED. Earlier wording
 * said re-applying the helper makes findings "DISAPPEAR rather than fail loudly".
 * MEASURED by actually re-applying it (export + import + call, then reverted):
 * FOUR tests in this file go RED — the M4 glob-in-a-string regression, the
 * mixed-openers regression, the block-comment residual, and the tripwire. So it
 * DOES fail loudly, here, today.
 *
 * What is true is narrower, and it is still the reason the tripwire exists:
 * those behavioural tests only cover the shapes someone thought to write, and
 * they exist ONLY BECAUSE this was got wrong twice and measured after the fact.
 * The same helper applied to a DIFFERENT scanner, or over a domain nobody has
 * built a glob fixture for, would regress silently — the failure mode is a lint
 * that stops firing, which no test detects unless a test already names that
 * shape. The tripwire catches the enabling step at review time instead of
 * relying on the fixture set being complete.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ⛑ S383 (R5) — `mkdtempSync`, NOT a fixed `/tmp/<fixed-name>` path.
// This file used to write fixtures into a guessable, shared, world-traversable
// directory via `mkdirSync` + `writeFileSync`, and `writeFileSync` FOLLOWS
// SYMLINKS: on a multi-user box another user can pre-create the directory, or
// plant a symlink at a fixture name, and the test writes through it. That is
// byte-for-byte the shape this same landing files against `dev.js`
// (`g-dev-child-config-written-to-a-predictable-world-readable-tmp-path`), so
// shipping it in this arc's own new test would have been the rule not applying
// to its author. `mkdtempSync` returns a fresh 0700 directory with a random
// suffix. Both sibling tests in this tier already do this
// (`state-block-statement-form.test.js`, `control-flow-in-markup-reject.test.js`).
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "s378-comment-state-"));

const CODE = "W-STATE-BLOCK-BARE-WRITE-DECL";
const CONST_AT = "W-CONST-AT-DEPRECATED";

// Built rather than written literally: a block-comment terminator cannot appear
// inside this file's own leading JSDoc, and naming the tokens keeps the
// fixtures readable.
const OPEN = "/*";
const CLOSE = "*" + "/";
const GLOB = "src/" + "*" + ".js";

function compileSource(source, filename) {
  const filePath = join(FIXTURE_DIR, filename);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(FIXTURE_DIR, "dist"),
    write: false,
  });
  return { errors: result.errors ?? [], warnings: result.warnings ?? [], source };
}

const fires = (diags) => diags.filter((e) => e.code === CODE);
const constAt = (diags) => diags.filter((e) => e.code === CONST_AT);

/** A `<db>` with the attributes it needs, so no unrelated E-PA-* noise. */
const db = (body) =>
  `<program>\n<db src="app.db" tables="users">\n${body}\n</db>\n<p>ok</>\n</program>\n`;

describe("S378 — the two scanners bite, and phantom comments must not silence them", () => {
  // ── 1. THE LINTS STILL BITE ───────────────────────────────────────────────
  test("a real bare write in a `<db>` body fires", () => {
    const { warnings } = compileSource(db("@count = 0"), "r3-real-write.scrml");
    expect(fires(warnings).length).toBe(1);
    expect(fires(warnings)[0].message).toContain("@count");
  });

  test("a real `const @x` in a markup body fires", () => {
    const { warnings } = compileSource(
      `<program>\n<div>\nconst @x = 1\n</div>\n<p>ok</>\n</program>\n`,
      "r3-real-constat.scrml",
    );
    expect(constAt(warnings).length).toBe(1);
  });

  // ── 2. ⚑ THE TWO REGRESSIONS — a phantom opener must NOT silence the rest ─
  // These are the whole point of the file. Each was a LIVE regression caught by
  // A/B against main after `maskCommentRegions` was applied.
  test("REGRESSION (M4) — a glob inside a `<db>` STRING VALUE must not silence later writes", () => {
    // A/B'd: 3 warnings on main, 1 with masking applied. `<db>` bodies contain
    // string values, and string values contain globs — the "structured vs prose"
    // domain distinction that justified masking here does not exist.
    const { warnings } = compileSource(
      db(`@pattern = "${GLOB}"\n@count = 0\n@other = 1`),
      "r3-m4-glob-in-string.scrml",
    );
    expect(fires(warnings).length).toBe(3);
  });

  test("REGRESSION (L1) — a glob in a MARKUP body must not silence a later `const @x`", () => {
    const { warnings } = compileSource(
      `<program>\n<div>\nFiles under ${GLOB} are ignored.\nconst @total = 1\n</div>\n<p>ok</>\n</program>\n`,
      "r3-l1-glob-in-markup.scrml",
    );
    expect(constAt(warnings).length).toBe(1);
  });

  test("REGRESSION — a bare path and a division must not silence a `<db>` body either", () => {
    // The trigger is ANY unpaired slash + star, not a string literal specifically.
    const { warnings } = compileSource(
      db(`@glob = "assets/${"*"}"\n@ratio = "2 ${"*"} 3 / 4"\n@count = 0`),
      "r3-m4-mixed-openers.scrml",
    );
    expect(fires(warnings).length).toBe(3);
  });

  // ── 3. THE KNOWN, FILED RESIDUAL — asserted so it reads as a decision ─────
  test("KNOWN GAP — a `<db>` write inside a real block comment still fires", () => {
    const { warnings } = compileSource(
      db(`${OPEN}\n@count = 0\n${CLOSE}`),
      "r3-residual-db.scrml",
    );
    expect(fires(warnings).length).toBe(1);
  });

  test("KNOWN GAP — a markup `const @x` inside a real block comment still fires", () => {
    const { warnings } = compileSource(
      `<program>\n<div>\n${OPEN}\nconst @x = 1\n${CLOSE}\n</div>\n<p>ok</>\n</program>\n`,
      "r3-residual-markup.scrml",
    );
    expect(constAt(warnings).length).toBe(1);
  });

  test("the `//` form is ACCIDENTALLY safe — a property of the anchor, not a comment model", () => {
    // `// @count = 0` starts with a slash, not `@`, so the `^(\s*)@` anchor
    // misses it. Nothing is "handling comments" here; if the anchor is ever
    // loosened, this silently starts firing.
    const { warnings } = compileSource(db("// @count = 0"), "r3-line-comment.scrml");
    expect(fires(warnings).length).toBe(0);
  });

  // ── 4. ⚑ THE TRIPWIRE — the helper must stay UNREACHABLE ─────────────────
  //
  // ⛑ S383 — THE PRIMARY ASSERTION MOVED ONE STEP EARLIER, AND THE OLD ONE WAS
  // HOLEY. It was `/^\s*import\s*\{[^}]*maskCommentRegions/m` against
  // `ast-builder.js`, which only sees a NAMED-BRACE import: it misses
  // `import * as lint from "./lint-e-state-block-statement-form.js"` +
  // `lint.maskCommentRegions(...)`, and it misses a dynamic
  // `const { maskCommentRegions } = await import(...)`. Both are ordinary ways
  // to reach an export, and neither is exotic enough to rely on nobody writing.
  //
  // The helper is module-PRIVATE today (`function maskCommentRegions`, not
  // exported — the module's only exports are `DIAGNOSTIC_CODE` and
  // `runEStateBlockStatementForm`), so the soundest thing to assert is exactly
  // that: it cannot be reached at all. Making it reachable is the step any third
  // attempt MUST take first, whatever import syntax follows.
  test("TRIPWIRE — maskCommentRegions must NOT be exported (it is module-private)", () => {
    const lint = readFileSync(
      join(import.meta.dir, "../../src/lint-e-state-block-statement-form.js"),
      "utf8",
    );
    // It must exist, or this test is vacuously green against a renamed helper.
    expect(/\bfunction\s+maskCommentRegions\b/.test(lint)).toBe(true);
    expect(/\bexport\b[^\n]*\bmaskCommentRegions\b/.test(lint)).toBe(false);
    expect(/\bexport\s*\{[^}]*\bmaskCommentRegions\b/s.test(lint)).toBe(false);
  });

  // Kept as defence in depth, and WIDENED past the old regex's blind spots: any
  // way of USING the helper has to NAME it, so an occurrence of the identifier in
  // a CODE position catches the named, namespace and dynamic-import forms alike.
  // The "must not be EXPORTED" test above remains the PRIMARY defence; this one
  // is the second line.
  //
  // ⛑ S383 (R4) — THIS TEST'S FIRST CUT WAS VACUOUS, AND IT FAILED BY THIS PR'S
  // OWN RULE. It stripped comments with `.replace(/\/\*[\s\S]*?\*\//g, "")` — a
  // comment model that is NOT string-aware, which is the exact defect this whole
  // file exists to document. `ast-builder.js` already contains a slash-star
  // inside a STRING literal today (`:16153`, `line.startsWith("/*")`).
  // REPRODUCED: plant `const m = "/* sql-ref ";` followed by a real
  // `maskCommentRegions(...)` call and then a `" */"` string — the stripper
  // swallows from the first literal to the next `*/`, the call vanishes with it,
  // and this test reported GREEN with a live reference in the file.
  //
  // The check is now LINE-LOCAL, so no window can swallow anything: every line
  // mentioning the identifier must be a COMMENT line. A code reference —
  // `import { maskCommentRegions }`, `lint.maskCommentRegions(x)`, a destructured
  // dynamic import, or `/* c */ maskCommentRegions(a)` — sits on a line that is
  // not comment-led and is flagged. The residual is a FALSE RED if someone writes
  // a non-JSDoc block comment whose interior lines lack a leading `*`; that is a
  // human-resolves-in-seconds failure, versus a false GREEN nobody ever sees.
  test("TRIPWIRE — ast-builder.js must not REFERENCE maskCommentRegions in code", () => {
    const src = readFileSync(join(import.meta.dir, "../../src/ast-builder.js"), "utf8");
    const offenders = src
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => line.includes("maskCommentRegions"))
      // A comment line: `//`-led, or the ` * ` interior/opener of a block comment.
      .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
    // …and the banners that DO mention it must still be there, so this test
    // cannot pass by the banners having been deleted.
    expect(src.includes("maskCommentRegions")).toBe(true);
  });

  // ── 5. F5 — the emitted column, which start/end do not vouch for ──────────
  test("F5 — a MID-LINE text child reports the TRUE source column, not 1", () => {
    const source = `<program>\n<db src="app.db" tables="users">@count = 0</db>\n<p>ok</>\n</program>\n`;
    const { warnings } = compileSource(source, "r3-midline-col.scrml");
    const hits = fires(warnings);
    expect(hits.length).toBe(1);
    const trueCol = source.split("\n")[1].indexOf("@count") + 1;
    expect(hits[0].span.col).toBe(trueCol);
    expect(source.slice(hits[0].span.start, hits[0].span.start + 6)).toBe("@count");
    expect(hits[0].span.line).toBe(2);
  });

  test("F5 — a write on a LATER line of the child is unaffected", () => {
    // ⚑ CONTROL, NOT A PIN — and the difference matters when reading a mutation
    // report. From line 1 of the child onward `colStart + 1` IS the right answer,
    // so this test stays GREEN with the F5 fix reverted. It exists to catch the
    // OPPOSITE error (applying `baseCol` to every line), not to pin F5.
    const { warnings } = compileSource(db("  @count = 0"), "r3-later-line-col.scrml");
    const hits = fires(warnings);
    expect(hits.length).toBe(1);
    expect(hits[0].span.col).toBe(3);
  });

  // ⚑ S379 — THE MIRROR SCANNER'S F5 FIX HAD NO PIN AT ALL, which the S379
  // mutation proof surfaced: reverting `li === 0 ? baseCol + colStart :
  // colStart + 1` killed exactly ONE test, the `<db>` one above, while the
  // IDENTICAL fix in `scanMarkupBodyConstAtDecls` was a live behavioural change
  // (MEASURED: `col` 1 on main, 6 here) that nothing would have caught. Both
  // scanners got the fix; both get a pin.
  test("F5 (mirror) — a MID-LINE markup text child reports the TRUE column too", () => {
    const source = `<program>\n<div>const @total = 1</div>\n<p>ok</>\n</program>\n`;
    const { warnings } = compileSource(source, "r3-midline-col-markup.scrml");
    const hits = constAt(warnings);
    expect(hits.length).toBe(1);
    const trueCol = source.split("\n")[1].indexOf("const @total") + 1;
    expect(trueCol).toBeGreaterThan(1); // the fixture must actually be mid-line
    expect(hits[0].span.col).toBe(trueCol);
    // `col` must agree with the byte-exact `start` beside it — the disagreement
    // is the defect, not the column value on its own.
    expect(source.slice(hits[0].span.start, hits[0].span.start + 12)).toBe("const @total");
    expect(hits[0].span.line).toBe(2);
  });
});
