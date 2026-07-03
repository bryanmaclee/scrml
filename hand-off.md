# scrml — Session 235 (OPEN)

**Date:** 2026-07-02. **Profile:** A — FULL (booted via `/boot`; full expert reads — pa-scrml.md contract + pa-profile-bryan + SPEC-INDEX + master-list §0 + user-voice S229–234 + known-gaps §0 + PRIMER §1–§13.7). Prior close: S234 (`hand-off-237.md`). Register carried in: **KEEP DRIVING / S219 PRIMARY-GOAL (finish the project) / partner-mode**.

## 🚦 STATE (mid-session — SSR arc complete + pushed)
- **git:** all S235 work pushed, coherence **0/0**. SSR arc: D2 `f1694f63` + D3 `fc726212` (+ session bookkeeping). scrml-support: uncommitted resolver design-insight edit (rides a future wrap).
- **Board:** v0.7.1 · **HIGH 0 · MED 8 · LOW 12 · Nominal 7** (`g-tier1-ssr-prerender` RESOLVED → MED 8; `g-ssr-render-subset-widen` filed → LOW 12).
- **Inbox:** empty.
- **Maps:** refreshed to 2fb2bf1f (project-mapper S235); ~2 commits behind (D2+D3) — re-run at wrap (WARN-only).
- **Digest:** booted off authoritative reads.

## ✅ SSR A-TERMINUS COMPLETE — V1 SSR DONE (S235)
The last V1-required feature shipped end-to-end + pushed:
- **D1** (S234 `d05cf40c`) — server-side markup render: `<each>` over a server-authority cell renders rows into first-paint HTML, keyed `data-scrml-key`, §14.8.9-redacted.
- **D2** (S235 `f1694f63`) — DOM-adoption hydration: client adopts the server rows in place (no wipe-rebuild double-render), fully interactive. R26 happy-dom 6/33 (`replaceChildren` spy 0 / `replaceChild` 2 = no-wipe proof). **Recovered from a ConnectionRefused disconnect** (agent finished+committed clean; PA independently verified).
- **D3** (S235 `fc726212`) — retired `W-AUTH-002`; SPEC §52.8 impl-status; `g-tier1-ssr-prerender` RESOLVED.
- **Residual (tracked, LOW):** `g-ssr-render-subset-widen` — unsupported each shapes (`if=`/nested-each/component-rows/computed-interps) fall back to client-render. Post-V1 coverage-widening; the common list shape is fully covered.

## 🎯 NEXT PRIORITY (drive the whole board — S219; no blocking Qs)
Candidate threads (pick per steer):
- **Road-B self-host-v2 slice-4** — typed BracketStack/ErrorRecovery threading + cooked-decode precision (lexer refinements); then the PARSER wave (F1/emit-library fix-vs-continue call comes due).
- **Dogfood typer gaps** — F4 `g-typer-bare-variant-non-return-ambiguous` · F5/F8 `g-typer-hostmethod-return-asis-and-anon-struct-poison`.
- **D1/D4 codegen follow-on** — version-surface wiring (`chunks.json` `language` field / `scrml.toml [language]` pre-parse read / `expected.json` schema split).
- **`g-ssr-render-subset-widen`** — widen SSR coverage (simple static `if=`/`show=` next).
- MED 8 / LOW 12 backlog.

## 🔭 OTHER OPEN THREADS (drive the whole board — S219)
- **Road-B self-host-v2 compiler build** — the lexer is TOKEN-COMPLETE (`compiler/self-host-v2/`, 119/119 token-diff-green vs impl#1). Next: **slice-4** (typed BracketStack/ErrorRecovery threading + precise cooked-decode — refinements, NOT new token classes), then the **PARSER wave** (where F1/emit-library becomes load-bearing — the fix-vs-continue decision comes due).
- **F1 (strategic Road-B blocker)** `g-library-mode-no-typed-payload-match` — `emit-library.ts` is a shallow regex-transform that can't lower typed-payloads + `match`; lean = DEFER the fix until the parser wave (user may pull forward).
- **Dogfood typer gaps** (from the lexer build): F4 `g-typer-bare-variant-non-return-ambiguous` · F5/F8 `g-typer-hostmethod-return-asis-and-anon-struct-poison` · F7 (LOW benign) · F9 `g-string-literal-dollar-brace-interp-no-literal-escape` (LOW SPEC-OQ). The match-arm-drop family (F2/F3/F6) was FIXED S234.
- **D1/D4 codegen follow-on** — the version-surface wiring (`chunks.json` `language` field / `scrml.toml [language]` pre-parse read / `expected.json` schema split); Nominal/spec-ahead is fine for now.
- MED/LOW backlog (9/11) + Nominal features — drive per S219.

## 🧾 OWED at open (carry from S234 wrap)
- **Maps refresh** (project-mapper — ~12 commits stale).
- **master-list §0 detailed refresh** (still v0.2.0-dashboard framed).
- scrml-support resolver design-insight edit is committed content-wise but the working-tree edit rides a future wrap.

## pa.md directives in force
R1–R5 · Profile A · commit `timeout:600000` · S226 landing-concurrency (3-way-merge shared files) · S219 PRIMARY-GOAL/orchestrate-don't-grind · S215 adversarial-verify + 10× sample · S138 R26 (bidirectional) · S147 coherence (rev-list divergence + branch-tip==FINAL_SHA) · S136 BRIEF archival · S88/S99/S126 path-discipline (Bash-edit on worktree-abs paths, no `cd` into main) · S164 background-commit-race (foreground when SHA needed next).

## Tags
#session-235 #open #keep-driving #ssr-a-terminus-next #road-b-lexer-token-complete #v1-language-1.0 #board-high0-med9-low11-nom7
