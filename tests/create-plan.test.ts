import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlan } from "../lib/create/plan.ts";
import type { Finding, Plan } from "../lib/create/types.ts";
import {
  argsFor,
  configFor,
  fakeWorld,
  GOOD_BODY,
  makeRepos,
  newWorld,
  REPO,
  writeTemp,
  type FakeWorld,
  type Repos,
  type World,
} from "./helpers/create.ts";

const made: Repos[] = [];
afterEach(() => {
  for (const repos of made.splice(0)) {
    repos.cleanup();
  }
});

async function setup(world: Partial<World> = {}): Promise<{ repos: Repos; fake: FakeWorld }> {
  const repos = await makeRepos();
  made.push(repos);
  await repos.git(["checkout", "-b", "feat/topic"]);
  return { repos, fake: fakeWorld(repos, newWorld(world)) };
}

async function planOf(repos: Repos, fake: FakeWorld, ...argv: string[]): Promise<Plan> {
  const result = await buildPlan(argsFor("plan", ...argv), configFor(repos, fake));
  if (result.kind !== "plan") {
    throw new Error(`no plan: ${JSON.stringify(result)}`);
  }
  return result.plan;
}

function codes(plan: Plan, kind?: Finding["kind"]): readonly string[] {
  return plan.findings.filter((f) => kind === undefined || f.kind === kind).map((f) => f.code);
}

describe("plan: a clean branch", () => {
  test("one signed commit gives exit 0, the default base, a draft, and the commit subject as title", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake);
    expect(plan.exit).toBe(0);
    expect(String(plan.headSha)).toBe(sha);
    expect(plan.base.ref).toBe("main");
    expect(plan.base.stackedOn).toBeNull();
    expect(plan.draft).toBe(true);
    expect(plan.title).toBe("feat: add a");
    expect(plan.policySource).toBe("default");
    expect(plan.relation).toBe("absent");
    expect(plan.skeleton).toContain("## Why");
    expect(plan.requiredHeadings).toEqual(["Why", "What", "Proof", "Done when"]);
    expect(plan.next).toContain(`open --expect-head ${sha}`);
  });

  test("the plan writes nothing: no remote branch, no PR, no commit", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a");
    await planOf(repos, fake);
    expect(await repos.remoteRef("feat/topic")).toBeNull();
    expect(fake.world.created).toEqual([]);
    expect(await repos.head()).toBe(sha);
  });
});

describe("plan: the branch", () => {
  test("the default branch is a blocker", async () => {
    const { repos, fake } = await setup();
    await repos.git(["checkout", "main"]);
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake);
    expect(plan.exit).toBe(20);
    expect(codes(plan, "blocker")).toContain("on_protected_branch");
    expect(plan.next).toContain("git switch -c");
  });

  test("a name that breaks branches.name_pattern is a blocker", async () => {
    const { repos, fake } = await setup();
    await repos.git(["checkout", "-b", "my-work"]);
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["branch_name"]);
  });

  test("--branch pushes HEAD under a valid name", async () => {
    const { repos, fake } = await setup();
    await repos.git(["checkout", "-b", "my-work"]);
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake, "--branch", "feat/topic");
    expect(plan.exit).toBe(0);
    expect(plan.headBranch).toBe("feat/topic");
  });

  test("a detached HEAD is a blocker", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.git(["checkout", "--detach", sha]);
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["detached_head"]);
  });

  test("no commit beyond the base is a blocker", async () => {
    const { repos, fake } = await setup();
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["no_commits"]);
  });

  test("uncommitted tracked changes block; untracked files only inform", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    writeFileSync(join(repos.work, "scratch.txt"), "x\n");
    expect(codes(await planOf(repos, fake))).toEqual(["untracked_files"]);
    writeFileSync(join(repos.work, "a.txt"), "changed\n");
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["dirty_tree"]);
  });

  test("a remote branch that holds other commits is a refusal", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    const other = await repos.otherClone();
    await repos.git(["checkout", "-b", "feat/topic"], other);
    await repos.commit("z.txt", "z\n", "feat: other work", { cwd: other });
    await repos.git(["push", "origin", "feat/topic"], other);
    const plan = await planOf(repos, fake);
    expect(plan.exit).toBe(3);
    expect(codes(plan, "refusal")).toEqual(["remote_diverged"]);
    expect(plan.relation).toBe("diverged");
  });

  test("a remote that names another repository fails the read", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.git(["remote", "set-url", "origin", "https://github.com/other-org/other-repo.git"]);
    const result = await buildPlan(argsFor("plan"), configFor(repos, fake));
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" ? result.error : "").toContain("other-org/other-repo");
  });
});

