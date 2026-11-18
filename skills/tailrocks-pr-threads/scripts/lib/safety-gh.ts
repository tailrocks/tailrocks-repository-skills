// Allow-list guard for `gh` (design section 8).
//
// `checkGh` accepts read-only and low-risk shapes. Each `gh` subcommand has its
// own table of allowed flags, and every flag value is checked. Anything that
// is not in a table is refused. Mutating GitHub API calls never pass through
// the generic guard: the caller names a typed `GhMutation`, and
// `ghMutationArgv` turns it into a fixed argv that holds library-owned query
// text. No free text chooses an endpoint or a GraphQL operation.

import { isBodyFilePath } from "./body-file.ts";
import { ALLOWED, type Guard, isFlag, refuse } from "./guard.ts";
import { isSha, type RepoSlug, type Sha } from "./types.ts";

// ---------- Flag tables ----------

type ValueCheck = (value: string) => boolean;

/** One allowed flag: a switch, or a flag with a checked value. */
type FlagRule = { readonly kind: "switch" } | { readonly kind: "value"; readonly check: ValueCheck };

interface CommandSpec {
  readonly maxPositionals: number;
  readonly positional: ValueCheck;
  readonly flags: ReadonlyMap<string, FlagRule>;
}

const anyText: ValueCheck = (value) => !value.includes("\0");
const matches =
  (pattern: RegExp): ValueCheck =>
  (value) =>
    pattern.test(value);
const oneOf =
  (...options: readonly string[]): ValueCheck =>
  (value) =>
    options.includes(value);

const isSelector = matches(/^[A-Za-z0-9_][A-Za-z0-9_.\/:#@-]*$/);
const isRepoSlug = (value: string): boolean => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.includes("..");
const isBranch = matches(/^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._/-]*)?$/);
const isJsonFields = matches(/^[A-Za-z][A-Za-z0-9]*(?:,[A-Za-z][A-Za-z0-9]*)*$/);
const isNumber = matches(/^[0-9]{1,9}$/);
const isDuration = matches(/^[0-9]{1,6}[smh]?$/);
const isLabelList = (value: string): boolean => value.length > 0 && value.length <= 400 && !/[\0\n\r]/.test(value);
const isTitle = (value: string): boolean => value.length > 0 && value.length <= 1000 && !/[\0\n\r]/.test(value);
// gojq inside gh can read the process environment, so the filter may not name it.
const isSafeJq = (value: string): boolean =>
  !value.includes("\0") && !/\benv\b|\$ENV|\binputs?\b|\bdebug\b|\bstderr\b|\binput_filename\b|\$__loc__/.test(value);

/** The only body source gh may read: a file that `writeBodyFile` made. */
const isLibraryBodyFile: ValueCheck = (value) => isBodyFilePath(value);

function build(entries: readonly (readonly [readonly string[], FlagRule])[]): ReadonlyMap<string, FlagRule> {
  const map = new Map<string, FlagRule>();
  for (const [names, rule] of entries) {
    for (const name of names) {
      map.set(name, rule);
    }
  }
  return map;
}

const SWITCH: FlagRule = { kind: "switch" };
const value = (check: ValueCheck): FlagRule => ({ kind: "value", check });

const REPO_FLAG = [["--repo", "-R"], value(isRepoSlug)] as const;
const JSON_FLAGS = [
  [["--json"], value(isJsonFields)],
  [["--jq", "-q"], value(isSafeJq)],
  [["--template", "-t"], value(anyText)],
] as const;
const BODY_FILE_FLAG = [["--body-file", "-F"], value(isLibraryBodyFile)] as const;

