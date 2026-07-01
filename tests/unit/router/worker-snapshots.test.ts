import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockCaptureException,
	mockContainerCommit,
	mockContainerInspect,
	mockContainerRemove,
	mockDockerGetContainer,
	mockDockerGetImage,
	mockDockerPull,
	mockFollowProgress,
	mockImageInspect,
	mockLoggerWarn,
	mockRegisterSnapshot,
} = vi.hoisted(() => ({
	mockCaptureException: vi.fn(),
	mockContainerCommit: vi.fn(),
	mockContainerInspect: vi.fn(),
	mockContainerRemove: vi.fn(),
	mockDockerGetContainer: vi.fn(),
	mockDockerGetImage: vi.fn(),
	mockDockerPull: vi.fn(),
	mockFollowProgress: vi.fn(),
	mockImageInspect: vi.fn(),
	mockLoggerWarn: vi.fn(),
	mockRegisterSnapshot: vi.fn(),
}));

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getContainer: mockDockerGetContainer,
		getImage: mockDockerGetImage,
		pull: mockDockerPull,
		modem: { followProgress: mockFollowProgress },
	})),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: (...args: unknown[]) => mockLoggerWarn(...args),
	},
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	registerSnapshot: (...args: unknown[]) => mockRegisterSnapshot(...args),
}));

import {
	buildWorkerSnapshotImageName,
	commitWorkerSnapshot,
	isImageNotFoundError,
	pullImageOnce,
	removeWorkerContainerBestEffort,
	scrubSnapshotEnv,
} from '../../../src/router/worker-snapshots.js';

