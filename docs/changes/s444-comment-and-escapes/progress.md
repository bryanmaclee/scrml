# progress — s444-comment-and-escapes

- start: worktree was stale (HEAD 8fd7d6ba1, behind origin/main); branched feat/s444-comment-and-escapes from origin/main 12aae48a1 (clean tree, includes #1190). Baseline gate 26680 pass / 0 fail / 72 skip / 12 todo.
- SPEC: §4.7 narrowing note, §4.18 banner supersession, §4.18.1 note + two table cells, §4.18.1b exit (2) rewritten (old struck), pins 4/5, per-surface rows (S442 rows struck in-cell, two S444 rows added), §4.18.3 grammar + restored catalog + E-PARSE-001 (S111 text, d0b75a8f7) + OPEN residue closed, §4.18.4 `\${` bullet restored, §27.1 note. SPEC-INDEX + FACTS regenerated, both --check PASS.
- Decisions: whitespace = space/tab/LF/CR, these four only; "start of line" = preceded by a line terminator (indentation is whitespace); "immediately preceded" = the source byte, whatever construct it ends — so `<p>// x`, `</b>// x`, `${x}// y`, `-->// y` are TEXT. Unknown escape `\q` = E-PARSE-001 (restores S111 exactly; both chars kept as content on recovery). `\$` not followed by `{` is malformed. A `\` inside `${…}` in a display literal belongs to the logic string.
- Bootstrap: parse.scrml freeTextCommentAt (R1) + skipLineComment stops before CR; displayEscLen/displayEscText shared by displayCloseAt / splitDisplay / hasLiveInterp / displayEscapeDiags (E-PARSE-001, both loci). lex.scrml display-mode scanString decodes the three escapes.
- Tests: slice-m4/comment-escapes.test.js (38). dpa045.test.js: 7 S442-pinning tests rewritten to S444 behaviour (list in the report).
- Mutations: 18 rows (5 R1, 13 R2 incl. 3 re-labelled S442 rows). First run: one GREEN ("display-mode lexer does not decode" — the logic decoder is equivalent on the three escapes); fixed by a recovery test (`"a\qb"` cooked = `a\qb`). Re-run: 236/236 RED, 0 problems, exit 0.
- Corpus: bootstrap parse over 2,130 files (conformance/cases, slice-m2/m4 §66.19 programs + fixtures, examples, samples): 0 changed (diags + every Text node identical). impl#1 corpus grep `\S//`: 55 hits, all attributes/strings/comments → 0 free-text.
- impl#1 by execution (12aae48a1): R1 — `a//b ok` → `a`, `<b>y</b>// x` → `<b>y</b>`, `http://x` kept (urlSlashesAt). R2 — shorthand `\"`/`\\` OK, `\q` silent, `\${@x}` → live `7`; engine state-child renders raw source with quotes. Two gaps filed in §S444c.
- Pre-existing: `bun scripts/state.ts --check` FAILS on origin/main (recent-sessions in master-list.md stale) — not touched.

## FINAL
slice-m1 73/73 · lowered m1 73/73 · slice-m2 448/448 · slice-m3 60/60 · slice-m4 226/226 · v2-lexer 337/337 ·
lint 58 files / 0 · mutations 236/236 RED, 0 problems, exit 0 (710 s) · bite CG 32 + CSS 32 + FRONT 12 certified,
0 uncertified, exit 0 · conformance impl#1 1151 cases, 7 xfail (compiler/src + conformance/ untouched) ·
gate 26680 pass / 0 fail / 72 skip / 12 todo. Pushed feat/s444-comment-and-escapes.

## Fix round (standalone-only ruling + S239 review nits of 5d5ad360b)
- RULED S444 "standalone only, your rec": parse.scrml codeRegionTP — a code-default region is display-lexed; unless it is exactly one `"` string token it is re-lexed with display off (lex.scrml lexFromMode). displayEscapeDiags / splitDisplay only for a standalone literal. SPEC §4.18.1 code-default cell + §4.18.3 scope bullet (provenance "standalone only, your rec").
- Nit 1: CR-only `a\r// c\r` test + row. Nit 2: freeTextCommentAt = explicit 4-byte set; unreachable pos==0 branch and the SPEC "first byte of the source" clause dropped (a free-text body always follows its opener's `>`). Nit 3: unterminated recovery content cooked + malformed escapes E-PARSE-001 (incl. a trailing lone `\`); SPEC §4.18.3 unterminated bullet amended.
- Moved mutation sites re-sited (5); the lexer-`\${` row went GREEN once nested strings left display mode — now pinned by a standalone extent test (`"a \${ b"` is one literal).
- FINAL: slice-m1 73 · lowered 73 · m2 448 · m3 60 · m4 238 · v2-lexer 337 · lint 58/0 · mutations 243/243 RED, 0 problems · bite 32+32+12, 0 uncertified · parser-conformance-*.test.js 4284 pass / 0 fail · corpus 2,130 files: 0 changed.
