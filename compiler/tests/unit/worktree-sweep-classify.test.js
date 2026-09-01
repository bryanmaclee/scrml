/**
 * worktree-sweep-classify.test.js — the `scripts/worktree-sweep.ts` probe (the bite proof).
 *
 * WHY THIS EXISTS. `worktree-sweep.ts` replaces `git branch --merged origin/main`, which
 * on this project answers the WRONG QUESTION: we land by copying file CONTENT onto a PA
 * branch and squash-merging THAT, so an agent branch is never an ancestor of main however
 * completely its work landed. Measured S391: 77 "UNLANDED", 0 "LANDED and clean" across 81
 * worktrees — a probe that cannot discriminate, reading as "correctly found nothing".
 *
 * A probe never shown to discriminate is indistinguishable from one that CANNOT (pa-base
 * §8). Both halves of the replacement are pure functions over strings/facts, so both are
 * pinned here with no git, no network, no clock:
 *
 *   parseWorktreeList — where a SILENT TRUNCATION would live. `git worktree list
 *                       --porcelain` does not blank-terminate its LAST record, and a
 *                       parser that drops it returns a short enumeration that reads
 *                       exactly like a complete one.
 *   classify         — the precedence ladder, all seven dispositions, and the two
 *                       PA-chosen controls encoded as fact fixtures: a LANDED worktree
 *                       (maps work, merged as #795) and a deliberately RETAINED one
 *                       (arc (b), 3 differing files). The S326 filing is explicit that a
 *                       known-UNLANDED case must stay in any test of this probe — its
 *                       first hand-cut reported ALL NINE LANDED and was caught by luck.
 */

import { describe, test, expect } from "bun:test";
import { parseWorktreeList, classify, EXCLUDED_BASENAMES } from "../../../scripts/worktree-sweep.ts";

/** A fully-specified fact bag; each test overrides only what it is about. */
const facts = (over = {}) => ({
  exists: true,
  protectedReason: null,
  branch: "worktree-agent-x",
  dirtyCount: 0,
  content: { considered: 3, excluded: 1, differing: [], unlanded: [], contested: [] },
  ...over,
});

const content = (differing, unlanded, contested, considered = differing.length) => ({
  considered,
  excluded: 0,
  differing,
  unlanded,
  contested,
});

describe("parseWorktreeList — the enumeration must not be silently short", () => {
  test("parses path, HEAD and branch, stripping refs/heads/", () => {
    const recs = parseWorktreeList(
      "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n" +
      "worktree /repo/.claude/worktrees/agent-x\nHEAD def456\nbranch refs/heads/worktree-agent-x\n\n",
    );
    expect(recs.length).toBe(2);
    expect(recs[0].path).toBe("/repo");
    expect(recs[0].head).toBe("abc123");
    expect(recs[0].branch).toBe("main");
    expect(recs[1].branch).toBe("worktree-agent-x");
  });

  test("⚑ THE OFF-BY-ONE, shape 1 — final record terminated by \\n and no BLANK line", () => {
    // This is git's ACTUAL output shape. A parser that only flushed on a blank line
    // would lose exactly one worktree, and a short enumeration reads exactly like a
    // complete one. (⚑ MUTATION-PROVED: this shape is caught by the loop's own
    // blank-line branch — `"…two\n".split("\n")` ends in an empty string — so it does
    // NOT reach the post-loop flush. Shape 2 below is the one that does. Both are
    // kept: this is the shape git emits, and it must stay pinned regardless of which
    // internal branch happens to serve it.)
    const recs = parseWorktreeList(
      "worktree /a\nHEAD a1\nbranch refs/heads/one\n\nworktree /b\nHEAD b1\nbranch refs/heads/two\n",
    );
    expect(recs.map((r) => r.path)).toEqual(["/a", "/b"]);
  });

  test("⚑ THE OFF-BY-ONE, shape 2 — final record with NO trailing newline at all", () => {
    // MUTATION-PROVED to bite: deleting the post-loop `flush()` turns this red and
    // leaves every other case in this file green. That is the whole point of writing
    // it — the first draft of shape 1 was named as if it covered this and did not,
    // which is the pa-base §8 hollow-gate shape one level in.
    const recs = parseWorktreeList(
      "worktree /a\nHEAD a1\nbranch refs/heads/one\n\nworktree /b\nHEAD b1\nbranch refs/heads/two",
    );
    expect(recs.map((r) => r.path)).toEqual(["/a", "/b"]);
    expect(recs[1].branch).toBe("two");
  });

  test("detached / bare records carry no branch", () => {
    const recs = parseWorktreeList("worktree /d\nHEAD d1\ndetached\n\nworktree /e\nbare\n");
    expect(recs[0].detached).toBe(true);
    expect(recs[0].branch).toBe(null);
    expect(recs[1].bare).toBe(true);
  });

  test("`locked` keeps its REASON — a live agent's lock is the strongest keep signal there is", () => {
    const recs = parseWorktreeList(
      "worktree /f\nHEAD f1\nbranch refs/heads/f\nlocked claude agent agent-abc (pid 533831)\n",
    );
    expect(recs[0].locked).toBe(true);
    expect(recs[0].lockReason).toBe("claude agent agent-abc (pid 533831)");
  });

  test("a bare `locked` with no reason still sets the flag", () => {
    const recs = parseWorktreeList("worktree /g\nHEAD g1\nbranch refs/heads/g\nlocked\n");
    expect(recs[0].locked).toBe(true);
    expect(recs[0].lockReason).toBe("");
  });

  test("`prunable` is captured", () => {
    const recs = parseWorktreeList("worktree /h\nHEAD h1\nbranch refs/heads/h\nprunable gitdir file points to non-existent location\n");
    expect(recs[0].prunable).toBe(true);
  });

  test("CRLF input parses identically — a \\r must not become part of the branch name", () => {
    const recs = parseWorktreeList("worktree /i\r\nHEAD i1\r\nbranch refs/heads/i\r\n\r\n");
    expect(recs[0].branch).toBe("i");
  });

  test("empty input yields an empty list, not a phantom record", () => {
    expect(parseWorktreeList("")).toEqual([]);
    expect(parseWorktreeList("\n\n")).toEqual([]);
  });
});

