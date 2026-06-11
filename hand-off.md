# scrmlTS — Session 183 (CLOSE)

**Date:** 2026-06-11
**Previous:** `handOffs/hand-off-187.md` (= S182 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-188.md` at next OPEN.
**Profile:** opened **A (FULL)** (`"pa.md start full s"` → default A). Full session-start chain incl. the MANDATORY full PRIMER read (all 1464 lines) + full SPEC-INDEX (395) + master-list §0 + user-voice tail S174-S182.
**Shape:** 2 user directives → 4 landed arcs + an 8-round dog-food sweep. Directive 1: *"run the maps refresh, then formfor-unimported fix."* Directive 2: *"file both, dispatch the tailwind fix, keep dogfooding."*

## 🟢 S183 CLOSE — maps refresh · formfor-unimported hard-error · fn/pure canonicity reframe · tailwind dynamic-class fix · 8-round dog-food sweep

### State as of close
- **HEAD:** `1734b81b` + the wrap commit + maps 6c commit on top. **PUSHED** (user "wrap and push" → step 7 pushed scrmlTS + scrml-support). If origin ≠ HEAD when you read this, the push didn't complete — verify + push.
- **Tests:** full suite **~23,855 / 0 fail / 221 skip / 1 todo** (S182 23,837 → +6 formfor +12 tailwind). Pre-commit subset live via `bun scripts/state.ts`.
- **known-gaps:** **HIGH 0 · MED 6 · LOW 12** (g-formfor-unimported-silent RESOLVED, g-tailwind-dynamic-class-prefix RESOLVED; g-lifecycle-struct-field-const-notfire NEW/candidate). `bun scripts/state.ts` for live counts.
- **Version:** v0.7.0, no cut. **stdlib:** 18 modules.
- **Maps:** refreshed 6c to watermark `1734b81b` (project-mapper incremental — formfor codes into error.map + tailwind scanner into structure.map). Was refreshed twice this session (mid: `8307ea7a` engine-effect→065fa06c; close: 6c→1734b81b).
- **Inbox:** empty. **Hooks:** config B (pre-commit + post-commit + pre-push). **Worktrees:** ONLY main (3 agent worktrees cleaned this session: formfor, reframe, tailwind).

### The S183 landings (in order)
1. **`8307ea7a` — maps 6c (mid-session)** — reconciled the S182 engine-effect diagnostics (E-ENGINE-EFFECT-NOT-INTERPOLATED + dup-gate) into error/structure/test maps; watermark 5a51c1ca→065fa06c.
2. **`10d94a29` — formfor/tablefor unimported → hard ERROR** (severity ruled S183 AskUserQuestion). NEW `E-FORMFOR-NOT-IMPORTED` + `E-TABLEFOR-NOT-IMPORTED` (both Error) — a `<formFor>`/`<tableFor>` markup element present without its `scrml:data` import was silently forwarded as a literal tag; now a hard error. Additive `else`-arm scan `scanForUnimportedTypeDataElement` in type-system.ts mirroring the expansion walker; happy path byte-unchanged. SPEC §41.14.1/§41.16.1 + §34. **Empirical correction:** schemaFor does NOT generalize (call form already hard-errors via E-SCOPE-001) — only the 2 markup members. The dispatch caught a test fixture (`builtin-types-date-timestamp.test.js`) that was LOCKING the silent-pass bug → coupled import-fix. +6 tests. PA-independent R26. Gap RESOLVED `a2878626`.
3. **`5d502d59` — fn/pure canonicity reframe** (full reframe ruled S183 AskUserQuestion option C). Closed the S176 deprecate-pure PROSE-currency tail — 15 derived sites the S176 amendment missed (SPEC §34 I-FN-PROMOTABLE row / §48.11 / §48.13 / §33.6 / §5643 / §16599 / §22609 / §22613 / §23309 / §56-prose + the I-FN-PROMOTABLE lint message + kickstarter §1929 + comments + 3 test docstrings). Propagated the §48.11-head framing: **`fn` = THE canonical pure form; `pure function` = deprecated synonym (identical semantics, W-PURE-DEPRECATED)**. Killed the kickstarter "reach for the explicit `pure function` form" + the dead-W-PURE-REDUNDANT teaching. INVARIANTS held: semantic-equivalence fact preserved, **CONF-S32-004 green unchanged**, §33 legacy body untouched, **ZERO behavior change** (prose + 1 message string). grep "ergonomic shorthand for pure function" = 0.
4. **`88a3ac48` — tailwind dynamic-class false-positive fix.** `W-TAILWIND-001` + `W-TAILWIND-UNRECOGNIZED-CLASS` no longer false-fire on the static prefix of a dynamic class `class="prefix-${expr}"` (e.g. `driver-`, `badge-`, `hover:bg-`). `findInterpolationRanges` + `tokenTouchesInterpolation` skip tokens glued to/overlapping `${}`, applied to BOTH scan loops (the agent confirmed W-TAILWIND-001 also mis-fired). `maskInterpolations` refactored to delegate to the shared range helper (masked-string return preserved). +SPEC §26.5.1. +12 tests. PA-independent verify: dyn=0, mix=0, static `flexx`=1 (no over-suppression). Gap RESOLVED `1734b81b`.

### The 8-round dog-food sweep (S179 waiting-time directive)
Found BOTH bugs above (rounds 1 + 4), filed 1 candidate (round 5), validated 6 surfaces:
- R1 scalar stdlib (S176) → ✅ + found I-FN-PROMOTABLE stale string (→ reframe arc).
- R2 engine Tier-2 + `.Quoted(amount,ref)` payload binding + scalar → ✅ (payload renders, valid JS). Minor: W-ENGINE-SELF-WRITE-DETECTED fires on bare-literal-variant transition writes in free action fns (info-level, spec-correct conservatism; skips payload-construction writes).
- R3 set-algebra (S170) → ✅ value-correct for structs incl. field-reordered (§59.5 canonical codec order-independent).
- R4 `<each>` → ✅ core (nested, both-level `<empty>`, `:`-shorthand, `as`-alias, per-item interpolation-bearing attr) + found Tailwind false-positive (→ tailwind arc).
- R5 lifecycle `(not to T)` → ❓ candidate (g-lifecycle-struct-field-const-notfire).
- R6 errorBoundary (§19.6) → ✅ (variant renders + fallback + §19.6.8 host-backstop).
- R7 refinement types (§53) → ✅ (E-CONTRACT-001 static-zone fires).
- R8 channels (§38) → ✅ (WS endpoint /_scrml_ws/chat + broadcast + client/server emit).

## Open questions to surface immediately (next session)
1. **`g-lifecycle-struct-field-const-notfire` (LOW, NEW S183 CANDIDATE)** — the PRIMER §6.5 verbatim struct-field `(not to string)` pre-transition example (`const u: User = {...passwordHash: not}; const leak = u.passwordHash`) did NOT fire `E-TYPE-001`, despite §5-Landing-1 (SHIPPED S130 `1feaedc9` +25 tests) stating "per-access transition-state tracking for **struct fields**" is its scope. **NOT yet a confirmed bug** — needs a focused gate-logic check (does E-TYPE-001 fire on Landing-1's own test form vs the primer's top-level `const u: User = {...}` construction + member-read?). Could be a sub-path the tracker doesn't observe, or a `const`-binding-form subtlety. Cross-ref known-gaps §5 + my round-5 repro `/tmp/s183-dogfood5/lc-bad.scrml` (gone; re-derive from PRIMER §6.5).
2. **DG class-attr-consumer candidate (incidental, noted in g-tailwind RESOLVED entry)** — after the tailwind fix, `class="prefix-${@cell}"` now surfaces a spurious `E-DG-002` unused-`@cell` WARNING — the dependency graph doesn't count a class-attribute `${@cell}` interpolation as a render-consumer. Candidate DG seam (separate from the tailwind lint). Warning-level, non-fatal. Needs its own verify before filing/fixing.
3. **base-extraction replication (master-PA territory)** — `pa-base.md` v1 (`6601c05` scrml-support) exists; vendoring into giti/6nz + per-project overlays is cross-repo → master PA. Master-inbox notice sent S182. scrmlTS PA's OWN contract stays the untouched OG (S182 reframe).
4. **bug-75** — deferred (after-`>` engine `:`-shorthand E2E fails at BS; PRIMER §13.7-B18; LOW + deprecated-form-only).
5. **VERIFIED.md** — S180's 13 changed examples remain open re-verification (USER action).
6. **2B documentation deliverable** (DD1 close, S178) — credit the engine-singleton as the typed global reactive store; small additive SPEC/PRIMER note; placement TBD (§51.0.A vs §52). Bundles with the deferred Fork-3 immutability cross-ref (S174).

## CARRY-FORWARD QUEUE (cross-check live `@gap` + git log per verify-before-claim)
- **MED (6):** `r28-c2` (kickstarter currency) · `a5` (refinement-freeze) · `bug-1` (Tailwind preflight-blocked) · `bug-12-vkill` (engine-canon-blocked) · `bug-14` (MCP V0.D, §58-blocked) · `bug-17-l19` (L19 relax — HU DESIGN Q).
- **LOW (12):** `g-component-001-coverage` · `g-sql-row-protect-leak` · `g-sse-server-keyword` (KEEP-deferred) · `g-lifecycle-struct-field-const-notfire` (NEW S183 candidate) · `bug-18` · `bug-19-cite` (Rule-1 skip) · `bug-20` (blocked) · `bug-21`/`bug-22` (deferred) · `bug-75` (deferred) · `r28-2b` (broad blast) · `s169-ordered-unordered-build` (Nominal).
- **Big in-flight arc — native parser CHARTER B** (replace whole front-end: BS + Acorn + BPP): M1 lexer COMPLETE; M2.4 + MK2 next per `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md`. Cutover deferred (~v0.8; ~508 flip-failures need FRESH re-triage).
- **Untested dog-food surface (remaining):** §55 validators + auto-synth validity surface (compound-render-by-tag syntax was the blocker — resolve before dog-fooding); typed-SQL-row T3 flagship pattern (needs DB/server context); `<keyboard>`/`<mouse>`/`<gamepad>` (§36 sliver).

## pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b/6c/6d).
- Dispatch: S88 isolation:worktree explicit · F4 startup-verify · S90 CWD · S99/S126 Bash-edit + no-`cd` · S136 BRIEF.md archival (done all 3 dispatches) · S138 R26/empirical (PA dual-verified formfor) · S147 branch-leak coherence (clean each landing) · S164 bg-commit-race (held; read HEAD only post-finalize) · S180 waiting-time 3-tier (Tier-1 maint + Tier-3 dog-food drove the whole back half).
- **S183 process notes:** (a) **Agent-side-stale-view filter is LOAD-BEARING** — the tailwind branch (based pre-reframe) showed the reframe's files in its diff; file-delta'ing SPEC.md from it would have REVERTED the reframe. Pulled ONLY the agent's FILES_TOUCHED (S67 protocol). (b) Two concurrent worktree agents (reframe + tailwind) ran fine because their files were DISJOINT + the tailwind brief forbade SPEC.md (file-delta is whole-file-per-branch — two branches editing SPEC.md would clobber). (c) `--no-verify` slips: both the formfor + reframe agents self-caught + reverted `--no-verify` doc-commit slips; the PA landing commit re-runs the full gate regardless. (d) verify-before-claim paid off 3×: schemaFor-not-affected (formfor), the §14.12 lifecycle "candidate not bug" framing, the §26.5.1-only SPEC diff check.
- Memory live: `feedback_waiting_time_work_pattern` · `feedback_verify_before_claim` · `feedback_dont_preclassify_fix_as_surgical` (the I-FN-PRO survey: 14 sites not 3) · `feedback_signal_ruling_scope` (the W/E severity + reframe-scope forks) · `feedback_limit_primitives_not_godify` · `feedback_dont_soft_classify_bugs`.

## Tags
#session-183 #profile-a-full-start #maps-refreshed-2x #formfor-tablefor-unimported-error #fn-pure-canonicity-reframe #tailwind-dynamic-class-fix #dog-food-8-rounds #2-bugs-fixed #lifecycle-candidate-filed #dg-class-consumer-candidate #agent-side-stale-view-filter #wrapped #pushed
