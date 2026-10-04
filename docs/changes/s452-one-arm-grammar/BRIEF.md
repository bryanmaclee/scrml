start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a3fa0b9ccdd17cf74

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ df6dad5ac.
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. Never write under /home/bryan-maclee/scrmlMaster/scrml/ outside your worktree; never `cd` into the main checkout. scrml-support (/home/bryan-maclee/scrmlMaster/scrml-support) is READ-ONLY for you.
3. NEVER `git stash`; NEVER `pkill -f`/`killall`.
4. `bun install` first. Scratch under "$WT/.tmp/" (delete before final report).
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-one-arm-grammar/BRIEF.md (body `start at $(pwd)`); keep docs/changes/s452-one-arm-grammar/progress.md append-only. Commit incrementally. Never --no-verify. Pre-commit timeout 300000. Run git commands singly.
6. Push as `spec/s452-one-arm-grammar` (normal push). Do NOT open/merge a PR.

TASK — SPEC amendment for a new bryan ruling (S452). Read the ruling verbatim FIRST: /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md, section "## S452", entry "⭐⭐ RULED — "c looks right"". Summary: `!{}` handler arms use the SAME grammar as `match` arms (§18.2: `match-arm ::= arm-pattern (':>' | '=>' | '->') arm-body`; `variant-pattern ::= ('.' | '::') VariantName ('(' binding-list ')')?`; `whole-error-arm ::= '_' Identifier`). No leading `|`. Canonical: `x = f() !{ .Network(msg) :> …  _ err :> … }`. The `|`-prefixed arm (and the paren-free binder `| ::V m :>`) is SOFT-DEPRECATED via §63. Markup arms (`<match>`, engine state-children) are NOT touched. The binder reading is a PA reading in its veto window — say so in the provenance.

Do:
1. Read §18.2, §18.6.1 (whole-error binder, S451), §19 (all of it that concerns `!{}` arms — §19.7, §19.8.3, Appendix B, the §19 alias/"lockstep" note), §63 IN FULL (esp. §63.2 the well-formedness invariant: parses-identically W-lint + reserved E-code named in §34 + a `scrml fix` rule OR a designer-card; a Stage-1 deprecation MUST NOT name a removal version), and the W-MATCH-ARROW-LEGACY precedent (grep it) — mirror that precedent's shape exactly.
2. Write the normative rule: in §19 (where `!{}` handlers are defined) state that a handler's arm list is a sequence of §18.2 `match-arm`s — give it a grammar production that REFERENCES §18.2 rather than restating it. State the legacy form: an optional leading `|` before an arm, and a single paren-free binder after a variant (`| .V m :>`, meaning `.V(m)`), parse identically during the window and surface a new info-level W-lint. Name it (suggest `W-HANDLER-ARM-PIPE-LEGACY`; check §34 for a clash), reserve `E-HANDLER-ARM-PIPE-LEGACY`, and name the `scrml fix` rule (rewrite `| <pat> :>` → `<pat> :>`, `.V m` → `.V(m)`) — §34 rows for both codes; mark both "Nominal / not yet emitted" for impl#1 and the bootstrap.
3. Inline `> **Provenance:** ruling:user-voice-scrml.md S452 "c looks right" …` with the verbatim line, `supersedes:` the example-only `| ::V m :>` handler shape, and the direction of change: the CANONICAL pipe-less form is NEWLY-ACCEPTING on impl#1 — measure it: compile this on main and record the result in the provenance (expected today: the first pipe-less arm is not recognized → E-TYPE-080):
```
<program>
type E:enum = { Bad(msg: string), Gone }
function risky(n)! -> E {
    if (n > 1) fail E::Bad("x")
    return n
}
export function go() {
    risky(2) !{
        .Bad(m) :> { return }
        .Gone :> { return }
    }
}
</program>
```
(compile: `bun compiler/bin/scrml.js compile <file> --output-dir "$WT/.tmp/out"`). File the impl#1 divergence as a gap in docs/known-gaps.md (`*-s452` id, sev=MED — canonical form rejected with a misleading code, an arm silently dropped; locus= found by tracing where impl#1 parses `!{}` arms — grep compiler/src for the handler-arm parse; prov=ruling:…). Also file the misleading-diagnostic half: a leading `|` in a `match` arm yields E-TYPE-020 "Missing variants" instead of naming the `|`.
4. Migrate EVERY `!{}` example in compiler/SPEC.md to the canonical form (`| ::V m :>` → `.V(m) :>`, `| _ :>` → `_ :>`, `| _ err :>` → `_ err :>`, `::V` → `.V` where it is the handler's own variant prefix — keep `::` only where the SPEC is illustrating the alias). EXCEPT examples whose point is the legacy form. Count them before/after and report. Do the same in docs/PA-SCRML-PRIMER.md and README.md (README example 4: `| ::Network msg :>` → `.Network(msg) :>`) — but NOTE: README/PRIMER examples must compile on impl#1 today; since the canonical form does not, for README.md and the PRIMER use `| .Network(msg) :>` (canonical variant prefix + parenthesized binder, keeps the pipe) and add nothing else; record that they move to the pipe-less form when impl#1 accepts it. Verify the README form compiles on impl#1 if the README block is a CI-compiled file (check how README blocks are gated).
5. Do NOT touch .scrml corpus files (examples/, samples/, conformance/, stdlib/) — that is the `scrml fix` migration, separate. Report the measured count: a text grep found ~179 `|`-prefixed arms in ~80 .scrml files (examples 5/1, samples 55/16, conformance 98/41, stdlib 21/7) — re-measure with a better method if you can and report.
Gates: `bun run scripts/regen-spec-index.ts` + `--check`; `bun scripts/s34-census.ts --check-new`; `bun scripts/facts.ts --check` (write if needed); `bun scripts/state.ts --write` then confirm ONLY the known-gaps count hunk moved (revert any master-list recent-sessions hunk — PA owns it). If the SPEC is silent or two sentences disagree on something you need, STOP that item and report — do not decide it.
FINAL REPORT (<600 words): worktree, FINAL_SHA (== pushed tip), the new grammar text (quote it), code names, examples migrated (counts per file), the impl#1 measurement, gaps filed, gates, `git status` clean.
