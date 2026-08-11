# progress — §6.6.19 transitive server reach

Append-only. Timestamped. This file + the branch are the entire crash-recovery surface.

---

## 2026-08-11 — startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a17073292e367092e` (worktree, OK)
- `git rev-parse --show-toplevel` == pwd (OK)
- **DEVIATION FROM BRIEF, resolved:** the harness cut this worktree at `main` (`23ea2e5c`), NOT at
  `fix/derived-transitive-reach` @ `17b5849a`. `17b5849a` is a strict child of `23ea2e5c`
  (`git merge-base --is-ancestor 17b5849a HEAD` returned false; `fix/derived-transitive-reach` is
  main+1). Resolved with `git merge --ff-only fix/derived-transitive-reach` — a pure fast-forward,
  no content risk. Branch name stays the harness name `worktree-agent-a17073292e367092e`; PA lands
  by file-delta so the name does not matter.
- `bun install` OK (217 packages). `bun run pretest` OK (13 test samples -> samples/compilation-tests/dist/).
- Scratchpad: `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/b25a8ac0-1b30-4ff4-91f8-7347376e005a/scratchpad/dtr-fix/`

## Maps

- `.claude/maps/primary.map.md` read. **Load-bearing: invariant 50** (map line 22-28 + row 235).
  Confirms §12.2 Trigger 3 is per-FUNCTION and reaches no other position; the derived-cell half is
  closed by `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, #486) at `route-inference.ts:4429`; a
  mutable-cell INITIALISER and a MARKUP INTERPOLATION are still open and still leak at exit 0. That
  bounds this dispatch: the hop defect is in the derived position only, and I must not accidentally
  "fix" the two open positions as a side effect (separate rulings).
- Map stamp `616688ea`; HEAD is past it. Claims treated as hypotheses, verified against source below.

## BASELINE — reproducers compiled on this branch (compiler/src byte-identical to `main` at this point)

Sources in `…/scratchpad/dtr-fix/repro/`. Command: `bun compiler/bin/scrml.js compile <f> -o <dir>`.

| # | shape | exit | diagnostics | `.server.js`? | verdict |
|---|---|---|---|---|---|
| r1-direct | `const <h> = hashPassword(@pw)` | **1** | `E-DERIVED-SERVER-ONLY-REACH` | no | #500 working — MUST NOT REGRESS |
| r2-hop | `function doHash(p){return hashPassword(p)}` + `const <h> = doHash(@pw)` | **0** | none | **yes** | **DEFECT** |
| r3-sql-hop | `function countRows(){const r = ?{…}; return r.length}` + `const <c> = countRows()` | **0** | `W-DERIVED-001` only | **yes** | **DEFECT** |
| r4-multihop | `levelA`→`levelB`→`levelC`→`hashPassword` | **0** | none | **yes** | **DEFECT (3 hops)** |
| r5-cycle | `ping`↔`pong`, `pong` reaches `hashPassword` | **0** | none | **yes** | **DEFECT (through a cycle)** |
| r6-negative | pure-client `shout` | 0 | `I-FN-PROMOTABLE` | no | must STAY clean |
| r7-pure-cycle | pure-client `alpha`↔`beta` cycle | 0 | none | no | must STAY clean |

Emitted evidence (base):

- r2: `_scrml_cs_derived_declare("h", () => _scrml_fetch_doHash_3(_scrml_cs_reactive_get("pw")))`
  where `_scrml_fetch_doHash_3` is declared `async`. The derived cell's value IS the Promise.
- r4: `_scrml_levelA_5` and `_scrml_levelB_4` are BOTH emitted `async` (codegen's
  `scheduling.ts` transitive async coloring DID colour them) → same Promise-valued derived cell.
  **This is the load-bearing asymmetry: CODEGEN colours async transitively, ROUTE INFERENCE
  refuses only directly.** The two stages disagree about the same source.
- r3: a different lowering — `W-DERIVED-001` (no reactive deps) →
  `const c = _scrml_fetch_countRows_3();` — a plain `const` holding a Promise, no
  `derived_declare` at all. Same failure class, second emission route. Good: it proves the check
  must key on the AST decl, not on the emission shape.

### Incidental finding (OUT OF SCOPE — reported, not fixed)

My first r5 draft used `given k <= 0 { return hashPassword(p) }` inside a function body. It emitted
`if (k !== null && k !== undefined) {\n}` — **the block body, including the `return`, was dropped
entirely**, and `hashPassword` vanished from every artifact at exit 0. That may simply be me
misusing `given` (a presence check, not a general conditional) — but a misuse that silently
DELETES a `return` statement is still a silent statement-drop. Not chased; flagged here so it is
not lost. Reproducer text is in this progress entry, not on disk (r5 was rewritten).
