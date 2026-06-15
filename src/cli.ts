#!/usr/bin/env node
import { Effect } from "effect"
import { Cli, z } from "incur"
import { runtimeLayer } from "#/runtime-layer.js"
import {
	listFromUri,
	looksLikeUrl,
	readFromUri,
	resolveSource,
	searchAll,
} from "#/sources/registry.js"
import { runSearchPicker } from "#/tui/search-picker.js"
import { parse } from "#/uri.js"
import packageJson from "../package.json" with { type: "json" }

const cli = Cli.create("rskills", {
	description: packageJson.description,
	version: packageJson.version,
})

cli.command("read", {
	description: "Fetch a skill file and print to stdout",
	args: z.object({
		uri: z
			.string()
			.describe("URI to read (e.g. owner/repo/skill, github://owner/repo/path, or https://...)"),
	}),
	options: z.object({
		raw: z
			.boolean()
			.optional()
			.describe(
				"Return literal file content with no frontmatter stripped (for claude://, also skips !` shell execution)",
			),
	}),
	output: z.string(),
	async run(c) {
		const effect = Effect.gen(function* () {
			const parsed = yield* parse(c.args.uri)
			const readOptions = c.options.raw === true ? { raw: true } : undefined
			return yield* readFromUri(parsed, readOptions)
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
		query: z.string().optional().describe("Search query"),
	}),
	options: z.object({
		source: z.string().optional().describe("Source name"),
		limit: z.coerce.number().default(10).describe("Result limit"),
	}),
	output: z.object({
		results: z.array(
			z.object({
				identifier: z.string(),
				name: z.string(),
				installs: z.number().optional(),
				source: z.string(),
			}),
		),
	}),
	async run(c) {
		const query = c.args.query
		const limit = c.options.limit
		const sourceName = c.options.source

		const formatRequested =
			c.formatExplicit === true ||
			process.argv.some(
				(arg) => arg === "--json" || arg === "--format" || arg.startsWith("--format="),
			)
		const interactive =
			process.stdin.isTTY === true &&
			process.stdout.isTTY === true &&
			sourceName === undefined &&
			!formatRequested

		if (interactive) {
			await runSearchPicker({ initialQuery: query ?? "", limit })
			process.exit(0)
		}

		if (query === undefined) {
			throw new Error("search requires a query, e.g. `rskills search <query>`")
		}

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
				results: results
					.slice()
					.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0))
					.map((r) => ({
						identifier: r.identifier,
						name: r.name,
						source: r.scheme,
						...(r.installs !== undefined ? { installs: r.installs } : {}),
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
		uri: z
			.string()
			.describe(
				"URI to list (e.g. owner/repo/skill, github://owner/repo/path, or skills-sh://...)",
			),
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
