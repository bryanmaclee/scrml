/**
 * W-AUTH-002 — RETIRED (S235). Regression lock: the interim Tier-1
 * server-authority residual warning no longer fires.
 *
 * HISTORY. W-AUTH-002 landed S194 (change-id g1-server-sync-codegen-2026-06-14)
 * as an INTERIM honesty warning: a Tier-1 `< Type authority="server" table=>`
 * type got its `SELECT *` initial load on mount, but its rows were NOT yet
 * pre-rendered into the initial HTML — instances loaded client-side after first
 * paint (a brief placeholder flash). The warning tracked that SSR-pre-render
 * residual (§52.8, gap g-tier1-ssr-prerender).
 *
 * RETIRED S235. The SSR A-terminus shipped the residual end-to-end:
 *   - D1 (S234, codegen/emit-ssr-render.ts) server-renders a server-authority
 *     `<each>`'s rows INTO the first-paint HTML, keyed `data-scrml-key`.
 *   - D2 (S235, runtime-template.js `_scrml_reconcile_list`) ADOPTS those rows
 *     flash-free (in-place upgrade, no wipe-then-rebuild).
 * The "placeholder flash / SSR is a tracked follow-on" premise is obsolete for
 * the supported each subset, so the per-type warning is gone. The remaining gap
 * is WIDENING the server-render subset (unsupported each shapes fall back to
 * client-render — g-ssr-render-subset-widen), which is not a per-type concern.
 * The cross-user unscoped-prerender gate `W-SSR-PRERENDER-UNSCOPED` (§52.15) is
 * a distinct, still-live warning and is unaffected by this retirement.
 *
 * Cross-stream note (memory: diagnostic-stream-partition): `runTS` returns all
 * diagnostics in `.errors`; the W-/I- prefix routing to the warnings stream
 * happens DOWNSTREAM at result assembly. So this scan checks BOTH streams.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runTS } from "../../src/type-system.js";

function runTSForSource(src, filePath = "/test/app.scrml") {
  const bs = splitBlocks(filePath, src);
  const { ast } = buildAST(bs);
  return runTS({ files: [ast] });
}

/** Cross-stream find: scan BOTH errors and warnings for a code. */
function findDiag(res, code) {
  const all = [...(res.errors || []), ...(res.warnings || [])];
  return all.find((e) => e.code === code);
}

// The CANONICAL §52.3.5 shape — body-field-list inside a `${…}` logic block.
const CANONICAL = (
  `<program db="sqlite:./t.db">\n` +
  `\${\n` +
  `  < Card authority="server" table="cards">\n` +
  `    id: number\n` +
  `    title: string\n` +
  `  </>\n` +
  `  <Card> @cards\n` +
  `}\n` +
  `</program>`
);

describe("W-AUTH-002: RETIRED (S235) — no longer fires (SSR pre-render + DOM-adoption shipped)", () => {
  test("does NOT fire for the CANONICAL §52.3.5 body-field shape (was the interim fire-case)", () => {
    const res = runTSForSource(CANONICAL);
    expect(findDiag(res, "W-AUTH-002")).toBeUndefined();
  });

  test("does NOT fire for the legacy opener-attr shape (state-constructor-def)", () => {
    const src =
      `<program>\n` +
      `< Card authority="server" table="cards" id(int) title(string)>\n` +
      `  <span></span>\n` +
      `</>\n` +
      `</program>`;
    expect(findDiag(runTSForSource(src), "W-AUTH-002")).toBeUndefined();
  });

  test("does NOT fire for a `authority='local'` state type", () => {
    const src =
      `<program>\n` +
      `< Note authority="local" id(int) body(string)>\n` +
      `  <span></span>\n` +
      `</>\n` +
      `</program>`;
    expect(findDiag(runTSForSource(src), "W-AUTH-002")).toBeUndefined();
  });

  test("does NOT fire for a state type with no authority attribute (defaults local)", () => {
    const src =
      `<program>\n` +
      `< Note id(int) body(string)>\n` +
      `  <span></span>\n` +
      `</>\n` +
      `</program>`;
    expect(findDiag(runTSForSource(src), "W-AUTH-002")).toBeUndefined();
  });

  test("W-AUTH-001 still does NOT fire on a Tier-1 instance (it gets the SELECT * load)", () => {
    const res = runTSForSource(CANONICAL);
    expect(findDiag(res, "W-AUTH-001")).toBeUndefined();
  });
});
