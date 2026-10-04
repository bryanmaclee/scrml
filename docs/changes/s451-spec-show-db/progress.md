# s451-spec-show-db — progress

- [x] Branch spec/s451-show-db cut from origin/main 086f8f209.
- [x] Ruling 1 (`show=` not a narrowing guard): §42.3.5 struck `show=`; §17.2 bullet added. Measured 0/12 corpus files affected (temp-patched impl#1 filter, compiled before/after, positive control 0→1). Gap g-impl1-show-narrows-s451 filed.
- [ ] Ruling 2 (§8.1.1 nearest database scope): SPEC text + impl#1 probe + gap.
- [ ] regen-spec-index, s34-census, facts, state checks; rebase + push.