describe('worker-snapshots', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockContainerCommit.mockResolvedValue(undefined);
		mockContainerRemove.mockResolvedValue(undefined);
		mockImageInspect.mockResolvedValue({ Size: 1_234_567_890 });
		// Container inspect returns the live Config.Env that docker commit would
		// otherwise bake verbatim — a mix of safe (PATH) + job + secret vars.
		mockContainerInspect.mockResolvedValue({
			Config: {
				Env: [
					'PATH=/usr/local/bin',
					'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
					'JOB_DATA={"triggerResult":{"agentType":"planning"}}',
					'JOB_DATA_REDIS_KEY=cascade:jobdata:x',
					'JOB_ID=job-1',
					'JOB_TYPE=linear',
					'DATABASE_URL=postgres://secret',
					'REDIS_URL=redis://secret',
					'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-x',
					'CASCADE_CREDENTIAL_KEYS=GITHUB_TOKEN_IMPLEMENTER,LINEAR_API_KEY',
					'GITHUB_TOKEN_IMPLEMENTER=ghp_x',
					'LINEAR_API_KEY=lin_y',
					'SENTRY_DSN=https://sentry',
				],
			},
		});
		mockDockerGetContainer.mockReturnValue({
			commit: mockContainerCommit,
			inspect: mockContainerInspect,
			remove: mockContainerRemove,
		});
		mockDockerGetImage.mockReturnValue({
			inspect: mockImageInspect,
		});
	});

	it('preserves the existing snapshot image-name sanitization format', () => {
		expect(buildWorkerSnapshotImageName('Proj Snap', 'MNG_652/Worker Snapshot!')).toBe(
			'cascade-snapshot-proj-snap-mng-652-worker-snapshot:latest',
		);
		expect(buildWorkerSnapshotImageName('--LLMIST--', 'MNG---95')).toBe(
			'cascade-snapshot-llmist-mng-95:latest',
		);
	});

	// Behavior intentionally changed (ucho/MNG-1622 + MNG-1702 + security): commit
	// now inspects the container and bakes a SCRUBBED Config.Env (docker-modem
	// _query/_body idiom) instead of the container's raw env, so no stale JOB_DATA
	// or plaintext secret survives into the snapshot image.
	it('commits with a scrubbed Config.Env, inspects image size, and registers metadata', async () => {
		await commitWorkerSnapshot('container-snap-abc123', 'proj-snap', 'card-snap');

		expect(mockDockerGetContainer).toHaveBeenCalledWith('container-snap-abc123');
		expect(mockContainerInspect).toHaveBeenCalled();
		expect(mockContainerCommit).toHaveBeenCalledTimes(1);
		const commitArg = mockContainerCommit.mock.calls[0][0] as {
			_query: Record<string, string>;
			_body: { Env: string[] };
		};
		expect(commitArg._query).toEqual({
			container: 'container-snap-abc123',
			repo: 'cascade-snapshot-proj-snap-card-snap',
			tag: 'latest',
		});
		// ImageCommit request body IS a ContainerConfig → Env is top-level, NOT
		// nested under Config (that is the inspect-response shape). A nested Config
		// would be silently dropped by Docker, baking the raw (unscrubbed) env.
		const bakedEnv = commitArg._body.Env;
		// Safe vars preserved with real values…
		expect(bakedEnv).toContain('PATH=/usr/local/bin');
		expect(bakedEnv).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
		expect(bakedEnv).toContain('SENTRY_DSN=https://sentry');
		// …job + secret vars stripped.
		const bakedKeys = bakedEnv.map((e) => e.split('=')[0]);
		for (const forbidden of [
			'JOB_DATA',
			'JOB_DATA_REDIS_KEY',
			'JOB_ID',
			'JOB_TYPE',
			'DATABASE_URL',
			'REDIS_URL',
			'CLAUDE_CODE_OAUTH_TOKEN',
			'CASCADE_CREDENTIAL_KEYS',
			'GITHUB_TOKEN_IMPLEMENTER',
			'LINEAR_API_KEY',
		]) {
			expect(bakedKeys).not.toContain(forbidden);
		}
		expect(mockDockerGetImage).toHaveBeenCalledWith('cascade-snapshot-proj-snap-card-snap:latest');
		expect(mockRegisterSnapshot).toHaveBeenCalledWith(
			'proj-snap',
			'card-snap',
			'cascade-snapshot-proj-snap-card-snap:latest',
			1_234_567_890,
		);
	});

	it('falls back to a bare commit and captures Sentry when container inspect fails', async () => {
		mockContainerInspect.mockRejectedValueOnce(new Error('inspect boom'));

		await commitWorkerSnapshot('container-snap-abc123', 'proj-snap', 'card-snap');

		// Bare commit preserves the prior behavior (working, if unscrubbed, snapshot)…
		expect(mockContainerCommit).toHaveBeenCalledWith({
			repo: 'cascade-snapshot-proj-snap-card-snap',
			tag: 'latest',
		});
		// …but the scrub failure is loud, not silent.
		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: { source: 'snapshot_env_scrub_inspect_failed' } }),
		);
		expect(mockRegisterSnapshot).toHaveBeenCalled();
	});

	it('still registers snapshot metadata when image-size inspection fails', async () => {
		mockImageInspect.mockRejectedValueOnce(new Error('inspect failed'));

		await commitWorkerSnapshot('container-snap-abc123', 'proj-snap', 'card-snap');

		expect(mockRegisterSnapshot).toHaveBeenCalledWith(
			'proj-snap',
			'card-snap',
			'cascade-snapshot-proj-snap-card-snap:latest',
			undefined,
		);
	});

	it('swallows commit errors and reports them as non-fatal snapshot failures', async () => {
		const err = new Error('commit failed');
		mockContainerCommit.mockRejectedValueOnce(err);

		await expect(
			commitWorkerSnapshot('container-snap-abc123', 'proj-snap', 'card-snap'),
		).resolves.toBeUndefined();

		expect(mockRegisterSnapshot).not.toHaveBeenCalled();
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			'[WorkerManager] Failed to commit container to snapshot (non-fatal):',
			expect.objectContaining({
				containerId: 'container-sn',
				imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
				error: 'Error: commit failed',
			}),
		);
		expect(mockCaptureException).toHaveBeenCalledWith(
			err,
			expect.objectContaining({
				tags: { source: 'snapshot_commit' },
				level: 'warning',
			}),
		);
	});

	it('removes worker containers best-effort', async () => {
		await removeWorkerContainerBestEffort('container-snap-abc123');

		expect(mockDockerGetContainer).toHaveBeenCalledWith('container-snap-abc123');
		expect(mockContainerRemove).toHaveBeenCalledWith({ force: true });
	});

	it('swallows remove errors', async () => {
		mockContainerRemove.mockRejectedValueOnce(new Error('already gone'));

		await expect(removeWorkerContainerBestEffort('container-snap-abc123')).resolves.toBeUndefined();
	});

	it('identifies docker image-not-found errors only for 404 no-such-image responses', () => {
		expect(
			isImageNotFoundError(
				Object.assign(new Error('(HTTP code 404) no such container - No such image: x'), {
					statusCode: 404,
				}),
			),
		).toBe(true);
		expect(
			isImageNotFoundError(Object.assign(new Error('No such image: x'), { statusCode: 500 })),
		).toBe(false);
		expect(isImageNotFoundError(Object.assign(new Error('not found'), { statusCode: 404 }))).toBe(
			false,
		);
	});
});

