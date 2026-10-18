# unit-id: s468-rulings-spec (fix round 2 — owner rulings landed) — ADD to the existing branch/PR #1448
Work ON branch s468-rulings-spec (PR #1448) at adc8f0fe822d80b04558d5b1695f5e2aedc08c01 (assert). Rulings VERBATIM:
/home/bmacs/scrmlMaster/scrml-support/user-voice-scrml.md, last entry ("go on the merge driver, your recs on the rest").
1. §19.9.9.8 rule 5: the two "Read-through (PA-drafted)" items are CONFIRMED — remove the PA-drafted flag; provenance
   line → `ruling:user-voice-scrml.md S468`.
2. §55 (validators): contradictory validators are a compile error — find where §55.12/§55.17 discuss combining; add the
   rule ("a set of validators no value can satisfy SHALL be a compile error") + a code (pick a name in the E-VALIDATOR-*
   family; read §34 for the convention) + a §34 row marked as Nominal/bootstrap-owed; provenance ruling S468. Update
   gap g-contradictory-validators-ruling-owed-s468 (lives on PR #1447's branch — if not on your base, add an annotation
   entry referencing it, no duplicate id) to RULED, bootstrap-owed; file an impl#1-divergence note (impl#1 not changed —
   S435, not security).
3. §4.17: raw content wins — `${…}` inside `<pre>`/`<code>` is display text always, including in a component's
   `renders` body; amend the sentence about a component prop "substituted into a raw body" to mean a prop passed as
   element CONTENT (children/slot), not an interpolation; provenance ruling S468.
4. Regenerate SPEC-INDEX (+ --check), state/facts (--write, --check). Docs-only. Push after every commit.
