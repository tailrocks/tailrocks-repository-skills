// Read a recorded snapshot (a test fixture) back into a typed PrSnapshot.
// The decoder checks every field, so a fixture with a wrong shape fails loudly.

import { sha } from "../github/parse.ts";
import { arr, bool, member, num, numOrNull, obj, oneOf, parseJson, str, strOrNull, type Obj } from "../github/read.ts";
import { parseRepoSlug } from "../types.ts";
import type {
  BodyTemplate,
  CarryStep,
  CheckObservation,
  CommitObservation,
  GitFacts,
  LinkedIssue,
  OpinionatedReview,
  PrSnapshot,
  QueueEntry,
  QueueRemoval,
  RequiredCheck,
  ReviewObservation,
  RulesFacts,
  ThreadObservation,
} from "./types.ts";

const ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN", "NONE"] as const;
const REVIEW_STATES = ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"] as const;
const CONCLUSIONS = ["success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale", "startup_failure"] as const;
const STATUSES = ["queued", "in_progress", "completed", "waiting", "pending", "requested"] as const;
const STEPS = ["head", "empty_commit", "clean_base_merge", "trailer_rewrite"] as const satisfies readonly CarryStep[];

function list<T>(value: unknown, where: string, read: (item: Obj, where: string) => T): readonly T[] {
  return arr(value, where).map((item, index) => read(obj(item, `${where}[${index}]`), `${where}[${index}]`));
}

function strings(value: unknown, where: string): readonly string[] {
  return arr(value, where).map((v, i) => str(v, `${where}[${i}]`));
}

function check(o: Obj, w: string): CheckObservation {
  const conclusion = member(o, "conclusion");
  return {
    name: str(member(o, "name"), `${w}.name`),
    kind: oneOf(member(o, "kind"), ["check_run", "status_context"], `${w}.kind`),
    status: oneOf(member(o, "status"), STATUSES, `${w}.status`),
    conclusion: conclusion === null ? null : oneOf(conclusion, CONCLUSIONS, `${w}.conclusion`),
    isRequired: bool(member(o, "isRequired"), `${w}.isRequired`),
    appId: numOrNull(member(o, "appId"), `${w}.appId`),
    workflow: strOrNull(member(o, "workflow"), `${w}.workflow`),
    event: strOrNull(member(o, "event"), `${w}.event`),
    startedAt: strOrNull(member(o, "startedAt"), `${w}.startedAt`),
    completedAt: strOrNull(member(o, "completedAt"), `${w}.completedAt`),
    attempts: num(member(o, "attempts"), `${w}.attempts`),
    failedAttempts: num(member(o, "failedAttempts"), `${w}.failedAttempts`),
  };
}

function shaOrNull(value: unknown, where: string) {
  return value === null ? null : sha(value, where);
}

function review(o: Obj, w: string): ReviewObservation {
  return {
    author: str(member(o, "author"), `${w}.author`),
    association: oneOf(member(o, "association"), ASSOCIATIONS, `${w}.association`),
    state: oneOf(member(o, "state"), REVIEW_STATES, `${w}.state`),
    body: str(member(o, "body"), `${w}.body`),
    commit: shaOrNull(member(o, "commit"), `${w}.commit`),
    submittedAt: str(member(o, "submittedAt"), `${w}.submittedAt`),
  };
}

function opinionated(o: Obj, w: string): OpinionatedReview {
  return {
    author: str(member(o, "author"), `${w}.author`),
    association: oneOf(member(o, "association"), ASSOCIATIONS, `${w}.association`),
    state: oneOf(member(o, "state"), REVIEW_STATES, `${w}.state`),
    commit: shaOrNull(member(o, "commit"), `${w}.commit`),
  };
}

