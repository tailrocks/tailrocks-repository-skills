// The fleet plan as pure functions of what the reads showed. No I/O here.
//
// Ranking: READY first, then WAITING, then BLOCKED grouped by the owner of the
// first blocker. Held PRs are not read and never ranked.

import type { OpenPr } from "./list.ts";
import type { Policy } from "../policy/types.ts";
import type { Owner, PrSnapshot, Verdict } from "../status/types.ts";
import { sortFindings } from "../status/findings.ts";
import {
  PENDING_REFRESH,
  QUEUE_HEAD,
  type Action,
  type Entry,
  type FleetPolicy,
  type FreezeSource,
  type Hygiene,
  type MergeRoute,
  type OrphanRuns,
  type Plan,
} from "./types.ts";
import type { RepoSlug } from "../types.ts";

export interface Read {
  readonly pr: OpenPr;
  readonly verdict: Verdict;
  /** Null when the PR could not be read. */
  readonly snapshot: PrSnapshot | null;
}

/** Order of the owner groups among the BLOCKED PRs. The owner that unblocks the most comes first. */
const OWNER_ORDER: readonly Owner[] = ["pr-refresh", "pr-threads", "pr-merge", "pr-create", "reviewer", "ci", "human", "pr-status"];

const STATE_ORDER = { READY: 0, WAITING: 1, BLOCKED: 2 } as const;

/** Blockers that a base merge fixes. Only a PR that has no other blocker is a refresh candidate. */
const REFRESH_CODES: readonly string[] = ["behind_base", "conflict", "check_stale_base"];

export function isBehind(snapshot: PrSnapshot): boolean {
  return (snapshot.behindBy ?? 0) > 0 || snapshot.mergeStateStatus === "BEHIND";
}

/**
 * Approved means: no review finding, and a positive approval signal. A
 * repository that needs no approval gives no signal for an unreviewed PR.
 */
export function isApproved(snapshot: PrSnapshot, verdict: Verdict, policy: Policy): boolean {
  if (snapshot.isDraft || verdict.findings.some((f) => f.code.startsWith("review_"))) {
    return false;
  }
  if (policy.review.source === "comment-verdict") {
    return true;
  }
  return snapshot.reviewDecision === "APPROVED" || snapshot.latestOpinionatedReviews.some((r) => r.state === "APPROVED");
}

const FRESH_CI_MESSAGE = "Start a fresh CI run";

/**
 * The head commit is a refresh from pr-refresh: a merge of the base, or the
 * empty commit that starts a fresh CI run. Its CI still runs. A person's own
 * merge commit counts too: that only makes the budget safer.
 */
export function isRefreshing(snapshot: PrSnapshot): boolean {
  const head = snapshot.commits.at(-1);
  if (head === undefined || snapshot.state !== "OPEN") {
    return false;
  }
  const subject = head.message.split("\n")[0] ?? "";
  const refreshCommit = (head.parents.length >= 2 && subject.startsWith("Merge ")) || subject === FRESH_CI_MESSAGE;
  return refreshCommit && snapshot.checks.some((check) => check.status !== "completed");
}

export function entryOf(read: Read, policy: Policy): Entry {
  const { pr, verdict, snapshot } = read;
  const sorted = sortFindings(verdict.findings);
  const headline = sorted.find((f) => f.kind === "blocker") ?? sorted.find((f) => f.kind === "wait");
  const owner: Owner = verdict.state === "READY" ? "pr-merge" : (headline?.owner ?? "pr-status");
  const queue = snapshot?.queueEntry ?? null;
  return {
    number: pr.number,
    author: pr.author,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    headSha: verdict.headSha,
    state: verdict.state,
    owner,
    next: verdict.next,
    codes: verdict.findings.map((f) => f.code),
    blockers: verdict.findings.filter((f) => f.kind === "blocker").map((f) => f.code),
    isDraft: pr.isDraft,
    isCrossRepository: pr.isCrossRepository,
    queue: queue === null ? null : { position: queue.position, state: queue.state },
    behind: snapshot !== null && isBehind(snapshot),
    approved: snapshot !== null && isApproved(snapshot, verdict, policy),
    refreshing: snapshot !== null && isRefreshing(snapshot),
  };
}

export function rank(entries: readonly Entry[]): readonly Entry[] {
  const group = (e: Entry): number => (e.state === "BLOCKED" ? Math.max(0, OWNER_ORDER.indexOf(e.owner)) : 0);
  return [...entries].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || group(a) - group(b) || a.number - b.number);
}

