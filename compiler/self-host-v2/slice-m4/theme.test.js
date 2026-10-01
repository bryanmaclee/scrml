// theme.test.js — SPEC §66.19.4 "A theme library — named swatches and tokens".
//
// BLOCKED at `<theme>` (§66.17): its declarations are tokens that lower to CSS
// custom properties (`:root { --brand: … }`, a `data-scrml-theme-mode`
// attribute per mode), and the bootstrap has no CSS emission in this slice —
// the slice-m3 CSS files are held by another session (brief §4). The front end
// REFUSES the element (never parses it as markup, where its token
// declarations would vanish silently). The rest of the program also needs
// constructs not built here, each refused where it is written:
//   - named shared instances `<accent:swatch …/>` (§66.8.2);
//   - a `match` expression in an opener value (`(match @mode { … })`);
//   - `@mode = …` — a whole write of a library file's top-level `let` (⚑ O39).

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd, programFiles } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

describe("§66.19.4 — BLOCKED at `<theme>` (CSS)", () => {
  test("the `<theme>` element is refused, naming its CSS lowering", () => {
    const r = frontEnd(mods, programFiles("theme"));
    const theme = r.diags.filter((d) => d.file === "lib/brand-theme.scrml" && d.message.includes("<theme>"));
    expect(theme.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(theme[0].message).toContain("CSS");
  });

  test("the named shared instances are refused where they are written (§66.8.2)", () => {
    const r = frontEnd(mods, programFiles("theme"));
    const named = r.diags.filter((d) => d.message.includes("named shared instance"));
    expect(named.map((d) => d.message.split(" ")[0])).toEqual(["`<accent:swatch", "`<warn:swatch"]);
  });

  test.todo("§66.19.4 runs: tokens as CSS custom properties, `toggleMode()` flips `data-scrml-theme-mode`, `useWarnAsAccent()` updates THE accent — needs `<theme>` CSS emission (blocked: slice-m3 CSS held) and named shared instances");
});
