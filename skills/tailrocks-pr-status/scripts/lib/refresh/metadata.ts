// `refresh metadata`: show the facts that decide the title and body, and write
// a new title or body after a drift check. It needs no checkout and never pushes.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { SafetyError } from "../guard.ts";
import { isNotFound, rest, type GhRun } from "../github/graphql.ts";
import { arr, isObj, member, num, parseJson, ReadError, str } from "../github/read.ts";
import { removeBodyFiles, writeBodyFile } from "../body-file.ts";
import type { PrSnapshot } from "../status/types.ts";
import { bodyProblems } from "../status/text.ts";
import { readSnapshot, type PrContext, type RefreshDeps } from "./context.ts";
import { blocked, done, type JsonValue, type Outcome } from "./outcome.ts";

const MAX_FILE_PAGES = 30;
const PAGE_SIZE = 100;
const MAX_LISTED = 200;

interface FileStat {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
}

/** A short id of the title, body, head, and base. `write` compares it to detect drift. */
export function stateId(snapshot: PrSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify([snapshot.title, snapshot.body, snapshot.headSha, snapshot.baseSha]))
    .digest("hex")
    .slice(0, 16);
}

async function readFiles(run: GhRun, ctx: PrContext): Promise<{ readonly files: readonly FileStat[]; readonly truncated: boolean }> {
  const files: FileStat[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const result = await rest(run, `repos/${ctx.repo}/pulls/${ctx.number}/files?per_page=${PAGE_SIZE}&page=${page}`);
    if (result.code !== 0) {
      throw new ReadError(`cannot read the changed files: ${result.stderr.trim().split("\n")[0] ?? ""}`);
    }
    const nodes = arr(parseJson(result.stdout, "pull request files"), "files");
    for (const node of nodes) {
      if (!isObj(node)) {
        throw new ReadError("a changed file is not an object");
      }
      files.push({
        path: str(member(node, "filename"), "filename"),
        status: str(member(node, "status"), "status"),
        additions: num(member(node, "additions"), "additions"),
        deletions: num(member(node, "deletions"), "deletions"),
      });
    }
    if (nodes.length < PAGE_SIZE) {
      return { files, truncated: false };
    }
  }
  return { files, truncated: true };
}

async function readTemplate(run: GhRun, ctx: PrContext): Promise<string | null> {
  const encoded = ctx.policy.pr_body.template.split("/").map(encodeURIComponent).join("/");
  const result = await rest(run, `repos/${ctx.repo}/contents/${encoded}?ref=${ctx.snapshot.headSha}`, true);
  return result.code === 0 && !isNotFound(result) ? result.stdout : null;
}

export async function metadataShow(deps: RefreshDeps, ctx: PrContext): Promise<Outcome> {
  try {
    const [{ files, truncated }, template] = await Promise.all([readFiles(deps.runGh, ctx), readTemplate(deps.runGh, ctx)]);
    const { snapshot } = ctx;
    const id = stateId(snapshot);
    const added = files.reduce((n, f) => n + f.additions, 0);
    const removed = files.reduce((n, f) => n + f.deletions, 0);
    const problems = bodyProblems(snapshot.body, ctx.policy.pr_body.sections);
    const details = [
      `head ${snapshot.headSha}  base ${snapshot.baseSha} (${snapshot.baseRef})  state-id ${id}`,
      `title: ${snapshot.title}`,
      "--- body ---",
      ...snapshot.body.split("\n"),
      "--- diff stat ---",
      `${files.length}${truncated ? "+" : ""} files, +${added} -${removed}`,
      ...files.slice(0, MAX_LISTED).map((f) => `${f.status} ${f.path} (+${f.additions} -${f.deletions})`),
      ...(files.length > MAX_LISTED ? [`... ${files.length - MAX_LISTED} more files`] : []),
      "--- template ---",
      ...(template === null ? [`(no template at ${ctx.policy.pr_body.template} on the head)`] : template.split("\n")),
      "--- section check (policy pr_body.sections) ---",
      ...(problems.length === 0 ? ["every required section is present"] : problems),
    ];
    const data: Record<string, JsonValue> = {
      headSha: snapshot.headSha,
      baseSha: snapshot.baseSha,
      stateId: id,
      title: snapshot.title,
      body: snapshot.body,
      template,
      filesTruncated: truncated,
      files: files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions })),
      sectionProblems: problems,
    };
    return done("read the title, body, diff stat, and template", details, data, "reconcile the text, then run metadata write");
  } catch (error) {
    return blocked("unknown_state", error instanceof Error ? error.message : "cannot read the PR", "run the mode again");
  }
}

