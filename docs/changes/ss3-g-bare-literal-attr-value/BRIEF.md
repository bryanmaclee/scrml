# BRIEF — ss3 item3 `g-bare-literal-attr-value`

**Dispatched by:** sPA ss3 · **Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Land target:** agent commits on its own worktree branch; sPA file-deltas onto `spa/ss3`.
**Single file:** `compiler/src/type-system.ts` (the `visitAttr` function, ~:10687).

## The bug (R26-reproduced on real source a99246e2)

A bare numeric / boolean literal value on a spec-typed STRUCTURAL attribute false-fires
**E-SCOPE-001**. The block-splitter parses a bare literal attribute value (`interval=1000`,
`running=false`, `delay=500`) as a `variable-ref` whose `name` IS the literal text ("1000"),
so `visitAttr`'s scope lookup misses and fires "Unquoted identifier `1000` cannot be resolved."

These are SPEC-CANONICAL forms:
- §6.7.5 `<timer>`: `interval-attr ::= 'interval=' integer-literal`; `running-attr ::= 'running=' '@' identifier | 'running=' boolean-literal`
- §6.7.6 `<poll>`: same `interval` + `running`.
- `<timeout>`: `delay-attr ::= 'delay=' integer-literal` (SHALL NOT be reactive).

The existing S186 fix (type-system.ts:10693-10704) exempts ONLY `reconnect` / `channel-reconnect`
(§38.3) — unconditionally returning before the scope check. This item extends that exemption to
the timer/poll/timeout siblings.

### Confirmed broken (reproduced, well-formed usage):
- `<timer interval=1000 running=@running>...</>` → E-SCOPE-001 on `1000`
- `<poll id="p" interval=5000>${...}</>` → E-SCOPE-001 on `5000`
- `<timer interval=2000 running=false/>` → E-SCOPE-001 on `2000` AND on `false` (the latter ALSO
  correctly fires W-LIFECYCLE-007 in a separate pass — leave that warning intact)
- `<timeout delay=500>...</>` → E-SCOPE-001 on `500`

### NOT broken (do NOT add): `debounced=`/`throttled=` (§6.13) — these sit on STATE-DECL tags and
route through the decl scanner, not visitAttr; verified no false-fire.

## The fix (value-shape-aware — NOT an unconditional attr-name skip)

CRITICAL: `running=@var` (reactive) and `interval=@ms` MUST still scope-check the `@var` (so a typo
`running=@bogus` is still caught). So exempt ONLY the bare-literal SHAPE, not the attr name wholesale.
And a bare literal on a GENERIC HTML attr (`<input value=42>`) MUST still error (existing behavior —
there is a test/comment asserting this).

Replace the unconditional `if (attr.name === "reconnect" || attr.name === "channel-reconnect") return;`
(:10704) with a value-aware exemption inside the `if (value.kind === "variable-ref")` branch (after
`name` is computed, before/around the scope lookup at ~:10743):

```ts
// §6.7.5/§6.7.6/§timeout/§38.3 — spec-typed structural attributes whose canonical
// value is a BARE numeric / boolean literal. The BS parses a bare literal attr-value
// as a variable-ref named by the literal text, which would false-fire E-SCOPE-001.
// Exempt ONLY the bare-literal shape: a @-reactive value (running=@on, interval=@ms)
// still scope-checks, and a bare literal on a GENERIC attr (<input value=42>) still errors.
const SPEC_BARE_LITERAL_ATTRS = new Set([
  "reconnect", "channel-reconnect",  // §38.3 / §38.6.2 (S186)
  "interval", "running",             // §6.7.5 / §6.7.6 <timer>/<poll>
  "delay",                           // <timeout delay=N>
]);
// (inside the variable-ref branch, after const name = ...)
if (SPEC_BARE_LITERAL_ATTRS.has(attr.name as string) &&
    (/^-?\d/.test(name) || name === "true" || name === "false")) {
  return;  // canonical bare numeric/duration/boolean literal — not an identifier
}
```

`/^-?\d/` also covers duration literals (`500ms`, `2s`) since they start with a digit.

NOTE on `reconnect`: moving it from the unconditional skip to the value-aware shape means
`reconnect=@var` will now SCOPE-CHECK (an improvement — catches typos). If an existing test LOCKS the
old unconditional-skip behavior for a non-bare-literal reconnect value, do NOT silently preserve it —
report it to the sPA (it may be a test locking spec-divergent behavior, per the read-SPEC-at-session-start
doctrine). If the test is legitimate, keep `reconnect`/`channel-reconnect` on the unconditional path and
apply the value-aware shape only to `interval`/`running`/`delay`.

## Investigate (bounded): `after=` on `<onTimeout>` / `<onIdle>`

`after=DURATION` (§51.0.M/§51.0.R) is documented as handled by a DEDICATED walker (see the comment at
type-system.ts:10699-10700), so it should NOT need the allowlist. BUT a malformed-engine reproducer
showed `after=500ms` reaching visitAttr and false-firing. Write a WELL-FORMED `<state engine>` +
`<onTimeout after=500ms to=.Variant/>` reproducer (get the engine/onTimeout syntax right per §51.0.M —
`to=.Variant` is the form; check §51 worked examples). If `after=` false-fires E-SCOPE-001 in well-formed
usage, add `after` to the allowlist (value-aware). If the dedicated walker handles it correctly, leave it
out and note that in progress.md.

## Verify (R26 — empirical)
- Recompile the 4 confirmed reproducers (recreate them): NO E-SCOPE-001 on the bare-literal values;
  the `running=false` W-LIFECYCLE-007 warning still fires.
- Negative checks (must STILL error): `<input value=42>` → E-SCOPE-001; `<timer interval=@bogus>` (undeclared)
  → E-SCOPE-001; `<timer running=@bogus>` (undeclared) → E-SCOPE-001.
- Full `bun run test` (incl. browser) GREEN. Report before/after counts. If any existing test changes
  outcome, report which + why before declaring done.

## Mandatory dispatch blocks

**F4 startup-verification (FIRST):** `pwd` + `git rev-parse --abbrev-ref HEAD` — confirm you are in YOUR
isolated worktree, NOT `/home/bryan-maclee/scrmlMaster/scrml` (main) and NOT `../scrml-spa-ss3`. If
`node_modules` is absent: `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` and
`ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`.

**Path discipline (S88/S99/S126):** all writes use YOUR worktree-absolute paths; NEVER a main path; NEVER
`cd` into main. `git status` after each step — only `type-system.ts` (+ a test file) should change.

**Commit discipline (S83/S113/S164):** commit after the fix + after the test (coupled code+test = ONE
commit). WIP commits expected. `git status` clean before DONE. NEVER `--no-verify`. Append timestamped
lines to `docs/changes/ss3-g-bare-literal-attr-value/progress.md`. Report branch + final SHA + changed files.

**Scope guard:** stay in `type-system.ts` (visitAttr) + a focused test. Do NOT touch the block-splitter /
ast-builder (the upstream "parse bare literal as a literal node, not a variable-ref" fix is ss4 territory —
out of scope). If the fix wants to spill outside type-system.ts, STOP and report.
