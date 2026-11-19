// The GitHub reads and writes of pr-create. Reads use `gh` through the guarded
// runner. Every reply goes through the typed readers.

import { type GhRun, isNotFound, rest } from "../github/graphql.ts";
import { arr, bool, isObj, member, num, obj, parseJson, path, ReadError, str, strOrNull } from "../github/read.ts";
import { parseRepoSlug, parseSha, type RepoSlug, type Sha } from "../types.ts";
import { parseIssueBoxes } from "./body.ts";
import type { IssueFacts, OpenPr } from "./types.ts";

/** A read or a step failed. The command refuses and writes nothing. */
export class StepError extends Error {
  override readonly name = "StepError";
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function sha(value: unknown, where: string): Sha {
  const parsed = parseSha(str(value, where));
  if (!parsed.ok) {
    throw new ReadError(`${where}: ${parsed.error}`);
  }
  return parsed.value;
}

export async function readRepo(
  run: GhRun,
  explicit: string | null,
): Promise<{ readonly repo: RepoSlug; readonly defaultBranch: string }> {
  const result = await run(["repo", "view", ...(explicit === null ? [] : [explicit]), "--json", "nameWithOwner,defaultBranchRef"]);
  if (result.code !== 0) {
    throw new StepError(`cannot read the repository (pass --repo owner/name): ${firstLine(result.stderr)}`);
  }
  const data = obj(parseJson(result.stdout, "repo view"), "repo view");
  const slug = parseRepoSlug(str(member(data, "nameWithOwner"), "nameWithOwner"));
  if (!slug.ok) {
    throw new StepError(slug.error);
  }
  return { repo: slug.value, defaultBranch: str(path(data, "defaultBranchRef", "name"), "defaultBranchRef.name") };
}

export async function readUser(run: GhRun): Promise<string> {
  const result = await run(["api", "-X", "GET", "user"]);
  if (result.code !== 0) {
    throw new StepError(`cannot read the gh user (run gh auth status): ${firstLine(result.stderr)}`);
  }
  return str(member(obj(parseJson(result.stdout, "user"), "user"), "login"), "user.login");
}

function encodeRef(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
}

/** The current commit of a branch on GitHub. */
export async function readBranchSha(run: GhRun, repo: RepoSlug, branch: string): Promise<Sha> {
  const result = await rest(run, `repos/${repo}/git/ref/heads/${encodeRef(branch)}`);
  if (result.code !== 0) {
    throw new StepError(
      isNotFound(result) ? `the branch ${branch} does not exist in ${repo}` : `cannot read the branch ${branch}: ${firstLine(result.stderr)}`,
    );
  }
  return sha(path(parseJson(result.stdout, "ref"), "object", "sha"), "ref.object.sha");
}

const PR_FIELDS = "number,id,url,title,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,author";

function parsePr(value: unknown): OpenPr {
  const o = obj(value, "pull request");
  const author = member(o, "author");
  return {
    number: num(member(o, "number"), "number"),
    id: str(member(o, "id"), "id"),
    url: str(member(o, "url"), "url"),
    title: str(member(o, "title"), "title"),
    headRef: str(member(o, "headRefName"), "headRefName"),
    headSha: sha(member(o, "headRefOid"), "headRefOid"),
    baseRef: str(member(o, "baseRefName"), "baseRefName"),
    isDraft: bool(member(o, "isDraft"), "isDraft"),
    isCrossRepository: bool(member(o, "isCrossRepository"), "isCrossRepository"),
    author: isObj(author) ? (strOrNull(member(author, "login"), "author.login") ?? "ghost") : "ghost",
  };
}

/** The open PRs of the repository, or only those with this head branch. */
export async function listOpenPrs(run: GhRun, repo: RepoSlug, head: string | null): Promise<readonly OpenPr[]> {
  const result = await run([
    "pr", "list", "--repo", repo, "--state", "open", "--limit", "200", "--json", PR_FIELDS, ...(head === null ? [] : ["--head", head]),
  ]);
  if (result.code !== 0) {
    throw new StepError(`cannot list the open pull requests: ${firstLine(result.stderr)}`);
  }
  return arr(parseJson(result.stdout, "pr list"), "pr list").map(parsePr);
}

/**
 * Read an issue. A failed or odd reply is not an error: the issue is then
 * unreadable, and the link rule falls back to Part of.
 */
export async function readIssue(run: GhRun, repo: RepoSlug, number: number, heading: string): Promise<IssueFacts> {
  const unreadable = (problem: string): IssueFacts => ({
    number, state: "UNKNOWN", title: "", url: "", unchecked: [], hasDoneWhen: false, readable: false, problem,
  });
  const result = await run(["issue", "view", String(number), "--repo", repo, "--json", "number,state,title,url,body"]);
  if (result.code !== 0) {
    return unreadable(`cannot read issue #${number}: ${firstLine(result.stderr)}`);
  }
  try {
    const o = obj(parseJson(result.stdout, "issue view"), "issue view");
    const boxes = parseIssueBoxes(str(member(o, "body"), "issue.body"), heading);
    return {
      number: num(member(o, "number"), "issue.number"),
      state: str(member(o, "state"), "issue.state"),
      title: str(member(o, "title"), "issue.title"),
      url: str(member(o, "url"), "issue.url"),
      unchecked: boxes.unchecked,
      hasDoneWhen: boxes.present,
      readable: true,
      problem: null,
    };
  } catch (error) {
    if (error instanceof ReadError) {
      return unreadable(`issue #${number} has an unexpected shape: ${error.message}`);
    }
    throw error;
  }
}

export type TemplateRead =
  | { readonly kind: "found"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly message: string };

/** The body template on the default branch, at `defaultSha` (its current commit). */
export async function readTemplate(run: GhRun, repo: RepoSlug, defaultSha: Sha, file: string): Promise<TemplateRead> {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const result = await rest(run, `repos/${repo}/contents/${encoded}?ref=${defaultSha}`, true);
  if (result.code === 0) {
    return { kind: "found", text: result.stdout };
  }
  return isNotFound(result) ? { kind: "absent" } : { kind: "error", message: firstLine(result.stderr) };
}