function thread(o: Obj, w: string): ThreadObservation {
  return {
    id: str(member(o, "id"), `${w}.id`),
    isResolved: bool(member(o, "isResolved"), `${w}.isResolved`),
    isOutdated: bool(member(o, "isOutdated"), `${w}.isOutdated`),
    path: strOrNull(member(o, "path"), `${w}.path`),
    line: numOrNull(member(o, "line"), `${w}.line`),
    firstAuthor: str(member(o, "firstAuthor"), `${w}.firstAuthor`),
    firstBody: str(member(o, "firstBody"), `${w}.firstBody`),
    lastAuthor: str(member(o, "lastAuthor"), `${w}.lastAuthor`),
    commentCount: num(member(o, "commentCount"), `${w}.commentCount`),
  };
}

function commit(o: Obj, w: string): CommitObservation {
  return {
    oid: sha(member(o, "oid"), `${w}.oid`),
    parents: arr(member(o, "parents"), `${w}.parents`).map((p, i) => sha(p, `${w}.parents[${i}]`)),
    tree: sha(member(o, "tree"), `${w}.tree`),
    message: str(member(o, "message"), `${w}.message`),
    authorLogin: strOrNull(member(o, "authorLogin"), `${w}.authorLogin`),
    authorEmail: str(member(o, "authorEmail"), `${w}.authorEmail`),
    committedDate: str(member(o, "committedDate"), `${w}.committedDate`),
  };
}

