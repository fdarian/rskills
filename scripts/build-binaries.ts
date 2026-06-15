import { mkdirSync } from "node:fs"
import { devtoolsStubPlugin } from "./devtools-stub-plugin"

mkdirSync("dist/bin", { recursive: true })

/** Cross-compile targets paired with their output filenames */
const targets: Array<{ target: Bun.Build.CompileTarget; outfile: string }> = [
	{ target: "bun-darwin-arm64", outfile: "dist/bin/rskills-darwin-arm64" },
	{ target: "bun-darwin-x64", outfile: "dist/bin/rskills-darwin-x64" },
	{ target: "bun-linux-x64", outfile: "dist/bin/rskills-linux-x64" },
	{ target: "bun-linux-arm64", outfile: "dist/bin/rskills-linux-arm64" },
]

for (const entry of targets) {
	console.log(`Building ${entry.target}`)

	const result = await Bun.build({
		entrypoints: ["src/cli.ts"],
		plugins: [devtoolsStubPlugin],
		compile: {
			target: entry.target,
			outfile: entry.outfile,
		},
	})

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log)
		}
		throw new Error(`Bun.build failed for target '${entry.target}'`)
	}

	const output = result.outputs[0]
	if (output === undefined) {
		throw new Error(`No output produced for target '${entry.target}'`)
	}

	console.log(`Built ${entry.outfile} (${(output.size / 1024 / 1024).toFixed(2)} MB)`)
}
