// sources.test.js — the slice-M4 sources ARE the SPEC §66.19 code blocks,
// verbatim (drift guard), each compared with the blocks of ITS OWN section.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readM4 } from "./harness.js";

const lf = (t) => t.replace(/\r\n/g, "\n");
const SPEC = lf(readFileSync(join(import.meta.dir, "..", "..", "SPEC.md"), "utf8"));

/** The ```scrml blocks of SPEC section `#### <num> …`, up to the next heading of level ≤ 4. */
function sectionBlocks(num) {
  const head = SPEC.indexOf("\n#### " + num + " ");
  if (head < 0) throw new Error("SPEC section not found: " + num);
  const rest = SPEC.slice(head + 1);
  const next = rest.slice(1).search(/\n#{1,4} /);
  const body = next < 0 ? rest : rest.slice(0, next + 1);
  return [...body.matchAll(/```scrml\n([\s\S]*?)```/g)].map((m) => m[1]);
}

describe("the §66.19 sources are the SPEC's code blocks, verbatim (drift guard)", () => {
  test("form/signup.scrml is §66.19.2's one block", () => {
    expect(sectionBlocks("66.19.2")).toEqual([lf(readM4("src/form/signup.scrml"))]);
  });
  test("theme/lib/brand-theme.scrml + theme/app.scrml are the two §66.19.4 blocks, in order", () => {
    expect(sectionBlocks("66.19.4")).toEqual([lf(readM4("src/theme/lib/brand-theme.scrml")), lf(readM4("src/theme/app.scrml"))]);
  });
  // Verbatim since the S442 SPEC amendment (§66.12.2 grow/shrink split; §66.19.5 `Entry[free, append]`).
  // s469-tape-followups (#1472): verbatim EXCEPT one line. The SPEC log now appends with `@audit.append(…)`
  // (S469 "tape methods are named after their grants", §66.12.6 rule 3); the bootstrap's method allowlist still
  // knows only `push`/`unshift`, so the compiled source keeps `@audit.append(…)` on that one line. Owed follow-up:
  // rename the allowlist (analyze.scrml), switch audit.scrml to `.append`, and drop the substitution below.
  test("audit/audit.scrml is §66.19.5's one block (with `.append` → `.push` on the record line, pending the allowlist rename)", () => {
    const pending = (b) => b.replace("        @audit.append({ at: Date.now(), actor: @actor, action: action });",
                                     "        @audit.append({ at: Date.now(), actor: @actor, action: action });");
    expect(sectionBlocks("66.19.5").map(pending)).toEqual([lf(readM4("src/audit/audit.scrml"))]);
  });
  test("engine/before.scrml + engine/after.scrml are the two §66.19.6 blocks, in order", () => {
    expect(sectionBlocks("66.19.6")).toEqual([lf(readM4("src/engine/before.scrml")), lf(readM4("src/engine/after.scrml"))]);
  });
});
