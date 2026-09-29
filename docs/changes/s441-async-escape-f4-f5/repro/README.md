# s441-async-escape-f4-f5 — reproducers

Base: compiler at `cf62b4154` (origin/main; worktree HEAD `f1e598c09` = base + BRIEF only).

Commands (from the worktree root):

```
bash docs/changes/s441-async-escape-f4-f5/repro/run.sh <label> '<glob>'     # compile + grep emitted JS
python3 docs/changes/s441-async-escape-f4-f5/repro/gen-f4.py              # regenerate f4-*.scrml
bun docs/changes/s441-async-escape-f4-f5/repro/exec-server.ts <compiled-dir>  # f4-nested-*: REAL hashing
```

`run.sh` compiles with `bun compiler/bin/scrml.js compile <f> --output-dir <scratch>/<label>/<name>`.

## F5 — server call in inline-handler / on-mount body tests an un-awaited Promise

| file | expected | actual at base |
|---|---|---|
| f5a-inline-handler-if | `if (await _scrml_fetch_isOk_…(1))` in an async handler | `function(event) { if (_scrml_fetch_isOk_4(1)) {` — Promise, always truthy → "accepted" |
| f5b-block-handler-if (`onclick={ … }`) | same | same bare call |
| f5c-on-mount-some | `.some` lifted to the awaited combinator | `[1, 2, 3].some(x => _scrml_fetch_isOk_3(x))` → true for every input |
| f5d-on-mount-nested-helper | `inner` async + `if (await inner(1))` | `function inner ( x ) { return _scrml_fetch_isOk_3 ( x ) }` (raw text, not async) + `if (inner(1))` |
| f5e-on-mount-if (control) | awaited | `if (await _scrml_fetch_isOk_3(1))` — already correct |

Runtime proof: conformance cases `conformance/cases/server-db/s441-*-runtime` (serverStub `isOk: false`)
render "accepted" at base.

## F4 — async-colored fn escaping as a VALUE

Three families × five value positions (`alias`, `objfield`, `arrayelem`, `userhof`, `arrayfrom`):

- `f4-nested-*` — a helper `m` declared inside a SERVER fn wrapping `scrml:auth` `verifyPassword`.
  All compile clean at base. `exec-server.ts` with a REAL `hashPassword("right")` hash:
  **`check("wrong", hash)` → "accepted" for all five** (and "accepted" for the right password —
  the check answers the same for every input).
- `f4-client-serverfn-*` — a client fn referencing a file-scope server fn `m` by value (route
  inference escalates it to the server; `m` is the async peer). All compile clean. Emitted:
  `const fs = [m]; return fs[0](1) ? …`, `Array.from([1], m)`, `drive(m)`; alias/objfield happen
  to get `await g(1)` / `await o.f(1)` (an incidental server-side await of an unknown call).
- `f4-client-helper-*` — a CLIENT helper `m` that calls a server fn. `alias` already fails
  (`E-ASYNC-STDLIB-IN-SYNC-CALLBACK`, the S239 alias backstop — wrong code family for a
  server-rooted helper); the other four compile clean, e.g. sync `_scrml_decide_6()` returns
  `fs[0](1) ? "accepted" : …` on a Promise.

Expected (ruled S440 F4): every value-position escape is a compile error.

## FP1 — #1139 raw-text scan false positives (server)

| file | expected | actual at base |
|---|---|---|
| fp1a-string-text (`"m(" + x` in a block-body callback) | compiles | E-ASYNC-STDLIB-IN-SYNC-CALLBACK |
| fp1b-member-call (`o.m(x)`) | compiles | E-ASYNC-STDLIB-IN-SYNC-CALLBACK |
| fp1c-template-text (`` `call m(${pw})` ``) | compiles | E-ASYNC-STDLIB-IN-SYNC-CALLBACK |
| fp1d-other-fn-sync-m (a different server fn's own SYNC `m`) | compiles | E-ASYNC-STDLIB-IN-SYNC-CALLBACK |

RELAYED claims: all four REPRODUCED.

## FP2 — sync local sharing an async name

| file | expected | actual at base |
|---|---|---|
| fp2-sync-local-shares-async-name (`function verifyPassword(a,b){return a-b}` then `.sort(verifyPassword)`) | compiles | E-ASYNC-STDLIB-IN-SYNC-CALLBACK on `verifyPassword` |

RELAYED claim: REPRODUCED.
