import { spawn, spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface BoundedCommandOptions {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly stdin?: string | Uint8Array;
  readonly env?: Record<string, string>;
  readonly timeoutMilliseconds?: number;
  readonly killGraceMilliseconds?: number;
  readonly maximumOutputBytes?: number;
  readonly inheritEnvironment?: boolean;
}

/**
 * Options for a repository lifecycle command. The child receives a minimal
 * environment; only validated GitHub authentication/configuration paths and
 * token variables are copied from the parent process. Command arguments remain
 * untouched for receipt/audit callers, while the executable itself is resolved
 * to a canonical path before spawn.
 */
export type TrustedCommandOptions = Omit<BoundedCommandOptions, "env" | "inheritEnvironment">;

const trustedPath = [
  "/usr/local/bin",
  "/usr/local/sbin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/opt/local/bin",
  "/opt/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(path.delimiter);
const trustedPathDirectories = trustedPath.split(path.delimiter);
const trustedGroupWriteRoots = ["/usr/local", "/opt/homebrew", "/opt/local"];
const authenticationEnvironmentKeys = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
] as const;
const executableNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const githubHost = "github.com";

function trustedEnvironment(pathValue: string): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: pathValue,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    LANG: "C.UTF-8",
  };
  for (const key of authenticationEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      if (value.length === 0 || value.length > 4_096 || /[\0\r\n]/.test(value))
        throw new Error(`trusted environment variable is invalid: ${key}`);
      environment[key] = value;
    }
  }
  const host = process.env.GH_HOST?.toLowerCase();
  if (host !== undefined && host !== githubHost)
    throw new Error("trusted environment variable is invalid: GH_HOST");
  environment.GH_HOST = githubHost;
  return environment;
}

function isWithin(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isTrustedHostPath(pathname: string): boolean {
  return trustedGroupWriteRoots.some(
    (root) => pathname === root || isWithin(pathname, root),
  );
}

function ownedAndPrivate(
  info: Awaited<ReturnType<typeof lstat>>,
  pathname: string,
  allowGroupWrite: boolean,
): boolean {
  if ((info.mode & (allowGroupWrite && isTrustedHostPath(pathname) ? 0o002 : 0o022)) !== 0)
    return false;
  if (typeof process.getuid !== "function") return true;
  return info.uid === process.getuid() || info.uid === 0;
}

function pathChain(absolute: string): string[] {
  const chain: string[] = [];
  let current = absolute;
  while (true) {
    chain.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

async function inspectCanonicalPath(
  absolute: string,
  workingDirectory: string,
  leaf: "directory" | "executable",
): Promise<string | undefined> {
  if (isWithin(absolute, workingDirectory)) return undefined;
  for (const [index, pathname] of pathChain(absolute).entries()) {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(pathname);
    } catch {
      return undefined;
    }
    if (
      info.isSymbolicLink() ||
      !ownedAndPrivate(info, pathname, index !== 0 || leaf === "directory") ||
      (index === 0
        ? leaf === "directory"
          ? !info.isDirectory()
          : !info.isFile()
        : !info.isDirectory())
    )
      return undefined;
    if (index === 0 && leaf === "executable" && (info.mode & 0o111) === 0) return undefined;
  }
  const canonical = await realpath(absolute).catch(() => undefined);
  return canonical === absolute && !isWithin(canonical, workingDirectory) ? canonical : undefined;
}

async function inspectPathChain(
  rawPath: string,
  workingDirectory: string,
  leaf: "directory" | "executable",
): Promise<string | undefined> {
  if (!path.isAbsolute(rawPath) || rawPath.includes("\0")) return undefined;
  const absolute = path.resolve(rawPath);
  if (isWithin(absolute, workingDirectory)) return undefined;
  const chain = pathChain(absolute);
  for (const [index, pathname] of chain.entries()) {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(pathname);
    } catch {
      return undefined;
    }
    const isLeaf = index === 0;
    if (!isLeaf || leaf === "directory") {
      if (
        info.isSymbolicLink() ||
        !ownedAndPrivate(info, pathname, !isLeaf || leaf === "directory") ||
        (isLeaf ? !info.isDirectory() : !info.isDirectory())
      )
        return undefined;
      continue;
    }
    if (info.isSymbolicLink()) {
      if (typeof process.getuid === "function" && info.uid !== process.getuid() && info.uid !== 0)
        return undefined;
      continue;
    }
    if (!info.isFile() || !ownedAndPrivate(info, pathname, false)) return undefined;
    if ((info.mode & 0o111) === 0) return undefined;
  }
  const canonical = await realpath(absolute).catch(() => undefined);
  if (!canonical || isWithin(canonical, workingDirectory)) return undefined;
  return inspectCanonicalPath(canonical, workingDirectory, leaf);
}

export async function resolveTrustedExecutable(
  name: string,
  workingDirectory: string,
): Promise<{ readonly executable: string; readonly path: string }> {
  if (process.platform === "win32")
    throw new Error("trusted lifecycle executable resolution is unsupported on Windows");
  // Never inherit PATH: search only standard system, Homebrew, and MacPorts
  // dirs, with every raw candidate and parent checked before use.
  if (!executableNamePattern.test(name) || (name !== "git" && name !== "gh"))
    throw new Error("trusted executable name is invalid");
  const rawDirectories = trustedPathDirectories;
  const safeDirectories: string[] = [];
  let executable: string | undefined;
  for (const rawDirectory of rawDirectories) {
    const directory = await inspectPathChain(rawDirectory, workingDirectory, "directory");
    if (!directory || safeDirectories.includes(directory)) continue;
    safeDirectories.push(directory);
    executable ??= await inspectPathChain(path.join(directory, name), workingDirectory, "executable");
  }
  if (executable) return { executable, path: safeDirectories.join(path.delimiter) };
  throw new Error(`trusted ${name} executable is unavailable in safe PATH`);
}

async function canonicalDirectory(
  raw: string,
  label: string,
  workingDirectory: string,
): Promise<string> {
  if (!path.isAbsolute(raw) || raw.includes("\0")) throw new Error(`${label} must be an absolute path`);
  const absolute = path.resolve(raw);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  const canonical = await realpath(absolute);
  if (canonical !== absolute) throw new Error(`${label} must be canonical`);
  if (isWithin(canonical, workingDirectory)) throw new Error(`${label} may not be inside the target checkout`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid())
    throw new Error(`${label} has the wrong owner`);
  return canonical;
}

async function trustedEnvironmentFor(
  workingDirectory: string,
  pathValue: string,
): Promise<Record<string, string>> {
  const environment = trustedEnvironment(pathValue);
  const configuredHome = process.env.HOME ?? homedir();
  environment.HOME = await canonicalDirectory(configuredHome, "HOME", workingDirectory);
  for (const key of ["XDG_CONFIG_HOME", "GH_CONFIG_DIR"] as const) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = await canonicalDirectory(value, key, workingDirectory);
  }
  return environment;
}

