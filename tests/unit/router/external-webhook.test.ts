import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting } from '../../../src/api/auth/rateLimiter.js';

// Must mock heavy imports BEFORE importing the module under test
const {
	mockLoadProjectConfigById,
	mockResolveProjectCredential,
	mockGetResolvedTriggerConfig,
	mockCreateQueuedRun,
	mockFailQueuedOrRunningRun,
	mockSubmitDashboardJob,
	mockResolveEngineName,
	mockLogWebhookCall,
} = vi.hoisted(() => ({
	mockLoadProjectConfigById: vi.fn(),
	mockResolveProjectCredential: vi.fn(),
	mockGetResolvedTriggerConfig: vi.fn(),
	mockCreateQueuedRun: vi.fn(),
	mockFailQueuedOrRunningRun: vi.fn(),
	mockSubmitDashboardJob: vi.fn(),
	mockResolveEngineName: vi.fn(),
	mockLogWebhookCall: vi.fn(),
}));

vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: mockLoadProjectConfigById,
}));
vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	resolveProjectCredential: mockResolveProjectCredential,
}));
vi.mock('../../../src/triggers/config-resolver.js', () => ({
	getResolvedTriggerConfig: mockGetResolvedTriggerConfig,
}));
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	createQueuedRun: mockCreateQueuedRun,
	failQueuedOrRunningRun: mockFailQueuedOrRunningRun,
}));
vi.mock('../../../src/queue/client.js', () => ({
	submitDashboardJob: mockSubmitDashboardJob,
}));
vi.mock('../../../src/backends/resolution.js', () => ({
	resolveEngineName: mockResolveEngineName,
}));
vi.mock('../../../src/utils/webhookLogger.js', () => ({
	logWebhookCall: mockLogWebhookCall,
}));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
	createExternalWebhookHandler,
	EXTERNAL_WEBHOOK_BODY_MAX_BYTES,
} from '../../../src/router/external-webhook.js';

function buildApp(): Hono {
	const app = new Hono();
	app.post('/external/webhook/:projectId/:agentType', createExternalWebhookHandler());
	return app;
}

let ipCounter = 0;
/** Unique per-test client IP so the shared rate limiter never couples tests. */
function nextIp(): string {
	ipCounter += 1;
	return `10.0.0.${ipCounter}`;
}

function post(
	app: Hono,
	{
		projectId = 'proj-1',
		agentType = 'implementation',
		body = '{"message":"do the thing"}',
		headers = {} as Record<string, string>,
		ip = nextIp(),
	} = {},
): Promise<Response> {
	return app.fetch(
		new Request(`http://localhost/external/webhook/${projectId}/${agentType}`, {
			method: 'POST',
			headers: { 'x-forwarded-for': ip, ...headers },
			body,
		}),
	);
}

const bearer = (password: string) => ({ Authorization: `Bearer ${password}` });

