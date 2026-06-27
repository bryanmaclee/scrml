# ss39 — legacy-path parse/markup fixes (ast-builder + named-machine init)

**Currency:** built S223 (PA) @ HEAD `5fb41cb9` / 2026-06-26. **FIREABLE.** Carved from the S223 "parser/ast-builder cluster" — **2 of the original 5 routed OUT** (see "Not in this lane" below): the cluster reduced to 3 fixable **legacy-path** bugs (NOT the frozen native parser).

**Parallel-safety:** items 1+2 touch the **legacy `ast-builder.js` parse layer** (markup comment scanner · nested-template handling). The in-flight **ss32**/**ss33** touch **emit-client**, **ss34** touches **emit-server** — all DOWNSTREAM of ast-builder. Low collision risk, but `ast-builder.js` is a hot shared file: **at landing, intersect ss39's `ast-builder.js` touch against any ss32/ss33/ss34 landing that also touched it (S211)**. Item 3 is a different surface (§51.3.2 engine init codegen/typer) — disjoint from items 1+2 and from the other lanes. Run the lane **sequentially** (items 1+2 share `ast-builder.js` → one fire-site at a time).

**Fill-note:** three independent MED legacy-path bugs, grouped because they're all "the live front-end / engine-emit mis-handles a valid scrml shape." Items 1+2 are ast-builder PARSE bugs (clean roots identified); item 3 is an engine-init codegen/diagnostic gap (survey-first on §51.3.2 semantics). All in the LIVE shipping path (legacy BS/TAB/Acorn + ast-builder + engine codegen) — NOT the Road-B native-parser rewrite (frozen) and NOT design-track.

**Shared ingestion:** `compiler/src/ast-builder.js` (the markup-section comment scanner + the nested-template-literal handling) · the §51.3.2 named-machine engine codegen + typer (governed-cell init). Items 1+2 share `ast-builder.js`; item 3 is separate.

**coreFiles:** `compiler/src/ast-builder.js` (items 1+2) · engine codegen (`emit-engine`/`emit-statechild` + the §51.3.2 named-machine path) + the engine typer pass for item 3 · SPEC §27.1 (trivia/comments, item 1) · §51.3.2 (named-machine, item 3).

**Brief reminders:** these are LEGACY-path fixes — do NOT touch `compiler/native-parser/` (frozen per the compiler-reimagining ruling). Per Rule 4, READ SPEC §51.3.2 IN FULL before item 3 (named-machine init semantics — the canonical pattern supplies init via a separate state-decl; the bug is the omit-the-decl footgun). R26 + ADVERSARIAL (S215) on every codegen/parse change — construct adjacent-shape repros (item 1: angle brackets in `/* */` block comments + multiple per line; item 2: deeper nesting `${\`a ${\`b ${x}\`}\`}`; item 3: derived engines + `<machine>` keyword). Differential against current behavior where a shape already compiles.

## Items

1. **g-markup-comment-angle-bracket-parsed-as-tag** (MED) `[status=open]`
   - Symptom: a markup-section line comment `// NOT a <form> — … <each>` has its `<form>`/`<each>` consumed by the tag scanner as opening tags → corrupts structure downstream → fires `E-MATCH-PARSE-001` + `E-MATCH-NOT-EXHAUSTIVE` on an UNRELATED `<match>` far below. JS/logic-section `//` comments are inert to angle brackets; markup-section `//` comments are NOT.
   - Root: the markup-section comment scanner doesn't suppress angle-bracket tokenization inside the comment.
   - Footprint: `ast-builder.js` markup comment scanner — suppress tag tokenization for the rest of a markup-section `//` line (and check `/* */` block comments per the adversarial note). Repro: `// foo <bar> baz` inside a markup body → `<bar>` must NOT parse as a tag.

2. **g-nested-template-raw-mangle-ast-builder** (MED) `[status=open]`
   - Symptom: a nested template literal `${\`inner ${pb()}\`}` is mangled by the ast-builder BEFORE it reaches codegen (ss22 #4 surfaced it; ss22's emit-expr fix was correct at the emit level — this is the separate upstream ast-builder mangle).
   - Root: ast-builder nested-template-literal handling (adjacent to the `g-inline-struct-return-type-misparse` ast-builder return-type surface — possibly the same template/nested-raw scan).
   - Footprint: `ast-builder.js` template-literal handling — preserve the inner raw template through to codegen. Adversarial: deeper nesting + interpolations with calls/awaits.

3. **g-named-machine-arrow-no-statedecl-silent-empty** (MED, **survey-first**) `[status=open]`
   - Symptom: `<engine name=PM for=Phase>` with an arrow body and NO separate explicit `<phase>: Phase = .A` state-decl emits no `_scrml_reactive_set` init → governed cell `undefined` at mount → a driven `<match on=@var>` renders EMPTY with zero diagnostic. Same silent class the 6nz B2 fix (`d71a6dcc`) closed for the §51.0.C state-engine form, but B2 EXEMPTED the §51.3.2 named-machine form (`hadNameAttr`) + `<machine>` keyword + derived engines.
   - **STOP-first survey (report before building):** read SPEC §51.3.2 in full. The canonical named-machine pattern supplies init via a separate state-decl (why 6nz p1/p5/p7 work); omitting it is the footgun. Decide: does §51.3.2 want the named-machine path to (a) EMIT/REQUIRE a governed-cell init, or (b) fire its own missing-init diagnostic (mirror B2's `E-ENGINE-RULE-LEGACY-SYNTAX`-class)? Narrower + lower-priority than the §51.0.C case — verify the §51.3.2 init semantics before fixing.
   - Footprint: §51.3.2 named-machine engine codegen + typer. Different surface from items 1+2.

## Not in this lane (routed out S223 — Rule-4 carve-out)

- **g-component-body-markup-parser-absent** (MED) → **DESIGN-TRACK, not a fix.** The gap text: *"A from-scratch component-body markup parser is the precondition."* Same subsystem shape as the Bucket-B `each-inline-component-instance` Approach A. Route to a DD / design arc, not an sPA fix lane. (The PASS-11 engine reject-walker is already correct — the b17 cases 1-3 activate for FREE once a parser produces the shape.)
- **g-native-inline-struct-return-twin** (MED) → **FROZEN native parser.** Lives in `compiler/native-parser/` (the Charter-B rewrite, transition-FROZEN per the compiler-reimagining ruling). It's a within-node allowlist divergence (login.scrml 52→59), NOT an adopter-blocker → defer per "fix only adopter-blockers." Re-opens if/when the Road-B build reaches the front-end (the rewrite supersedes this code).
