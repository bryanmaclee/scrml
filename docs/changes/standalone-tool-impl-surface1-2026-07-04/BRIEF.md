# IMPLEMENT Standalone-tool target — Surface 1 <program kind="tool"> (§64, scrml S238)
change-id: standalone-tool-impl-surface1-2026-07-04 · agent a8b902fa88f7a708c · base 9ab2b379 · isolation:worktree

Implements the LANDED normative SPEC §64 (Surface 1 = kind="tool" entry-point target). Surface 2 (<foreign lang> §23.6 libraries) is a SEPARATE follow-up — NOT built here.

READ FIRST (Rule 4): SPEC.md §64 IN FULL (~34489) + §23.2.4 (amended THREE _{} forms, ~15885) + docs/changes/standalone-tool-target-2026-07-04/{SPEC-AMENDMENT,SCOPE}.md + §40.8/§43.

W2 parser: kind= on top-level <program>, closed vocab "tool" (else E-TOOL-002); nested kind= → E-TOOL-002.
W3 typer: E-TOOL-001 no function main; E-TOOL-004 fn-main (impure→function main); E-TOOL-003 <page>/markup/client-UI in tool body; validate+classify main return-type (numeric→exit-harness, no-return→invoke-only); §23.2.4 admit bare _{} in tool function/main body (don't fire E-FOREIGN-004 there, scoped to kind=tool).
W4 codegen: NEW plain-module emit path in index.ts bypassing emit-html/emit-client/CSRF/routes; the main() harness §64.3 (function main():number → const code=await main(process.argv.slice(2)); process.exit(code); no-return → await main(process.argv.slice(2)) then nothing, Bun handles keep alive); compose lang=/db=/capabilities=. §34 rows E-TOOL-001..004.
W5 tests+R26: run-and-exit db CLI + Bun.serve long-running server; E-TOOL rejects; §23.2.4 admission; R26 = representative fleet-shaped tool + serve tool, RUN emitted (exit code + server liveness). flogence field-tests the real 25 after.

Blocks (verbatim in dispatch): MAPS-first (primary.map @66a3afb1); STARTUP+PATH-DISCIPLINE (F4/S88/S90/S99/S126, incremental per-phase commits); PHASE-0 characterize current kind="tool" behavior (NEW feature, no bug — establish greenfield pre-state); PHASE-3 (R26 run: CLI exits w/ code + server stays up + no html/client/CSRF scaffold; FULL bun run test 0-fail incl within-node re-baseline; S215 adversarial E-TOOL-002/003/004/001 + tool-_{}-ok-but-webapp-_{}-still-E-FOREIGN-004 + the §64.3 serve+returns-code documented mis-fire + /code-review); phase-split-if-too-big; REPORT. Repros /tmp/kind-tool-r26/. Do NOT edit known-gaps.md (PA-owned).
