# progress
- [x] A resolves: all three re-executed on 29eb80c31 and fixed; marked resolved-by=#1191
- [x] B 1-12, 14 reproduced and filed under §S444d
- [x] B13 NOT-REPRODUCED as stated: CI `gate` runs `browser-baseline.ts --check` (PASS on 29eb80c31, 48 baselined names). Locally, 50 fail = 48 baselined + 2 env-excluded TodoMVC. Local `--check` refuses: "parser 47 vs bun 48". Reported, not filed.
- [x] state.ts --write / --check PASS
- [ ] push
