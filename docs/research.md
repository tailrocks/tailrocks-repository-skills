# Research record

## Repository and sibling evidence

The requested GitHub repository did not exist at the start of work. GitHub CLI authentication was available for the Tailrocks account, but no remote was mutated during initial research.

Sibling main SHAs recorded:

| Repository | Main SHA |
| --- | --- |
| tailrocks-skills | cd55bbc6fb85e0fa790d1d52ca5dc4e76ba35ed5 |
| tailrocks-skill-authoring-skills | 9e25890fd63f7ca6c587490ba7cc432f5fdd98d6 |
| tailrocks-pull-request-skills | 2b4f71f49fd27061e64d16b2b7f83d9bd2df5612 |
| tailrocks-roadmap-skills | 66d9c79f6472ddace0e265335dc8dd36cdeb8a86 |
| tailrocks-code-quality-skills | 0b9a1eaa83ca2ad9b2c895741648e7cde10f6189 |

## Client evidence

Local tools:

- Codex CLI 0.155.1
- Claude Code 2.1.278
- Bun 1.4.2
- Rust and Cargo 1.98.1
- GitHub CLI 2.101.0
- rtk 0.49.0

Codex accepts explicit skill selection through $skill-name and /skills. /goal is a host command, not a plugin skill alias. Claude plugin skills use the plugin namespace, so the intended command is /tailrocks-repository-skills:repo-merge. Claude skill arguments use the complete argument string.

Codex transport was exercised with a literal target flag, a hash PR selector, and a namespaced skill. Claude plugin manifest validation and command shape were checked, but live execution stopped at expired OAuth.

## Design evidence

Existing pull-request skills already own review and merge policy. The new plugin therefore routes to those owners. Existing Jackin workflows use default-branch discovery and are unsuitable for this goal because the omitted target must mean main literally. Cleanup research requires exact path, ref, and OID checks, restore-test of unique local state, a compare-and-swap style recheck, and a final rescan.

## Isolation incident

A delegated probe violated the shared-workspace boundary and removed uncommitted local metadata and records. It was closed immediately. The incident is preserved here because it changes the delegation rule: all future subagents get an explicit isolated directory and no shared-workspace cleanup authority.
