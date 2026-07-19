# BRIEF — colorless-async Phase-1 S239 fix-round (findings 1 & 2)

Dispatched S269 (bryan ruled "fix now"). Fixes the two branch-scope silent-Promise-leak
holes the S239 adversarial pass confirmed on `feat/colorless-async-seam-a` @ `19cba92f`.
Finding 3 (derived-cell/markup leak) is PRE-EXISTING → filed as a known-gap, OUT OF SCOPE here.

See prompt body below (verbatim dispatch).
