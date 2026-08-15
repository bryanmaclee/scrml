/**
 * issue-debt.test.js — the scripts/issue-debt.ts classifier (S346, the bite proof).
 *
 * WHY THIS EXISTS. issue-debt.ts asserts that every OPEN adopter issue has a HOME
 * (a `docs/known-gaps.md` mention or a `handOffs/dpa-queue.md` mention) or is OWED. Its
 * classifier is a PURE function over strings + a fixed `now` — this test pins it without
 * `gh`, a network, or the clock. An unproven gate is a hypothesis (pa-base §8).
 *
 * The five contract cases (the brief, verbatim): named in neither → OWED; ledger only →
 * HOMED-GAP; queue only → HOMED-DPA; both → HOMED-BOTH; and `#51` must NOT match `#519`
 * (word-boundary the number). Plus the SILENT modifier and the self-reported totals.
 */

import { describe, test, expect } from "bun:test";
import { classify, classifyIssue, mentions, SILENT_AFTER_DAYS } from "../../../scripts/issue-debt.ts";

const NOW = Date.parse("2026-08-15T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const issue = (number, extra = {}) => ({ number, title: `issue ${number}`, createdAt: daysAgo(5), comments: 1, ...extra });

describe("issue-debt — the five classification cases", () => {
  test("named in NEITHER ledger → OWED", () => {
    const c = classifyIssue(issue(471), "### g-something — no issue named here", "| dpa-001 | ratified |", NOW);
    expect(c.home).toBe("OWED");
  });

  test("named in the gap ledger ONLY → HOMED-GAP", () => {
    const gaps = "### g-emit-parse-gate — `NEW S346 (adopter issue #519, pjoliver11)`\n<!-- @gap id=g-x prov=adopter:#519-noise -->";
    const c = classifyIssue(issue(519), gaps, "| dpa-028 | BANKED — UNRUN — adopter #509 |", NOW);
    expect(c.home).toBe("HOMED-GAP");
  });

  test("named in the dpa queue ONLY → HOMED-DPA", () => {
    const queue = "| dpa-029 | **BANKED — UNRUN** Enterprise document workflows. Adopter #471 (7 days, 0 comments). |";
    const c = classifyIssue(issue(471), "### g-unrelated — adopter #519", queue, NOW);
    expect(c.home).toBe("HOMED-DPA");
  });

  test("named in BOTH → HOMED-BOTH", () => {
    const gaps = "### g-readme-6nz — an adopter (#509 Q3) planned against the claim";
    const queue = "## dpa-028 — Offline / PWA (adopter #509)\nrequested: adopter issue #509";
    const c = classifyIssue(issue(509), gaps, queue, NOW);
    expect(c.home).toBe("HOMED-BOTH");
  });

  test("`#51` must NOT match `#519` — the number is word-boundaried", () => {
    // The ledger names #519 only. Issue #51 is a DIFFERENT issue and is OWED.
    const gaps = "### g-x — adopter issue #519 reported it";
    expect(classifyIssue(issue(51), gaps, "", NOW).home).toBe("OWED");
    expect(classifyIssue(issue(519), gaps, "", NOW).home).toBe("HOMED-GAP");
    // and the other direction: #519 does not match a mention of #5190
    expect(classifyIssue(issue(519), "see #5190 for the follow-up", "", NOW).home).toBe("OWED");
    // the same anchoring on the queue side
    expect(classifyIssue(issue(50), "", "| dpa-030 | adopter #509 |", NOW).home).toBe("OWED");
  });
});

describe("issue-debt — mentions() edge shapes", () => {
  test("accepts `#<n>` at line start, mid-prose, in a marker attribute, and before punctuation", () => {
    expect(mentions("#519", 519)).toBe(true);
    expect(mentions("adopter issue #519, pjoliver11", 519)).toBe(true);
    expect(mentions("prov=adopter:#519-the-emitted-line-reference-was-noise", 519)).toBe(true);
    expect(mentions("(closes #519)", 519)).toBe(true);
    expect(mentions("issue#519", 519)).toBe(true);
  });
  test("accepts the URL form `issues/<n>` — a home written as a link is still a home", () => {
    expect(mentions("https://github.com/bryanmaclee/scrml/issues/519", 519)).toBe(true);
    expect(mentions("https://github.com/bryanmaclee/scrml/issues/5190", 519)).toBe(false);
  });
  test("rejects a bare number, a longer number, and non-positive input", () => {
    expect(mentions("519 is a number, not an issue", 519)).toBe(false);
    expect(mentions("#5191", 519)).toBe(false);
    expect(mentions("#519", 0)).toBe(false);
    expect(mentions("#519", -519)).toBe(false);
    expect(mentions("", 519)).toBe(false);
  });
});

describe("issue-debt — SILENT modifier + totals", () => {
  test(`0 comments AND > ${SILENT_AFTER_DAYS} days old → silent; a comment or youth clears it`, () => {
    expect(classifyIssue(issue(1, { comments: 0, createdAt: daysAgo(3) }), "", "", NOW).silent).toBe(true);
    expect(classifyIssue(issue(2, { comments: 1, createdAt: daysAgo(30) }), "", "", NOW).silent).toBe(false);
    expect(classifyIssue(issue(3, { comments: 0, createdAt: daysAgo(1) }), "", "", NOW).silent).toBe(false);
    // the threshold is exact-ms, not floored days: 2.5 days with 0 comments IS silent (>2d),
    // while exactly 2 days is not (not >2d)
    expect(classifyIssue(issue(4, { comments: 0, createdAt: daysAgo(2.5) }), "", "", NOW).silent).toBe(true);
    expect(classifyIssue(issue(5, { comments: 0, createdAt: daysAgo(2) }), "", "", NOW).silent).toBe(false);
  });

  test("age is derived from createdAt against the injected now (deterministic)", () => {
    const c = classifyIssue(issue(9, { createdAt: "2026-08-08T04:26:32Z" }), "", "", NOW);
    expect(c.ageDays).toBe(7);
  });

  test("classify() self-reports totals: open = homed + owed, oldest first in each bucket", () => {
    const issues = [
      issue(519, { createdAt: daysAgo(3) }),
      issue(509, { createdAt: daysAgo(4) }),
      issue(471, { createdAt: daysAgo(7), comments: 0 }),
      issue(600, { createdAt: daysAgo(1), comments: 0 }),
    ];
    const gaps = "adopter issue #519 · adopter (#509 Q3)";
    const queue = "| dpa-028 | adopter #509 |";
    const r = classify(issues, gaps, queue, NOW);
    expect(r.open).toBe(4);
    expect(r.homed.map((c) => c.number)).toEqual([509, 519]);       // 4d then 3d
    expect(r.homed.map((c) => c.home)).toEqual(["HOMED-BOTH", "HOMED-GAP"]);
    expect(r.owed.map((c) => c.number)).toEqual([471, 600]);        // 7d then 1d
    expect(r.owed.map((c) => c.silent)).toEqual([true, false]);     // 7d/0c silent; 1d/0c not yet
    expect(r.homed.length + r.owed.length).toBe(r.open);
  });

  test("an empty issue list is 0/0/0, not an error", () => {
    const r = classify([], "", "", NOW);
    expect(r).toEqual({ open: 0, homed: [], owed: [] });
  });
});
