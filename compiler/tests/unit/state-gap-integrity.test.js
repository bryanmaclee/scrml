/**
 * state-gap-integrity.test.js — the scripts/state.ts ledger-integrity trio (S334).
 *
 * Covers three silent-omission/silent-drift classes in the gap-ledger tooling:
 *   1. g-gap-markers-duplicate-id-conflicting-status-double-counted — counts were
 *      per-MARKER, so an entry carrying two `@gap` markers with one id double-counted;
 *      now deduped to per-ENTRY, and a same-id pair with CONFLICTING status throws.
 *   2. g-known-gaps-heading-and-marker-status-can-disagree-silently — headingMarkerDrift
 *      surfaces a `### ` heading whose structured status tail disagrees with its marker.
 *   3. (parser robustness) a marker whose prov=/locus= value contains a literal `>`
 *      (e.g. a code-literal `<msg> = ""`) was TRUNCATED and silently dropped from the
 *      count; the attribute bag now matches with `[\s\S]*?` up to `-->`.
 * (The maps-staleness ancestry guard, g-maps-staleness-probe-has-no-ancestry-check, is
 *  git/fs-dependent and exercised by `bun scripts/state.ts --check`, not unit-tested here.)
 */

import { describe, test, expect } from "bun:test";
import { parseGapMarkers, gapCountsFromTokens, headingMarkerDrift } from "../../../scripts/state.ts";

describe("state.ts §1 — duplicate-id gap markers do not double-count", () => {
  test("a same-id pair with AGREEING status is counted ONCE (per entry, not per marker)", () => {
    const toks = [
      { id: "g-a", sev: "MED", status: "open" },
      { id: "g-a", sev: "MED", status: "open" }, // duplicate marker, same entry
      { id: "g-b", sev: "MED", status: "open" },
    ];
    const g = gapCountsFromTokens(toks);
    expect(g.med).toBe(2); // g-a counted once + g-b — NOT 3
    expect(g.tokens.length).toBe(2);
  });

  test("a same-id pair with CONFLICTING status throws (the count cannot resolve the entry state)", () => {
    const toks = [
      { id: "g-x", sev: "HIGH", status: "open" },
      { id: "g-x", sev: "HIGH", status: "resolved" },
    ];
    expect(() => gapCountsFromTokens(toks)).toThrow(/CONFLICTING/);
  });

  test("distinct ids are unaffected", () => {
    const g = gapCountsFromTokens([
      { id: "g-1", sev: "HIGH", status: "open" },
      { id: "g-2", sev: "LOW", status: "open" },
    ]);
    expect(g.high).toBe(1);
    expect(g.low).toBe(1);
  });
});

describe("state.ts §2 — a `>` inside a marker's attribute value is not silently dropped", () => {
  test("a marker whose locus= carries a code-literal `<msg>` still parses (not truncated at the `>`)", () => {
    const text =
      "<!-- @gap id=g-with-angle sev=MED status=open " +
      "locus=parse-stage (a codegen pass cannot emit `<msg> = \"\"`) prov=rationale:x -->\n" +
      "<!-- @gap id=g-plain sev=LOW status=open -->\n";
    const toks = parseGapMarkers(text);
    const ids = toks.map((t) => t.id);
    expect(ids).toContain("g-with-angle"); // pre-fix: dropped (truncated at the `>` in <msg>)
    expect(ids).toContain("g-plain");
    expect(toks.find((t) => t.id === "g-with-angle").status).toBe("open");
  });
});

describe("state.ts §3 — heading/marker status drift is detected (not silent)", () => {
  test("a heading whose status tail disagrees with its marker is reported", () => {
    const text = [
      "### g-drifted — some defect — `NEW S1; MED; resolved`",
      "<!-- @gap id=g-drifted sev=MED status=open -->",
      "",
      "### g-agree — another — `NEW S1; LOW; open`",
      "<!-- @gap id=g-agree sev=LOW status=open -->",
      "",
      "### g-no-tail — a free-text heading with no structured status",
      "<!-- @gap id=g-no-tail sev=MED status=resolved -->",
    ].join("\n");
    const drift = headingMarkerDrift(text);
    const ids = drift.map((d) => d.id);
    expect(ids).toContain("g-drifted");     // heading=resolved vs marker=open
    expect(ids).not.toContain("g-agree");   // both open — agree
    expect(ids).not.toContain("g-no-tail"); // no structured tail → never false-fires
    expect(drift.length).toBe(1);
  });

  test("open/deferred/nominal all collapse to open-ish vs resolved", () => {
    const text = [
      "### g-def — x — `S1; MED; deferred`",
      "<!-- @gap id=g-def sev=MED status=open -->",
    ].join("\n");
    // heading 'deferred' and marker 'open' both normalize to open-ish → NO drift.
    expect(headingMarkerDrift(text).length).toBe(0);
  });
});
