# Public docs and the ruled dialect

The public docs (the tutorial, README, NERDME, `llm-kickstarter-v2`, the website) teach **today's ruled scrml**: the language `compiler/SPEC.md` defines (§66 declarations, `;` statements, tapes with grants, one `for`, explicit `return`, block arms that `lift`, templates for text, `T.parse`, typed parameters, comma-separated arms). The first compiler, impl#1 (`scrml compile`), speaks an older dialect and does not parse it. So a migrated document is checked by the **bootstrap** (`compiler/self-host-v2/`, run as `bun run boot:compile`), and whatever the bootstrap cannot compile yet is marked **spec-ahead**. Documents are migrated one at a time. A document that has not been migrated keeps its impl#1 check, so nothing silently stops being gated.

Owner rulings: scrml-support `user-voice-scrml.md`, S469, "public docs teach the ruled dialect, gated by the bootstrap" (also "Archive old drafts" and "Smarter skip markers").

## The two gates

| Gate | Checks | In CI |
|---|---|---|
| `bun scripts/snippet-gate.js` | every `.scrml` file under `docs/tutorial-snippets/`, `docs/readme-snippets/`, `docs/website/`; and that a fence under `<!-- snippet: path -->` is an exact copy of its file | yes (required) |
| `bun scripts/claim-gate.js` | every other ` ```scrml ` fence in the public surface (README, NERDME, DESIGN, tutorial, `docs/articles/`, `docs/adopter/`, `docs/lin.md`, `docs/external-js.md`, `docs/website/*.md`) | yes (blocking: a step in `checks`, which `gate` needs). Dated pre-S469 articles and the v0.2.0 / v0.3.0 announcements are bannered and listed in `SURFACE_UNGATED` |

Both print per-mode counts: impl1 and bootstrap (ruled).

claim-gate also checks a **floor**: any README.md, NERDME.md, DESIGN.md or `docs/**.md` that holds a scrml fence must be in its surface or listed, with a reason, in `SURFACE_UNGATED` (`scripts/claim-gate-surface.js`). A new public page with scrml in it fails the gate until someone decides which.

## Marking a document ruled

Put this on its own line, outside any fence (the tutorial has it under its title):

```
<!-- dialect: ruled -->
```

or a front-matter key, `dialect: ruled`. Then:

- claim-gate compiles that document's fences with the bootstrap. Its diagnostics decide: any error or printer refusal fails the block, and warnings do not.
- snippet-gate compiles every file the document cites with `<!-- snippet: … -->` with the bootstrap. The citing document is the only opt-in, and the `.scrml` file carries no marker of its own. A file cited by both a ruled and an unmigrated document is an error, so migrate both or split the file.
- Any other `dialect:` value is an error. A typo does not fall back to impl#1 without a word.

## Per-block markers

These go on the line(s) directly above the fence. They are HTML comments, so readers never see them. Blank lines and a `<!-- snippet: … -->` marker may sit between them and the fence, in either order. **The reason is mandatory**, so a marker without one fails the gate.

```
<!-- gate: skip — fragment: @items comes from the program above -->
<!-- gate: spec-ahead — the bootstrap has no <channel> yet -->
```

- **`gate: skip — <reason>`** means the block is not compiled at all. Use it for a fragment that is not a whole program. It works in either dialect. You cannot use it on a snippet-marked block, because that file is compiled whole anyway.
- **`gate: spec-ahead — <what's missing>`** is for ruled documents only. It marks ruled scrml that the bootstrap cannot compile yet. The block (or the cited file) is **still compiled**. A failure is expected: it is counted as `spec-ahead` and listed with your reason and the bootstrap's error codes. Once it **compiles cleanly**, the gate prints `STALE … remove the marker`, and `--strict` turns that into a failure. Name the missing feature, not the symptom, e.g. "no `<match>` block element", not "parse error". On a snippet-marked block the marker covers the whole file, so excerpts of that file need not repeat it.
- **Pinned codes (recommended for spec-ahead):** `<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TAG] — no <match> block element yet -->`. The block must then fail with exactly that set of distinct error codes; any other set fails the gate. This keeps "expected to fail" from hiding a typo or a real type error. When the bootstrap's refusal legitimately changes, update the pin. Every tutorial spec-ahead marker is pinned.
- A bootstrap **crash** is always a failure, on a spec-ahead block too.
- The kind must be exactly `skip` or `spec-ahead` (`skip-me` is an unknown kind and fails). A malformed pin is an error, never "unpinned": an unclosed `[`, codes without brackets, a pin list after the separator, or a second `[…]` group.
- The legacy first line `// gate: skip` still works in unmigrated documents. In a ruled document it is an error, so move it to the HTML marker.

### Fences the gates read

- A block is gated when its fence's info string starts with the word `scrml`, in any case and with or without extra words (` ```scrml title=app.scrml `). Backtick and tilde fences both count.
- A fence on a list-item line (`- ```scrml`, `1. ```scrml`, nested) or in a list item's continuation is gated like any other. An opener or closer may be indented at most 3 spaces past its container (the list item's content column, or the page edge); a scrml fence indented 4+ spaces is an indented code block and an error.
- A fence closes only on a run of the same character at least as long as the one that opened it. So a ```` ```` ````-fenced example can show ` ```scrml ` text without starting a gated block.
- These are **errors**, not silent skips: an info string that starts with `scrml` but whose first word is something else (`scrml-old`), a scrml fence inside a blockquote (`> ```scrml`), and an unclosed scrml fence.

### Snippet markers in claim-gate

claim-gate hands a `<!-- snippet: … -->` block to snippet-gate only when snippet-gate really checks it: the target file exists, it is inside the snippet corpus (`docs/tutorial-snippets/`, `docs/readme-snippets/`, `docs/website/`), and the document is one the drift check scans (README.md, NERDME.md, DESIGN.md, `docs/` except `docs/changes/` and `docs/articles/archive/`, `marketing/`). Otherwise the block fails.

Grammar and checks: `scripts/doc-gate-markers.js`. Tests: `compiler/tests/unit/doc-gate-bootstrap-mode.test.js`.

## Migrating a document

1. Add `<!-- dialect: ruled -->`.
2. Rewrite each block into the ruled dialect. The SPEC is the authority. `docs/tutorial.md` is the worked example, and §66.19 holds full worked programs. Keep the document teaching the same concepts in the same order.
3. Compile as you go: `bun run boot:compile file.scrml` for a snippet file, or `bun scripts/claim-gate.js your-doc.md` for inline fences. The bootstrap's diagnostics are specific, and many name the ruled fix (`E-ERROR-002` names the missing `.Transport` arm; `E-DECL-KEYWORD-NOT-ITEM` says where `let <x/>` may stand).
4. Fix everything that is not a bootstrap limitation. Some shapes have a ruled spelling the bootstrap does accept: one arm per pattern instead of `.A | .B :>`, a typed local for a struct literal (`let out: T = { … };`), a `return` value on a `!` function called from the client. Prefer those to spec-ahead.
5. Mark what remains `gate: spec-ahead — <what's missing>`, with what the bootstrap lacks (`E-BOOTSTRAP-UNSUPPORTED`, or a parse error on syntax it does not have yet). A spec-ahead block is not checked against the SPEC by any compiler, so write it carefully.
6. Fix any prose that names impl#1 commands (`scrml compile`, `scrml dev`); for the ruled dialect they are `bun run boot:compile` / `boot:dev`.
7. Run both gates, and then `bun test compiler/tests/unit/snippet-drift.test.js`.

## Archived drafts

`docs/articles/archive/` holds the April–May 2026 devto drafts and `llm-kickstarter-v1`, which are superseded. Each carries a "SUPERSEDED. DO NOT PASTE." banner. The directory is outside both gates on purpose, and outside the drift check: its code is an older dialect and is not checked. Do not link to it as current material.

## Dated pieces (banner + exempt)

The dated articles in `docs/articles/` (the `i-am-jacks-*` and `if-you-give-a-dev-an-enum` drafts and their `-PUBLISH` copies) and the v0.2.0 / v0.3.0 announcements in `docs/website/` were written before the S469 rulings, in bryan's voice. They stay where they are, unedited, with a banner at the top: their code is the older dialect and is not checked. claim-gate excuses them **one file at a time** in `SURFACE_UNGATED` (`scripts/claim-gate-surface.js`), so `docs/articles/` itself stays in the surface: `llm-kickstarter-v2` (ruled) and any new article are gated. Owner ruling: S469 "Banner + exempt".
