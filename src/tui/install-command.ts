import { Effect } from "effect"
import { NotFound } from "#/errors.js"

/** Build the `npx skills add …` install command for a skill id (owner/repo/skillId). */
export const getInstallCommand = Effect.fn("getInstallCommand")(function* (id: string) {
	const segments = id.split("/").filter((s) => s.length > 0)
	const owner = segments[0]
	const repo = segments[1]
	if (owner === undefined || repo === undefined || segments.length < 3) {
		return yield* new NotFound({
			message: `Cannot derive skill coordinates from "${id}"`,
		})
	}
	return `npx skills add ${owner}/${repo} --skill ${segments.slice(2).join("/")}`
})
