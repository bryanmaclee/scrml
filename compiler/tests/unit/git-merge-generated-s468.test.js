/**
 * git-merge-generated-s468.test.js — the generated-content merge driver (s468-generated-merge-driver).
 *
 * `scripts/git-merge-generated.ts` is a git merge driver for the files carrying @generated content.
 * It masks every generated region, merges only the HAND-WRITTEN text 3-way, regenerates the
 * self-contained `@generated:gap-counts` table from the merged text, gives cross-file generated
 * content a provisional value (pending phase-2 regeneration), and self-checks the gap-id union.
 *
 * Every positive here is paired with the input that makes plain `git merge-file` WRONG or
 * CONFLICTED, so a driver that silently degraded to the plain merge fails this file (pa-base §8:
 * a gate is proven by watching it bite, not by watching it pass).
 *
 * Conflict markers are built with `"<".repeat(7)` — a literal marker at line start in a tracked
 * file trips scripts/conflict-marker-gate.ts.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mergeGenerated,
  gitMergeFile,
  gapIdSelfCheck,
  gapIdCounts,
  unionEntryAdditions,
  regenBlock,
  stripRegenBlock,
} from "../../../scripts/git-merge-generated.ts";
import { gapCountsSection } from "../../../scripts/state.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OPEN = "<".repeat(7);
const CLOSE = ">".repeat(7);
const LABELS = { ours: "ours", base: "base", theirs: "theirs" };

const START = "<!-- @generated:gap-counts START (do not edit — `bun scripts/state.ts --write`) -->";
const END = "<!-- @generated:gap-counts END -->";

/** A miniature known-gaps ledger. `table` overrides the generated body (to simulate stale/corrupt). */
function ledger(entries, table) {
  const body = entries
    .map((e) => `### ${e.id} — ${e.title ?? "a defect"}\n\n<!-- @gap id=${e.id} sev=${e.sev} status=${e.status ?? "open"} -->\n`)
    .join("\n");
  const draft = `# Known gaps\n\n| Severity | Open | Carried |\n|---|---|---|\n${START}\n__T__\n${END}\n\n${body}`;
  const t = table ?? gapCountsSection(draft.replace("__T__", ""));
  return draft.replace("__T__", t);
}
const tableOf = (text) => text.slice(text.indexOf(START) + START.length + 1, text.indexOf(END) - 1);

const BASE_ENTRIES = [
  { id: "g-a", sev: "HIGH" },
  { id: "g-b", sev: "MED" },
  { id: "g-c", sev: "MED" },
  { id: "g-d", sev: "LOW" },
  { id: "g-e", sev: "LOW" },
];