describe('external webhook endpoint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTesting();
		mockLoadProjectConfigById.mockResolvedValue({ project: { id: 'proj-1' }, config: {} });
		mockResolveProjectCredential.mockResolvedValue('correct-password');
		mockGetResolvedTriggerConfig.mockResolvedValue({ enabled: true, parameters: {} });
		mockResolveEngineName.mockReturnValue('claude-code');
		mockCreateQueuedRun.mockResolvedValue('run-123');
		mockSubmitDashboardJob.mockResolvedValue(undefined);
	});

	describe('fail closed + anti-enumeration', () => {
		it('rejects with generic 401 when no password is configured — never dispatches', async () => {
			mockResolveProjectCredential.mockResolvedValue(null);

			const res = await post(buildApp(), { headers: bearer('anything') });

			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ error: 'Unauthorized' });
			expect(mockSubmitDashboardJob).not.toHaveBeenCalled();
			expect(mockCreateQueuedRun).not.toHaveBeenCalled();
		});

		it('unknown project, unset password, and wrong token are indistinguishable to callers', async () => {
			const app = buildApp();

			mockLoadProjectConfigById.mockResolvedValueOnce(undefined);
			const unknownProject = await post(app, { headers: bearer('x') });

			mockResolveProjectCredential.mockResolvedValueOnce(null);
			const noPassword = await post(app, { headers: bearer('x') });

			const wrongToken = await post(app, { headers: bearer('wrong-password!!') });

			const bodies = await Promise.all(
				[unknownProject, noPassword, wrongToken].map(async (r) => ({
					status: r.status,
					body: await r.json(),
				})),
			);
			expect(bodies).toEqual([
				{ status: 401, body: { error: 'Unauthorized' } },
				{ status: 401, body: { error: 'Unauthorized' } },
				{ status: 401, body: { error: 'Unauthorized' } },
			]);
		});

		it('keeps distinct decision reasons in webhook logs for operators', async () => {
			mockLoadProjectConfigById.mockResolvedValueOnce(undefined);
			await post(buildApp(), { headers: bearer('x') });

			const reasons = mockLogWebhookCall.mock.calls.map(
				(call) => (call[0] as { decisionReason?: string }).decisionReason,
			);
			expect(reasons).toContain('Unknown project');
		});
	});

	describe('authentication', () => {
		it('rejects missing Authorization header with 401', async () => {
			const res = await post(buildApp());
			expect(res.status).toBe(401);
		});

		it('rejects non-Bearer scheme with 401', async () => {
			const res = await post(buildApp(), {
				headers: { Authorization: 'Basic correct-password' },
			});
			expect(res.status).toBe(401);
		});

		it('accepts a case-insensitive bearer scheme (RFC 7235)', async () => {
			const res = await post(buildApp(), {
				headers: { Authorization: 'bearer correct-password' },
			});
			expect(res.status).toBe(200);
		});

		it('rejects wrong password with 401', async () => {
			const res = await post(buildApp(), { headers: bearer('wrong-password!') });
			expect(res.status).toBe(401);
			expect(mockSubmitDashboardJob).not.toHaveBeenCalled();
		});

		it('never passes the Authorization header or password to webhook logs', async () => {
			await post(buildApp(), { headers: bearer('correct-password') });

			for (const call of mockLogWebhookCall.mock.calls) {
				const input = call[0] as Record<string, unknown>;
				expect(input.headers).toBeUndefined();
				expect(JSON.stringify(input)).not.toContain('correct-password');
			}
		});
	});

	describe('rate limiting', () => {
		it('returns 429 with Retry-After after repeated attempts from one IP', async () => {
			const app = buildApp();
			const ip = nextIp();

			let lastStatus = 0;
			for (let i = 0; i < 12; i++) {
				const res = await post(app, { headers: bearer('wrong-password!'), ip });
				lastStatus = res.status;
				if (lastStatus === 429) {
					expect(res.headers.get('Retry-After')).toBeTruthy();
					break;
				}
			}
			expect(lastStatus).toBe(429);
		});

		it('successful auth resets the counter for the IP', async () => {
			const app = buildApp();
			const ip = nextIp();

			for (let i = 0; i < 5; i++) {
				await post(app, { headers: bearer('wrong-password!'), ip });
			}
			const success = await post(app, { headers: bearer('correct-password'), ip });
			expect(success.status).toBe(200);

			// Counter reset — several more attempts allowed before limiting again
			const next = await post(app, { headers: bearer('wrong-password!'), ip });
			expect(next.status).toBe(401);
		});
	});

	describe('routing guards', () => {
		it('returns 404 for an invalid agent type slug', async () => {
			const res = await post(buildApp(), { agentType: 'Not-Valid!' });
			expect(res.status).toBe(404);
			expect(mockLoadProjectConfigById).not.toHaveBeenCalled();
		});

		it('returns 404 when the agent is not enabled or trigger undeclared (post-auth)', async () => {
			mockGetResolvedTriggerConfig.mockResolvedValue(null);
			const res = await post(buildApp(), { headers: bearer('correct-password') });
			expect(res.status).toBe(404);
			expect(mockSubmitDashboardJob).not.toHaveBeenCalled();
		});

		it('returns 404 when the trigger is declared but disabled — distinct decision reason', async () => {
			mockGetResolvedTriggerConfig.mockResolvedValue({ enabled: false, parameters: {} });
			const res = await post(buildApp(), { headers: bearer('correct-password') });
			expect(res.status).toBe(404);

			const reasons = mockLogWebhookCall.mock.calls.map(
				(call) => (call[0] as { decisionReason?: string }).decisionReason,
			);
			expect(reasons.some((r) => r?.includes('disabled'))).toBe(true);
		});
	});

	describe('body handling', () => {
		it('rejects an oversized body with 413 without dispatching', async () => {
			const res = await post(buildApp(), {
				headers: bearer('correct-password'),
				body: 'x'.repeat(EXTERNAL_WEBHOOK_BODY_MAX_BYTES + 1),
			});
			expect(res.status).toBe(413);
			expect(mockCreateQueuedRun).not.toHaveBeenCalled();
		});

		it('passes undefined triggerCommentBody for an empty body', async () => {
			const res = await post(buildApp(), { headers: bearer('correct-password'), body: '' });
			expect(res.status).toBe(200);
			expect(mockSubmitDashboardJob).toHaveBeenCalledWith(
				expect.objectContaining({ triggerCommentBody: undefined }),
			);
		});
	});

	describe('dispatch', () => {
		it('queues a run and returns 200 with the runId', async () => {
			const res = await post(buildApp(), { headers: bearer('correct-password') });

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true, runId: 'run-123' });

			expect(mockCreateQueuedRun).toHaveBeenCalledWith({
				projectId: 'proj-1',
				agentType: 'implementation',
				engine: 'claude-code',
				triggerType: 'external-webhook',
			});
			expect(mockSubmitDashboardJob).toHaveBeenCalledWith({
				type: 'manual-run',
				projectId: 'proj-1',
				agentType: 'implementation',
				triggerCommentBody: '{"message":"do the thing"}',
				triggerType: 'external-webhook',
				triggerEvent: 'internal:external-webhook',
				runId: 'run-123',
			});
		});

		it('fails the pre-created run and returns a generic 500 when enqueue throws', async () => {
			mockSubmitDashboardJob.mockRejectedValue(new Error('redis down at 10.0.0.5:6379'));

			const res = await post(buildApp(), { headers: bearer('correct-password') });

			expect(res.status).toBe(500);
			// Internal detail stays out of the response body
			expect(JSON.stringify(await res.json())).not.toContain('redis');
			expect(mockFailQueuedOrRunningRun).toHaveBeenCalledWith(
				'run-123',
				'Failed to enqueue external webhook run',
			);
		});

		it('logs a processed webhook row with the body on success', async () => {
			await post(buildApp(), { headers: bearer('correct-password') });

			const successLog = mockLogWebhookCall.mock.calls
				.map((call) => call[0] as Record<string, unknown>)
				.find((input) => input.statusCode === 200);
			expect(successLog).toMatchObject({
				source: 'external',
				processed: true,
				projectId: 'proj-1',
				eventType: 'internal:external-webhook',
				bodyRaw: '{"message":"do the thing"}',
			});
		});
	});
});
