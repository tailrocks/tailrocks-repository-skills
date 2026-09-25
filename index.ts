import type { PluginAPI } from '@ampcode/plugin'

export default async function (amp: PluginAPI) {
	await amp.registerSkill({ path: 'skills/tailrocks-create-pr' })
	await amp.registerSkill({ path: 'skills/tailrocks-refresh-pr' })
	await amp.registerSkill({ path: 'skills/tailrocks-review-pr' })
	await amp.registerSkill({ path: 'skills/tailrocks-merge-pr' })
	await amp.registerSkill({ path: 'skills/tailrocks-document' })
	await amp.registerSkill({ path: 'skills/tailrocks-pr-template' })
	await amp.registerSkill({ path: 'skills/tailrocks-repository-audit' })
	await amp.registerSkill({ path: 'skills/tailrocks-repository-cleanup' })
	await amp.registerSkill({ path: 'skills/tailrocks-repository-merge' })
}