describe("plan: the base", () => {
  test("a branch built on another open PR is stacked on it", async () => {
    const { repos, fake } = await setup();
    await repos.git(["checkout", "-b", "parent"]);
    const parentSha = await repos.commit("p.txt", "p\n", "feat: parent");
    await repos.git(["push", "origin", "parent"]);
    await repos.git(["checkout", "-B", "feat/topic"]);
    await repos.commit("c.txt", "c\n", "feat: child");
    fake.world.prs.push({ number: 5, id: "PR_5", title: "parent", headRef: "parent", headSha: parentSha, baseRef: "main", isDraft: true, isCrossRepository: false, author: "dev-a", labels: [], body: "" });
    const plan = await planOf(repos, fake);
    expect(plan.exit).toBe(0);
    expect(plan.base.ref).toBe("parent");
    expect(String(plan.base.sha)).toBe(parentSha);
    expect(plan.base.stackedOn).toEqual({ number: 5, ref: "parent" });
    expect(plan.commitCount).toBe(1);
    expect(codes(plan, "info")).toContain("stacked");
    // The policy of a stacked PR comes from the default branch, not from the unmerged parent.
    const policyCall = fake.gh.calls.find((c) => c.some((a) => a.includes("pr-policy.toml")));
    expect(policyCall?.some((a) => a.endsWith(`ref=${plan.base.sha}`))).toBe(false);
  });

  test("an explicit base that is neither the default nor allowed is a blocker", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.git(["push", "origin", "main:refs/heads/release/1.x"]);
    const plan = await planOf(repos, fake, "--base", "release/1.x");
    expect(codes(plan, "blocker")).toEqual(["base_not_allowed"]);
  });

  test("branches.bases allows another base", async () => {
    const { repos, fake } = await setup({ policy: 'schema = 1\n[branches]\nbases = ["release/*"]\n' });
    await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.git(["push", "origin", "main:refs/heads/release/1.x"]);
    const plan = await planOf(repos, fake, "--base", "release/1.x");
    expect(plan.exit).toBe(0);
    expect(plan.base.ref).toBe("release/1.x");
  });

  test("a base that conflicts with the branch is a blocker", async () => {
    const { repos, fake } = await setup();
    await repos.commit("README.md", "mine\n", "feat: change the readme");
    const other = await repos.otherClone();
    await repos.commit("README.md", "theirs\n", "docs: change the readme", { cwd: other });
    await repos.git(["push", "origin", "HEAD:refs/heads/main"], other);
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["conflict_with_base"]);
    expect(plan.next).toContain("git merge --signoff origin/main");
  });

  test("a base that moved on is only information", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    const other = await repos.otherClone();
    await repos.commit("n.txt", "n\n", "docs: note", { cwd: other });
    await repos.git(["push", "origin", "HEAD:refs/heads/main"], other);
    const plan = await planOf(repos, fake);
    expect(plan.exit).toBe(0);
    expect(codes(plan, "info")).toContain("behind_base");
  });
});

