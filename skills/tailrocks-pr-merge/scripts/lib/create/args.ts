// Command-line arguments of create.ts.

import { checkGit } from "../safety.ts";
import { parseRepoSlug } from "../types.ts";
import type { CreateArgs } from "./types.ts";

export const USAGE =
  "usage: create.ts plan|open [--repo owner/name] [--base branch] [--branch name] [--issue N] [--title text] [--body-file file] [--expect-head sha] [--part-of] [--run-ci] [--label name] [--allow-unsigned-pushed] [--remote name] [--json]";

export type ArgsResult = { readonly ok: true; readonly args: CreateArgs } | { readonly ok: false; readonly message: string };

const PROBE = "a".repeat(40);

/** A branch name that the guarded push accepts. The check uses the real guard, so the two never differ. */
export function isPushableBranch(name: string): boolean {
  return checkGit(["push", "origin", `${PROBE}:refs/heads/${name}`]).allowed;
}

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--repo",
  "--base",
  "--branch",
  "--issue",
  "--title",
  "--body-file",
  "--expect-head",
  "--label",
  "--remote",
]);

export function parseArgs(argv: readonly string[]): ArgsResult {
  let mode: CreateArgs["mode"] | null = null;
  const values = new Map<string, string>();
  const labels: string[] = [];
  let partOf = false;
  let runCi = false;
  let allowUnsignedPushed = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "plan" || arg === "open") {
      if (mode !== null) {
        return { ok: false, message: "give one mode: plan or open" };
      }
      mode = arg;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--part-of") {
      partOf = true;
    } else if (arg === "--run-ci") {
      runCi = true;
    } else if (arg === "--allow-unsigned-pushed") {
      allowUnsignedPushed = true;
    } else if (VALUE_FLAGS.has(arg)) {
      i += 1;
      const value = argv[i];
      if (value === undefined || (value.startsWith("--") && arg !== "--title")) {
        return { ok: false, message: `${arg} needs a value` };
      }
      if (arg === "--label") {
        labels.push(value);
      } else if (values.has(arg)) {
        return { ok: false, message: `${arg} is given twice` };
      } else {
        values.set(arg, value);
      }
    } else {
      return { ok: false, message: `unknown argument ${arg}` };
    }
  }
  if (mode === null) {
    return { ok: false, message: "give a mode: plan or open" };
  }
  const issueText = values.get("--issue") ?? null;
  if (issueText !== null && !/^#?[1-9][0-9]{0,8}$/.test(issueText)) {
    return { ok: false, message: "--issue needs an issue number" };
  }
  const expectHead = values.get("--expect-head") ?? null;
  if (expectHead !== null && !/^[0-9a-f]{40}$/.test(expectHead)) {
    return { ok: false, message: "--expect-head needs the full 40-character head commit id that plan printed" };
  }
  if (mode === "open" && expectHead === null) {
    return { ok: false, message: "open needs --expect-head <sha>; run plan first and copy the head it prints" };
  }
  if (mode === "plan" && expectHead !== null) {
    return { ok: false, message: "plan takes no --expect-head" };
  }
  for (const flag of ["--branch", "--base"] as const) {
    const value = values.get(flag);
    if (value !== undefined && !isPushableBranch(value)) {
      return { ok: false, message: `${flag} needs a plain branch name` };
    }
  }
  const repo = values.get("--repo") ?? null;
  if (repo !== null && !parseRepoSlug(repo).ok) {
    return { ok: false, message: "--repo needs owner/name" };
  }
  const remote = values.get("--remote") ?? "origin";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) {
    return { ok: false, message: "--remote needs a plain remote name" };
  }
  for (const label of labels) {
    if (label.length === 0 || label.length > 100 || /[,\0\n\r]/.test(label)) {
      return { ok: false, message: "--label needs one label name without commas" };
    }
  }
  return {
    ok: true,
    args: {
      mode,
      repo,
      base: values.get("--base") ?? null,
      branch: values.get("--branch") ?? null,
      issue: issueText === null ? null : Number(issueText.replace("#", "")),
      title: values.get("--title") ?? null,
      bodyFile: values.get("--body-file") ?? null,
      expectHead,
      partOf,
      runCi,
      labels,
      allowUnsignedPushed,
      remote,
      json,
    },
  };
}
