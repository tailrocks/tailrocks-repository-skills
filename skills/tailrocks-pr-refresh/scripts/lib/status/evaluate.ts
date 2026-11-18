// evaluate(snapshot, policy) -> Verdict. Pure and total: it never throws and it
// does no I/O. Unknown, missing, or truncated data becomes a blocker.

import { matchesAnyGlob } from "../glob.ts";
import type { Policy, PolicySource } from "../policy/types.ts";
import type { RepoSlug } from "../types.ts";
import { checkFindings } from "./checks.ts";
import { finding, listCapped, short, sortFindings } from "./findings.ts";
import { reviewFindings } from "./reviews.ts";
import { bodyProblems, hasSignoff, parseDoneWhen, sameLogin } from "./text.ts";
import type { Finding, PrSnapshot, QueueState, Verdict } from "./types.ts";

const QUEUE_WAIT_STATES: ReadonlySet<QueueState> = new Set(["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "LOCKED"]);
// UNSTABLE: only checks that are not required fail. GitHub allows the merge.
const MERGEABLE_STATES: ReadonlySet<string> = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);

const GITHUB_REASON: Readonly<Record<string, string>> = {
  BLOCKED: "a required check, review, or rule is not satisfied",
  BEHIND: "the head is behind the base and the rules need an up-to-date branch",
  DIRTY: "the branch conflicts with the base",
  DRAFT: "the PR is a draft",
  UNKNOWN: "GitHub has not computed the state yet",
};

export const READY_NEXT = "Hand the PR to pr-merge. This verdict does not merge.";

/** A BLOCKED verdict for a PR that could not be read at all. */
export function unknownVerdict(
  repo: RepoSlug,
  number: number,
  detail: string,
  policySource: PolicySource = "default",
): Verdict {
  const f = finding("unknown_state", "blocker", detail, "Run pr-status again; if it repeats, read the error");
  return { schema: 1, repo, number, headSha: null, state: "BLOCKED", findings: [f], next: f.next, policySource };
}

function threadFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  const open = snapshot.threads.filter((t) => !t.isResolved);
  if (open.length === 0) {
    return [];
  }
  const bots = new Set(policy.threads.bots.map((b) => b.toLowerCase()));
  const fix = policy.threads.fix_pattern === "" ? null : safeRegExp(policy.threads.fix_pattern, policy.review.flags);
  const bot = open.filter((t) => bots.has(t.firstAuthor.toLowerCase())).length;
  const mustFix = fix === null ? 0 : open.filter((t) => fix.test(t.firstBody)).length;
  const parts = [`${bot} from review bots`, `${open.length - bot} from people`];
  if (fix !== null) {
    parts.push(`${mustFix} match the fix pattern`);
  }
  return [
    finding(
      "threads_unresolved",
      "blocker",
      `${open.length} unresolved review thread${open.length === 1 ? "" : "s"} (${parts.join(", ")})`,
      "Fix or defer each thread with pr-threads, reply with the reason, and resolve it",
    ),
  ];
}

function safeRegExp(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function dcoFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  if (!policy.dco.required) {
    return [];
  }
  const unsigned = snapshot.commits.filter((c) => {
    if (c.parents.length > 1 || hasSignoff(c.message)) {
      return false;
    }
    const exempt =
      policy.dco.bot_commits === "exempt" &&
      c.authorLogin !== null &&
      policy.dco.bot_authors.some((b) => sameLogin(b, c.authorLogin ?? ""));
    return !exempt;
  });
  if (unsigned.length === 0) {
    return [];
  }
  const who = [...new Set(unsigned.map((c) => c.authorLogin ?? c.authorEmail))];
  return [
    finding(
      "dco_missing",
      "blocker",
      `${unsigned.length} commit${unsigned.length === 1 ? "" : "s"} without Signed-off-by (${listCapped(unsigned.map((c) => short(c.oid)))}; authors: ${listCapped(who)})`,
      "Add the sign-off with pr-refresh dco-fix",
      unsigned.map((c) => c.oid),
    ),
  ];
}

function clip(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function issueFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  if (policy.issues.done_when === "off") {
    return [];
  }
  const parts: string[] = [];
  for (const issue of snapshot.linkedIssues) {
    if (issue.state !== "OPEN") {
      continue;
    }
    const done = parseDoneWhen(issue.body, policy.issues.done_when_heading);
    if (done !== null && done.unchecked.length > 0) {
      parts.push(`#${issue.number} has ${done.unchecked.length} unchecked: ${done.unchecked.slice(0, 3).map(clip).join("; ")}`);
    }
  }
  if (parts.length === 0) {
    return [];
  }
  return [
    finding(
      "done_when_unchecked",
      policy.issues.done_when === "block" ? "blocker" : "info",
      `linked issue Done-when boxes are open: ${listCapped(parts)}`,
      "Prove each box in the PR body, or link the issue with Part of instead of Closes",
      parts,
    ),
  ];
}

function bodyFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  if (!policy.pr_body.enforce) {
    return [];
  }
  const required =
    snapshot.bodyTemplate !== null && snapshot.bodyTemplate.headings.length > 0
      ? snapshot.bodyTemplate.headings
      : policy.pr_body.sections;
  const problems = bodyProblems(snapshot.body, required);
  return problems.length === 0
    ? []
    : [finding("body_template", "blocker", `the PR body does not follow the template: ${problems.join("; ")}`, "Reconcile the body with pr-refresh metadata")];
}

function gateFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  for (const gate of policy.gates) {
    switch (gate.kind) {
      case "label-absent":
        if (snapshot.labels.includes(gate.value)) {
          out.push(finding("gate_failed", "blocker", `gate ${gate.name}: label "${gate.value}" is present`, `Remove the label "${gate.value}" when the reason ends`));
        }
        break;
      case "label-present":
        if (!snapshot.labels.includes(gate.value)) {
          out.push(finding("gate_failed", "blocker", `gate ${gate.name}: label "${gate.value}" is missing`, `Add the label "${gate.value}"`));
        }
        break;
      case "check-pass": {
        const check = snapshot.checks.find((c) => c.name === gate.value);
        if (check !== undefined && check.status !== "completed") {
          out.push(finding("checks_pending", "wait", `gate ${gate.name}: check "${gate.value}" is not finished`, "Watch the check"));
        } else if (check === undefined || check.conclusion !== "success") {
          out.push(finding("gate_failed", "blocker", `gate ${gate.name}: check "${gate.value}" has no passing run`, "Make the check pass"));
        }
        break;
      }
    }
  }
  return out;
}

function stateFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  if (snapshot.isCrossRepository) {
    out.push(finding("cross_repository", "info", "the head is in a fork", "Writing skills refuse this PR; read only"));
  }
  if (snapshot.isDraft) {
    out.push(finding("draft", "blocker", "the PR is a draft", "Mark it ready with pr-merge ready when the draft policy allows"));
  }
  if (snapshot.parentPr !== null) {
    out.push(
      finding(
        "stacked",
        "blocker",
        `the base ${snapshot.baseRef} is the head branch of open PR #${snapshot.parentPr}`,
        `Wait for PR #${snapshot.parentPr} to merge, then retarget this PR to ${snapshot.defaultBranch}`,
      ),
    );
  } else if (snapshot.baseRef !== snapshot.defaultBranch && !matchesAnyGlob(policy.branches.bases, snapshot.baseRef)) {
    out.push(
      finding(
        "wrong_base",
        "blocker",
        `the base ${snapshot.baseRef} is not ${snapshot.defaultBranch} and not in branches.bases`,
        `Retarget the PR to ${snapshot.defaultBranch}`,
      ),
    );
  }
  if (snapshot.mergeable === "CONFLICTING") {
    out.push(finding("conflict", "blocker", `the branch conflicts with ${snapshot.baseRef}`, "Merge the base with pr-refresh sync and resolve through the policy commands"));
  } else if (snapshot.mergeable === "UNKNOWN" || snapshot.mergeStateStatus === "UNKNOWN") {
    out.push(finding("mergeability_pending", "wait", "GitHub has not computed mergeability yet", "Read the PR again in a few seconds"));
  }
  const behind = snapshot.behindBy ?? 0;
  if (behind > 0) {
    const strict = snapshot.mergeStateStatus === "BEHIND" || (snapshot.rules.strictUpToDate && !snapshot.rules.mergeQueue);
    out.push(
      finding(
        "behind_base",
        strict ? "blocker" : "info",
        `${behind} commit${behind === 1 ? "" : "s"} behind ${snapshot.baseRef}${strict ? "; the rules need an up-to-date branch" : ""}`,
        "Merge the base with pr-refresh sync",
      ),
    );
  } else if (snapshot.mergeStateStatus === "BEHIND") {
    out.push(finding("behind_base", "blocker", `GitHub reports the head behind ${snapshot.baseRef}`, "Merge the base with pr-refresh sync"));
  }
  return out;
}

function queueFindings(snapshot: PrSnapshot): readonly Finding[] {
  const entry = snapshot.queueEntry;
  if (entry !== null) {
    if (entry.state === "UNMERGEABLE") {
      return [
        finding(
          "queue_unmergeable",
          "blocker",
          `the queue entry at position ${entry.position} is UNMERGEABLE and blocks the entries behind it`,
          "Dequeue it with pr-merge dequeue, then run pr-refresh",
        ),
      ];
    }
    if (QUEUE_WAIT_STATES.has(entry.state)) {
      return [finding("queued", "wait", `in the merge queue at position ${entry.position}, state ${entry.state}`, "Watch the entry; run pr-status again")];
    }
    return [finding("unknown_state", "blocker", `unknown queue state ${entry.state}`, "Run pr-status again")];
  }
  const removal = snapshot.lastQueueRemoval;
  if (removal !== null && removal.afterLastPush) {
    return [
      finding(
        "queue_ejected",
        "info",
        `removed from the merge queue at ${removal.at} (reason: ${removal.reason}); the head has not changed since`,
        "Read the blocking findings; they give the action",
      ),
    ];
  }
  return [];
}