describe("plan: sign-off", () => {
  test("a local commit without Signed-off-by is a blocker with the rebase command", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const plan = await planOf(repos, fake);
    expect(plan.exit).toBe(20);
    expect(codes(plan, "blocker")).toEqual(["dco_missing"]);
    expect(plan.next).toContain(`git rebase --signoff ${plan.base.sha}`);
  });

  test("dco.required = false skips the scan", async () => {
    const { repos, fake } = await setup({ policy: "schema = 1\n[dco]\nrequired = false\n" });
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    expect((await planOf(repos, fake)).exit).toBe(0);
  });

  test("a bot commit is exempt when the policy says exempt, and not when it says rewrite", async () => {
    const exempt = 'schema = 1\n[dco]\nbot_authors = ["dependency-bot[bot]"]\nbot_commits = "exempt"\n';
    const { repos, fake } = await setup({ policy: exempt });
    await repos.commit("a.txt", "a\n", "chore: bump", { signoff: false, author: "dependency-bot[bot] <1+dependency-bot[bot]@users.noreply.example.invalid>" });
    expect((await planOf(repos, fake)).exit).toBe(0);
    fake.world.policy = exempt.replace("exempt", "rewrite");
    expect(codes(await planOf(repos, fake), "blocker")).toEqual(["dco_missing"]);
  });

  test("an unsigned commit that is already pushed is a refusal, and --allow-unsigned-pushed demotes it", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    await repos.git(["push", "origin", "feat/topic"]);
    const refused = await planOf(repos, fake);
    expect(refused.exit).toBe(3);
    expect(codes(refused, "refusal")).toEqual(["dco_pushed"]);
    expect(refused.next).toContain("--allow-unsigned-pushed");
    const allowed = await planOf(repos, fake, "--allow-unsigned-pushed");
    expect(allowed.exit).toBe(0);
    expect(codes(allowed, "info")).toContain("dco_pushed");
  });

  test("only the unpushed unsigned commits are rebased", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.git(["push", "origin", "feat/topic"]);
    const pushed = await repos.head();
    await repos.commit("b.txt", "b\n", "feat: add b", { signoff: false });
    const plan = await planOf(repos, fake, "--title", "feat: ab");
    expect(codes(plan, "blocker")).toEqual(["dco_missing"]);
    expect(plan.next).toContain(`git rebase --signoff ${pushed}`);
  });
});

describe("plan: an existing PR", () => {
  const pr = (head: string, patch: Partial<World["prs"][number]> = {}): World["prs"][number] => ({
    number: 7, id: "PR_7", title: "feat: add a", headRef: "feat/topic", headSha: head, baseRef: "main", isDraft: true,
    isCrossRepository: false, author: "dev-a", labels: [], body: "x", ...patch,
  });

  test("a current PR needs nothing", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.git(["push", "origin", "feat/topic"]);
    fake.world.prs.push(pr(sha));
    const plan = await planOf(repos, fake);
    expect(plan.exit).toBe(0);
    expect(plan.relation).toBe("same");
    expect(plan.existing?.number).toBe(7);
    expect(plan.skeleton).toBeNull();
    expect(plan.next).toContain("Nothing to push");
  });

  test("new commits are pushed to the same PR", async () => {
    const { repos, fake } = await setup();
    const first = await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.git(["push", "origin", "feat/topic"]);
    fake.world.prs.push(pr(first));
    const sha = await repos.commit("b.txt", "b\n", "feat: add b");
    const plan = await planOf(repos, fake);
    expect(plan.relation).toBe("behind");
    expect(plan.next).toContain(`open --expect-head ${sha}`);
  });

  test("two PRs, another author, or another base is a refusal", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a");
    fake.world.prs.push(pr(sha), { ...pr(sha), number: 8, id: "PR_8" });
    expect(codes(await planOf(repos, fake), "refusal")).toEqual(["pr_multiple"]);
    fake.world.prs.splice(0, fake.world.prs.length, pr(sha, { author: "someone-else" }));
    expect(codes(await planOf(repos, fake), "refusal")).toEqual(["pr_not_yours"]);
    fake.world.prs.splice(0, fake.world.prs.length, pr(sha));
    await repos.git(["push", "origin", "main:refs/heads/release/1.x"]);
    expect(codes(await planOf(repos, fake, "--base", "release/1.x"), "refusal")).toContain("pr_other_base");
  });

  test("a PR from a fork with the same branch name does not count", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a");
    fake.world.prs.push(pr(sha, { isCrossRepository: true }));
    const plan = await planOf(repos, fake);
    expect(plan.existing).toBeNull();
    expect(plan.exit).toBe(0);
  });
});

