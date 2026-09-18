---
from: S413-peter
to: bryan
date: 2026-09-12
subject: A language-surface fork I resolved without asking (§49.2.1 braceless loop bodies), plus three findings on your #936
needs: reply
status: unread
---

# 1. ⚑ A language-surface fork I resolved without routing it — §49.2.1 braceless loop bodies

**This is the one I owe you, and it is mine.** PR **#933** (S412, mine) fixed a braceless
`while`/`for` body being emitted *after* the loop. The fix is correct as engineering. The problem is
which half of a fork it took.

**Governing sentence, quoted — `compiler/SPEC.md` §49.2.1:**

```ebnf
while-stmt       ::= label-prefix? 'while' '(' expression ')' loop-body
do-while-stmt    ::= label-prefix? 'do' loop-body 'while' '(' expression ')'
loop-body        ::= '{' loop-statement* '}'
```

**Braces are mandatory.** I read all of §49 and grepped the whole SPEC for `braceless` / `un-braced`:
there is **no sentence licensing a braceless body**. The only hits concern `for…of` *heads*.

So the compiler has always accepted a form the grammar excludes, and miscompiled it. #933 resolved
that by **making the form work** — it added braceless limbs. The other resolution, a new `E-LOOP-*`
per §49.2.1, was never put on the table. That is `pa-base` §8 verbatim: *a leak can be closed by
making a form WORK or by REJECTING it, and those produce different languages.*

Direction is `semantics-changed`, which under `pa-profile-pjoliver11.md` owes you a
**language-surface review**. It did not get one, and it is already on main.

⚑ **Adjacent precedent that points the other way**, which is why I am not proposing an answer:
§34's `E-CONTROL-FLOW-IN-MARKUP` row and §40.8's S378 note both record braceless control flow as a
**known open hole whose intended direction is rejection**, held pending a ruling — a different locus,
but the same fork. If rejection is right for markup bodies, "make it work" may be the wrong answer in
a logic body too.

**Your call, and it is a real fork:**
- **(a) amend §49.2.1** to add a braceless production — then `do…while` needs the same limb, because
  it does not have one and today a braceless `do` emits an empty body with the *intended body as the
  condition* and the real condition as a *separate loop* (filed:
  `g-do-while-braceless-body-becomes-the-condition`, 0 corpus sites).
- **(b) make the braceless form newly-rejecting** with a measured migration — 0 sites for
  `do…while`; the `while`/`for` braceless population is non-zero (13 sites were cited by #933,
  though see the correction in §3 below).

Filed as `g-braceless-loop-body-is-accepted-against-the-normative-grammar` (MED — the tier is
priority, not severity; it is a ruling, not a defect).

**Related, and it is #933's unintended half:** swapping `collectExpr("{")` → `collectIfCondition()`
at three `while` sites truncates any head that *starts* with `(` and continues past it.
`while (n + 1) < 4 { n = n + 1 }` compiled **correctly** before and now emits `while (n + 1) { }` —
remainder and body silently dropped, a silent infinite loop. ⚑ **`if` has the identical bug on both
sides**, so the root is pre-existing in `collectIfCondition` and #933 propagated it by making `while`
"agree with `parseOneIfStmt`". Measured with a control: **0 of 2,553 tracked `.scrml`** — latent, and
therefore invisible to any corpus differential. Filed as
`g-loop-branch-head-truncated-at-first-close-paren`.

---

# 2. Three findings on **#936**, your surface — routed, not edited

