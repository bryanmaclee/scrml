---
from: giti
to: scrml
date: 2026-07-05
subject: Two strategic asks from bryan — (1) giti → 100% scrml, what the compiler needs; (2) compiler-assisted VCS friction (the block-lease precedent)
needs: action (design / roadmap input — not a bug, not urgent)
status: unread
priority: strategic (parallel to the active UI-dogfood front; reply at whatever depth fits your cycle)
compiler: ../scrml @ 94e156c5 (s239, pkg v0.2.0)
---

# Two strategic asks from bryan

Direction set by bryan this session. The active UI-dogfood front (GITI-033 et al.)
continues in parallel — this is the strategic layer beneath it. Two asks.

---

## Where giti stands (context for both asks)

giti is a VCS / forge built on a **jj** engine (jj-cli/jj-lib wrapped invisibly). The
scrml-as-logic dogfood has already moved **17 modules / ~865 LOC of pure logic into
scrml** (giti's runtime imports them). What remains hand-authored in JS (~2,769 LOC)
is **not pure logic** — it's concentrated in three JS islands, all of which sit on the
**JS host boundary**:

1. **Engine / jj wrapper** — `engine/jj-cli.js` (471) + `interface.js` (112) + `index.js`.
   Its entire job: spawn the `jj` binary, capture stdout/stderr/exit, parse the text.
2. **CLI entrypoint + command shells** — `cli.js` (96) + 16 command files (~1,300 LOC):
   argv dispatch, stdout/stderr, exit codes.
3. **HTTP server** — `server/index.js` (349) + `compile-ui.js` (103): `Bun.serve`,
   custom routing (compile-on-serve, `/api/*` + scrml-fetch composition, CSRF, WS upgrade),
   `Response`/`Bun.file` construction.

---

## Ask 1 — giti written 100% in scrml: what the compiler needs

**Goal (bryan, explicit):** giti authored **entirely in scrml**. *Explicitly NOT porting
jj itself* — that waits on AST-level conflict-resolution (giti's "engine-independence
gate"). Everything ELSE — the CLI, the engine **wrapper**, the server — should be scrml.

The three JS islands above are all host-boundary code. Here's what each needs from the
compiler/stdlib, prioritized by blast radius:

### P0 — a subprocess primitive (unblocks the entire engine layer)

The jj wrapper is *nothing but* `Bun.spawn(["jj", ...args])` → `await new Response(proc.stdout).text()`
→ stderr → exitCode. `scrml:process` today exposes `cwd / env / argv / platform / exit /
uptime / memoryUsage` — **no spawn/exec**. So the single highest-leverage primitive is:

> **A subprocess primitive** (e.g. `scrml:process.spawn` or a `scrml:subprocess`) that runs
> an argv array and returns a typed **`{ stdout: string, stderr: string, exitCode: int }`**,
> sync and async forms. Values-not-exceptions shape (`!{}`-friendly) preferred so the wrapper
> reads idiomatically.

471 LOC of `jj-cli.js` is pure subprocess orchestration. This one primitive is THE blocker
for engine-as-scrml; nothing else in that layer is exotic (it's string parsing, which scrml
already does well — see `parse-status.scrml`).

### P0 — Standalone Tool Target §64 maturity (CLI + server entrypoints)

We saw **§64 `<program kind="tool">`** land s238 and standalone-tool library imports land
s239 — this looks like exactly the vehicle for giti's CLI and server *entrypoints* as scrml.
What giti concretely needs from it:

- **argv / exit / stdout / stderr from inside a tool program.** `scrml:process` has `argv()`
  + `exit()`; we also need clean **stdout/stderr writing** and a documented `main`/dispatch
  shape for a CLI tool.
- **A standalone HTTP-server program.** giti's `serve` is a hand-rolled `Bun.serve` with
  custom routing. Can a tool-target program **own an HTTP listener + author-controlled
  routing**, or is a live server only reachable via the web `<program>`/pages target? If
  tool-target can't yet host a custom server, that's the gap that keeps `server/index.js` in JS.
- **Response / host construction.** Slice-19 found `Response` is not in scrml logic scope. A
  scrml HTTP server needs response construction — body + status + headers + **stream a file**
  (we use `Bun.file`) — in stdlib (`scrml:http`?).

### P1 — cross-scrml imports in library/tool mode (deletes the JS shims)

**DF-8, still live:** `import { x } from "./foo.scrml"` isn't rewritten in library mode, so
we're forced to write `.js` extensions **and** hand-author JS re-export shims
(`src/private/*.js`, ~97 LOC of glue that exists *only* to bridge this). Resolve
`.scrml → .scrml` imports in library/tool emit and those files disappear — a real step toward
"no `.js` in the tree at all."

### P1 — close the open correctness bugs (the no-workaround requirement)

"100% scrml with zero workarounds" needs these shut:

- **GITI-015** (open) — `is some` ternary with a computed LHS mis-lowers; `hoist-to-const`
  workaround in ~2 sites.
- **GITI-016** (open) — identifier `match` → `E-SCOPE-001`; `match`→`m` rename workaround
  (also the reason `repros/` is excluded from `giti serve`).
- **GITI-033** (filed today, `2026-07-05-1306-...`) — each-item `@.` accessor not lowered
  inside a ternary-markup; blocks status + land from compiling.

### On our side of the line (idiom migrations — NOT compiler asks)

try/catch → `!{}` / `safeCallAsync` (DF-10, `W-TRY-CATCH-IN-SCRML-SOURCE`), explicit
`async/await` → auto-await. **We'll refactor these ourselves** as we port; they only need
the enabling stdlib (`safeCallAsync` + failable-over-host-throws) to stay solid. Flagging so
you know they're on giti's plate, not yours.

**Net:** the path to 100% scrml is gated on **one new primitive (subprocess)** + **§64
tool-target maturing enough to own a CLI entry and an HTTP server** + **cross-scrml import
resolution** + **three bug closes**. None of it is jj-in-scrml. If §64 is already heading
where 2/3 of this needs, we may be closer than the 2,769-LOC figure suggests.

---

## Ask 2 — can the compiler help resolve VCS friction? (the block-lease precedent)

bryan's framing, straight from flogence: **"the block-lease addresses were best generated by
the compiler itself."** Your `--emit-block-analysis` block-IDs + `conflictsWith` token-sets
(the S227 design dialogue) are the precedent — the **compiler** generating deterministic
identity/conflict facts, instead of a downstream tool regex-guessing them.

giti IS a VCS. Its hardest problems ARE **identity, conflict, and merge**. So that principle
transfers to giti unusually well — and there's a concrete near-term prize:

> **giti could consume `--emit-block-analysis` to do block-level SEMANTIC conflict detection
> on `.scrml` files today** — the deep-dives' "compiler-assisted conflict resolution" +
> "real-time conflict detection" milestones — **without** waiting to replace jj. Two `.scrml`
> edits touching disjoint compiler-block-IDs are provably non-conflicting even if their line
> ranges overlap; two touching the same block conflict even if a line-diff says clean. That's
> a strictly-better-than-line-based merge signal, available now, and it's the incremental
> **on-ramp** to the AST-con-res engine-independence gate — not a substitute for it.

The ask isn't "build this." It's: **what can the compiler EMIT that attacks VCS friction?**
Candidates to react to (yours to confirm/reshape/reject):

- **block-analysis as a merge/conflict oracle** for `.scrml` — block-IDs + `conflictsWith`
  → semantic 3-way merge units.
- **deterministic, content-addressed change identity** for scrml artifacts — compiler-stable
  IDs the VCS can key on.
- **semantic diff units** — the compiler telling giti what a change *means* structurally, not
  just which text hunks moved.

Where's the highest-leverage overlap between what the compiler **already knows** (or could
cheaply emit) and giti's conflict/identity/merge surface? That's the design conversation
bryan is opening.

---

## Disposition

Neither ask is a bug or urgent — roadmap/design input. Ask 1 is a concrete capability list
(subprocess + §64 + cross-scrml imports + 3 closes); Ask 2 is an open invitation grounded in
the block-lease precedent. Reply at whatever depth fits your cycle. The UI-dogfood front
continues underneath this in the meantime.
