# Historical cleanup evidence

Status: historical v0.1.x record for the former cleanup skill and helper. It
does not prove current 0.2.0 cleanup behavior.

The old record named recovery and cleanup-scope checks for staged, unstaged,
untracked, ignored, and symlink state, selected-source deletion, and retention
of unrelated refs. These results are not current acceptance evidence.

Current pending requirements include snapshot/restore before each deletion,
fresh identity and target-obligation checks, authorization, independent
inspection, and strict `--cleanup=none` retention. See
`../docs/requirements-to-evidence.md`.

