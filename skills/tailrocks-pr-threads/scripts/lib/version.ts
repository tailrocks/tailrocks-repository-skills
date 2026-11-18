// Runtime version guard. The pinned toolchain is Bun 1.4 (package.json, mise.toml).

export const MINIMUM_BUN = { major: 1, minor: 4 } as const;

export type VersionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export function checkBunVersion(version: string): VersionCheck {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  const wanted = `${MINIMUM_BUN.major}.${MINIMUM_BUN.minor}`;
  if (match === null || Number.isNaN(major) || Number.isNaN(minor)) {
    return { ok: false, message: `Cannot read the Bun version "${version}". Install Bun ${wanted} or newer.` };
  }
  if (major < MINIMUM_BUN.major || (major === MINIMUM_BUN.major && minor < MINIMUM_BUN.minor)) {
    return {
      ok: false,
      message: `Bun ${version} is too old. These scripts need Bun ${wanted} or newer. Upgrade Bun and run the script again.`,
    };
  }
  return { ok: true };
}

/** Throw a clear error when Bun is older than the pinned minimum. */
export function assertBun(version: string = Bun.version): void {
  const result = checkBunVersion(version);
  if (!result.ok) {
    throw new Error(result.message);
  }
}
