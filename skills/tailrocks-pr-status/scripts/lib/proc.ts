// Process layer: argv-only spawning and credential scrubbing.
// No shell string ever reaches this module. Callers pass argv arrays.

export interface RunOptions {
  readonly cwd: string;
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g;
const AUTH_HEADER = /\b(authorization:\s*(?:bearer|token|basic)\s+)\S+/gi;

/** Remove credentials from text that may reach logs or error messages. */
export function scrub(text: string): string {
  return text
    .replace(URL_CREDENTIALS, "$1***@")
    .replace(GITHUB_TOKEN, "***")
    .replace(AUTH_HEADER, "$1***");
}

/** Run argv without a shell. Output is scrubbed before it is returned. */
export async function run(argv: readonly string[], options: RunOptions): Promise<RunResult> {
  if (argv.length === 0) {
    return { code: 127, stdout: "", stderr: "empty argv" };
  }
  try {
    const proc = Bun.spawn({
      cmd: [...argv],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout: scrub(stdout), stderr: scrub(stderr) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 127, stdout: "", stderr: scrub(`failed to start ${argv[0] ?? ""}: ${reason}`) };
  }
}
