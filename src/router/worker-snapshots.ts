/**
 * Docker mechanics for CASCADE worker snapshots.
 *
 * Snapshot registry policy lives in snapshot-manager.ts; this module owns the
 * Docker operations needed to name, commit, inspect, and remove worker
 * containers/images during the post-exit lifecycle.
 */

import Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { registerSnapshot } from './snapshot-manager.js';

const docker = new Docker();

/**
 * Env-var keys that must NEVER be baked into a committed snapshot image.
 *
 * `docker commit` preserves the container's `Config.Env` (every `-e` from the
 * spawn) into the new image. Two problems if left unscrubbed:
 *
 *  1. **Correctness (ucho/MNG-1622 + MNG-1702).** A run that passes its payload
 *     INLINE bakes `JOB_DATA=<json>` into the snapshot. A later run for the same
 *     work item whose payload is large is OFFLOADED (only `JOB_DATA_REDIS_KEY`
 *     is set, not `JOB_DATA`), and `docker run -e JOB_DATA_REDIS_KEY=...` does
 *     not clear the baked `JOB_DATA`. The worker then read the stale baked
 *     payload and ran the wrong (prior) agent. The primary fix is worker-side
 *     (`resolveRawJobData` prefers the Redis key); stripping job env here removes
 *     the stale artifact at the source too.
 *  2. **Security.** The spawn env carries `DATABASE_URL`, `REDIS_URL`, the
 *     project's GitHub/Linear/OpenAI/etc. credentials, and the Claude OAuth
 *     token. Baking them means anyone with Docker/registry access to a
 *     `cascade-snapshot-*` image can read every project secret via
 *     `docker image inspect`.
 *
 * Static deny-set covers job + infra-secret keys; per-project credential names
 * are dynamic and enumerated at runtime from `CASCADE_CREDENTIAL_KEYS`.
 */
const SNAPSHOT_ENV_DENYLIST: ReadonlySet<string> = new Set([
	'JOB_DATA',
	'JOB_DATA_REDIS_KEY',
	'JOB_ID',
	'JOB_TYPE',
	'DATABASE_URL',
	'DATABASE_SSL',
	'DATABASE_CA_CERT',
	'REDIS_URL',
	'CREDENTIAL_MASTER_KEY',
	'CASCADE_CREDENTIAL_KEYS',
	'CLAUDE_CODE_OAUTH_TOKEN',
	'CASCADE_POSTGRES_HOST',
	'CASCADE_POSTGRES_PORT',
	'CASCADE_SNAPSHOT_REUSE',
	'CASCADE_SNAPSHOT_ENABLED',
]);

/** Parse the `KEY` out of a `KEY=VALUE` env line (split on the FIRST `=` only). */
function envKey(line: string): string {
	const eq = line.indexOf('=');
	return eq === -1 ? line : line.slice(0, eq);
}

/**
 * Filter a container's `Config.Env` down to what is safe to bake into a snapshot
 * image: drop the static deny-set plus every dynamic project-credential name
 * listed in `CASCADE_CREDENTIAL_KEYS`. Everything else (PATH, NODE_*, LOG_LEVEL,
 * SENTRY_*, PLAYWRIGHT_BROWSERS_PATH, CASCADE_DASHBOARD_URL, …) is PRESERVED so
 * the snapshot still boots. Pure and total; splits on the first `=` so JSON /
 * connection-string values containing `=` are handled.
 */
export function scrubSnapshotEnv(env: string[], extraCredentialKeys: string[] = []): string[] {
	const deny = new Set<string>(SNAPSHOT_ENV_DENYLIST);
	for (const k of extraCredentialKeys) {
		const trimmed = k.trim();
		if (trimmed) deny.add(trimmed);
	}
	return env.filter((line) => !deny.has(envKey(line)));
}

