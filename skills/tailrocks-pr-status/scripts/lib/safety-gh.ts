// Allow-list guard for `gh` (design section 8).
//
// `checkGh` accepts read-only and low-risk shapes. Mutating GitHub API calls
// never pass through it: the caller builds a typed `GhMutation`, and
// `ghMutationArgv` turns it into a fixed argv. No free text chooses an
// endpoint or a GraphQL document.

import { ALLOWED, type Guard, isFlag, refuse } from "./guard.ts";
import { isSha, type RepoSlug, type Sha } from "./types.ts";

const PR_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "view",
  "list",
  "create",
  "edit",
  "ready",
  "merge",
  "checks",
  "diff",
  "comment",
]);

// `gh api` flags that take a value, and boolean flags. Anything else is refused.
const API_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-X",
  "--method",
  "-H",
  "--header",
  "-q",
  "--jq",
  "-t",
  "--template",
  "-f",
  "--raw-field",
  "-F",
  "--field",
  "--cache",
]);
const API_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--paginate",
  "--slurp",
  "-i",
  "--include",
  "--silent",
]);
const API_ENDPOINT = /^[A-Za-z0-9_./~%?&=:,+@-]+$/;

// `gh pr merge` is allow-listed flag by flag: it is the one `pr` command that
// can destroy data.
const MERGE_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--squash",
  "-s",
  "--merge",
  "-m",
  "--rebase",
  "-r",
  "--auto",
  "--disable-auto",
]);
const MERGE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--match-head-commit",
  "--subject",
  "-t",
  "--body",
  "-b",
  "--body-file",
  "-F",
  "--repo",
  "-R",
]);

const COMMENT_REFUSED_FLAGS: ReadonlySet<string> = new Set([
  "--delete-last",
  "--delete-last-yes",
  "--edit-last",
]);

function splitLong(token: string): { readonly flag: string; readonly value: string | null } {
  if (token.startsWith("--")) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      return { flag: token.slice(0, eq), value: token.slice(eq + 1) };
    }
  }
  return { flag: token, value: null };
}

/** Strip comments and string literals from a GraphQL document. */
function stripGraphqlNoise(document: string): string {
  return document
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, " ")
    .replace(/#[^\n]*/g, " ");
}

function isQueryOnly(document: string): boolean {
  return !/\b(?:mutation|subscription)\b/i.test(stripGraphqlNoise(document));
}

