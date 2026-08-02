# CN-1..CN-10 — the conformance set that pins the route-region ruling

**provenance:** `debate:soft-nav-outlet-lifecycle-model-2026-08-02` §8 · `ruling:` user-voice S313 ("ratify C")
**Status:** `scoping` — **specs banked, cases NOT yet authored.**

## Why banked and not authored

Per §62.2 the conformance corpus IS the versioned contract, so these cases ARE the ruling in its
enforceable form. They are not authored yet for one reason: **the impl does not exist.** §20.8.8 landed
Nominal/spec-ahead; the compiler still binds route-content lifecycle bodies to the `<program>` scope and
`_scrml_nav_apply_html` still performs no scope teardown. Authoring CN-1..CN-9 today would add nine
RED cases to a green suite — a permanently-failing gate, which is the pa-base §8 cry-wolf shape that
gets bypassed and then deleted. They land **with** the impl, exactly as a §34 code does (Rule 4,
named-codes-land-with-impl).

⚠️ **CN-10 carries a standing warning from the judge and it must not be lost:** *"Author it now, mark
Nominal — if it is never authored, the ruling silently becomes A."* CN-10 is the only case that
distinguishes the ratified ruling from Pole A. It is specified in full below so that the impl arc cannot
quietly ship without it; if the conformance harness gains a Nominal/expected-fail marker before the impl
lands, author CN-10 under it immediately.

## The set (verbatim assertions from the artifact §8)

| # | Case | Assertion | Pins |
|---|---|---|---|
| CN-1 | Owner split. Shell `on mount` → `shellHits`; route `on mount` → `routeHits`. Nav R→S→R. | `shellHits == 1 && routeHits == 2` | separates the ruling from Pole B; one program suffices |
| CN-2 | **Adopter witness.** Route mount `<request get="/api/tabs">`. Load → away → back. | **exactly 2** client fetches | encodes aM's finding; Pole B asserted 1 |
| CN-3 | Position-asymmetry equality. Identical `<request>` at route top level and inside `<div if="true">`. Nav a→b→a. | both fire the **same** count (2) | the ruling REMOVES the HEAD incoherence rather than trading which half is broken |
| CN-4 | **★ Leak stop.** Route `<poll every="1s">` writing a **shell** cell. Nav away; wait 3s. | **zero** further writes after leave | **FAILS AT HEAD** · ruling-independent · gates fix half (i) |
| CN-5 | `cleanup()` at leave, against live DOM. `cleanup(() => log.push(document.querySelector("#target") != null))`. | `log == [true]` | fires at leave AND observes live DOM (§20.8.8 step 2.5 before `innerHTML`) |
| CN-6 | Shell survival + depth-first inner teardown. Route has an `if=`-true subtree registering `cleanup()`, mutates a shell cell, then leaves. | inner four-step teardown depth-first BEFORE region release; shell cell **retains** value; **no** shell `cleanup()` fires | ownership boundary; folds in "shell does not re-mount" |
| CN-7 | Param-only nav. `/user/1` → `/user/2`. | route `<request>` re-fires with new params; **exactly one** leave/enter pair | `(route, params)` identity — separates from route-id-only keying |
| CN-8 | Supersede emits no edge. →R2, then →R3 before R2 resolves. | leave-edge count `== 1`; R2 **never enters**; an R1 button clicked in-flight still mutates its cell; **R1's `<poll>` ticked** during the window | commit-gating AND in-flight liveness |
| CN-9 | Enter fires once on initial load. Direct load of `/a`, route `on mount` counter. | `routeHits == 1` (not 0, not 2) | rules out double-fire at the mount/enter seam |
| **CN-10** *(Nominal — gates §20.8.4)* | **keep-alive re-entry.** `<page keep-alive>` + `<request>` + mount counter + 1s `<timer>`. Enter, dwell 3s, leave, re-enter within TTL. | no cold fetch; **timer resumes at phase**, not restarted at 0; pre-leave region cell values intact | **the case that makes C ≠ A** |

## ⚠️ Cases that become WRONG under the ruling — do NOT author these (artifact §8.1)

- **B-1** (`hits == 1` after a→b→a) — wrong; the ruling asserts 2 (CN-1).
- **B-2** (exactly 1 client fetch) — wrong; the ruling asserts 2 (CN-2).
- **B-3** (`if=`-inside-route seeding, `log == ["inner"]`) — wrong (`["inner","inner"]`), **and its proposed
  `_scrml_nav_rewire` chain-seeding fix MUST NOT be built** — the judge rates it the riskiest item on any
  pole's list (inferring logical branch state from rendered DOM shape ≠ re-seeding serialized cell values).
  Not building it is a saving, not a deferral.
- **B-4** (`on navigate` cardinality) — moot; no `on navigate` in v1. Retain the case SHAPE only if OQ-2
  ever mints a shell-only hook.
- **B-5** — half wrong: the "zero further fetches" half becomes CN-4; the `shellLog == []` half is wrong
  (the ruling asserts `cleanup()` fires at leave — CN-5).
- **A-1's annotation** ("C needs a second program shape to observe the mount counter") — wrong; CN-1
  observes it in one program.
- **A-4** — correct and retained, folded into CN-1/CN-6. **Keep the shell timer-tick assertion explicitly:
  it is the only case proving the ruling is not "destroy the world."**

## Open question that can still invert the ruling

**OQ-3**, and the error is **asymmetric**: ruling C and later cutting `keep-alive` leaves a harmless
extra noun; ruling A and then shipping `keep-alive` requires breaking a normative SHALL just written.
Re-open toward Pole A only if `keep-alive` AND nested outlets are BOTH cut permanently.
