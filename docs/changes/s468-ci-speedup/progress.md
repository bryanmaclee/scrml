# s468-ci-speedup — progress (append-only)

- 2026-10-17 start: WIP(s468-ci-speedup) at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-ae01353de7cb9b0cf,
  branch s468-ci-speedup from origin/main a46405246. BRIEF.md = COMMON.md + BRIEF-ci-speedup.md verbatim.
- Baseline (run 39078887384, PR #1446): gate 1185 s (unit+conformance 463, host-global 309, browser 114,
  bootstrap slice 107, snippet 63, e2e-render-map 55); tracking 659 s (integration+lsp+commands 488,
  browser 82, bootstrap-conformance 67); windows 788 s (unit+conformance 655, e2e 79).
- Branch protection (read-only check): required_status_checks.contexts = ["gate"], app_id 15368
  (GitHub Actions), strict=true, enforce_admins=true. NOT changed.
