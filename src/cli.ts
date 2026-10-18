#!/usr/bin/env node
import { Effect, Option } from "effect"
import { Cli, z } from "incur"
import { runtimeLayer } from "#/runtime-layer.js"
import { listSkill, readSkill } from "#/skills.js"
import { searchSkillsSh } from "#/sources/skills-sh.js"
import { runSearchPicker } from "#/tui/search-picker.js"
import packageJson from "../package.json" with { type: "json" }

const cli = Cli.create("rskills", {
	description: packageJson.description,
	version: packageJson.version,
})

const sourceArg = z
	.string()
	.describe(
		"owner/repo[/path][@skill], a GitHub URL, a site URL (well-known index), a local path, or claude://<name>",
	)
const skillOption = z.string().optional().describe("Skill name, when the source contains several")

cli.command("read", {
	description: "Fetch a skill file and print to stdout",
	args: z.object({ source: sourceArg }),
	options: z.object({
		skill: skillOption,
		file: z
			.string()
			.optional()
			.describe("File inside the skill to read (default SKILL.md), e.g. references/foo.md"),
		raw: z
			.boolean()
			.optional()
			.describe(
				"Return literal file content with no frontmatter stripped (for claude://, also skips !` shell execution)",
			),
	}),
	output: z.string(),
	async run(c) {
		const effect = readSkill({
			source: c.args.source,
			skill: Option.fromNullishOr(c.options.skill),
			file: Option.fromNullishOr(c.options.file),
			raw: c.options.raw === true,
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

		const formatRequested =
			c.formatExplicit === true ||
			process.argv.some(
				(arg) => arg === "--json" || arg === "--format" || arg.startsWith("--format="),
			)
		const interactive =
			process.stdin.isTTY === true && process.stdout.isTTY === true && !formatRequested

		if (interactive) {
			await runSearchPicker({ initialQuery: query ?? "", limit })
			process.exit(0)
		}

		if (query === undefined) {
			throw new Error("search requires a query, e.g. `rskills search <query>`")
		}

		const effect = Effect.gen(function* () {
			const results = yield* searchSkillsSh(query, limit)
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
	args: z.object({ source: sourceArg }),
	options: z.object({
		skill: skillOption,
		file: z.string().optional().describe("Directory inside the skill to list, e.g. references"),
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
		const effect = listSkill({
			source: c.args.source,
			skill: Option.fromNullishOr(c.options.skill),
			file: Option.fromNullishOr(c.options.file),
		}).pipe(Effect.map((entries) => ({ entries: [...entries] })))
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
