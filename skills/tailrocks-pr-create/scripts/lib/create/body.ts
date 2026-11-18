// The PR body: the skeleton, the checks, and the issue link rule. Every
// function here is pure.

import type { Policy } from "../policy/types.ts";
import { bodyProblems, sectionLines, stripNoise, templateHeadings } from "../status/text.ts";
import type { LinkDecision } from "./types.ts";

const MAX_BODY_CHARS = 65_000;

// ---------- Comments and placeholders ----------

/** Remove HTML comments (authoring instructions) outside fenced code blocks. */
export function stripAuthoringComments(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/);
  return parts.map((part, index) => (index % 2 === 1 ? part : part.replace(/<!--[\s\S]*?-->/g, ""))).join("");
}

const PLACEHOLDER = /<[^<>\n`]{1,80}>/g;
const HTML_TAG = /^<\/?(?:a|b|br|code|details|div|em|h[1-6]|hr|i|img|kbd|li|ol|p|pre|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|ul)(?:\s[^<>]*)?\/?>$/i;

/** Angle-bracket placeholders of a template, outside comments and code. They must not survive in a body. */
export function templatePlaceholders(template: string): readonly string[] {
  const found = new Set<string>();
  for (const match of stripNoise(template).matchAll(PLACEHOLDER)) {
    const token = match[0];
    if (!HTML_TAG.test(token)) {
      found.add(token);
    }
  }
  return [...found];
}

// ---------- Required sections and skeleton ----------

/** The headings that the body must hold. The same rule as the `body_template` check of pr-status. */
export function requiredHeadings(template: string | null, policy: Policy): readonly string[] {
  const fromTemplate = template === null ? [] : templateHeadings(template);
  return fromTemplate.length > 0 ? fromTemplate : policy.pr_body.sections;
}

const HINTS: Readonly<Record<string, string>> = {
  why: "Why this change is needed, and who benefits. One short paragraph.",
  what: "What ships, as outcomes. Not a list of files.",
  proof: "The commands or tests that show it works, with their results.",
  "done when": 'Tick each box of the linked issue and name its proof. Write "None." when no issue is linked.',
};

export function buildSkeleton(
  template: string | null,
  policy: Policy,
  issueBoxes: readonly string[],
): string {
  if (template !== null && templateHeadings(template).length > 0) {
    return template.trimEnd();
  }
  const heading = policy.issues.done_when_heading.toLowerCase();
  return policy.pr_body.sections
    .map((section) => {
      const boxes =
        section.toLowerCase() === heading && issueBoxes.length > 0
          ? `${issueBoxes.map((box) => `- [ ] ${box} (proof: )`).join("\n")}\n`
          : "";
      return `## ${section}\n\n<!-- ${HINTS[section.toLowerCase()] ?? "Fill this section for this change."} -->\n${boxes}`;
    })
    .join("\n")
    .trimEnd();
}

// ---------- Issue Done-when boxes ----------

export interface IssueBoxes {
  readonly present: boolean;
  readonly unchecked: readonly string[];
}

