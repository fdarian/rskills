import { Effect } from "effect"
import { NotFound } from "#/errors.js"
import { extractInstallCommand } from "#/sources/skills-sh.js"

/** Fetch the `npx skills add …` install command for a skill id (owner/repo/skillId). */
export const getInstallCommand = Effect.fn("getInstallCommand")(function* (id: string) {
	const segments = id.split("/").filter((s) => s.length > 0)
	const owner = segments[0]
	const repo = segments[1]
	if (owner === undefined || repo === undefined || segments.length < 3) {
		return yield* new NotFound({
			message: `Cannot derive skill coordinates from "${id}"`,
		})
	}
	const skillId = segments.slice(2).join("/")
	const command = yield* extractInstallCommand(owner, repo, skillId)
	if (command === null) {
		return yield* new NotFound({
			message: `No install command found on skills.sh for ${id}`,
		})
	}
	return command
})
