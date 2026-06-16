# PA ↔ vPA delta-log (flogeance — scrmlTS adaptation)

**Ratified S199 (2026-06-16).** The fine-grained PA→vPA absorption stream. The vPA reads
`[last-absorbed+1 .. now]` on a poke to stay current WITHOUT re-reading the fat hand-off or
cold-reading the docs. Append-only. Migrates into the `flogeance` repo when it's built; lives here now
for the 2-manual-terminal immediate-benefit mode.

**Format:** one block per entry —
```
[seq] kind  · what-happened  · → pointer  · (vpa: directive)
```
- **kind** ∈ `rule` (user decision) · `disp` (agent fired) · `land` (commit landed) · `find` (gap/bug/finding) · `state` (board/test/sync delta) · `baton` (handoff)
- **pointer** = SHA / file:line / gap-id / doc / agent-id (the vPA pulls detail only if needed)
- **(vpa: …)** = optional; the ONLY field that asks the vPA to do/note something (hold · sandbox a debate · take ownership of agent X · absorb-and-stand-by). Most entries omit it.

**Cadence:** the PA appends an entry at the moments it would write a hand-off bullet — a ruling, a
dispatch, a landing, a finding, a state delta — NOT per tool-call. The vPA absorbs the batch
since-last-poke at sparse checkpoints (prompt-cache TTL → don't poke constantly; keep vPA context lean).

**Relationship to the other logs:** distinct from user-voice (verbatim user statements, durable) and
the changelog (per-session landings, coarse). This stream is ephemeral-per-baton-cycle; it does NOT
replace the wrap hand-off (kept for cold-start safety + audit) — it replaces the vPA's *dependence* on it.

**Single-writer rule:** only the LIVE PA appends. The vPA is read-only on this file until the baton-pass.

---

## Session 199 — 2026-06-16

```
[1] rule  · fire E-leg first; flogeance = vPA repo, built in scrml, scrmlTS consumes      · → user-voice S199
[2] disp  · E-leg re-dispatch (server=@source server-authoritative engine, Phase 0-4)     · → agent a3eafd6196921f173, docs/changes/engine-server-source-hydration-eleg-2026-06-16/BRIEF.md
[3] rule  · repo rename scrml→scrml-native, scrmlTS→scrml; deferred to S200               · → hand-off §QUEUED-S200
[4] find  · E-leg agent crashed (API 500) after Phase 0+1 committed — clean, no loss/leak · → branch worktree-agent-a3eafd6196921f173 @ c8c14311  · (vpa: hold — PA deciding finish path)
[5] rule  · delta-log format ratified: raw-stream-only, no separate vPA digest            · → this file
[6] state · scrmlTS 0/0 clean; E-leg Phase 0+1 on branch c8c14311 (Phase 2-4 pending); maps stale 471cbb34 (owed); board HIGH 2 · MED 10 · LOW 20 · → master-list §0
[7] rule  · PA-direct E-leg finish AUTHORIZED (crashes are dispatch-path not PA-loop; Phase 2-4 mapped) · → user "PA-direct, go"  · (vpa: PA owns the E-leg build now)
[8] land  · E-leg LANDED + PUSHED `2e3aa6a4` (origin 13c3c978..2e3aa6a4; pre-push 24372/0 + TodoMVC PASS) — `<engine server=@source>` server-auth hydration; +18 tests; R26 verified (bare+field-access) · → commit 2e3aa6a4
[9] rule  · vPA role directive WRITTEN — full-start-then-optimize; at scrml-support/vpa-scrmlTS.md (sibling to pa.md; migrates to flogeance) · → scrml-support/vpa-scrmlTS.md  · (vpa: this IS your boot doc — 2-terminal mode is now runnable)
[10] rule · PA-side baton procedure added (S199 addendum) — delta-log = PA single-writer responsibility; baton vs cold-wrap; 5-step handoff · → pa-scrmlTS.md §"S199 addendum — vPA baton-pass (PA side)"
[11] land · vPA boot phrase = "read vpa.md and boot" (NEW scrmlTS/vpa.md pointer, NOT "read pa.md…"); flogeance repo SCAFFOLDED (git init + project pa.md + README + docs/ideas.md + dropbox; initial commit; private, no remote yet) · → scrmlTS/vpa.md, flogeance/  · (vpa: flogeance is where the user discusses remaining ideas)
[12] rule · vPA boot hardened: delta-log is the FRESHEST layer, WINS over hand-off/master-list on conflict (the hand-off only rewrites at wrap) · → scrml-support/vpa-scrmlTS.md boot §
[13] state · scrml work resumed (S199): HOS `<engine>` showcase BUILDING — dog-foods the E-leg on trucking hos.scrml (engine renders current-state badge + server=@currentDriver.current_status hydration; rule= = HOS transitions; buttons read @driverStatus). compile+R26 green; full suite running (within-node re-baseline if hos fixture over-budget) · → examples/23-trucking-dispatch/pages/driver/hos.scrml + components/driver-card.scrml
[14] land · HOS engine showcase LANDED + PUSHED `4f6aa2e8` (origin 2e3aa6a4..4f6aa2e8; pre-push 24372/0) — server=@source on trucking hos.scrml; engine renders badge + hydrates @driverStatus; baselines re-based (within-node hos; trucking +W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE:1) · → commit 4f6aa2e8  · (vpa: E-leg→showcase arc CLOSED)
[15] land · gap-184 a+b LANDED `d6608255` (NOT pushed) — kickstarter §11.1 flagship engine recipe MODERNIZED (bare-body + typed payload Loaded(rows:Row[]) + <each>; compiles clean) + filed g-colon-shorthand-markup-misparse (MED, BS `:`-shorthand-markup mis-parse → misleading E-STRUCTURAL); state regen +1 MED; pre-commit 17219/0 · → commit d6608255  · (vpa: remaining high-value scrml = DELICATE compiler fixes [the BS bug · g-markup-value HIGH] — fresh-arc-shaped per repeated-crash+S140)
[16] find · bounded `<each>` corpus sweep (board.scrml) hit a 2nd compiler bug → filed g-each-component-body-invalid-js (HIGH): `<each>` over a COMPONENT-list (`<LoadCard>`) loses component scope (E-SCOPE-001) + emits invalid JS (E-CODEGEN-INVALID-JS); board conversion REVERTED (blocked); plain-HTML `<each>` works. · → known-gaps g-each-component-body-invalid-js
[17] baton · HANDING OFF — thin baton-pass (warm vPA takes the scrmlTS PA role; FIRST live baton). HEAD `76d03aa9`; coherence 0/2 UNPUSHED (gap-184 `d6608255` + each-gap `76d03aa9`). **vPA = take scrmlTS PA authority + run the 8-step WRAP WARM:** maps refresh OWED (471cbb34→76d03aa9, incl. E-leg+HOS+§11.1 files); changelog S199 block; master-list counts; fat hand-off (cold-safety); commit session-state (hand-off/delta-log/vpa.md/handoff-203 rotation); PUSH scrmlTS + scrml-support (vpa-scrmlTS.md · pa.md S199 baton addendum · user-voice S199) [flogeance: committed local `d846fec`, NO remote — user adds]. **THEN S200 = repo rename** (scrml→scrml-native · scrmlTS→scrml) per hand-off §QUEUED-S200. **3 bugs filed for fresh BS/codegen arcs:** g-colon-shorthand-markup-misparse (MED) · g-each-component-body-invalid-js (HIGH) · g-markup-value (HIGH, pre-existing). **flogeance REFRAMED → MPA** (Master PA Orchestrator) + 6-DD slate in flogeance/docs/ideas.md (vPA-authored). You're WARM — no cold start. **Outgoing PA stands down.** · → HEAD 76d03aa9 + this delta-log
[18] land · BATON ABSORBED — successor (warm vPA) assumed PA role + ran S199 wrap WARM: maps refresh 471cbb34→76d03aa9 (project-mapper 6c); changelog S199 + hand-off S199-CLOSE + state-regen PASS + 6b worktree-clean (agent-a3eafd6196921f173 subsumed by 2e3aa6a4); committed+pushed scrmlTS (gap-184 d6608255 + each-gap 76d03aa9 + wrap) & scrml-support (NEW vpa-scrmlTS.md + pa.md S199 baton-addendum + user-voice S199). **FIRST live baton-pass COMPLETE.** · → wrap(s199) · (vpa: S199 CLOSED — next session = S200 repo rename; flogeance/MPA 6-DD slate open in flogeance/docs/ideas.md)
```
