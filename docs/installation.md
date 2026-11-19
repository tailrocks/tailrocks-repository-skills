# Installation

`tailrocks-repository-skills` version `0.6.0` contains 10 skills.
The package source is [tailrocks/tailrocks-repository-skills][package].
The [Tailrocks catalog][catalog] pins one upstream commit per package.

Install the complete package in one scope per host.
Keep `skills/`, sibling skills, references, assets, and package-root scripts
in their original locations. Relative links and script imports use that layout.

See [runtime requirements](runtime.md) before running a selected workflow.

Private packages require Git credentials with read access to the source.
Hosted imports also require the host's GitHub connection to have access.

## Claude Code

Register the marketplace once, then install this package in user scope.

```sh
claude plugin marketplace add tailrocks/tailrocks-skills
claude plugin install tailrocks-repository-skills@tailrocks --scope user
```

Use `/tailrocks-repository-skills:tailrocks-pr-create` in the session.
Run `claude plugin list` to inspect the installation.

Refresh with `claude plugin marketplace update tailrocks`, then run
`claude plugin update tailrocks-repository-skills@tailrocks`. Use `/reload-plugins` in the
session. Remove with `claude plugin uninstall tailrocks-repository-skills@tailrocks --scope user`.
[Claude Code plugins][claude]

## Codex

```sh
codex plugin marketplace add tailrocks/tailrocks-skills
codex plugin add tailrocks-repository-skills@tailrocks
```

Use `$tailrocks-repository-skills:tailrocks-pr-create` in the CLI or pick the skill from `/skills`.
Inspect installed entries with `codex plugin list --json`.

Refresh with `codex plugin marketplace upgrade tailrocks` and repeat the
qualified `plugin add` command. Open a new session after updating.
Remove with `codex plugin remove tailrocks-repository-skills@tailrocks`. [Codex CLI][codex]

## Grok Build

```sh
grok plugin marketplace add tailrocks/tailrocks-skills
grok plugin install tailrocks-repository-skills --trust
```

`--trust` grants the plugin access to Grok's extension runtime. Review the
source before installing. Use `/tailrocks-pr-create` in the session. On a name
collision, `grok inspect --json` reports the qualified `invocableAs` shortcut.

Use `grok plugin marketplace list` to find the registered marketplace name.
Refresh that marketplace, then run `grok plugin update tailrocks-repository-skills`.
Remove with `grok plugin uninstall tailrocks-repository-skills`. [Grok plugins][grok]

## Muse Code

```sh
muse plugins marketplace add tailrocks tailrocks/tailrocks-skills
muse plugins install tailrocks-repository-skills@tailrocks
```

The Git-backed catalog resolves external packages while building its local
snapshot. Inspect skipped entries if the package is missing. Inspect installed
skills with `muse skills list --source plugin`.

Use `/tailrocks-pr-create` or the qualified entry shown in the `/` picker.
For a newer pin, refresh the snapshot, remove the installed copy, and repeat
the install command.

```sh
muse plugins marketplace update tailrocks
muse plugins remove tailrocks-repository-skills
```

The `remove` command alone uninstalls this package. [Muse marketplaces][muse]

## omp

```sh
omp plugin marketplace add tailrocks/tailrocks-skills
omp plugin install tailrocks-repository-skills@tailrocks --scope user
```

Use `/skill:tailrocks-pr-create` with skill commands enabled. For a name
collision, `omp skill list --json` reports the resolved name. The qualified
form uses `/skill:<plugin-id>/<skill-id>`.

Refresh with `omp plugin marketplace update tailrocks`, then run
`omp plugin upgrade tailrocks-repository-skills@tailrocks --scope user`. Remove with
`omp plugin uninstall tailrocks-repository-skills@tailrocks --scope user`. [omp plugins][omp]

## Exact-revision commands

Run the following commands from a checkout of the [Tailrocks catalog][catalog].
Each prints shell commands for the selected host and current catalog commit.
Review and run the printed commands in your terminal.

