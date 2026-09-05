/**
 * dpa-debt-parse.test.js — pins `scripts/dpa-debt.ts`'s queue parse (S401, the bite proof).
 *
 * WHY THIS EXISTS. `dpa-debt.ts` is the deliberation-queue instrument: boot step 0.6 runs it and the
 * PA states the owed count in the boot report. It underwrites the rule that *a channel the probe does
 * not read does not exist to the PA* — so when the probe itself goes blind, the channel silently stops
 * existing, which is the failure it was built to prevent, one level up.
 *
 * THE DEFECT IT PINS (S401). The row parse split on a bare `"\n"`. On a CRLF checkout — every Windows
 * clone with `core.autocrlf=true`, and `handOffs/dpa-queue.md` measured 2,721 CRs — each line carries
 * a trailing `\r`. The row regex ends `(.*)$`, and `.` NEVER matches `\r`, so `$` is unreachable and
 * every row fails. Measured by execution against both encodings of the real file: **CRLF 0 / LF 43.**
 * The probe printed `0 queued · ✓ nothing owed` while 3 deliberations sat UNRUN and 4 sat ADVISORY
 * awaiting bryan's ratify/reject.
 *
 * ⚑ The failure direction is what makes it dangerous: it fails toward a FALSELY-CLEAN board. A probe
 * that over-reports gets investigated; one that reports zero gets believed and closes the boot item.
 * `pa-base` §8: "a gate that has never failed is indistinguishable from a gate that CANNOT fail —
 * prove the bite when you build it, and AGAIN AFTER ANY CHANGE TO THE GATE ITSELF."
 *
 * THIRD INSTANCE OF THE CLASS in `scripts/` — `state.ts:666` and `delta-lint.ts:82` each carry the
 * same fix and the same comment, both landed after the same silent-zero symptom. This test exists so
 * the fourth instance is a red test rather than another quiet boot.
 *
 * Properties pinned below, each one a thing a future edit could silently break:
 *   1. CRLF and LF input parse IDENTICALLY (the regression itself);
 *   2. the same holds for the per-item `status:` cross-check, which shares the split;
 *   3. drift detection survives CRLF — the stale-TABLE signal is the one that caught dpa-022/023;
 *   4. the pre-fix bare-"\n" split is reconstructed here, so a revert fails LOUD;
 *   5. classification still keys on the LEADING token (the anchored-match rule the file was built on).
 */

import { describe, test, expect } from "bun:test";
import { classify, parseRows, parseItems, findDrift } from "../../../scripts/dpa-debt.ts";

/** A minimal queue with one row per state, plus the per-item bodies the cross-check reads. */
const QUEUE_LF = [
  "# dPA queue",
  "",
  "| item | TRUE status | authority |",
  "|---|---|---|",
  "| dpa-001 | **RATIFIED** S210 — direction ratified | block · \"ratify ship A2\" |",
  "| dpa-041 | **BANKED — UNRUN** S399 2026-09-04 | — |",
  "| dpa-037 | **COMPLETE (ADVISORY)** dPA 2026-08-31 | awaiting bryan |",
  "| dpa-050 | **ROUTED** to bryan | — |",
  "",
  "## dpa-041 — a banked question",
  "status: banked",
  "",
  "## dpa-037 — a completed deliberation",
  "status: complete",
  "",
].join("\n");

const QUEUE_CRLF = QUEUE_LF.replace(/\n/g, "\r\n");

describe("dpa-debt parseRows — the S401 CRLF blindness", () => {
  test("CRLF input yields the SAME rows as LF (the regression)", () => {
    const lf = parseRows(QUEUE_LF);
    const crlf = parseRows(QUEUE_CRLF);
    expect(lf.length).toBe(4);
    expect(crlf.length).toBe(4);
    expect(crlf).toEqual(lf);
  });

  test("every state still classifies correctly under CRLF", () => {
    const byId = new Map(parseRows(QUEUE_CRLF).map((r) => [r.id, r.state]));
    expect(byId.get("dpa-001")).toBe("ratified");
    expect(byId.get("dpa-041")).toBe("unrun");
    expect(byId.get("dpa-037")).toBe("advisory");
    expect(byId.get("dpa-050")).toBe("routed");
  });

  test("the pre-fix bare-\\n split found ZERO rows — the bite, stated as a contrast", () => {
    // the OLD split, reconstructed so a revert is caught by a failing test rather than a quiet boot
    const preFix = QUEUE_CRLF.split("\n").filter((l) => /^\|\s*(dpa-\d+)\s*\|(.*)$/i.test(l));
    expect(preFix.length).toBe(0);
    expect(parseRows(QUEUE_CRLF).length).toBe(4);
  });

  test("a trailing \\r never leaks into a parsed cell value", () => {
    for (const r of parseRows(QUEUE_CRLF)) expect(r.raw).not.toContain("\r");
  });
});

describe("dpa-debt parseItems + findDrift — the cross-check shares the split", () => {
  test("per-item `status:` lines parse identically under CRLF", () => {
    const lf = parseItems(QUEUE_LF);
    const crlf = parseItems(QUEUE_CRLF);
    expect(lf.get("dpa-041")).toBe("banked");
    expect(lf.get("dpa-037")).toBe("complete");
    expect([...crlf.entries()]).toEqual([...lf.entries()]);
  });

  test("the stale-TABLE drift signal survives CRLF (the dpa-022/023 shape)", () => {
    // table says UNRUN, the item body says it already ran → the S325 miss, and it must still fire
    const stale = QUEUE_CRLF.replace("## dpa-041 — a banked question\r\nstatus: banked",
                                     "## dpa-041 — a banked question\r\nstatus: complete");
    const drift = findDrift(parseRows(stale), parseItems(stale));
    expect(drift.length).toBe(1);
    expect(drift[0]).toContain("dpa-041");
    expect(drift[0]).toContain("table=UNRUN");
  });
});

describe("dpa-debt classify — the anchored-match rule still holds", () => {
  test("a row that NARRATES 'BANKED — UNRUN' is not classified as unrun", () => {
    // the dpa-022/023 false positive this file was built to avoid: the cell describes the string
    expect(classify('**COMPLETE** — this row read "BANKED — UNRUN" until S325 corrected it', "")).toBe("advisory");
  });

  test("column 3 ratification wins over a column 2 that still reads COMPLETE", () => {
    expect(classify("**COMPLETE (ADVISORY)**", "RATIFIED S319")).toBe("ratified");
  });
});
