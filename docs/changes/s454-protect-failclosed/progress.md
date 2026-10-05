# progress — s454-protect-failclosed (append-only)

- start: HEAD 79bd05028 (ff from origin/test/s454-conf-protect-floor), branch fix/s454-protect-failclosed

## Root (traced, HELD + widened)
resolveProtectedOutputColumns returned `null` (no tag) from a FAILED leader test:
`returningAsSelect` -> null when `^(insert|replace|update|delete)` missed, then
`!isRowProducingQuery` -> null when `/^(?:select|with)\b/` over stripLeadingSqlNoise missed.
A leading `;` misses both -> untagged -> row ships whole. Same "unknown -> none" inversion
found at three more exits (all EXECUTED as leaks on 79bd05028 with the conf harness):
- `out.size === 0` after an opaque scalar subquery over a VIEW the compile does not know
  (`(SELECT p FROM v)`): opaqueColumnMayCarryProtected only looked for protected identifiers.
- `RETURNING *;` -> list `*;` -> opaque entry, no `*` seen by lexSqlEntry -> null.
- `${ "{" } , passwordHash, ${ "}" }`: the SQL splitter brace-counts one interpolation, JS reads
  two; `, passwordHash,` reaches the DB as SQL the floor never saw.

## Fix
Inverted the default. `analyzeProtectStatement` lexes the body structurally (lexProtectSql) and
classifies select / write / no-rows / unknown; `unknown` (any non-recognized leader, >1 statement,
leading `;`, or a lexical form where DB tokenization may differ from the floor's views) -> {all:true}.
null only from: single DDL/txn statement; single RETURNING-free write; resolved SELECT/RETURNING with
no protected origin (nested SELECT now requires every FROM/JOIN source to be a known table).

## Direction of change (pa-base §8)
semantics-changed toward the contract: rows that shipped a protected column now don't (wholesale
strip). §14.8.9: "it is fail-closed on an unknown origin — a value whose origin the implementation
cannot determine is treated as carrying every protected origin it may carry (stripped wholesale, or
rejected where this section requires or permits a rejection), never as carrying none."
Fidelity gain: a trailing `;` no longer forces a wholesale strip.
