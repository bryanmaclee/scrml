# progress — g-bare-literal-attr-value (sPA ss3 item 3)

Bug: bare numeric/boolean literal on spec-typed STRUCTURAL attr (interval=/running=/delay=)
false-fires E-SCOPE-001 because the block-splitter parses the bare literal as a
variable-ref whose name IS the literal text. Existing S186 fix exempts only
reconnect/channel-reconnect unconditionally; extend value-aware to the timer/poll/timeout
siblings (§6.7.5 / §6.7.6 / §6.7.8).

## 2026-06-19 — F4 startup + scope-lock
- Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a6eb2c2fd9ba6086b
  branch worktree-agent-a6eb2c2fd9ba6086b (PRE-EXISTING stale worktree from s169/ss1).
  NOTE: carries unrelated WIP — committed s169 emit-expr.ts §59.8 work + an UNCOMMITTED
  emit-expr.ts diff. Both OUT OF SCOPE. My commits use explicit pathspecs (type-system.ts +
  test only); I leave emit-expr.ts untouched. merge-base==main tip a99246e2 (base NOT stale).
- type-system.ts identical to main (git diff main..HEAD -- type-system.ts empty). Good base.
- node_modules symlinked, bun 1.3.13 resolves.
- SPEC confirmed: §6.7.5 interval=integer-literal, running=@id|bool-literal (W-LIFECYCLE-007
  on running=false literal — separate pass, leave intact); §6.7.6 <poll> same; §6.7.8
  <timeout> delay=integer-literal (no running attr); §51.0.M <onTimeout after=DURATION>
  canonical example uses after=30s (digit-leading duration).
- Existing reconnect tests (channel.test.js §27) use only bare-int + quoted; NONE use
  reconnect=@var. No test locks the old unconditional reconnect-skip for a reactive value
  → safe to make reconnect value-aware (improvement: reconnect=@bogus now caught).

## 2026-06-19 — R26 reproduction CONFIRMED (real source, pre-fix)
- r1 <timer interval=1000 running=@running>      → E-SCOPE-001 on `1000`  [BUG]
- r2 <poll id="p" interval=5000>                 → E-SCOPE-001 on `5000`  [BUG]
- r3 <timer interval=2000 running=false/>        → E-SCOPE-001 on `2000` AND `false`; W-LIFECYCLE-007 ALSO fires on `false` (correct) [BUG]
- r4 <timeout delay=500>                         → E-SCOPE-001 on `500`   [BUG]

## 2026-06-19 — after= investigation (bounded) — RESULT: no allowlist entry needed
- r5b WELL-FORMED <engine for=LoadPhase initial=.Idle> + <onTimeout after=500ms to=.TimedOut/>
  compiles CLEAN (2 info-warnings, no E-SCOPE-001). after= IS handled by the dedicated
  walker; `after` NOT added to SPEC_BARE_LITERAL_ATTRS.
- SIDE FINDING (OUT OF SCOPE, pre-existing on clean main): the DERIVED-engine form
  `<engine for=@phase ...>` crashes the compiler with `autoDeriveEngineVarName is not defined`.
  Reproduces on clean main (not introduced here). Filed as deferred — not g-bare-literal-attr-value.
