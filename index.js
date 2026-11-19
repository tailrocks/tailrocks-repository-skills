// Native Amp directory plugin for tailrocks-repository-skills.
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

export default async function (amp) {
  for (const { id, explicitOnly } of skillEntries) {
    await amp.registerSkill({ path: `skills/${id}`, listed: !explicitOnly })
  }
}
