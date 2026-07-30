# #284 reverse-verify — reproducer set

**Filed:** S302, 2026-07-30 (bryan). **Verified against:** `ff57597f`; re-verified on `ebb6ca6f` after #283/#291 landed (#283 touched `emit-client.ts` +410, the adjacent surface — controls still place correctly, failures still 500).
**Gaps:** [[g-indirect-callee-never-server-placed-server-referenceerror]] (HIGH) ·
[[g-e-route-001-severity-contradicts-12-4-and-one-limb-never-fires]] (MED) ·
[[g-e-route-001-local-bind-workaround-defeats-check-without-reducing-risk]] (MED).

Adopter GH **#284** attributed a server-only-logic-ships-to-client bug to **computed-member access**
in a server function's body (`E-ROUTE-001`). **That attribution is wrong.** This set separates the
variables. Every file compiles **exit 0**.

## The controls — computed-member access does NOT break placement

| file | helper form | server fn body has computed-member? | result |
|---|---|---|---|
| `repro-A1-named-helper-CONTROL.scrml` | `function` | yes (`rows[0]`, `out[k]=…`) | ✅ helper server-placed; handler calls it; client gets only a fetch stub |
| `repro-A2-pure-fn-helper-CONTROL.scrml` | pure `fn` | yes | ✅ helper server-placed; body absent from client |

Both emit `E-ROUTE-001` and both place correctly. **The warning does not break the trace.**

## The failures — an indirect callee DOES break placement

| file | dispatch shape | computed member in the dispatch? | result |
|---|---|---|---|
| `repro-A3-computed-dispatch-FAILS.scrml` | `handlers[which](rows)` | yes | ❌ body → CLIENT; server `ReferenceError` |
| `repro-A4-plain-alias-FAILS.scrml` | `const p = groupByJob; p(rows)` | **no** | ❌ body → CLIENT; server `ReferenceError` |

**A4 is the decisive one** — no computed member anywhere in the dispatch path, identical failure. The
`E-ROUTE-001` warnings these two DO emit are about unrelated lines *inside the helper bodies*, so the
developer is pointed at the wrong place while the real defect is silent.

## Symptom B — the local-bind workaround

`repro-B-computed-member-call-arg.scrml` holds both shapes in sibling functions.
`out.push(caps[j])` fires `E-ROUTE-001`; `const cap = caps[j]` then `out.push(cap)` fires nothing —
same protected-field exposure, different node kind.

## Running it

```sh
# 1. seed the db (entries: id / job / amount)
python3 -c "import sqlite3;c=sqlite3.connect('i284.db');c.execute('create table if not exists entries (id integer primary key, job text, amount real)');c.commit()"

# 2. compile any repro
bun compiler/bin/scrml.js compile repro-A4-plain-alias-FAILS.scrml --output-dir out

# 3. grep is NOT the check — EXECUTE the emitted handler (S265 lesson)
bun run drive.mjs        # edit the import path to the artifact under test
# expected on A3/A4:  THREW: ReferenceError: groupByJob is not defined
```

`drive.mjs` seeds two rows, builds a CSRF-valid `Request`, and invokes the emitted route handler
directly. It is pinned at `outA3/symptomA3.server.js` — repoint the import for the other repros.

**Do not verify this class by grepping emitted text.** Both failing artifacts contain the string
`groupByJob`; only execution shows that the server bundle never *defines* it.
