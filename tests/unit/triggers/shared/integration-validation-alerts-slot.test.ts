import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateIntegrations } from '../../../../src/triggers/shared/integration-validation.js';

vi.mock('../../../../src/integrations/registry.js', () => ({
	integrationRegistry: {
		getByCategory: vi.fn(),
		getOrNull: vi.fn().mockReturnValue(null),
		register: vi.fn(),
		get: vi.fn(),
		all: vi.fn().mockReturnValue([]),
		hasIntegration: vi.fn().mockResolvedValue(false),
	},
}));

vi.mock('../../../../src/github/personas.js', () => ({
	getPersonaForAgentType: vi.fn().mockReturnValue('implementer'),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockGetTriggerConfigsByProjectAndAgent = vi.fn();
vi.mock('../../../../src/db/repositories/agentTriggerConfigsRepository.js', () => ({
	getTriggerConfigsByProjectAndAgent: (...a: unknown[]) =>
		mockGetTriggerConfigsByProjectAndAgent(...a),
}));

import { integrationRegistry } from '../../../../src/integrations/registry.js';
import type { ProjectConfig } from '../../../../src/types/index.js';
import {
	createMockJiraProject,
	createMockLinearProject,
	createMockProject,
} from '../../../helpers/factories.js';

function mockAlertingIntegration() {
	return {
		type: 'sentry',
		category: 'alerting',
		hasIntegration: vi.fn().mockResolvedValue(true),
		withCredentials: vi.fn(),
	};
}

function enabledAlertingTrigger(projectId: string) {
	return {
		id: 1,
		projectId,
		agentType: 'alerting',
		triggerEvent: 'alerting:issue-alert',
		enabled: true,
		parameters: {},
		createdAt: null,
		updatedAt: null,
	};
}

const trelloNoAlerts = createMockProject({
	id: 'test-project',
	trello: { boardId: 'b1', lists: { todo: 'list-todo' }, labels: {} },
}) as ProjectConfig;

const trelloWithAlerts = createMockProject({
	id: 'test-project',
	trello: { boardId: 'b1', lists: { todo: 'list-todo', alerts: 'list-alerts' }, labels: {} },
}) as ProjectConfig;

const jiraNoAlerts = createMockJiraProject() as ProjectConfig;

const linearNoAlerts = createMockLinearProject() as ProjectConfig;

describe('validateIntegrations — alerts-slot check', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		const alerting = mockAlertingIntegration();
		vi.mocked(integrationRegistry.getByCategory).mockImplementation((category) => {
			if (category === 'alerting') return [alerting as never];
			return [];
		});
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([]);
	});

	it('passes when no alerting trigger is enabled even if alerts slot is unset', async () => {
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([]);
		const result = await validateIntegrations('test-project', 'alerting', trelloNoAlerts);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it('fails with pm-category error when alerting trigger enabled and Trello lists.alerts is unset', async () => {
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([
			enabledAlertingTrigger('test-project'),
		]);
		const result = await validateIntegrations('test-project', 'alerting', trelloNoAlerts);
		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].category).toBe('pm');
		expect(result.errors[0].message).toMatch(/alerts/i);
		expect(result.errors[0].message).toMatch(/trello/i);
	});

	it('fails when alerting trigger enabled and JIRA statuses.alerts is unset', async () => {
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([
			enabledAlertingTrigger(jiraNoAlerts.id),
		]);
		const result = await validateIntegrations(jiraNoAlerts.id, 'alerting', jiraNoAlerts);
		expect(result.valid).toBe(false);
		expect(result.errors[0].category).toBe('pm');
		expect(result.errors[0].message).toMatch(/alerts/i);
	});

	it('fails when alerting trigger enabled and Linear statuses.alerts is unset', async () => {
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([
			enabledAlertingTrigger(linearNoAlerts.id),
		]);
		const result = await validateIntegrations(linearNoAlerts.id, 'alerting', linearNoAlerts);
		expect(result.valid).toBe(false);
		expect(result.errors[0].category).toBe('pm');
		expect(result.errors[0].message).toMatch(/alerts/i);
	});

	it('passes when alerting trigger enabled and Trello lists.alerts is set', async () => {
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([
			enabledAlertingTrigger('test-project'),
		]);
		const result = await validateIntegrations('test-project', 'alerting', trelloWithAlerts);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it('does not require cascade-alert label slot (soft requirement)', async () => {
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([
			enabledAlertingTrigger('test-project'),
		]);
		// trelloWithAlerts has no labels['cascade-alert'] — should still pass
		const result = await validateIntegrations('test-project', 'alerting', trelloWithAlerts);
		expect(result.valid).toBe(true);
	});

	it('skips the alerts-slot check when project is not provided', async () => {
		mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue([
			enabledAlertingTrigger('test-project'),
		]);
		// no project param — should not fail even with no slot
		const result = await validateIntegrations('test-project', 'alerting');
		expect(result.valid).toBe(true);
		expect(mockGetTriggerConfigsByProjectAndAgent).not.toHaveBeenCalled();
	});
});
