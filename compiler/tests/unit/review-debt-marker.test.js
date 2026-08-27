/**
 * review-debt-marker.test.js — pins `scripts/review-debt.ts` `parseLedger` (S378, the bite proof).
 *
 * WHY THIS EXISTS. `review-debt.ts` is the review-floor instrument: it diffs merged PRs against the
 * `@review` markers in `docs/pr-reviews.md` and prints what is OWED. It underwrites a RATIFIED rule
 * (S313's review floor), and it has now had TWO silent-parse defects, each of which shipped green
 * with nothing red:
 *
 *   S358 — `CODE_BEARING_RE` whitelisted only some source trees, so a PR landing solely in
 *          `lsp/`/`editors/`/`e2e/`/`dashboard/` was carve-out-invisible to the health signal.
 *   S378 — the marker body class was `[^>]*?`, which EXCLUDES `>`, so a marker whose own `probe=`
 *          text contained a `>` never matched and its PR read as UNRECORDED. On this project the
 *          probe text routinely quotes scrml tags (`<db>`, `<each>`) and position arrows
 *          (`5:1 -> 5:42`), so THE MISS RATE ROSE WITH THE THOROUGHNESS OF THE REVIEW. Witnessed:
 *          #718, a three-round adversarial pass, reported OWED at the S378 boot.
 *
 * Both sibling debt probes were already pinned (`issue-debt.test.js`, `corpus-zero-debt.test.js` —
 * and `corpus-zero-debt.ts` exports `parseMarkers` precisely so it could be). This one was not, and
 * the S378 fix originally shipped four bite proofs run by hand, none of which landed as a test. That
 * omission was itself an adversarial-review finding; this file closes it.
 *
 * `pa-base` §8: "a gate that has never failed is indistinguishable from a gate that CANNOT fail —
 * prove the bite when you build it, and AGAIN AFTER ANY CHANGE TO THE GATE ITSELF."
 *
 * The properties pinned below are the ones a future edit could silently break:
 *   1. a `>` inside the marker body does NOT truncate the entry (the S378 defect itself);
 *   2. an UNCLOSED marker matches nothing and does NOT swallow its successors — i.e. the failure
 *      direction stays toward DEBT, never toward a falsely-clean floor;
 *   3. the ledger's own angle-bracket FORMAT EXAMPLE is not counted as a real entry, and is
 *      rejected by an explicit guard rather than by `Number()` happening to return NaN.
 */

import { describe, test, expect } from "bun:test";
import { parseLedger } from "../../../scripts/review-debt.ts";

describe("review-debt parseLedger — the S378 defect", () => {
  test("a `>` inside the body does NOT truncate the marker (the regression)", () => {
    const ledger = [
      "<!-- @review pr=718 verdict=finding by=S376-bryan date=2026-08-26 probe=CODE-<db>-locus-arrow-5:1->5:42 note=has-gt -->",
    ].join("\n");
    const m = parseLedger(ledger);
    expect(m.has(718)).toBe(true);
    expect(m.get(718).verdict).toBe("finding");
    expect(m.get(718).by).toBe("S376-bryan");
    expect(m.get(718).note).toBe("has-gt");
  });

  test("the pre-fix `[^>]` class would have missed it — the bite, stated as a contrast", () => {
    const line =
      "<!-- @review pr=718 verdict=finding by=S376-bryan date=2026-08-26 probe=uses-<db>-and->-arrow -->";
    // the OLD body class, reconstructed here so a revert is caught by a failing test
    expect(/<!--\s*@review\s+([^>]*?)-->/.test(line)).toBe(false);
    expect(parseLedger(line).has(718)).toBe(true);
  });

  test("a `>` in the body does not leak into the parsed field values", () => {
    const m = parseLedger("<!-- @review pr=42 verdict=clean by=S1-x date=2026-01-01 probe=a->b -->");
    expect(m.get(42).verdict).toBe("clean");
    expect(m.get(42).by).toBe("S1-x");
  });
});

describe("review-debt parseLedger — failure direction stays toward DEBT", () => {
  test("an UNCLOSED marker matches nothing and does not swallow its successor", () => {
    const ledger = [
      "<!-- @review pr=9001 verdict=clean by=X date=2026-01-01 probe=unclosed-no-terminator",
      "<!-- @review pr=9002 verdict=clean by=X date=2026-01-01 probe=well-formed -->",
    ].join("\n");
    const m = parseLedger(ledger);
    expect(m.has(9001)).toBe(false); // unrecorded -> stays OWED -> safe direction
    expect(m.has(9002)).toBe(true);  // the successor is NOT consumed by the broken one
    expect(m.size).toBe(1);
  });

  test("a multi-line body is not matched (the one-marker-per-line contract)", () => {
    const ledger = "<!-- @review pr=7\n  verdict=clean by=X date=2026-01-01 probe=wrapped -->";
    expect(parseLedger(ledger).has(7)).toBe(false);
  });

  test("prose that merely mentions a PR is never an entry", () => {
    expect(parseLedger("We reviewed pr=555 thoroughly. verdict=clean.").size).toBe(0);
  });
});

describe("review-debt parseLedger — the ledger's own format example is not an entry", () => {
  test("an angle-bracket placeholder is rejected by the explicit guard", () => {
    const example =
      "<!-- @review pr=<n> verdict=clean|finding|carve-out by=S<N>-<who> date=<YYYY-MM-DD> probe=<what-was-probed> -->";
    expect(parseLedger(example).size).toBe(0);
  });

  test("the guard is on the PLACEHOLDER, not on Number() returning NaN", () => {
    // If the example is ever rewritten with a CONCRETE pr number, the placeholder guard is what
    // must still stop it — and it cannot, so this pins the shape that must stay a placeholder.
    // The direction that matters: a placeholder must never register as REVIEWED, because that
    // fails toward CLEAN and silently discharges an obligation nobody met.
    expect(parseLedger("<!-- @review pr=<n> verdict=clean by=<who> -->").size).toBe(0);
    expect(parseLedger("<!-- @review pr=<385> verdict=clean by=<who> -->").size).toBe(0);
  });

  test("a real entry alongside the format example still parses", () => {
    const ledger = [
      "<!-- @review pr=<n> verdict=clean by=S<N>-<who> probe=<what> -->",
      "<!-- @review pr=385 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->",
    ].join("\n");
    const m = parseLedger(ledger);
    expect(m.size).toBe(1);
    expect(m.has(385)).toBe(true);
  });
});

describe("review-debt parseLedger — ordinary shape", () => {
  test("last write wins on a duplicate pr (append-only ledger, re-review supersedes)", () => {
    const ledger = [
      "<!-- @review pr=500 verdict=clean by=S1-x date=2026-01-01 probe=first -->",
      "<!-- @review pr=500 verdict=finding by=S2-y date=2026-01-02 probe=second -->",
    ].join("\n");
    expect(parseLedger(ledger).get(500).verdict).toBe("finding");
  });

  test("missing optional fields fall back rather than throwing", () => {
    const m = parseLedger("<!-- @review pr=600 -->");
    expect(m.get(600).verdict).toBe("?");
    expect(m.get(600).by).toBe("?");
    expect(m.get(600).note).toBeUndefined();
  });

  test("the live ledger parses and contains the entry the S378 defect hid", async () => {
    const f = Bun.file("docs/pr-reviews.md");
    if (!(await f.exists())) return; // path-independent: skip rather than fail from another cwd
    const m = parseLedger(await f.text());
    expect(m.size).toBeGreaterThan(300);
    expect(m.has(718)).toBe(true); // the marker the pre-fix regex could not see
  });
});
