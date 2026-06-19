/**
 * render-by-tag-compound-member-non-lexical.test.js — regression test for
 * g-compound-field-render-by-tag-unexpanded (S207, filed S206).
 *
 * The gap (sibling of Bug 60): a Shape-2 compound MEMBER's render-by-tag
 * (`<uname/>`) referenced OUTSIDE the compound's lexical block body — e.g. in a
 * sibling `<form>` rather than inside `<signup>...</signup>` — was silently
 * emitted as a LITERAL `<uname />` tag (exit 0, no diagnostic), the bound
 * `<input>` never rendered, plus a spurious `E-DG-002 @signup never consumed`.
 *
 * Bug 60 (S157) closed only the LEXICAL case: a `<field/>` inside the compound
 * block-form wrapper resolves via the `enclosingCompoundStack` →
 * lookupQualifiedStateCell fallback. When the use site is NOT lexically inside
 * the compound, that stack is empty, both lookups miss, and the tag fell
 * through to literal-tag emission.
 *
 * Fix (SPEC §6.3.5:2290 + §6.4.2):
 *   1. emit-html.ts — when both the top-level lookup and the lexical-stack
 *      fallback miss, scan ALL in-scope compound parents for a member by leaf
 *      name (lookupCompoundMembersByLeafName). Exactly one match → resolve to
 *      the SAME Shape-2 bound-input expansion (keyed on the qualifiedPath,
 *      `signup.uname`). More than one → E-CELL-AMBIGUOUS-MEMBER-RENDER (no
 *      silent pick, §6.4) and leave the tag unexpanded.
 *   2. dependency-graph.ts — a member render-by-tag credits the PARENT compound
 *      (the cell that owns the DG node; members are folded into the parent), so
 *      E-DG-002 no longer false-fires on a compound consumed only through a
 *      member `<field/>`.
 *
 * Note: E-DG-002 has severity "warning" → result.warnings, NOT result.errors
 * (diagnostic-stream partition). Assertions use a cross-stream helper.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/g-compound-rbt-non-lexical");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileSource(name, src) {
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + Math.random().toString(36).slice(2, 8));
  const result = compileScrml({
    inputFiles: [inputPath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  let clientJs = "";
  let html = "";
  let clientJsPath = "";
  function findFiles(dir) {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) findFiles(p);
      else if (ent.name.endsWith(".client.js")) { clientJs = readFileSync(p, "utf-8"); clientJsPath = p; }
      else if (ent.name.endsWith(".html")) html = readFileSync(p, "utf-8");
    }
  }
  findFiles(outDir);
  return {
    clientJs,
    clientJsPath,
    html,
    errors: result?.errors ?? [],
    warnings: result?.warnings ?? [],
  };
}

// Cross-stream helper — a diagnostic may land in errors OR warnings depending
// on severity. E-DG-002 is "warning"; E-CELL-AMBIGUOUS-MEMBER-RENDER is an
// error. Checking only one stream would silently pass. See diagnostic-stream
// memory.
function hasCode(res, code) {
  return [...(res.errors ?? []), ...(res.warnings ?? [])].some((d) => d.code === code);
}

// ---------------------------------------------------------------------------
// §1: compound MEMBER render-by-tag used OUTSIDE the compound block (the gap)
// ---------------------------------------------------------------------------

describe("g-compound-rbt §1: compound-member render-by-tag in a sibling element", () => {
  // <uname/> is referenced inside <form>, NOT inside <signup>. The decl is a
  // member of <signup>; the use site is non-lexical.
  const SRC =
    `<program>\n` +
    `  <signup>\n` +
    `    <uname req length(>=2)> = <input type="text" id="u"/>\n` +
    `  </>\n\n` +
    `  <form>\n` +
    `    <uname/>\n` +
    `    <errors of=@signup.uname/>\n` +
    `  </form>\n` +
    `</>\n`;

  test("member <uname/> expands to the bound input (NOT a literal tag)", () => {
    const { html } = compileSource("non-lexical-expand.scrml", SRC);
    // Expands to <input type="text"> — identical shape to the top-level case.
    expect(html).toMatch(/<input[^>]*type="text"/);
    expect(html).toMatch(/data-scrml-render-by-tag=/);
    // The bug: a literal <uname /> tag survived in the HTML.
    expect(html).not.toMatch(/<uname\b/);
  });

  test("validators lower to HTML-native attributes (req → required, length → minlength)", () => {
    const { html } = compileSource("non-lexical-validators.scrml", SRC);
    expect(html).toMatch(/required/);
    expect(html).toMatch(/minlength="2"/);
  });

  test("bind wiring keys on the QUALIFIED runtime cell (signup.uname)", () => {
    const { clientJs } = compileSource("non-lexical-bind-keys.scrml", SRC);
    expect(clientJs).toMatch(/_scrml_reactive_get\("signup\.uname"\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("signup\.uname",/);
    expect(clientJs).toMatch(/addEventListener\("input"/);
  });

  test("the §55 validity surface still wires (signup.uname.errors / .isValid)", () => {
    const { clientJs } = compileSource("non-lexical-validity.scrml", SRC);
    expect(clientJs).toMatch(/"signup\.uname\.errors"/);
    expect(clientJs).toMatch(/"signup\.uname\.isValid"/);
  });

  test("no spurious E-DG-002 on the consumed compound (@signup)", () => {
    const res = compileSource("non-lexical-no-edg002.scrml", SRC);
    expect(hasCode(res, "E-DG-002")).toBe(false);
    expect(res.errors.length).toBe(0);
  });

  test("emitted client.js is valid JS (node --check)", () => {
    const { clientJsPath } = compileSource("non-lexical-node-check.scrml", SRC);
    expect(clientJsPath.length).toBeGreaterThan(0);
    expect(() => execFileSync("node", ["--check", clientJsPath])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2: AMBIGUITY — same member name in two compounds → diagnostic, no silent pick
// ---------------------------------------------------------------------------

describe("g-compound-rbt §2: ambiguous member name across two compounds", () => {
  const SRC =
    `<program>\n` +
    `  <signup>\n` +
    `    <uname req> = <input type="text" id="s"/>\n` +
    `  </>\n` +
    `  <login>\n` +
    `    <uname req> = <input type="text" id="l"/>\n` +
    `  </>\n\n` +
    `  <form>\n` +
    `    <uname/>\n` +
    `  </form>\n` +
    `</>\n`;

  test("a bare <uname/> matching two compounds fires E-CELL-AMBIGUOUS-MEMBER-RENDER", () => {
    const res = compileSource("ambiguous.scrml", SRC);
    expect(hasCode(res, "E-CELL-AMBIGUOUS-MEMBER-RENDER")).toBe(true);
  });

  test("the ambiguous tag is NOT silently expanded to either member (no silent pick)", () => {
    const { html } = compileSource("ambiguous-no-pick.scrml", SRC);
    // The two candidate inputs carry distinct ids (s / l). Neither is emitted
    // from the ambiguous <uname/> — only the two render-spec declarations exist
    // at decl sites are NOT in markup (they live in the compound bodies, which
    // are transparent). The ambiguous reference leaves a literal tag (unexpanded).
    expect(html).toMatch(/<uname\b/);
  });
});

// ---------------------------------------------------------------------------
// §3: NEGATIVE no-regression — top-level Shape-2 render-by-tag unchanged
// ---------------------------------------------------------------------------

describe("g-compound-rbt §3: top-level Shape-2 render-by-tag no-regression", () => {
  const SRC =
    `<program>\n` +
    `  <uname req length(>=2)> = <input type="text" id="u"/>\n\n` +
    `  <form>\n` +
    `    <uname/>\n` +
    `  </form>\n` +
    `</>\n`;

  test("top-level <uname/> still expands to the bound input identically", () => {
    const { html, clientJs, errors } = compileSource("toplevel-control.scrml", SRC);
    expect(errors.length).toBe(0);
    expect(html).toMatch(/<input[^>]*type="text"/);
    expect(html).toMatch(/required/);
    expect(html).toMatch(/minlength="2"/);
    expect(html).toMatch(/data-scrml-render-by-tag=/);
    expect(html).not.toMatch(/<uname\b/);
    // Top-level cells key on the bare name (qualifiedPath === name).
    expect(clientJs).toMatch(/_scrml_reactive_get\("uname"\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("uname",/);
  });

  test("top-level render-by-tag-only cell does not false-fire E-DG-002", () => {
    const res = compileSource("toplevel-no-edg002.scrml", SRC);
    expect(hasCode(res, "E-DG-002")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4: PRECISION — a genuinely-unused compound STILL fires E-DG-002
// ---------------------------------------------------------------------------

describe("g-compound-rbt §4: E-DG-002 precision (no over-crediting)", () => {
  test("a compound whose member is NEVER rendered STILL fires E-DG-002", () => {
    const SRC =
      `<program>\n` +
      `  <signup>\n` +
      `    <uname req> = <input type="text" id="u"/>\n` +
      `  </>\n\n` +
      `  <form>\n` +
      `    <p>hello</p>\n` +
      `  </form>\n` +
      `</>\n`;
    const res = compileSource("orphan-still-fires.scrml", SRC);
    expect(hasCode(res, "E-DG-002")).toBe(true);
  });
});
