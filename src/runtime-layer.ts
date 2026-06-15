import { FetchHttpClient } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { Layer, ManagedRuntime } from "effect"
import { SkillsShCacheLive } from "#/sources/skills-sh-cache.js"

export const runtimeLayer = Layer.mergeAll(
	FetchHttpClient.layer,
	SkillsShCacheLive,
	NodeContext.layer,
)

export const makeAppRuntime = () => ManagedRuntime.make(runtimeLayer)

export type AppRuntime = ReturnType<typeof makeAppRuntime>
