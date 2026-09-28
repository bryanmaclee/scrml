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
