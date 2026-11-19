// Build the plan. This reads GitHub and git and runs the policy checks. It
// writes no commit, no branch, no PR, and no remote ref.

import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { matchesAnyGlob } from "../glob.ts";
import { ReadError } from "../github/read.ts";
import { fetchBasePolicy } from "../policy/fetch.ts";
import { secretLineNumbers } from "../proc.ts";
import { sameLogin } from "../status/text.ts";
import type { Sha } from "../types.ts";
import { isPushableBranch } from "./args.ts";
import {
  bodyChecks,
  bodyClosesIssue,
  buildSkeleton,
  decideLink,
  finalBody,
  requiredHeadings,
  templatePlaceholders,
} from "./body.ts";
import { inventoryApplies, inventoryFix, inventoryMisses, runPrepushSteps } from "../policy-steps.ts";
import {
  branchProblem,
  remoteRepoSlug,
  unsignedCommits,
} from "./checks.ts";
import {
  listOpenPrs,
  readBranchSha,
  readIssue,
  readRepo,
  readTemplate,
  readUser,
  StepError,
} from "./github.ts";
import {
  changedPaths,
  conflictsWithBase,
  fetchBranch,
  gitOut,
  gitSha,
  hasCommit,
  isAncestor,
  listCommits,
  mergeBaseOf,
  readTreeState,
  remoteUrl,
} from "./local.ts";
import type {
  CreateArgs,
  CreateConfig,
  Finding,
  FindingKind,
  IssueFacts,
  LinkDecision,
  OpenPr,
  PlanResult,
  RemoteRelation,
} from "./types.ts";

const MAX_BODY_FILE_BYTES = 262_144;
const MAX_TITLE_CHARS = 256;

/** Read the body file that the agent wrote. Only a plain file of limited size passes. */
export async function readBodyFile(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile()) {
    throw new StepError(`${path} is not a regular file`);
  }
  if (info.size === 0 || info.size > MAX_BODY_FILE_BYTES) {
    throw new StepError(`${path} must hold 1 byte to 256 KiB`);
  }
  const text = await readFile(path, "utf8");
  if (text.includes("\0")) {
    throw new StepError(`${path} holds a NUL byte`);
  }
  return text;
}