describe("gap-counts — self-contained section, regenerated from the MERGED text", () => {
  // ours adds a HIGH at the top, theirs adds a HIGH at the bottom: no hand conflict, and BOTH sides
  // move the table HIGH 1 → 2 — an IDENTICAL change, which plain 3-way keeps once.
  const o = ledger(BASE_ENTRIES);
  const a = ledger([{ id: "g-new-ours", sev: "HIGH" }, ...BASE_ENTRIES]);
  const b = ledger([...BASE_ENTRIES, { id: "g-new-theirs", sev: "HIGH" }]);

  test("BITE: plain git merge-file merges clean with a WRONG count (HIGH 2 — one entry uncounted)", () => {
    const plain = gitMergeFile(o, a, b, 7, LABELS);
    expect(plain.conflicts).toBe(0);
    expect(tableOf(plain.text)).toContain("| HIGH | 2 | 0 |");
    expect(plain.text).toContain("g-new-ours");
    expect(plain.text).toContain("g-new-theirs");
  });

  test("the driver counts both entries: HIGH 3, zero markers, nothing pending", () => {
    const r = mergeGenerated(o, a, b, "docs/known-gaps.md");
    expect(r.conflicts).toBe(0);
    expect(r.text).not.toContain(OPEN);
    expect(tableOf(r.text)).toContain("| HIGH | 3 | 0 |");
    expect(tableOf(r.text)).toBe(gapCountsSection(r.text));
    expect(r.regenerated).toEqual(["gap-counts"]);
    expect(r.pending).toBe(false);
    expect(r.selfCheck).toEqual({ dropped: [], duplicated: [], ambiguous: [] });
  });

  test("BITE: two DIFFERENT table changes conflict under plain merge, resolve under the driver", () => {
    // ours resolves g-b (MED 2 → 1); theirs adds a LOW (LOW 2 → 3) — the two table rows are adjacent.
    const a2 = ledger(BASE_ENTRIES.map((e) => (e.id === "g-b" ? { ...e, status: "resolved" } : e)));
    const b2 = ledger([...BASE_ENTRIES, { id: "g-new-low", sev: "LOW" }]);
    expect(gitMergeFile(o, a2, b2, 7, LABELS).conflicts).toBeGreaterThan(0);
    const r = mergeGenerated(o, a2, b2, "docs/known-gaps.md");
    expect(r.conflicts).toBe(0);
    expect(tableOf(r.text)).toBe(["| HIGH | 1 | 0 |", "| MED | 1 | 0 |", "| LOW | 3 | 0 |", "| Nominal (spec-ahead-of-impl) | 0 | 0 |"].join("\n"));
  });

  test("a CORRUPTED table on one side is regenerated, not merged", () => {
    const corrupt = ledger([{ id: "g-new-ours", sev: "HIGH" }, ...BASE_ENTRIES], "| HIGH | 999 | 0 |\nGARBAGE");
    const r = mergeGenerated(o, corrupt, b, "docs/known-gaps.md");
    expect(r.conflicts).toBe(0);
    expect(r.text).not.toContain("999");
    expect(r.text).not.toContain("GARBAGE");
    expect(tableOf(r.text)).toContain("| HIGH | 3 | 0 |");
  });

  test("a stray END fragment outside the pair (the known-gaps.md:668 shape) stays hand text", () => {
    const stray = (t) => t + `\n| HIGH | 1 | 0 |\n${END}\n`;
    const r = mergeGenerated(stray(o), stray(a), stray(b), "docs/known-gaps.md");
    expect(r.conflicts).toBe(0);
    expect(tableOf(r.text)).toContain("| HIGH | 3 | 0 |");
    expect(r.text.trimEnd().endsWith(`| HIGH | 1 | 0 |\n${END}`)).toBe(true);
  });
});

describe("a conflict in HAND-WRITTEN text still stops the merge", () => {
  test("both sides retitle the same entry → markers, exit-worthy, table provisional + pending", () => {
    const o = ledger(BASE_ENTRIES);
    const a = ledger(BASE_ENTRIES.map((e) => (e.id === "g-c" ? { ...e, title: "ours' wording" } : e)));
    const b = ledger(BASE_ENTRIES.map((e) => (e.id === "g-c" ? { ...e, title: "theirs' wording", sev: "HIGH" } : e)));
    const r = mergeGenerated(o, a, b, "docs/known-gaps.md");
    expect(r.conflicts).toBeGreaterThan(0);
    expect(r.text).toContain(OPEN);
    expect(r.text).toContain(CLOSE);
    expect(r.text).toContain("ours' wording");
    expect(r.text).toContain("theirs' wording");
    // The markers are in the entry, never inside the generated table.
    const t = tableOf(r.text);
    expect(t).not.toContain(OPEN);
    expect(r.provisional).toContain("gap-counts");
    expect(r.pending).toBe(true);
  });
});

