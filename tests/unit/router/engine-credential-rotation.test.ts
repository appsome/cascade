import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadProjectConfig, mockResolveCredentialPool, mockFetchLimits, mockRouterConfig } =
	vi.hoisted(() => ({
		mockLoadProjectConfig: vi.fn(),
		mockResolveCredentialPool: vi.fn(),
		mockFetchLimits: vi.fn(),
		mockRouterConfig: { rotationUtilizationThreshold: 95 },
	}));

vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: mockLoadProjectConfig,
	routerConfig: mockRouterConfig,
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveCredentialPool: mockResolveCredentialPool,
}));

vi.mock('../../../src/anthropic/client.js', () => ({
	fetchClaudeSubscriptionLimits: mockFetchLimits,
}));

import { resolveClaudeCredentialForJob } from '../../../src/router/engine-credential-rotation.js';

function poolMember(setId: number, name: string, position: number, token = `tok-${setId}`) {
	return {
		setId,
		setName: name,
		position,
		source: 'selection' as const,
		values: { CLAUDE_CODE_OAUTH_TOKEN: token },
	};
}

function limits(buckets: { key: string; utilization: number; resetsAt?: string }[]) {
	return {
		tokenMasked: '****x',
		buckets: buckets.map((b) => ({
			key: b.key,
			label: b.key,
			utilization: b.utilization,
			resetsAt: b.resetsAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		})),
		extraUsage: null,
	};
}

const project = {
	id: 'proj-1',
	model: 'claude-sonnet-4-6',
	agentModels: { review: 'claude-opus-4-8' },
	agentEngine: { default: 'claude-code' },
};

