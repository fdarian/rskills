import { Context, Effect, Layer, Ref } from "effect"

export class SkillsShCache extends Context.Tag("SkillsShCache")<
	SkillsShCache,
	Ref.Ref<Map<string, string>>
>() {}

export const SkillsShCacheLive = Layer.effect(
	SkillsShCache,
	Effect.gen(function* () {
		const ref = yield* Ref.make(new Map<string, string>())
		return SkillsShCache.of(ref)
	}),
)