const SPECS: ReadonlyMap<string, CommandSpec> = new Map<string, CommandSpec>([
  [
    "pr view",
    { maxPositionals: 1, positional: isSelector, flags: build([REPO_FLAG, ...JSON_FLAGS, [["--comments"], SWITCH]]) },
  ],
  [
    "pr list",
    {
      maxPositionals: 0,
      positional: isSelector,
      flags: build([
        REPO_FLAG,
        ...JSON_FLAGS,
        [["--state", "-s"], value(oneOf("open", "closed", "merged", "all"))],
        [["--author", "-A"], value(matches(/^[A-Za-z0-9@_-]{1,100}$/))],
        [["--base", "-B"], value(isBranch)],
        [["--head", "-H"], value(isBranch)],
        [["--label", "-l"], value(isLabelList)],
        [["--limit", "-L"], value(isNumber)],
        [["--search", "-S"], value(isTitle)],
        [["--draft"], SWITCH],
      ]),
    },
  ],
  [
    "pr create",
    {
      maxPositionals: 0,
      positional: isSelector,
      flags: build([
        REPO_FLAG,
        BODY_FILE_FLAG,
        [["--draft"], SWITCH],
        [["--title", "-t"], value(isTitle)],
        [["--base", "-B"], value(isBranch)],
        [["--head", "-H"], value(isBranch)],
        [["--label", "-l"], value(isLabelList)],
      ]),
    },
  ],
  [
    "pr edit",
    {
      maxPositionals: 1,
      positional: isSelector,
      // No `--base`, reviewer, assignee, or milestone flag: the design allows labels, title, and body.
      flags: build([
        REPO_FLAG,
        BODY_FILE_FLAG,
        [["--add-label"], value(isLabelList)],
        [["--remove-label"], value(isLabelList)],
        [["--title"], value(isTitle)],
      ]),
    },
  ],
  ["pr ready", { maxPositionals: 1, positional: isSelector, flags: build([REPO_FLAG]) }],
  [
    "pr checks",
    {
      maxPositionals: 1,
      positional: isSelector,
      flags: build([
        REPO_FLAG,
        ...JSON_FLAGS,
        [["--watch", "--fail-fast", "--required"], SWITCH],
        [["--interval", "-i"], value(isNumber)],
      ]),
    },
  ],
  [
    "pr diff",
    {
      maxPositionals: 1,
      positional: isSelector,
      flags: build([REPO_FLAG, [["--name-only", "--patch"], SWITCH], [["--color"], value(oneOf("always", "never", "auto"))]]),
    },
  ],
  [
    "pr comment",
    { maxPositionals: 1, positional: isSelector, flags: build([REPO_FLAG, BODY_FILE_FLAG]) },
  ],
  [
    "pr merge",
    {
      maxPositionals: 1,
      positional: isSelector,
      // No body, subject, `-F`, `--admin`, or `-d`: the merge commit text comes from the PR.
      flags: build([
        REPO_FLAG,
        [["--squash", "--merge", "--rebase", "--auto"], SWITCH],
        [["--match-head-commit"], value(isSha)],
      ]),
    },
  ],
  [
    "repo view",
    { maxPositionals: 1, positional: isRepoSlug, flags: build([...JSON_FLAGS]) },
  ],
  [
    "issue view",
    { maxPositionals: 1, positional: isSelector, flags: build([REPO_FLAG, ...JSON_FLAGS, [["--comments"], SWITCH]]) },
  ],
  [
    "run rerun",
    {
      maxPositionals: 1,
      positional: isNumber,
      flags: build([REPO_FLAG, [["--failed"], SWITCH], [["--job", "-j"], value(isNumber)]]),
    },
  ],
  [
    "run view",
    {
      maxPositionals: 1,
      positional: isNumber,
      flags: build([
        REPO_FLAG,
        ...JSON_FLAGS,
        [["--log", "--log-failed", "--exit-status", "--verbose", "-v"], SWITCH],
        [["--job", "-j"], value(isNumber)],
        [["--attempt", "-a"], value(isNumber)],
      ]),
    },
  ],
  [
    "run list",
    {
      maxPositionals: 0,
      positional: isNumber,
      flags: build([
        REPO_FLAG,
        ...JSON_FLAGS,
        [["--limit", "-L"], value(isNumber)],
        [["--branch", "-b"], value(isBranch)],
        [["--workflow", "-w"], value(matches(/^[A-Za-z0-9_. /-]{1,200}$/))],
        [["--commit", "-c"], value(isSha)],
        [["--event", "-e"], value(matches(/^[a-z_]{1,50}$/))],
        [["--status", "-s"], value(matches(/^[a-z_]{1,50}$/))],
        [["--user", "-u"], value(matches(/^[A-Za-z0-9_-]{1,100}$/))],
      ]),
    },
  ],
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

/** Check one subcommand's arguments against its flag table. */
function checkSpec(name: string, spec: CommandSpec, rest: readonly string[]): Guard {
  let positionals = 0;
  let matchHead = false;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (!isFlag(token)) {
      positionals += 1;
      if (positionals > spec.maxPositionals) {
        return refuse(`gh ${name} takes at most ${spec.maxPositionals} positional argument(s)`);
      }
      if (!spec.positional(token)) {
        return refuse(`gh ${name} positional argument has a form that is not allowed`);
      }
      continue;
    }
    const { flag, value: inline } = splitLong(token);
    if (name === "pr merge" && (flag === "--delete-branch" || /^-[A-Za-z]*d[A-Za-z]*$/.test(flag))) {
      return refuse("gh pr merge may not delete branches (-d, --delete-branch)");
    }
    const rule = spec.flags.get(flag);
    if (rule === undefined) {
      return refuse(`gh ${name} flag ${flag} is not in the allow-list`);
    }
    if (rule.kind === "switch") {
      if (inline !== null) {
        return refuse(`gh ${name} flag ${flag} takes no value`);
      }
      continue;
    }
    let flagValue = inline;
    if (flagValue === null) {
      i += 1;
      flagValue = rest[i] ?? null;
    }
    if (flagValue === null) {
      return refuse(`gh ${name} flag ${flag} needs a value`);
    }
    if (!rule.check(flagValue)) {
      return refuse(
        flag === "--body-file" || flag === "-F"
          ? `gh ${name} ${flag} must name a file made by writeBodyFile`
          : `gh ${name} flag ${flag} has a value that is not allowed`,
      );
    }
    if (flag === "--match-head-commit") {
      matchHead = true;
    }
  }
  if (name === "pr merge" && !matchHead) {
    return refuse("gh pr merge needs --match-head-commit with a 40-hex commit id");
  }
  return ALLOWED;
}

// ---------- gh api ----------

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
// Exactly the Accept headers that the library sends. Any other header can
// override the method or add credentials.
const API_HEADERS: ReadonlySet<string> = new Set([
  "Accept: application/vnd.github.raw+json",
  "Accept: application/vnd.github+json",
]);

/**
 * A free-text GraphQL document is allowed only when it holds no operation
 * that could write. The word "mutation" or "subscription" may not appear
 * anywhere in the text, in any letter case: the text is not parsed or
 * stripped, so comments and strings cannot hide it. Library constants run
 * mutations through `ghMutationArgv` instead.
 */
function isReadOnlyGraphql(document: string): boolean {
  return !/mutation|subscription/i.test(document);
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
    let flagValue = inlineValue;
    if (flagValue === null) {
      i += 1;
      flagValue = rest[i] ?? null;
    }
    if (flagValue === null) {
      return refuse(`gh api flag ${flag} needs a value`);
    }
    if (flag === "-X" || flag === "--method") {
      method = flagValue.toUpperCase();
      methodExplicit = true;
    } else if (flag === "-H" || flag === "--header") {
      if (!API_HEADERS.has(flagValue)) {
        return refuse("gh api header is not in the allow-list (only the library Accept headers)");
      }
    } else if (flag === "-q" || flag === "--jq") {
      if (!isSafeJq(flagValue)) {
        return refuse("gh api --jq may not read the environment or other inputs");
      }
    } else if (flag === "--cache") {
      if (!isDuration(flagValue)) {
        return refuse("gh api --cache needs a duration such as 60s");
      }
    } else if (flag === "-f" || flag === "--raw-field" || flag === "-F" || flag === "--field") {
      const eq = flagValue.indexOf("=");
      if (eq <= 0) {
        return refuse("gh api field must be name=value");
      }
      const fieldValue = flagValue.slice(eq + 1);
      if ((flag === "-F" || flag === "--field") && fieldValue.startsWith("@")) {
        return refuse("gh api field values may not read files");
      }
      fields.push({ name: flagValue.slice(0, eq), value: fieldValue });
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
  if (/^graphql(?:\/|$)/i.test(path)) {
    for (const field of fields) {
      if (field.name.toLowerCase().startsWith("query") && !isReadOnlyGraphql(field.value)) {
        return refuse("gh api graphql accepts read-only queries only; use a typed mutation");
      }
    }
    return ALLOWED;
  }
  if (fields.length > 0 && !methodExplicit) {
    return refuse("gh api fields on a REST endpoint make the call a POST; pass -X GET");
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
  if (command === "api") {
    return checkApi(args.slice(1));
  }
  if (command === "auth") {
    // Exactly `gh auth status`. Any flag could show the token (--show-token,
    // -t, combined short flags, --show-token=true), so no argument is allowed.
    if (sub === "status" && args.length === 2) {
      return ALLOWED;
    }
    return refuse(
      sub === "token" ? "gh auth token is never allowed" : "only `gh auth status` without arguments is allowed",
    );
  }
  const name = `${command} ${sub ?? ""}`;
  const spec = SPECS.get(name);
  if (spec === undefined) {
    return refuse(`gh ${name.trim()} is not in the allow-list`);
  }
  return checkSpec(name, spec, args.slice(2));
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
