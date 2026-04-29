/**
 * Coalesce window configuration for PM status-change webhook dispatches.
 *
 * Reads `PM_COALESCE_WINDOW_MS` (or the legacy `PM_CREATE_COALESCE_WINDOW_MS`
 * for backward compatibility). Default: 10 000 ms (10 s).
 *
 * Setting the env var to `0` disables coalescing entirely — all PM events are
 * dispatched immediately without any delay-based deduplication.
 */
export function getCoalesceWindowMs(): number {
	const raw = process.env.PM_COALESCE_WINDOW_MS ?? process.env.PM_CREATE_COALESCE_WINDOW_MS;
	if (raw === undefined) return 10_000;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return 10_000;
	return n;
}
