# BRIEF — SPEC-write: `get_style_provenance` (Ask #7), with the 4 forks RULED

change-id: `ask7-style-provenance-spec`
authored: 2026-08-04 (S316-bryan) · agent: **`general-purpose`** (iso worktree, opus, bg)
> Deliberately NOT `scrml-js-codegen-engineer`: this arc is **pure SPEC text**, no `compiler/src`
> change. The generalist fallback is sanctioned for classification-insensitive spec-text work.

adopter: **flogenceP** (handle only — no org/app/personal names in any artifact; pa-base §1)
source ask: `handOffs/incoming/2026-08-03-from-flogenceP-ask7-reactivate-value-tier-exhausted.md`
DONE-PROBE: bun scripts/regen-spec-index.ts --check
probe-intent: SPEC-INDEX totals + section table regenerate cleanly over the new section.

---

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` in full; follow §"Task-Shape Routing".

**Map currency:** stamp `e80b692e`; HEAD is past `a1f380d3`. **Ten+ codegen/ast-builder commits have
landed since the stamp** (#385–#395). This is a spec-text task so the drift is mostly harmless — but
every file path this brief names is one you MUST verify against source before citing it in normative
text. See the corrected-premise section: one path the adopter cited does not exist.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: `<ABSOLUTE-WORKTREE-PATH>` (echo your real `pwd` and use THAT).

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise
   STOP and report (S90 CWD-routing failure). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`. 3. `git status --short` clean. 4. `bun install`.

**Edit via Edit/Write on WORKTREE-ABSOLUTE paths.** Ignore older briefs mandating Bash-only edits —
that S126 mitigation is RETIRED (S314). Never `cd` into the main repo; use `git -C "$WORKTREE_ROOT"`.

**CRASH RECOVERY:** commit after every meaningful edit; append-only `progress.md` under
`docs/changes/ask7-style-provenance-spec/`; clean `git status` before reporting DONE.

⚠️ **`compiler/SPEC.md` is a HOT DOC** (~37k lines, and it does not fit in one Read). Use targeted
`offset:`/`limit:` reads via `compiler/SPEC-INDEX.md`. Never full-file rewrite it; Edit's diff form
scales, whole-file Write does not.

---

# WHAT THIS IS

An adopter-pull re-activating Ask #7 — compiler-derived **element → source → token provenance**, emitted
as a read-only sidecar so an external styling tool can answer *"which token restyles this element, and
what source line declared it?"*

**Status, verified against the tree 2026-08-04:** `get_style_provenance`, `data-scrml-sid` and
`style-provenance` appear **0 times** in `SPEC.md` and **0 times** in `compiler/src/`. Filed and acked,
ratified-in-principle, parked v-next — **never specified, never built.** The adopter's own status
reconciliation was accurate, including a self-correction of an earlier overstatement on their side.

**Scope of THIS arc: SPEC text only.** Write the normative section. No implementation, no codegen, no
`compiler/src` edit. The impl is a separate arc gated on this section landing (Rule 4: §34 codes land
WITH their emitter, so name codes as Reserved here and let the impl wave wire them).

# ⚠️ A PREMISE THE ADOPTER GOT WRONG — do not repeat it in normative text

Their scoping says three seams already exist, making this "a sidecar emit + ONE new element-stamp, not
a new pass." **Two of the three verified; the third does not exist:**

| claimed seam | verified? |
|---|---|
| spans in `compiler/src/types/ast.ts` | ✅ `Span { file, start, end }` |
| per-decl token resolution `emit-theme-reset.ts` `lowerCssValueRefs` | ✅ wired via `emit-css.ts:250` |
| **the byte→line/col bridge `compiler/src/srcmap-provenance.ts`** | ❌ **NO SUCH FILE** — nothing matching `srcmap\|provenance` exists in `compiler/src/` |

The byte→line/col *logic* exists but is **scattered across three unrelated files**
(`tailwind-classes.js`, `lint-ghost-patterns.js`, `ast-builder.js`), with no shared module. So "the
bridge exists" is false, and consolidating three ad-hoc implementations into one correct bridge is real
work those three call sites would have to agree on. **Do not write "reuses the existing bridge" into
SPEC.** State the dependency honestly, or leave the bridge unnamed and let the impl arc scope it.

---

# THE 4 FORKS — RULED (S316, bryan-delegated)

`provenance: ruling:user-voice-scrml.md S316 — "rule the forks, then brief the spec-write"`

Each ruling below carries its reasoning so it can be overturned on evidence rather than re-derived.

## Fork 1 — sid identity: **NONE of the three as posed.**

**RULED: the sid SHALL be a STRUCTURAL PATH address — stable under a value-only source edit. The byte
span rides as a PAYLOAD field, never as the identity.**

The fork offered byte-span vs AST-node-id vs counter. **All three are compile-local identities, and the
consumer needs a cross-compile one** — which is why none of them can be the answer:

