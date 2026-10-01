// bite-lib.js — the bite matrix's one judgement, kept pure so it is testable (bite.test.js).
//
// After a mutation, a clean-run runtime pass that is no longer a pass either
//   - was KILLED: it is still classified GRADED and its conformance run FAILED — the corruption
//     changed what the case observes. Only this is evidence for the corrupted construct.
//   - or was LOST another way (NOT a bite): the mutation reclassified it (`not-yet`, `front-end`)
//     or made the substitute crash (`crashed`), or it vanished from the report. The case never ran
//     against the corrupted construct, so its loss certifies nothing.

/**
 * @param {string[]} passes  the clean run's runtime-pass case dirs
 * @param {{ cases: Array<{relDir: string, cls: string}>, conformance: { failures: Array<{relDir: string}> } }} report
 *        the mutated run's footprint report (`hybrid.ts --footprint --json`)
 * @returns {{ killed: string[], lost: Array<{ relDir: string, why: string }> }}
 */
/**
 * The same judgement for the CSS half (s440): a css pass is KILLED when its result is still GRADED
 * and its css oracle FAILED. A result the mutation reclassified, left unobserved, or dropped is LOST
 * (NOT a bite).
 *
 * @param {string[]} passes  the clean run's css-pass relDirs (all populations)
 * @param {{ css?: { results: Array<{relDir: string, cls: string, pass: boolean|null}> } }} report
 * @returns {{ killed: string[], lost: Array<{ relDir: string, why: string }> }}
 */
export function judgeCssDeaths(passes, report) {
  const byDir = new Map((report.css?.results ?? []).map((r) => [r.relDir, r]));
  const killed = [];
  const lost = [];
  for (const p of passes) {
    const r = byDir.get(p);
    if (r === undefined) lost.push({ relDir: p, why: "absent from the report" });
    else if (r.cls !== "graded") lost.push({ relDir: p, why: `reclassified ${r.cls}` });
    else if (r.pass === false) killed.push(p);
    else if (r.pass === null) lost.push({ relDir: p, why: "no longer observed (no oracle verdict)" });
  }
  return { killed, lost };
}

export function judgeDeaths(passes, report) {
  const cls = new Map(report.cases.map((c) => [c.relDir, c.cls]));
  const failed = new Set(report.conformance.failures.map((f) => f.relDir));
  const killed = [];
  const lost = [];
  for (const p of passes) {
    const c = cls.get(p);
    if (c === "graded") {
      if (failed.has(p)) killed.push(p);
    } else {
      lost.push({ relDir: p, why: c === undefined ? "absent from the report" : `reclassified ${c}` });
    }
  }
  return { killed, lost };
}
