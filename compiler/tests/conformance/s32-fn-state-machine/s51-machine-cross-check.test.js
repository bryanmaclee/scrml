// Conformance tests for: SPEC §51.3.2 / §51.15 amendments (S32, 2026-04-20)
//
// S32 narrowed E-ENGINE-005 to permit empty machine bodies when the
// governed state type has state-local transitions, and added §51.15
// (machine ↔ state-local cross-check + E-STATE-MACHINE-DIVERGENCE).
//
// STATUS: ALL TESTS SKIPPED — spec-only amendment as of commit 1d1c49d.
// Compiler implementation of the cross-check and the narrowed E-ENGINE-005
// has NOT landed. These tests are gating tests for the implementer.

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../../src/api.js";

function diagnose(/* source */) {
  throw new Error("diagnose() harness not yet implemented — see test body");
}

describe("S32-008: §51.3.2 — empty machine body is legal when state-local transitions exist", () => {
  test.skip("CONF-S32-008a: empty `< engine>` body does NOT emit E-ENGINE-005 when substates declare transitions", () => {
    // Expected: §51.15.1 aggregated-derived mode. An empty body IS the marker;
    // E-ENGINE-005 SHALL NOT fire.
    const src = `
      < Submission>
          id: string
          < Draft>
              validate() => < Validated> { return < Validated> id = from.id </> }
          </>
          < Validated>
              id: string
          </>
      </>
      < engine name=SubmissionFlow for=Submission ></>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-ENGINE-005")).toBe(false);
  });

  test.skip("CONF-S32-008b: empty `< engine>` body STILL emits E-ENGINE-005 when governed type has NO state-local transitions", () => {
    // Expected: the pre-S32 rule still applies in the no-state-local case.
    const src = `
      < enum Status>
          Active
          Archived
      </>
      < engine name=StatusFlow for=Status ></>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-ENGINE-005")).toBe(true);
  });
});

describe("S32-009: §51.15.2 — every state-local transition SHALL correspond to a machine edge (override mode)", () => {
  test.skip("CONF-S32-009: state-local transition with no matching machine edge emits E-STATE-MACHINE-DIVERGENCE (override mode)", () => {
    // Expected: in override mode (machine body non-empty), every state-local
    // transition must appear in the machine graph OR be banned. Missing edge
    // => E-STATE-MACHINE-DIVERGENCE.
    const src = `
      < Submission>
          < Draft>
              validate() => < Validated> { return < Validated> </> }
          </>
          < Validated></>
      </>
      < engine name=Flow for=Submission>
          // machine body is non-empty (override mode), but omits Draft => Validated
          .Validated => .Archived
      </>
      < Submission>
          < Archived></>
      </>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-STATE-MACHINE-DIVERGENCE")).toBe(
      true
    );
  });
});

describe("S32-010: §51.15.2 — every substate-sourced machine edge SHALL correspond to a state-local transition", () => {
  test.skip("CONF-S32-010: machine edge Draft => Validated without matching state-local emits E-STATE-MACHINE-DIVERGENCE", () => {
    const src = `
      < Submission>
          < Draft></>
          < Validated></>
      </>
      < engine name=Flow for=Submission>
          .Draft => .Validated
      </>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-STATE-MACHINE-DIVERGENCE")).toBe(
      true
    );
  });
});

describe("S32-011: §51.15.2 — temporal transitions exempt from cross-check", () => {
  test.skip("CONF-S32-011: `after Ns => .To` does NOT require a state-local counterpart", () => {
    // Expected: temporal edges are machine-only (§54.7.7); the cross-check
    // exempts them. No E-STATE-MACHINE-DIVERGENCE.
    const src = `
      < Submission>
          < Draft></>
          < Expired></>
      </>
      < engine name=Flow for=Submission>
          after 30s => .Expired
      </>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-STATE-MACHINE-DIVERGENCE")).toBe(
      false
    );
  });
});

describe("S32-012: §51.15.2 — wildcard transitions exempt from cross-check", () => {
  test.skip("CONF-S32-012: `* => *` and `* => .To` do NOT require state-local counterparts", () => {
    const src = `
      < Submission>
          < Draft></>
          < Any></>
      </>
      < engine name=Flow for=Submission>
          * => .Any
      </>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-STATE-MACHINE-DIVERGENCE")).toBe(
      false
    );
  });
});

describe("S32-013: §51.15.2 — guarded machine transitions DO require a state-local counterpart", () => {
  test.skip("CONF-S32-013: `From => To given (…)` without a state-local transition emits E-STATE-MACHINE-DIVERGENCE", () => {
    // Expected: the machine guard is additional to state-local authorization,
    // not a substitute. A guarded machine edge still requires the state-local
    // declaration.
    const src = `
      < Submission>
          < Draft></>
          < Validated></>
      </>
      < engine name=Flow for=Submission>
          .Draft => .Validated given (true)
      </>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-STATE-MACHINE-DIVERGENCE")).toBe(
      true
    );
  });
});

describe("S32-014: §51.15.3 — state-local target SHALL be permitted by type-level `transitions {}`", () => {
  test.skip("CONF-S32-014: state-local transition target not in type-level graph emits E-STATE-MACHINE-DIVERGENCE", () => {
    // Expected: §54.3 and §51.2 must agree. A transition to a target the
    // type-level graph forbids SHALL emit E-STATE-MACHINE-DIVERGENCE, even
    // when no `< engine>` is declared.
    const src = `
      < enum SubmissionKind>
          Draft
          Validated
          Submitted
          transitions {
              Draft => Validated
              // Draft => Submitted is NOT permitted
          }
      </>
      < Submission>
          < Draft>
              // direct-jump transition that skips Validated
              yolo() => < Submitted> { return < Submitted> </> }
          </>
          < Validated></>
          < Submitted></>
      </>
    `;
    const { errors } = diagnose(src);
    expect(errors.some((e) => e.code === "E-STATE-MACHINE-DIVERGENCE")).toBe(
      true
    );
  });
});
