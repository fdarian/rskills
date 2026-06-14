import { mkdirSync } from "node:fs"

const targets = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64", "bun-linux-arm64"]

mkdirSync("dist/bin", { recursive: true })

for (const target of targets) {
	const outputName = target.slice("bun-".length)
	console.log(`Building ${target}`)

	const buildProcess = Bun.spawnSync(
		[
			"bun",
			"build",
			"src/cli.ts",
			"--compile",
			"--bytecode",
			`--target=${target}`,
			`--outfile=dist/bin/rskills-${outputName}`,
		],
		{
			stdout: "inherit",
			stderr: "inherit",
		},
	)

	if (buildProcess.exitCode !== 0) {
		throw new Error(
			`bun build failed for target '${target}' with exit code ${buildProcess.exitCode}`,
		)
	}
}
