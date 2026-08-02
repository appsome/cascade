import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function post(
	app: Hono,
	{
		projectId = 'proj-1',
		agentType = 'implementation',
		body = '{"message":"do the thing"}',
		headers = {} as Record<string, string>,
	} = {},
): Promise<Response> {
	return app.fetch(
		new Request(`http://localhost/external/webhook/${projectId}/${agentType}`, {
			method: 'POST',
			headers,
			body,
		}),
	);
}

const bearer = (password: string) => ({ Authorization: `Bearer ${password}` });

describe('external webhook endpoint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadProjectConfigById.mockResolvedValue({ project: { id: 'proj-1' }, config: {} });
		mockResolveProjectCredential.mockResolvedValue('correct-password');
		mockGetResolvedTriggerConfig.mockResolvedValue({ enabled: true, parameters: {} });
		mockResolveEngineName.mockReturnValue('claude-code');
		mockCreateQueuedRun.mockResolvedValue('run-123');
		mockSubmitDashboardJob.mockResolvedValue(undefined);
	});

	describe('fail closed', () => {
		it('rejects with 403 when no password is configured — never dispatches', async () => {
			mockResolveProjectCredential.mockResolvedValue(null);

			const res = await post(buildApp(), { headers: bearer('anything') });

			expect(res.status).toBe(403);
			expect(mockSubmitDashboardJob).not.toHaveBeenCalled();
			expect(mockCreateQueuedRun).not.toHaveBeenCalled();
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

		it('rejects wrong password with 401', async () => {
			const res = await post(buildApp(), { headers: bearer('wrong-password!') });
			expect(res.status).toBe(401);
			expect(mockSubmitDashboardJob).not.toHaveBeenCalled();
		});

		it('rejects wrong-length password with 401', async () => {
			const res = await post(buildApp(), { headers: bearer('short') });
			expect(res.status).toBe(401);
		});

		it('never passes the Authorization header to webhook logs', async () => {
			await post(buildApp(), { headers: bearer('correct-password') });

			for (const call of mockLogWebhookCall.mock.calls) {
				const input = call[0] as Record<string, unknown>;
				expect(input.headers).toBeUndefined();
				expect(JSON.stringify(input)).not.toContain('correct-password');
			}
		});
	});

	describe('routing guards', () => {
		it('returns 404 for an invalid agent type slug', async () => {
			const res = await post(buildApp(), { agentType: 'Not-Valid!' });
			expect(res.status).toBe(404);
			expect(mockLoadProjectConfigById).not.toHaveBeenCalled();
		});

		it('returns 404 for an unknown project', async () => {
			mockLoadProjectConfigById.mockResolvedValue(undefined);
			const res = await post(buildApp(), { headers: bearer('correct-password') });
			expect(res.status).toBe(404);
		});

		it('returns 404 when the agent is not enabled or trigger undeclared', async () => {
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
		it('rejects oversized declared content-length with 413', async () => {
			const res = await post(buildApp(), {
				headers: {
					...bearer('correct-password'),
					'content-length': String(EXTERNAL_WEBHOOK_BODY_MAX_BYTES + 1),
				},
			});
			expect(res.status).toBe(413);
		});

		it('rejects oversized actual body with 413', async () => {
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

		it('fails the pre-created run and returns 500 when enqueue throws', async () => {
			mockSubmitDashboardJob.mockRejectedValue(new Error('redis down'));

			const res = await post(buildApp(), { headers: bearer('correct-password') });

			expect(res.status).toBe(500);
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
