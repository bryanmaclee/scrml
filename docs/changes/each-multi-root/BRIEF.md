# BRIEF — `<each>` / lift multi-root-per-item (adopter issue #141)

change-id: `each-multi-root`
dispatched: S281 (2026-07-22) · base `f6f763b4` (branch `fix/each-multi-root`, off main `a0344d75`)
DONE-PROBE: `bun test compiler/tests/unit/each-multi-root.test.js && bun conformance/run.ts --case each-multi-root`

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST (stamped `a0344d75` / 2026-07-22 — CURRENT as of this
dispatch, refreshed immediately before it). Follow its **Task-Shape Routing** section; it leads with
the two active surfaces, and the first one — the `<each>` codegen + runtime-reconciler row, with
file:line landing points — is exactly this task. Then read `dependencies.map.md` and `error.map.md`
for this shape.

Treat map content as a **verify-against-source hypothesis**, not truth. Report back which map content
was load-bearing — including "not load-bearing" if that is the honest answer.

⚠️ The maps were badly stale until this refresh and described a **retired** `<each>` mount model
(`<div data-scrml-each-mount>`, `W-EACH-TABLE-FOSTER`, api.js Stage 6.4f). Those are all GONE, retired
by `df6d269c` (#137). If you find any doc still describing them, it is stale — SPEC §52.15.5
(`compiler/SPEC.md:31594`) is a known instance and is **out of scope** here; do not fix it.

---

## The defect

Adopter issue #141 (pjoliver11, real app). An `<each>` body with **more than one root element per
item** renders only the **first** root. Every later root is built, wired, and silently discarded —
clean build, exit 0, no diagnostic. Found in a real grouped-list UI that rendered 32 day-headers and
0 rows.

**PA-verified at `a0344d75`, both halves — do not re-derive, but do re-confirm before you change
anything:**

1. `compiler/src/codegen/emit-each.ts:2191` — `return _itemFrag.firstChild;`. Every root IS appended
   to `_itemFrag` (including its live-keyed `_scrml_effect` bindings); only the first is returned.
2. The Tier-0 `${ for/lift }` path has the **same truncation** — emitted
   `_scrml_create_item_N` ends `return _scrml_tmp_M.firstChild;`.
3. **The truncation is a property of the reconcile path, not of the language.** A Tier-0 multi-`lift`
   loop over a NON-reactive plain array emits both roots and contains no `firstChild` call at all.
   Same authored source; whether your second element exists depends on whether the collection is a
   reactive cell.

So the real defect is the **`createFn` returns exactly one `Node`** contract inside
`_scrml_reconcile_list` (`compiler/src/runtime-template.js:1652`) leaking out as an apparent language
rule.

## Rule-4 governing sentences (quoted — this is a FIX, not an amendment)

Per `pa-base v2.4` §8, supporting N roots is a **newly-accepting** change, which may not ship as a bug
fix *unless* it restores conformance with a normative sentence that already exists. Two do:

> **SPEC §10.8 (line 6769):** "In accumulation mode, `lift` MAY appear multiple times in a single
> logic block; each call appends one item."

> **SPEC §17.7.2 (line 11289):** "The body of `<each>` SHALL contain **at least one** per-item
> template element OR the `<empty>` sub-element (or both)."

§10.8 is an explicit grant of N nodes per iteration at Tier 0. §17.7.2's "at least one" is weaker (its
job is to define `E-EACH-EMPTY-BODY`) but nothing anywhere rejects more than one. Classification:
**newly-accepting → toward the contract → conformance restoration.** Ruled by bryan S281.

Do NOT widen anything beyond what those sentences already grant. If you find yourself wanting to,
STOP and report instead.

## Required design

**1. Keep single-root emission byte-identical.** The per-item root count is statically known at
codegen (template children minus `<empty>`). When it is exactly 1, emit **exactly what is emitted
today** (`return _itemFrag.firstChild;`). Emit the fragment form ONLY when the count is > 1. This is
the cheap safety gate for the ~99% case and it is **assertable** — see Phase 3.

**2. Runtime accepts both.** `_scrml_reconcile_list`'s `createFn` may return a `Node` (today's
contract, unchanged) OR a `DocumentFragment` carrying N top-level nodes. Make the reconciler own a
node **range/group per key** instead of one node per key:
- stamp the item key on **every** top-level node of the group, not just the first;
- `_childList` / `_clearAll` / `_insert` / `_remove` / `_replace` become group-aware;
- the LIS reorder must operate on **groups** (one entry per key) and move all of a group's nodes
  together, preserving intra-group order;
- **both** container modes must keep working — range mode (`nodeType === 8` comment fence, the #131
  model) and element mode.

**3. Do NOT change create-time `if=` semantics.** `emit-each.ts:860` appends a conditional root at
create time only; a reused node group does not gain or lose roots on later reconciles. That is a
PRE-EXISTING limitation. Preserve it exactly, note it in your report, do not fix it here.

**4. Fix the Tier-0 lift path too.** §10.8 grants it explicitly, so leaving it truncating would leave
the same hole behind a different door.

