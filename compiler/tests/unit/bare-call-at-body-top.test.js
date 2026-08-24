/**
 * S368 — a bare CALL at a §40.8 default-logic body-top fires
 * E-CALL-NOT-IN-LOGIC-CONTEXT.
 *
 * MERGE-BLOCKER. The five cases the S368 brief names are pinned here, and three
 * of them are COUNTER-gates: they fail you for over-reaching, not for
 * under-reaching. Deleting or loosening one re-opens a shape the ruling
 * explicitly protected.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * §40.8 default-logic mode auto-lifts DECLARATIONS only. The complement is
 * emitted as page TEXT — right for prose, wrong for logic. A call is logic by
 * the identical reasoning that already rejects a bare write at the same
 * position (`E-WRITE-NOT-IN-LOGIC-CONTEXT`, S122 Option-2).
 *
 * Measured pre-fix: `<program>` + `loadData()` compiled at exit 0 and shipped
 * the literal string `loadData()` into the emitted HTML.
 *
 * ── ⚑ The discriminator is scrml's grammar, NOT JS's ─────────────────────────
 * Operator-ruled S368, verbatim: *"There is lots of valid js that dose not work
 * in scrml … 'valid js' is not a consideration one way or another."* No
 * assertion in this file rests on whether a run parses as JS, and none should
 * be added that does. A call is a scrml logic form; a bare word is not.
 *
 * SPEC: §40.8 S368 amendment + the §34 `E-CALL-NOT-IN-LOGIC-CONTEXT` row.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { isDefaultLogicBodyTopExempt } from "../../src/default-logic-exemption.ts";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const FIXTURE_DIR = "/tmp/s368-bare-call-at-body-top-fixtures";
mkdirSync(FIXTURE_DIR, { recursive: true });

const CODE = "E-CALL-NOT-IN-LOGIC-CONTEXT";

function compileSource(source, filename) {
  const filePath = join(FIXTURE_DIR, filename);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(FIXTURE_DIR, "dist"),
    write: false,
  });
  const out = result.outputs?.get?.(filePath) ?? {};
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    html: out.html ?? "",
  };
}

const fires = (errors) => errors.filter((e) => e.code === CODE);

describe("S368 — E-CALL-NOT-IN-LOGIC-CONTEXT at a §40.8 default-logic body-top", () => {
  // ── 1. THE DEFECT — a bare call is diagnosed ──────────────────────────────
  test("Case 1 — bare `loadData()` at <program> body-top FIRES", () => {
    const { errors, warnings } = compileSource(
      `<program>\nloadData()\n<p>hi</>\n</program>\n`,
      "case-1-bare-call.scrml",
    );
    const hits = fires(errors);
    expect(hits.length).toBe(1);
    // It is an ERROR, not a lint: it partitions into `result.errors` and never
    // into `result.warnings`. (TABError carries no `severity` field — the
    // stream it lands in IS the severity claim.)
    expect(fires(warnings).length).toBe(0);
    expect(hits[0].message).toContain("loadData");
    expect(hits[0].message).toContain("default-logic body-top");
    expect(hits[0].message).toContain("§40.8");
    // The message must NAME THE FIX the way the write diagnostic names its own.
    expect(hits[0].message).toContain("${ loadData(...) }");
  });

  test("Case 1b — the rejected call is NOT emitted as page text (reject + RECOVER)", () => {
    const { html } = compileSource(
      `<program>\nloadData()\n<p>hi</>\n</program>\n`,
      "case-1b-recover.scrml",
    );
    // Pre-fix this shipped the literal `loadData()` into the document.
    expect(html).not.toContain("loadData()");
  });

  test("Case 1c — a bare MEMBER call `store.refresh()` FIRES", () => {
    const { errors } = compileSource(
      `<program>\nstore.refresh()\n<p>hi</>\n</program>\n`,
      "case-1c-member-call.scrml",
    );
    const hits = fires(errors);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("store.refresh");
  });

  test("Case 1d — the surface is <page> and <channel> too, not just <program>", () => {
    const { errors } = compileSource(
      `<program>\n<page>\nloadData()\n<p>hi</>\n</>\n</program>\n`,
      "case-1d-page-body-top.scrml",
    );
    expect(fires(errors).length).toBe(1);
  });

  test("Case 1e — the IMPLICIT default-logic body (a file with no <program>) is the surface too", () => {
    // MEASURED at S368: `E-WRITE-NOT-IN-LOGIC-CONTEXT` already fires at a
    // no-`<program>` file top level, the decl-lift gates already fire there, and
    // a bare call there ships as page text exactly as it does inside
    // `<program>`. Dropping this case would diagnose a call inside `<program>`
    // while silently dropping the same call in a module file.
    const { errors } = compileSource(
      `\${ function loadData() { } }\n\nloadData()\n\n<p>hi</>\n`,
      "case-1e-implicit-body.scrml",
    );
    expect(fires(errors).length).toBe(1);
  });

  // ── 2. COUNTER-GATE — prose still renders ─────────────────────────────────
  // A fix that rejects either of the next two is WRONG. Both are working shapes
  // at this position and option (a) "lift every text run" was rejected for
  // breaking exactly them.
  test("Case 2 — a prose SENTENCE at body-top still compiles AND still renders", () => {
    const { errors, html } = compileSource(
      `<program>\nWelcome to the dashboard.\n<p>hi</>\n</program>\n`,
      "case-2-prose-sentence.scrml",
    );
    expect(fires(errors).length).toBe(0);
    expect(errors.length).toBe(0);
    expect(html).toContain("Welcome to the dashboard.");
  });

  test("Case 3 — a BARE WORD at body-top still compiles AND still renders", () => {
    const { errors, html } = compileSource(
      `<program>\nLoading\n<p>hi</>\n</program>\n`,
      "case-3-bare-word.scrml",
    );
    expect(fires(errors).length).toBe(0);
    expect(errors.length).toBe(0);
    expect(html).toContain("Loading");
  });

  test("Case 3b — prose with a SPACED parenthetical is not a call form", () => {
    // `Loading (please wait)` — the space before `(` is what keeps natural prose
    // out. Losing the attachment requirement re-breaks this.
    const { errors, html } = compileSource(
      `<program>\nLoading (please wait)\n<p>hi</>\n</program>\n`,
      "case-3b-spaced-paren.scrml",
    );
    expect(fires(errors).length).toBe(0);
    expect(html).toContain("Loading (please wait)");
  });

  // ── 4/5. COUNTER-GATES — the discrimination is IMMEDIATE body-top only ────
  test("Case 4 — a call inside an explicit user-written `${...}` still compiles", () => {
    const { errors } = compileSource(
      `<program>\n\${ function loadData() { } }\n\${ loadData() }\n<p>hi</>\n</program>\n`,
      "case-4-call-in-logic-block.scrml",
    );
    expect(fires(errors).length).toBe(0);
  });

  test("Case 5 — a call inside a `function` body still compiles", () => {
    const { errors } = compileSource(
      `<program>\nfunction helper() { }\nfunction loadData() { helper() }\n<p>hi</>\n</program>\n`,
      "case-5-call-in-fn-body.scrml",
    );
    expect(fires(errors).length).toBe(0);
  });

  test("Case 5b — a call on a later line of a DECL-LED run still compiles (the decl lifts the run)", () => {
    const { errors } = compileSource(
      `<program>\nfunction loadData() { }\nloadData()\n<p>hi</>\n</program>\n`,
      "case-5b-decl-led-run.scrml",
    );
    expect(fires(errors).length).toBe(0);
  });

  // ── Locus counter-gates — OUT of the §40.8 surface ────────────────────────
  test("Case 6 — a call in a deeper MARKUP body does NOT fire this code", () => {
    // Out of scope by ruling: `isDefaultLogicBody` is false there. Separate
    // locus, separate ruling — this code must not creep into it.
    const { errors } = compileSource(
      `<program>\n<div>\nloadData()\n</>\n</program>\n`,
      "case-6-markup-body.scrml",
    );
    expect(fires(errors).length).toBe(0);
  });

  // ── Keyword fence ─────────────────────────────────────────────────────────
  test("Case 7 — a leading KEYWORD head-paren is not a call and does NOT fire", () => {
    // `if (...)`'s paren is a HEAD-paren, not an argument list. Bare control
    // flow at this position is a DIFFERENT shape with its own (unmade) ruling —
    // option (b) "diagnose every non-declaration run" was explicitly REJECTED.
    const { errors } = compileSource(
      `<program>\n\${ <n> = 1 }\nif (@n > 0) { }\n<p>\${@n}</>\n</program>\n`,
      "case-7-keyword-head-paren.scrml",
    );
    expect(fires(errors).length).toBe(0);
  });

  test("Case 7b — an identifier merely PREFIXED by a keyword IS a call (fence, not prefix match)", () => {
    // `iffy(` must not be swallowed by an `if` fence. Invariant 46: a scrml
    // keyword fence is `(?![A-Za-z0-9_$])`, never `\b`, and never a bare prefix.
    const { errors } = compileSource(
      `<program>\niffy()\n<p>hi</>\n</program>\n`,
      "case-7b-keyword-prefixed-ident.scrml",
    );
    expect(fires(errors).length).toBe(1);
    expect(fires(errors)[0].message).toContain("iffy");
  });

  test("Case 7c — a `$`-bearing identifier IS a call (scrml's charset, not JS `\\w`)", () => {
    // scrml identifiers admit `$` (tokenizer.ts isIdentStart/isIdentPart). A
    // recognizer written against JS `\w` misses this.
    const { errors } = compileSource(
      `<program>\nload$Data()\n<p>hi</>\n</program>\n`,
      "case-7c-dollar-identifier.scrml",
    );
    expect(fires(errors).length).toBe(1);
    expect(fires(errors)[0].message).toContain("load$Data");
  });

  test("Case 7d — a keyword-named scrml BUILTIN call form still fires", () => {
    // `reset(@cell)` is §6.8.2's call form — a scrml call, so it is logic, so a
    // bare one at body-top never runs and must be diagnosed. Fencing on the
    // whole KEYWORDS set without this allow-list would silently miss it.
    const { errors } = compileSource(
      `<program>\n\${ <count> = 0 }\nreset(@count)\n<p>\${@count}</>\n</program>\n`,
      "case-7d-builtin-call-keyword.scrml",
    );
    expect(fires(errors).length).toBe(1);
    expect(fires(errors)[0].message).toContain("reset");
  });

  // ── Shared per-file exemption ─────────────────────────────────────────────
  test("Case 9 — the exemption list is a valid string array (a malformed one silently disables BOTH §40.8 body-top codes)", () => {
    // The loader's `catch { return [] }` swallows a parse error, and a
    // non-string entry makes the whole list fall back to empty. Either way the
    // failure is SILENT. Fail-closed (nothing exempt) is the safe direction, but
    // it would silently un-exempt a file an operator had deliberately listed —
    // so the list's SHAPE gets an assertion rather than trust.
    const raw = readFileSync(
      join(import.meta.dir, "../../src/unit-cc-exemption-list.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    for (const entry of parsed) expect(typeof entry).toBe("string");
  });

  test("Case 9b — E-CALL-NOT-IN-LOGIC-CONTEXT and E-WRITE-NOT-IN-LOGIC-CONTEXT share ONE exemption predicate", () => {
    // Same §40.8 body-top locus, same newly-rejecting migration surface: a file
    // that needs suppression needs it for the SURFACE, not for one code. If this
    // ever becomes two lists, an adopter migrates the same file twice.
    expect(typeof isDefaultLogicBodyTopExempt).toBe("function");
    expect(isDefaultLogicBodyTopExempt("")).toBe(false);
    expect(isDefaultLogicBodyTopExempt("/tmp/definitely-not-listed.scrml")).toBe(false);
  });

  // ── Span ──────────────────────────────────────────────────────────────────
  test("Case 8 — the fire is placed at the CALL, not at the block opener", () => {
    const { errors } = compileSource(
      `<program>\n<p>first</>\nloadData()\n<p>hi</>\n</program>\n`,
      "case-8-span.scrml",
    );
    const hits = fires(errors);
    expect(hits.length).toBe(1);
    expect(hits[0].span.line).toBe(3);
  });
});
