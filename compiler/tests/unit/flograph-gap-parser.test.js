/**
 * flograph-gap-parser.test.js — flograph reads @gap markers through state.ts's parser (S430 review).
 *
 * flograph carried its own fixed-order GAP_RE requiring `status=` to be the LAST attribute, so a
 * marker with a trailing `locus=` / `prov=` (~570 of ~1,100 in the live ledger) never became a gap
 * node, and the report's "GAP round-trip (must match state.ts)" read HIGH open=9 against state.ts's
 * 126. It now consumes `parseGapMarkers` + `classifyGapStatus`; these pin that.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { build } from "../../../scripts/flograph.ts";

let dir;
let file;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scrml-flograph-gap-"));
  file = join(dir, "ledger.md");
  writeFileSync(
    file,
    [
      "### g-a — trailing attributes after status",
      "<!-- @gap id=g-a sev=HIGH status=open locus=compiler/src/x.ts:1 prov=empirical:y -->",
      "### g-b — status not last, id not first",
      "<!-- @gap sev=MED locus=a.ts status=carried id=g-b -->",
      "### g-c — plain",
      "<!-- @gap id=g-c sev=LOW status=in-progress -->",
      "text mentioning a <!-- @gap … --> format example is not a node",
    ].join("\n"),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("flograph @gap nodes come from state.ts's parser", () => {
  test("markers with trailing locus=/prov=, and with any attribute order, become gap nodes", () => {
    const { nodes } = build([file]);
    const gaps = [...nodes.values()].filter((n) => n.kind === "gap");
    expect(gaps.map((g) => [g.id, g.sev, g.status]).sort()).toEqual([
      ["g-a", "HIGH", "open"],
      ["g-b", "MED", "carried"],
      ["g-c", "LOW", "in-progress"],
    ]);
  });
});
