/**
 * bare-slash-before-close-tag-bug4.test.js — S177 bug-4 (LOW).
 *
 * SPEC §4 / CONF-015: a bare `/` is no longer a valid closer (Phase 3). The
 * block-splitter's legacy bare-`/`-closer heuristic (`looksLikeCloser`) flags a
 * `/` in markup text that stands WHERE a closer would go.
 *
 * BUG-4: the heuristic fired on ANY following `<` — including a `/` immediately
 * before a REAL CLOSE TAG (`</...`). But a `/` before `</p>` / `</>` cannot be a
 * closer attempt: the close tag IS the closer, so the `/` is unambiguously
 * literal markup text (a trailing path slash, a standalone slash in prose). This
 * false-fired E-SYNTAX-050 on legitimate markup like
 * `<li>The values "" / 0 / [] are all defined /</>`.
 *
 * FIX (block-splitter.js): `looksLikeCloser` fires when next-non-ws is EOF, OR a
 * NEW OPENER (`<` NOT followed by `/`). A close tag (`</`) suppresses the fire.
 * The CONF-015 canonical contract (`/` at EOF) is PRESERVED; only the
 * slash-before-close-tag over-fire is removed.
 *
 * Coverage:
 *   §1 — the exact bug-4 reproducer compiles clean (no E-SYNTAX-050)
 *   §2 — `/` before `</p>` / `</>` is literal (no fire)
 *   §3 — `/` at EOF still fires (CONF-015 canonical, preserved)
 *   §4 — `/` before a NEW OPENER (`<li`) still fires (genuine legacy-closer)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "bug4-slash-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function codes(arr) { return (arr || []).map((e) => e.code); }
function allDiagnostics(result) { return [...(result.errors || []), ...(result.warnings || [])]; }
function split(src) { return splitBlocks("/tmp/bug4.scrml", src); }
function fires050(src) { return split(src).errors.some((e) => e.code === "E-SYNTAX-050"); }

describe("§1 bug-4 reproducer compiles clean", () => {
  test("trailing literal `/` before `</>` does NOT false-fire E-SYNTAX-050", () => {
    const result = compile("b4.scrml", `<program>
  <article class="prose">
    <ul>
      <li>The values "" / 0 / [] are all defined /</>
      <li>second item</>
    </ul>
  </article>
</program>`);
    expect(codes(allDiagnostics(result))).not.toContain("E-SYNTAX-050");
  });
});

describe("§2 `/` immediately before a CLOSE tag is literal text", () => {
  test("`<p>hello/</p>` does NOT fire (close tag present)", () => {
    expect(fires050("<p>hello/</p>")).toBe(false);
  });
  test("`<li>x defined /</>` (generic close) does NOT fire", () => {
    expect(fires050("<li>x defined /</>")).toBe(false);
  });
  test("`<p>hello /</p>` (ws before `/`) does NOT fire", () => {
    expect(fires050("<p>hello /</p>")).toBe(false);
  });
});

describe("§3 `/` at EOF still fires (CONF-015 canonical contract preserved)", () => {
  test("`<p>hello/` (EOF) fires E-SYNTAX-050", () => {
    expect(fires050("<p>hello" + "/")).toBe(true);
  });
  test("`<div>content/` (EOF) fires E-SYNTAX-050", () => {
    expect(fires050("<div>content" + "/")).toBe(true);
  });
});

describe("§4 `/` before a NEW OPENER still fires (genuine legacy-closer)", () => {
  test("`<div>hi/<p>x</p></div>` fires E-SYNTAX-050", () => {
    expect(fires050("<div>hi/<p>x</p></div>")).toBe(true);
  });
});
