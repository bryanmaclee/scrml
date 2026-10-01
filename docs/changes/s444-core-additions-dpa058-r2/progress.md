# progress — s444-core-additions-dpa058-r2

- 2026-09-30 start; base 16221b99a + merge origin/main (2291df2b1). The merge also fixes main 3a4d869a3's
  protect-error-egress test pollution (sibling files leak a happy-dom GlobalRegistrator → unregister in beforeAll);
  without it the gate fails 5 tests on main itself.
