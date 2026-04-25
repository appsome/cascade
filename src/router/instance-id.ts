/**
 * Stable identifier for this cascade-router process. Used to:
 *
 * - **Tag spawned worker containers** with a `cascade.router.instance`
 *   Docker label (see `container-manager.ts`).
 * - **Scope the periodic orphan-cleanup scan** to containers carrying
 *   THIS instance's id (see `orphan-cleanup.ts`).
 *
 * Without this, two cascade-router instances on the same host (prod +
 * dev, two local-dev sandboxes, k8s replicas pre-this-change) would
 * each treat the other's worker containers as orphans and silently
 * `docker stop` them at the 30-min `workerTimeoutMs` mark — surfacing
 * downstream as `exit 137 · OOMKilled=false` agent runs that everyone
 * blamed on memory.
 *
 * Resolution order:
 *   1. `process.env.CASCADE_ROUTER_INSTANCE` (trimmed) — explicit
 *      override for the rare case where two instances share a hostname
 *      (e.g. local docker with `--network host`).
 *   2. `os.hostname()` — Docker injects the container's short id here
 *      by default, which is per-container unique and stable across the
 *      cascade-router process's lifetime. This is the normal path.
 *
 * Memoised at module load. The pure resolver is exported for direct
 * unit testing.
 */
import os from 'node:os';

export function resolveRouterInstanceId(
	env: NodeJS.ProcessEnv | Record<string, string | undefined>,
	hostname: string,
): string {
	const fromEnv = env.CASCADE_ROUTER_INSTANCE?.trim();
	if (fromEnv) return fromEnv;
	const fromHost = hostname.trim();
	if (fromHost) return fromHost;
	throw new Error(
		'Cannot resolve router instance id: both CASCADE_ROUTER_INSTANCE and os.hostname() are empty. ' +
			'Set CASCADE_ROUTER_INSTANCE explicitly to disambiguate this cascade-router instance.',
	);
}

export const ROUTER_INSTANCE_ID = resolveRouterInstanceId(process.env, os.hostname());
