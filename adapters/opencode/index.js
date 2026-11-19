import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Plugin, Skill } from '@opencode/plugin'
import { parse } from 'yaml'

const skillEntries = [
  {
    "id": "tailrocks-pr-create",
    "explicitOnly": false
  },
  {
    "id": "tailrocks-pr-fleet",
    "explicitOnly": true
  },
  {
    "id": "tailrocks-pr-merge",
    "explicitOnly": true
  },
  {
    "id": "tailrocks-pr-refresh",
    "explicitOnly": false
  },
  {
    "id": "tailrocks-pr-status",
    "explicitOnly": false
  },
  {
    "id": "tailrocks-pr-template",
    "explicitOnly": false
  },
  {
    "id": "tailrocks-pr-threads",
    "explicitOnly": false
  },
  {
    "id": "tailrocks-repository-merge",
    "explicitOnly": true
  },
  {
    "id": "tailrocks-repository-recover",
    "explicitOnly": true
  },
  {
    "id": "tailrocks-review-pr",
    "explicitOnly": false
  }
]

export default Plugin.define({
  id: 'tailrocks-repository-skills',
  async setup(ctx) {
    const skills = await Promise.all(skillEntries.map(async ({ id, explicitOnly }) => {
      const url = new URL(`../../skills/${id}/SKILL.md`, import.meta.url)
      const path = fileURLToPath(url)
      const source = await readFile(url, 'utf8')
      const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
      if (!frontmatter) {
        throw new Error(`Missing YAML frontmatter in ${path}`)
      }

      const { name, description } = parse(frontmatter[1]) ?? {}
      if (name !== id || typeof description !== 'string' || !description.trim()) {
        throw new Error(`Invalid name or description in ${path}`)
      }

      return {
        id: Skill.ID.make(id),
        name: Skill.Name.make(name),
        description,
        path: Skill.Info.fields.path.make(path),
        content: source.slice(frontmatter[0].length),
        autoinvoke: !explicitOnly,
      }
    }))

    await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })
  },
})