describe("UNION of same-spot gap-entry additions (S469)", () => {
  // Both sides file a NEW entry at the SAME place — the tail of the ledger — so the hand text
  // conflicts with an EMPTY base side. Both PRs also regenerated the table.
  const o = ledger(BASE_ENTRIES);
  const a = ledger([...BASE_ENTRIES, { id: "g-tail-ours", sev: "HIGH" }]);
  const b = ledger([...BASE_ENTRIES, { id: "g-tail-theirs", sev: "LOW" }]);

  test("BITE: plain git merge-file conflicts on the two tail additions", () => {
    expect(gitMergeFile(o, a, b, 7, LABELS).conflicts).toBeGreaterThan(0);
  });

  test("the driver keeps BOTH entries (ours first), counts them, zero markers", () => {
    const r = mergeGenerated(o, a, b, "docs/known-gaps.md");
    expect(r.conflicts).toBe(0);
    expect(r.unioned).toBe(1);
    expect(r.text).not.toContain(OPEN);
    expect(r.text.indexOf("g-tail-ours")).toBeGreaterThan(0);
    expect(r.text.indexOf("g-tail-theirs")).toBeGreaterThan(r.text.indexOf("g-tail-ours"));
    expect(tableOf(r.text)).toBe(gapCountsSection(r.text));
    expect(tableOf(r.text)).toContain("| HIGH | 2 | 0 |");
    expect(tableOf(r.text)).toContain("| LOW | 3 | 0 |");
    expect(r.selfCheck).toEqual({ dropped: [], duplicated: [], ambiguous: [] });
    // the ledger stays well-formed: each union'd entry is its own block, separated by a blank line
    expect(r.text).toMatch(/status=open -->\n\n### g-tail-theirs/);
  });

  test("BITE: the SAME id filed on both sides is NOT unioned (a real conflict)", () => {
    const a2 = ledger([...BASE_ENTRIES, { id: "g-same", sev: "HIGH", title: "ours" }]);
    const b2 = ledger([...BASE_ENTRIES, { id: "g-same", sev: "LOW", title: "theirs" }]);
    const r = mergeGenerated(o, a2, b2, "docs/known-gaps.md");
    expect(r.conflicts).toBeGreaterThan(0);
    expect(r.unioned).toBe(0);
    expect(r.text).toContain(OPEN);
  });

  test("BITE: a hunk where a side CHANGED existing text is not unioned, even beside an addition", () => {
    // both retitle g-e (the last entry) AND each append an entry — the base side is non-empty.
    const a3 = ledger([...BASE_ENTRIES.map((e) => (e.id === "g-e" ? { ...e, title: "ours' wording" } : e)), { id: "g-x1", sev: "LOW" }]);
    const b3 = ledger([...BASE_ENTRIES.map((e) => (e.id === "g-e" ? { ...e, title: "theirs' wording" } : e)), { id: "g-x2", sev: "LOW" }]);
    const r = mergeGenerated(o, a3, b3, "docs/known-gaps.md");
    expect(r.conflicts).toBeGreaterThan(0);
    expect(r.unioned).toBe(0);
  });

  test("BITE (S469 review #2): a `=======` content line in ours' addition is NOT read as the separator", () => {
    // a setext heading underline inside ours' new entry
    const a5 = ledger([...BASE_ENTRIES, { id: "g-tail-ours", sev: "HIGH" }]).replace(/(### g-tail-ours[^\n]*\n)/, "$1\nSetext heading\n=======\n");
    const r = mergeGenerated(o, a5, b, "docs/known-gaps.md");
    expect(r.conflicts).toBe(0);
    expect(r.unioned).toBe(1);
    expect(r.text).not.toMatch(/^\|{7}/m); // no leaked diff3 base marker
    expect(r.text).toContain("Setext heading\n=======\n");
    expect(r.text).toContain("g-tail-theirs");
    expect(r.text.split("\n").filter((l) => l === "=======").length).toBe(1); // only ours' own underline
    // …and an underline exactly as long as the parser's OWN separator: accepted as SEP only after
    // the base marker, so it stays content too
    const long = "=".repeat(31);
    const a7 = ledger([...BASE_ENTRIES, { id: "g-tail-ours", sev: "HIGH" }]).replace(/(### g-tail-ours[^\n]*\n)/, `$1\nSetext heading\n${long}\n`);
    const r7 = mergeGenerated(o, a7, b, "docs/known-gaps.md");
    expect(r7.unioned).toBe(1);
    expect(r7.text).not.toMatch(/^\|{7}/m);
    expect(r7.text).toContain(`Setext heading\n${long}\n`);
    expect(r7.text).toContain("g-tail-theirs");
  });

  test("BITE (S469 review #5): an IDENTICAL line both sides added is not unioned (it would be filed twice)", () => {
    const shared = "**Workaround:** none known.";
    const a6 = ledger([...BASE_ENTRIES, { id: "g-u1", sev: "LOW" }]) + shared + "\n";
    const b6 = ledger([...BASE_ENTRIES, { id: "g-u2", sev: "LOW" }]) + shared + "\n";
    expect(unionEntryAdditions(o, a6, b6, 7, LABELS)).toBeNull();
    expect(mergeGenerated(o, a6, b6, "docs/known-gaps.md").conflicts).toBeGreaterThan(0);
  });

  test("BITE: prose added at the same spot (no @gap marker) is not unioned", () => {
    const a4 = o + "\nours' closing paragraph\n";
    const b4 = o + "\ntheirs' closing paragraph\n";
    const r = mergeGenerated(o, a4, b4, "docs/known-gaps.md");
    expect(r.conflicts).toBeGreaterThan(0);
    expect(r.unioned).toBe(0);
  });
});

describe("gap-id union self-check", () => {
  test("BITE: an entry filed INSIDE the generated region would be dropped → self-check names it", () => {
    const o = ledger(BASE_ENTRIES);
    const a = ledger(BASE_ENTRIES);
    const b = ledger(BASE_ENTRIES).replace(END, `<!-- @gap id=g-misfiled sev=HIGH status=open -->\n${END}`);
    const r = mergeGenerated(o, a, b, "docs/known-gaps.md");
    expect(r.selfCheck.dropped).toEqual(["g-misfiled"]);
  });

  test("a side DELETING an entry the other left alone is not a drop", () => {
    const o = ledger(BASE_ENTRIES);
    const a = ledger(BASE_ENTRIES.filter((e) => e.id !== "g-d"));
    const b = ledger([...BASE_ENTRIES, { id: "g-new", sev: "LOW" }]);
    const r = mergeGenerated(o, a, b, "docs/known-gaps.md");
    expect(r.conflicts).toBe(0);
    expect(gapIdCounts(r.text).has("g-d")).toBe(false);
    expect(r.selfCheck).toEqual({ dropped: [], duplicated: [], ambiguous: [] });
  });

  test("a result that DUPLICATES an id, or loses one, is flagged", () => {
    const o = ledger(BASE_ENTRIES);
    const a = ledger([...BASE_ENTRIES, { id: "g-x", sev: "LOW" }]);
    const b = ledger(BASE_ENTRIES);
    expect(gapIdSelfCheck(o, a, b, a + `<!-- @gap id=g-x sev=LOW status=open -->`).duplicated).toEqual(["g-x"]);
    expect(gapIdSelfCheck(o, a, b, o).dropped).toEqual(["g-x"]);
    // the doc's own format example is not an entry
    expect(gapIdCounts("<!-- @gap id=<stable-id> sev=HIGH status=open -->").size).toBe(0);
  });

  test("BITE (S469 review #6): MULTIPLICITY — one copy of a double-filed id lost is a drop, not a pass", () => {
    const m = (id) => `<!-- @gap id=${id} sev=LOW status=open -->\n`;
    const o = m("g-a"), a = m("g-a") + m("g-x") + m("g-x"), b = m("g-a");
    // a presence-only check passes this (g-x is present); the multiset check does not
    expect(gapIdSelfCheck(o, a, b, m("g-a") + m("g-x")).dropped).toEqual(["g-x"]);
    // both sides changed g-a's count differently: no right answer → ambiguous
    expect(gapIdSelfCheck(m("g-a"), m("g-a") + m("g-a"), "", m("g-a")).ambiguous).toEqual(["g-a"]);
  });

  test("BITE (S469 review #6): a marker inside a CODE FENCE does not stand in for a dropped entry", () => {
    const fence = "```\n<!-- @gap id=g-x sev=LOW status=open -->\n```\n";
    const entry = "<!-- @gap id=g-x sev=LOW status=open -->\n";
    const o = fence, a = fence + entry, b = fence;
    expect(gapIdCounts(fence).size).toBe(0);
    expect(gapIdSelfCheck(o, a, b, fence).dropped).toEqual(["g-x"]);
  });
});

describe("cross-file sections — one-sided change taken; a TWO-sided change STOPS for --regen", () => {
  const facts = (version, tests) =>
    `# facts\n\nprose\n\n<!-- @generated:facts-table START (do not edit — \`bun scripts/facts.ts --write\`) -->\n| fact | value |\n|---|---|\n| compiler version | \`${version}\` |\n| test files | ${tests} |\n<!-- @generated:facts-table END -->\n\nmore prose\n`;

  test("BITE (S469 review #3): both sides change the table → NO right value here → needsRegen (the driver stops)", () => {
    // Neither 1,754 nor 1,751 is the merged tree's count; committing either is a merge whose
    // facts.ts --check fails while both parents pass. The driver must stop, not pick.
    const o = facts("0.8.0", "1,750"), a = facts("0.8.0", "1,754"), b = facts("0.8.0", "1,751");
    expect(gitMergeFile(o, a, b, 7, LABELS).conflicts).toBeGreaterThan(0);
    const r = mergeGenerated(o, a, b, "docs/FACTS.md");
    expect(r.conflicts).toBe(0);
    expect(r.needsRegen).toEqual(["facts-table"]);
    expect(r.provisional).toEqual(["facts-table"]);
    expect(r.pending).toBe(true);
  });

  test("the regen block round-trips: stripRegenBlock removes exactly it, and refuses a file with other markers", () => {
    const body = facts("0.8.0", "1,754");
    const blocked = regenBlock(7, ["facts-table"]) + body;
    expect(blocked.startsWith(OPEN)).toBe(true);
    expect(stripRegenBlock(blocked)).toBe(body);
    expect(stripRegenBlock(body)).toBeNull();
    expect(stripRegenBlock(blocked + `${OPEN} x\na\n${"=".repeat(7)}\nb\n${CLOSE} y\n`)).toBeNull();
  });

  test("a section only ONE side changed takes that side's value — no stop", () => {
    const o = facts("0.8.0", "1,750"), a = facts("0.8.0", "1,750").replace("more prose", "more prose, ours"), b = facts("0.8.0", "1,751");
    const r = mergeGenerated(o, a, b, "docs/FACTS.md");
    expect(r.needsRegen).toEqual([]);
    expect(r.text).toContain("| test files | 1,751 |");
  });

  test("a side that left the section at base yields to the side that changed it", () => {
    const o = facts("0.8.0", "1,750");
    const a = facts("0.8.0", "1,750").replace("prose\n\n<!--", "edited prose\n\n<!--");
    const b = facts("0.9.0", "1,751");
    const r = mergeGenerated(o, a, b, "docs/FACTS.md");
    expect(r.conflicts).toBe(0);
    expect(r.text).toContain("edited prose");
    expect(r.text).toContain("`0.9.0`");
    expect(r.text).toContain("| test files | 1,751 |");
  });

  test("SPEC-INDEX: shifted row line ranges never conflict; a summary edit merges as hand text", () => {
    const idx = (rows, totals) =>
      `# SPEC.md Section Index\n\n<!-- @generated:spec-index-totals START (do not edit — \`bun run scripts/regen-spec-index.ts\`) -->\n${totals}\n<!-- @generated:spec-index-totals END -->\n\n## Sections\n\n| § | Section | Lines | Size | Summary |\n|---|---------|-------|------|---------|\n` +
      rows.map(([k, n, r, s, sum]) => `| ${k} | ${n} | ${r} | ${s} | ${sum} |`).join("\n") + "\n\n## After\n";
    const o = idx([["1", "One", "1-10", "10", "first"], ["2", "Two", "11-20", "10", "second"], ["3", "Three", "21-30", "10", "third"]], "Total lines: 30");
    const a = idx([["1", "One", "1-12", "12", "first"], ["2", "Two", "13-22", "10", "second"], ["3", "Three", "23-32", "10", "third"]], "Total lines: 32");
    const b = idx([["1", "One", "1-10", "10", "first"], ["2", "Two", "11-25", "15", "second"], ["3", "Three", "26-35", "10", "third — theirs' summary"]], "Total lines: 35");
    expect(gitMergeFile(o, a, b, 7, LABELS).conflicts).toBeGreaterThan(0);
    const r = mergeGenerated(o, a, b, "compiler/SPEC-INDEX.md");
    expect(r.conflicts).toBe(0);
    expect(r.text).not.toContain(OPEN);
    expect(r.text).toContain("| 3 | Three | 23-32 | 10 | third — theirs' summary |");
    expect(r.text).toContain("| 1 | One | 1-12 | 12 | first |");
    expect(r.provisional.sort()).toEqual(["spec-index-rows", "spec-index-totals"]);
    expect(r.needsRegen.sort()).toEqual(["spec-index-rows", "spec-index-totals"]); // both sides moved them
    expect(r.pending).toBe(true);
  });

  test("a wholly-generated file never gets markers from the text merge; a two-sided change needs regen", () => {
    const g = (n) => `# Bootstrap conformance — generated\n\n<!-- @generated by \`bun scripts/bootstrap-conformance.ts --write\`. Do not hand-edit. -->\n\n| PASS | ${n} |\n`;
    expect(gitMergeFile(g(1), g(2), g(3), 7, LABELS).conflicts).toBeGreaterThan(0);
    const r = mergeGenerated(g(1), g(2), g(3), "docs/bootstrap-conformance.md");
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe(g(2));
    expect(r.pending).toBe(true);
    expect(r.needsRegen).toEqual(["(whole file)"]);
    expect(mergeGenerated(g(1), g(1), g(3), "docs/bootstrap-conformance.md").needsRegen).toEqual([]);
  });
});

describe("end to end through `git merge`, with the config the installer ships", () => {
  // ⚑ Strip every GIT_* variable: under the pre-commit hook git exports GIT_INDEX_FILE (and may
  // export GIT_DIR), and a `git init`/`commit` in a temp dir that inherited them would act on the
  // REAL repository's index. SCRML_SKIP_MERGE_DRIVER_INSTALL is stripped too: a suite run with the
  // opt-out set (so the REAL clone's config is left alone) must still exercise the installer here.
  const cleanEnv = () =>
    Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && k !== "SCRML_SKIP_MERGE_DRIVER_INSTALL"));
  const sh = (cwd, cmd, args, env) => spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...cleanEnv(), ...env } });
  const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const SCRIPTS = ["git-merge-generated.ts", "git-merge-generated.sh", "state.ts"];

  /** A throwaway repo. `scripts`: copy the driver into the checkout (gitignored, so it is in ours' tree). */
  function repo(scripts, { attrs = true } = {}) {
    const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scrml-mgd-test-"));
    const g = (...args) => {
      const r = sh(root, "git", args, ID);
      if (r.status !== 0 && !["merge", "ls-files", "diff"].includes(args[0])) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r;
    };
    g("init", "-q", "-b", "main");
    g("config", "core.hooksPath", "/dev/null");
    g("config", "rerere.enabled", "false");
    const cfg = sh(root, "bash", [join(REPO, "scripts/install-merge-driver.sh"), "--quiet"]);
    expect(cfg.status).toBe(0);
    if (scripts) {
      mkdirSync(join(root, "scripts"));
      for (const f of SCRIPTS) copyFileSync(join(REPO, "scripts", f), join(root, "scripts", f));
    }
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, ".gitattributes"), attrs ? "/docs/known-gaps.md merge=scrml-generated\n" : "");
    writeFileSync(join(root, ".gitignore"), "scripts/\n");
    writeFileSync(join(root, "docs/known-gaps.md"), ledger(BASE_ENTRIES));
    g("add", "-A"); g("commit", "-qm", "base");
    g("checkout", "-qb", "side");
    writeFileSync(join(root, "docs/known-gaps.md"), ledger([...BASE_ENTRIES, { id: "g-new-theirs", sev: "HIGH" }]));
    g("commit", "-qam", "theirs");
    g("checkout", "-q", "main");
    writeFileSync(join(root, "docs/known-gaps.md"), ledger([{ id: "g-new-ours", sev: "HIGH" }, ...BASE_ENTRIES.map((e) => (e.id === "g-b" ? { ...e, status: "resolved" } : e))]));
    g("commit", "-qam", "ours");
    return { root, g };
  }
  const kg = (root) => readFileSync(join(root, "docs/known-gaps.md"), "utf8");
  const done = (root) => rmSync(root, { recursive: true, force: true });

  test("with the driver: the merge commits cleanly, both entries present, table exact", () => {
    const { root, g } = repo(true);
    try {
      const r = g("merge", "--no-edit", "side");
      expect(r.status).toBe(0);
      const text = kg(root);
      expect(text).not.toContain(OPEN);
      expect(text).toContain("g-new-ours");
      expect(text).toContain("g-new-theirs");
      expect(tableOf(text)).toBe(gapCountsSection(text));
      expect(tableOf(text)).toContain("| HIGH | 3 | 0 |");
      expect(tableOf(text)).toContain("| MED | 1 | 0 |");
      expect(existsSync(join(root, ".git/MERGE_HEAD"))).toBe(false);
    } finally { done(root); }
  });

  test("UNION end to end: two branches each append an entry at the tail → auto-merged, both kept, counts exact", () => {
    const { root, g } = repo(true);
    try {
      g("checkout", "-qb", "tail-a", "main~1");
      writeFileSync(join(root, "docs/known-gaps.md"), ledger([...BASE_ENTRIES, { id: "g-tail-a", sev: "HIGH" }]));
      g("commit", "-qam", "a");
      g("checkout", "-qb", "tail-b", "main~1");
      writeFileSync(join(root, "docs/known-gaps.md"), ledger([...BASE_ENTRIES, { id: "g-tail-b", sev: "HIGH" }]));
      g("commit", "-qam", "b");
      const r = g("merge", "--no-edit", "tail-a");
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("unioned 1 same-spot gap-entry addition");
      const text = kg(root);
      expect(text).not.toContain(OPEN);
      expect([...gapIdCounts(text).keys()].sort()).toEqual([...BASE_ENTRIES.map((e) => e.id), "g-tail-a", "g-tail-b"].sort());
      expect(tableOf(text)).toBe(gapCountsSection(text));
      expect(tableOf(text)).toContain("| HIGH | 3 | 0 |");
    } finally { done(root); }
  });

  test("BITE (S469 review #1): the driver CRASHES at import → markers + BOTH sides on the page, never pure ours", () => {
    const { root, g } = repo(true);
    try {
      const st = join(root, "scripts/state.ts");
      writeFileSync(st, `throw new Error("boom at import");\n` + readFileSync(st, "utf8"));
      const r = g("merge", "--no-edit", "side");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("DRIVER FAILED");
      const text = kg(root);
      expect(text).toContain(OPEN);
      expect(text).toContain("DRIVER FAILED");
      expect(text).toContain("g-new-ours");
      expect(text).toContain("g-new-theirs"); // the pre-fix wrapper left pure ours: theirs absent
      expect(g("ls-files", "-u").stdout).toContain("docs/known-gaps.md");
      expect(existsSync(join(root, "docs/known-gaps.md.scrml-ours"))).toBe(false); // no litter
    } finally { done(root); }
  });

  test("BITE (S469 review #1): no bun on PATH → the same fail-closed plain 3-way with markers", () => {
    const { root, g } = repo(true);
    try {
      const gitDir = dirname(spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim());
      const PATH = [gitDir, "/usr/bin", "/bin"].filter((d) => !existsSync(join(d, "bun"))).join(":");
      const r = sh(root, "git", ["merge", "--no-edit", "side"], { ...ID, PATH });
      expect(r.status).not.toBe(0);
      const text = kg(root);
      expect(text).toContain("DRIVER UNAVAILABLE");
      expect(text).toContain("g-new-theirs");
      expect(g("ls-files", "-u").stdout).toContain("docs/known-gaps.md");
    } finally { done(root); }
  });

  test("BITE (S469 review #4): a branch WITHOUT the driver scripts gets git's own merge, not any stored copy", () => {
    const { root, g } = repo(false);
    try {
      // a legacy stored copy from the first cut must never run: the installer removes it, and the
      // configured command never looks for it
      mkdirSync(join(root, ".git/scrml-generated-driver"));
      writeFileSync(join(root, ".git/scrml-generated-driver/git-merge-generated.ts"), "process.exit(0)\n");
      const r = g("merge", "--no-edit", "side");
      expect(r.status).not.toBe(0);
      const text = kg(root);
      expect(text).toContain(OPEN); // git's normal markers
      expect(text).not.toContain("scrml-generated-merge");
      g("merge", "--abort");
      expect(sh(root, "bash", [join(REPO, "scripts/install-merge-driver.sh"), "--quiet"]).status).toBe(0);
      expect(existsSync(join(root, ".git/scrml-generated-driver"))).toBe(false);
    } finally { done(root); }
  });

  test("a branch with no `merge=scrml-generated` attribute never runs the driver, even with it installed", () => {
    const { root, g } = repo(true, { attrs: false });
    try {
      const r = g("merge", "--no-edit", "side");
      expect(r.stderr).not.toContain("scrml-generated-merge");
    } finally { done(root); }
  });

  test("BITE (S469 review #7): a pending record does not survive `git merge --abort` into the next merge", () => {
    const { root, g } = repo(true);
    try {
      // a record left by a merge that was then aborted: keyed to HEAD, HEAD never moved
      const head = g("rev-parse", "HEAD").stdout.trim();
      writeFileSync(join(root, ".git/scrml-generated-pending"), `key ${head}\ndocs/FACTS.md\n`);
      const r = sh(root, "bun", [join(root, "scripts/git-merge-generated.ts"), "--pending"]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("");
      expect(existsSync(join(root, ".git/scrml-generated-pending"))).toBe(false);
    } finally { done(root); }
  });

  test("SCRML_SKIP_MERGE_DRIVER_INSTALL leaves the clone untouched", () => {
    const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scrml-mgd-skip-"));
    try {
      expect(sh(root, "git", ["init", "-q"]).status).toBe(0);
      expect(sh(root, "bash", [join(REPO, "scripts/install-merge-driver.sh")], { SCRML_SKIP_MERGE_DRIVER_INSTALL: "1" }).status).toBe(0);
      expect(sh(root, "git", ["config", "--get", "merge.scrml-generated.driver"]).status).not.toBe(0);
    } finally { done(root); }
  });

  test("install.sh: sets the driver idempotently, removes legacy state; --uninstall removes everything", () => {
    const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scrml-mgd-install-"));
    try {
      expect(sh(root, "git", ["init", "-q"]).status).toBe(0);
      mkdirSync(join(root, "scripts/git-hooks"), { recursive: true });
      for (const f of ["install.sh", "post-merge", "post-rewrite"]) {
        copyFileSync(join(REPO, "scripts/git-hooks", f), join(root, "scripts/git-hooks", f));
      }
      copyFileSync(join(REPO, "scripts/install-merge-driver.sh"), join(root, "scripts/install-merge-driver.sh"));
      copyFileSync(join(REPO, ".gitattributes"), join(root, ".gitattributes"));
      // a user's own line + a block in the legacy format (both earlier installers wrote one)
      writeFileSync(
        join(root, ".git/info/attributes"),
        "*.bin binary\n# >>> scrml-generated merge driver (managed by scripts/git-hooks/install.sh) >>>\nold.md merge=scrml-generated\n# <<< scrml-generated merge driver <<<\n",
      );
      for (let i = 0; i < 2; i++) expect(sh(root, "bash", ["scripts/git-hooks/install.sh"]).status).toBe(0);
      const drv = sh(root, "git", ["config", "--get", "merge.scrml-generated.driver"]).stdout;
      expect(drv).toContain("sh scripts/git-merge-generated.sh");
      expect(drv).not.toContain("exec bun"); // review #1: exec'ing bun skipped every fallback
      expect(drv).toContain("%O %A %B %P %L %S %X %Y");
      expect(readFileSync(join(root, ".git/info/attributes"), "utf8")).toBe("*.bin binary\n"); // legacy block gone, user line kept
      const again = sh(root, "bash", ["scripts/install-merge-driver.sh"]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("already configured"); // the pretest path is a no-op once installed
      const un = sh(root, "bash", ["scripts/install-merge-driver.sh", "--uninstall"]);
      expect(un.status).toBe(0);
      expect(sh(root, "git", ["config", "--get-regexp", "^merge\\.scrml-generated\\."]).stdout).toBe("");
    } finally { done(root); }
  });
});
