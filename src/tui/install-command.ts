import { parseSkillIdentifier } from "#/sources/skills-sh.js"

/** Build the `npx skills add …` install command for an `owner/repo@skillId` identifier. */
export function getInstallCommand(identifier: string) {
	const parsed = parseSkillIdentifier(identifier)
	return `npx skills add ${parsed.source} --skill ${parsed.skillId}`
}
