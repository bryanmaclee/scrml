# scrml — Session 281 (bryan) — WRAP

**Date:** 2026-07-22. Booted `/boot` Profile A, solo. Adopter issue **#141 ruled, built, verified and landed on a branch** — but **NOT merged**: `git push` does not work from this environment. bryan moved to the other machine mid-session with a conditional authorization ("once it lands clean. merge wrap push"); the review landed clean, the merge did not happen, and the reason is mechanical, not a judgment call.

---

## 🔴 READ FIRST — three things, in this order

### 1. PUSH IS BLOCKED ON `bryan-XPS-8950`. Nothing this session is on the remote.

`git push` hangs and dies with no output — **4 attempts, up to 9 minutes each**. Fetch works, `gh api` works, TCP 443 to github.com is fine.

**The sharpest clue: it is REPO-SPECIFIC, not credential-wide.** In the same session, on the same machine, with the same credentials:
- `../scrml-site` push → **SUCCEEDED**
- `../scrml-support` push → **SUCCEEDED** (board is on the remote)
- `scrml` push → **fails every time, silently**

So this is not simply Git Credential Manager or auth. Something about pushing to `bryanmaclee/scrml` specifically hangs — plausibly object-transfer size on a large repo over HTTPS, or a proxy/body limit. `credential.helper = manager` did hang the very first attempt with zero output, and `gh auth token` exits non-zero (emitting 142 chars matching no known token prefix), so the gh-as-credential-helper and `GIT_ASKPASS` workarounds both failed (`fatal: could not read Password`) — but neither explains why the two sibling repos push fine.

**Untried diagnostic, if it recurs on the other machine:** push an already-remote commit as a new ref (`git push origin a0344d75:refs/heads/probe`, zero objects to transfer). If that succeeds, the problem is object transfer/size; if it hangs, it is ref-creation on this repo. I did not run it here to avoid leaving a junk branch on the remote while bryan was away.

**On the other machine, do this — everything is committed and ready:**
```bash
git fetch origin && git checkout fix/each-multi-root   # or cherry-pick; 11 commits ahead of a0344d75
git push -u origin fix/each-multi-root
gh pr create --fill        # a full PR body is in the landing commit message ee6b6ea1
# wait for the cloud `gate`, then:
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only                # then verify coherence 0/0
```
`../scrml-support` (board `S281-bryan.md`) also has an **unpushed** commit. `../scrml-site` pushed **successfully** earlier in the session, so the reply to them IS delivered — the blockage appeared later, which is itself a clue worth noting.

### 2. `main` FAILS ITS OWN PRE-COMMIT GATE — pre-existing, verified at `a0344d75`

`bun test compiler/tests/{unit,integration,conformance} --bail` (the canonical gate, `scripts/git-hooks/pre-commit:17`) **bails** on main:

```
endpoint-conformance-integration.test.js → "the emitted .server.js is node --check clean"
  error: Command failed: node --check … SyntaxError: Unexpected token 'export'
```

Verified in a **clean detached worktree at `a0444d75`** with none of my changes: identical 11 pass / 1 fail. So #141 introduced no regression — but the project cannot pass its own commit gate. Suspected ESM-arc fallout (S278 U1 split `<endpoint>`/SSE emit into `generateHeadlessServerJs`); **UNVERIFIED, do not act on that hunch without checking.** Filed `g-main-red-against-its-own-pre-commit-gate` (HIGH). Note the cloud `gate` was green enough to merge 9 PRs at S280, so **the two gates disagree about the same tree** — decide which one is lying before "fixing" either.

### 3. THE COMMIT GATE IS NOT INSTALLED ON THIS MACHINE — and that is a PA miss

`core.hooksPath` unset, `.git/hooks` holds only `*.sample`. The profile documents this clone as **Config B (local-rich)** with pre-commit + post-commit + pre-push; that setup is **gone**. `pa-base` §9 makes verifying it a session-start step and **this boot skipped it** — so every commit this session, including the #141 landing, bypassed the gate silently.

The work is still covered (conformance 746/746, 20/20 unit, corpus byte-identity, adversarial review, real-Chrome both sides) — but *verified by other means* is not *gated*, and the ledger should say so.

**I did NOT auto-repair it**, deliberately: `scripts/git-hooks/install.sh` would install a gate that is RED on main (item 2), leaving the clone unable to commit at all. That fork is bryan's — fix the emit first, or install and accept a blocking gate. Filed `g-commit-gate-absent-on-bryan-xps-8950` (HIGH).

---

## 🎬 WHAT HAPPENED — #141, ruled and built same-session

**The defect.** An `<each>` body with >1 root element per item rendered only the FIRST; later roots were built, wired, then dropped by `return _itemFrag.firstChild;`. Clean build, no diagnostic. Adopter symptom: 32 day-headers, 0 rows.

**The reframe that mattered.** It is not an `<each>` rule. The Tier-0 `${for/lift}` path truncated identically, and a **non-reactive** Tier-0 multi-lift kept both roots with no `firstChild` at all — so the defect was the **`createFn`-returns-one-`Node` contract inside `_scrml_reconcile_list` leaking out as an apparent language rule.**