**5. SPEC.** Add a normative statement to §17.7.2 making the N-root grant EXPLICIT (it is currently
only implied by "at least one"), and cross-reference §10.8. Keep it minimal — you are recording a
grant that already exists, not creating one. No new §34 code is needed.

## Phases

**Phase 0 — survey (report before building).** Confirm the three verified facts above on your own
baseline. Map every place the one-node-per-key assumption is encoded (reconciler internals,
`_scrml_item_by_key`, `_scrml_resolve_item`, the SSR path in `emit-ssr-render.ts`, nested-each,
`<empty>`). **If the real touchpoint set differs from what this brief names, correct it and say so** —
you are authorized to fix the brief's loci; do not stick to a wrong file.

**Phase 1 — implement** per the design above.

**Phase 2 — tests.** Unit tests at `compiler/tests/unit/each-multi-root.test.js` covering: 2 roots and
3 roots, keyed and unkeyed, `<each of=N>`, nested `<each>`, `<empty>` + multi-root together, reorder,
insert, remove, and the single-root regression. Plus a **conformance case** (`conformance/`, DATA-not-TS)
pinning the runtime half — a claimed surface is not landed without one.

**Phase 3 — empirical (R26) — DO NOT mark DONE without this passing.**
- Recompile real adopter sources on your post-fix baseline:
  `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>` over
  `samples/`, `examples/`, and `../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`.
- **Byte-identity assertion (the headline gate):** for every corpus program whose every `<each>` is
  single-root, the emitted client JS must be **byte-identical** to the pre-fix baseline. Capture the
  pre-image BEFORE you change code. Report the diff count. A non-zero count is a finding, not a
  rounding error — report it, do not explain it away.
- **Symptom check (not "tests pass"):** compile issue #141's exact repro (it is in the issue body, and
  a copy is at the bottom of this brief) and assert the emitted item builder no longer drops roots —
  grep the output, and state exactly what you grepped for.
- **Execute the bundle.** "Emitted ≠ runs" has caught a HIGH defect past a green suite at S265, S268,
  U3 and #131 — every time, only actually running the output caught it. Run the repro in a real
  browser (or at minimum execute the emitted module and assert the DOM node counts). If you cannot,
  say so plainly; do NOT claim a browser pass you did not perform.

## Working rules

**F4 — STARTUP VERIFICATION + PATH DISCIPLINE (do this FIRST, before any write):**
1. `pwd` — it MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does
   not, STOP and report; do not write anything.
2. `git rev-parse --show-toplevel` must equal that worktree root; tree must be clean.
3. `bun install` (worktrees do NOT inherit `node_modules` — the hook fails on `acorn` otherwise).
4. `bun run pretest` (populates gitignored browser-test fixtures; ~130 spurious failures without it).
5. Use `bun run test` for baselines, never bare `bun test`.
- Every write uses an **absolute path under the worktree root**. NEVER `cd` into the main checkout;
  use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
- First commit message must echo your startup pwd: `WIP(each-multi-root): start at $(pwd)`.

**Crash recovery:** commit after each meaningful change (WIP commits expected — the branch is the
checkpoint) and keep an append-only timestamped `progress.md` in the worktree: what you just did,
what is next, blockers. Never batch. A clean `git status` before you report DONE is mandatory.

**Never** bypass the pre-commit gate (`--no-verify`) — it is not authorized.

## Report back

- worktree path · final commit SHA · files touched · anything deferred
- Phase-0 survey result, including any brief loci you corrected
- the byte-identity diff count for single-root corpus programs
- exactly what you grepped for in the symptom check, and whether you executed the bundle
- which map content was load-bearing (or "not load-bearing")
- every place you chose to preserve existing behavior rather than fix it

Do NOT open a PR and do NOT merge. The PA reviews the file-delta, runs an independent adversarial
pass, and lands it.

---

## Issue #141 repro (verbatim)

```scrml
<program>

  ${
    <rows> = [
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 3, label: "c" },
      { id: 4, label: "d" },
    ]
  }

  <div class="keyed">
    <each in=@rows as r key=@.id>
      <div class="hdr">H${r.label}</div>
      <div class="row">R${r.label}</div>
    </each>
  </div>

  <div class="unkeyed">
    <each in=@rows as r>
      <div class="uhdr">H${r.label}</div>
      <div class="urow">R${r.label}</div>
    </each>
  </div>

  <div class="triple">
    <each in=@rows as r key=@.id>
      <div class="t1">1${r.label}</div>
      <div class="t2">2${r.label}</div>
      <div class="t3">3${r.label}</div>
    </each>
  </div>

</program>
```

Expected: 4 `.hdr` + 4 `.row`; 4 `.uhdr` + 4 `.urow`; 4 each of `.t1`/`.t2`/`.t3`.
Actual at `a0344d75`: 4 `.hdr` + **0** `.row`; 4 `.uhdr` + **0** `.urow`; 4 `.t1` + **0** `.t2` + **0** `.t3`.
