/** Humanize an install count: 447985 -> "448k", 1795 -> "1.8k", 999 -> "999". */
export function humanizeInstalls(installs: number) {
	if (installs < 1000) {
		return String(installs)
	}
	if (installs < 1_000_000) {
		const thousands = installs / 1000
		return thousands < 10 ? `${thousands.toFixed(1)}k` : `${Math.round(thousands)}k`
	}
	const millions = installs / 1_000_000
	return millions < 10 ? `${millions.toFixed(1)}m` : `${Math.round(millions)}m`
}
