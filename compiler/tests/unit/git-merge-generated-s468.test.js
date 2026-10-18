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
    expect(r.selfCheck).toEqual({ dropped: [], duplicated: [] });
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
    expect(r.selfCheck).toEqual({ dropped: [], duplicated: [] });
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
    expect(r.selfCheck).toEqual({ dropped: [], duplicated: [] });
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
});

describe("cross-file sections — provisional value, pending phase 2, never markers", () => {
  const facts = (version, tests) =>
    `# facts\n\nprose\n\n<!-- @generated:facts-table START (do not edit — \`bun scripts/facts.ts --write\`) -->\n| fact | value |\n|---|---|\n| compiler version | \`${version}\` |\n| test files | ${tests} |\n<!-- @generated:facts-table END -->\n\nmore prose\n`;

  test("BITE: both sides change the table → plain merge conflicts; the driver takes ours provisionally", () => {
    const o = facts("0.8.0", "1,750"), a = facts("0.8.0", "1,754"), b = facts("0.8.0", "1,751");
    expect(gitMergeFile(o, a, b, 7, LABELS).conflicts).toBeGreaterThan(0);
    const r = mergeGenerated(o, a, b, "docs/FACTS.md");
    expect(r.conflicts).toBe(0);
    expect(r.text).not.toContain(OPEN);
    expect(r.text).toContain("| test files | 1,754 |");
    expect(r.provisional).toEqual(["facts-table"]);
    expect(r.pending).toBe(true);
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
    expect(r.pending).toBe(true);
  });

  test("a wholly-generated file never conflicts; ours is provisional", () => {
    const g = (n) => `# Bootstrap conformance — generated\n\n<!-- @generated by \`bun scripts/bootstrap-conformance.ts --write\`. Do not hand-edit. -->\n\n| PASS | ${n} |\n`;
    expect(gitMergeFile(g(1), g(2), g(3), 7, LABELS).conflicts).toBeGreaterThan(0);
    const r = mergeGenerated(g(1), g(2), g(3), "docs/bootstrap-conformance.md");
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe(g(2));
    expect(r.pending).toBe(true);
  });
});

