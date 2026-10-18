import { FetchHttpClient } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { Layer, ManagedRuntime } from "effect"

export const runtimeLayer = Layer.mergeAll(FetchHttpClient.layer, NodeContext.layer)

export const makeAppRuntime = () => ManagedRuntime.make(runtimeLayer)

export type AppRuntime = ReturnType<typeof makeAppRuntime>