/** READY, behind the base, and otherwise free: after a direct merge it needs a base merge, not a merge. */
export function isBehindReady(entry: Entry, defaultBranch: string): boolean {
  return entry.state === "READY" && entry.behind && entry.queue === null && !entry.isCrossRepository && entry.baseRef === defaultBranch;
}

/** The PR may enter the queue or merge: READY, same repository, on the default branch, not queued. */
export function isMergeCandidate(entry: Entry, defaultBranch: string): boolean {
  return entry.state === "READY" && entry.queue === null && !entry.isCrossRepository && entry.baseRef === defaultBranch;
}

/** A base merge is the only fix: every blocker is one that a merge of the base removes. */
export function isRefreshCandidate(entry: Entry, defaultBranch: string): boolean {
  return (
    entry.state === "BLOCKED" &&
    !entry.isDraft &&
    !entry.isCrossRepository &&
    entry.queue === null &&
    entry.baseRef === defaultBranch &&
    entry.blockers.length > 0 &&
    entry.blockers.every((code) => REFRESH_CODES.includes(code))
  );
}

/**
 * The length of the queue of the default branch. Null when GitHub names a
 * queue but shows no length: that case counts as congested.
 */
export function queueLength(reads: readonly Read[], defaultBranch: string): number | null {
  const snapshots = reads.flatMap((r) => (r.snapshot !== null && r.pr.baseRef === defaultBranch ? [r.snapshot] : []));
  const seen = snapshots.filter((s) => s.queueEntry !== null).length;
  const shown = snapshots.flatMap((s) => (s.rules.queueLength === null ? [] : [s.rules.queueLength]));
  if (shown.length > 0) {
    return Math.max(seen, ...shown);
  }
  return snapshots.some((s) => s.rules.mergeQueue) ? null : seen;
}

export interface Budget {
  readonly budget: number;
  readonly congested: boolean;
}

/** Queue length at or above the congestion length: the congested budget. Unknown length: congested. */
export function refreshBudget(policy: Policy, length: number | null): Budget {
  const congested = length === null || length >= policy.ci.congestion_queue_length;
  return { congested, budget: congested ? policy.ci.max_refreshes_congested : policy.ci.max_refreshes };
}

export function mergeRoute(reads: readonly Read[], defaultBranch: string): MergeRoute {
  return reads.some((r) => r.snapshot !== null && r.pr.baseRef === defaultBranch && r.snapshot.rules.mergeQueue) ? "queue" : "direct";
}

export const DEFAULT_QUEUE_MERGES = 3;
export const DEFAULT_DIRECT_MERGES = 1;

/** The merge cap before the queue room: the policy value, else 3 through a queue and 1 for direct merges. */
export function baseMergeCap(policy: Policy, route: MergeRoute): number {
  return policy.fleet.max_merges_per_pass ?? (route === "queue" ? DEFAULT_QUEUE_MERGES : DEFAULT_DIRECT_MERGES);
}

/** Enqueues that fit before the queue reaches the congestion length. An unknown length leaves no room. */
export function queueRoom(policy: Policy, length: number | null): number {
  return length === null ? 0 : Math.max(0, policy.ci.congestion_queue_length - length);
}

/** Merges or enqueues that one pass may start, for a queue of this length. */
export function mergeCap(policy: Policy, route: MergeRoute, length: number | null): number {
  const base = baseMergeCap(policy, route);
  return route === "queue" ? Math.min(base, queueRoom(policy, length)) : base;
}

export function freezeSource(policy: Policy, env: Readonly<Record<string, string | undefined>>): FreezeSource | null {
  if (env["PR_FLEET_FREEZE"] === "1") {
    return "env";
  }
  return policy.fleet.freeze ? "policy" : null;
}

export interface AnalyzeInput {
  readonly repo: RepoSlug;
  readonly defaultBranch: string;
  readonly fleet: FleetPolicy;
  readonly advisory: boolean;
  readonly frozen: FreezeSource | null;
  readonly open: number;
  readonly held: readonly number[];
  readonly reads: readonly Read[];
  readonly orphanRuns: OrphanRuns;
  /** False until pr-refresh is on main: refresh actions then carry the pending note. */
  readonly refreshAvailable: boolean;
}

function sortedNumbers(entries: readonly Entry[]): readonly number[] {
  return entries.map((e) => e.number).sort((a, b) => a - b);
}

