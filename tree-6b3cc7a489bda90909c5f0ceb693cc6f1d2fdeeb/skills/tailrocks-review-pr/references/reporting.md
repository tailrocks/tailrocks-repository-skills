# Reporting

## Severity model

Three tiers, and a finding's tier is decided by evidence, not by how it
sounds:

- **Blocker** — a verified correctness finding, or a presumptive
  structural blocker without a recorded justification. Blockers are stated
  as blockers; softening a verified defect into a "consider…" is a
  reporting defect.
- **Important** — a verified finding the change should fix before merge
  but that does not make the merged state wrong: a criticality-7 test
  gap, a silent fallback with a justification that only covers half the
  paths, a structural regression below the blocker line.
- **Suggestion** — a named improvement with its measure, offered without
  pressure. Suggestions never appear when a blocker in the same area is
  unresolved: fix the wall before discussing the paint.

Order the report: verified bugs, then structural regressions and missed
dramatic simplifications, then lane findings, then suggestions. A short
strengths note is welcome when genuine; padding praise is not.

## The verdict bar

The verdict is one of three sentences, each earned:

- **No findings.** State what was checked — the lanes run, the rule sets
  applied — so the clean bill has content. Behavior-seems-correct alone
  never earns it: the structural pass ran too. This is a review result, not
  an approval or merge authorization.
- **Findings, none blocking.** List them with routes; the change may merge
  as judged by its owners, subject to the separate landing owner's current
  read-only preflight and fail-closed remote-landing guard.
- **Blocked.** Name each blocker and its route. A blocker plus "but the
  author says fixing it is expensive" is still blocked — cost arguments
  route to `tailrocks-root-cause`'s doctrine; they do not lower the bar.

The verdict is advisory: this skill never clicks approve, never posts, and never
merges. `tailrocks-merge-pr` is a separate owner that currently performs only a
read-only preflight and reports remote landing as blocked until its atomic
target-base and landed-target guards exist. A review verdict, "safe to merge"
statement, approval, or preflight receipt authorizes nothing by itself.

## Review handoff

When posting is requested, return the strict `tailrocks.pr-review-report/v1`
JSON handoff and do not post it. A separately authorized invocation of the
package-local `post-pr-review.ts` command owns report preparation and posting;
it must receive the canonical absolute path of this installed `SKILL.md` and
perform its own fresh PR binding and authority checks. Review output never
hands merge, edit, or posting authority to another skill.
