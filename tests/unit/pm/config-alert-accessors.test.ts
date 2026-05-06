import { describe, expect, it } from 'vitest';
import {
	getAlertLabelId,
	getAlertsContainerId,
	getAlertsStatusKey,
} from '../../../src/pm/config.js';
import type { ProjectConfig } from '../../../src/types/index.js';

function makeTrelloProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'trello' },
		trello: {
			boardId: 'board-1',
			lists: { todo: 'list-todo', alerts: 'list-alerts' },
			labels: { 'cascade-alert': 'lbl-alert' },
		},
		...overrides,
	} as unknown as ProjectConfig;
}

function makeJiraProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'jira' },
		jira: {
			projectKey: 'PROJ',
			baseUrl: 'https://acme.atlassian.net',
			statuses: { todo: 'To Do', alerts: 'In Triage' },
			labels: { cascadeAlert: 'cascade-alert' },
		},
		...overrides,
	} as unknown as ProjectConfig;
}

function makeLinearProject(overrides: Record<string, unknown> = {}): ProjectConfig {
	return {
		id: 'p1',
		pm: { type: 'linear' },
		linear: {
			teamId: 'team-1',
			statuses: { todo: 'state-todo', alerts: 'state-triage' },
			labels: { cascadeAlert: 'label-uuid' },
		},
		...overrides,
	} as unknown as ProjectConfig;
}

describe('getAlertsContainerId', () => {
	it('returns Trello list ID from project.trello.lists.alerts', () => {
		expect(getAlertsContainerId(makeTrelloProject())).toBe('list-alerts');
	});

	it('returns JIRA project key for JIRA projects (container = projectKey, not a status)', () => {
		expect(getAlertsContainerId(makeJiraProject())).toBe('PROJ');
	});

	it('returns Linear team ID for Linear projects', () => {
		expect(getAlertsContainerId(makeLinearProject())).toBe('team-1');
	});

	it('returns undefined when no PM config is present', () => {
		const project = { id: 'p1', pm: undefined } as unknown as ProjectConfig;
		expect(getAlertsContainerId(project)).toBeUndefined();
	});

	it('returns undefined when alerts slot is not configured (Trello)', () => {
		const project = makeTrelloProject({
			trello: { boardId: 'b1', lists: { todo: 'l1' }, labels: {} },
		});
		// Trello container IS the alerts list — if missing, return undefined
		expect(getAlertsContainerId(project)).toBeUndefined();
	});
});

describe('getAlertLabelId', () => {
	it('returns Trello label ID from labels["cascade-alert"]', () => {
		expect(getAlertLabelId(makeTrelloProject())).toBe('lbl-alert');
	});

	it('returns JIRA label string from labels.cascadeAlert', () => {
		expect(getAlertLabelId(makeJiraProject())).toBe('cascade-alert');
	});

	it('returns Linear label ID from labels.cascadeAlert', () => {
		expect(getAlertLabelId(makeLinearProject())).toBe('label-uuid');
	});

	it('returns undefined when label slot is not configured', () => {
		const p1 = makeTrelloProject({ trello: { boardId: 'b1', lists: {}, labels: {} } });
		expect(getAlertLabelId(p1)).toBeUndefined();

		const p2 = makeJiraProject({
			jira: { projectKey: 'P', baseUrl: 'https://x', statuses: {}, labels: {} },
		});
		expect(getAlertLabelId(p2)).toBeUndefined();

		const p3 = makeLinearProject({ linear: { teamId: 't1', statuses: {} } });
		expect(getAlertLabelId(p3)).toBeUndefined();
	});
});

describe('getAlertsStatusKey', () => {
	it('returns "alerts" when statuses.alerts is configured (JIRA)', () => {
		expect(getAlertsStatusKey(makeJiraProject())).toBe('alerts');
	});

	it('returns "alerts" when statuses.alerts is configured (Linear)', () => {
		expect(getAlertsStatusKey(makeLinearProject())).toBe('alerts');
	});

	it('returns "alerts" when lists.alerts is configured (Trello)', () => {
		expect(getAlertsStatusKey(makeTrelloProject())).toBe('alerts');
	});

	it('returns undefined when alerts slot is not configured', () => {
		const p = makeTrelloProject({ trello: { boardId: 'b1', lists: { todo: 'l1' }, labels: {} } });
		expect(getAlertsStatusKey(p)).toBeUndefined();
	});
});
