# Issue link rule

The policy key is `issues.link = "closes-when-complete"`. It governs the line
that links the PR to an issue. You pass `--issue N`. The script writes the line.

## The rule

1. The script reads the issue and its Done-when section. The heading comes from
   `issues.done_when_heading`. A box is a list item that starts with `[ ]`.
2. A box that is already checked in the issue is done work. It needs no proof.
3. A box is mapped when the Done-when section of the PR body holds a checked
   line for it, and the line has proof:

   ```text
   - [x] The export writes the file: `bun test export` passes
   ```

   The line must hold the text of the box. Proof is one of these, outside the
   text of the box: a code span, a link or URL, a commit id of seven or more
   hex digits, or an issue or PR number.
4. When every open box is mapped, the line is `Closes #N`. The issue closes when
   the PR merges.
5. Otherwise the line is `Part of #N`. The plan lists the boxes that lack proof.
6. An issue with no open Done-when box gets `Closes #N`. Pass `--part-of` when
   the PR does not finish the issue.

## What you may and may not do

- Do not write `Closes`, `Fixes`, or `Resolves` for the issue yourself. When the
  rule says `Part of`, the script refuses a body that closes the issue.
- If your body already holds `Part of #N` or `Closes #N` that the rule allows,
  the script adds nothing.
- Do not check a box that you did not prove. The proof must be real.
- `--part-of` can only lower the link from `Closes` to `Part of`.
