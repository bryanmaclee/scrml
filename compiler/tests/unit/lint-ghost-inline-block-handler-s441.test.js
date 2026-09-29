/**
 * S441 (s441-demo-blockers, DEFECT 1) — the §5.2.3 inline-block event handler
 * `onclick={ a(); b() }` must not trip the JSX (W-LINT-007) or Vue (W-LINT-013)
 * ghost lints, and the genuine JSX / Vue shapes must still fire.
 *
 * SPEC §5.2.3 (L19 reversed S435): "An event-handler attribute value MAY be an
 * inline block: a `{`, a statement list, and the matching `}`. The statement list
 * is logic context — the same statement grammar as a function body (§7.3)".
 *
 * Pre-fix the raw-text pre-pass read `onclick={` as `<Comp prop={val}>` and every
 * `@x = …` write in the block as a Vue `@event=` shorthand; a `>` inside the block
 * (`if (n > 2)`) also closed the tag-opener early.
 */

import { describe, test, expect } from "bun:test";
import { lintGhostPatterns } from "../../src/lint-ghost-patterns.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const lint = (src) => lintGhostPatterns(src, "t.scrml");
const codes = (diags, code) => diags.filter((d) => d.code === code);

const HEAD = `<program>
<count> = 0
<msg> = ""
<items> = [1, 2, 3]
type Phase:enum = { Idle, Busy }
<phase>: Phase = .Idle
function track(name) { @msg = name }
`;
const wrap = (body) => `${HEAD}${body}\n</program>\n`;

const SILENT_SHAPES = {
  "one-line block of two writes": `<button onclick={ @count = @count + 1; @msg = "hi" }>+</button>`,
  "block of calls": `<button onclick={ track("a"); track("b") }>x</button>`,
  "multi-line block with `>` and nested braces": `<button onclick={
    const next = @count + 1
    @count = next
    if (next > 2) { @msg = "big" }
}>multi</button>`,
  "single-statement block": `<button onclick={@count = 0}>reset</button>`,
  "block inside an <each> row": `<each in=@items as item>
    <button onclick={ @count = item; @msg = "row" }>row</button>
</each>`,
  "block inside a <match> arm": `<match on=@phase>
    <Idle><button onclick={ @phase = .Busy; @msg = "go" }>arm</button></>
    <Busy><p>busy</p></>
</match>`,
  "block on a non-click event, spaced `=`": `<input oninput = { @msg = "typed"; @count = 1 }/>`,
  "namespaced on: event": `<div on:custom={ @count = 1; @msg = "c" }>d</div>`,
  "block followed by more attributes": `<button onclick={ @count = 1; @msg = "a" } class="btn" disabled=@busy>x</button>`,
  "string holding a brace inside the block": `<button onclick={ @msg = "}"; @count = 2 }>x</button>`,
};

describe("S441 — §5.2.3 inline-block handlers are silent under W-LINT-007 / W-LINT-013", () => {
  for (const [name, body] of Object.entries(SILENT_SHAPES)) {
    test(name, () => {
      const d = lint(wrap(body));
      expect(codes(d, "W-LINT-007")).toEqual([]);
      expect(codes(d, "W-LINT-013")).toEqual([]);
    });
  }
});

describe("S441 — the genuine JSX / Vue ghosts still fire", () => {
  test("JSX `<Comp prop={val}>` fires W-LINT-007", () => {
    expect(codes(lint(wrap(`<Card title={name}/>`)), "W-LINT-007").length).toBe(1);
  });
  test("Vue `@click=\"fn\"` fires W-LINT-013", () => {
    expect(codes(lint(wrap(`<button @click="save">x</button>`)), "W-LINT-013").length).toBe(1);
  });
  test("Vue `@click={fn}` fires W-LINT-013 (braces on a non-handler name are not a block handler)", () => {
    expect(codes(lint(wrap(`<button @click={save}>x</button>`)), "W-LINT-013").length).toBe(1);
  });
  test("React camelCase `onClick={handler}` still fires W-LINT-004 and W-LINT-007", () => {
    const d = lint(wrap(`<button onClick={handler}>x</button>`));
    expect(codes(d, "W-LINT-004").length).toBe(1);
    expect(codes(d, "W-LINT-007").length).toBe(1);
  });
  test("a block handler and a JSX prop on the SAME element — only the prop fires", () => {
    const d = lint(wrap(`<Card onclick={ @count = 1; @msg = "a" } title={name}/>`));
    expect(codes(d, "W-LINT-007").length).toBe(1);
    expect(codes(d, "W-LINT-013")).toEqual([]);
  });
  test("a block handler followed by a Vue `@click=` on the SAME element — only the Vue attr fires", () => {
    const d = lint(wrap(`<button onclick={ @count = 1; @msg = "a" } @click="save">x</button>`));
    expect(codes(d, "W-LINT-013").length).toBe(1);
  });
  test("an attribute merely ENDING in `onclick` is not a handler (`dataonclick={v}` fires W-LINT-007)", () => {
    // `dataonclick` is not an event-handler name — the brace is a JSX scalar.
    expect(codes(lint(wrap(`<Card dataonclick={v}/>`)), "W-LINT-007").length).toBe(1);
  });
});

describe("S441 — end to end: the compile's lint stream is clean for the demo shapes", () => {
  test("compileScrml reports no W-LINT-007 / W-LINT-013 for every silent shape together", () => {
    const dir = mkdtempSync(join(tmpdir(), "s441-d1-"));
    try {
      const file = join(dir, "app.scrml");
      writeFileSync(file, wrap(Object.values(SILENT_SHAPES).join("\n").replace("disabled=@busy", "")));
      const r = compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out"), log: () => {} });
      const lints = (r.lintDiagnostics ?? []).map((d) => d.code);
      expect(lints.filter((c) => c === "W-LINT-007" || c === "W-LINT-013")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
