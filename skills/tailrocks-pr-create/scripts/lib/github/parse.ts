// Parse GraphQL replies into snapshot parts. Each parser reads untrusted JSON
// through the typed readers. A bad list item becomes a problem string, so one
// odd item never hides the rest.

import { parseSha, type Sha } from "../types.ts";
import type {
  AuthorAssociation,
  CheckConclusion,
  CheckObservation,
  CheckStatus,
  CommitObservation,
  OpinionatedReview,
  QueueEntry,
  ReviewObservation,
  ReviewState,
  ThreadObservation,
} from "../status/types.ts";
import { newestOf } from "../status/attempts.ts";
import { arr, bool, isObj, member, num, numOrNull, obj, oneOf, ReadError, str, strOrNull, path } from "./read.ts";

export function sha(value: unknown, where: string): Sha {
  const parsed = parseSha(str(value, where));
  if (!parsed.ok) {
    throw new ReadError(`${where}: ${parsed.error}`);
  }
  return parsed.value;
}

function shaOrNull(value: unknown, where: string): Sha | null {
  return value === null || value === undefined ? null : sha(value, where);
}

const ASSOCIATIONS = [
  "OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN", "NONE",
] as const satisfies readonly AuthorAssociation[];
const REVIEW_STATES = ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"] as const satisfies readonly ReviewState[];

/** Reduce an author object to a login. A deleted account reads as "ghost". */
function login(value: unknown, where: string): string {
  return value === null || value === undefined ? "ghost" : str(member(obj(value, where), "login"), `${where}.login`);
}

// ---------- checks ----------

const STATUS_VALUES = ["QUEUED", "IN_PROGRESS", "COMPLETED", "WAITING", "PENDING", "REQUESTED"] as const;
const CONCLUSION_VALUES = [
  "SUCCESS", "FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "NEUTRAL", "SKIPPED", "STALE", "STARTUP_FAILURE",
] as const;
const CONTEXT_STATES = ["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"] as const;

const FAILED: ReadonlySet<CheckConclusion> = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

interface RawCheck {
  readonly observation: Omit<CheckObservation, "attempts" | "failedAttempts">;
  readonly order: number;
}

function lowerStatus(value: string): CheckStatus {
  return oneOf(value.toLowerCase(), ["queued", "in_progress", "completed", "waiting", "pending", "requested"], "check status");
}

function parseContext(node: unknown, order: number): RawCheck {
  const o = obj(node, "check");
  const type = str(member(o, "__typename"), "check.__typename");
  if (type === "CheckRun") {
    const name = str(member(o, "name"), "check.name");
    const status = lowerStatus(oneOf(member(o, "status"), STATUS_VALUES, `check ${name} status`));
    const rawConclusion = member(o, "conclusion");
    const conclusion =
      rawConclusion === null || rawConclusion === undefined
        ? null
        : oneOf(oneOf(rawConclusion, CONCLUSION_VALUES, `check ${name} conclusion`).toLowerCase(), [
            "success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale", "startup_failure",
          ], "conclusion");
    const suite = path(o, "checkSuite");
    return {
      order,
      observation: {
        name,
        kind: "check_run",
        status,
        conclusion,
        isRequired: bool(member(o, "isRequired"), `check ${name} isRequired`),
        appId: numOrNull(path(suite, "app", "databaseId"), `check ${name} app`),
        workflow: strOrNull(path(suite, "workflowRun", "workflow", "name"), `check ${name} workflow`),
        event: strOrNull(path(suite, "workflowRun", "event"), `check ${name} event`),
        startedAt: strOrNull(member(o, "startedAt"), `check ${name} startedAt`),
        completedAt: strOrNull(member(o, "completedAt"), `check ${name} completedAt`),
        runId: numOrNull(member(o, "databaseId"), `check ${name} databaseId`),
      },
    };
  }
  if (type === "StatusContext") {
    const name = str(member(o, "context"), "status.context");
    const state = oneOf(member(o, "state"), CONTEXT_STATES, `status ${name} state`);
    const done = state === "SUCCESS" || state === "FAILURE" || state === "ERROR";
    return {
      order,
      observation: {
        name,
        kind: "status_context",
        status: done ? "completed" : "pending",
        conclusion: state === "SUCCESS" ? "success" : done ? "failure" : null,
        isRequired: bool(member(o, "isRequired"), `status ${name} isRequired`),
        appId: null,
        workflow: null,
        event: null,
        startedAt: strOrNull(member(o, "createdAt"), `status ${name} createdAt`),
        completedAt: done ? strOrNull(member(o, "createdAt"), `status ${name} createdAt`) : null,
        runId: null,
      },
    };
  }
  throw new ReadError(`check: unknown type ${type}`);
}

/** Keep the latest attempt per (kind, workflow, name). Count the attempts and the failed ones. */
export function parseChecks(nodes: readonly unknown[], problems: string[]): readonly CheckObservation[] {
  const groups = new Map<string, RawCheck[]>();
  nodes.forEach((node, index) => {
    try {
      const raw = parseContext(node, index);
      const key = `${raw.observation.kind}\u0000${raw.observation.appId ?? ""}\u0000${raw.observation.workflow ?? ""}\u0000${raw.observation.name}`;
      groups.set(key, [...(groups.get(key) ?? []), raw]);
    } catch (error) {
      problems.push(error instanceof ReadError ? error.message : "check: unreadable");
    }
  });
  const out: CheckObservation[] = [];
  for (const attempts of groups.values()) {
    // The attempt with the highest check-run id is the newest. Without ids, an attempt that has not started (a queued re-run) is the newest.
    const latest = newestOf(attempts.map((r) => ({ ...r.observation, raw: r })))?.raw;
    if (latest === undefined) {
      continue;
    }
    out.push({
      ...latest.observation,
      attempts: attempts.length,
      failedAttempts: attempts.filter((a) => a.observation.conclusion !== null && FAILED.has(a.observation.conclusion)).length,
    });
  }
  return out;
}