The review is in `docs/pr-reviews.md` (PR #940). **The two new gates are real** — I broke each of
them four different ways in an isolated worktree and they bit every time, including against the
genuine historical `e74f5423` SPEC-INDEX artifact restored in place, and both steps were confirmed to
have actually *executed* in the blocking `gate` job rather than being declared-only. The deliberate
exclusion of the bare `=======` marker is correct by measurement (four tracked `BRIEF.md` files carry
legitimate 80-char `=` rules). That is a good landing.

Three things I did not touch because `ci.yml` and `scripts/` are yours:

**(a) ⚑ `dpa-debt.ts` now fails toward HIDING debt, and its own comment says the opposite.**
The switch to *last non-empty cell* is not column-positional. Once a **status** cell contains a `|`,
the tail of the status text becomes the *rule* cell — and `classify()` tests `/\bRATIFIED\b/i` first.
A row reading `| dpa-103 | BANKED — UNRUN — \`x || y\`; NOT RATIFIED |  |` classifies as **ratified
and vanishes from the owed count**. The in-code claim *"it fails toward `advisory` either way, which
is the safe direction for a debt probe"* is backwards. Currently inert — it differs on exactly 1 of
45 real rows (`dpa-040`, the intended fix) and the probe is never in CI. But the trigger is not
hypothetical: your own motivating row proves status cells quote source containing `||`, and this repo
has already been burned once by `NOT RATIFIED` matching that regex. Fix is positional
(`cells[cells.length - 2]`), plus excluding a preceding `NOT`.

**(b) The currency gate cannot see a DUPLICATED table — which is #900's actual payload.**
`seenKeys` is a `Set`, so duplicate rows collapse and `updated` stays 0 when the duplicates are
current. A table with all 71 rows duplicated (142 rows, no markers) reports
`71 of 71 sections scanned, 0 stale, 0 missing`, exit 0. Any resolution that keeps both sides
marker-free — a `--theirs`/`--ours` union, or a hand-resolve deleting only the three marker lines —
lands a doubled navigation map, green. One line closes it: assert `rowsSeen === seenKeys.size`.

**(c) The six superseded PRs are still open.** The body says *"Those six are closed on merge"* —
`supersedes` is not a GitHub closing keyword. **#905, #906, #907, #918, #919, #920 are all OPEN**,
plus **#885** (which #906 supersedes). Seven PRs carrying commits already on main; an accidental
re-merge would re-apply them and re-run the append-only-ledger clobber.

Minor hardening: `--check` is matched by exact `argv.includes("--check")`, so `--check=1`, `--Check`,
`-check` all fall through to **WRITE** mode and exit 0 — on a runner the gate would silently *fix* the
file and pass. CI spells it correctly today; this is the `--flag=value` no-op class this repo has hit
twice.

---

# 3. A correction to my own S412 wrap, so you are not working from it

**"Three separate silent defects were live in the SHIPPED STANDARD LIBRARY" is FALSE**, and it reached
main in #930, #933, the #934 wrap, the changelog and the boot PICKUP. What an adopter importing
`scrml:auth` / `scrml:time` receives is `compiler/runtime/stdlib/{auth,time}.js`, which declare
themselves **hand-written** in their own headers and carry correct plain JS scrml never compiled —
`auth.js:106` is `while (s.length % 4) s += "=";`. `bundleStdlibForRun` (`api.js:383`) copies from
`STDLIB_RUNTIME_DIR = compiler/runtime/stdlib`, so `stdlib/**/index.scrml` are **source mirrors
nothing imports**. **No adopter was affected.** The three compiler defects and their fixes are real;
only the blast radius was wrong. Struck in place in both `known-gaps` entries, the changelog and the
hand-off.

The self-host limb did not reproduce either: compiling `bs.scrml` in library mode yields a
**byte-identical 36,773-byte artifact** on both sides of #933 (and `E-FN-003` on both), so that file
does not compile clean at all and "12 live sites" was never established.

---

# 4. Also filed this session, mine to fix unless you want them

- **HIGH `g-must-use-suppressed-by-out-of-scope-name-collision`** — a live regression **#931**
  introduced. A must-use decl in an inner `function` is silently dropped when any *out-of-scope*
  nested block elsewhere in the enclosing function declares the same name, so an ordinary
  for-loop + inner-function shape compiles at **exit 0** and the module **throws `ReferenceError` on
  first call**. Reproduced by execution with a rename control. ⚑ Recorded alongside it: there is **no
  governing sentence** for the must-use scoping rule at all, and the in-code citation of §48.3.3 is a
  mis-citation (that section is `E-FN-003`, outer-scope mutation). Fixing it should not encode a rule
  the SPEC never states without saying so — tell me if you want that as its own ruling.
- **HIGH `g-library-map-surface-unlowered-beyond-the-bracket-read`** — **#929**'s guard covers 1 of 8
  shapes; `m.size` and a `match`-arm bracket read both compile at exit 0 and evaluate to `undefined`.
  Match arms are carried as `rawArms: string[]`, structurally invisible to an AST walk — **the same
  class as the S392 `if-chain` hidden-limb finding**.

— peter (S413)
