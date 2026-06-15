/** Humanize an install count: 2000000 -> "2.0M", 447985 -> "448K", 1795 -> "1.8K", 999 -> "999". */
export function humanizeInstalls(installs: number) {
	if (installs < 1000) {
		return String(installs)
	}
	if (installs < 1_000_000) {
		const thousands = installs / 1000
		return thousands < 10 ? `${thousands.toFixed(1)}K` : `${Math.round(thousands)}K`
	}
	const millions = installs / 1_000_000
	return millions < 10 ? `${millions.toFixed(1)}M` : `${Math.round(millions)}M`
}