async function canonicalWorkingDirectory(input: string): Promise<string> {
  if (!path.isAbsolute(input) || input.includes("\0")) throw new Error("command cwd must be absolute");
  const absolute = path.resolve(input);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("command cwd must be a real directory");
  const canonical = await realpath(absolute);
  if (canonical !== absolute) throw new Error("command cwd must be canonical");
  return canonical;
}

/**
 * Run one of the lifecycle Git/GitHub CLI commands through a canonical
 * executable and a fail-closed environment. This is the default boundary for
 * lifecycle code; callers that need a custom runner can continue to inject one.
 */
export async function runTrustedCommand(options: TrustedCommandOptions): Promise<BoundedCommandResult> {
  if (options.command.length === 0) throw new Error("trusted command is empty");
  const workingDirectory = await canonicalWorkingDirectory(options.cwd);
  const resolved = await resolveTrustedExecutable(options.command[0]!, workingDirectory);
  return runBoundedCommand({
    ...options,
    command: [resolved.executable, ...options.command.slice(1)],
    cwd: workingDirectory,
    env: await trustedEnvironmentFor(workingDirectory, resolved.path),
    inheritEnvironment: false,
  });
}

export interface BoundedCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly saturated: boolean;
}

export async function runBoundedCommand({
  command,
  cwd,
  stdin,
  env,
  timeoutMilliseconds = 30_000,
  killGraceMilliseconds = 5_000,
  maximumOutputBytes = 10_000_000,
  inheritEnvironment = true,
}: BoundedCommandOptions): Promise<BoundedCommandResult> {
  if (
    command.length === 0 ||
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    !Number.isSafeInteger(killGraceMilliseconds) ||
    killGraceMilliseconds < 1 ||
    !Number.isSafeInteger(maximumOutputBytes) ||
    maximumOutputBytes < 1 ||
    typeof inheritEnvironment !== "boolean"
  )
    throw new Error("bounded command options are invalid");

  const child = spawn(command[0]!, [...command.slice(1)], {
    cwd,
    env: inheritEnvironment ? (env ? { ...process.env, ...env } : process.env) : env,
    detached: process.platform !== "win32",
    stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (stdin !== undefined) child.stdin!.end(stdin);
  let timedOut = false;
  let saturated = false;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let forcePromise: Promise<void> | undefined;
  const ownedProcesses = new Map<number, string>();
  const processTable = (): Array<{
    pid: number;
    parent: number;
    group: number;
    state: string;
    started: string;
  }> => {
    if (process.platform === "win32") return [];
    const processes = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], {
      encoding: "utf8",
      timeout: 1_000,
    });
    if (processes.status !== 0 || processes.error) return [];
    return processes.stdout.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
      if (!match) return [];
      return [
        {
          pid: Number(match[1]),
          parent: Number(match[2]),
          group: Number(match[3]),
          state: match[4]!,
          started: match[5]!,
        },
      ];
    });
  };
  const captureTree = (rows = processTable()): void => {
    if (!child.pid) return;
    const selected = new Set<number>([child.pid]);
    for (let pass = 0; pass < rows.length; pass += 1) {
      let changed = false;
      for (const row of rows) {
        if (row.pid === process.pid || selected.has(row.pid)) continue;
        if (row.group === child.pid || selected.has(row.parent)) {
          selected.add(row.pid);
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const row of rows) if (selected.has(row.pid)) ownedProcesses.set(row.pid, row.started);
  };
  const stillOwned = (pid: number, started: string): boolean => {
    const row = processTable().find((candidate) => candidate.pid === pid);
    return row?.started === started && !row.state.startsWith("Z");
  };
  const signalTree = (signal: NodeJS.Signals): void => {
    if (!child.pid) return;
    const rows = processTable();
    captureTree(rows);
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    const childRow = rows.find((row) => row.pid === child.pid);
    if (childRow?.group === child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (groupError) {
        const code = (groupError as NodeJS.ErrnoException).code;
        if (code !== "ESRCH" && code !== "EPERM" && stillOwned(child.pid, childRow.started)) throw groupError;
      }
    }
    for (const [pid, started] of [...ownedProcesses].sort(([left], [right]) => right - left)) {
      if (!stillOwned(pid, started)) continue;
      try {
        process.kill(pid, signal);
      } catch (memberError) {
        if ((memberError as NodeJS.ErrnoException).code !== "ESRCH" && stillOwned(pid, started))
          throw memberError;
      }
    }
  };
  const stop = (): void => {
    signalTree("SIGTERM");
    forcePromise ??= new Promise((resolve) => setTimeout(resolve, killGraceMilliseconds)).then(async () => {
      signalTree("SIGKILL");
      if (process.platform === "win32" || !child.pid) return;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if ([...ownedProcesses].every(([pid, started]) => !stillOwned(pid, started))) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("command process group survived SIGKILL");
    });
  };
  const collect =
    (target: Buffer[], stream: "stdout" | "stderr") =>
    (chunk: Buffer): void => {
      const next = (stream === "stdout" ? stdoutBytes : stderrBytes) + chunk.byteLength;
      if (next > maximumOutputBytes) {
        saturated = true;
        child.stdout?.destroy();
        child.stderr?.destroy();
        stop();
        return;
      }
      if (stream === "stdout") stdoutBytes = next;
      else stderrBytes = next;
      target.push(chunk);
    };
  child.stdout!.on("data", collect(stdout, "stdout"));
  child.stderr!.on("data", collect(stderr, "stderr"));
  const timeout = setTimeout(() => {
    timedOut = true;
    child.stdout?.destroy();
    child.stderr?.destroy();
    stop();
  }, timeoutMilliseconds);
  let code: number;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (value, signal) => resolve(value ?? (signal ? 128 : 1)));
    });
  } finally {
    clearTimeout(timeout);
    if (forcePromise) await forcePromise;
  }
  return {
    code: timedOut ? 124 : saturated ? 125 : code,
    stdout: Buffer.concat(stdout).toString(),
    stderr: timedOut
      ? "command timed out"
      : saturated
        ? "command output exceeded limit"
        : Buffer.concat(stderr).toString(),
    timedOut,
    saturated,
  };
}
