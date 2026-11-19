# PR body rules

The plan prints a skeleton. It comes from the body template of the repository at
the base commit. Without a template it comes from `pr_body.sections` of the
policy. Fill that skeleton. Do not use a template from memory.

## Sections

- Write each prose section (why, what) as one paragraph. Do not hard-wrap inside a paragraph. Proof and Done-when are lists.
- Answer the first section (the reason) in a few lines: what the PR is for and
  who benefits.
- Write the outcomes that ship. Do not list functions, structs, or fixture
  counts. The diff shows them.
- Add a section about behavior changes only when it adds signal: changed
  defaults, validation, errors, or migration effects.
- Do not narrate design rationale. Link a contributor document by name.
- Do not write a file-by-file changelog or a full test list.
- Do not link deployed documentation. Those URLs break after a merge.
- Do not repeat what CI enforces.

## Proof

- Name the commands that a reviewer runs. Write them so that a reviewer can copy
  them as they are.
- State the expected result when an exit code alone does not tell pass from
  fail.
- Run a command before you write it. Report what you saw.
- Scope the test filter to the change first. Give the full suite command after
  it.

## Placeholders and comments

- Remove each placeholder in angle brackets. The script refuses a body that
  keeps one from the template.
- Never write a token, a URL with credentials, or an authorization header. The
  script refuses such a body and names the line number.
- HTML comments in the skeleton are instructions to you. The script removes all
  of them from the posted body.
- Drop an optional section. Do not fill it with "None". Write "None." only in a
  section that the policy requires.

## What the script adds

- The issue link line (`Closes #N` or `Part of #N`), when you pass `--issue`.
- The footer of `pr_body.footer`, when the policy sets one.
