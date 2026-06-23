# REQUIREMENTS — `_{}` foreign-code CODEGEN (+ library-mode `?{}` db-injection): make scrml author the dispatch loop

**From:** flogence (the productization target) · **Date:** 2026-06-23 · **Kind:** capability ask (cross-repo, per-repo-PA model)
**Precedent:** this is the same shape as `2026-06-20-from-flogence-fsp-raw-route-requirements.md` — flogence hit a real
scrml capability gap building a feature; here's the self-contained ask, the motivating use case, and the acceptance target.

## TL;DR

flogence built the **dispatch loop** — *route a prompt → a real Claude agent runs it in the target project → result lands
back in §52 → the cockpit shows it*. It works **today**, but the agent-spawning half is a `.ts` harness (`scripts/dispatch.ts`,
`Bun.spawn(["claude","-p",…])`) because **scrml can't spawn a process**. The right scrml mechanism for that is **`_{}` foreign
code (SPEC §23)** — but **its codegen is not built**. We want to bring the dispatcher home: rewrite it as a **compiled scrml
script** (`dispatch.scrml`) with a `_{}` block doing the spawn. That needs two primitives:

- **(A) `_{}` foreign-code codegen** — recognize `_{…}` / `_={…}=` in a LOGIC context, extract the verbatim slice, and emit it
  as a callable whose value flows back to scrml (the §13180 JS-host boundary). **Today it isn't recognized in logic at all.**
- **(B) library-mode `?{}` db-injection** — so a standalone compiled scrml script can read/write a `bun:sqlite` handle (the
  S5 gap, §44.7.1 W5a/W5b "scheduled for follow-up"; please confirm current status).

**Acceptance:** `scripts/dispatch.ts` is the conformance target — port it to `dispatch.scrml`, compile + run it on the live
`flogence.db`, and reproduce the verified end-to-end round-trip (queue a task → dispatch → result `DISPATCHOK` in §52).

## Context — what flogence built (the motivating feature)

The MPA loop, closed (committed `15158f4`, flogence master):
1. **scrml MODELS + EMITS intent** — `routePrompt` (a server fn in `src/app.scrml`) routes a prompt R1/R2/R3 and writes a
   §52 `fsp_task` row carrying `(project, prompt, state='working', result='')`.
2. **the harness DRIVES the instance** — `scripts/dispatch.ts` (`bun run dispatch`, `/loop 2m`) picks up routed-but-undispatched
   tasks, claims each atomically, **spawns a real `claude -p` in the target project's dir** (180s cap), and writes the output
   back (`state → completed/failed`, `result`) + a `disp` delta.
3. **the cockpit shows it** — `loadProjectTasks` returns `prompt`+`result`; the node's tasks drill renders the agent's output.

Step 2 is the only non-scrml part. It's a `.ts` file purely because **scrml has no way to spawn a subprocess**. `_{}` is.

## The gap — EMPIRICAL (spiked against the current compiler, 2026-06-23)

`_{}` is specced (§23 — opaque foreign code delegated to the `lang=` toolchain) and there's a markup parser-bench fixture
(`compiler/tests/parser-conformance/markup-bench/foreign-code.scrml`: `_{ int main() {…} }`). But:

1. **Not recognized in a LOGIC context.** Minimal spike:
   ```scrml
   <program lang="ts">
     function shell() {
       const out = _={ Bun.spawnSync(["echo","hi"]).stdout.toString().trim() }=
       return out
     }
     <div>${shell()}</div>
   </program>
   ```
   → the block-splitter does NOT see `_={…}=` as a foreign opener inside `${}`/default-logic. It tokenizes `_=` as a JS
   assignment and emits malformed JS:
   ```
   E-CODEGEN-INVALID-JS  (foreign-spike.client.js:7)
     ...shell() { const out = _ = { Bun . spawnSync ( [ "echo" , "hi" ...
   ```
   So `_{}` recognition is (per the S108 locus-gating + Q-BUG4-OPEN-1 "deferred") **not wired into the Logic context** where
   foreign code naturally lives (a server-fn body).

2. **No codegen emit for foreign blocks.** `grep -niE "foreign|ForeignBlock|emitForeign" compiler/src/codegen/` → nothing
   (only an unrelated `<html lang>`). There's no "extract slice → delegate → emit callable" path. The TAB-stage `ForeignBlock`
   AST node (§23, SPEC line ~15576) has no codegen consumer.

**Conclusion:** `_{}` is spec + markup-parse only. To run foreign code from scrml, the codegen must be built.

## The target — a COMPILED scrml dispatcher (`dispatch.scrml`)

flogence's chosen home (user decision, 2026-06-23): **not** in-app (don't tie agent runs to the cockpit web process) — a
**standalone compiled scrml script**, run on `/loop` exactly like `dispatch.ts` is now, but scrml-authored. Shape:

