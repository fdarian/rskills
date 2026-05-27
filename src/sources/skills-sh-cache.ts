import { Context, Effect, Layer, Ref } from "effect"

export type ResolvedSkillRoot =
	| { readonly _tag: "BaseUrl"; readonly baseUrl: string }
	| { readonly _tag: "Content"; readonly content: string }

export class SkillsShCache extends Context.Tag("SkillsShCache")<
	SkillsShCache,
	Ref.Ref<Map<string, ResolvedSkillRoot>>
>() {}

export const SkillsShCacheLive = Layer.effect(
	SkillsShCache,
	Effect.gen(function* () {
		const ref = yield* Ref.make(new Map<string, ResolvedSkillRoot>())
		return SkillsShCache.of(ref)
	}),
)