// ---------- threads ----------

export function parseThreads(nodes: readonly unknown[], problems: string[]): readonly ThreadObservation[] {
  const out: ThreadObservation[] = [];
  for (const node of nodes) {
    try {
      const o = obj(node, "thread");
      const comments = obj(member(o, "comments"), "thread.comments");
      const first = obj(arr(member(comments, "nodes"), "thread.comments.nodes")[0], "thread first comment");
      const last = arr(path(member(o, "lastComment"), "nodes"), "thread.lastComment")[0];
      out.push({
        id: str(member(o, "id"), "thread.id"),
        isResolved: bool(member(o, "isResolved"), "thread.isResolved"),
        isOutdated: bool(member(o, "isOutdated"), "thread.isOutdated"),
        path: strOrNull(member(o, "path"), "thread.path"),
        line: numOrNull(member(o, "line"), "thread.line"),
        firstAuthor: login(member(first, "author"), "thread author"),
        firstBody: str(member(first, "body"), "thread body"),
        lastAuthor: login(isObj(last) ? member(last, "author") : null, "thread last author"),
        commentCount: num(member(comments, "totalCount"), "thread.comments.totalCount"),
      });
    } catch (error) {
      problems.push(error instanceof ReadError ? error.message : "thread: unreadable");
    }
  }
  return out;
}

// ---------- reviews, commits, queue ----------

export function parseReviews(nodes: readonly unknown[], problems: string[]): readonly ReviewObservation[] {
  const out: ReviewObservation[] = [];
  for (const node of nodes) {
    try {
      const o = obj(node, "review");
      out.push({
        author: login(member(o, "author"), "review author"),
        association: oneOf(member(o, "authorAssociation"), ASSOCIATIONS, "review.authorAssociation"),
        state: oneOf(member(o, "state"), REVIEW_STATES, "review.state"),
        body: str(member(o, "body"), "review.body"),
        commit: shaOrNull(path(o, "commit", "oid"), "review.commit"),
        submittedAt: strOrNull(member(o, "submittedAt"), "review.submittedAt") ?? "",
      });
    } catch (error) {
      problems.push(error instanceof ReadError ? error.message : "review: unreadable");
    }
  }
  return out;
}

export function parseOpinionated(nodes: readonly unknown[], problems: string[]): readonly OpinionatedReview[] {
  return parseReviews(
    nodes.map((n) => (isObj(n) ? { body: "", submittedAt: "", ...n } : n)),
    problems,
  ).map((r) => ({ author: r.author, association: r.association, state: r.state, commit: r.commit }));
}

export function parseCommits(nodes: readonly unknown[], problems: string[]): readonly CommitObservation[] {
  const out: CommitObservation[] = [];
  for (const node of nodes) {
    try {
      const c = obj(member(obj(node, "commit node"), "commit"), "commit");
      out.push({
        oid: sha(member(c, "oid"), "commit.oid"),
        parents: arr(path(c, "parents", "nodes"), "commit.parents").map((p) => sha(path(p, "oid"), "commit.parent")),
        tree: sha(path(c, "tree", "oid"), "commit.tree"),
        message: str(member(c, "message"), "commit.message"),
        authorLogin: strOrNull(path(c, "author", "user", "login"), "commit author login"),
        authorEmail: strOrNull(path(c, "author", "email"), "commit author email") ?? "",
        committedDate: str(member(c, "committedDate"), "commit.committedDate"),
      });
    } catch (error) {
      problems.push(error instanceof ReadError ? error.message : "commit: unreadable");
    }
  }
  return out;
}

export function parseQueueEntry(value: unknown): QueueEntry | null {
  if (value === null || value === undefined) {
    return null;
  }
  const o = obj(value, "mergeQueueEntry");
  return {
    id: str(member(o, "id"), "queue.id"),
    position: num(member(o, "position"), "queue.position"),
    state: oneOf(member(o, "state"), ["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "UNMERGEABLE", "LOCKED"], "queue.state"),
    jump: bool(member(o, "jump"), "queue.jump"),
    enqueuedAt: str(member(o, "enqueuedAt"), "queue.enqueuedAt"),
  };
}

export interface RawRemoval {
  readonly at: string;
  readonly reason: string;
  readonly beforeCommit: Sha | null;
}

/** The newest removal from the merge queue. */
export function parseLastRemoval(nodes: readonly unknown[]): RawRemoval | null {
  const removals = nodes
    .filter(isObj)
    .filter((n) => member(n, "__typename") === "RemovedFromMergeQueueEvent")
    .map((n) => ({
      at: str(member(n, "createdAt"), "removal.createdAt"),
      reason: strOrNull(member(n, "reason"), "removal.reason") ?? "",
      beforeCommit: shaOrNull(path(n, "beforeCommit", "oid"), "removal.beforeCommit"),
    }));
  return removals.sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
}
