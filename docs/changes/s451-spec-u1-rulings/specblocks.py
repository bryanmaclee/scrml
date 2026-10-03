import re, os, sys
root = "/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aba955268a71af4a4"
out = "/home/bryan-maclee/.cache/scrml-agent-tmp/s451-spec-u1/specblocks"
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    os.remove(os.path.join(out, f))
lines = open(os.path.join(root, "compiler/SPEC.md")).read().split("\n")
i = 0; n = 0
while i < len(lines):
    if lines[i].strip().startswith("```scrml"):
        start = i + 1
        j = start
        while j < len(lines) and not lines[j].strip().startswith("```"):
            j += 1
        body = "\n".join(lines[start:j])
        if "?{" in body:
            n += 1
            open(os.path.join(out, "L%05d.scrml" % (start + 1)), "w").write(body + "\n")
        i = j + 1
    else:
        i += 1
print(n)