/** Extract the dynamic project-credential key names from a container's env. */
function extractCredentialKeys(env: string[]): string[] {
	const line = env.find((e) => e.startsWith('CASCADE_CREDENTIAL_KEYS='));
	if (!line) return [];
	return line
		.slice('CASCADE_CREDENTIAL_KEYS='.length)
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Commit `container` to `imageName` with its env scrubbed of job + secret vars.
 *
 * Inspects the container's live `Config`, removes deny-listed + credential keys
 * from `Config.Env`, and commits the scrubbed config into the new image
 * (docker-modem idiom: `_query` → querystring `container/repo/tag`, `_body` → the
 * raw POST body).
 *
 * Docker's `POST /commit` (ImageCommit) request body IS ITSELF a
 * `ContainerConfig`, and the daemon uses a NON-NIL body config as the new image's
 * COMPLETE runtime config — it does NOT merge it over the container's config
 * (moby `daemon/commit.go` only falls back to `container.Config` when the body
 * config is nil; `image.NewChildImage` assigns `Config: child.Config` with no
 * parent merge). So the body MUST be the full inspected config with only `Env`
 * replaced: `{ ...fullConfig, Env: scrubbed }` preserves `Cmd` (the worker
 * entrypoint), `WorkingDir` (`/app`), `User` (`node`), `Labels`, `ExposedPorts`,
 * etc. Passing only `{ Env: scrubbed }` would wipe all of them, and a REUSED
 * snapshot — which sets no explicit Cmd/WorkingDir/User at `createContainer`
 * (`worker-container-launcher.ts`) — would fail to launch ("No command
 * specified", root user, wrong cwd).
 *
 * `Env` is a TOP-LEVEL `ContainerConfig` field, NOT nested under `Config` (the
 * `{ Config: { Env } }` nesting is the inspect RESPONSE shape). Sourcing from the
 * container's own inspected config and only REMOVING env entries guarantees PATH
 * / PLAYWRIGHT_BROWSERS_PATH / NODE_* survive with their real values.
 *
 * If inspect fails or returns no env, falls back to a bare commit — the
 * config-PRESERVING form (nil body → daemon keeps the container's full config),
 * yielding an unscrubbed but working snapshot — and captures Sentry under
 * `snapshot_env_scrub_inspect_failed` so the regression to baking secrets is loud
 * rather than silent.
 */
async function commitScrubbed(
	container: Docker.Container,
	containerId: string,
	repo: string,
	imageName: string,
): Promise<void> {
	let fullConfig: (Record<string, unknown> & { Env?: string[] }) | undefined;
	try {
		const info = (await container.inspect()) as
			| { Config?: Record<string, unknown> & { Env?: string[] } }
			| undefined;
		fullConfig = info?.Config;
	} catch (inspectErr) {
		captureException(inspectErr, {
			tags: { source: 'snapshot_env_scrub_inspect_failed' },
			extra: { imageName },
			level: 'warning',
		});
	}

	const env = fullConfig?.Env;
	if (fullConfig && Array.isArray(env) && env.length > 0) {
		const scrubbed = scrubSnapshotEnv(env, extractCredentialKeys(env));
		// Spread the FULL inspected Config and replace only Env: the daemon uses a
		// non-nil commit body as the image's complete config (no merge), so passing
		// only { Env } would drop Cmd/WorkingDir/User/Labels and break snapshot
		// reuse. Env is a top-level ContainerConfig field, NOT nested under Config
		// (that is the inspect-response shape). See fn doc.
		await container.commit({
			_query: { container: containerId, repo, tag: 'latest' },
			_body: { ...fullConfig, Env: scrubbed },
		});
		logger.info('[WorkerManager] Snapshot committed with scrubbed env', {
			imageName,
			strippedKeys: env.length - scrubbed.length,
		});
		return;
	}

	// inspect unavailable / empty env → degrade to the prior bare-commit behavior.
	await container.commit({ repo, tag: 'latest' });
}

/**
 * Build a stable Docker image name for a snapshot.
 * Uses a sanitised project+workItem key so it's valid as a Docker image tag.
 */
export function buildWorkerSnapshotImageName(projectId: string, workItemId: string): string {
	// Sanitise: lowercase, replace non-alphanumeric with '-', collapse runs.
	const sanitise = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
	return `cascade-snapshot-${sanitise(projectId)}-${sanitise(workItemId)}:latest`;
}

/**
 * Inspect a snapshot image size without making snapshot registration depend on
 * Docker's image-inspect path. Missing size only affects max-size eviction; TTL
 * and max-count eviction still apply.
 */
async function inspectImageSizeBestEffort(imageName: string): Promise<number | undefined> {
	try {
		const image = docker.getImage(imageName);
		if (!image) return undefined;
		const info = (await image.inspect()) as { Size?: number } | undefined;
		return info?.Size;
	} catch {
		return undefined;
	}
}

/**
 * Commit a worker container to a snapshot image and register the resulting
 * metadata. Snapshot failures are intentionally non-fatal to the worker run.
 */
export async function commitWorkerSnapshot(
	containerId: string,
	projectId: string,
	workItemId: string,
): Promise<void> {
	const imageName = buildWorkerSnapshotImageName(projectId, workItemId);
	try {
		const container = docker.getContainer(containerId);
		await commitScrubbed(container, containerId, imageName.split(':')[0], imageName);
		const imageSize = await inspectImageSizeBestEffort(imageName);
		registerSnapshot(projectId, workItemId, imageName, imageSize);
		logger.info('[WorkerManager] Committed container to snapshot image:', {
			containerId: containerId.slice(0, 12),
			imageName,
			projectId,
			workItemId,
			imageSizeBytes: imageSize,
		});
	} catch (err) {
		logger.warn('[WorkerManager] Failed to commit container to snapshot (non-fatal):', {
			containerId: containerId.slice(0, 12),
			imageName,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'snapshot_commit' },
			extra: { containerId, imageName, projectId, workItemId },
			level: 'warning',
		});
	}
}

/**
 * Remove a worker container after a snapshot-enabled run. Snapshot containers
 * use AutoRemove=false so they remain available for diagnostics and commit.
 * Removal is best-effort because the container may already be gone.
 */
export async function removeWorkerContainerBestEffort(containerId: string): Promise<void> {
	try {
		const container = docker.getContainer(containerId);
		await container.remove({ force: true });
	} catch {
		// Container may already be removed — not an error.
	}
}

/**
 * Returns true when a Docker error indicates the requested image does not exist.
 * Uses dockerode's HTTP statusCode as the primary signal, with a substring check
 * on the message as a secondary guard.
 */
export function isImageNotFoundError(err: unknown): boolean {
	return (
		err != null &&
		typeof err === 'object' &&
		'statusCode' in err &&
		(err as { statusCode: unknown }).statusCode === 404 &&
		String(err).toLowerCase().includes('no such image')
	);
}

/** Default budget for an on-demand image pull triggered by base-image self-heal. */
export const IMAGE_PULL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Single-flight in-flight pull cache. A second caller for the same image while
 * the first pull is running awaits the same promise instead of triggering a
 * concurrent pull. The entry is cleared on settle so a subsequent prune still
 * triggers a fresh pull next time.
 */
const inFlightPulls = new Map<string, Promise<void>>();

/**
 * Pull a Docker image, deduplicating concurrent requests by image name and
 * enforcing a wall-clock timeout.
 *
 * Used by the spawn self-heal path in `container-manager.ts` when the base
 * worker image was pruned from the host between spawns. Failure cases:
 * - Pull stream emits an error → reject with that error.
 * - Pull exceeds `timeoutMs` → reject with a `pull timeout` error; the
 *   underlying stream is abandoned (no cancel hook in dockerode).
 * - Registry auth missing / network down → propagates the dockerode error;
 *   the caller still has the original 404 to re-throw.
 */
export function pullImageOnce(imageName: string, timeoutMs = IMAGE_PULL_TIMEOUT_MS): Promise<void> {
	const existing = inFlightPulls.get(imageName);
	if (existing) return existing;

	const promise = (async () => {
		const pullStream = (await docker.pull(imageName)) as NodeJS.ReadableStream;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`pull timeout after ${timeoutMs}ms for ${imageName}`));
			}, timeoutMs);
			docker.modem.followProgress(pullStream, (err: Error | null) => {
				clearTimeout(timer);
				if (err) reject(err);
				else resolve();
			});
		});
	})().finally(() => {
		inFlightPulls.delete(imageName);
	});

	inFlightPulls.set(imageName, promise);
	return promise;
}
