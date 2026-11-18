// High-risk paths. The policy schema has no key for them, so the list is a
// built-in default. A PR that touches one needs `--accept-risk` from the user.

import { matchesAnyGlob } from "../glob.ts";
import type { ChangedFiles } from "./github.ts";

export const HIGH_RISK_GLOBS: readonly string[] = [
  ".github/**",
  "**/release/**",
  "**/releases/**",
  "**/auth/**",
  "**/authn/**",
  "**/authz/**",
  "**/authentication/**",
  "**/authorization/**",
  "**/migration/**",
  "**/migrations/**",
  "**/migrate/**",
];

export type Risk =
  | { readonly level: "none" }
  | { readonly level: "high"; readonly reason: string; readonly paths: readonly string[] };

export function classifyRisk(files: ChangedFiles): Risk {
  if (!files.known) {
    return { level: "high", reason: `the changed files are unknown (${files.reason})`, paths: [] };
  }
  const paths = files.files.filter((file) => matchesAnyGlob(HIGH_RISK_GLOBS, file));
  return paths.length === 0
    ? { level: "none" }
    : { level: "high", reason: `${paths.length} changed file${paths.length === 1 ? "" : "s"} in high-risk paths`, paths };
}