function queueEntry(value: unknown): QueueEntry | null {
  if (value === null) {
    return null;
  }
  const o = obj(value, "queueEntry");
  return {
    id: str(member(o, "id"), "queueEntry.id"),
    position: num(member(o, "position"), "queueEntry.position"),
    state: oneOf(member(o, "state"), ["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "UNMERGEABLE", "LOCKED"], "queueEntry.state"),
    jump: bool(member(o, "jump"), "queueEntry.jump"),
    enqueuedAt: str(member(o, "enqueuedAt"), "queueEntry.enqueuedAt"),
  };
}

function removal(value: unknown): QueueRemoval | null {
  if (value === null) {
    return null;
  }
  const o = obj(value, "lastQueueRemoval");
  return {
    at: str(member(o, "at"), "removal.at"),
    reason: str(member(o, "reason"), "removal.reason"),
    beforeCommit: shaOrNull(member(o, "beforeCommit"), "removal.beforeCommit"),
    afterLastPush: bool(member(o, "afterLastPush"), "removal.afterLastPush"),
  };
}

function issue(o: Obj, w: string): LinkedIssue {
  return {
    number: num(member(o, "number"), `${w}.number`),
    state: oneOf(member(o, "state"), ["OPEN", "CLOSED"], `${w}.state`),
    body: str(member(o, "body"), `${w}.body`),
    via: oneOf(member(o, "via"), ["closing", "body"], `${w}.via`),
  };
}

function required(o: Obj, w: string): RequiredCheck {
  return {
    name: str(member(o, "name"), `${w}.name`),
    appId: numOrNull(member(o, "appId"), `${w}.appId`),
    source: oneOf(member(o, "source"), ["ruleset", "protection"], `${w}.source`),
  };
}

function rules(o: Obj): RulesFacts {
  return {
    requiredChecks: list(member(o, "requiredChecks"), "rules.requiredChecks", required),
    strictUpToDate: bool(member(o, "strictUpToDate"), "rules.strictUpToDate"),
    mergeQueue: bool(member(o, "mergeQueue"), "rules.mergeQueue"),
    queueLength: numOrNull(member(o, "queueLength"), "rules.queueLength"),
    requiredApprovingReviewCount: num(member(o, "requiredApprovingReviewCount"), "rules.requiredApprovingReviewCount"),
    requireCodeOwnerReview: bool(member(o, "requireCodeOwnerReview"), "rules.requireCodeOwnerReview"),
    dismissStaleReviewsOnPush: bool(member(o, "dismissStaleReviewsOnPush"), "rules.dismissStaleReviewsOnPush"),
    threadResolutionRequired: bool(member(o, "threadResolutionRequired"), "rules.threadResolutionRequired"),
    allowedMergeMethods: strings(member(o, "allowedMergeMethods"), "rules.allowedMergeMethods"),
    known: bool(member(o, "known"), "rules.known"),
  };
}

function git(o: Obj): GitFacts {
  return {
    available: bool(member(o, "available"), "git.available"),
    unavailableBecause: strOrNull(member(o, "unavailableBecause"), "git.unavailableBecause"),
    reviewEquivalentHeads: list(member(o, "reviewEquivalentHeads"), "git.reviewEquivalentHeads", (h, w) => ({
      sha: sha(member(h, "sha"), `${w}.sha`),
      via: oneOf(member(h, "via"), STEPS, `${w}.via`),
    })),
    carryStoppedBecause: strOrNull(member(o, "carryStoppedBecause"), "git.carryStoppedBecause"),
  };
}

function template(value: unknown): BodyTemplate | null {
  return value === null ? null : { headings: strings(member(obj(value, "bodyTemplate"), "headings"), "bodyTemplate.headings") };
}

/** Decode snapshot JSON text. Throws ReadError when any field has the wrong shape. */
export function parseSnapshot(source: string): PrSnapshot {
  const o = obj(parseJson(source, "snapshot"), "snapshot");
  const slug = parseRepoSlug(str(member(o, "repo"), "repo"));
  if (!slug.ok) {
    throw new Error(`repo: ${slug.error}`);
  }
  const decision = member(o, "reviewDecision");
  if (member(o, "schema") !== 1) {
    throw new Error("schema: expected 1");
  }
  return {
    schema: 1,
    capturedAt: str(member(o, "capturedAt"), "capturedAt"),
    repo: slug.value,
    defaultBranch: str(member(o, "defaultBranch"), "defaultBranch"),
    number: num(member(o, "number"), "number"),
    nodeId: str(member(o, "nodeId"), "nodeId"),
    state: oneOf(member(o, "state"), ["OPEN", "CLOSED", "MERGED"], "state"),
    isDraft: bool(member(o, "isDraft"), "isDraft"),
    isCrossRepository: bool(member(o, "isCrossRepository"), "isCrossRepository"),
    author: str(member(o, "author"), "author"),
    title: str(member(o, "title"), "title"),
    body: str(member(o, "body"), "body"),
    baseRef: str(member(o, "baseRef"), "baseRef"),
    baseSha: sha(member(o, "baseSha"), "baseSha"),
    headRef: str(member(o, "headRef"), "headRef"),
    headSha: sha(member(o, "headSha"), "headSha"),
    mergeable: oneOf(member(o, "mergeable"), ["MERGEABLE", "CONFLICTING", "UNKNOWN"], "mergeable"),
    mergeStateStatus: str(member(o, "mergeStateStatus"), "mergeStateStatus"),
    reviewDecision: decision === null ? null : oneOf(decision, ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"], "reviewDecision"),
    behindBy: numOrNull(member(o, "behindBy"), "behindBy"),
    labels: strings(member(o, "labels"), "labels"),
    checks: list(member(o, "checks"), "checks", check),
    checksTruncated: bool(member(o, "checksTruncated"), "checksTruncated"),
    reviews: list(member(o, "reviews"), "reviews", review),
    reviewsTruncated: bool(member(o, "reviewsTruncated"), "reviewsTruncated"),
    latestOpinionatedReviews: list(member(o, "latestOpinionatedReviews"), "latestOpinionatedReviews", opinionated),
    threads: list(member(o, "threads"), "threads", thread),
    threadsTruncated: bool(member(o, "threadsTruncated"), "threadsTruncated"),
    commits: list(member(o, "commits"), "commits", commit),
    commitsTruncated: bool(member(o, "commitsTruncated"), "commitsTruncated"),
    queueEntry: queueEntry(member(o, "queueEntry")),
    lastQueueRemoval: removal(member(o, "lastQueueRemoval")),
    linkedIssues: list(member(o, "linkedIssues"), "linkedIssues", issue),
    parentPr: numOrNull(member(o, "parentPr"), "parentPr"),
    rules: rules(obj(member(o, "rules"), "rules")),
    bodyTemplate: template(member(o, "bodyTemplate")),
    git: git(obj(member(o, "git"), "git")),
    problems: strings(member(o, "problems"), "problems"),
  };
}
