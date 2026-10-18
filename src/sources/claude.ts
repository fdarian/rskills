import { homedir } from "node:os"
import { Path } from "@effect/platform"
import { Effect } from "effect"
import { NotFound } from "#/errors.js"
import type { SourceOf } from "#/source.js"
import { preprocessClaudeSkillContent } from "./claude-preprocess.js"
import { isDirectory, listUnder, readFileUnder } from "./local-fs.js"
import type { SkillSource } from "./source.js"

// Plugin roots (~/.claude/plugins/**/skills/) and a project/user namespace
// disambiguator (`claude://user/<name>`) are possible future additions.

export const ClaudeSource: SkillSource<SourceOf<"Claude">> = {
	discover: Effect.fn("ClaudeSource.discover")(function* (source: SourceOf<"Claude">) {
		const path = yield* Path.Path
		const roots = [
			path.join(process.cwd(), ".claude", "skills"),
			path.join(homedir(), ".claude", "skills"),
		]
		const probed: Array<string> = []
		for (const root of roots) {
			const skillDir = path.join(root, source.name)
			probed.push(skillDir)
			if (!(yield* isDirectory(skillDir))) {
				continue
			}
			return [
				{
					name: source.name,
					read: (file, options) =>
						readFileUnder(skillDir, file).pipe(
							Effect.flatMap((content) => preprocessClaudeSkillContent(content, options)),
						),
					list: (dir) => listUnder(skillDir, dir),
				},
			]
		}
		return yield* new NotFound({
			message: `Skill not found: ${source.name}. Probed:\n${probed.map((p) => `  - ${p}`).join("\n")}`,
		})
	}),
}