function checkApi(rest: readonly string[]): Guard {
  let method = "GET";
  let methodExplicit = false;
  let endpoint: string | null = null;
  const fields: { readonly name: string; readonly value: string }[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (!isFlag(token)) {
      if (endpoint !== null) {
        return refuse("gh api takes exactly one endpoint");
      }
      endpoint = token;
      continue;
    }
    const { flag, value: inlineValue } = splitLong(token);
    if (API_BOOLEAN_FLAGS.has(flag)) {
      if (inlineValue !== null) {
        return refuse(`gh api flag ${flag} takes no value`);
      }
      continue;
    }
    if (!API_VALUE_FLAGS.has(flag)) {
      return refuse(`gh api flag ${flag} is not in the allow-list`);
    }
    let value = inlineValue;
    if (value === null) {
      i += 1;
      value = rest[i] ?? null;
    }
    if (value === null) {
      return refuse(`gh api flag ${flag} needs a value`);
    }
    if (flag === "-X" || flag === "--method") {
      method = value.toUpperCase();
      methodExplicit = true;
    } else if (flag === "-f" || flag === "--raw-field" || flag === "-F" || flag === "--field") {
      const eq = value.indexOf("=");
      if (eq <= 0) {
        return refuse("gh api field must be name=value");
      }
      const fieldValue = value.slice(eq + 1);
      if ((flag === "-F" || flag === "--field") && fieldValue.startsWith("@")) {
        return refuse("gh api field values may not read files");
      }
      fields.push({ name: value.slice(0, eq), value: fieldValue });
    }
  }

  if (endpoint === null) {
    return refuse("gh api needs an endpoint");
  }
  if (method !== "GET") {
    return refuse(`gh api method ${method} is allowed only through a typed mutation`);
  }
  if (!API_ENDPOINT.test(endpoint) || endpoint.includes("://") || endpoint.includes("..")) {
    return refuse("gh api endpoint must be a plain relative path");
  }
  const path = endpoint.replace(/^\//, "").split("?")[0] ?? "";
  if (path === "graphql") {
    for (const field of fields) {
      if (field.name === "query" && !isQueryOnly(field.value)) {
        return refuse("gh api graphql accepts queries only; use a typed mutation");
      }
    }
    return ALLOWED;
  }
  if (fields.length > 0 && !methodExplicit) {
    return refuse("gh api fields on a REST endpoint make the call a POST; pass -X GET");
  }
  return ALLOWED;
}

function checkMerge(rest: readonly string[]): Guard {
  let matchHead: string | null = null;
  let positionals = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (!isFlag(token)) {
      positionals += 1;
      if (positionals > 1) {
        return refuse("gh pr merge takes at most one pull request selector");
      }
      continue;
    }
    const { flag, value: inlineValue } = splitLong(token);
    if (flag === "--delete-branch" || /^-[A-Za-z]*d[A-Za-z]*$/.test(flag)) {
      return refuse("gh pr merge may not delete branches (-d, --delete-branch)");
    }
    if (MERGE_BOOLEAN_FLAGS.has(flag)) {
      continue;
    }
    if (!MERGE_VALUE_FLAGS.has(flag)) {
      return refuse(`gh pr merge flag ${flag} is not in the allow-list`);
    }
    let value = inlineValue;
    if (value === null) {
      i += 1;
      value = rest[i] ?? null;
    }
    if (value === null) {
      return refuse(`gh pr merge flag ${flag} needs a value`);
    }
    if (flag === "--match-head-commit") {
      matchHead = value;
    }
  }
  if (matchHead === null || !isSha(matchHead)) {
    return refuse("gh pr merge needs --match-head-commit with a 40-hex commit id");
  }
  return ALLOWED;
}

/** Decide whether `gh <args>` may run. */
export function checkGh(args: readonly string[]): Guard {
  const [command, sub] = args;
  if (command === undefined) {
    return refuse("empty gh command");
  }
  for (const token of args) {
    if (token.includes("\0")) {
      return refuse("argument contains a NUL byte");
    }
    if (token === "--admin" || token.startsWith("--admin=")) {
      return refuse("--admin is never allowed");
    }
  }
  switch (command) {
    case "api":
      return checkApi(args.slice(1));
    case "pr": {
      if (sub === undefined || !PR_SUBCOMMANDS.has(sub)) {
        return refuse(`gh pr ${sub ?? ""} is not in the allow-list`);
      }
      const rest = args.slice(2);
      if (sub === "merge") {
        return checkMerge(rest);
      }
      if (sub === "comment" && rest.some((t) => COMMENT_REFUSED_FLAGS.has(splitLong(t).flag))) {
        return refuse("gh pr comment may not edit or delete comments");
      }
      return ALLOWED;
    }
    case "repo":
    case "issue":
      return sub === "view" ? ALLOWED : refuse(`gh ${command} ${sub ?? ""} is not in the allow-list`);
    case "auth": {
      if (sub === "token") {
        return refuse("gh auth token is never allowed");
      }
      if (sub !== "status") {
        return refuse(`gh auth ${sub ?? ""} is not in the allow-list`);
      }
      if (args.slice(2).some((t) => t === "-t" || t === "--show-token")) {
        return refuse("gh auth status may not show the token");
      }
      return ALLOWED;
    }
    default:
      return refuse(`gh ${command} is not in the allow-list`);
  }
}

// ---------- Typed mutations ----------

export type GhMutation =
  | {
      readonly kind: "issue-comment"; // also used for pull request conversation comments
      readonly repo: RepoSlug;
      readonly number: number;
      readonly body: string;
    }
  | { readonly kind: "addPullRequestReviewThreadReply"; readonly threadId: string; readonly body: string }
  | { readonly kind: "resolveReviewThread"; readonly threadId: string }
  | {
      readonly kind: "enqueuePullRequest";
      readonly pullRequestId: string;
      readonly expectedHeadOid: Sha;
      readonly jump: boolean;
    }
  | { readonly kind: "dequeuePullRequest"; readonly entryId: string }
  | { readonly kind: "markPullRequestReadyForReview"; readonly pullRequestId: string }
  | {
      readonly kind: "requestReviews";
      readonly pullRequestId: string;
      readonly userIds: readonly string[];
    };

