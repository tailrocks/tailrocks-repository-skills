# Selector and target contract

The complete argument string is data. Parse it with helper/ through scripts/run-helper.sh or an equivalent non-shell transport. Whitespace separates tokens; single and double quotes and backslash only group or escape data. Do not evaluate the string, expand variables, treat # as a comment, or pass it through a shell.

Accepted source selectors:

- branch names, refs/heads/BRANCH, and explicitly qualified remote refs;
- branch:NAME when a numeric branch must not be mistaken for a PR;
- #NUMBER, pr:NUMBER, and bare positive decimal PR numbers;
- GitHub PR URLs;
- GitHub repository /pulls URLs;
- GitHub repository /branches/all URLs.

Resolve URL forms before ref forms, then explicit branch and PR forms, then the numeric PR shorthand. Bind every URL to one OWNER/REPOSITORY. If URLs disagree, stop. For bare selectors, resolve against the already bound repository; if identity is still ambiguous, stop and ask for --repo or a qualified ref. Never infer a repository from a PR base or from the process current directory without recording the repository identity.

Paginate every list endpoint. A list URL is a source selection request, not permission to scan unrelated repositories. Preserve query parameters and raw selector provenance. Deduplicate by canonical identity only after recording every spelling. Numeric bare selectors are PRs; use branch:1145 or refs/heads/1145 for a numeric branch.

The target is --target-branch. If omitted, it is exactly main. Check refs/heads/TARGET or the explicitly selected remote. A missing target is an error. Do not use current HEAD, a PR base, origin/HEAD, or the repository default as a fallback. Do not create a target.

No source selectors means usage/error. --all-work explicitly selects the original host-wide clone, worktree, and unfinished-work workflow. --resume resumes one recorded campaign and cannot be mixed with new selectors or --all-work.
