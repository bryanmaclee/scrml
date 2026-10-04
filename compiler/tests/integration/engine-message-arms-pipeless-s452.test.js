/* SPDX-License-Identifier: MIT
 *
 * S452 — engine message arms WITHOUT a leading `|` compile BYTE-IDENTICALLY to
 * the `|`-led form (`g-impl1-engine-message-arm-pipeless-as-text-s452`).
 *
 * SPEC §19.4.5: a `|`-led message arm "SHALL be the same arm as the arm without
 * the `|` — the same AST, emitted code and run-time behaviour". §51.0.S.2.3: a
 * message arm IS a §18.2 `match-arm`, "with no leading `|`".
 *
 * Each case compiles the piped and the pipe-less source AT THE SAME PATH (the
 * chunk-scope token is path-derived) and asserts every emitted artifact
 * (client JS, server JS, HTML, CSS) and every diagnostic is identical. Before
 * the fix, the pipe-less form compiled at exit 0 with the arms rendered as
 * literal text, the `_msg_arms` table dropped, and `.advance(.Drop(col))`
 * lowered to a plain state advance.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "engine-msg-pipeless-s452-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let counter = 0;
/** Compile `source` at `<TMP>/<dir>/app.scrml`; return artifacts + diagnostics. */
function compileAt(dir, source) {
  const d = join(TMP, dir);
  mkdirSync(d, { recursive: true });
  const abs = join(d, "app.scrml");
  writeFileSync(abs, source);
  const r = compileScrml({ inputFiles: [abs], outputDir: join(d, "dist"), write: false, log: () => {} });
  const out = r.outputs ? [...r.outputs.values()][0] ?? {} : {};
  const diag = (e) => `${e.code ?? ""}|${e.severity ?? ""}|${e.message ?? ""}`;
  return {
    clientJs: out.clientJs ?? "",
    serverJs: out.serverJs ?? "",
    html: out.html ?? "",
    css: out.css ?? "",
    errors: (r.errors ?? []).map(diag),
    warnings: (r.warnings ?? []).map(diag),
    lints: (r.lintDiagnostics ?? []).map(diag),
  };
}

/** Compile both spellings at the same path and assert byte-identical output. */
function assertEquivalent(piped, pipeless) {
  expect(pipeless).not.toBe(piped);
  const dir = `case${counter++}`;
  const a = compileAt(dir, piped);
  const b = compileAt(dir, pipeless);
  expect(b.errors).toEqual(a.errors);
  // Identical aside from W-ARM-PIPE-LEGACY (§19.4.5): one per `|`-led arm,
  // and only on the piped side's `|`-led arms.
  const isPipeLint = (d) => d.startsWith("W-ARM-PIPE-LEGACY|");
  const pipeLed = (s) => (s.match(/^[ \t]*\| /gm) ?? []).length;
  expect(b.warnings.filter((d) => !isPipeLint(d))).toEqual(a.warnings.filter((d) => !isPipeLint(d)));
  expect(a.warnings.filter(isPipeLint).length).toBe(pipeLed(piped));
  expect(b.warnings.filter(isPipeLint).length).toBe(pipeLed(pipeless));
  for (const d of a.warnings.filter(isPipeLint)) expect(d).toContain("|info|");
  expect(b.lints).toEqual(a.lints);
  expect(b.clientJs).toBe(a.clientJs);
  expect(b.serverJs).toBe(a.serverJs);
  expect(b.html).toBe(a.html);
  expect(b.css).toBe(a.css);
  return { piped: a, pipeless: b };
}

/** Delete the legacy lead `| ` from every arm line. */
const unpipe = (s) => s.replace(/^([ \t]*)\| /gm, "$1");

// §51.0.S.6 worked example — payload state-child, block body, wildcard; an arm
// body uses the state binding (id) AND the message binding (col).
const DRAG = `<program title="drag">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
  type DragMsg:enum   = { Start(id: number), Drop(col: string), End }
}
<tasks> = ["a"]
const taskMovedTo = (tasks, id, col) => tasks.concat([String(id) + col])
<engine for=DragPhase initial=.Idle accepts=DragMsg>
  <Idle rule=.Dragging>
    | .Start(id) :> .Dragging(id)
    | _          :> @dragPhase
  </>
  <Dragging(id) rule=.Idle>
    | .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }
    | .End       :> .Idle
    | _          :> @dragPhase
    <p class="hint">dragging \${id}</p>
  </>
</>
<button id="start" onclick=@dragPhase.advance(.Start(7))>start</button>
<button id="drop" onclick=@dragPhase.advance(.Drop("done"))>drop</button>
<p id="count">\${@tasks.length}</p>
</program>
`;

