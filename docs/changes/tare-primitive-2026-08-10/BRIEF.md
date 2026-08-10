# BRIEF — `tare(@cell)`: a statement-position reset baseline

**Dispatched:** 2026-08-10 (S337-bryan). **Agent:** scrml-js-codegen-engineer, `isolation:"worktree"`, opus.
**Base:** `origin/main` (post-#500). **Authorization + provenance:** bryan, S337, verbatim:
*"tare stores a thunk, keep the family coherent. go build it."*

---

## MAPS — REQUIRED FIRST READ

`.claude/maps/primary.map.md` first, then its Task-Shape Routing. Relevant: `primary.map.md`,
`structure.map.md`, `domain.map.md`, `error.map.md`. Refreshed this session (#495). Report whether
load-bearing — two prior dispatches found the diagnostic catalog and the emission phase absent from
every map, so "not load-bearing, and here is the hole" is a useful answer.

---

## WHY THIS EXISTS — the bug, and why every structural fix failed

`${ @x = 0   @x = @x + 1 }` — an IMPLICIT cell (`@x`, no `<x>` declaration) written twice.
`reset(@x)` **increments instead of restoring 0**.

PA-verified by compilation this session:
```js
_scrml_cs_reactive_set("x", 0);
_scrml_cs_init_set("x", () => 0);                                // write 1's thunk
_scrml_cs_reactive_set("x", _scrml_cs_reactive_get("x") + 1);
_scrml_cs_init_set("x", () => _scrml_cs_reactive_get("x") + 1);  // write 2 CLOBBERS it
```

**Two prior fix attempts were built and BOTH failed** (Peter, reverted to clean main — do not re-walk):
- *emission-order* (first thunk emitted wins) — a reassignment nested in control flow emits BEFORE a
  trailing top-level declaration, so it won and inverted reset. S239-confirmed.
- *source-order, direct-top-level-only* — fixed straight-line code but mis-counted markup control-flow
  children (`<if>`, `<for>`) as top-level → a NEW inversion, and left the bug live for any nested write.

**They failed because no structural rule can serve both intents.** These two are structurally identical
and want opposite answers:

| source | wants reset → |
|---|---|
| `@x = 0` then `@x = @x + 1` | **0** (first) |
| `@config = base()` then `@config = merge(base(), overrides())` | **merged** (last) |

The discriminator is INTENT, not form. §6.8 never says what `reset()` restores for a multi-write
implicit cell — **that silence is the defect.**

## THE KEY FINDING — the mechanism ALREADY EXISTS

PA-verified by reading the emitted runtime. `default=` does NOT use the init slot:
```js
_scrml_cs_reactive_set("x", 5);
_scrml_cs_default_set("x", () => 0);     // a SEPARATE slot
```
`_scrml_reset` resolves **default first, init second** (emitted runtime, verbatim comments):
```js
// Default thunk wins per §6.8.2
if (typeof _scrml_default_fns[name] === "function") { _scrml_reactive_set(name, _scrml_default_fns[name]()); return; }
// Otherwise re-evaluate init thunk per §6.8.1
if (typeof _scrml_init_fns[name]    === "function") { ... }
```

**Writes clobber `init_fns`. Nothing clobbers `default_fns`** — it is written once, by author intent.
So the bug is not "which write wins"; it is that **an implicit cell has no way to reach the default
slot**, because `default=` is an ATTRIBUTE and requires a declaration site (`<name …> = init`).
Confirmed: `${ @x default=0 = 0 }` fails `E-STATE-UNDECLARED`.

**This build adds the missing SURFACE over existing runtime machinery. It is not new machinery.**

---

## WHAT TO BUILD

Two forms, both statement-position, both in logic context:

```scrml
tare(@x)              // promote the cell's CURRENT init thunk into the default slot
tare(@x, <expr>)      // set the default thunk explicitly — the statement twin of default=<expr>
```

### Semantics — ruled by bryan, do not redesign

**`tare` STORES A THUNK, evaluated AT RESET TIME — identical to `default=`.** §6.8.1 is normative:
*"The `default=` expression SHALL be evaluated AT RESET TIME, not at declaration time. The attribute
stores the expression, not a snapshot."* `tare` SHALL match. **It is NOT a value snapshot.** bryan chose
this explicitly over capture-now to keep the family coherent, because two near-synonyms with divergent
evaluation timing is the shape this language has rejected before.

**Recommended lowering for the bare form — a pure RUNTIME promotion, no static analysis:**
```js
_scrml_default_fns[name] = _scrml_init_fns[name];   // e.g. via a new _scrml_tare(name) helper
```
This is deliberate: the compiler does NOT need to work out "which write is the baseline" — the author
placed the `tare()` call, and source position does the discriminating. **Do not reintroduce a
static last-write analysis; that is exactly what failed twice.** If you find a reason the runtime
promotion cannot work, report it rather than falling back to static analysis.

`tare(@x, expr)` lowers to `_scrml_default_set(key, () => expr)`.

Worked cases that MUST both hold:
```scrml
@x = 0
tare(@x)                                   // reset(@x) -> 0
@x = @x + 1

@config = base()
@config = merge(base(), overrides())
tare(@config)                              // reset(@config) -> merged
```

### Diagnostics (name them, land the §34 rows WITH the impl per Rule 4)

- `tare` on a **`const` derived** cell → error. `default=` on a derived decl is **E-DERIVED-WRITE**
  (§6.8.1 normative); mirror that, reusing the existing code if it fits rather than minting a new one.
- `tare` on an **undeclared / unknown** cell → reuse `E-STATE-UNDECLARED` if it fits.
- `tare(@x)` where the cell has **no init thunk yet** (tare before any write) — decide and DOCUMENT:
  a no-op, or a diagnostic. State your reasoning; do not leave it undefined.
- Bare `tare` used as an identifier is now a **reserved name**. `reset` has this precedent
  (`E-NAME-COLLIDES-RESERVED`). **Migration MEASURED ZERO** by the PA: `grep -rnw tare` over every
  tracked `.scrml` returns **0**. Re-verify before landing.

---

## RULE 4 + 4b — READ THIS, IT CHANGES WHAT YOU MUST PRODUCE

**Direction-of-change: NEWLY-ACCEPTING.** A form that did not compile now compiles. Per `pa-base` §8
that is a **ONE-WAY DOOR** — you can ask adopters to fix code, you cannot ask them to stop depending on
something accepted too early. It is therefore an **AMENDMENT, not a bug fix**, and it ships ONLY because
bryan ruled it at R2. Do not describe it in the SPEC or the commit as a fix.

**SPEC amendment REQUIRED** — a new subsection under §6.8 (§6.8.4 or the next free number), covering:
the two forms, thunk-not-snapshot semantics with the §6.8.1 cross-ref, default-beats-init precedence
(§6.8.2), the derived-cell prohibition, the reserved name, and a worked example of BOTH cases above.
Update `compiler/SPEC-INDEX.md` (regen: `bun run scripts/regen-spec-index.ts`).

**It SHALL carry, inline at the amended section:**
```
> **Provenance:** ruling:user-voice-scrml.md S337 — bryan, verbatim: "tare stores a thunk, keep the family coherent. go build it."
```
Rule 4b's load-bearing limb: also state why the rule you are EXTENDING (§6.8 `default=`) exists, so a
future reader sees `tare` as the statement-position member of an existing family rather than a new idea.

---

## VERIFICATION — before you report DONE

1. Full suite `bun test compiler/tests/{unit,integration,conformance} --bail` → 0 failures. The suite
   takes >5 min; a Bash timeout does NOT mean the commit failed — verify with `git show --stat`.
2. **EXECUTE, do not grep.** A client-runtime feature verified by grepping emitted text has shipped
   DOA here before (S265: a marker was present and the bundle threw a load-time ReferenceError).
   Compile both worked cases and **run the emitted client JS** so `reset()` actually executes; assert
   the counter yields **0** and the config yields **merged**. Paste the observed values.
3. Confirm the **structural** `default=` path is byte-identical to base (this must not perturb it).
4. Corpus regression: recompile the tracked corpus, diagnostic delta vs base must be **exactly** the
   intended new codes and nothing else. Report count + files.
5. Re-verify the `tare` reserved-name migration is still 0.

---

## PROCESS

- Commit after each meaningful unit + append-only `progress.md` here. Branch + progress.md are the only
  crash anchor.
- **Path discipline:** absolute paths under YOUR worktree root; never `cd` into the main checkout
  (`git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`). First action `pwd` — must start
  `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If not, STOP.
- **Worktree startup:** `bun install`, then `bun run pretest`.
- **NEVER `--no-verify`**; never touch `core.hooksPath`. Not authorized.
- **Do NOT edit `docs/known-gaps.md`** (PA-owned) — report what to file.
- If the design is wrong, or the runtime promotion cannot work, or this needs another ruling —
  **say so and argue against the brief.** That is sanctioned and has been the right answer twice
  in this session already.

**Report:** worktree path · final SHA · files touched · the EXECUTED runtime values for both cases ·
corpus delta · SPEC section added · maps load-bearing? · anything deferred.
