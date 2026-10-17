# progress — s468-bootstrap-failopen-gaps (append-only, timestamped)

- 2026-10-17T16:34 — start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-ad6ced03d16c4738f; branch
  s468-bootstrap-failopen-gaps from origin/main 1f1b5be4e (merge-base == origin/main verified). bun install
  (puppeteer postinstall exit 1 — browser download; non-blocking for this unit); pretest OK. BRIEF.md = COMMON.md +
  BRIEF-bootstrap-failopen.md concatenated verbatim.

- 2026-10-17T16:40 — mandatory reading done (BRIEFING-ANTI-PATTERNS.md; kickstarter v2 §0–§3, §7). Maps: primary.map.md
  (S468 block + Task-Shape Routing) — not load-bearing for this unit: the routing table has no bootstrap-internals row;
  build.map.md's bootstrap lines (CI slice step, bootstrap-conformance --check gate) were the only useful pointers.
  The work was located from docs/known-gaps.md markers + source.

- 2026-10-17T16:50 — REPRODUCED all six on origin/main 1f1b5be4e (bootstrap via slice-m4 harness `frontEnd` +
  `printProgram`; base tree = `git archive origin/main`; impl#1 via `bun compiler/bin/scrml.js compile`). Reproducers
  live outside the repo (`$TMPDIR/repro/r1..r7*.scrml`), each stamped `@ origin/main 1f1b5be4e`:
  1. static-exec: bootstrap DIAGS [] and prints `srcdoc="&lt;p&gt;static&lt;/p&gt;"`, `href="javascript:alert(1)"`;
     impl#1 E-ATTR-STATIC-EXECUTABLE ×2.
  2. braced: bootstrap DIAGS [] and prints `srcdoc=""`, `href=""`, `title=""`; impl#1 `srcdoc={@doc}`
     E-ATTR-INTERP-EXECUTABLE, `href={@bad}` bound through `_scrml_safe_url`, `title={@bad}` bound.
  3. raw content: bootstrap parses `<pre>` bodies as markup (E-ATTR-QUOTED-HANDLER / E-SCOPE-001 on `<img onerror>`
     text, E-PARSE-CLOSER on `a < b`); bootstrap-conformance: element-refusal/raw-{comment-script, noscript-attr-style,
     textarea-attr-breakout, xmp-comment-breakout}-pos FAIL (code not emitted).
  4. spread: NOT REPRODUCED — `bun test ./compiler/self-host-v2/slice-m2/front.test.js -t snapshot` 10 pass / 0 fail on
     1f1b5be4e; fixed by #1129 (78209e3d2, S440 re-land of hold/s438-1109-review-fixes eb3de63d); the "all-or-nothing?"
     question was RULED S440 "Yes". Marker stale. No code change.
  5. fn writes: `fn f() -> int { @n = 1 … }` (and push / pop / `@rows[0].qty = 2`) → DIAGS []; impl#1 E-FN-003 for
     `@n = 1` (impl#1 does NOT refuse `@xs.push(2)` in a fn — noted, not pursued).
  6. validators: `length(>2) length(==4)` → `minlength="3" maxlength="4"`; three-validator form → 3 / 8. impl#1 lowers
     NO length attributes for the Shape-2 equivalent (§55.17 Nominal on impl#1) — not a usable reference.

- 2026-10-17T16:55 — GOVERNING SENTENCES (quoted):
  1. §5.2 "Static executable values (S464)": "Two static attribute values (no `${…}`) the browser runs without scrml
     checking them SHALL each be a compile error (E-ATTR-STATIC-EXECUTABLE), reported once per emitted attribute, in
     every position rule 2 below names … on every code path that writes an attribute into output (fail closed): 1. Any
     static `srcdoc` (any case) … 2. A static navigate / load attribute whose scheme is not admitted … The schemes are
     rule 2's fail-closed ALLOW-list, read by the same scheme reader (one definition)". "A component call's prop is not
     an element attribute (judged where the component writes it)."
  2. §5.2.4: "A `(…)`, `{…}` or `${…}` value of an attribute that is not an event handler, or a quoted condition,
     SHALL be exactly one expression." + §5.2 rule 2 "`srcdoc` in every form (S457)": "A `srcdoc` attribute (any case)
     on an element whose value is not a static string — the expression form `srcdoc=${…}`, a variable … — SHALL be a
     compile error (E-ATTR-INTERP-EXECUTABLE)". (Handler half already closed S464.)
  3. §4.17: "the block splitter SHALL scan the body as a single text run terminated only by the matching close tag";
     "A raw-content body is display text: `<` and `>` are entity-encoded on output (S462 Q21)"; "`&` SHALL NOT be
     encoded"; "A nested `<code>…</code>` or `<pre>…</pre>` pair with NO attributes stays an element … Only a BALANCED
     pair qualifies"; "every case-insensitive `<script` / `<style` start-tag text ANYWHERE in a raw-content body … SHALL
     be `E-SCRIPT-001` / `E-STYLE-001` … The name is exact". §5.2: "Text that only looks like an attribute inside a
     raw-content body (`<pre>`, `<code>`, §4.17) is display text and is not judged."
  4. §66.11.3 item 1 / §66.10 item 1 (spread = genuine replace) — already satisfied (#1129).
  5. §48.3.3: "A `fn` body SHALL NOT write to any variable declared outside the `fn`'s own scope boundary. This
     includes: … Property mutation on a value declared outside the `fn` body … Calling a mutating method on an `@`
     reactive variable declared outside the `fn` body (e.g., `@list.push(item)`)". §48.3: "anywhere inside a `fn`
     body, including inside nested closures, helper callables, or any reachable call chain".
  6. §55.12: "Validators on a single cell COMPOSE"; §55.17.1 item 1: "`length(>=N)` → `minlength="N"`; `length(<=N)`
     → `maxlength="N"`; `min(n)` → `min`; `max(n)` → `max`; `pattern(re)` → `pattern`, only when the lowering is exact".
  No item needed a ruling to proceed. One adjacent question surfaced (contradictory validators — SPEC silent) and was
  filed, not decided: g-contradictory-validators-ruling-owed-s468.

- 2026-10-17T17:05 — FIXES (all compiler/self-host-v2; impl#1 untouched; out of print-server / server-boundary
  modules — no conflict with U1c):
  1. NEW url.scrml — runtime-url-guard.js's reader + sets and attr-injection-sink.ts's static decision as ONE
     `classifyStatic`; analyze.scrml `staticExecPass` (HTML elements of every declaration's markup, parent tracked)
     refuses E-ATTR-STATIC-EXECUTABLE; check.scrml NEW C18 (Core backstop: no Attr.Static is an event-handler name,
     `srcdoc`, or unadmitted URL — Core has no parent, so the `<image>` admission is allowed there: never stricter
     than the refusal). url.scrml is in slice-m1 MODULES (check imports it).
     Locus REFINED: not attrCaseDiags (needs the parent element) — a post-binding pass.
  2. analyze.scrml resolveHtml: `isBracedValue` branch — srcdoc E-ATTR-INTERP-EXECUTABLE, else E-BOOTSTRAP-UNSUPPORTED
     naming `attr=(…)`. Locus HELD.
  3. parse.scrml finishRaw / rawRefusedTags / rawPairTags / rawLevel; Core View.RawText (core/walk/check/measure/print/
     lower arms), HNode.HRawText + escRawText. Locus HELD for parse; REFINED for display (one Core variant, not a new AST
     kind; no inert-template step needed — the bootstrap renders from printed templates).
  4. none (not reproduced).
  5. analyze.scrml fnWritePass over the effect summary's own scan (`s.nodes[i].f.scan.writes`) → E-FN-003. Locus
     REFINED (`:2844` drifted; the call half is fnCallsFunction).
  6. analyze.scrml bindValAttrs — pairNamed / tighterBound; two different patterns E-BOOTSTRAP-UNSUPPORTED; hand-attr
     judged against the combined pair. Locus HELD.

- 2026-10-17T17:10 — DIRECTION OF CHANGE (bootstrap only):
  1 newly-rejecting · 2 newly-rejecting (was a silent drop) · 3 newly-rejecting (the fail-closed scan) + semantics-
  changed (raw body displayed as text, `&` kept — newly-ACCEPTING for `a < b` / `</pre>` in `<code>` etc., governed by
  §4.17's normative sentences quoted above) · 5 newly-rejecting · 6 semantics-changed (tighter attribute) + newly-
  rejecting (two different patterns).
  CORPUS MEASURED (the bootstrap's corpus is the conformance suite; adopter / example / stdlib code does not compile
  through the bootstrap, and impl#1 is untouched, so corpus-emit-differential over impl#1 is identical by
  construction): `bun scripts/bootstrap-conformance.ts`, before (origin/main archive) vs after, per-case diff:
  PASS 189 → 200, FAIL 74 → 65, UNSUPPORTED 858 → 856. Changes: element-refusal/raw-{comment-script, noscript-attr-
  style, textarea-attr-breakout, xmp-comment-breakout}-pos FAIL→PASS, element-refusal/raw-content-display-neg
  UNSUPPORTED→PASS, raw-content/{active-html-displays-as-text, each-row-raw-body-displays-as-text,
  entity-display-unchanged} FAIL→PASS, raw-content/{bare-angle-displays, nested-code-with-attribute-is-text}
  UNSUPPORTED→PASS, defer/fn-prohibition-applies-neg FAIL→PASS; components/invalid-prop-decl-syntax-reject FAIL→
  UNSUPPORTED (its `props={…}` is now refused, not dropped — the only non-improvement, and the intended one).
  (error/handler-failable-reference-exempt-neg showed NOT-TWINNED in the archive run only — an environment artifact;
  the committed report already has it UNSUPPORTED/twin.) Newly-rejecting real (non-test-fixture) sites: 0.

- 2026-10-17T17:15 — GATES: CI bootstrap slice step (lint-no-default-arm 0 violations; slice-m1 99/0, slice-m2 612/0,
  lowered slice-m1 99/0, slice-m3 60/0, slice-m4 1395/0, slice-codec 166/0, self-host-v2-lexer 337/0); checkCore green
  (every `clean()` in the new tests asserts it); security-await-pack classify: FAIL=10, all `[known-fail]` (impl#1
  residue, impl#1 untouched). Tests added: slice-m4/static-executable.test.js (19: url.scrml ≡ runtime-url-guard.js;
  element verdict ≡ impl#1 classifyStaticExecutableAttr over a 400+-case grid + 336 SVG-animation cases; positions;
  legal set; C18 backstop; braced values), slice-m4/raw-content.test.js (16), slice-m4/fn-writes.test.js (12),
  validators.test.js (+5, one pin corrected), sink-guards.test.js (static-srcdoc pin flipped to S464).

- 2026-10-17T17:20 — LEDGER: six markers flipped in docs/known-gaps.md (four resolved by this unit, one resolved-by
  #1129 [stale], the braced gap resolved); NEW g-bootstrap-text-entities-displayed-literally-s468 (LOW — ordinary text
  still encodes `&`; the §4 sentence for ordinary text not settled) and g-contradictory-validators-ruling-owed-s468
  (LOW, route=bryan). `bun scripts/state.ts --write` (gap-counts) — its master-list.md recent-sessions rewrite reverted
  (pre-existing staleness from origin/main's wrap commit, not this unit's); `bun scripts/bootstrap-conformance.ts
  --write`; facts.ts --check PASS.
