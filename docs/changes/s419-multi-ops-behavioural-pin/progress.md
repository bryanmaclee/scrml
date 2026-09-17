# s419-multi-ops-behavioural-pin — progress

Gap: `g-multi-ops-ordering-pin-reads-array-text-not-tokenizer-behaviour` (MED). TEST-ONLY; no compiler
source changed. Whether `>>>` should lex as one token stays an open language ruling
(`g-multi-ops-first-match-shadows-the-longer-operator`).

## Done
- Rewrote `compiler/tests/unit/tokenizer-multi-ops-ordering.test.js` (4 tests):
  1. vacuity guard — live set non-empty (>20), one result per member.
  2. extraction cross-check — exhaustive 2–4 char probe over `.:-+*/%^&|!=<>?` (~54k lexes, ~250ms);
     every multi-char OPERATOR token emitted must be a member of the extracted array.
  3. THE PIN — members that do not lex as one OPERATOR token of their own text == `[">>>"]`, with a
     message naming each changed member + its actual split, and stating it is a language ruling.
  4. behaviour-derived diagnostic — each non-self-lexing member's first token is a shorter live member
     prefixing it (first-match shadowing).
- All array-text assertions deleted (regex/JSON parse of tokenizer.ts source, index-adjacency check).

## Live operator set
`MULTI_OPS` is function-local, not exported. Read from `tokenizeLogic.toString()` (the loaded,
Bun-transpiled function — types and comments already stripped), literal cut by a string/comment-aware
bracket scanner and evaluated with `new Function`. Validated behaviourally by test 2.

## Per-member result (HEAD cc10480f)
35 members; 34 lex as themselves; `>>>` lexes as `[">>", ">"]`.

## Bite proof (tokenizer.ts file copy, md5 abff9f92d8e200639e14c802298754fc restored after each)
| case | mutation | result |
|---|---|---|
| a | matcher iterates `[...MULTI_OPS].sort((a,b)=>b.length-a.length)` | RED 3/1 — "NOW lex correctly ... `>>>` -> [`>>>`]" |
| b | `==` moved before `===` | RED 3/1 — "NO LONGER lex ... `===` -> [`==`,`=`]" |
| c | new member `"|>"` appended | GREEN 4/0 |
| d | `] as const;` + comment line with quoted ops and `]`/`[` inside the array | GREEN 4/0, no crash |

## Gate
- tokenizer-multi-ops-ordering 4/0; condition-head-angle-operator-coverage 22/0 (unchanged);
  derived-value-mutate 47/0; reactive-compound-assign-and-postfix 22/0.