describe("classify — the precedence ladder", () => {
  test("GONE outranks everything: a missing directory is not a work-holder", () => {
    const c = classify(facts({ exists: false, dirtyCount: 5, content: content(["x"], ["x"], []) }));
    expect(c.klass).toBe("GONE");
  });

  test("PROTECTED outranks every measurement, and prints its reason", () => {
    const c = classify(facts({ protectedReason: "LOCKED — a live agent holds it", content: content([], [], []) }));
    expect(c.klass).toBe("PROTECTED");
    expect(c.why).toContain("LOCKED");
  });

  test("NO-BRANCH for a detached worktree even when its content is fully landed", () => {
    expect(classify(facts({ branch: null })).klass).toBe("NO-BRANCH");
  });

  test("⚑ UNMEASURED, not SWEEPABLE, when a fact could not be read", () => {
    // Failing toward SWEEPABLE would delete on ignorance — the one direction this
    // instrument must not have. Failing toward HOLDS-WORK would disguise a BROKEN
    // PROBE as a backlog item, which is the exact obligation-vs-probe mismatch the
    // whole gap is about. It gets its own bucket.
    expect(classify(facts({ dirtyCount: null })).klass).toBe("UNMEASURED");
    expect(classify(facts({ content: null })).klass).toBe("UNMEASURED");
  });

  test("DIRTY outranks HOLDS-WORK — uncommitted changes are never sweepable regardless of content", () => {
    const c = classify(facts({ dirtyCount: 2, content: content([], [], []) }));
    expect(c.klass).toBe("DIRTY");
    expect(c.why).toContain("2 uncommitted");
  });
});

describe("classify — the bite, on the two PA-chosen controls", () => {
  test("LANDED control (maps work, merged as #795): 13 touched files, 0 differing → SWEEPABLE", () => {
    const c = classify(facts({ content: content([], [], [], 13) }));
    expect(c.klass).toBe("SWEEPABLE");
    expect(c.why).toContain("all 13 touched file(s)");
  });

  test("HELD control (arc (b), deliberately retained): 3 of 3 differ → HOLDS-WORK, all definitively unlanded", () => {
    const differing = [
      "compiler/src/ast-builder.js",
      "compiler/src/type-system.ts",
      "compiler/tests/unit/each-bearing-match-arm-walkable-tree.test.js",
    ];
    const c = classify(facts({ content: content(differing, differing, []) }));
    expect(c.klass).toBe("HOLDS-WORK");
    expect(c.why).toContain("3 of 3 file(s) differ");
    expect(c.why).toContain("3 definitively unlanded");
  });

  test("the two controls do not collapse — the probe DISCRIMINATES", () => {
    const landed = classify(facts({ content: content([], [], [], 13) }));
    const held = classify(facts({ content: content(["a"], ["a"], []) }));
    expect(landed.klass).not.toBe(held.klass);
  });
});

describe("classify — the two sub-signals that keep the report actionable", () => {
  test("⚑ VACUOUS: zero committed files is flagged, not silently pooled with real landings", () => {
    // A freshly-cut worktree holding a LIVE agent that has not committed yet looks
    // EXACTLY like this. S326: the first cut of this probe would have said "prune
    // everything" with a straight face.
    const c = classify(facts({ content: content([], [], [], 0) }));
    expect(c.klass).toBe("SWEEPABLE");
    expect(c.why).toContain("vacuous");
    expect(c.why).toContain("live agent");
  });

  test("all-contested reads as a drain candidate, not as definitively unlanded", () => {
    const c = classify(facts({ content: content(["compiler/SPEC.md"], [], ["compiler/SPEC.md"]) }));
    expect(c.klass).toBe("HOLDS-WORK");
    expect(c.why).toContain("0 definitively unlanded");
    expect(c.why).toContain("may have landed then drifted");
  });

  test("a mix names BOTH counts — one unlanded file is enough to be definitively holding work", () => {
    const c = classify(facts({ content: content(["a.ts", "compiler/SPEC.md"], ["a.ts"], ["compiler/SPEC.md"]) }));
    expect(c.why).toContain("1 definitively unlanded");
    expect(c.why).toContain("1 contested");
  });
});

describe("the exclusion is declared, not hidden", () => {
  test("progress.md and BRIEF.md are the excluded basenames", () => {
    expect([...EXCLUDED_BASENAMES].sort()).toEqual(["BRIEF.md", "progress.md"]);
  });
});
