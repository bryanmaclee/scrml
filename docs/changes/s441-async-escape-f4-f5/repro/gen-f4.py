# Generates the F4 reproducers (f4-*.scrml) next to this script.
import os
HERE = os.path.dirname(os.path.abspath(__file__))
shapes = {
 "alias": 'const g = m\n  return g(ARG) ? "accepted" : "rejected"',
 "objfield": 'const o = {f: m}\n  return o.f(ARG) ? "accepted" : "rejected"',
 "arrayelem": 'const fs = [m]\n  return fs[0](ARG) ? "accepted" : "rejected"',
 "userhof": 'function drive(f) { return f(ARG) }\n  return drive(m) ? "accepted" : "rejected"',
 "arrayfrom": 'const rs = Array.from([ARG], m)\n  return rs[0] ? "accepted" : "rejected"',
}
for k, body in shapes.items():
  # (1) nested helper inside a SERVER fn wrapping scrml:auth verifyPassword
  src = '''<program>
${
  import { verifyPassword } from 'scrml:auth'
}
<verdict> = "unset"
server function check(pw, hash) {
  function m(h) { return verifyPassword(pw, h) }
  BODY
}
function go() {
  @verdict = check("wrong", "not-a-real-hash")
}
<p id="out">${@verdict}</p>
<button id="go" onclick=go()>go</button>
</program>
'''.replace("BODY", body.replace("ARG", "hash"))
  open(os.path.join(HERE, f"f4-nested-{k}.scrml"), "w").write(src)
  # (2) CLIENT fn with a file-scope SERVER fn `m`
  src2 = '''<program>
<verdict> = "unset"
server function m(n) { return n > 100 }
function decide() {
  BODY
}
function go() {
  @verdict = decide()
}
<p id="out">${@verdict}</p>
<button id="go" onclick=go()>go</button>
</program>
'''.replace("BODY", body.replace("ARG", "1"))
  open(os.path.join(HERE, f"f4-client-serverfn-{k}.scrml"), "w").write(src2)
  # (3) CLIENT fn with a file-scope CLIENT helper `m` that calls a server fn
  src3 = '''<program>
<verdict> = "unset"
server function isOk(n) { return n > 100 }
function m(n) { return isOk(n) }
function decide() {
  BODY
}
function go() {
  @verdict = decide()
}
<p id="out">${@verdict}</p>
<button id="go" onclick=go()>go</button>
</program>
'''.replace("BODY", body.replace("ARG", "1"))
  open(os.path.join(HERE, f"f4-client-helper-{k}.scrml"), "w").write(src3)
