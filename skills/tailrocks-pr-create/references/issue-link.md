# Issue link rule

The policy key is `issues.link = "closes-when-complete"`. It governs the line
that links the PR to an issue. You pass `--issue N`. Only the script writes the
`Closes #N` or `Part of #N` line. You never write it.

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
   text of the box:
   - a code span;
   - a URL that starts with http or https;
   - a commit id of seven to forty hex digits that names a commit of this PR;
   - the number of another issue or PR. The number of the linked issue is not
     proof.
4. The line is `Closes #N` only when the issue has a Done-when section and every
   open box is mapped. The issue closes when the PR merges.
5. Otherwise the line is `Part of #N`. The plan lists the boxes that lack proof.
6. An issue with no Done-when section never gets `Closes`: the script cannot
   prove that the PR finishes it. The same holds for an issue that the script
   cannot read.
7. A Done-when section with no open box gets `Closes #N`. Pass `--part-of` when
   the PR does not finish the issue.

## What you may and may not do

- Do not write `Closes`, `Fixes`, `Resolves`, or `Part of` for the issue
  yourself. The script writes the line. It refuses a body that closes an issue
  the rule keeps open. It adds nothing when the body already holds a reference
  that the rule allows.
- Do not check a box that you did not prove. The proof must be real.
- `--part-of` can only lower the link from `Closes` to `Part of`.
