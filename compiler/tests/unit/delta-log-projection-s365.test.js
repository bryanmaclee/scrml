/**
 * delta-log-projection-s365.test.js — pins scripts/state.ts's delta-log parser (S365).
 *
 * WHY THIS EXISTS. The digest is what the PA reads at session-start and TRUSTS when the head stamp
 * matches. It projects `handOffs/delta-log.md` through a regex that was byte-identical to the one in
 * `scripts/delta-lint.ts` — and when the writing convention drifted to `[NNNN] <emoji> <kind> · body`
 * NEITHER accepted it, so four live entries ([561] [562] [565] [727]) were dropped from the digest
 * while the gate built to prevent exactly that dropping printed PASS at exit 0.
 *
 * TWO invariants are pinned, because fixing only the first is how this recurs:
 *
 *   (1) POPULATION — every line in the live scope opening with `[NNNN]` is either parsed or reported
 *       as unparsed. There is no third bucket, so a partial parse is always detectable.
 *   (2) BUCKETING  — the optional marker is NOT folded into `kind`. `kind` drives the rulings
 *       (`kind.includes("rule")`) and activity (`/disp|land|find|state/`) filters, so a marker-form
 *       entry parsed with `kind === "⭐ rule"` would be parsed-but-mis-bucketed: still absent from the
 *       digest, just via a quieter route.
 *
 * `parseDeltaLog` is exported for the same reason `parseGapMarkers` is — see the S307 note in
 * scripts/state.ts. The file-reading wrapper and the process-exiting guard are exercised by
 * `bun scripts/state.ts --check|--write|--digest`, not here.
 */

import { describe, test, expect } from "bun:test";
import { parseDeltaLog } from "../../../scripts/state.ts";

const HEAD = "# delta-log\n## Session 236 — 2026-07-03\n";
const log = (...entries) => HEAD + entries.map((e) => `${e}\n`).join("");

describe("parseDeltaLog §1 — population accounting", () => {
  test("canonical entries: bracketed === parsed, nothing unparsed", () => {
    const d = parseDeltaLog(log("[1600] rule · alpha", "[1601] find · beta"));
    expect(d.bracketed).toBe(2);
    expect(d.total).toBe(2);
    expect(d.unparsed).toEqual([]);
    expect(d.lastSeq).toBe(1601);
  });

  test("a bracketed line the parser cannot read is REPORTED, by FILE line number", () => {
    const d = parseDeltaLog(log("[1600] rule · alpha", "[1601] two words · beta", "[1602] land · gamma"));
    expect(d.bracketed).toBe(3);
    expect(d.total).toBe(2);
    // HEAD is 2 lines, so the offending entry is file line 4.
    expect(d.unparsed).toEqual([4]);
  });

  test("bracketed never undercounts parsed — the invariant that makes drift detectable", () => {
    const d = parseDeltaLog(log("[1600] rule · alpha", "[1601] - · beta", "[1602] ⭐ land · gamma", "prose"));
    expect(d.bracketed).toBe(d.total + d.unparsed.length);
  });

  test("only the LAST `## Session` section is in scope", () => {
    const text =
      "## Session 100\n[1] rule · old\n[2] find · old\n## Session 236 — 2026-07-03\n[1600] rule · new\n";
    const d = parseDeltaLog(text);
    expect(d.total).toBe(1);
    expect(d.lastSeq).toBe(1600);
    expect(d.sessHeader).toBe("S236 — 2026-07-03");
  });
});

describe("parseDeltaLog §2 — the marker form is parsed and correctly BUCKETED", () => {
  test("`⭐` marker: entry counted, and the marker is NOT part of kind", () => {
    const d = parseDeltaLog(log("[561] ⭐ find/rule · body"));
    expect(d.total).toBe(1);
    expect(d.unparsed).toEqual([]);
    expect(d.entries).toEqual([{ seq: 561, kind: "find/rule", body: "body" }]);
  });

  test("`⚠️` marker (two code points — U+26A0 + variation selector) parses", () => {
    const d = parseDeltaLog(log("[727] ⚠️ rule-falsified · body"));
    expect(d.total).toBe(1);
    expect(d.rulings.map((e) => e.seq)).toEqual([727]);
  });

  test("an astral-plane emoji marker (surrogate pair) parses", () => {
    const d = parseDeltaLog(log("[900] 🚩 land · body"));
    expect(d.total).toBe(1);
    expect(d.activity.map((e) => e.kind)).toEqual(["land"]);
  });

  test("marker-form entries reach the rulings AND activity buckets, not just the entry list", () => {
    const d = parseDeltaLog(
      log("[561] ⭐ find/rule · a", "[562] ⭐ rule · b", "[565] ⭐ find · c", "[727] ⚠️ rule-falsified · d"),
    );
    expect(d.total).toBe(4);
    expect(d.rulings.map((e) => e.seq)).toEqual([561, 562, 727]);
    expect(d.activity.map((e) => e.seq)).toEqual([561, 565]);
  });

  test("the body is preserved verbatim, mid-body `·` included", () => {
    const d = parseDeltaLog(log("[562] ⭐ rule · alpha · beta → ptr"));
    expect(d.rulings[0].body).toBe("alpha · beta → ptr");
  });
});

describe("parseDeltaLog §3 — the widen is NARROW (residual drift stays visible)", () => {
  test("a two-word head is NOT swallowed as marker+kind", () => {
    const d = parseDeltaLog(log("[1601] two words · beta"));
    expect(d.total).toBe(0);
    expect(d.unparsed.length).toBe(1);
  });

  test("separator drift is still unparsed", () => {
    const d = parseDeltaLog(log("[1601] rule - beta"));
    expect(d.total).toBe(0);
    expect(d.unparsed.length).toBe(1);
  });

  test("a kind opening with a non-word char is still a KIND, not a marker", () => {
    const d = parseDeltaLog(log("[1601] §34-rule · beta"));
    expect(d.total).toBe(1);
    expect(d.rulings.map((e) => e.kind)).toEqual(["§34-rule"]);
  });
});

describe("parseDeltaLog §4 — the canonical three-token shape captures EXACTLY as before", () => {
  // The pre-S365 regex, verbatim. Every line it could parse must still yield the same seq/kind/body
  // — the widen may only ADD a population, never reinterpret the one already being read.
  const OLD = /^\[(\d+)\]\s+(\S+)\s+·\s+(.*)$/;
  const lines = [
    "[1600] rule · a plain body",
    "[1601] disp · dispatched → somewhere",
    "[1602] find/rule · two kinds in one token",
    "[1603] state · body with · a middot inside",
    "[1604] §34-rule · a kind opening with a non-word char",
  ];

  test.each(lines)("%s — seq/kind/body identical to the pre-S365 parser", (line) => {
    const old = line.match(OLD);
    expect(old).not.toBeNull(); // guards the fixture: these must be lines the OLD parser handled

    const d = parseDeltaLog(log(line));
    expect(d.entries).toEqual([
      { seq: parseInt(old[1], 10), kind: old[2], body: old[3] },
    ]);
  });

  test("kind is captured verbatim for each canonical shape", () => {
    const d = parseDeltaLog(log(...lines));
    expect(d.total).toBe(5);
    // activity filter = /disp|land|find|state/ over kind; rulings = kind.includes("rule").
    expect(d.activity.map((e) => e.kind)).toEqual(["disp", "find/rule", "state"]);
    expect(d.rulings.map((e) => e.kind)).toEqual(["rule", "find/rule", "§34-rule"]);
  });
});