describe('scrubSnapshotEnv', () => {
	it('strips per-job env (JOB_DATA and friends) but preserves safe vars', () => {
		const out = scrubSnapshotEnv([
			'PATH=/usr/bin',
			'JOB_DATA={"a":1}',
			'JOB_DATA_REDIS_KEY=cascade:jobdata:x',
			'JOB_ID=x',
			'JOB_TYPE=linear',
			'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
		]);
		expect(out).toEqual(['PATH=/usr/bin', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright']);
	});

	it('strips infra secrets but keeps observability/config vars', () => {
		const out = scrubSnapshotEnv([
			'DATABASE_URL=postgres://s',
			'REDIS_URL=redis://s',
			'CREDENTIAL_MASTER_KEY=deadbeef',
			'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-x',
			'SENTRY_DSN=https://sentry',
			'CASCADE_DASHBOARD_URL=https://dash',
			'LOG_LEVEL=info',
		]);
		expect(out.map((e) => e.split('=')[0])).toEqual([
			'SENTRY_DSN',
			'CASCADE_DASHBOARD_URL',
			'LOG_LEVEL',
		]);
	});

	it('strips dynamic project credentials named in extraCredentialKeys (and CASCADE_CREDENTIAL_KEYS itself)', () => {
		const out = scrubSnapshotEnv(
			[
				'CASCADE_CREDENTIAL_KEYS=GITHUB_TOKEN_IMPLEMENTER,LINEAR_API_KEY',
				'GITHUB_TOKEN_IMPLEMENTER=ghp_x',
				'LINEAR_API_KEY=lin_y',
				'PATH=/bin',
			],
			['GITHUB_TOKEN_IMPLEMENTER', 'LINEAR_API_KEY'],
		);
		expect(out).toEqual(['PATH=/bin']);
	});

	it('splits on the FIRST = so credential values containing = are stripped by key', () => {
		const out = scrubSnapshotEnv(
			['CODEX_AUTH_JSON={"token":"a=b=c"}', 'PATH=/bin'],
			['CODEX_AUTH_JSON'],
		);
		expect(out).toEqual(['PATH=/bin']);
	});

	it('handles env lines with no = (treats the whole string as the key)', () => {
		expect(scrubSnapshotEnv(['JOB_DATA', 'BARE_FLAG', 'PATH=/bin'])).toEqual([
			'BARE_FLAG',
			'PATH=/bin',
		]);
	});
});

// Spec: pullImageOnce backs the spawn self-heal in container-manager.ts.
// Single-flight + timeout are non-negotiable: without the in-flight cache,
// every queued job under a missing-image outage races its own multi-GB pull.
describe('pullImageOnce', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDockerPull.mockResolvedValue({} as never);
		mockFollowProgress.mockImplementation(((_stream: unknown, cb: (err: Error | null) => void) =>
			cb(null)) as never);
	});

	it('resolves when the pull stream completes without error', async () => {
		await expect(pullImageOnce('img:latest')).resolves.toBeUndefined();
		expect(mockDockerPull).toHaveBeenCalledWith('img:latest');
		expect(mockFollowProgress).toHaveBeenCalledTimes(1);
	});

	it('rejects when the pull stream emits an error', async () => {
		const err = new Error('manifest denied');
		mockFollowProgress.mockImplementation(((_stream: unknown, cb: (err: Error | null) => void) =>
			cb(err)) as never);
		await expect(pullImageOnce('img:latest')).rejects.toThrow('manifest denied');
	});

	it('rejects with a pull-timeout error when the stream never completes', async () => {
		mockFollowProgress.mockImplementation((() => {
			// Never invoke the callback — exercise the timeout race.
		}) as never);
		await expect(pullImageOnce('img:latest', 30)).rejects.toThrow(/pull timeout after 30ms/);
	});

	it('deduplicates concurrent calls for the same image (single-flight)', async () => {
		let fire!: () => void;
		mockFollowProgress.mockImplementation(((_stream: unknown, cb: (err: Error | null) => void) => {
			fire = () => cb(null);
		}) as never);
		const p1 = pullImageOnce('img:latest');
		const p2 = pullImageOnce('img:latest');
		// pullImageOnce awaits docker.pull before reaching followProgress; flush
		// microtasks so the deferred-fire callback is captured before we trigger it.
		await new Promise((r) => setTimeout(r, 0));
		fire();
		await Promise.all([p1, p2]);
		expect(mockDockerPull).toHaveBeenCalledTimes(1);
		expect(mockFollowProgress).toHaveBeenCalledTimes(1);
	});

	it('does NOT deduplicate calls for different images', async () => {
		await Promise.all([pullImageOnce('a:latest'), pullImageOnce('b:latest')]);
		expect(mockDockerPull).toHaveBeenCalledTimes(2);
		expect(mockDockerPull).toHaveBeenNthCalledWith(1, 'a:latest');
		expect(mockDockerPull).toHaveBeenNthCalledWith(2, 'b:latest');
	});

	it('clears the in-flight cache after settling so the next call pulls fresh', async () => {
		await pullImageOnce('img:latest');
		await pullImageOnce('img:latest');
		expect(mockDockerPull).toHaveBeenCalledTimes(2);
	});
});
