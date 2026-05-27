#!/usr/bin/env bun
import { FetchHttpClient } from "@effect/platform"
import { Effect, Layer } from "effect"
import { Cli, z } from "incur"
import {
	listFromUri,
	looksLikeUrl,
	readFromUri,
	resolveSource,
	searchAll,
} from "#/sources/registry.js"
import { SkillsShCacheLive } from "#/sources/skills-sh-cache.js"
import { parse } from "#/uri.js"

const runtimeLayer = Layer.merge(FetchHttpClient.layer, SkillsShCacheLive)

const cli = Cli.create("rskills", {
	description: "Read remote Anthropic-style skills without installing them",
	version: "0.1.0",
})

cli.command("read", {
	description: "Fetch a skill file and print to stdout",
	args: z.object({
		uri: z.string().describe("URI to read (e.g. github://owner/repo/path or https://...)"),
	}),
	output: z.string(),
	async run(c) {
		const effect = Effect.gen(function* () {
			const parsed = yield* parse(c.args.uri)
			return yield* readFromUri(parsed)
		})
		try {
			return await Effect.runPromise(effect.pipe(Effect.provide(runtimeLayer)))
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(message)
		}
	},
})

cli.command("search", {
	description: "Search skills across sources",
	args: z.object({
		query: z.string().describe("Search query"),
	}),
	options: z.object({
		source: z.string().optional().describe("Source name"),
		limit: z.coerce.number().default(10).describe("Result limit"),
	}),
	output: z.object({
		results: z.array(
			z.object({
				identifier: z.string(),
				description: z.string(),
				source: z.string(),
			}),
		),
	}),
	async run(c) {
		const query = c.args.query
		const limit = c.options.limit
		const sourceName = c.options.source

		const effect = Effect.gen(function* () {
			let results: Array<import("#/sources/source.js").SkillSearchResult>
			if (sourceName !== undefined) {
				if (sourceName === "well-known" && !looksLikeUrl(query)) {
					throw new Error("well-known search requires a URL or host as the query")
				}
				const source = yield* resolveSource(sourceName)
				if (source.search === undefined) {
					throw new Error(`Source "${sourceName}" does not support search`)
				}
				results = yield* source.search(query, limit)
			} else {
				results = yield* searchAll(query, limit)
			}
			return {
				results: results.map((r) => ({
					identifier: r.identifier,
					description: r.description,
					source: r.scheme,
				})),
			}
		})
		try {
			return await Effect.runPromise(effect.pipe(Effect.provide(runtimeLayer)))
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(message)
		}
	},
})

cli.command("ls", {
	description: "List entries in a skill directory",
	args: z.object({
		uri: z.string().describe("URI to list (e.g. github://owner/repo/path or skills-sh://...)"),
	}),
	output: z.object({
		entries: z.array(
			z.object({
				name: z.string(),
				type: z.enum(["file", "directory"]),
			}),
		),
	}),
	async run(c) {
		const effect = Effect.gen(function* () {
			const parsed = yield* parse(c.args.uri)
			const source = yield* resolveSource(parsed.scheme)
			if (source.list === undefined) {
				return yield* Effect.fail(new Error(`Source '${parsed.scheme}' does not support listing`))
			}
			const entries = yield* listFromUri(parsed)
			return { entries: entries as Array<{ name: string; type: "file" | "directory" }> }
		})
		try {
			return await Effect.runPromise(effect.pipe(Effect.provide(runtimeLayer)))
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(message)
		}
	},
})

// Incur's serve() treats the first two argv tokens as runtime+script.
// When run via `bun run src/cli.ts`, argv[0] is the script path and must be stripped.
const argv = process.argv.slice(2)
const cleanArgv =
	argv[0] !== undefined && (argv[0].endsWith(".ts") || argv[0].endsWith(".js"))
		? argv.slice(1)
		: argv

cli.serve(cleanArgv)