export interface MetadataWrite {
  readonly title: string | null;
  readonly bodyFile: string | null;
  readonly expectHead: string;
  readonly expectState: string | null;
}

const MAX_BODY_FILE_BYTES = 262_144;

/** Read the body file. Only a plain file of reasonable size is read, never a link. */
function readBodyText(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > MAX_BODY_FILE_BYTES || stat.size === 0) {
    throw new RangeError("the body file must be a plain, non-empty file of at most 256 KiB (no link)");
  }
  return readFileSync(path, "utf8");
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

/** Write the title and body after a drift check, then read both back. */
export async function metadataWrite(deps: RefreshDeps, ctx: PrContext, request: MetadataWrite): Promise<Outcome> {
  try {
    return await write(deps, ctx, request);
  } catch (error) {
    if (error instanceof SafetyError || error instanceof RangeError) {
      return blocked("invalid_text", error.message, "fix the title or body text, then run metadata write again");
    }
    return blocked("failed", error instanceof Error ? error.message : "failed", "run metadata show, then try again");
  } finally {
    removeBodyFiles();
  }
}

async function write(deps: RefreshDeps, ctx: PrContext, request: MetadataWrite): Promise<Outcome> {
  const live = await readSnapshot(deps, ctx.repo, ctx.number, false);
  if (!live.ok) {
    return live.outcome;
  }
  const { snapshot } = live;
  if (snapshot.state !== "OPEN") {
    return blocked("pr_not_open", `the PR is ${snapshot.state.toLowerCase()}`, "none; report the state");
  }
  if (snapshot.headSha !== request.expectHead) {
    return blocked(
      "drift",
      `the head changed from ${request.expectHead.slice(0, 7)} to ${snapshot.headSha.slice(0, 7)} since metadata show; nothing was written`,
      "run metadata show again and reconcile against the new diff",
    );
  }
  if (request.expectState !== null && request.expectState !== stateId(snapshot)) {
    return blocked(
      "drift",
      "the title, body, or base changed since metadata show; nothing was written",
      "run metadata show again and reconcile against the live text",
    );
  }
  const bodyText = request.bodyFile === null ? null : readBodyText(request.bodyFile);
  const titleChanged = request.title !== null && request.title !== snapshot.title;
  const bodyChanged = bodyText !== null && normalize(bodyText) !== normalize(snapshot.body);
  if (!titleChanged && !bodyChanged) {
    return done("the title and body already match; no edit was issued", [], { written: false, head: snapshot.headSha });
  }
  const args = ["pr", "edit", String(ctx.number), "--repo", ctx.repo];
  if (titleChanged && request.title !== null) {
    args.push("--title", request.title);
  }
  if (bodyChanged && bodyText !== null) {
    args.push("--body-file", writeBodyFile(bodyText));
  }
  const edited = await deps.runGh(args);
  if (edited.code !== 0) {
    return blocked(
      "uncertain_outcome",
      `gh pr edit failed: ${edited.stderr.trim().split("\n")[0] ?? ""}; the edit may or may not have landed`,
      "run metadata show to read the live text before you retry",
    );
  }
  const after = await readSnapshot(deps, ctx.repo, ctx.number, false);
  if (!after.ok) {
    return blocked("uncertain_outcome", "the edit was sent, but the PR could not be read back", "run metadata show to read the live text");
  }
  const titleOk = !titleChanged || after.snapshot.title === request.title;
  const bodyOk = !bodyChanged || (bodyText !== null && normalize(after.snapshot.body) === normalize(bodyText));
  if (!titleOk || !bodyOk) {
    return blocked(
      "uncertain_outcome",
      "the live title or body does not match what was written",
      "run metadata show to read the live text; do not repeat the edit before you compare",
    );
  }
  const changes = [titleChanged ? "title" : null, bodyChanged ? "body" : null].filter((c): c is string => c !== null);
  return done(`updated the ${changes.join(" and ")}`, [`head ${after.snapshot.headSha.slice(0, 7)} unchanged`], {
    written: true,
    changed: changes,
    head: after.snapshot.headSha,
  });
}
