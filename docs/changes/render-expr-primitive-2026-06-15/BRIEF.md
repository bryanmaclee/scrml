BUILD THE RENDER-EXPRESSION PRIMITIVE `<render of=X/>` (the S195-RATIFIED held-error-display fix). You are scrml-js-codegen-engineer in an isolated worktree. change-id: `render-expr-primitive-2026-06-15`.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full first; follow Task-Shape Routing for "new feature / compiler-source" (structure + error maps). Map currency: the maps watermark is HEAD `4646ec13`; this session (S196) landed W2 + the prereq-bugs fix (P) + a §51.0.S SPEC edit on top (live main HEAD `d472a407`, 2026-06-15). P touched `type-system.ts`, `rewrite.ts`, `emit-match.ts`, `block-splitter.js`, `match-statechild-parser.ts` — and you will `git merge main` at startup to absorb all of it. Treat map content on those files as a hypothesis; verify against current source.
Feedback in final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing".

# STARTUP VERIFICATION + PREREQ MERGE (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else STOP (S90). Save WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT. 3. `git -C "$WORKTREE_ROOT" status --short` clean.
4. **MERGE THE PREREQ LANDING (S112 — your worktree base is the session-start commit, STALE; it does NOT contain the Bug-1 fix you depend on):** `git -C "$WORKTREE_ROOT" merge --no-edit main`. Then PREDECESSOR-FILE CHECK: confirm Bug 1 is present — compile a `.Failed(LoadError::NotFound(id))`-in-`!{}`-arm reproducer and grep the emitted JS; the `"Variant" (` string-call mangle MUST be ABSENT. If the merge conflicts or Bug 1's fix is missing, STOP and report — do NOT build on a base without the prereq.
5. `bun install`. 6. `bun run pretest`.
## Path discipline (EVERY edit) — S99/S126
- ALL edits via Bash (perl/python3/heredoc) on WORKTREE_ROOT-absolute paths INCLUDING the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write tools. Echo path before; verify via git diff/grep after.
- NEVER `cd` anywhere; `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.

# COMMIT DISCIPLINE (S83) — commit per layer (parser / typer / codegen / spec)
First commit message includes startup `pwd`: `WIP(render-expr): start at <pwd>`. Commit each layer as it passes its tests. Before DONE: `git -C "$WORKTREE_ROOT" status` clean. Final report: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, per-layer status, the new §34 code name, deferred items.

# WHAT YOU ARE BUILDING — authority + the surface
RATIFIED S195 (design-insight top entry `~/.claude/design-insights.md`; deep-dive `scrml-support/docs/deep-dives/error-handling-holistic-2026-06-15.md` §6; debate `scrml-support/docs/debates/error-handling-display-gap-2026-06-15.md` §6). A NEW narrow render-expression primitive: **"fire this held value's `renders` contract here."** SURFACE (user-ruled S196): the **element form `<render of=X/>`** — a first-class scrml structural element, COHESIVE WITH the existing `<errors of=expr/>` element. Mirror `<errors of=>` everywhere.

Canonical use (the common locus — a `<match for=Phase>` arm that owns the held payload):
```
enum LoadError {
  NotFound(id) renders <p>No item #${id}.</p>
  Network(m)  renders <p>Net: ${m}. <button onclick=retry()>Retry</button></p>
}
<phase>: Phase   // Loading | Loaded(items) | Failed(LoadError)
<match for=Phase>
  <Loading>       <Spinner/>       </>
  <Loaded items>  <List of=items/> </>
  <Failed err>    <render of=err/> </>