const NODE_ID = /^[A-Za-z0-9_=+/-]{1,200}$/;
const MAX_BODY = 65_000;

const DOCUMENTS = {
  addPullRequestReviewThreadReply:
    "mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) { comment { id } } }",
  resolveReviewThread:
    "mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }",
  enqueuePullRequest:
    "mutation($pullRequestId: ID!, $expectedHeadOid: GitObjectID, $jump: Boolean) { enqueuePullRequest(input: {pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid, jump: $jump}) { mergeQueueEntry { id position state } } }",
  dequeuePullRequest:
    "mutation($entryId: ID!) { dequeuePullRequest(input: {id: $entryId}) { mergeQueueEntry { id } } }",
  markPullRequestReadyForReview:
    "mutation($pullRequestId: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $pullRequestId}) { pullRequest { id isDraft } } }",
  requestReviews:
    "mutation($pullRequestId: ID!, $userIds: [ID!]) { requestReviews(input: {pullRequestId: $pullRequestId, userIds: $userIds, union: true}) { clientMutationId } }",
} as const;

function graphql(operation: keyof typeof DOCUMENTS, fields: readonly string[]): readonly string[] {
  return ["api", "graphql", "-f", `query=${DOCUMENTS[operation]}`, ...fields];
}

function checkedId(name: string, value: string): string {
  if (!NODE_ID.test(value)) {
    throw new RangeError(`${name} is not a GitHub node id`);
  }
  return value;
}

function checkedBody(body: string): string {
  if (body.length === 0 || body.length > MAX_BODY) {
    throw new RangeError("comment body must have 1 to 65000 characters");
  }
  return body;
}

/**
 * Build the argv for one allow-listed mutation. Throws RangeError on a bad
 * value. The result is the only argv shape that may use a mutating gh api call.
 */
export function ghMutationArgv(op: GhMutation): readonly string[] {
  switch (op.kind) {
    case "issue-comment": {
      if (!Number.isInteger(op.number) || op.number < 1) {
        throw new RangeError("issue number must be a positive integer");
      }
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(op.repo)) {
        throw new RangeError("repository must be owner/name");
      }
      return [
        "api",
        "--method",
        "POST",
        `repos/${op.repo}/issues/${op.number}/comments`,
        "-f",
        `body=${checkedBody(op.body)}`,
      ];
    }
    case "addPullRequestReviewThreadReply":
      return graphql(op.kind, [
        "-f",
        `threadId=${checkedId("threadId", op.threadId)}`,
        "-f",
        `body=${checkedBody(op.body)}`,
      ]);
    case "resolveReviewThread":
      return graphql(op.kind, ["-f", `threadId=${checkedId("threadId", op.threadId)}`]);
    case "enqueuePullRequest":
      return graphql(op.kind, [
        "-f",
        `pullRequestId=${checkedId("pullRequestId", op.pullRequestId)}`,
        "-f",
        `expectedHeadOid=${op.expectedHeadOid}`,
        "-F",
        `jump=${op.jump ? "true" : "false"}`,
      ]);
    case "dequeuePullRequest":
      return graphql(op.kind, ["-f", `entryId=${checkedId("entryId", op.entryId)}`]);
    case "markPullRequestReadyForReview":
      return graphql(op.kind, ["-f", `pullRequestId=${checkedId("pullRequestId", op.pullRequestId)}`]);
    case "requestReviews": {
      if (op.userIds.length === 0) {
        throw new RangeError("requestReviews needs at least one user id");
      }
      return graphql(op.kind, [
        "-f",
        `pullRequestId=${checkedId("pullRequestId", op.pullRequestId)}`,
        ...op.userIds.flatMap((id) => ["-f", `userIds[]=${checkedId("userId", id)}`]),
      ]);
    }
  }
}