```scrml
<program lang="ts" db="./flogence.db">          // db= for the library-mode ?{} (B); lang=ts for the _{} (A)
  // read pending routed tasks (§52)
  const pending = ?{ SELECT task_id, project, prompt FROM fsp_task
                     WHERE state='working' AND prompt != '' AND result = '' ORDER BY created_at ASC }.all()
  for (const t of pending) {
     const path = ?{ SELECT path FROM projects WHERE name = ${t.project} }.get().path
     // THE foreign call — spawn a real agent in the project dir, capture stdout:
     const out = _={
        await new Response(Bun.spawn(["claude","-p", t.prompt, "--output-format","text"], { cwd: path }).stdout).text()
     }=
     ?{ UPDATE fsp_task SET state='completed', result=${out} WHERE task_id=${t.task_id} }.run()
  }
</program>
```
(Illustrative — the exact `_{}` value-flow + the `t.prompt`/`path` capture-into-foreign-scope semantics are yours to define.)

This is the literal "scrml authors the harness" win. The two primitives it needs:

### (A) `_{}` foreign-code codegen — the headline ask
- Recognize `_{…}` / `_={…}=` (level-marked, §23.2) as a foreign opener **in a Logic context** (server-fn / default-logic
  body), not just markup. (Resolves the spike's mis-tokenization.)
- Extract the verbatim interior; emit it via the `lang=` toolchain (here `lang="ts"` → the slice is TS the bundler already
  handles). The block's **value flows back to scrml** with the JS-host boundary handling await/null per §13180/§42.9 — so
  `const out = _={ await … }=` yields the resolved string with no source-level `await`.
- **Capture:** foreign code needs to read the enclosing scrml locals (`t.prompt`, `path`). Define the capture rule (the spike
  assumes lexical capture of in-scope identifiers).

### (B) library-mode `?{}` db-injection — the co-requisite (S5 gap)
- A standalone compiled scrml program (`compile` → JS, run with `bun dispatch.js` / on `/loop`) must run `?{}` against a real
  `bun:sqlite` handle for `./flogence.db`. Per the S5 finding, library-mode `?{}` db-connection injection is half-staged
  (§44.7.1 W5a/W5b) and the emit targets `Bun.SQL` not the harness's `bun:sqlite`. **Please confirm the current status** — if
  it's since landed, (B) is free and only (A) remains.
- (If (B) is far off: the in-app fallback — a `_{}` server fn in `app.scrml`, which already has `<program db>` context — needs
  only (A). flogence prefers the standalone script, but will take whichever unblocks first.)

## Acceptance criteria (the conformance target)

`scripts/dispatch.ts` (flogence repo) is the reference. Acceptance = port it to `dispatch.scrml` and reproduce, against the
live `flogence.db`:
1. Compiles green (`_{}` recognized in logic, no E-CODEGEN-INVALID-JS).
2. `?{}` reads the pending `fsp_task` rows and writes results back (library-mode db).
3. The `_{}` block spawns a real `claude -p` and its stdout flows into the scrml `result`.
4. End-to-end: queue a task (`state='working'`, a prompt) → run `bun dispatch.js` → `fsp_task.result` = the agent output,
   `state='completed'`, a `disp` delta appended. (We verified this exact round-trip with the `.ts` version — result `DISPATCHOK`.)

## The boundary — INTENTIONALLY RETIRED (heads-up, not an ask)

The S199 boundary — *"scrml models + emits intent; the harness drives instances; scrml cannot launch/prompt a Claude
instance"* — is being **retired** on flogence's side (user decision, 2026-06-23). It was always a conservatism, not a scrml
limit (cf. the `scrml-server-envelope` finding; the FSP T3 reframe). `_{}` is the mechanism that dissolves it: with foreign
code, **scrml itself can drive instances**. This requirements note IS that retirement made concrete. No action needed from
scrml beyond the two primitives — flagging it so the proving ground's own framing can follow if useful.

## Codegen hook map (where this lands, for orientation)

- **Block-splitter / Stage-1:** extend the `_`+level-mark+`{` opener recognition to Logic-parent context (the S108 gate
  currently admits it only in markup; Q-BUG4-OPEN-1 deferred extending to `_{`). This is the spike's blocker.
- **TAB / Stage-3:** the `ForeignBlock` AST node already specced (§23, ~line 15576) — give it a codegen consumer.
- **CG:** emit the verbatim slice in expression/statement position with the value-flow + JS-host boundary (§13180); resolve
  `lang=` per §23.5.
- **Library-mode db:** §44.7.1 W5a/W5b — the `bun:sqlite` injection path for standalone `compile`d programs.

## Open questions for scrml's PA

1. **Locus:** is `_{}` intended to be valid in a Logic context (server-fn body), or markup-only? The dispatcher needs it in
   logic. If markup-only by design, what's the canonical way to call foreign code from a server fn?
2. **Value-flow + capture:** does `_{}` return a value to its enclosing scrml expression (`const x = _{…}=`)? Lexical capture
   of in-scope scrml locals into the foreign slice — supported, or must values be passed explicitly?
3. **library-mode db (B):** current status of §44.7.1 W5a/W5b — landed, partial, or not started?
4. **Scope of (A):** is full `lang=` toolchain resolution (§23.5, arbitrary languages) in scope, or can a first cut target
   just `lang="ts"`/`"js"` (which the bundler already handles) — enough to unblock the dispatcher?
5. Any reason NOT to retire the "scrml can't drive instances" boundary that we're missing? (We think it was always
   conservative; sanity-check welcome.)

— flogence
