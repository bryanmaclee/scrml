# s459-readme-tighten — move three README sections into linked pages (bryan's instruction, verbatim below)

bryan, S459, verbatim: *"the readme looks good, but I want to tighten it more. make note from dev, tier ladder and everything from "everything scrml dose" and down links. the where the language is going stays as it"*

PA reading: move each of these README sections OUT into its own linked page, replaced in the README by a link:
1. `## A note from the dev`
2. `## The tier ladder`
3. `## Everything scrml does` and EVERY section after it: `## Language contexts`, `## Examples`, `## Quick start`, `## Terms`, `## Documentation`, `## License`, `## Related projects`, `## Status`.
KEEP in the README, untouched: the title/intro, `## One app, one file` (all subsections), `## Why scrml`, and `## Where the language is going` ("stays as it" — not one byte changed).

## Rules
- **Move, never trim.** Every moved section's text goes to its new page VERBATIM (byte-identical body), including code blocks, tables, links and the `---` structure as appropriate. Do not edit, condense, reword or re-voice anything. bryan owns this text. The only permitted changes inside moved text: relative link paths that break because the file moved directory (fix them so every link still resolves), and a one-line page title.
- Destinations: one page per moved section under `docs/readme/` — `note-from-the-dev.md`, `tier-ladder.md`, `features.md` (Everything scrml does), `language-contexts.md`, `examples.md`, `quick-start.md`, `terms.md`, `documentation.md`, `related-projects.md`, `status.md`. License: link to the repo's existing `LICENSE` file; if the README's License section says more than a pointer, move that text to `docs/readme/license.md`.
- README: where the moved sections were, add ONE short `## More` section at the end (after "Where the language is going") listing the links in the original order, each as `- [<original heading text>](docs/readme/<file>.md)`, nothing else. Also fix any in-README reference to a moved section (e.g. "the Tier 0→1→2 ladder above", anchors like `#the-tier-ladder`, `#quick-start`) so it points at the new page — change the link target only, not the surrounding words, EXCEPT where a word like "above" becomes false; list every such word change in your report.
- Each moved page that references a README section that stayed (e.g. "Where the language is going") links back to `../../README.md#<anchor>`.
- Snippet gate: `scripts/snippet-drift.js` scans `README.md` and `docs/` (DRIFT_DOC_ROOTS); marked blocks that move must still pass. `node scripts/snippet-gate.js` (or as .github/workflows/ci.yml invokes it) and its `--drift-only` mode must pass; report block counts per document before vs after (total must not drop).
- Check every relative link in README.md and the new pages resolves to an existing file/anchor (write a small checker in scratch; report N of M resolved).

## Setup (isolated worktree)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (=WT); toplevel == WT; clean tree. `bun install`.
2. `git -C "$WT" fetch origin worktree-agent-a8fca83a59f6533ba` → `git -C "$WT" checkout -B s459-readme-tighten origin/worktree-agent-a8fca83a59f6533ba` (tip 172247211).
3. Absolute WT paths only; never `cd` into /home/bryan-maclee/scrmlMaster/scrml; never `git stash`; no pattern `pkill`. TMPDIR=$HOME/.cache/scrml-agent-tmp/s459-readme-tighten.
4. Copy this brief verbatim to `$WT/docs/changes/s443-readme-two-registers/S459-TIGHTEN-BRIEF.md`; append timestamped lines to that dir's progress.md under "S459 tighten". Commit after each step; pre-commit hook runs — never `--no-verify`.

## Final report
WT · final SHA · new files · README before/after line count · the `## More` block as written · every word changed outside a link target (should be ~0) · snippet gate + link-check results (executed) · byte-identity check of each moved body vs the original (executed, e.g. extract + diff). Do NOT push.