</match>
```
It is a CONTRACT-FIRING primitive, never view-GENERATING. It does NOT touch `<errorBoundary>` (stays pure catch) and does NOT generalize the `renders` grammar (stays error-enum-scoped). Per Rule 4, read SPEC §19.2 / §19.6 (esp. §19.6.6) / §4.15 / §24.4 / §34 IN FULL before amending.

# THE FOUR LAYERS

## Layer 1 — PARSER (register `<render>` as a structural element; mirror `<errors>`/`<each>`)
- Register `render` in the scrml structural-element registry exactly as `errors` is: `html-elements.js` REGISTRY (mirror the `REGISTRY.set("errors", { tag: "errors", ... })` at html-elements.js:617) + `attribute-registry.js` ELEMENT_ATTR_REGISTRY (mirror `set("errors", {...})` at :299 — register the `of=` attribute). It is NOT an HTML element; the §24 HTML registry excludes it (mirror how `errors`/`each` are excluded).
- It is self-closing: `<render of=X/>`. One attribute `of=<expr>` (the held value). Block-splitter + tokenizer + ast-builder must recognize it alongside the other structural elements (verify the recognition path the `<errors>`/`<each>` add-element precedent uses — §162 `<each>` registration is the most recent add-a-structural-element precedent).
- Recognized in any markup position (most commonly inside a `<match>`/`<engine>` arm body, which is a code-default body §4.18 — confirm it parses there).

## Layer 2 — TYPER (the god-ification fence — REUSE §19.6.6/E-ERROR-005 logic)
- Resolve `of=<expr>`'s static type. It MUST be an enum value. If not an enum → a clear compile error.
- **Exhaustiveness fence:** every variant the value's static type can be (reachable at the site) MUST declare a `renders` clause. REUSE the per-variant scan at `type-system.ts:9206+` (the E-ERROR-005 loop: `for (const v of errType.variants) if (!v.renders) <error>`). The existing fire is gated to `bareCallee && inErrorBoundary && fnCanFail` — add a NEW trigger for the `<render of=>` element that runs the SAME per-variant loop over the resolved enum's variants. A reachable variant lacking `renders` → COMPILE ERROR (never a default, never a tag-string, never inference — this is the limit-primitives fence the design-insight mandates).
- **§34 code:** mint a NEW dedicated Error code with a locus-specific message (e.g. `E-RENDER-NO-CLAUSE` / `E-RENDER-EXHAUSTIVE` — pick a clear name, register in §34): *"`<render of=X>` requires every reachable variant of X's enum to declare a `renders` clause; variant `EnumType::Y` has none."* Also a code (or reuse a suitable existing one) for "`<render of=>` target is not an enum." Per Rule 4 the §34 rows land in the SAME change as the productions. Reuse the EXHAUSTIVENESS LOGIC; the new code gives a clean local diagnostic (this also replaces the wrong-altitude reflexes — see the H1 lint from the prereq dispatch).

## Layer 3 — CODEGEN (firing-site + data-arg change; reuse the boundary machinery; SIDESTEP the catch gate)
- Emit the per-variant renders switch against `<value>.data`. **REUSE `allVariantRenderExprs`** (emit-html.ts:637-647) — it builds the `variant → JS-render-expr` map via `emitBoundaryMarkupExpr(tpl, dataExpr, payloadFields)`. **`dataExpr` is ALREADY a parameter** (emit-error-boundary.ts:132 — boundary call sites pass the literal `"_eb_result.data"`). For `<render of=X/>`, pass `<X>.data` as `dataExpr` instead. This is a firing-site + data-arg change, NOT new infrastructure.
- Dispatch on `<X>.variant` → `el.innerHTML = (renderExpr)` — the same switch shape the boundary emits (emit-event-wiring.ts:1086-1092).
- **CRITICAL — SIDESTEP the `__scrml_error` gate** (emit-event-wiring.ts:1084 `if (_eb_result && ... _eb_result.__scrml_error)`). `<render of=X>` is a NEW fire site that calls the shared markup emitter DIRECTLY against the held value. Do NOT broaden the `__scrml_error` gate, do NOT pretend the held value was thrown, do NOT widen value-match to emit markup.
- **Structural template:** mirror the `<errors of=expr/>` dispatch at emit-html.ts:901-990 (first-class element with `of=expr` emitting synthesized markup into its mount) + its reactive consumer in emit-event-wiring.ts. When `X` (the held cell, or the bound match-arm payload) changes, the render-expr re-fires reactively. The match-arm bound payload is already threaded (the arm render fn RECEIVES the bound value `{variant,data}`) — verify against a `<match for=Phase>` arm where `of=err` is the bound payload.

## Layer 4 — SPEC (per Rule 4 — read the sections in full first)
- **§19.2** — amend: a variant's `renders` clause fires via the `<render of=>` render-expression from a HELD value, not ONLY via `<errorBoundary>` catching a live `!`-call. State `renders` is now "a value's display contract, fireable wherever you hold the value" — narrower in meaning, wider in reach.
- **NEW §19.x subsection** — define `<render of=X/>`: grammar, semantics (dispatch X to its enum's per-variant `renders` markup), the exhaustiveness fence (reuse §19.6.6 E-ERROR-005), codegen reuse note, and the explicit boundaries: SIDESTEPS the catch path (`<errorBoundary>` unchanged, stays catch-only §19.6.1); does NOT generalize `renders` to non-error enums (option d, rejected). Cross-ref §18.0.1 (the common arm locus) + §13.5 RemoteData (composes).
- **§4.15** structural-element registry + **§24.4** — register `<render>` (mirror the S162 `<each>` registry addition).
- **§34** — the new exhaustiveness code(s) row(s).

# VERIFY + R26 (this is a HIGH-impact codegen feature on the canonical route → S138 empirical mandate)
- Unit/integration tests per layer. Then `bun --cwd "$WORKTREE_ROOT" run test` (full suite) — zero new failures.
- **Empirical R26:** write a real `.scrml` exercising the canonical shape (the LoadError/Phase example above), compile via `bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile <repro> --output-dir /tmp/r26-render/`, confirm: (a) the emitted JS has the per-variant renders switch dispatching on `err.variant` against `err.data` (NOT `_eb_result`), (b) `node --check` exit 0, (c) the exhaustiveness fence FIRES (a variant missing `renders` → compile error), (d) `<errorBoundary>` codegen is UNCHANGED (diff the boundary emit vs pre-change). DO NOT mark DONE without empirical R26 passing.
- If a within-node parity canary moves (new parser form), report it; PA decides the allowlist rebump.
- PA lands via S67 file-delta + S147 coherence. Leave the worktree intact.
