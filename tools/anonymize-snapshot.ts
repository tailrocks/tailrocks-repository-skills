// Anonymize a recorded snapshot so that it can be committed as a test fixture.
//
// Kept: PR and issue numbers, commit ids, dates, states, check results.
// Replaced: the repository, people (user-a, user-b, ...), branch names, emails,
// titles, ids, and every text body. Bodies shrink to what `evaluate` reads:
// verdict lines, Done-when boxes, the first line of a thread, sign-off trailers.

import { parseDoneWhen, stripNoise } from "../lib/status/text.ts";
import type { Policy } from "../lib/policy/types.ts";
import type { PrSnapshot } from "../lib/status/types.ts";
import type { RepoSlug } from "../lib/types.ts";

export const EXAMPLE_REPO = "example-org/example-repo" as RepoSlug;

export interface AnonymizeOptions {
  /** Logins that stay as they are, besides names that end in [bot]. */
  readonly keepLogins: readonly string[];
  readonly policy: Policy;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(pattern: string, flags: string): RegExp | null {
  try {
    return pattern === "" ? null : new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export class Anonymizer {
  readonly #logins = new Map<string, string>();
  readonly #keep: ReadonlySet<string>;
  readonly #owner: string;
  readonly #name: string;

  constructor(
    private readonly snapshot: PrSnapshot,
    private readonly options: AnonymizeOptions,
  ) {
    [this.#owner = "", this.#name = ""] = snapshot.repo.split("/");
    this.#keep = new Set(options.keepLogins.map((l) => l.toLowerCase()));
  }

  kept(login: string): boolean {
    return login === "ghost" || /\[bot\]$/i.test(login) || this.#keep.has(login.toLowerCase());
  }

  login(login: string): string {
    if (this.kept(login)) {
      return login;
    }
    const known = this.#logins.get(login.toLowerCase());
    if (known !== undefined) {
      return known;
    }
    const letter = String.fromCharCode(97 + this.#logins.size);
    const mapped = `user-${this.#logins.size < 26 ? letter : String(this.#logins.size)}`;
    this.#logins.set(login.toLowerCase(), mapped);
    return mapped;
  }

  email(login: string | null, email: string): string {
    const who = login ?? email.split("@")[0] ?? "user";
    return this.kept(who) ? `${who}@users.noreply.example.com` : `${this.login(who)}@example.com`;
  }

  /** Replace names of the repository, people, and emails in free text. */
  scrub(text: string): string {
    let out = text
      .replace(new RegExp(escapeRegExp(this.snapshot.repo), "gi"), EXAMPLE_REPO)
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "user@example.com");
    for (const [real, mapped] of this.#logins) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(real)}\\b`, "gi"), mapped);
    }
    const tokens = [this.#owner, this.#name, ...this.#name.split("-").filter((t) => t.length >= 4)].filter((t) => t !== "");
    for (const token of new Set(tokens)) {
      out = out.replace(new RegExp(escapeRegExp(token), "gi"), "example");
    }
    return out;
  }

  /** Names that must not survive in the output. */
  forbidden(): readonly string[] {
    return [
      this.#owner,
      this.#name,
      ...[...this.#logins.keys()].filter((l) => l.length >= 3),
    ].filter((t) => t.length >= 3);
  }

  private reviewBody(body: string): string {
    const { review } = this.options.policy;
    const patterns = [review.approve_pattern, review.changes_pattern, review.blocking_pattern]
      .map((p) => compile(p, review.flags))
      .filter((p): p is RegExp => p !== null);
    const kept: string[] = [];
    for (const line of body.split("\n")) {
      for (const pattern of patterns) {
        const match = pattern.exec(line);
        if (match !== null) {
          kept.push(match[0].trim());
          break;
        }
      }
    }
    return kept.join("\n");
  }

  private threadBody(body: string): string {
    const first = (body.split("\n")[0] ?? "").slice(0, 100);
    const fix = compile(this.options.policy.threads.fix_pattern, this.options.policy.review.flags);
    const line = this.scrub(first);
    return fix !== null && fix.test(body) && !fix.test(line) ? `P1 ${line}` : line;
  }

  private prBody(body: string): string {
    const lines = stripNoise(body)
      .split("\n")
      .filter((l) => /^\s{0,3}#{1,6}\s/.test(l) || /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part\s+of|refs?)\b.*#\d+/i.test(l))
      .map((l) => this.scrub(l).slice(0, 120));
    return lines.join("\n");
  }

  private issueBody(body: string): string {
    const heading = this.options.policy.issues.done_when_heading;
    const done = parseDoneWhen(body, heading);
    if (done === null) {
      return "";
    }
    return [
      `## ${heading}`,
      ...done.unchecked.map((_, i) => `- [ ] open item ${i + 1}`),
      ...Array.from({ length: done.checked }, (_, i) => `- [x] done item ${i + 1}`),
    ].join("\n");
  }

  run(): PrSnapshot {
    const s = this.snapshot;
    // Register people first, in a stable order, so the scrub sees them all.
    [s.author, ...s.reviews.map((r) => r.author), ...s.threads.map((t) => t.firstAuthor), ...s.commits.map((c) => c.authorLogin ?? "")]
      .filter((l) => l !== "")
      .forEach((l) => this.login(l));
    const number = s.number;
    const baseRef = s.baseRef === s.defaultBranch ? s.baseRef : s.parentPr !== null ? `feature/${s.parentPr}` : "release/example";
    return {
      ...s,
      repo: EXAMPLE_REPO,
      nodeId: `PR_example_${number}`,
      author: this.login(s.author),
      title: `Example change ${number}`,
      body: this.prBody(s.body),
      baseRef,
      headRef: `feature/${number}`,
      labels: s.labels.map((l) => this.scrub(l)),
      checks: s.checks.map((c) => ({ ...c, name: this.scrub(c.name), workflow: c.workflow === null ? null : this.scrub(c.workflow) })),
      reviews: s.reviews.map((r) => ({ ...r, author: this.login(r.author), body: this.reviewBody(r.body) })),
      latestOpinionatedReviews: s.latestOpinionatedReviews.map((r) => ({ ...r, author: this.login(r.author) })),
      threads: s.threads.map((t, i) => ({
        ...t,
        id: `thread-${i + 1}`,
        path: t.path === null ? null : `src/file-${i + 1}${/\.[A-Za-z0-9]+$/.exec(t.path)?.[0] ?? ""}`,
        firstAuthor: this.login(t.firstAuthor),
        firstBody: this.threadBody(t.firstBody),
        lastAuthor: this.login(t.lastAuthor),
      })),
      commits: s.commits.map((c) => {
        const who = c.authorLogin === null ? null : this.login(c.authorLogin);
        const signed = /^signed-off-by:/im.test(c.message);
        return {
          ...c,
          message: `commit ${c.oid.slice(0, 7)}${signed ? `\n\nSigned-off-by: ${who ?? "user-x"} <${this.email(c.authorLogin, c.authorEmail)}>` : ""}`,
          authorLogin: who,
          authorEmail: this.email(c.authorLogin, c.authorEmail),
        };
      }),
      queueEntry: s.queueEntry === null ? null : { ...s.queueEntry, id: `MQE_example_${number}` },
      linkedIssues: s.linkedIssues.map((i) => ({ ...i, body: this.issueBody(i.body) })),
      rules: { ...s.rules, requiredChecks: s.rules.requiredChecks.map((c) => ({ ...c, name: this.scrub(c.name) })) },
      git: {
        ...s.git,
        unavailableBecause: s.git.unavailableBecause === null ? null : this.scrub(s.git.unavailableBecause),
        carryStoppedBecause: s.git.carryStoppedBecause === null ? null : this.scrub(s.git.carryStoppedBecause),
      },
      problems: s.problems.map((p) => this.scrub(p)),
    };
  }
}

export interface Anonymized {
  readonly snapshot: PrSnapshot;
  /** Names found in the serialized output that should be gone. Empty means clean. */
  readonly leaks: readonly string[];
}

export function anonymize(snapshot: PrSnapshot, options: AnonymizeOptions): Anonymized {
  const worker = new Anonymizer(snapshot, options);
  const result = worker.run();
  const text = JSON.stringify(result).toLowerCase();
  const leaks = worker.forbidden().filter((name) => text.includes(name.toLowerCase()));
  return { snapshot: result, leaks };
}
