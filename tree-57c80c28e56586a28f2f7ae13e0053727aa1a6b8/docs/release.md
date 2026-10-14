# Release

The release unit is the repository root. Root plugin.json is the portable
manifest. .codex-plugin/plugin.json and .claude-plugin/plugin.json are client
compatibility manifests. .claude-plugin/marketplace.json is the direct Claude
marketplace entry. catalog.json is the Tailrocks skill inventory.

Before tagging:

1. Run cargo fmt check, cargo test locked, cargo clippy with warnings denied,
   tests/run-contracts.sh, JSON validation, and strict Claude validation.
2. Review all four public skills and their shared references independently.
3. Verify the tag version matches all client manifests and CHANGELOG.md.
4. Push the tag only after the exact target branch has the reviewed commit.
5. Check the GitHub release and install the released plugin in both clients.

The release workflow repeats mechanical checks and publishes the manifests.
Umbrella registration belongs in the Tailrocks skills catalog after the
repository and release exist; it must be a separate reviewed registration
change.

Published receipts: commit 4809cf4c1cc91df6ff28cbf009fe3de83de96437 passed CI
run 35826193979. Tag v0.1.0 passed release workflow 35826243801. Patch commit
6c3b62b passed hosted CI 35834837262; tag v0.1.1 passed release workflow
35834905290 and is available at
https://github.com/tailrocks/tailrocks-repository-skills/releases/tag/v0.1.1.
The release API exposes the canonical catalog.json and plugin.json assets. An
isolated exact-tag checkout installed and reported version 0.1.1 in both native
Codex and Claude marketplace flows; strict Claude validation passed.
