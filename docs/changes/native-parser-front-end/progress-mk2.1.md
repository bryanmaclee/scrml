# MK2.1 — TagFrame engine skeleton + opener recognition + TagKind calc

Per-agent progress file (append-only). Parallel M2.4 dispatch runs concurrently —
do NOT share a progress.md.

## Startup

- 2026-05-20 — worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a98858e25af967172
- Startup verification PASS: pwd under .claude/worktrees/agent-, repo root matches,
  tree clean, `git merge main` fast-forwarded to 7c3d898, all 4 predecessor file
  pairs (parse-ctx / block-context / parse-markup / lex-mode .scrml+.js) present,
  `bun install` ok, `bun run pretest` ok.

## Reading

- Maps read: primary / structure / dependencies / schema.
- Roadmap §0 / §2 / §3.1 (MK2.1 row — authoritative scope) read.
- Charter dive Q1.F (TagFrame sketch + TagKind calc) / Q1.G (composite picture) /
  Q2.A (12 BS heuristics) read.
- Predecessor native-parser files read in full: block-context .scrml+.js,
  parse-markup .scrml+.js, parse-ctx .scrml+.js, lex-mode.scrml, bracket-stack.scrml.
- SPEC §4.15 + §24.4 + §4.3 read IN FULL (per pa.md Rule 4, brief mandate).

## SPEC discrepancy surfaced (K-class candidate — REPORT to PA)

The brief's MK2.1 structural-element registry lists 9 elements
(`<engine>`/`<match>`/`<errors>`/`<onTransition>`/`<onTimeout>`/`<onIdle>`/`<channel>`/`<page>`/`<auth>`).
SPEC §4.15 + §24.4 — the NORMATIVE registry tables — register exactly 7:
`<engine>`/`<match>`/`<errors>`/`<onTransition>`/`<onTimeout>`/`<onIdle>`/`<page>`.
`<channel>` is called "a scrml-defined structural element" by §38 (line 16499) but is
NOT in the §4.15/§24.4 tables (SPEC internal inconsistency). `<auth>` is a block-grammar
gate element (`<auth role=>`) — NOT an HTML element — but is never named "structural
element" and is not in the registry tables. Per Rule 4 (SPEC normative) MK2.1 encodes
the §4.15/§24.4 normative 7-element set; the registry is a closed lookup so adding the
2 omitted names later (if SPEC §4.15/§24.4 are amended) is a one-line table change.

## §4.3 finding (load-bearing for TagKind)

§4.3 — the whitespace-after-`<` discriminator is "informational only" since Phase P1.
Authoritative tag-vs-state resolution moved to NR. The BS still records
`openerHadSpaceAfterLt` (advisory; W-WHITESPACE-001). So `TagKind.StateOpener` at MK2.1
is the COMPUTED syntactic fact of the `< Ident>`-with-space shape (advisory per §4.3);
the AUTHORITATIVE markup-vs-decl decision (depends on what FOLLOWS the opener) is MK2.3.

## Steps

- (next) Write tag-frame.scrml + tag-frame.js.
