# PR body construction

How `tailrocks-create-pr` sources the body skeleton and what the prose in it
must and must not do. `tailrocks-refresh-pr` applies the same rules when it
reconciles a body.

## The only template

The body skeleton comes from exactly one path, read from the candidate
revision at runtime, every time:

```text
.github/PULL_REQUEST_TEMPLATE.md
```

There are no alternate locations, case variants, template directories,
generator commands, or fallback skeletons. Never reconstruct the template
from memory: repositories edit their templates, and a from-memory copy
ships yesterday's sections. When the file is missing and edits are
authorized, `tailrocks-pr-template` creates it; when edits are not
authorized, report the missing file and stop. HTML comments in the
template are authoring instructions for you. Obey them. Then strip
them from the posted body along with every `<placeholder>`.

## Section discipline

- One paragraph per section, no hard-wrap inside a paragraph — GitHub flows
  the text.
- **Summary** answers what the PR is for and who benefits — short; detail
  lives in the sections below it.
- **What ships** is feature-level outcomes. Not function names, not struct
  inventories, not fixture counts — the diff already shows those.
- **Behavior changes** exists only when it adds signal beyond What ships:
  changed defaults, validation, errors, migration or runtime consequences.
- Optional sections are dropped, not filled with "None" — except Migration
  notes, where an explicit "None." is meaningful while a project is
  pre-release.
- No design-rationale narration in the body; link a contributor doc by name.
- No file-by-file changelog and no full test list — the diff and the runner
  output are the record.
- No deployed-docs URLs — they break after merge. Refer to docs by name;
  verify-locally URLs are `http://localhost:<port>/...` only.
- No mechanical CI-shaped checks in the body. What CI enforces, CI reports.

## Verify locally

The one section a reviewer executes. Its blocks are selected by what the
diff touches — a docs block for a docs change, a migration block for a
schema change — never pasted wholesale:

- Every command is copy-pasteable exactly as written.
- State the expected outcome whenever a bare exit code does not
  disambiguate pass from fail.
- Scope test filters to the change first; the full suite command follows.
- A block the diff does not earn is dropped, not left as boilerplate.

`tailrocks-refresh-pr` treats this section's block set as derived state: the
current diff decides which blocks belong, while the fill inside a kept block
is the author's and survives reconciliation.
