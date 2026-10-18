import { Effect, Option } from "effect"
import { stripFrontmatter } from "#/frontmatter.js"
import { resolveSelector, selectSkill } from "#/select.js"
import { parseSource } from "#/source.js"
import { discoverSkills } from "#/sources/registry.js"
import type { SkillEntry } from "#/sources/source.js"

export interface ReadSkillRequest {
	readonly source: string
	readonly skill: Option.Option<string>
	readonly file: Option.Option<string>
	readonly raw: boolean
}

export interface ListSkillRequest {
	readonly source: string
	readonly skill: Option.Option<string>
	/** Directory inside the skill; none lists the skill directory. */
	readonly file: Option.Option<string>
}

export const readSkill = Effect.fn("readSkill")(function* (request: ReadSkillRequest) {
	const source = yield* parseSource(request.source)
	const selector = yield* resolveSelector(source, request.skill)
	const skills = yield* discoverSkills(source, selector)
	const skill = yield* selectSkill(skills, selector)
	const content = yield* skill.read(request.file, { raw: request.raw })
	return request.raw ? content : stripFrontmatter(content)
})

export const listSkill = Effect.fn("listSkill")(function* (request: ListSkillRequest) {
	const source = yield* parseSource(request.source)
	const selector = yield* resolveSelector(source, request.skill)
	const skills = yield* discoverSkills(source, selector)
	// Unlike `read`, listing a multi-skill source is meaningful: show which skills it holds.
	if (Option.isNone(selector) && Option.isNone(request.file) && skills.length > 1) {
		return skills.map((skill): SkillEntry => ({ name: skill.name, type: "directory" }))
	}
	const skill = yield* selectSkill(skills, selector)
	return yield* skill.list(request.file)
})