/** The unchecked Done-when boxes of an issue body. A checked box is done work and needs no proof. */
export function parseIssueBoxes(body: string, heading: string): IssueBoxes {
  const lines = sectionLines(body, heading);
  if (lines === null) {
    return { present: false, unchecked: [] };
  }
  const unchecked: string[] = [];
  for (const line of lines) {
    const open = /^\s*[-*+]\s+\[ \]\s+(.*)$/.exec(line);
    if (open !== null) {
      unchecked.push((open[1] ?? "").trim());
    }
  }
  return { present: true, unchecked };
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface ProofContext {
  /** The issue that the PR links. Its own number is no proof. */
  readonly issue: number;
  /** The full ids of the commits of the PR range. A commit id is proof only when the range holds it. */
  readonly commits: readonly string[];
}

/**
 * Proof is a code span, a URL, a commit id (7 to 40 hex digits) of a commit in
 * the PR range, or the number of another issue or PR. The text is lower case.
 */
function hasProof(remainder: string, context: ProofContext): boolean {
  if (/`[^`\n]+`/.test(remainder) || /https?:\/\/\S+/.test(remainder)) {
    return true;
  }
  for (const word of remainder.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    if (context.commits.some((commit) => commit.startsWith(word[0]))) {
      return true;
    }
  }
  return [...remainder.matchAll(/#(\d+)/g)].some((ref) => Number(ref[1]) !== context.issue);
}

/** Boxes of the issue that the body does not map to a checked line with proof. */
export function unmappedBoxes(body: string, heading: string, boxes: readonly string[], context: ProofContext): readonly string[] {
  const lines = sectionLines(body, heading) ?? [];
  const checked = lines.flatMap((line) => {
    const hit = /^\s*[-*+]\s+\[[xX]\]\s+(.*)$/.exec(line);
    return hit === null ? [] : [norm(hit[1] ?? "")];
  });
  return boxes.filter((box) => {
    const wanted = norm(box);
    return !checked.some((line) => line.includes(wanted) && hasProof(line.replace(wanted, " "), context));
  });
}

function referencePattern(words: string, number: number): RegExp {
  return new RegExp(`\\b(?:${words})\\s*:?\\s+#${number}\\b`, "i");
}

const CLOSING_WORDS = "close[sd]?|fix(?:e[sd])?|resolve[sd]?";

export function bodyClosesIssue(body: string, number: number): boolean {
  return referencePattern(CLOSING_WORDS, number).test(stripNoise(body));
}

export function bodyHoldsPartOf(body: string, number: number): boolean {
  return referencePattern("part\\s+of", number).test(stripNoise(body));
}

export interface IssueKnowledge {
  /** The issue was read. */
  readonly readable: boolean;
  /** The issue body has a Done-when section. */
  readonly hasDoneWhen: boolean;
}

/**
 * Closes #n only when the issue has a Done-when section and every open box of
 * it maps to a checked line with proof in the body. Anything less is Part of #n:
 * an issue that cannot be read, or that has no Done-when section, never closes.
 */
export function decideLink(
  number: number,
  issueBoxes: readonly string[],
  body: string,
  heading: string,
  partOfRequested: boolean,
  context: ProofContext,
  known: IssueKnowledge,
): LinkDecision {
  const unmapped = known.readable && known.hasDoneWhen ? unmappedBoxes(body, heading, issueBoxes, context) : [];
  const closes = !partOfRequested && known.readable && known.hasDoneWhen && unmapped.length === 0;
  const kind = closes ? "Closes" : "Part of";
  const reason = partOfRequested
    ? "--part-of was given"
    : !known.readable
      ? "the issue could not be read"
      : !known.hasDoneWhen
        ? "the issue has no Done-when section"
        : unmapped.length === 0
          ? issueBoxes.length === 0
            ? "the issue has no open Done-when box"
            : "every open Done-when box of the issue maps to proof in the body"
          : `${unmapped.length} Done-when box${unmapped.length === 1 ? "" : "es"} of the issue ${unmapped.length === 1 ? "has" : "have"} no proof in the body`;
  return {
    kind,
    line: `${kind} #${number}`,
    unmapped,
    reason,
    present: closes ? bodyClosesIssue(body, number) || bodyHoldsPartOf(body, number) : bodyHoldsPartOf(body, number),
  };
}

// ---------- Body checks and the final text ----------

export function bodyChecks(body: string, required: readonly string[], placeholders: readonly string[]): readonly string[] {
  const stripped = stripAuthoringComments(body);
  const problems = [...bodyProblems(stripped, required)];
  const left = placeholders.filter((token) => stripNoise(stripped).includes(token));
  if (left.length > 0) {
    problems.push(`placeholder text is still in the body: ${left.slice(0, 5).join(" ")}`);
  }
  if (stripped.length > MAX_BODY_CHARS) {
    problems.push(`the body is longer than ${MAX_BODY_CHARS} characters`);
  }
  return problems;
}

export interface FinalBodyInput {
  readonly body: string;
  /** The line to add when the body lacks it. */
  readonly addLine: string | null;
  readonly footer: string;
}

/** The text that open posts: no authoring comments, the issue link line, and the policy footer. */
export function finalBody(input: FinalBodyInput): string {
  let text = stripAuthoringComments(input.body).replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (input.addLine !== null) {
    text = `${text}\n\n${input.addLine}`;
  }
  const footer = input.footer.trim();
  if (footer !== "" && !text.includes(footer)) {
    text = `${text}\n\n${footer}`;
  }
  return `${text}\n`;
}