describe("plan: inventories and pre-push steps", () => {
  const inventoryPolicy = [
    "schema = 1",
    "[[inventories]]",
    'name = "sources"',
    'file = "docs/inventory.txt"',
    'added = ["src/**/*.ts"]',
    "group_depth = 2",
    "",
  ].join("\n");

  test("an added file that the inventory misses is a blocker, but only in a listed group", async () => {
    const { repos, fake } = await setup({ policy: inventoryPolicy });
    await repos.git(["checkout", "main"]);
    await repos.commit("docs/inventory.txt", "src/core/one.ts\n", "docs: inventory");
    await repos.git(["push", "origin", "HEAD:refs/heads/main"]);
    await repos.git(["checkout", "-b", "feat/two"]);
    await repos.commit("src/core/two.ts", "export {};\n", "feat: core two");
    await repos.commit("src/other/three.ts", "export {};\n", "feat: other three");
    const plan = await planOf(repos, fake, "--title", "feat: two");
    expect(codes(plan, "blocker")).toEqual(["inventory_miss"]);
    expect(plan.findings[0]?.items).toEqual(["src/core/two.ts"]);
    writeFileSync(join(repos.work, "docs/inventory.txt"), "src/core/one.ts\nsrc/core/two.ts\n");
    await repos.git(["commit", "-s", "-am", "docs: list two"]);
    expect((await planOf(repos, fake, "--title", "feat: two")).exit).toBe(0);
  });

  test("a missing inventory file is a blocker when the branch adds a matching file", async () => {
    const { repos, fake } = await setup({ policy: inventoryPolicy });
    await repos.commit("src/core/two.ts", "export {};\n", "feat: core two");
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["inventory_miss"]);
    expect(plan.findings[0]?.detail).toContain("cannot be read");
  });

  test("a regenerate entry whose inputs changed gives a notice", async () => {
    const policy = ['schema = 1', "[[regenerate]]", 'name = "goldens"', 'run = ["make", "goldens"]', 'when_changed = ["gen/**"]', 'outputs = ["out/**"]', ""].join("\n");
    const { repos, fake } = await setup({ policy });
    await repos.commit("a.txt", "a\n", "feat: unrelated");
    expect(codes(await planOf(repos, fake))).not.toContain("regenerate_notice");
    await repos.commit("gen/input.txt", "i\n", "feat: input");
    const plan = await planOf(repos, fake, "--title", "feat: both");
    expect(codes(plan)).toContain("regenerate_notice");
    expect(plan.findings.find((f) => f.code === "regenerate_notice")?.next).toContain("make goldens");
    expect(plan.exit).toBe(0);
  });

  const step = (name: string, run: string, extra = ""): string => `[[prepush]]\nname = "${name}"\nrun = ${run}\n${extra}\n`;

  test("a passing step is listed as run, and a failing step blocks", async () => {
    const { repos, fake } = await setup({ policy: `schema = 1\n${step("lint", '["true"]')}` });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const ok = await planOf(repos, fake);
    expect(ok.prepushRan).toEqual(["lint"]);
    expect(ok.exit).toBe(0);
    fake.world.policy = `schema = 1\n${step("lint", '["false"]')}`;
    const bad = await planOf(repos, fake);
    expect(codes(bad, "blocker")).toEqual(["prepush_failed"]);
  });

  test("a step that does not match when_changed does not run", async () => {
    const { repos, fake } = await setup({ policy: `schema = 1\n${step("rust", '["false"]', 'when_changed = ["**/*.rs"]')}` });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake);
    expect(plan.prepushRan).toEqual([]);
    expect(plan.exit).toBe(0);
  });

  test("a step that changes tracked files is a blocker", async () => {
    const script = "require('fs').appendFileSync('a.txt','more')";
    const { repos, fake } = await setup({ policy: `schema = 1\n${step("fmt", `["${process.execPath}", "-e", "${script}"]`)}` });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["prepush_changed_files"]);
  });

  test("the steps do not run while another blocker stands", async () => {
    const { repos, fake } = await setup({ policy: `schema = 1\n${step("lint", '["false"]')}` });
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const plan = await planOf(repos, fake);
    expect(codes(plan, "blocker")).toEqual(["dco_missing"]);
    expect(codes(plan, "info")).toContain("prepush_skipped");
    expect(plan.prepushRan).toEqual([]);
  });
});

