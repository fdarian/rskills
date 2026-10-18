import { NodeServices } from "@effect/platform-node"
import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"

export const runtimeLayer = Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer)

export const makeAppRuntime = () => ManagedRuntime.make(runtimeLayer)

export type AppRuntime = ReturnType<typeof makeAppRuntime>
