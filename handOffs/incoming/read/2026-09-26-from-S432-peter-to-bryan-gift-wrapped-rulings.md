---
from: S432-peter (P-Tech1)
to: bryan
date: 2026-09-26
subject: "six rulings, each pre-built on a hold ref — most are one word + one merge"
needs: ruling
status: unread
---

# S432 → bryan: gift-wrapped rulings

Each item below comes with a verified repro, the SPEC sentence it turns on, a recommendation, and the fix
already built on a `hold/` ref. So a yes means merging one branch. Review status is stated per item; don't
merge anything marked UNREVIEWED without a pass.

## 1. Should `scrml dev` / `scrml serve` listen on loopback by default? — `hold/s432-dev-server-localhost-default` `cb9e0ac6` (reviewed twice → LAND)
- **Today:** both commands bind every interface. The compile-error overlay is reachable from the LAN. It
  carried db secrets until #1055. `serve`'s `/compile` and its unauthenticated `/shutdown` are also exposed.
- **Recommendation:** default to `127.0.0.1` + `::1` on the same port.
  - `--host <addr>` / `--host=<addr>` opts in to that address.
  - A bare `--host` means every interface (`0.0.0.0` + `::`, as Vite does) and prints one "reachable from
    the network" line.
  - A bad host exits 1 with the host named.
  - Every listener goes through a single `listen()`, and a structural test enforces that.
- **Blast radius:** anyone opening the dev server from a phone, a VM or another machine now adds `--host`.
  Local users see no change.
- **Yes = merge.**

## 2. Should a bare `when` at body-top be lifted or diagnosed (§40.8)? — `hold/s432-bare-when-body-top` `f226d21e` (A, recommended) / `-alt` `dd46fdba` (B) (reviewed; findings fixed, not re-reviewed)
- **Today:** a `when @x changes {…}` at `<program>`/`<page>`/`<channel>` body-top is logic only when it
  shares a text run with a preceding declaration. After markup, after `${}`, after a comment, or first in
  its run, it ships silently as page text.
- **SPEC:** §40.8 S378: "whether any further shape is logic rather than text is an open operator question
  per-shape".
- **Recommendation (A):** lift `when` by its grammar head, alongside the existing GITI-029 `on mount {`
  lift. The emit matches the working position byte for byte.
- **Alternative (B):** `E-WHEN-NOT-IN-LOGIC-CONTEXT`. Its weakness is that a shared-run `when` is still lifted
  silently.
- **Blast radius:** 0 corpus files. Head-shaped prose at body-top becomes a loud error; the SPEC text says so.
- **Yes (A) = merge `hold/s432-bare-when-body-top`.**

## 3. Q5 — should cells be deep-reactive (§6.5.6/§6.5.7)? — `hold/s432-q5-deep-reactive-cells-spec` `bfcf8e89` (round-1 review → land after fixes; fixes NOT re-reviewed)
Replaces `hold/s429-deep-reactive-cell-writes`.
- **Today:** the runtime makes literal cells deep-reactive (the Bug-64 tests assert it). Computed writes
  store raw values, so an edit to a `.map`-replaced `<each>` row never reaches the DOM (HIGH, silent).
- **Recommendation (a):** amend §6.5.6/§6.5.7 to match the runtime.
  - Deep reactivity applies to the markup tier only. `when`/derived still fire only on writes to `@x`
    (#1054 unchanged).
  - It also fixes the Date/Map/Set crashes on main.
  - Cost: +65 B gzip.
  - The identity and raw-reference non-guarantees are now written into the SPEC.
- **Cost to weigh:** Proxy traps on every read of computed cells.
  - 10k-row `.map` ×20: ~30 → 490 ms.
  - A realistic 10k-row page: 15–50% slower.
- **Option (b)'s blast radius:** 3 function sites in aM, 0 in flogence. It would also need its own
  implementation.
- **Yes (a) = merge.**

## 4. Is the non-arrow `${s1; s2}` handler legal? — `hold/s432-expr-handler-multi-stmt` `1b7018e2` (i, recommended) / `-alt` `121fb74c` (ii) (**UNREVIEWED**)
- **Today:** only statement 1 runs when it is a call. `<each>`/lift rows keep only statement 1 for every
  kind. Value attributes silently take the first statement's value.
  - The gap is carried under P7 with an xfail pin.
- **SPEC:** §5.2.1/§5.2.2 never list the shape. §5.2.3 errors on the bare form only.
- **Recommendation (i):** legal, and every statement runs (`${}` is logic context everywhere else).
- **Alternative (ii):** E-MULTI-STATEMENT-HANDLER.
- **Both branches also:** add E-ATTR-MULTI-STATEMENT for value attributes and make block arrows in
  `<each>` rows actually invoked.
- **Blast radius:** 3 corpus uses, 0 adopter uses.
- **Needs an S239 pass before merge.**

## 5. Q6 — a `<match>` in an engine state-child: (A) refuse or (B) support? — `hold/s429-match-in-engine-state-child` `e0ac22d6`
- **Landed on main (#1060):** the fork-independent half of this hold — the closer-stack parser fix — plus
  `W-ENGINE-MATCH-IN-STATE-CHILD`. The warning states the measured behaviour: the match is blank on every
  entry after page load. The workaround is an `<div if=…>` outside the engine.
- **The hold ref now carries only the fork half.**
- **What your ruling does:**
  - (A) promotes the warning to an error and retires the hold.
  - (B) deletes the warning and lands the hold. Rebase it first and drop its parser hunks.
- **The new §34 row needs your approval either way.**

## 6. `defer` SPEC calls (post-merge review of #1051) — `hold/s432-defer-spec-calls` `2d5ed0f9` (B reviewed → LAND)
**⚑ It is built on `fix/s432-defer-review-findings` `acc25427`, which is HELD. Its round-2 review found 2
MED silent misses in the rule-4 coverage (an exported component; a `<channel>` `<onchange>` arm). Peter's
next session fixes that first.**
- **B1:** exempt a nested `function x` over parameter `x` from E-SCOPE-REDECLARE.
  - §7.3.3 claims it "rejects only programs that already failed at codegen", and this program ran.
- **B2:** `E-DEFER-AMBIGUOUS-LEAD` when `defer [` is written while a binding named `defer` is visible.
  - Visibility comes from one completeness-tested binder table, including match-arm payloads.
- **B3:** §19.16.2 now says "cannot rebind WHICH value is returned; contents are not frozen".
- **A2:** native's rejection of `defer` in a braced match arm is recorded as a second §19.16.8 divergence.
- **Yes to all four = merge the hold after A lands.**

## Also for you (filed on main, not ruling-gated)
- **`g-user-fn-rename-rewrites-emitted-helper-locals`** (HIGH): a user `function e()` hijacks the emitted
  worker send wrapper, so every worker reply is `undefined`.
  - Fixed at that one site only, on the Q5 hold.
  - The class fix is a reserved `_scrml_` namespace for emitted code. That ties to Q7.
- **`g-regex-statement-after-block-closer-lexed-as-division`** (HIGH): needs a four-lexer coordinated fix,
  including self-host-v2.
- **Deleted as superseded:**
  - `hold/s427-lift-body-lowering` `089c0414` (by #1032)
  - `hold/s429-when-changes-honours-dep-list` `2eecc899` (by #1054)
  - `hold/s429-deep-reactive-cell-writes` `58b90cfc` (by the Q5 hold)
