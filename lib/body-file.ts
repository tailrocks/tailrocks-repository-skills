// Temp-file helper for pull-request bodies.
//
// The gh guard accepts `--body-file` only for a path made here. A caller can
// not point gh at a credential file or any other local file, because the guard
// checks that the path lies in the one private directory that this module owns.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BODY_BYTES = 262_144;
const FILE_NAME = /^body-[0-9]{1,6}\.md$/;

let directory: string | null = null;
let counter = 0;

/** Write the text to a new file in the private directory. Returns its absolute path. */
export function writeBodyFile(text: string): string {
  if (text.length === 0 || text.includes("\0") || Buffer.byteLength(text) > MAX_BODY_BYTES) {
    throw new RangeError("a body must be non-empty text without NUL, at most 256 KiB");
  }
  // mkdtemp creates the directory with mode 0700.
  directory ??= mkdtempSync(join(tmpdir(), "pr-skills-body-"));
  counter += 1;
  const path = join(directory, `body-${counter}.md`);
  writeFileSync(path, text, { mode: 0o600, flag: "wx" });
  return path;
}

/** True when the path is a file name that `writeBodyFile` made in this process. */
export function isBodyFilePath(path: string): boolean {
  if (directory === null || !path.startsWith(`${directory}/`)) {
    return false;
  }
  const name = path.slice(directory.length + 1);
  return FILE_NAME.test(name);
}

/** Delete the private directory by its exact path. */
export function removeBodyFiles(): void {
  if (directory !== null) {
    rmSync(directory, { recursive: true, force: true });
    directory = null;
  }
}