function unknownFindings(snapshot: PrSnapshot): readonly Finding[] {
  const problems = [...snapshot.problems];
  if (snapshot.threadsTruncated) {
    problems.push("review threads are truncated");
  }
  if (snapshot.commitsTruncated) {
    problems.push("commits are truncated");
  }
  if (snapshot.checksTruncated) {
    problems.push("checks are truncated");
  }
  if (snapshot.reviewsTruncated) {
    problems.push("reviews are truncated");
  }
  if (!snapshot.rules.known) {
    problems.push("branch rules could not be read");
  }
  if (problems.length === 0) {
    return [];
  }
  return [finding("unknown_state", "blocker", problems.slice(0, 5).join("; ") + (problems.length > 5 ? `; and ${problems.length - 5} more` : ""), "Run pr-status again")];
}

function githubAgrees(snapshot: PrSnapshot): Finding | null {
  if (MERGEABLE_STATES.has(snapshot.mergeStateStatus)) {
    return null;
  }
  const reason = GITHUB_REASON[snapshot.mergeStateStatus] ?? "GitHub gives no reason";
  return finding(
    "github_disagrees",
    "blocker",
    `all gates pass but mergeStateStatus is ${snapshot.mergeStateStatus}: ${reason}`,
    "Read GitHub's reason on the PR page; do not merge",
  );
}

function build(snapshot: PrSnapshot, policy: Policy, policySource: PolicySource): Verdict {
  const base = { schema: 1, repo: snapshot.repo, number: snapshot.number, headSha: snapshot.headSha, policySource } as const;
  if (snapshot.state !== "OPEN") {
    const f = finding("pr_not_open", "blocker", `the PR is ${snapshot.state.toLowerCase()}`, "None. Report the state");
    return { ...base, state: "BLOCKED", findings: [f], next: f.next };
  }
  const findings: Finding[] = [
    ...unknownFindings(snapshot),
    ...stateFindings(snapshot, policy),
    ...checkFindings(snapshot, policy),
    ...reviewFindings(snapshot, policy),
    ...threadFindings(snapshot, policy),
    ...dcoFindings(snapshot, policy),
    ...queueFindings(snapshot),
    ...issueFindings(snapshot, policy),
    ...bodyFindings(snapshot, policy),
    ...gateFindings(snapshot, policy),
  ];
  const blocked = findings.filter((f) => f.kind === "blocker" && f.code !== "queue_unmergeable");
  const queuedAt = findings.findIndex((f) => f.code === "queued");
  if (queuedAt >= 0 && blocked.length > 0) {
    const queued = findings[queuedAt];
    findings.splice(queuedAt, 1, finding(
      "queued_while_blocked",
      "blocker",
      `${queued?.detail ?? "in the merge queue"}, and ${blocked.length} other blocker${blocked.length === 1 ? "" : "s"} remain (${listCapped([...new Set(blocked.map((f) => f.code))])})`,
      "pr-merge dequeue so the entry does not block the queue, then fix",
    ));
  }
  const hasBlocker = findings.some((f) => f.kind === "blocker");
  const hasWait = findings.some((f) => f.kind === "wait");
  if (!hasBlocker && !hasWait) {
    const disagreement = githubAgrees(snapshot);
    if (disagreement !== null) {
      findings.push(disagreement);
    }
  }
  const sorted = sortFindings(findings);
  const blocker = sorted.find((f) => f.kind === "blocker");
  const wait = sorted.find((f) => f.kind === "wait");
  if (blocker !== undefined) {
    return { ...base, state: "BLOCKED", findings: sorted, next: blocker.next };
  }
  if (wait !== undefined) {
    return { ...base, state: "WAITING", findings: sorted, next: wait.next };
  }
  return { ...base, state: "READY", findings: sorted, next: READY_NEXT };
}

/** Compute the verdict. Never throws: an internal error becomes a BLOCKED `unknown_state`. */
export function evaluate(snapshot: PrSnapshot, policy: Policy, policySource: PolicySource = "default"): Verdict {
  try {
    return build(snapshot, policy, policySource);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unreadable data";
    return unknownVerdict(snapshot.repo, snapshot.number, `evaluate failed on odd data: ${reason}`, policySource);
  }
}