The next four hosts install this package directly. Their Tailrocks routes
require no marketplace registration. [Distribution guide][distribution]

## OpenCode

Use the OpenCode V2 package installer.

```sh
python3 scripts/install-command.py tailrocks-repository-skills --agent opencode
```

The printed `opencode plugin add` command installs a pinned Git package.
Its server adapter registers the bundled skills. Use `@tailrocks-pr-create`.
Inspect the configured target with `opencode plugin list`.

For a new pin, remove the old target with `opencode plugin remove` followed
by its configured package specifier. Run the newly printed install command.
The same removal command uninstalls the package. [OpenCode plugins][opencode]

## Amp

```sh
python3 scripts/install-command.py tailrocks-repository-skills --agent amp
```

The commands place a complete pinned checkout in Amp's user plugin directory.
For project scope, place the checkout under `.amp/plugins/tailrocks-repository-skills/`.
The root `index.js` registers each bundled skill with Amp.

Ask Amp to load `tailrocks-repository-skills:tailrocks-pr-create` explicitly. Run
`amp plugins list` to inspect loaded plugins. For updates, fetch the new
catalog commit in that checkout and switch to it with `git checkout --detach`.

To uninstall, move this package directory outside the scanned plugin root.
Run `plugins: reload` from the command palette after either change.
[Amp directory plugins][amp]

## Antigravity

```sh
python3 scripts/install-command.py tailrocks-repository-skills --agent antigravity
```

The commands check out the selected commit and pass the local directory to
`agy plugin install`. Antigravity's named marketplace installs address its
official marketplace. Tailrocks uses the local package installer.

Use `/tailrocks-pr-create` in chat. Inspect `agy plugin list --json` for
installed components. For a new pin, install the updated checkout. If the CLI
reports an installed copy, uninstall it first, then repeat the install.
Remove with `agy plugin uninstall tailrocks-repository-skills`. [Antigravity plugins][agy]

## pi

```sh
python3 scripts/install-command.py tailrocks-repository-skills --agent pi
```

The printed `pi install` command uses the Git source and full commit ID.
Pi reads the package's `pi.skills` entry. Use `/skill:tailrocks-pr-create` and
inspect configured packages with `pi list`.

Remove with `pi remove <installed-source>`, using the Git specifier from
`pi list`. To update, remove that pin and install the newly printed source.
Use `/reload` in the session. [Pi packages][pi]

## Kimi Code

Kimi also supports this package. Open the Tailrocks catalog from the CLI
session and select `tailrocks-repository-skills`. Its catalog entry points to the pinned
commit. Reload the session after installing.

```text
/plugins marketplace https://raw.githubusercontent.com/tailrocks/tailrocks-skills/main/.kimi-plugin/marketplace.json
/reload
```

Use `/skill:tailrocks-repository-skills:tailrocks-pr-create` for a bundled skill. Open the
plugin manager to apply a catalog update. Remove with
`/plugins remove tailrocks-repository-skills`, then `/reload`. [Kimi plugins][kimi]

See [compatibility and verification](compatibility.md) for measured results.

[package]: https://github.com/tailrocks/tailrocks-repository-skills
[catalog]: https://github.com/tailrocks/tailrocks-skills
[distribution]: https://github.com/tailrocks/tailrocks-skills/blob/main/docs/standards/distribution.md
[claude]: https://code.claude.com/docs/en/discover-plugins
[codex]: https://learn.chatgpt.com/docs/cli/reference
[grok]: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/09-plugins.md
[muse]: https://meta-models.github.io/muse-code-sdk/1.4/guides/plugins/concepts/marketplaces-and-updates/
[omp]: https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md
[opencode]: https://opencode.ai/docs/plugins/
[amp]: https://ampcode.com/docs/customize/plugins
[agy]: https://antigravity.google/docs/plugins
[pi]: https://docs.pi.dev/latest/packages
[kimi]: https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins
