# progress s447-spec-ufcs

- start: ff-merged 31c42fbf0 -> c12b52c2a (origin/main); bun install ok
- §7: added #### 7.3.4 (call checking, arity + arg type, S447 #9); §7.5.1 position-3 row RULED S447, position-3 paragraph + normative bullet, S447 amendment under the BLOCKED note
- §67 appended (13 subsections); §66.12 S447 amendment banner; §34 rows: 5 new Nominal + 4 touched (E-CALL-ARITY, E-TYPE-031, E-STMT-NO-EFFECT, E-TYPE-046); discarded-result reuses E-STMT-NO-EFFECT (S446 dpa-063 Call 5 language-wide); census --check-new PASS
- known-gaps: 2 entries (impl#1 + bootstrap); state.ts --write/--check PASS; SPEC-INDEX §67 row + 7 Quick Lookup lines + §7 row; facts --write/--check PASS; PRIMER §6.6 + §11 anti-pattern row
- tests: unit 21331 pass / 0 fail; slice-m2 448/0, m3 60/0, m4 403/0 (1 skip)
- incident (not path): a pkill -f with a specific pattern killed my own shell (exit 144); no other effect
