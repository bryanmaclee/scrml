# progress — §6.6.19 transitive server reach

Append-only. Timestamped. This file + the branch are the entire crash-recovery surface.

---

## 2026-08-11 — startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a17073292e367092e` (worktree, OK)
- `git rev-parse --show-toplevel` == pwd (OK)
- **DEVIATION FROM BRIEF, resolved:** the harness cut this worktree at `main` (`23ea2e5c`), NOT at
  `fix/derived-transitive-reach` @ `17b5849a`. `17b5849a` is a strict child of `23ea2e5c`
  (`git merge-base --is-ancestor 17b5849a HEAD` returned false; `fix/derived-transitive-reach` is
  main+1). Resolved with `git merge --ff-only fix/derived-transitive-reach` — a pure fast-forward,
  no content risk. Branch name stays the harness name `worktree-agent-a17073292e367092e`; PA lands
  by file-delta so the name does not matter.
- `bun install` OK (217 packages). `bun run pretest` OK (13 test samples -> samples/compilation-tests/dist/).
- Scratchpad: `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/b25a8ac0-1b30-4ff4-91f8-7347376e005a/scratchpad/dtr-fix/`

## Maps

- `.claude/maps/primary.map.md` read. **Load-bearing: invariant 50** (map line 22-28 + row 235).
  Confirms §12.2 Trigger 3 is per-FUNCTION and reaches no other position; the derived-cell half is
  closed by `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, #486) at `route-inference.ts:4429`; a
  mutable-cell INITIALISER and a MARKUP INTERPOLATION are still open and still leak at exit 0. That
  bounds this dispatch: the hop defect is in the derived position only, and I must not accidentally
  "fix" the two open positions as a side effect (separate rulings).
- Map stamp `616688ea`; HEAD is past it. Claims treated as hypotheses, verified against source below.

## BASELINE — reproducers compiled on this branch (compiler/src byte-identical to `main` at this point)

Sources in `…/scratchpad/dtr-fix/repro/`. Command: `bun compiler/bin/scrml.js compile <f> -o <dir>`.

| # | shape | exit | diagnostics | `.server.js`? | verdict |
|---|---|---|---|---|---|
| r1-direct | `const <h> = hashPassword(@pw)` | **1** | `E-DERIVED-SERVER-ONLY-REACH` | no | #500 working — MUST NOT REGRESS |
| r2-hop | `function doHash(p){return hashPassword(p)}` + `const <h> = doHash(@pw)` | **0** | none | **yes** | **DEFECT** |
| r3-sql-hop | `function countRows(){const r = ?{…}; return r.length}` + `const <c> = countRows()` | **0** | `W-DERIVED-001` only | **yes** | **DEFECT** |
| r4-multihop | `levelA`→`levelB`→`levelC`→`hashPassword` | **0** | none | **yes** | **DEFECT (3 hops)** |
| r5-cycle | `ping`↔`pong`, `pong` reaches `hashPassword` | **0** | none | **yes** | **DEFECT (through a cycle)** |
| r6-negative | pure-client `shout` | 0 | `I-FN-PROMOTABLE` | no | must STAY clean |
| r7-pure-cycle | pure-client `alpha`↔`beta` cycle | 0 | none | no | must STAY clean |

Emitted evidence (base):

- r2: `_scrml_cs_derived_declare("h", () => _scrml_fetch_doHash_3(_scrml_cs_reactive_get("pw")))`
  where `_scrml_fetch_doHash_3` is declared `async`. The derived cell's value IS the Promise.
- r4: `_scrml_levelA_5` and `_scrml_levelB_4` are BOTH emitted `async` (codegen's
  `scheduling.ts` transitive async coloring DID colour them) → same Promise-valued derived cell.
  **This is the load-bearing asymmetry: CODEGEN colours async transitively, ROUTE INFERENCE
  refuses only directly.** The two stages disagree about the same source.
- r3: a different lowering — `W-DERIVED-001` (no reactive deps) →
  `const c = _scrml_fetch_countRows_3();` — a plain `const` holding a Promise, no
  `derived_declare` at all. Same failure class, second emission route. Good: it proves the check
  must key on the AST decl, not on the emission shape.

### Incidental finding (OUT OF SCOPE — reported, not fixed)

My first r5 draft used `given k <= 0 { return hashPassword(p) }` inside a function body. It emitted
`if (k !== null && k !== undefined) {\n}` — **the block body, including the `return`, was dropped
entirely**, and `hashPassword` vanished from every artifact at exit 0. That may simply be me
misusing `given` (a presence check, not a general conditional) — but a misuse that silently
DELETES a `return` statement is still a silent statement-drop. Not chased; flagged here so it is
not lost. Reproducer text is in this progress entry, not on disk (r5 was rewritten).

## r8 — an over-refusal probe that turned into a SECOND live defect on main

```scrml
${ import { hashPassword } from 'scrml:auth' }
<pw> = "abc"
function label(s) { return "v:" + s }               // pure string concat
function store(p) { return label(hashPassword(p)) } // server (Trigger 3)
const <shown> = label(@pw)
<button onclick={ store(@pw) }>go</button>
```

Base: exit 0, and the emitted client is

```js
async function _scrml_fetch_label_5(s) { … await _scrml_fetch_with_csrf_retry("/_scrml/__ri_route_label_1", …) … }
_scrml_cs_derived_declare("shown", () => _scrml_fetch_label_5(_scrml_cs_reactive_get("pw")));
```

**`label` — `return "v:" + s` — is placed on the SERVER and reached over HTTP.** Step 5c's
caller-context fixpoint promoted it because its only *function* caller (`store`) is server, and a
derived-cell RHS reference is not a caller edge. So today main emits an HTTP round trip to do a
string concatenation, and hands the derived cell the Promise.

**This is Step 5c FIX B's hole.** FIX B (`route-inference.ts:5133`) already excludes a helper
referenced from client MARKUP from indirect promotion, with the stated reason *"that turns a
synchronous render into a blanking async fetch."* A derived-cell RHS reference is the identical
argument in a stronger form (not a blank — a Promise, permanently). `markupReferencedNames` is
built by `walkMarkupContext`, which collects from markup attrs / text / bare-exprs only; a
`state-decl` RHS is none of those, so a derived reference contributes nothing.

### Disposition (decided, with the alternative surfaced)

Three candidate answers for r8:

1. **Refuse it** (what this dispatch builds).
2. **Under-refuse** — only fire when the chain ends at a fn with a *direct* server trigger. r8 keeps
   miscompiling silently.
3. **Extend FIX B** — a derived-cell RHS reference vetoes 5c/5b promotion, so `label` stays client
   and r8 compiles *correctly*.

Chose **1**, and REJECTED 2 because it knowingly leaves a measured miscompile silent (pa.md Rule 2).
**3 is the better long-term answer for the 5c-promoted sub-case and is DEFERRED as a separate
ruling** — it is a placement change, not a diagnostic, it can move corpus artifacts, and "may a
derived-cell reference veto server promotion?" is a design question this dispatch was not given.
Refusing r8 is not rejecting working code: **r8 is broken today.** Refusing a broken program beats
compiling it wrong, and it is the reversible direction.

Consequence for the message: the chain terminus can be a *propagated* placement
(`resourceType: "caller-context-propagation"` / `"closure-capture:<name>"`), whose fix differs from
a direct trigger's. `describeServerTrigger` renders those as "the server-only resource
`caller-context-propagation`" — an internal token in an adopter's face — so the terminus needs its
own describer.

## Message design — the brief is imprecise on one point, and I am correcting it

The brief says extend the refusal "with the same reasoning". The reasoning is the same; **the FIX is
not**, and the existing message's fix line is actively wrong for the transitive case:

- **Direct** (`const <h> = hashPassword(@pw)`): confidentiality failure — the module ships to the
  browser. Fix = *"move the call into a `function`"*.
- **Transitive** (`const <h> = doHash(@pw)`): confidentiality is INTACT. Correctness failure — the
  recompute is a round trip and the cell holds a Promise. The author **already** moved the call into
  a function; telling them to do it again names no root cause.

So: ONE code, TWO limbs. The direct limb's message stays byte-identical (SPEC §6.6.19's worked
example and the conformance cases pin it); the transitive limb gets the hop chain and the correct
fix. Considered and rejected a second §34 code: §6.6.19 is one rule ("a derived cell cannot host
server work"), a second code fragments it across the catalog, `notCodes` lists, docs and the LSP,
and the catalog is already at 807. Surfaced as an alternative in the report.
