import { Effect, Option } from "effect"
import { InvalidArgument, NotFound } from "#/errors.js"
import type { Source } from "#/source.js"
import type { DiscoveredSkill } from "#/sources/source.js"

/** Merges the `@skill` suffix of a source with the `--skill` option into one selector. */
export function resolveSelector(
	source: Source,
	option: Option.Option<string>,
): Effect.Effect<Option.Option<string>, InvalidArgument> {
	const fromSource = source._tag === "GitHub" ? source.skill : Option.none()
	if (Option.isSome(option) && (source._tag === "Url" || source._tag === "Claude")) {
		return Effect.fail(
			new InvalidArgument({
				message: `--skill is not supported for ${source._tag === "Url" ? "https://…/*.md" : "claude://"} sources: they are a single skill`,
			}),
		)
	}
	if (
		Option.isSome(fromSource) &&
		Option.isSome(option) &&
		fromSource.value.toLowerCase() !== option.value.toLowerCase()
	) {
		return Effect.fail(
			new InvalidArgument({
				message: `Conflicting skills: source says "@${fromSource.value}" but --skill is "${option.value}"`,
			}),
		)
	}
	return Effect.succeed(Option.isSome(option) ? option : fromSource)
}

const names = (skills: ReadonlyArray<DiscoveredSkill>) =>
	skills.map((skill) => `  - ${skill.name}`).join("\n")

export function selectSkill(
	skills: ReadonlyArray<DiscoveredSkill>,
	selector: Option.Option<string>,
): Effect.Effect<DiscoveredSkill, NotFound | InvalidArgument> {
	if (Option.isSome(selector)) {
		const match = skills.find((skill) => skill.name.toLowerCase() === selector.value.toLowerCase())
		if (match !== undefined) {
			return Effect.succeed(match)
		}
		return Effect.fail(
			new NotFound({
				message:
					skills.length === 0
						? `Skill "${selector.value}" not found: source contains no skills`
						: `Skill "${selector.value}" not found. Available skills:\n${names(skills)}`,
			}),
		)
	}
	const only = skills[0]
	if (only === undefined) {
		return Effect.fail(new NotFound({ message: "No skills found in source" }))
	}
	if (skills.length > 1) {
		return Effect.fail(
			new InvalidArgument({
				message: `Source contains multiple skills; pass --skill <name>. Available skills:\n${names(skills)}`,
			}),
		)
	}
	return Effect.succeed(only)
}