describe("plan: title, labels, and policy", () => {
  test("two commits need --title", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    await repos.commit("b.txt", "b\n", "feat: add b");
    expect(codes(await planOf(repos, fake), "blocker")).toEqual(["title_needed"]);
    expect((await planOf(repos, fake, "--title", "feat: a and b")).title).toBe("feat: a and b");
  });

  test("label mode adds the run-once label only with --run-ci", async () => {
    const policy = 'schema = 1\n[labels]\npr_ci = "label"\nrun_once = "ci:run"\n';
    const { repos, fake } = await setup({ policy });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const without = await planOf(repos, fake);
    expect(without.labels).toEqual([]);
    expect(codes(without, "info")).toContain("ci_label_deferred");
    const withCi = await planOf(repos, fake, "--run-ci", "--label", "area:docs");
    expect(withCi.labels).toEqual(["area:docs", "ci:run"]);
  });

  test("an invalid policy stops the plan", async () => {
    const { repos, fake } = await setup({ policy: "schema = 1\n[branchs]\nx = 1\n" });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const result = await buildPlan(argsFor("plan"), configFor(repos, fake));
    expect(result.kind).toBe("policy-error");
  });

  test("create_as_draft = false plans a ready PR", async () => {
    const { repos, fake } = await setup({ policy: "schema = 1\n[draft]\ncreate_as_draft = false\n" });
    await repos.commit("a.txt", "a\n", "feat: add a");
    expect((await planOf(repos, fake)).draft).toBe(false);
  });

  test("a failed GitHub read refuses", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    const broken = { ...configFor(repos, fake), runGh: async () => ({ code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" }) };
    const result = await buildPlan(argsFor("plan"), broken);
    expect(result).toEqual({ kind: "failed", error: "cannot read the repository (pass --repo owner/name): HTTP 401: Bad credentials" });
  });
});

describe("plan: the body and the issue link", () => {
  const issueBody = ["## Done when", "", "- [ ] The example works", "- [ ] The docs say so", "- [x] Already done", ""].join("\n");

  test("a template wins over the sections, and its placeholders must go", async () => {
    const template = ["## Summary", "", "<!-- one paragraph -->", "", "## Checks", "", "- [ ] <name each check>", ""].join("\n");
    const { repos, fake } = await setup({ template });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake);
    expect(plan.requiredHeadings).toEqual(["Summary", "Checks"]);
    expect(plan.skeleton).toContain("<name each check>");
    const left = writeTemp(repos, "left.md", "## Summary\n\nDone.\n\n## Checks\n\n- [ ] <name each check>\n");
    const bad = await planOf(repos, fake, "--body-file", left);
    expect(codes(bad, "blocker")).toEqual(["body_invalid"]);
    expect(bad.findings[0]?.items.join(" ")).toContain("placeholder");
    const fine = writeTemp(repos, "fine.md", "## Summary\n\nDone.\n\n## Checks\n\n- [x] bun test passes\n");
    expect((await planOf(repos, fake, "--body-file", fine)).finalBody).toContain("bun test passes");
  });

  test("a missing or empty section is a blocker, and the final body drops comments and adds the footer", async () => {
    const { repos, fake } = await setup({ policy: 'schema = 1\n[pr_body]\nfooter = "Generated by an agent."\n' });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const bad = writeTemp(repos, "bad.md", "## Why\n\nBecause.\n\n## What\n\n<!-- todo -->\n");
    const plan = await planOf(repos, fake, "--body-file", bad);
    expect(plan.findings[0]?.items).toEqual(['empty section "What"', 'missing section "Proof"', 'missing section "Done when"']);
    const good = writeTemp(repos, "good.md", `<!-- hint -->\n${GOOD_BODY}`);
    const ok = await planOf(repos, fake, "--body-file", good);
    expect(ok.exit).toBe(0);
    expect(ok.finalBody).not.toContain("<!--");
    expect(ok.finalBody?.endsWith("\n\nGenerated by an agent.\n")).toBe(true);
  });

  test("the skeleton lists the open Done-when boxes of the issue", async () => {
    const { repos, fake } = await setup();
    fake.world.issues.set(12, { state: "OPEN", title: "Make the example work", body: issueBody });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake, "--issue", "12");
    expect(plan.issue?.unchecked).toEqual(["The example works", "The docs say so"]);
    expect(plan.skeleton).toContain("- [ ] The example works (proof: )");
    expect(plan.skeleton).not.toContain("Already done");
  });

  test("Closes only when every open box has a checked line with proof; otherwise Part of", async () => {
    const { repos, fake } = await setup();
    fake.world.issues.set(12, { state: "OPEN", title: "Make the example work", body: issueBody });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const mapped = GOOD_BODY.replace("None.", "- [x] The example works (`bun test` passes)\n- [x] The docs say so, see https://example.invalid/docs");
    const closes = await planOf(repos, fake, "--issue", "12", "--body-file", writeTemp(repos, "m.md", mapped));
    expect(closes.link?.kind).toBe("Closes");
    expect(closes.finalBody).toContain("\n\nCloses #12\n");

    const noProof = GOOD_BODY.replace("None.", "- [x] The example works (`bun test` passes)\n- [x] The docs say so");
    const partial = await planOf(repos, fake, "--issue", "12", "--body-file", writeTemp(repos, "n.md", noProof));
    expect(partial.link?.kind).toBe("Part of");
    expect(partial.link?.unmapped).toEqual(["The docs say so"]);
    expect(partial.finalBody).toContain("\n\nPart of #12\n");

    const unchecked = GOOD_BODY.replace("None.", "- [ ] The example works (`bun test` passes)\n- [x] The docs say so, see https://example.invalid/docs");
    expect((await planOf(repos, fake, "--issue", "12", "--body-file", writeTemp(repos, "u.md", unchecked))).link?.unmapped).toEqual(["The example works"]);

    const forced = await planOf(repos, fake, "--issue", "12", "--part-of", "--body-file", writeTemp(repos, "f.md", mapped));
    expect(forced.link?.kind).toBe("Part of");
  });

  test("a body that closes an issue the rule keeps open is a blocker", async () => {
    const { repos, fake } = await setup();
    fake.world.issues.set(12, { state: "OPEN", title: "Make the example work", body: issueBody });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const closing = `${GOOD_BODY}\nFixes #12\n`;
    const plan = await planOf(repos, fake, "--issue", "12", "--body-file", writeTemp(repos, "c.md", closing));
    expect(plan.exit).toBe(20);
    expect(codes(plan, "blocker")).toEqual(["link_conflict"]);
    expect(plan.finalBody).toBeNull();
  });

  test("an issue without Done-when boxes gets Closes by the rule, and the body keeps its own Part of", async () => {
    const { repos, fake } = await setup();
    fake.world.issues.set(3, { state: "OPEN", title: "Small bug", body: "It fails." });
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plain = await planOf(repos, fake, "--issue", "3", "--body-file", writeTemp(repos, "p.md", GOOD_BODY));
    expect(plain.link?.line).toBe("Closes #3");
    const own = await planOf(repos, fake, "--issue", "3", "--body-file", writeTemp(repos, "o.md", `${GOOD_BODY}\nPart of #3\n`));
    expect(own.finalBody?.match(/#3/g)?.length).toBe(1);
  });

  test("an unreadable issue is a blocker", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake, "--issue", "99");
    expect(codes(plan, "blocker")).toEqual(["issue_unreadable"]);
  });

  test("the body file must be a plain file", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a");
    const plan = await planOf(repos, fake, "--body-file", repos.root);
    expect(codes(plan, "blocker")).toEqual(["body_file_unreadable"]);
  });
});

test("REPO constant matches the fake", () => {
  expect(REPO).toBe("example-org/example-repo");
});

describe("plan: text output", () => {
  test("an info finding with an action shows its next line", async () => {
    const policy = ["schema = 1", "[[regenerate]]", 'name = "goldens"', 'run = ["make", "goldens"]', 'when_changed = ["gen/**"]', 'outputs = ["out/**"]', ""].join("\n");
    const { repos, fake } = await setup({ policy });
    await repos.commit("gen/input.txt", "i\n", "feat: input");
    const { runCli } = await import("./helpers/create.ts");
    const result = await runCli(["plan"], repos, fake);
    expect(result.out).toContain("[info] regenerate_notice");
    expect(result.out).toContain("next: Run make goldens in .");
  });
});
