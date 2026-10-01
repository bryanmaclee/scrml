// cores.js — which Cores the slice-M1 suite runs on.
//
// By default: the HAND-BUILT Cores (slice-m1/*.core.scrml), M1's oracle. With
// SLICE_CORE=lowered: the Cores the M2 front end (lex → parse → analyze → lower)
// produces from the SAME programs written as scrml source (slice-m2/src,
// slice-m2/fixtures) — so every M1 test also runs against the lowered programs.
//
//   bun test ./compiler/self-host-v2/slice-m1/                        # hand-built
//   SLICE_CORE=lowered bun test ./compiler/self-host-v2/slice-m1/     # lowered

import { loadBootstrap } from "./harness.js";
import { loadM2 } from "../slice-m2/harness.js";
import { loweredCores } from "../slice-m2/lowered.js";

export const LOWERED = process.env.SLICE_CORE === "lowered";

function handBuilt(mods) {
  return {
    counter: () => mods["counter.core"].counterCore(),
    dropdown: () => mods["dropdown.core"].dropdownCore(),
    dropdownReorder: () => mods["dropdown.core"].dropdownReorderCore(),
    dropdownEarlyRead: () => mods["dropdown.core"].dropdownEarlyReadCore(),
    valuesem: () => mods["valuesem.core"].valuesemCore(),
  };
}

/** { mods, cores } — the compiled bootstrap modules and the Core providers. */
export function loadSuite() {
  if (LOWERED) {
    const { mods } = loadM2();
    return { mods, cores: loweredCores(mods) };
  }
  const { mods } = loadBootstrap();
  return { mods, cores: handBuilt(mods) };
}
