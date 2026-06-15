import { mkdirSync } from "node:fs"
import { devtoolsStubPlugin } from "./devtools-stub-plugin"

mkdirSync("dist", { recursive: true })

const result = await Bun.build({
	entrypoints: ["src/cli.ts"],
	outdir: "dist",
	naming: "cli.js",
	target: "node",
	plugins: [devtoolsStubPlugin],
})

if (!result.success) {
	for (const log of result.logs) {
		console.error(log)
	}
	process.exit(1)
}

const output = result.outputs[0]
if (output === undefined) {
	console.error("No output produced")
	process.exit(1)
}

console.log(`Built ${output.path} (${(output.size / 1024 / 1024).toFixed(2)} MB)`)
