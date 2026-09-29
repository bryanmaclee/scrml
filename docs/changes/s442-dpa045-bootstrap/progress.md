# s442-dpa045-bootstrap — progress

Branch feat/s442-dpa045-bootstrap, cut from origin/main 6dccbd6c. Ruling: user-voice-scrml.md S442 "dpa-045 … = all
PA recs" (AXIOM-LEVEL); artifact scrml-support/docs/debates/plain-markup-text-as-string-dpa-045-round2-2026-09-08.md.

## Log
- C — the loop census committed FIRST (census.md). Canonical extent routine: lex.scrml `lexFrom` (token fold +
  LexStop). Every logic-region / interpolation extent already went through it; no raw brace counter exists in the
  bootstrap. The only flat extent decider is `parseKids` — the free-text production itself.
- Behaviour BEFORE (probe at 6dccbd6c):
  - `<p>a ${"${"} b</p>` → `a ${ b`; `${"}"}` → `}`; `${ /* } */ @n }` → `5` — B(1) already held (walker).
  - `<p>a < b and 5 <7</p>` → E-PARSE-TAG cascade (the `<` + space opened a tag) — D violated.
  - `<p>C:\dir\x \n</p>` → verbatim, no diagnostic — D already held. Whitespace in a text run → verbatim.
  - `\"` in a display-text literal (`<p : "a\"b">`, a state-child body `"a\"b"`) → accepted, rendered `a"b` — the
    escape was live (the lexer's JS string rule).
- D FIXED — `parseKids`: a `<` opens a tag only if the next char is a letter, `!`, `/`, `?` (+ `*`, see below);
  otherwise it is content. `a < b` renders `a &lt; b`.
- B(1) — no change needed (already the canonical walker); pinned by tests (`${"${"}`, `${"}"}`, a comment, a
  template literal) and a mutation row (a `}` terminating a string breaks it).
- B(3) FIXED — lexer DISPLAY mode (`LexState.display`, set by `lexFrom` for the two code-default stops:
  `:`-shorthand and state-child code bodies): in a `"…"` display-text literal, `\"` is not an escape — the
  backslash is content and the `"` ENDS the literal. The parser reports it: **E-PARSE-001** ("`\"` is not an escape
  in a display-text literal … the `"` ENDS the literal here"), first diagnostic of the statement; what follows the
  early close is then parsed as whatever it is (a trailing name, a new string) — the cascade after the first
  diagnostic is the Class-D consequence the ruling accepted. `\\`, `\${` and every other escape are UNCHANGED (B(2)
  not ruled). A `\"` in a LOGIC string (`${"a\"b"}`) is still an escape.
- Tests: slice-m4/dpa045.test.js (13; behaviour tests run in happy-dom). Mutations: 6 rows.
- Corpus (bootstrap front end over conformance/cases, 1111 cases, before vs after): **0 newly rejected, 0 newly
  accepted, 0 clean-output changes**; 14 already-rejected cases' diagnostic lists changed (a `<_`-arm cascade shorter;
  their programs use unsupported `<match>` / legacy engine forms). Five pre-existing programs: dumpcore
  byte-identical.
- E (measurement, conformance + examples + samples, 2075 .scrml files, bootstrap parse): 14,243 free-text runs;
  **95 runs in 4 files contain a backslash** (examples/28-flux.scrml, three samples/gauntlet-r18 files) — all now
  silent content, as before; **19 files contain a non-tag `<`** in text — every one is a `<_` wildcard arm (§18.0.1)
  inside a `<match>` / engine / `<onchange>` body, not prose.

## ⚑ For the PA / bryan (not decided here)
1. **The ruled exit class `<`+[a-zA-Z!/?] omits three scrml tag forms:** `<*x/>` (§66.6 existing instance — ADMITTED
   in the bootstrap, else §66.19.2/.6 break), `<_ …>` (§18.0.1 wildcard arm) and `<.Variant …>` (§18.0.1 match arm).
   The bootstrap has no `<match>`, so `<_` / `<.` are left as the ruled class says (content) — the SPEC text must
   either list them or say those bodies are not free text.
2. **`//` inside a free-text body** is a comment (§4.7 "universal", S87) — an exit outside D's closed set that can
   move a body's end; the §66.19 SPEC programs rely on it (`<label>…</label>   // …`). Unchanged; needs a ruling.
3. **`#{` inside a free-text body** is a CSS block (S440 R4) — same question. Unchanged.
4. **L13** (lower drops whitespace-only text containing a newline) vs "whitespace is kept exactly": unchanged —
   changing it alters the five pre-existing programs' lowered Core (stop condition), and E's whitespace oracle diff
   is owed first.
5. **What SPEC must say for B(3)** (another agent is writing it; SPEC not edited here): §4.18.3's escape list loses
   `\"`; "a literal double-quote SHALL be written as `\"`" is struck; a `"` cannot appear inside a display-text
   literal (the residue the artifact names — no delimiter answer); `\"` in a display-text literal is E-PARSE-001 and
   the literal ENDS at that `"` (no scanner treats `\` as protecting a `"` in code-default text); §4.14's shorthand
   and §51.0.I state-child bodies inherit this. Logic-context strings are unaffected.
- FINAL: slice-m1 73/73 · lowered 73/73 · slice-m2 433/433 · slice-m3 60/60 · slice-m4 136 + 2 todo · lint 58/0 ·
  mutations 179/179 RED (6 dpa-045 rows) · bite CG 32 + CSS 32 + FRONT 12 certified (no new Core / printer construct:
  the dpa-045 changes are parse-level exit decisions whose failure mode is a diagnostic — certified by mutations.js)
  · dumpcore byte-identical.
