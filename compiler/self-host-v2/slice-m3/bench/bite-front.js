// bite-front.js — the bite matrix's FRONT-END section (s442). The §66 constructs the bootstrap front
// end (lex / parse / analyze / lower) gained for the §66.19 worked programs have no conformance case
// (impl#1 implements none of §66), so the footprint grade cannot certify them. Their runtime passes are
// the slice-M4 BEHAVIOUR tests: each §66.19 program compiled from its verbatim SPEC source and run in
// happy-dom (slice-m4/*.test.js, `describe("… — behaviour")`).
//
// Per construct, a named corruption of the front end is applied to the mirror, and the construct's
// behaviour tests are re-run there. A KILL is a behaviour test that FAILS while the mutated program
// still COMPILES CLEAN. Not a bite (reported, never counted):
//   - the mutated bootstrap does not compile under impl#1 ("bootstrap bundle failed to compile");
//   - the mutated front end REJECTS the program (a diagnostic: compileClean throws) — the program never
//     ran against the corrupted construct, the front-end analogue of a case reclassified front-end.
// A behaviour test selected by `-t behaviour` that is missing entirely (0 ran) is a hollow run.

/**
 * @param {string} out  the combined stdout+stderr of `bun test … -t behaviour`
 * @returns {{ ran: boolean, rejected: boolean, pass: number, fail: number, why: string }}
 */
export function judgeFrontRun(out) {
  const pass = Number((/(\d+) pass/.exec(out) ?? [0, 0])[1]);
  const fail = Number((/(\d+) fail/.exec(out) ?? [0, 0])[1]);
  if (/bootstrap bundle failed to compile under impl#1/.test(out)) {
    return { ran: false, rejected: false, pass, fail, why: "the mutated bootstrap does not compile under impl#1" };
  }
  if (/the bootstrap front end reported diagnostics for/.test(out)) {
    return { ran: true, rejected: true, pass, fail, why: "the mutated front end rejects the program (a diagnostic) — it never ran" };
  }
  if (pass + fail === 0) return { ran: false, rejected: false, pass, fail, why: "no behaviour test ran (hollow)" };
  return { ran: true, rejected: false, pass, fail, why: "" };
}

/** A kill: the run happened, the program compiled clean, and ≥1 behaviour test failed. */
export function isFrontKill(j) {
  return j.ran && !j.rejected && j.fail > 0;
}
