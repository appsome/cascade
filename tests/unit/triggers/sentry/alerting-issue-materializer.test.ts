import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);
vi.mock('../../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn(),
}));

const mockMaterializeAlertWorkItem = vi.fn();
vi.mock('../../../../src/integrations/alerting/_shared/materialize.js', () => ({
	materializeAlertWorkItem: (...a: unknown[]) => mockMaterializeAlertWorkItem(...a),
}));

const mockFormatSentryCardBody = vi.fn();
vi.mock('../../../../src/integrations/alerting/_shared/format.js', () => ({
	formatSentryCardBody: (...a: unknown[]) => mockFormatSentryCardBody(...a),
}));

import { AlertSlotMissingError } from '../../../../src/integrations/alerting/_shared/types.js';
import { getSentryIntegrationConfig } from '../../../../src/sentry/integration.js';
import { SentryIssueAlertTrigger } from '../../../../src/triggers/sentry/alerting-issue.js';
import { checkTriggerEnabledWithParams } from '../../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';

const mockProject = createMockProject({ id: 'test-project' });
const sentryConfig = { organizationSlug: 'my-org' };
const defaultHints = { title: '[Sentry] Test Alert', descriptionMarkdown: 'sentry body' };

function makeCtx(issueId = 'issue-42'): TriggerContext {
	return {
		project: mockProject,
		source: 'sentry',
		payload: {
			resource: 'event_alert',
			payload: {
				action: 'triggered',
				data: {
					event: {
						event_id: 'evt-abc',
						issue_id: issueId,
						web_url: `https://sentry.io/issues/${issueId}/`,
						title: 'NullPointerException',
					},
				},
			},
			cascadeProjectId: 'test-project',
		},
	} as TriggerContext;
}

describe('SentryIssueAlertTrigger — materializer integration', () => {
	let trigger: SentryIssueAlertTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: true, parameters: {} });
		vi.mocked(getSentryIntegrationConfig).mockResolvedValue(sentryConfig);
		mockFormatSentryCardBody.mockReturnValue(defaultHints);
		mockMaterializeAlertWorkItem.mockResolvedValue('card-real-1');
		trigger = new SentryIssueAlertTrigger();
	});

	it('returns TriggerResult whose workItemId is the materialized native id', async () => {
		const result = await trigger.handle(makeCtx());
		expect(result?.workItemId).toBe('card-real-1');
		expect(result?.agentInput?.workItemId).toBe('card-real-1');
	});

	it('result contains no string field matching sentry:issue: prefix', async () => {
		const result = await trigger.handle(makeCtx());
		expect(result).not.toBeNull();
		expect(JSON.stringify(result)).not.toMatch(/sentry:issue:/);
	});

	it('calls materializeAlertWorkItem with source=sentry, externalId, project, formatted hints', async () => {
		await trigger.handle(makeCtx('I-7'));
		expect(mockMaterializeAlertWorkItem).toHaveBeenCalledWith(
			'sentry',
			'I-7',
			mockProject,
			expect.objectContaining({ title: '[Sentry] Test Alert' }),
		);
	});

	it('returns null and emits structured WARN when materialization throws AlertSlotMissingError', async () => {
		mockMaterializeAlertWorkItem.mockRejectedValue(
			new AlertSlotMissingError('test-project', 'trello'),
		);
		const result = await trigger.handle(makeCtx());
		expect(result).toBeNull();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				projectId: 'test-project',
				source: 'sentry',
				reason: 'alerts_slot_missing',
			}),
		);
	});

	it('re-throws transient PM error so BullMQ retry budget engages', async () => {
		const pmError = new Error('PM 503 Service Unavailable');
		mockMaterializeAlertWorkItem.mockRejectedValue(pmError);
		await expect(trigger.handle(makeCtx())).rejects.toThrow('PM 503');
	});

	it('AlertSlotMissingError returns null (not re-thrown), transient error re-throws', async () => {
		mockMaterializeAlertWorkItem.mockRejectedValue(
			new AlertSlotMissingError('test-project', 'trello'),
		);
		const slotResult = await trigger.handle(makeCtx());
		expect(slotResult).toBeNull();

		mockMaterializeAlertWorkItem.mockRejectedValue(new Error('PM 500'));
		await expect(trigger.handle(makeCtx())).rejects.toThrow('PM 500');
	});

	it('returns null when trigger is disabled without calling materializer', async () => {
		vi.mocked(checkTriggerEnabledWithParams).mockResolvedValue({ enabled: false, parameters: {} });
		const result = await trigger.handle(makeCtx());
		expect(result).toBeNull();
		expect(mockMaterializeAlertWorkItem).not.toHaveBeenCalled();
	});

	it('returns null when issue ID cannot be determined without calling materializer', async () => {
		const ctx = makeCtx();
		(ctx.payload as Record<string, unknown>).payload = {
			action: 'triggered',
			data: { event: { event_id: 'evt-x' } },
		};
		const result = await trigger.handle(ctx);
		expect(result).toBeNull();
		expect(mockMaterializeAlertWorkItem).not.toHaveBeenCalled();
	});
});