**Ruled a FIX, not an amendment** (governing-sentence gate): §10.8:6769 (`lift` MAY appear multiple times) + §17.7.2:11289 ("at least one per-item template element") ⇒ newly-accepting **toward the contract**. bryan chose N-roots over a named `E-EACH-MULTI-ROOT` because the wrap-in-one-root workaround is **unavailable** in `<table>`/`<dl>`/`<select>` — a wrapper `<div>` is foster-parented or dropped (the #131 class), so single-root-as-contract would make legal HTML inexpressible at Tier 1.

**Landed at `ee6b6ea1`** on `fix/each-multi-root` (agent branch `worktree-agent-a14165e93444dcd12` @ `1484d33f`; `progress.md` deliberately not landed). Design: codegen reads the root count off the emission — N===1 emits the pre-fix line **byte-identical**, N>1 returns the fragment; runtime `createFn` widens to `Node | DocumentFragment` with a keyed **group** per item across both container modes. A second Tier-0 change (`for-stmt`/`while-stmt` child forces the fragment return) is **named explicitly** in the commit rather than folded in silently.

**Verification:** byte-identity **0 normalized diffs** (66 programs PA, 62 independent); conformance **745→746** with a case whose delete button lives in root 2 so it hard-fails pre-fix; 20 new unit tests; full-suite fail set byte-identical to baseline; **real Chrome both sides** (pre-fix reproduces 4/0 exactly, post-fix 4/4). Adversarial review: **no blocking finding**, incl. a `Node.prototype.firstChild` runtime shim across 62 corpus programs (zero truncation events) and 1550 rounds of randomized reconcile stress against a DOM oracle.

---

## 🧭 OPEN THREADS

- **`chunk-namespacing`** — still the dispatchable arc; unblocks BOTH ESM U4 and the held classic Wave-1c loader. All 3 OQs ruled. `docs/changes/chunk-namespacing/SCOPING.md`.
- **The dep-`<script>` cluster just went from latent to adopter-confirmed** — `g-composition-strip-eats-last-dep-script` + `g-runtime-script-tag-not-depth-prefixed` are what actually kill scrml-site's pages. Priority relative to the freeze campaign has changed.
- **`e-markup-002-native-emit`** — parked native-parity deferral, not active.

## 📌 Gaps filed this session (9; HIGH 10→15)

HIGH: `g-each-multi-root-per-item-truncated` (fix landed, unmerged) · `g-static-component-import-dead-destructure` · `g-match-without-for-plus-when-children-silent-undeclared-dispatch` · `g-main-red-against-its-own-pre-commit-gate` · `g-commit-gate-absent-on-bryan-xps-8950`
MED: `g-tier0-reactive-lift-mixed-text-interp-literal` · `g-ssr-each-multi-root-client-only-fallback` (bryan ruled follow-up arc) · `g-each-root-count-coupled-to-emitted-text-formatting`
LOW: `g-foreach-lift-codegen-stage-rejection` · `g-reconcile-duplicate-key-inverts-intra-group-root-order` · `g-consolidated-lift-directreturn-first-lift-only`

## 🔬 METHOD LESSONS (the durable output)

- **A sweep gated on EXIT CODE silently dropped 36 of 79 files** that exit non-zero for environmental reasons (missing `.db`) while emitting a complete `client.js`. Gating on **the emitted artifact** took coverage 43 → 78. The first sweep looked thorough and measured the wrong thing — the S280 vacuous-evidence shape, recurring.
- **A characterization I filed was wrong, and bryan's question exposed it.** He asked what `$$` meant; chasing it showed the tier-0 defect is **ADJACENCY** (a literal touching `${`), not "mixed runs" — `${a} mid ${b}` is fine, `${a} x${b}` breaks. Corrected in-place with the correction called out, not quietly rewritten. (`$$` is NOT an escape — §4.18.3 uses `\${`; SPEC's own line 14262 writes `$${available}`.)
- **The adversarial reviewer over-claimed on invalid source.** It reported "`<match>` inside `<each>` is page-fatal"; its reproducer used invented `<when is=>` syntax. **Valid** `<match for=…>` inside `<each>` wires correctly. The real defect is invalid-source-not-rejected — a diagnostic gap, not an iteration-surface codegen gap. Compiler-bug vs dev-error must not be collapsed.
- **The byte-identity gate earned its place immediately** — it caught the dev agent's *own* nested-`<each>` `_itemFrag` shadowing defect before landing.
- **The maps deferral had a measurable cost.** S280 deferred the refresh; the stale maps described a **retired** `<each>` mount model, so any #141 dispatch briefed off them would have aimed at the pre-#131 design.

## 🧷 Held / retained

- `origin/evidence/u4-premise-falsified` — **do not delete.**
- `origin/worktree-agent-a2ed001a5de228134` + local `feat/wave1c-nav` — Wave-1c pieces 2+3, unblocked by chunk-namespacing.
- `claude-workflow` branch `incoming/bryan-XPS-8950` — **still awaiting the ASUS machine's union merge.** Until then `scrml-js-codegen-engineer` is NOT installed here and codegen dispatches take the `general-purpose` fallback (as #141 did — it worked well).
- Agent worktree `agent-a14165e93444dcd12` retained until the PR merges (forensic); `agent-a76caf383f74fb782` (maps) removed.

## Tags
#session-281 #adopter-141 #each-multi-root #push-blocked #main-red-against-own-gate #commit-gate-missing #adjacency-not-mixed-runs #reviewer-overclaimed-on-invalid-source