function nextOf(plan: Omit<Plan, "next">, entries: readonly Entry[]): string {
  if (plan.frozen !== null) {
    return "Freeze is on, so the fleet writes nothing. Report the plan to the user.";
  }
  if (plan.advisory) {
    return "This plan is advisory: it uses a local policy file. Run plan again without --policy to get a plan that apply accepts.";
  }
  const runnable = plan.actions.filter((a) => a.pending === null);
  if (runnable.length > 0) {
    return `Run fleet.ts apply --apply --repo ${plan.repo} when the user asked to apply the plan.`;
  }
  if (plan.actions.length > 0) {
    return `${PENDING_REFRESH}. Report the refresh actions to the user.`;
  }
  const first = entries.find((e) => e.state !== "READY");
  if (first !== undefined) {
    return `#${first.number}: ${first.next}`;
  }
  return entries.length === 0 ? "None. No open PR was read." : "None. Nothing to do.";
}

export function analyze(input: AnalyzeInput): Plan {
  const { policy } = input.fleet;
  const entries = rank(input.reads.map((r) => entryOf(r, policy)));
  const frozen = input.frozen;

  const length = queueLength(input.reads, input.defaultBranch);
  const { budget, congested } = refreshBudget(policy, length);
  const route = mergeRoute(input.reads, input.defaultBranch);
  const cap = mergeCap(policy, route, length);
  const inFlight = sortedNumbers(entries.filter((e) => e.refreshing));

  const head = entries
    .flatMap((e) => (e.queue !== null && e.baseRef === input.defaultBranch ? [{ number: e.number, ...e.queue }] : []))
    .sort((a, b) => a.position - b.position);

  const hygiene: Hygiene[] = head
    .filter((slot) => slot.position <= QUEUE_HEAD && slot.state === "UNMERGEABLE")
    .map((slot): Hygiene => {
      const entry = entries.find((e) => e.number === slot.number);
      const note =
        frozen !== null ? "freeze is on" : entry?.isCrossRepository === true ? "the PR head is in a fork" : null;
      return { number: slot.number, position: slot.position, state: slot.state, planned: note === null, note };
    });

  const candidates = entries.filter((e) => isRefreshCandidate(e, input.defaultBranch)).map((e) => e.number).sort((a, b) => a - b);
  const room = Math.max(0, budget - inFlight.length);
  const planned = frozen === null ? candidates.slice(0, room) : [];
  const deferred = frozen === null ? candidates.slice(room) : candidates;

  const mergeable = entries.filter((e) => isMergeCandidate(e, input.defaultBranch)).map((e) => e.number);
  const mergePlanned = frozen === null ? mergeable.slice(0, cap) : [];
  const mergeDeferred = frozen === null ? mergeable.slice(cap) : mergeable;

  const byNumber = new Map(entries.map((e) => [e.number, e] as const));
  const actions: Action[] = [];
  if (frozen === null) {
    for (const h of hygiene.filter((x) => x.planned)) {
      const entry = byNumber.get(h.number);
      if (entry !== undefined && entry.headSha !== null) {
        actions.push({ kind: "dequeue", number: h.number, headSha: entry.headSha, detail: `the entry is UNMERGEABLE at position ${h.position}`, late: false, pending: null });
      }
    }
    for (const number of mergePlanned) {
      const entry = byNumber.get(number);
      if (entry !== undefined && entry.headSha !== null) {
        actions.push({ kind: "merge", number, headSha: entry.headSha, detail: "READY: enter the queue, or merge with the policy method", late: false, pending: null });
      }
    }
    for (const number of planned) {
      const entry = byNumber.get(number);
      if (entry !== undefined && entry.headSha !== null) {
        actions.push({
          kind: "refresh",
          number,
          headSha: entry.headSha,
          detail: "sync with the base branch",
          late: false,
          pending: input.refreshAvailable ? null : PENDING_REFRESH,
        });
      }
    }
  }

  const stockpile = {
    readyNotQueued: sortedNumbers(entries.filter((e) => e.state === "READY" && e.queue === null)),
    approvedBehind: sortedNumbers(entries.filter((e) => e.approved && e.behind)),
  };

  const rest = {
    schema: 1,
    repo: input.repo,
    defaultBranch: input.defaultBranch,
    policySource: input.fleet.source,
    policySha: input.fleet.sha,
    advisory: input.advisory,
    frozen,
    open: input.open,
    held: input.held,
    ranking: entries,
    stockpile,
    queue: { length, congested, head },
    hygiene,
    merge: { route, cap, candidates: mergeable, planned: mergePlanned, deferred: mergeDeferred },
    refresh: { budget, inFlight, candidates, planned, deferred },
    orphanRuns: input.orphanRuns,
    actions,
  } as const;
  return { ...rest, next: nextOf(rest, entries) };
}