interface Parent {
  readonly number: number;
  readonly ref: string;
  readonly sha: Sha;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

function withinRoot(root: string, file: string): string | null {
  const full = resolve(root, file);
  return full.startsWith(`${root}${sep}`) ? full : null;
}

const MAX_PARENT_PROBES = 30;

interface ParentSearch {
  /** An open PR whose head is part of this branch: the branch was cut from its current tip. */
  readonly parent: OpenPr | null;
  /** Open PRs that share commits with this branch but whose head is not part of it. Only without a parent. */
  readonly ambiguous: readonly OpenPr[];
  readonly skipped: number;
}

/**
 * The open PR that this branch is built on, or null. A PR is the parent only
 * when its head is an ancestor of HEAD and the default branch lacks it: the
 * branch was cut from the parent's current tip. A PR whose head holds this whole
 * branch is a child and never counts. A PR that shares some commits with this
 * branch, but whose head is neither an ancestor of it nor a descendant, is
 * ambiguous (a child that forked early, or a parent that moved on): the plan
 * blocks and asks for --base. The search fetches the head branches of at most
 * MAX_PARENT_PROBES other PRs.
 */
async function findParent(
  git: CreateConfig["runGit"],
  remote: string,
  candidates: readonly OpenPr[],
  headSha: Sha,
  defaultSha: Sha,
): Promise<ParentSearch> {
  const revs = (await gitOut(git, ["rev-list", headSha, `^${defaultSha}`])).split("\n").map((l) => l.trim()).filter((l) => l !== "");
  for (const rev of revs) {
    const exact = candidates.find((p) => p.headSha === rev);
    if (exact !== undefined) {
      return { parent: exact, ambiguous: [], skipped: 0 };
    }
  }
  const ambiguous: OpenPr[] = [];
  for (const pr of candidates.slice(0, MAX_PARENT_PROBES)) {
    if (!(await hasCommit(git, pr.headSha))) {
      try {
        await fetchBranch(git, remote, pr.headRef);
      } catch (error) {
        if (error instanceof StepError) {
          continue;
        }
        throw error;
      }
      if (!(await hasCommit(git, pr.headSha))) {
        continue;
      }
    }
    // A PR that holds this whole branch is a child, not a parent.
    if (await isAncestor(git, headSha, pr.headSha)) {
      continue;
    }
    const base = await mergeBaseOf(git, headSha, pr.headSha);
    if (base !== null && revs.includes(base)) {
      ambiguous.push(pr);
    }
  }
  return { parent: null, ambiguous, skipped: Math.max(0, candidates.length - MAX_PARENT_PROBES) };
}

export async function buildPlan(args: CreateArgs, cfg: CreateConfig): Promise<PlanResult> {
  try {
    return await plan(args, cfg);
  } catch (error) {
    if (error instanceof StepError || error instanceof ReadError) {
      return { kind: "failed", error: error.message };
    }
    throw error;
  }
}

async function plan(args: CreateArgs, cfg: CreateConfig): Promise<PlanResult> {
  const git = cfg.runGit;
  const gh = cfg.runGh;
  const findings: Finding[] = [];
  const add = (code: string, kind: FindingKind, detail: string, next: string, items: readonly string[] = []): void => {
    findings.push({ code, kind, detail, next, items });
  };
  const blocked = (): boolean => findings.some((f) => f.kind !== "info");

  const root = (await gitOut(git, ["rev-parse", "--show-toplevel"])).trim();
  const { repo, defaultBranch } = await readRepo(gh, args.repo);
  const user = await readUser(gh);
  const headSha = await gitSha(git, ["rev-parse", "HEAD"]);
  const current = (await gitOut(git, ["branch", "--show-current"])).trim();
  const headBranch = args.branch ?? (current === "" ? null : current);

  const url = await remoteUrl(git, args.remote);
  if (url === null) {
    throw new StepError(`the remote ${args.remote} is not set; pass --remote <name>`);
  }
  const named = remoteRepoSlug(url);
  if (named !== null && named.toLowerCase() !== repo.toLowerCase()) {
    throw new StepError(`the remote ${args.remote} points at ${named}, but the repository is ${repo}; pass --remote <name> or --repo`);
  }

  // ---------- The PRs ----------
  const openPrs = await listOpenPrs(gh, repo, null);
  const mine =
    headBranch === null || !isPushableBranch(headBranch)
      ? []
      : await listOpenPrs(gh, repo, headBranch).then((list) => list.filter((p) => p.headRef === headBranch && !p.isCrossRepository));
  const existing: OpenPr | null = mine.length === 1 ? (mine[0] ?? null) : null;
  if (mine.length > 1) {
    add("pr_multiple", "refusal", `${mine.length} open PRs have the head branch ${headBranch ?? ""}: ${mine.map((p) => `#${p.number}`).join(", ")}`, "Ask the user which PR to keep. Do not open another.");
  }
  if (existing !== null) {
    if (!sameLogin(existing.author, user)) {
      add("pr_not_yours", "refusal", `PR #${existing.number} was opened by ${existing.author}, not by ${user}`, "Do not push to it. Ask the user.");
    }
    if (args.base !== null && args.base !== existing.baseRef) {
      add("pr_other_base", "refusal", `PR #${existing.number} has the base ${existing.baseRef}, but --base is ${args.base}`, "Ask the user. Do not retarget or open a second PR.");
    }
  }

  // ---------- The policy ----------
  // The policy comes from the default branch at its current commit, never from a
  // parent or another base branch: that work is not reviewed yet.
  const defaultSha = await readBranchSha(gh, repo, defaultBranch);
  const fetchBranchTip = async (branch: string, sha: Sha): Promise<void> => {
    const got = await fetchBranch(git, args.remote, branch);
    if (got.kind === "missing") {
      throw new StepError(`the base branch ${branch} is not on the remote ${args.remote}`);
    }
    if (!(await hasCommit(git, sha))) {
      throw new StepError(`the base commit ${short(sha)} of ${branch} is not in the local clone after the fetch`);
    }
  };
  await fetchBranchTip(defaultBranch, defaultSha);
  const loaded = await fetchBasePolicy(repo, defaultSha, { cwd: cfg.cwd, runGh: gh });
  if (!loaded.ok) {
    return { kind: "policy-error", errors: loaded.errors };
  }
  const { policy, source: policySource } = loaded;

  // ---------- The base ----------
  const wantedBase = args.base ?? existing?.baseRef ?? null;
  const isOther = (p: OpenPr): boolean => !p.isCrossRepository && p.headRef !== headBranch;
  let baseRef = wantedBase ?? defaultBranch;
  let baseSha: Sha = defaultSha;
  let stackedOn: Parent | null = null;
  if (wantedBase !== null && wantedBase !== defaultBranch) {
    const parent = openPrs.find((p) => isOther(p) && p.headRef === wantedBase);
    if (parent !== undefined) {
      stackedOn = { number: parent.number, ref: parent.headRef, sha: parent.headSha };
      baseSha = parent.headSha;
      if (!(await hasCommit(git, baseSha))) {
        await fetchBranchTip(parent.headRef, baseSha);
      }
    } else {
      baseSha = await readBranchSha(gh, repo, wantedBase);
      await fetchBranchTip(wantedBase, baseSha);
    }
  } else if (wantedBase === null) {
    const found = await findParent(git, args.remote, openPrs.filter(isOther), headSha, defaultSha);
    if (found.parent !== null) {
      stackedOn = { number: found.parent.number, ref: found.parent.headRef, sha: found.parent.headSha };
      baseRef = found.parent.headRef;
      baseSha = found.parent.headSha;
    }
    for (const other of found.ambiguous) {
      add(
        "base_ambiguous",
        "blocker",
        `the open PR #${other.number} (${other.headRef}) shares commits with this branch, but its head is not part of it`,
        `Pass --base ${other.headRef} to stack on that PR's branch, or --base ${defaultBranch} to open against the default branch.`,
      );
    }
    if (found.skipped > 0) {
      add("stack_probe_capped", "info", `the parent search read ${MAX_PARENT_PROBES} open PRs and skipped ${found.skipped}`, "Pass --base <parent branch> when the branch is built on a PR that was skipped.");
    }
  }

  // A base that is neither the default branch nor the head of an open PR must be listed in the policy of the default branch.
  if (baseRef !== defaultBranch && stackedOn === null && !matchesAnyGlob(policy.branches.bases, baseRef)) {
    add("base_not_allowed", "blocker", `${baseRef} is not the default branch and not in branches.bases of the default-branch policy`, "Omit --base to use the default branch, or ask the user.");
  }
  if (stackedOn !== null) {
    add(
      "stacked",
      "info",
      `the branch is built on the open PR #${stackedOn.number} (${stackedOn.ref}); the base is ${stackedOn.ref}`,
      `pr-status reports "stacked" until PR #${stackedOn.number} merges. Then retarget the base.`,
    );
  }

  // ---------- The branch ----------
  if (headBranch === null) {
    add("detached_head", "blocker", "HEAD is not on a branch", "Create a branch at this commit with git switch -c <name>, or pass --branch <name>. The name must match branches.name_pattern.");
  } else if (!isPushableBranch(headBranch)) {
    add("branch_name", "blocker", `the branch name ${headBranch} has characters that the push guard refuses`, "Use a branch name with letters, digits, dot, dash, underscore, and slash only.");
  } else {
    const problem = branchProblem(headBranch, policy, defaultBranch);
    if (problem !== null) {
      add(
        problem.code,
        "blocker",
        problem.detail,
        problem.code === "on_protected_branch"
          ? "Create a branch at this commit with git switch -c <name>. Do not move or reset the base branch."
          : `Rename with git branch -m <name>, or pass --branch <name>. The name must match ${policy.branches.name_pattern}`,
      );
    }
  }

  let remoteHead: Sha | null = null;
  let relation: RemoteRelation = "absent";
  if (headBranch !== null && isPushableBranch(headBranch)) {
    const fetched = await fetchBranch(git, args.remote, headBranch);
    if (fetched.kind === "found") {
      remoteHead = fetched.sha;
      if (remoteHead === headSha) {
        relation = "same";
      } else if (await isAncestor(git, remoteHead, headSha)) {
        relation = "behind";
      } else {
        relation = "diverged";
        add(
          "remote_diverged",
          "refusal",
          `${args.remote}/${headBranch} holds commits that this branch lacks (remote ${short(remoteHead)}, local ${short(headSha)})`,
          "Never force-push. Ask the user how to join the two histories.",
        );
      }
    }
  }

  const tree = await readTreeState(git);
  if (tree.tracked.length > 0) {
    add("dirty_tree", "blocker", `${tree.tracked.length} tracked file${tree.tracked.length === 1 ? " has" : "s have"} uncommitted changes`, "Commit the changes with git add <explicit paths> and git commit -s, then run plan again.", tree.tracked.slice(0, 10));
  }
  if (tree.untracked.length > 0) {
    add("untracked_files", "info", `${tree.untracked.length} untracked file${tree.untracked.length === 1 ? "" : "s"} are not in the commits`, "Check that none of them belongs to this change.", tree.untracked.slice(0, 10));
  }

  const commits = await listCommits(git, headSha, baseSha);
  if (commits.length === 0) {
    add("no_commits", "blocker", "the branch holds no commit that the base lacks", "Commit the change first with git commit -s.");
  }
  const behind = Number((await gitOut(git, ["rev-list", "--count", baseSha, `^${headSha}`])).trim());
  if (Number.isInteger(behind) && behind > 0 && stackedOn === null) {
    add("behind_base", "info", `the base is ${behind} commit${behind === 1 ? "" : "s"} ahead of the branch`, "No action now. After the PR is open, pr-refresh sync merges the base.");
  }

  // ---------- Sign-off ----------
  const unsigned = unsignedCommits(commits, policy);
  let unsignedPushed: readonly string[] = [];
  if (unsigned.length > 0) {
    const flags = await Promise.all(unsigned.map(async (c) => remoteHead !== null && (await isAncestor(git, c.sha, remoteHead))));
    const onRemote = unsigned.filter((_, index) => flags[index] === true);
    const local = unsigned.filter((_, index) => flags[index] !== true);
    const label = (c: { sha: string; subject: string }): string => `${short(c.sha)} ${c.subject}`;
    unsignedPushed = onRemote.map(label);
    if (onRemote.length > 0) {
      // A fix needs a force-push, which no script here does. pr-refresh dco-fix owns it, and it needs an open PR.
      add(
        "dco_missing",
        "info",
        `${onRemote.length} commit${onRemote.length === 1 ? " lacks" : "s lack"} a sign-off and ${onRemote.length === 1 ? "is" : "are"} already on the remote branch. The PR opens as a draft, and open exits 20.`,
        existing === null ? "After open, run pr-refresh dco-fix <the PR number that open prints>." : `Run pr-refresh dco-fix ${existing.number}.`,
        unsignedPushed,
      );
    }
    if (local.length > 0) {
      add(
        "dco_missing",
        "blocker",
        `${local.length} unpushed commit${local.length === 1 ? " lacks" : "s lack"} a Signed-off-by line`,
        `Run signoff --expect-head ${headSha}. It adds the trailers to the unpushed commits and keeps every tree. Then run plan again.`,
        local.map(label),
      );
    }
  }

  // ---------- Conflicts, inventories ----------
  const paths = await changedPaths(git, baseSha, headSha);
  if (commits.length > 0 && (await conflictsWithBase(git, baseSha, headSha)) === true) {
    add(
      "conflict_with_base",
      "blocker",
      `the branch conflicts with ${baseRef}`,
      `Run git fetch ${args.remote} ${baseRef}, then git merge --signoff ${args.remote}/${baseRef}. Resolve the conflicts, commit, and run plan again.`,
    );
  }
  for (const inventory of policy.inventories) {
    if (!inventoryApplies(inventory, paths.added)) {
      continue;
    }
    const file = withinRoot(root, inventory.file);
    let text: string | null = null;
    if (file !== null) {
      try {
        text = await readFile(file, "utf8");
      } catch {
        text = null;
      }
    }
    if (text === null) {
      add("inventory_miss", "blocker", `inventory "${inventory.name}": the file ${inventory.file} cannot be read`, `Create ${inventory.file} and list the added files.`);
      continue;
    }
    const misses = inventoryMisses(inventory, paths.added, text);
    if (misses.length > 0) {
      add(
        "inventory_miss",
        "blocker",
        `inventory "${inventory.name}" does not name ${misses.length} added file${misses.length === 1 ? "" : "s"}`,
        inventoryFix(inventory, "commit, and run plan again.").replace(/^add/, "Add"),
        misses.slice(0, 20),
      );
    }
  }
  for (const entry of policy.regenerate) {
    if (entry.when_changed.length > 0 && paths.changed.some((file) => matchesAnyGlob(entry.when_changed, file))) {
      add(
        "regenerate_notice",
        "info",
        `files that feed "${entry.name}" changed; its outputs may be stale`,
        `Run ${entry.run.join(" ")} in ${entry.cwd}, commit any changed output with git commit -s, then run plan again.`,
        entry.outputs,
      );
    }
  }

  // ---------- Pre-push steps ----------
  const prepushRan: string[] = [];
  if (blocked() || commits.length === 0) {
    if (policy.prepush.length > 0) {
      add("prepush_skipped", "info", "the pre-push steps did not run", "Fix the blockers above first. The steps run on the next plan.");
    }
  } else {
    const prepush = await runPrepushSteps(policy.prepush, paths.changed, async (step) => {
      const result = await cfg.runCommand(step.run, withinRoot(root, step.cwd) ?? root);
      return { code: result.code, output: `${result.stdout}\n${result.stderr}` };
    });
    prepushRan.push(...prepush.ran);
    if (prepush.failure !== null) {
      const { step, code, tail } = prepush.failure;
      add("prepush_failed", "blocker", `pre-push step "${step.name}" failed (exit ${code}); nothing was pushed`, `Fix the cause, then run plan again.`, tail);
    }
    if (prepushRan.length > 0 && !blocked()) {
      const after = await readTreeState(git);
      if (after.tracked.length > 0) {
        add("prepush_changed_files", "blocker", `a pre-push step changed ${after.tracked.length} tracked file${after.tracked.length === 1 ? "" : "s"}`, "Review the changes, commit them with git commit -s, and run plan again.", after.tracked.slice(0, 10));
      }
    }
  }

  // ---------- Title, issue, labels ----------
  let title: string | null = existing?.title ?? args.title;
  if (existing === null && title === null) {
    title = commits.length === 1 ? (commits[0]?.subject ?? null) : null;
    if (title === null && commits.length > 1) {
      add("title_needed", "blocker", `${commits.length} commits: the title cannot come from one subject`, "Pass --title <text>.");
    }
  }
  if (existing === null && title !== null && (title.trim() === "" || title.length > MAX_TITLE_CHARS || /[\0\n\r]/.test(title))) {
    add("title_invalid", "blocker", `the title must be one line of 1 to ${MAX_TITLE_CHARS} characters`, "Pass --title <text>.");
    title = null;
  }
  if (existing === null && title !== null && secretLineNumbers(title).length > 0) {
    add("title_secret", "blocker", "the title holds text that looks like a credential", "Remove the credential from the commit subject or pass --title <text>.");
    title = null;
  }

  let issue: IssueFacts | null = null;
  if (args.issue !== null) {
    issue = await readIssue(gh, repo, args.issue, policy.issues.done_when_heading);
    if (issue.problem !== null) {
      add("issue_unreadable", "info", issue.problem, `The link is Part of #${issue.number}. Check the issue number.`);
    } else if (issue.state !== "OPEN") {
      add("issue_closed", "info", `issue #${issue.number} is ${issue.state.toLowerCase()}`, "Check that the link is intended.");
    }
  }

  const labels = [...args.labels];
  if (unsignedPushed.length > 0 && args.runCi) {
    add("run_ci_skipped", "info", "--run-ci is skipped while pushed commits lack a sign-off", "Fix the sign-off with pr-refresh dco-fix, then add the label.");
  } else if (policy.labels.pr_ci === "label") {
    const label = policy.labels.run_once !== "" ? policy.labels.run_once : policy.labels.run_always;
    if (args.runCi) {
      labels.push(label);
    } else {
      add("ci_label_deferred", "info", `full CI runs only while the PR holds the label ${label}`, "The label is not added now. Add it when the PR is ready: open --run-ci, or pr-refresh --run-ci.");
    }
  } else if (args.runCi) {
    add("run_ci_ignored", "info", "--run-ci has no effect: labels.pr_ci is always", "None.");
  }

  // ---------- The body ----------
  let skeleton: string | null = null;
  let requiredList: readonly string[] = [];
  let link: LinkDecision | null = null;
  let finalText: string | null = null;
  if (existing !== null) {
    add("pr_exists", "info", `PR #${existing.number} is open for ${headBranch ?? ""} (${existing.url})`, "open pushes new commits only. The title and body stay. Use pr-refresh metadata to change them.");
  } else {
    const found = await readTemplate(gh, repo, defaultSha, policy.pr_body.template);
    let template: string | null = null;
    if (policy.pr_body.template !== "" && found.kind === "found") {
      template = found.text;
    } else if (found.kind === "error") {
      add("template_unreadable", "info", `the body template could not be read: ${found.message}`, "The body skeleton comes from pr_body.sections.");
    }
    requiredList = requiredHeadings(template, policy);
    skeleton = buildSkeleton(template, policy, issue?.unchecked ?? []);
    const placeholders = template === null ? [] : templatePlaceholders(template);
    if (args.bodyFile !== null) {
      let body: string | null = null;
      try {
        body = await readBodyFile(args.bodyFile);
      } catch (error) {
        add("body_file_unreadable", "blocker", error instanceof Error ? error.message : "cannot read the body file", "Write the body to a plain text file and pass its path.");
      }
      const secrets = body === null ? [] : secretLineNumbers(body);
      if (body !== null && secrets.length > 0) {
        add("body_secret", "blocker", "the body holds text that looks like a credential", "Remove it from the body file. Never paste a token, a URL with credentials, or an authorization header.", secrets.map((n) => `line ${n}`));
        body = null;
      }
      if (body !== null) {
        const problems = bodyChecks(body, requiredList, placeholders);
        if (problems.length > 0) {
          add("body_invalid", "blocker", "the body does not follow the template", "Fill each section, remove each placeholder, and run plan again.", problems);
        }
        if (issue !== null) {
          link = decideLink(issue.number, issue.unchecked, body, policy.issues.done_when_heading, args.partOf, { issue: issue.number, commits: commits.map((c) => c.sha) }, { readable: issue.readable, hasDoneWhen: issue.hasDoneWhen });
          if (link.kind === "Part of" && bodyClosesIssue(body, issue.number)) {
            add(
              "link_conflict",
              "blocker",
              `the body closes #${issue.number}, but ${link.reason}`,
              `Replace the closing word with "Part of #${issue.number}", or add a checked Done-when line with proof for each box.`,
              link.unmapped,
            );
          }
        }
        if (problems.length === 0 && !findings.some((f) => f.code === "link_conflict")) {
          finalText = finalBody({ body, addLine: link !== null && !link.present ? link.line : null, footer: policy.pr_body.footer });
        }
      }
    } else if (issue !== null) {
      add(
        "issue_link_pending",
        "info",
        `the link to #${issue.number} is Closes only when every open Done-when box has a checked line with proof in the body; otherwise Part of`,
        "Run plan with --body-file to see the decision.",
        issue.unchecked,
      );
    }
  }

  // ---------- Result ----------
  const ordered = [...findings.filter((f) => f.kind === "refusal"), ...findings.filter((f) => f.kind === "blocker"), ...findings.filter((f) => f.kind === "info")];
  const exit = ordered.some((f) => f.kind === "refusal") ? 3 : ordered.some((f) => f.kind === "blocker") ? 20 : 0;
  const first = ordered.find((f) => f.kind !== "info");
  const next =
    first !== undefined
      ? first.next
      : existing !== null && relation === "same"
        ? `Nothing to push. PR #${existing.number} is open. Run pr-status ${existing.number}.`
        : existing !== null
          ? `Run open --expect-head ${headSha} to push the new commits to PR #${existing.number}.`
          : args.bodyFile === null
            ? `Write the body from the skeleton, check it with plan --body-file <file>, then run open --expect-head ${headSha} --body-file <file>.`
            : `Run open --expect-head ${headSha} --body-file ${args.bodyFile}`;

  return {
    kind: "plan",
    plan: {
      repo,
      user,
      defaultBranch,
      headBranch,
      headSha,
      base: { ref: baseRef, sha: baseSha, stackedOn: stackedOn === null ? null : { number: stackedOn.number, ref: stackedOn.ref } },
      policy,
      policySource,
      remote: args.remote,
      remoteHead,
      relation,
      commitCount: commits.length,
      existing,
      title,
      draft: policy.draft.create_as_draft || unsignedPushed.length > 0,
      labels: [...new Set(labels)],
      issue,
      link,
      requiredHeadings: requiredList,
      skeleton,
      finalBody: finalText,
      prepushRan,
      unsignedPushed,
      findings: ordered,
      exit,
      next,
    },
  };
}
