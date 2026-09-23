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
