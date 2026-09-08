/**
 * state-session-close-suffix.test.js — g-recent-sessions-index-drops-named-session-wraps (S410).
 *
 * `scripts/state.ts` derives the startup-load-bearing forensic index in master-list.md
 * §0.6: which wraps are recent, and were they pushed. Both of its subject matchers
 * demanded `)` IMMEDIATELY after the session digits:
 *
 *     isSessionClose:  /\bwrap\(s\d+\)/i
 *     sessionNumOf:    /\(s(\d+)\)/i
 *
 * so every CONTRIBUTOR-SUFFIXED wrap subject was invisible to it. Measured over the
 * last 600 commits at S410: **100 wrap subjects, 21 matched, 79 DROPPED** — 51
 * peter-suffixed and 28 bryan-suffixed. It was never lane-specific; it hit whoever
 * used the suffix.
 *
 * ⚑ The two halves failed TOGETHER, which is why neither could reveal the other:
 * `sessionNumOf` returned `null` for exactly the subjects `isSessionClose` rejected,
 * so the per-session dedup was dead for them too. Both are pinned here.
 *
 * ⚑ NEGATIVES ARE THE LOAD-BEARING HALF of this file. The fix widens a matcher, and a
 * too-wide matcher would pull ordinary `fix(...)` / `review(S397)` commits into a
 * forensic index that is read at every boot. Those cases are asserted explicitly.
 */

import { describe, test, expect } from "bun:test";
import { isSessionClose, sessionNumOf } from "../../../scripts/state.ts";

describe("state.ts — a contributor-suffixed wrap subject is a session close", () => {
  // The exact subjects that were dropped on main before this fix.
  const SUFFIXED = [
    ["wrap(s401-peter): four boot probes read green while measuring nothing", "401"],
    ["wrap(S400-peter): 10-PR adopter-lane sweep", "400"],
    ["wrap(S398-peter): two dog-food finds", "398"],
    ["wrap(S372-bryan): a stranded wrap landed", "372"],
    ["wrap(S347-bryan): seven rulings executed", "347"],
  ];

  for (const [subj, num] of SUFFIXED) {
    test(`recognised, and its number parses: ${subj.slice(0, 26)}`, () => {
      expect(isSessionClose(subj)).toBe(true);
      // The dedup half — null here is what silently broke per-session dedup.
      expect(sessionNumOf(subj)).toBe(num);
    });
  }

  test("the UNSUFFIXED form still works (no regression on the 21 that matched)", () => {
    expect(isSessionClose("wrap(s408): seven arcs")).toBe(true);
    expect(sessionNumOf("wrap(s408): seven arcs")).toBe("408");
  });

  test("the S150-S167 `docs(sNN): WRAP` form still works, suffixed or not", () => {
    expect(isSessionClose("docs(s160): WRAP - the era form")).toBe(true);
    expect(sessionNumOf("docs(s160): WRAP - the era form")).toBe("160");
    expect(isSessionClose("docs(s160-bryan): WRAP - suffixed era form")).toBe(true);
  });

  // ⚑ The separator is NOT just `-`. These are real subjects from origin/main; an
  // earlier S410 attempt allowed only `-` and still dropped 19 of the 79.
  test("every separator that actually occurs is accepted, not just the hyphen", () => {
    for (const [subj, num] of [
      ["wrap(S313.bryan): the language-authority boundary", "313"],
      ["wrap(S312 peter): request-is-some-if-attr HIGH resolved", "312"],
      ["wrap(S310·peter): 3 codegen landings", "310"],
      ["wrap(S311 cont): MED triage + aM S67 deploy repros", "311"],
    ]) {
      expect(isSessionClose(subj)).toBe(true);
      expect(sessionNumOf(subj)).toBe(num);
    }
  });
});

describe("state.ts — the PR-FLOW slash form, which the wrap procedure itself generates", () => {
  // The overlay commits onto a `wrap/sNNN` branch and `gh pr create --fill` titles the
  // PR from the branch name, so the squash subject has NO parenthesis at all. A fix
  // that widens only the paren family still drops every one of these.
  const SLASH = [["wrap/s402 (#873)", "402"], ["wrap/s379 (#745)", "379"], ["wrap/s365 (#656)", "365"]];
  for (const [subj, num] of SLASH) {
    test(`recognised: ${subj}`, () => {
      expect(isSessionClose(subj)).toBe(true);
      expect(sessionNumOf(subj)).toBe(num);
    });
  }
});

describe("state.ts — the FALSE-POSITIVE half (S391), which evicted a real wrap", () => {
  test("`maps(S391): wrap-6c refresh` is NOT a session close", () => {
    // The old era alternation was /\(s\d+\):\s*wrap\b/i — `\b` matches before the `-`,
    // so this routine maps commit was admitted as an anchor and pushed a real
    // `wrap(s371)` out of the last-8 index on the next regen.
    const subj = "maps(S391): wrap-6c refresh 0dd659a1 -> 2ec2ce3a";
    expect(/\(s\d+\):\s*wrap\b/i.test(subj)).toBe(true);   // the OLD matcher admitted it
    expect(isSessionClose(subj)).toBe(false);              // the new one does not
  });

  test("a genuine era WRAP is still admitted (the tightening did not over-reach)", () => {
    expect(isSessionClose("docs(s160): WRAP — end of session")).toBe(true);
  });
});

describe("state.ts — the widened matcher does NOT over-match", () => {
  // A forensic index read at every boot must not fill with ordinary commits.
  const NOT_A_WRAP = [
    "fix(codegen): shell-subdir route asset paths no longer escape the dist root",
    "review(S397): drain the review floor",
    "gaps(s407): three SPEC-vs-reality defects",
    "chore(maps): scheduled regen",
    "feat(SPEC): mint E-CG-TILDE-UNRESOLVED",
    "continuity(s397): commit the dPA's own returns",
  ];

  for (const subj of NOT_A_WRAP) {
    test(`not a session close: ${subj.slice(0, 34)}`, () => {
      expect(isSessionClose(subj)).toBe(false);
    });
  }

  test("a bare mention of the word wrap in prose is not a session close", () => {
    expect(isSessionClose("docs: explain how to wrap a session")).toBe(false);
  });
});

describe("state.ts — the measurement trap this fix was almost mis-sized by", () => {
  test("the naive dropped-set probe /wrap\\(s[0-9]+[^)]/ is WRONG and reports every wrap as dropped", () => {
    // `[0-9]+` BACKTRACKS: on "wrap(s408)" it takes "40" and lets `[^)]` eat the "8".
    // The first S410 measurement used this and read 100 dropped instead of 79.
    expect(/wrap\(s[0-9]+[^)]/i.test("wrap(s408): x")).toBe(true); // false positive

    // Excluding BOTH `)` and a digit after the run is the correct probe.
    expect(/wrap\(s[0-9]+[^)0-9]/i.test("wrap(s408): x")).toBe(false);
    expect(/wrap\(s[0-9]+[^)0-9]/i.test("wrap(s401-peter): y")).toBe(true);
  });
});
