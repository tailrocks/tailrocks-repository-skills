// Text helpers for bodies: Done-when checklists, linked-issue references,
// body-template sections, and sign-off trailers. All are pure.

/** Remove fenced code blocks and HTML comments, which never count as content. */
export function stripNoise(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "");
}

export interface DoneWhen {
  readonly checked: number;
  readonly unchecked: readonly string[];
}

const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

function headingText(line: string): string | null {
  const match = HEADING_LINE.exec(line);
  if (match !== null) {
    return (match[1] ?? "").replace(/[*_`:]/g, "").trim();
  }
  const bold = /^\s*\*\*(.+?)\*\*:?\s*$/.exec(line);
  return bold === null ? null : (bold[1] ?? "").replace(/:/g, "").trim();
}

/** The lines of one section: from its heading to the next heading. Null when absent. */
export function sectionLines(body: string, heading: string): readonly string[] | null {
  const lines = stripNoise(body).split("\n");
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex((line) => headingText(line)?.toLowerCase() === wanted);
  if (start < 0) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING_LINE.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Count the Done-when boxes. Null when the body has no such section. */
export function parseDoneWhen(body: string, heading: string): DoneWhen | null {
  const lines = sectionLines(body, heading);
  if (lines === null) {
    return null;
  }
  const unchecked: string[] = [];
  let checked = 0;
  for (const line of lines) {
    const open = /^\s*[-*+]\s+\[ \]\s+(.*)$/.exec(line);
    if (open !== null) {
      unchecked.push((open[1] ?? "").trim());
    } else if (/^\s*[-*+]\s+\[[xX]\]/.test(line)) {
      checked += 1;
    }
  }
  return { checked, unchecked };
}

const ISSUE_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part\s+of|refs?|references?)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*,\s*(?:[\w.-]+\/[\w.-]+)?#\d+)*)/gi;

/** Issue numbers named by `Closes #n`, `Part of #n`, `Refs #n`, and the like. Same repository only. */
export function linkedIssueNumbers(body: string, repo: string, self: number): readonly number[] {
  const found = new Set<number>();
  for (const match of stripNoise(body).matchAll(ISSUE_KEYWORD)) {
    for (const ref of (match[1] ?? "").split(",")) {
      const parsed = /^\s*(?:([\w.-]+\/[\w.-]+))?#(\d+)\s*$/.exec(ref);
      if (parsed === null) {
        continue;
      }
      const where = parsed[1];
      const number = Number(parsed[2]);
      if ((where === undefined || where.toLowerCase() === repo.toLowerCase()) && number !== self) {
        found.add(number);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

export function templateHeadings(template: string): readonly string[] {
  return stripNoise(template)
    .split("\n")
    .map((line) => (HEADING_LINE.test(line) ? headingText(line) : null))
    .filter((h): h is string => h !== null && h !== "");
}

/** Sections of `required` that the body misses or leaves empty. */
export function bodyProblems(body: string, required: readonly string[]): readonly string[] {
  const problems: string[] = [];
  for (const heading of required) {
    const lines = sectionLines(body, heading);
    if (lines === null) {
      problems.push(`missing section "${heading}"`);
      continue;
    }
    const text = lines.join("\n").replace(/\s+/g, " ").trim();
    if (text === "" || /^(?:todo|tbd|n\/a|\.\.\.)$/i.test(text)) {
      problems.push(`empty section "${heading}"`);
    }
  }
  return problems;
}

const SIGNED_OFF = /^signed-off-by:\s*\S.*$/im;

export function hasSignoff(message: string): boolean {
  return SIGNED_OFF.test(message);
}

/** The message without `Signed-off-by:` lines and trailing blank space. */
export function withoutSignoffs(message: string): string {
  return message
    .split("\n")
    .filter((line) => !/^signed-off-by:/i.test(line.trim()))
    .join("\n")
    .trimEnd();
}

/** Normalize a login for comparison: drop `app/`, drop `[bot]`, lower case. */
export function normalizeLogin(login: string): string {
  return login.replace(/^app\//i, "").replace(/\[bot\]$/i, "").toLowerCase();
}

export function sameLogin(a: string, b: string): boolean {
  return normalizeLogin(a) === normalizeLogin(b);
}