describe('resolveClaudeCredentialForJob', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRouterConfig.rotationUtilizationThreshold = 95;
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [project] });
		mockResolveCredentialPool.mockResolvedValue([
			poolMember(1, 'personal', 0),
			poolMember(2, 'work', 1),
		]);
	});

	it('returns none without a projectId', async () => {
		expect(await resolveClaudeCredentialForJob({}, null, 'implementation')).toEqual({
			kind: 'none',
		});
	});

	it('returns none when the engine is not claude-code', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ ...project, agentEngine: { default: 'codex' } }],
		});
		expect(await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation')).toEqual({
			kind: 'none',
		});
	});

	it('returns none when the pool has no members with a token', async () => {
		mockResolveCredentialPool.mockResolvedValue([
			{ setId: 3, setName: 'empty', position: 0, source: 'selection', values: {} },
		]);
		expect(await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation')).toEqual({
			kind: 'none',
		});
	});

	it('returns none (not suspend) when pool resolution throws', async () => {
		mockResolveCredentialPool.mockRejectedValue(new Error('db down'));
		expect(await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation')).toEqual({
			kind: 'none',
		});
	});

	it('picks the least-utilized credential across gating buckets', async () => {
		mockFetchLimits.mockImplementation(async (token: string) =>
			token === 'tok-1'
				? limits([{ key: 'five_hour', utilization: 80 }])
				: limits([{ key: 'five_hour', utilization: 20 }]),
		);

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision).toMatchObject({ kind: 'token', credentialId: '2', credentialName: 'work' });
	});

	it('breaks score ties by pool order', async () => {
		mockFetchLimits.mockResolvedValue(limits([{ key: 'five_hour', utilization: 50 }]));

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision).toMatchObject({
			kind: 'token',
			credentialId: '1',
			credentialName: 'personal',
		});
	});

	it('gating is model-aware: a maxed sonnet bucket does not exhaust an opus run', async () => {
		// agentType 'review' resolves model claude-opus-4-8 via agentModels.
		mockFetchLimits.mockImplementation(async (token: string) =>
			token === 'tok-1'
				? limits([
						{ key: 'five_hour', utilization: 10 },
						{ key: 'seven_day_sonnet', utilization: 99 },
					])
				: limits([
						{ key: 'five_hour', utilization: 50 },
						{ key: 'seven_day_sonnet', utilization: 0 },
					]),
		);

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'review');
		// tok-1's sonnet bucket is irrelevant for an opus run → score 10 wins.
		expect(decision).toMatchObject({ kind: 'token', credentialId: '1' });
	});

	it('honors the job model override for gating', async () => {
		mockFetchLimits.mockImplementation(async (token: string) =>
			token === 'tok-1'
				? limits([{ key: 'seven_day_opus', utilization: 99 }])
				: limits([{ key: 'seven_day_opus', utilization: 10 }]),
		);

		const decision = await resolveClaudeCredentialForJob(
			{ modelOverride: 'claude-opus-4-7' },
			'proj-1',
			'implementation',
		);
		expect(decision).toMatchObject({ kind: 'token', credentialId: '2' });
	});

	it('never suspends on limits-fetch failure — falls back to pool order', async () => {
		mockFetchLimits.mockImplementation(async (token: string) =>
			token === 'tok-1' ? null : limits([{ key: 'five_hour', utilization: 99 }]),
		);

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision).toMatchObject({ kind: 'token', credentialId: '1' });
	});

	it('suspends when every known candidate is at/over the threshold', async () => {
		const resetsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
		mockFetchLimits.mockResolvedValue(limits([{ key: 'five_hour', utilization: 97, resetsAt }]));

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision.kind).toBe('suspend');
		if (decision.kind !== 'suspend') return;
		expect(decision.poolSize).toBe(2);
		expect(decision.gatingBucketLabels).toContain('five_hour');
		expect(decision.reason).toContain('95%');
		// resumeAt lands at/after the bucket reset (plus 0-60s jitter).
		const resetMs = Date.parse(resetsAt);
		expect(decision.resumeAt.getTime()).toBeGreaterThanOrEqual(resetMs);
		expect(decision.resumeAt.getTime()).toBeLessThanOrEqual(resetMs + 61_000);
	});

	it('falls back to 15 minutes when every reset time is invalid or past', async () => {
		mockFetchLimits.mockResolvedValue(
			limits([{ key: 'five_hour', utilization: 100, resetsAt: 'not-a-date' }]),
		);

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision.kind).toBe('suspend');
		if (decision.kind !== 'suspend') return;
		const delay = decision.resumeAt.getTime() - Date.now();
		expect(delay).toBeGreaterThanOrEqual(14 * 60 * 1000);
		expect(delay).toBeLessThanOrEqual(17 * 60 * 1000);
	});

	it('clamps a far-future reset to the max resume delay', async () => {
		mockFetchLimits.mockResolvedValue(
			limits([
				{
					key: 'five_hour',
					utilization: 99,
					resetsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
				},
			]),
		);

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision.kind).toBe('suspend');
		if (decision.kind !== 'suspend') return;
		const delay = decision.resumeAt.getTime() - Date.now();
		expect(delay).toBeLessThanOrEqual(8 * 24 * 3600 * 1000 + 1000);
	});

	it('degrades to pool order instead of suspending when agentType is undefined', async () => {
		mockFetchLimits.mockResolvedValue(limits([{ key: 'five_hour', utilization: 99 }]));

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', undefined);
		expect(decision).toMatchObject({ kind: 'token', credentialId: '1' });
	});

	it('respects the env-overridable threshold', async () => {
		mockRouterConfig.rotationUtilizationThreshold = 50;
		mockFetchLimits.mockResolvedValue(limits([{ key: 'five_hour', utilization: 60 }]));

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision.kind).toBe('suspend');
	});

	it('a single exhausted candidate still suspends', async () => {
		mockResolveCredentialPool.mockResolvedValue([poolMember(1, 'only', 0)]);
		mockFetchLimits.mockResolvedValue(limits([{ key: 'five_hour', utilization: 96 }]));

		const decision = await resolveClaudeCredentialForJob({}, 'proj-1', 'implementation');
		expect(decision.kind).toBe('suspend');
	});
});
