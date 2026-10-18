# unit-id: s468-await-f4-followups
Base: create branch `s468-await-f4-followups` from `origin/s467-await-r10` @ 6d6157ad0 (PR #1434, reviewed LAND-WITH-
FOLLOW-UPS, merge pending owner permission). NOT from origin/main. If #1434 merges while you work, rebase onto
origin/main. Findings below are RELAYED from an adversarial reviewer who executed them — REPRODUCE each first.
Reviewer artifacts (read-only): $HOME/.cache/scrml-agent-tmp/s468-rev-1434/ (drv/*.mjs shapes + drive.mjs driver,
cmp.txt, cd/diff.json).
F1 (LOW, introduced by 933c6e51a): in the F4 binding judge, `blockShadows` / the param shadow only ADD names; a nested
`function` declaration (or loop/catch header binding) that re-binds a shadowed name inside a deeper block/fn body never
REMOVES it, so F4 goes silent on e.g.
  function run(p, h) { const check = 1
    if (p) { function check(a, b) { return verifyPassword(a, b) }
      const g = (a, b) => check(a, b)
      return g(p, h) }
    return false }
(19458af1e: E-ASYNC-FN-ESCAPES-AS-VALUE + E-ASYNC-STDLIB-IN-SYNC-CALLBACK; HEAD: only the latter). Fix: a scope that
re-declares a shadowed name by `function`/loop/catch binding drops it from the shadow for that scope. Tests: the
reproducer + its variants (param `check`, inner fn body, block lambda, fn expression, named fn expr, IIFE, `let g`) in
s467-await-r10.test.js; keep the r10 false-refusal fix's own tests passing.
F2 (MED, introduced by the merge): compiler/tests/integration/s466-client-dead-fn-binding-prune.test.js was rewritten
to `function w`, which never reaches the client dead-fn-valued-binding prune (emit-client.ts ~:4286, locate by symbol)
— reviewer mutation `if (false && …)` left it 6/6 green (#1435's original: 3/4 fail). Re-pin tests 1-2 on a const
binding over a SYNC server-only stdlib export (e.g. `const w = (a, b) => generatePassword(8) == a`, plus the chain
form), PROVE bite by the same mutation (red), restore (green). Fix the header comment that claims the guarantee is
pinned on `function w`.
F3 (LOW, optional): F4 adds a misleading second error on `const ranked = rows.sort((a, b) => verifyPassword(…) ? -1 :
1)` ("`ranked` holds … an async function" — it is an array). Cases: conformance auth/auth-async-stdlib-sync-callback-
neg, server-db/server-fn-in-sync-callback-pos. Do not report a binding whose value is a method-call RESULT over a sync-
callback lambda. Pass conformance unchanged.
GAPS to file in docs/known-gaps.md (locus= + prov= fields):
 - F4 pre-existing LOW: an inner `function check(a,b){ return helper(a,b) }` re-declaring an imported async name and
   calling a file-scope `helper` → server bundle ReferenceError `helper is not defined` (fails closed, 500).
 - pre-existing on main, sev MED (PA call; owner may re-rank): a function writing a whole SQL row into a client cell
   (`@out = ?{SELECT name, pw …}.get()`) then a client lambda reading `@out.name` ships the full row incl. the password
   hash to the browser — tension with §19.9.9.8 "server values stay on the server"; ruling owed on whether a server
   result written into a cell is a server value (ties to g-cps-server-half-trusts-client-held-cell-s467). Reproducer:
   $HOME/.cache/scrml-agent-tmp/s468-await-land/probe/ (srvLambdaWrites).
 - LOW tooling: classify.js --json prints stray `false`/`true` lines before the JSON. Fix it here (small) and note it.
Re-run the full await pack (640 shapes, 0 FAIL) after F1.