- **byte-span** — `Span.start` is a byte offset; ANY edit earlier in the file shifts it.
- **AST-node-id** — `BaseNode.id` is `++counter.next`, documented verbatim as *"Unique numeric ID
  **within the compilation unit**"*. Any structural insertion earlier in traversal order shifts every
  subsequent id.
- **counter** — the same object as the above.

The consumer's whole loop is *tune → export → **apply-back into source** → recompile*, so the identity
must survive a source rewrite. Their apply-back is **value-only** (token values + per-element overrides;
never structure), so a **structural** address survives it precisely where offsets and counters do not.
Its instability under a *structural* edit is correct behaviour, not a defect — the element genuinely
moved.

Keeping the span as payload is what still answers their gap #2 (*"`src` is the compiled selector, not
the original source line"*) — you get true source-line provenance without a self-invalidating key.

**Overturn condition:** if a cheaper derivation is provably stable across a value-only edit, take it.
But a compile-local counter or a raw byte offset cannot be the identity for a cross-compile consumer,
and this ruling stands until that specific claim is falsified.

## Fork 2 — one facet or two: **ONE shared address primitive.**

**RULED: one address primitive; the style facet is a PROJECTION over it, not a second scheme.**

Limit-primitives says don't generalise on one consumer — but two are attested (floStyle + grounded
authoring's structural facet). Two independent facets means two addressing schemes to keep in sync, and
drift between them is the failure mode, not god-ification.

**GATE (write this into the spec's scope note):** the shared primitive is justified by a SECOND
consumer with a **live call site**, not a plan. If the second consumer cannot name one, the section
ships the style facet alone and the general primitive waits.

## Fork 3 — stamping cost: **dev-only, opt-in.**

**RULED: `data-scrml-sid` stamping is gated behind a `<program>` boolean opt-in attribute, mirroring
`<program mcp>` (`compute-program-config.ts:52`, verified precedent). NOT always-on.**

Per-element attributes in production HTML for a dev-tool capability is the wrong trade — the SPA runtime
gzip budget is already a knife-edge open HIGH (`g-spa-runtime-gzip-budget-knife-edge`). The opt-in
precedent exists, is verified, and is exactly this shape.

## Fork 4 — non-promotion: **already answered; not a fork.**

**RULED: the sidecar is a NAVIGATION artifact and SHALL NOT be a gate. Write it as normative text and
cite the precedent — do not re-litigate it.**

scrml settled this for `dock` at **dpa-010**: *"dock is NAVIGATION, never the GATE — a dock record can
be well-formed and `verified` and still be wrong about WHY; the executable test-gate is the truth."*
Same shape, same answer. `token-set.json` (`compiler/src/token-set.ts`, *"a CHEAP, READ-ONLY
projection"*) is the emit-side precedent for a per-compile sidecar that gates nothing.

The adopter flagged this as a hard invariant they hold; they are right, and scrml already agreed one
level up. Surface it as **answered**, naming the option that was never on the table.

---

# WHAT TO WRITE

1. **A new SPEC section** for the provenance sidecar. Pick the number from `SPEC-INDEX.md` — ⚠️ **verify
   it is genuinely unclaimed**; S314 nearly landed at a taken number (§20.8.3 was Link-boost) and had to
   renumber. Do not renumber a shipped section.
2. Normative content: the sidecar's shape + emit trigger · the **structural-path sid** (Fork 1) with the
   span as payload · the `<program>` opt-in attribute (Fork 3) · the **never-a-gate** invariant (Fork 4,
   citing dpa-010) · the one-primitive/style-projection model + the live-call-site gate (Fork 2).
3. **Codes NAMED + Reserved only** — §34 rows land WITH the emitter (Rule 4), not here.
4. A `> **Provenance:**` line under the section banner per Rule 4b, pointing at this ruling.
5. Mark the section **Nominal / spec-ahead-of-implementation** — it is spec-before-impl by design.
6. Regenerate `SPEC-INDEX.md` (`bun scripts/regen-spec-index.ts`) and confirm the totals gate passes.

# DIRECTION OF CHANGE

**Additive / inert.** A new Nominal section changes no existing program's meaning or acceptance status.
It is NOT a §62 version event. If you find yourself amending an EXISTING normative sentence, STOP — that
is outside this arc and wants its own ruling.

# REPORT BACK

- The section number chosen and the evidence it was unclaimed.
- Whether the corrected premise (no `srcmap-provenance.ts`) changed anything you wrote.
- Whether any ruling above proved unwritable as stated — say so; they are rulings, not scripture, and a
  ruling that cannot be expressed normatively is a ruling that needs revisiting.
- Anything this brief got wrong.

# DO NOT

- Do not implement. No `compiler/src` change, no codegen, no `data-scrml-sid` stamping.
- Do not write the non-existent `srcmap-provenance.ts` into normative text.
- Do not add §34 rows for codes with no emitter.
- Do not name the adopter's org, app, or personal handles. The handle is **flogenceP**.
- Do not `git push`, open a PR, or touch `main`.