describe("end to end through `git merge`, with the config string install.sh ships", () => {
  // ⚑ Strip every GIT_* variable: under the pre-commit hook git exports GIT_INDEX_FILE (and may
  // export GIT_DIR), and a `git init`/`commit` in a temp dir that inherited them would act on the
  // REAL repository's index.
  // SCRML_SKIP_MERGE_DRIVER_INSTALL is stripped too: a suite run with the opt-out set (so the REAL clone's
  // config is left alone) must still exercise the installer inside these throwaway repos.
  const cleanEnv = () =>
    Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && k !== "SCRML_SKIP_MERGE_DRIVER_INSTALL"));
  const sh = (cwd, cmd, args, env) => spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...cleanEnv(), ...env } });

  function repo(withScripts) {
    const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scrml-mgd-test-"));
    const g = (...args) => {
      const r = sh(root, "git", args, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
      if (r.status !== 0 && args[0] !== "merge") throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r;
    };
    g("init", "-q", "-b", "main");
    g("config", "core.hooksPath", "/dev/null");
    g("config", "rerere.enabled", "false");
    // The driver config, set by the shipped installer itself (the one `bun run pretest` runs).
    const cfg = sh(root, "bash", [join(REPO, "scripts/install-merge-driver.sh"), "--quiet"]);
    expect(cfg.status).toBe(0);
    if (withScripts) {
      mkdirSync(join(root, "scripts"));
      copyFileSync(join(REPO, "scripts/git-merge-generated.ts"), join(root, "scripts/git-merge-generated.ts"));
      copyFileSync(join(REPO, "scripts/state.ts"), join(root, "scripts/state.ts"));
    }
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, ".gitattributes"), "docs/known-gaps.md merge=scrml-generated\n");
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

  test("with the driver: the merge commits cleanly, both entries present, table exact", () => {
    const { root, g } = repo(true);
    try {
      const r = g("merge", "--no-edit", "side");
      expect(r.status).toBe(0);
      const text = readFileSync(join(root, "docs/known-gaps.md"), "utf8");
      expect(text).not.toContain(OPEN);
      expect(text).toContain("g-new-ours");
      expect(text).toContain("g-new-theirs");
      expect(tableOf(text)).toBe(gapCountsSection(text));
      expect(tableOf(text)).toContain("| HIGH | 3 | 0 |");
      expect(tableOf(text)).toContain("| MED | 1 | 0 |");
      expect(existsSync(join(root, ".git/MERGE_HEAD"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      const text = readFileSync(join(root, "docs/known-gaps.md"), "utf8");
      expect(text).not.toContain(OPEN);
      expect([...gapIdCounts(text).keys()].sort()).toEqual([...BASE_ENTRIES.map((e) => e.id), "g-tail-a", "g-tail-b"].sort());
      expect(tableOf(text)).toBe(gapCountsSection(text));
      expect(tableOf(text)).toContain("| HIGH | 3 | 0 |");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a checkout WITHOUT the script (a branch cut before the driver) uses the installer's snapshot", () => {
    const { root, g } = repo(false);
    try {
      // the installer, run once from a checkout that HAS the scripts, snapshots them into the common dir
      mkdirSync(join(root, "scripts"));
      copyFileSync(join(REPO, "scripts/git-merge-generated.ts"), join(root, "scripts/git-merge-generated.ts"));
      copyFileSync(join(REPO, "scripts/state.ts"), join(root, "scripts/state.ts"));
      expect(sh(root, "bash", [join(REPO, "scripts/install-merge-driver.sh"), "--quiet"]).status).toBe(0);
      rmSync(join(root, "scripts"), { recursive: true, force: true });
      expect(existsSync(join(root, ".git/scrml-generated-driver/git-merge-generated.ts"))).toBe(true);
      const r = g("merge", "--no-edit", "side");
      expect(r.status).toBe(0);
      const text = readFileSync(join(root, "docs/known-gaps.md"), "utf8");
      expect(text).not.toContain(OPEN);
      expect(tableOf(text)).toBe(gapCountsSection(text));
      expect(tableOf(text)).toContain("| HIGH | 3 | 0 |");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("SCRML_SKIP_MERGE_DRIVER_INSTALL leaves the clone untouched", () => {
    const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scrml-mgd-skip-"));
    try {
      expect(sh(root, "git", ["init", "-q"]).status).toBe(0);
      expect(sh(root, "bash", [join(REPO, "scripts/install-merge-driver.sh")], { SCRML_SKIP_MERGE_DRIVER_INSTALL: "1" }).status).toBe(0);
      expect(sh(root, "git", ["config", "--get", "merge.scrml-generated.driver"]).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("install.sh: sets the driver, mirrors the attributes into info/attributes, idempotently", () => {
    const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scrml-mgd-install-"));
    try {
      expect(sh(root, "git", ["init", "-q"]).status).toBe(0);
      mkdirSync(join(root, "scripts/git-hooks"), { recursive: true });
      for (const f of ["install.sh", "post-merge", "post-rewrite"]) {
        copyFileSync(join(REPO, "scripts/git-hooks", f), join(root, "scripts/git-hooks", f));
      }
      copyFileSync(join(REPO, "scripts/install-merge-driver.sh"), join(root, "scripts/install-merge-driver.sh"));
      copyFileSync(join(REPO, ".gitattributes"), join(root, ".gitattributes"));
      // a user's own line + a block in the PRE-S469 format (BEGIN mark named install.sh) — replaced, not duplicated
      writeFileSync(
        join(root, ".git/info/attributes"),
        "*.bin binary\n# >>> scrml-generated merge driver (managed by scripts/git-hooks/install.sh) >>>\nold.md merge=scrml-generated\n# <<< scrml-generated merge driver <<<\n",
      );
      for (let i = 0; i < 2; i++) expect(sh(root, "bash", ["scripts/git-hooks/install.sh"]).status).toBe(0);
      const before = readFileSync(join(root, ".git/info/attributes"), "utf8");
      const again = sh(root, "bash", ["scripts/install-merge-driver.sh"]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("already configured"); // the pretest path is a no-op once installed
      expect(readFileSync(join(root, ".git/info/attributes"), "utf8")).toBe(before);
      const drv = sh(root, "git", ["config", "--get", "merge.scrml-generated.driver"]).stdout;
      expect(drv).toContain("bun scripts/git-merge-generated.ts");
      expect(drv).toContain("%O %A %B %P %L %S %X %Y");
      const info = readFileSync(join(root, ".git/info/attributes"), "utf8");
      expect(info.startsWith("*.bin binary\n")).toBe(true); // a user's own lines survive
      expect(info.match(/>>> scrml-generated merge driver/g)?.length).toBe(1);
      const mirrored = info.split("\n").filter((l) => /\smerge=scrml-generated\b/.test(l)).map((l) => l.split(/\s+/)[0]).sort();
      expect(mirrored).toEqual(["compiler/SPEC-INDEX.md", "docs/FACTS.md", "docs/bootstrap-conformance.md", "docs/known-gaps.md", "master-list.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("driver unavailable: the shipped config FAILS CLOSED — a marked conflict, never a silent pick", () => {
    const { root, g } = repo(false);
    try {
      const r = g("merge", "--no-edit", "side");
      expect(r.status).not.toBe(0);
      const text = readFileSync(join(root, "docs/known-gaps.md"), "utf8");
      expect(text).toContain(OPEN);
      expect(text).toContain("DRIVER UNAVAILABLE");
      expect(text).toContain("g-new-ours");
      expect(text).toContain("g-new-theirs");
      expect(g("ls-files", "-u").stdout).toContain("docs/known-gaps.md");
      expect(existsSync(join(root, ".git/MERGE_HEAD"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
