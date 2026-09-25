import { lstat, realpath } from "node:fs/promises";

import { resolveTrustedExecutable } from "./bounded-command";

/**
 * Resolve a lifecycle executable without consulting inherited PATH. The
 * working directory is used as the checkout boundary, so a package-local or
 * repository-local executable cannot become trusted by placement alone.
 */
export async function resolveExecutable(
  name: string,
  workingDirectory = process.cwd(),
): Promise<string> {
  const canonicalWorkingDirectory = await realpath(workingDirectory).catch(() => undefined);
  if (!canonicalWorkingDirectory) throw new Error("working directory is unavailable");
  const info = await lstat(canonicalWorkingDirectory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("working directory must be a real directory");
  return (await resolveTrustedExecutable(name, canonicalWorkingDirectory)).executable;
}
