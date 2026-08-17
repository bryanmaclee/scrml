/**
 * corpus-zero-debt.test.js — the scripts/corpus-zero-debt.ts classifier (S348, the bite proof).
 *
 * WHY THIS EXISTS. corpus-zero-debt.ts is the enforcement surface the sliding-doors audit produced:
 * it flags a corpus-zero-as-load-bearing justification in an autonomous deliberation artifact at
 * AUTHORING time (the rule existed since S66 and DECAYED — the audit's structural finding). Its core
 * is a set of PURE functions over strings + a fixed epoch — this test pins them without disk, network,
 * or the clock. An unproven gate is a hypothesis (pa-base §8).
 *
 * The contract cases: the marker disposes a hit (blast-radius/data/overruled) → CLOSED; an in-epoch
 * hit with no marker → OWED; a pre-epoch hit → out of scope; a self-reported load-bearing marker →
 * VIOLATION and never silently closed by a sibling; the date is read filename-first then frontmatter;
 * and the vocabulary is word-boundaried (no `yagni` inside `yagnitude`, no matching a marker line).
 */

import { describe, test, expect } from "bun:test";
import {
  CORPUS_ZERO_EPOCH,
  matchVocab,
  parseMarkers,
  markerCloses,
  markerViolates,
  artifactDate,
  classifyArtifact,
  classify,
} from "../../../scripts/corpus-zero-debt.ts";

const EPOCH = CORPUS_ZERO_EPOCH; // "2026-08-16"
const IN = "deep-dives/x-2026-09-01.md";   // authored after the epoch
const PRE = "deep-dives/x-2026-06-30.md";  // authored before the epoch

describe("corpus-zero-debt — matchVocab", () => {
  test("matches the charter phrases, case-insensitively", () => {
    expect(matchVocab("we saw zero corpus demand for this")).toBe("zero corpus");
    expect(matchVocab("No Corpus uses, so we defer")).toBe("no corpus");
    expect(matchVocab("rejected per YAGNI")).toBe("yagni");
    expect(matchVocab("the surface is sliver-empty today")).toBe("sliver-empty");
    expect(matchVocab("no consumer reaches this path")).toBe("no consumer");
  });
  test("word-boundaried — no false hit inside a longer token, no plain miss", () => {
    expect(matchVocab("the yagnitude of the change")).toBe(null); // not `yagni`
    expect(matchVocab("a perfectly ordinary sentence")).toBe(null);
  });
});

describe("corpus-zero-debt — markers", () => {
  test("parseMarkers extracts role/disposition/by from the machine-readable shape only", () => {
    const t = `some prose\n<!-- @corpus-zero role=blast-radius by=S348-peter date=2026-09-01 -->\nmore`;
    const [mk] = parseMarkers(t);
    expect(mk.role).toBe("blast-radius");
    expect(mk.by).toBe("S348-peter");
    expect(mk.disposition).toBeUndefined();
  });
  test("prose that merely NARRATES the marker string is not a marker", () => {
    // No `<!-- ... -->` shape → not parsed (the review-debt marker-not-prose discipline).
    expect(parseMarkers("we should add an @corpus-zero role=data note here").length).toBe(0);
  });
  test("markerCloses: blast-radius, data, and load-bearing+overruled close; bare load-bearing does not", () => {
    expect(markerCloses({ role: "blast-radius", raw: "" })).toBe(true);
    expect(markerCloses({ role: "data", raw: "" })).toBe(true);
    expect(markerCloses({ role: "load-bearing", disposition: "overruled", raw: "" })).toBe(true);
    expect(markerCloses({ role: "load-bearing", raw: "" })).toBe(false);
    expect(markerCloses({ role: "unknown", raw: "" })).toBe(false);
  });
  test("markerViolates: load-bearing AND not overruled is the health signal", () => {
    expect(markerViolates({ role: "load-bearing", raw: "" })).toBe(true);
    expect(markerViolates({ role: "load-bearing", disposition: "measured", raw: "" })).toBe(true);
    expect(markerViolates({ role: "load-bearing", disposition: "overruled", raw: "" })).toBe(false);
    expect(markerViolates({ role: "blast-radius", raw: "" })).toBe(false);
  });
});

describe("corpus-zero-debt — artifactDate", () => {
  test("filename date wins over frontmatter", () => {
    expect(artifactDate("deep-dives/foo-2026-06-30.md", "last-reviewed: 2026-01-01\n")).toBe("2026-06-30");
  });
  test("frontmatter last-reviewed is the fallback when the filename is undated", () => {
    expect(artifactDate("deep-dives/foo.md", "---\nlast-reviewed: 2026-07-15\n---\n")).toBe("2026-07-15");
  });
  test("undated returns null", () => {
    expect(artifactDate("deep-dives/foo.md", "no date anywhere")).toBe(null);
  });
});

