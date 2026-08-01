/**
 * gap-marker-parser-s307.test.js — the @gap marker parser's silent-drop guard.
 *
 * WHY THIS EXISTS. `scripts/state.ts` derives the §0 headline gap counts from
 * `@gap` markers. Its parser used to require `status=` to be followed
 * immediately by `-->`, so ANY marker carrying an extra attribute was dropped
 * from the count — not miscounted, INVISIBLE. `pa-base v2.9` then made `locus=`
 * a REQUIRED field on that exact marker, so every entry filed under the new
 * rule silently vanished from the rollup, in the direction that UNDER-reports
 * open defects. Measured at the fix: 3 markers dropped, 2 of them open.
 *
 * That is the same class S299 hardened against (14 markers across six unknown
 * statuses, including two open HIGHs) — but that fix guarded an unrecognised
 * STATUS, not an unparsed MARKER. This pins the second guard.
 *
 * The parser is exported specifically so this guard can be exercised: a gate
 * that has never failed is indistinguishable from one that cannot (pa-base §8).
 */

import { describe, test, expect } from "bun:test";
import { parseGapMarkers } from "../../../scripts/state.ts";

describe("S307 — @gap marker parsing tolerates extra attributes", () => {
  test("a marker carrying pa-base v2.9 `locus=` is COUNTED, not dropped", () => {
    const t = parseGapMarkers(
      `<!-- @gap id=g-x sev=MED status=open locus=compiler/src/foo.ts:42 -->`,
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ id: "g-x", sev: "MED", status: "open" });
  });

  test("attribute ORDER does not matter", () => {
    const t = parseGapMarkers(
      `<!-- @gap id=g-y locus=compiler/src/b.ts:1 status=open sev=HIGH -->`,
    );
    expect(t).toEqual([{ id: "g-y", sev: "HIGH", status: "open" }]);
  });

  test("the `searched:` locus form (base outcome 2) parses", () => {
    const t = parseGapMarkers(
      `<!-- @gap id=g-z sev=LOW status=open locus=searched:a.ts,b.ts,§34 -->`,
    );
    expect(t).toHaveLength(1);
  });

  test("plain markers still parse (no regression)", () => {
    const t = parseGapMarkers(`<!-- @gap id=g-plain sev=LOW status=resolved -->`);
    expect(t).toEqual([{ id: "g-plain", sev: "LOW", status: "resolved" }]);
  });
});

describe("S307 — the guard FAILS LOUD rather than silently omitting", () => {
  test("a real marker with an unrecognised sev throws", () => {
    expect(() =>
      parseGapMarkers(`<!-- @gap id=g-bad sev=BOGUS status=open -->`),
    ).toThrow(/did not parse|SILENTLY OMITTED/);
  });

  test("a real marker missing status= throws", () => {
    expect(() =>
      parseGapMarkers(`<!-- @gap id=g-nostatus sev=MED -->`),
    ).toThrow(/did not parse|SILENTLY OMITTED/);
  });

  test("the error names the offending marker, so it is actionable", () => {
    try {
      parseGapMarkers(`<!-- @gap id=g-named sev=NOPE status=open -->`);
      throw new Error("expected a throw");
    } catch (e) {
      expect(String(e.message)).toContain("g-named");
    }
  });
});

describe("S307 — the doc's own FORMAT EXAMPLES are not mistaken for entries", () => {
  test("an id-less example marker is ignored", () => {
    expect(parseGapMarkers(`<!-- @gap … -->`)).toEqual([]);
  });

  test("an angle-bracket placeholder id is ignored", () => {
    // known-gaps.md documents its own syntax with `id=<stable-id>`; treating
    // that as a malformed entry would make the guard fire on the file it guards.
    expect(
      parseGapMarkers(
        `<!-- @gap id=<stable-id> sev=<HIGH|MED|LOW|NOMINAL> status=<open|resolved> -->`,
      ),
    ).toEqual([]);
  });

  test("examples coexist with real entries in one document", () => {
    const t = parseGapMarkers(
      `<!-- @gap … -->\ntext\n<!-- @gap id=g-real sev=HIGH status=open locus=x.ts:1 -->`,
    );
    expect(t).toEqual([{ id: "g-real", sev: "HIGH", status: "open" }]);
  });
});
