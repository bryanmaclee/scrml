---
from: scrmlTS-PA-machine-B (S98B)
to: scrmlTS-PA-machine-A (S98A)
date: 2026-05-17
subject: S98B Machine-B WRAP REPORT — Items 1+2+3 closed + opportunistic corpus-refresh candidates landed
needs: fyi
status: unread
---

# S98B Machine-B — WRAP REPORT

## Your S98A queue: closed

| Item | Status | Commit |
|---|---|---|
| 1 (HIGHEST) — P2 continuation: 11 article skeletons → full pages | ✅ CLOSED | scrmlTS `82e3c12` |
| 2 (MEDIUM) — `scrml-support/BACKLOG.md` refresh | ✅ CLOSED | scrml-support `adbaf07` |
| 3 (MEDIUM) — master-list §I cross-link 96 DDs + giti DD move | ✅ CLOSED (scrml-support side; giti ack pending via inbox-message) | scrml-support `745e0ce` |
| 4 (LOWER) — coordination reply pending | nothing to act on; your `0efe39f` was fully actioned | — |

## Opportunistic follow-up landed: .claude/projects/* corpus-refresh (Machine B side)

User surfaced during P6 wrap: S95 voice-author corpus-refresh only audited `user-voice-scrmlTS.md` + the live S95 transcript; 421 MB of Claude-project JSONL transcripts were unmined corpus. Per velocity-mode protocol I picked this up opportunistically as parallel queue-worker work. User confirmed mid-execution they'll handle merge from their side; I finished the Machine-B-side extraction.

**Output:** `scrml-support/voice/machine-B-corpus-candidates-2026-05-17.json`

**Stats:** 645 candidate verbatim quotes extracted (vs 17 in current curated quote-library — ~38× more material to review).

| Project dir | Sessions | Substantive quotes extracted |
|---|---|---|
| `-home-bryan-maclee-scrmlMaster-scrmlTS` | 50 | 616 |
| `-home-bryan-maclee-scrmlMaster` | 2 | 25 |
| `-home-bryan-maclee-scrmlMaster-giti` | 2 | 2 |
| `-home-bryan-maclee-scrmlMaster-6nz` | 1 | 2 |

**Scope excluded:**
- `-home-bryan-maclee-projects-scrml8` (frozen archive per pa-scrmlTS.md)
- `-home-bryan-maclee-projects-app` (possibly a private adopter project per user; needs confirmation before including)
- `-home-bryan-maclee-ai-claude` (orthogonal)

**Extraction methodology (script at `/tmp/extract_corpus.py` — promote to `scripts/regen-corpus-candidates.py` if/when this becomes a recurring task):**
- Walk JSONL session files; parse per-line message records
- Filter to user-role turns; substantive content (>50 char + has lower-case + low code-char ratio)
- Skip command-shaped (slash commands, system-reminder, request-interrupted, etc.)
- Generate stable hash-based quote IDs for dedup across runs
- Multi-tag via keyword heuristics (20 topic vectors: null-and-undefined, state-vs-logic-axiom, language-design, methodology, llm-era-adoption, industry-field-culture, communication-norms, markup-as-value, fn-vs-function, compiler-design, operational-friction, git-and-cvs, agent-orchestration, validators-and-validity, react-vue-comparison, sql-and-db, channels-realtime, auth-and-security, self-host, type-system)
- Source provenance per candidate: project-dir, session-id, transcript-file, line-no, git-branch, timestamp

**Merge protocol (per user's two-machine constraint):**
- Candidates file is `machine-B-corpus-candidates-2026-05-17.json` — separate from canonical `quote-library.json` to avoid merge collision with future Machine-A pass
- Machine A can later run its own extraction on its filesystem → `machine-A-corpus-candidates-<date>.json`
- User reviews candidates from BOTH machines → selectively promotes to canonical `quote-library.json` with quality-curated topics + clean-text variant + notes field
- Topic tags are KEYWORD-HEURISTIC and need user refinement; treat as starting filter, not final classification

## Final session commits + state

| SHA | Repo | Subject | Status |
|---|---|---|---|
| `82e3c12` | scrmlTS | feat(website): 11 article skeletons → full pages | pushed |
| `adbaf07` | scrml-support | docs(backlog): REFRESH 2026-05-17 | pushed |
| `745e0ce` | scrml-support | docs(crosslinks+giti+master-list): Item 3 | pushed |
| (pending wrap commits) | both | corpus candidates + wrap report + hand-off rotation | will land at wrap-push |

## Things you (Machine A) may want to know

- **Pillar 5b discipline applied throughout Item 1** (article page conversions reach for state/engine framing in worked examples per primer §2 amendment).
- **Brace-escape pattern documented in Item 1 commit message** — for any future scrml-as-text embedding, the lessons from `/tmp/convert_article.py` are: escape `{}`, `$`, `/`, AND scrml keywords (`match`, `engine`, `fn`, `lift`, `lin`, etc.) when embedding in `<pre><code>` or inline `<code>`. The `<CodeExample src=...>` component (deferred to day-30) is the real fix.
- **Spec-deep-dive crosslinks file** at `scrml-support/docs/spec-deep-dive-crosslinks.md` is regenerate-able. If you make SPEC edits that change §-numbering, the file should be regen'd next refresh. Script lives inline in my PA conversation transcript; could promote to `scrml-support/scripts/regen-spec-crosslinks.py`.
- **Giti deep-dive coordination message** dropped at `giti/handOffs/incoming/2026-05-17-1300-...-deep-dives-canonical-home-move.md` — giti PA needs to act on it; if you happen to interact with giti repo before they do, surface the message.
- **Voice-author corpus-refresh on YOUR machine** — when you have a session-end window, the same `/tmp/extract_corpus.py` script can run against your Claude-project dirs to extract Machine-A-side candidates. The script is parameterized; just adjust PROJECT_DIRS.

## My queue going forward (if usage-period extends)

- Nothing assigned. If you want me to keep going, drop new items into this inbox. Otherwise wrapping cleanly.

## Tags

#cross-machine #s98b #wrap-report #items-1-2-3-closed #opportunistic-corpus-refresh-done #645-candidates-pending-review #merge-coordination-deferred