describe("corpus-zero-debt — classifyArtifact contract", () => {
  test("in-epoch hit, no marker → OWED", () => {
    const r = classifyArtifact(IN, "we defer because zero corpus demand", EPOCH);
    expect(r.inEpoch).toBe(true);
    expect(r.hitLines).toEqual([1]);
    expect(r.owed).toBe(true);
  });

  test("in-epoch hit, closing marker → NOT owed", () => {
    const t = "we measured how many files break: no consumer today\n<!-- @corpus-zero role=blast-radius by=S348 date=2026-09-01 -->";
    const r = classifyArtifact(IN, t, EPOCH);
    expect(r.owed).toBe(false);
    expect(r.closed).toBe(1);
  });

  test("in-epoch hit, load-bearing+overruled marker → closed AND counted as a positive template", () => {
    const t = "no corpus source reaches this, but it is anticipated not hypothetical\n<!-- @corpus-zero role=load-bearing disposition=overruled by=S348 date=2026-09-01 -->";
    const r = classifyArtifact(IN, t, EPOCH);
    expect(r.owed).toBe(false);
    expect(r.overruled).toBe(1);
    expect(r.violations).toBe(0);
  });

  test("self-reported load-bearing (not overruled) → VIOLATION, never silently closed by a sibling", () => {
    const t = [
      "no corpus demand, so we dropped it",
      "<!-- @corpus-zero role=load-bearing by=S348 date=2026-09-01 -->",
      "<!-- @corpus-zero role=blast-radius by=S348 date=2026-09-01 -->", // a sibling closing marker
    ].join("\n");
    const r = classifyArtifact(IN, t, EPOCH);
    expect(r.violations).toBe(1);
    expect(r.owed).toBe(false); // covered by the violation report, not the owed one
  });

  test("pre-epoch hit → out of scope (never red for pre-rule history)", () => {
    const r = classifyArtifact(PRE, "zero corpus demand", EPOCH);
    expect(r.inEpoch).toBe(false);
    expect(r.owed).toBe(false);
  });

  test("--all overrides the epoch (the backfill/audit view)", () => {
    const r = classifyArtifact(PRE, "zero corpus demand", EPOCH, /* all */ true);
    expect(r.inEpoch).toBe(true);
    expect(r.owed).toBe(true);
  });

  test("undated in-scope file is treated in-epoch (fail-toward-visible)", () => {
    const r = classifyArtifact("deep-dives/undated.md", "no corpus uses", EPOCH);
    expect(r.date).toBe(null);
    expect(r.inEpoch).toBe(true);
    expect(r.owed).toBe(true);
  });

  test("a marker LINE is not itself counted as a hit", () => {
    // The marker line contains `load-bearing` and `corpus` but must not register as a corpus-zero hit.
    const r = classifyArtifact(IN, "<!-- @corpus-zero role=load-bearing disposition=overruled by=S348 date=2026-09-01 -->", EPOCH);
    expect(r.hitLines).toEqual([]);
  });

  test("no corpus-zero phrase → clean, not owed", () => {
    const r = classifyArtifact(IN, "an ordinary design note with no such reasoning", EPOCH);
    expect(r.hitLines).toEqual([]);
    expect(r.owed).toBe(false);
  });
});

describe("corpus-zero-debt — classify aggregate + self-reported totals", () => {
  test("N of M totals, owed list sorted, positive templates summed", () => {
    const arts = [
      { path: "deep-dives/a-2026-09-02.md", text: "zero corpus demand" },                              // OWED
      { path: "deep-dives/b-2026-09-01.md", text: "no consumer\n<!-- @corpus-zero role=blast-radius by=x date=2026-09-01 -->" }, // closed
      { path: "deep-dives/c-2026-06-01.md", text: "no corpus uses" },                                   // pre-epoch, out of scope
      { path: "deep-dives/d-2026-09-03.md", text: "no corpus\n<!-- @corpus-zero role=load-bearing disposition=overruled by=x date=2026-09-03 -->" }, // overruled ✓
      { path: "deep-dives/e.md", text: "an unrelated note" },                                           // no hit
    ];
    const s = classify(arts, EPOCH);
    expect(s.scanned).toBe(5);
    expect(s.withHits).toBe(4);       // a,b,c,d
    expect(s.inScope).toBe(3);        // a,b,d (c is pre-epoch)
    expect(s.owed.map((r) => r.path)).toEqual(["deep-dives/a-2026-09-02.md"]);
    expect(s.overruled).toBe(1);
    expect(s.violations.length).toBe(0);
  });

  test("an empty artifact list is 0s, not an error", () => {
    const s = classify([], EPOCH);
    expect(s).toEqual({ scanned: 0, withHits: 0, inScope: 0, owed: [], violations: [], overruled: 0 });
  });
});
