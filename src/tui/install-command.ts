import { parseSkillIdentifier } from "#/sources/skills-sh.js"

/** Build the `npx skills add …` install command for a search identifier. */
export function getInstallCommand(identifier: string) {
	const parsed = parseSkillIdentifier(identifier)
	const source = parsed.source.includes("/") ? parsed.source : `https://${parsed.source}`
	return `npx skills add ${source} --skill ${parsed.skillId}`
}