// The mis-split class: arm bodies ending in qualified variants and member
// access, each followed by `_ :>` / `.V :>`.
const QUALIFIED = `<program title="q">
\${
  type Phase:enum = { Empty, Full(n: number) }
  type Msg:enum   = { Fill(n: number), Clear, Ping }
}
<cfg> = { next: 1 }
<engine for=Phase initial=.Empty accepts=Msg>
  <Empty rule=.Full>
    | .Fill(n) :> .Full(n)
    | .Clear   :> Phase.Empty
    | _        :> @phase
  </>
  <Full(n) rule=.Empty>
    | .Clear   :> Phase.Empty
    | .Fill(m) :> { @cfg = { next: m }; Phase.Empty }
    | .Ping    :> Phase.Empty
    <p>full \${n}</p>
  </>
</>
<button onclick=@phase.advance(.Fill(3))>fill</button>
</program>
`;

describe("S452 — pipe-less message arms ≡ piped (byte-identical artifacts + diagnostics)", () => {
  test("examples/25-triage-board.scrml", () => {
    // The example is canonical (pipe-less) since `scrml fix` migrated it (S452); its legacy
    // twin re-adds the `| ` lead to the five message-arm lines inside the `<engine>` (the
    // match arms above the engine are not message arms and stay untouched).
    const bare = readFileSync(resolve(import.meta.dir, "../../../examples/25-triage-board.scrml"), "utf8");
    const at = bare.indexOf("<engine");
    expect(at).toBeGreaterThan(0);
    const src = bare.slice(0, at) +
      bare.slice(at).replace(/^([ \t]*)(?=(?:\.[A-Z]\w*(?:\([^)]*\))?|_)[ \t]*:>)/gm, "$1| ");
    expect((src.match(/^[ \t]*\| /gm) ?? []).length).toBe(5);
    expect(unpipe(src)).toBe(bare);
    const { pipeless } = assertEquivalent(src, bare);
    expect(pipeless.clientJs).toContain("_dragPhase_msg_arms");
    expect(pipeless.clientJs).toContain("_scrml_engine_dispatch_message");
    expect(pipeless.clientJs).not.toContain(":> .Dragging(id)");
  });

  test("§51.0.S.6 drag engine — payload state-child, block body, state+message bindings, render after arms", () => {
    const { pipeless } = assertEquivalent(DRAG, unpipe(DRAG));
    expect(pipeless.errors).toEqual([]);
    expect(pipeless.clientJs).toContain("_dragPhase_msg_arms");
    expect(pipeless.clientJs).toContain("dragging");
    expect(pipeless.clientJs).not.toContain(":> .Idle");
  });

  test("bodies ending in qualified variants are not split into fake arms", () => {
    const { pipeless } = assertEquivalent(QUALIFIED, unpipe(QUALIFIED));
    expect(pipeless.clientJs).toContain("_phase_msg_arms");
    expect(pipeless.clientJs).not.toContain(":> Phase.Empty");
  });

  test("mixed piped / pipe-less arms ≡ all piped", () => {
    // Unpipe every other arm line.
    let i = 0;
    const mixed = DRAG.replace(/^([ \t]*)\| /gm, (m, ws) => (i++ % 2 === 0 ? ws : m));
    assertEquivalent(DRAG, mixed);
  });

  test("`::V` / `else` pipe-less heads ≡ the `.V` / `_` piped arms", () => {
    const canon = unpipe(DRAG)
      .replace(".Start(id) :>", "::Start(id) :>")
      .replace("    _          :> @dragPhase\n  </>\n  <Dragging", "    else       :> @dragPhase\n  </>\n  <Dragging");
    expect(canon).toContain("::Start(id) :>");
    expect(canon).toContain("else       :>");
    assertEquivalent(DRAG, canon);
  });

  test("an engine WITHOUT message arms is unchanged by prose that is not an arm head", () => {
    const src = `<program title="p">
\${ type Phase:enum = { A, B } }
<engine for=Phase initial=.A>
  <A rule=.B>
    Note.Remember: this is prose, not an arm
    <p>a</p>
  </>
  <B rule=.A>
    Drag a card here
  </>
</>
</program>
`;
    const r = compileAt(`case${counter++}`, src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toContain("_msg_arms");
    expect(r.clientJs).toContain("Note.Remember: this is prose, not an arm");
    expect(r.clientJs).toContain("Drag a card here");
  });
});
