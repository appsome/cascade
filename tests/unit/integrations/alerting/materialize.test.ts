import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AlertSlotMissingError,
	MaterializationRetryExhausted,
} from '../../../../src/integrations/alerting/_shared/types.js';

// ── mock the repo ─────────────────────────────────────────────────────────────
const mockFindByExternal = vi.fn();
const mockClaimExternalMapping = vi.fn();
const mockAttachWorkItemId = vi.fn();
const mockReplaceWorkItemId = vi.fn();
const mockDeleteExternalMappingClaim = vi.fn();

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	findByExternal: (...a: unknown[]) => mockFindByExternal(...a),
	claimExternalMapping: (...a: unknown[]) => mockClaimExternalMapping(...a),
	attachWorkItemId: (...a: unknown[]) => mockAttachWorkItemId(...a),
	replaceWorkItemId: (...a: unknown[]) => mockReplaceWorkItemId(...a),
	deleteExternalMappingClaim: (...a: unknown[]) => mockDeleteExternalMappingClaim(...a),
}));

// ── mock the PM registry ──────────────────────────────────────────────────────
const mockCreateWorkItem = vi.fn();
const mockGetWorkItem = vi.fn();
const mockAddLabel = vi.fn();
const mockMoveWorkItem = vi.fn();

const fakePMProvider = {
	createWorkItem: (...a: unknown[]) => mockCreateWorkItem(...a),
	getWorkItem: (...a: unknown[]) => mockGetWorkItem(...a),
	addLabel: (...a: unknown[]) => mockAddLabel(...a),
	moveWorkItem: (...a: unknown[]) => mockMoveWorkItem(...a),
};

vi.mock('../../../../src/pm/registry.js', () => ({
	pmRegistry: { createProvider: () => fakePMProvider },
}));

import { materializeAlertWorkItem } from '../../../../src/integrations/alerting/_shared/materialize.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeTrelloProject(listsAlerts?: string, labelsAlert?: string): ProjectConfig {
	return {
		id: 'test-project',
		pm: { type: 'trello' },
		trello: {
			boardId: 'board-1',
			lists: { todo: 'list-todo', ...(listsAlerts ? { alerts: listsAlerts } : {}) },
			labels: labelsAlert ? { 'cascade-alert': labelsAlert } : {},
		},
	} as unknown as ProjectConfig;
}

const defaultHints = { title: '[Sentry] Test Alert', descriptionMarkdown: 'some description' };

// ── tests ─────────────────────────────────────────────────────────────────────

describe('materializeAlertWorkItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAttachWorkItemId.mockResolvedValue(undefined);
		mockReplaceWorkItemId.mockResolvedValue(true);
		mockDeleteExternalMappingClaim.mockResolvedValue(undefined);
		mockAddLabel.mockResolvedValue(undefined);
		mockMoveWorkItem.mockResolvedValue(undefined);
	});

	it('returns existing native id when a healthy mapping is present (no createWorkItem call)', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue({ id: 'row-1', workItemId: 'card-existing' });
		mockGetWorkItem.mockResolvedValue({
			id: 'card-existing',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});

		const result = await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(result).toBe('card-existing');
		expect(mockCreateWorkItem).not.toHaveBeenCalled();
	});

	it('creates and attaches when no mapping exists', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-1' });
		mockCreateWorkItem.mockResolvedValue({
			id: 'card-new',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});

		const result = await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(result).toBe('card-new');
		expect(mockCreateWorkItem).toHaveBeenCalledWith(
			expect.objectContaining({ containerId: 'list-alerts', title: '[Sentry] Test Alert' }),
		);
		expect(mockAttachWorkItemId).toHaveBeenCalledWith('row-1', 'card-new');
	});

	it('returns the winning concurrent claim result when ownedHere=false and work_item_id is already set', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({
			ownedHere: false,
			existing: { id: 'row-winner', workItemId: 'card-winner' },
		});

		const result = await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(result).toBe('card-winner');
		expect(mockCreateWorkItem).not.toHaveBeenCalled();
	});

	it('polls and returns winner work_item_id when concurrent winner row has workItemId=null initially', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal
			.mockResolvedValueOnce(null) // initial lookup
			.mockResolvedValueOnce({ id: 'row-winner', workItemId: null }) // first poll
			.mockResolvedValueOnce({ id: 'row-winner', workItemId: 'card-winner' }); // second poll
		mockClaimExternalMapping.mockResolvedValue({
			ownedHere: false,
			existing: { id: 'row-winner', workItemId: null },
		});

		const result = await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(result).toBe('card-winner');
		expect(mockCreateWorkItem).not.toHaveBeenCalled();
	}, 15000);

	it('throws MaterializationRetryExhausted when polling for winner work_item_id exhausts budget', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue({ id: 'row-winner', workItemId: null });
		mockClaimExternalMapping.mockResolvedValue({
			ownedHere: false,
			existing: { id: 'row-winner', workItemId: null },
		});

		await expect(
			materializeAlertWorkItem('sentry', 'S1', project, defaultHints),
		).rejects.toBeInstanceOf(MaterializationRetryExhausted);
		expect(mockCreateWorkItem).not.toHaveBeenCalled();
	}, 30000);

	it('lazy-heals on PM 404: creates a new card and replaces the mapping', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue({ id: 'row-1', workItemId: 'card-stale' });
		mockGetWorkItem.mockRejectedValue(new Error('Trello API error 404 for /cards/card-stale'));
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-1' });
		mockCreateWorkItem.mockResolvedValue({
			id: 'card-new',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});

		const result = await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(result).toBe('card-new');
		expect(mockReplaceWorkItemId).toHaveBeenCalledWith('row-1', 'card-stale', 'card-new');
	});

	it('propagates terminal PM errors untouched and does not call attachWorkItemId', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-1' });
		mockCreateWorkItem.mockRejectedValue(new Error('PM 500 Internal Server Error'));

		await expect(materializeAlertWorkItem('sentry', 'S1', project, defaultHints)).rejects.toThrow(
			'PM 500',
		);
		expect(mockAttachWorkItemId).not.toHaveBeenCalled();
		// Claim row must be cleaned up so the next delivery can reclaim it
		expect(mockDeleteExternalMappingClaim).toHaveBeenCalledWith('row-1');
	});

	it('cleans up stale claim row when createWorkItem throws so the next delivery can reclaim', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-stale' });
		mockCreateWorkItem.mockRejectedValue(new Error('PM 503'));

		await expect(materializeAlertWorkItem('sentry', 'S1', project, defaultHints)).rejects.toThrow(
			'PM 503',
		);
		expect(mockDeleteExternalMappingClaim).toHaveBeenCalledWith('row-stale');
	});

	it('attachWorkItemId is called before addLabel and moveWorkItem', async () => {
		const project = makeTrelloProject('list-alerts', 'lbl-cascade-alert');
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-1' });
		mockCreateWorkItem.mockResolvedValue({
			id: 'card-new',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});

		const callOrder: string[] = [];
		mockAttachWorkItemId.mockImplementation(async () => {
			callOrder.push('attachWorkItemId');
		});
		mockAddLabel.mockImplementation(async () => {
			callOrder.push('addLabel');
		});
		mockMoveWorkItem.mockImplementation(async () => {
			callOrder.push('moveWorkItem');
		});

		await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(callOrder).toEqual(['attachWorkItemId', 'addLabel', 'moveWorkItem']);
	});

	it('lazy-heal: returns canonical mapping id when replaceWorkItemId CAS fails (concurrent heal)', async () => {
		const project = makeTrelloProject('list-alerts');
		// Initial lookup finds stale card
		mockFindByExternal
			.mockResolvedValueOnce({ id: 'row-1', workItemId: 'card-stale' })
			// Re-read after CAS loss returns the winner's canonical id
			.mockResolvedValueOnce({ id: 'row-1', workItemId: 'card-canonical' });
		mockGetWorkItem.mockRejectedValue(new Error('404 Not Found'));
		mockCreateWorkItem.mockResolvedValue({
			id: 'card-orphan',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});
		// CAS loses — another webhook already healed the row
		mockReplaceWorkItemId.mockResolvedValue(false);

		const result = await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		// Must return the persisted canonical id, not the orphan card we just created
		expect(result).toBe('card-canonical');
	});

	it('applies the configured alert label when getAlertLabelId returns a value', async () => {
		const project = makeTrelloProject('list-alerts', 'lbl-cascade-alert');
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-1' });
		mockCreateWorkItem.mockResolvedValue({
			id: 'card-new',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});

		await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(mockAddLabel).toHaveBeenCalledWith('card-new', 'lbl-cascade-alert');
	});

	it('skips label application when getAlertLabelId returns undefined', async () => {
		const project = makeTrelloProject('list-alerts'); // no label configured
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-1' });
		mockCreateWorkItem.mockResolvedValue({
			id: 'card-new',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});

		await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(mockAddLabel).not.toHaveBeenCalled();
	});

	it('moves to alerts state via moveWorkItem when getAlertsStatusKey === "alerts"', async () => {
		const project = makeTrelloProject('list-alerts');
		mockFindByExternal.mockResolvedValue(null);
		mockClaimExternalMapping.mockResolvedValue({ ownedHere: true, rowId: 'row-1' });
		mockCreateWorkItem.mockResolvedValue({
			id: 'card-new',
			title: 'x',
			description: '',
			url: '',
			labels: [],
		});

		await materializeAlertWorkItem('sentry', 'S1', project, defaultHints);
		expect(mockMoveWorkItem).toHaveBeenCalledWith('card-new', 'list-alerts');
	});

	it('throws AlertSlotMissingError when getAlertsContainerId returns undefined', async () => {
		const project = makeTrelloProject(); // no lists.alerts configured
		await expect(
			materializeAlertWorkItem('sentry', 'S1', project, defaultHints),
		).rejects.toBeInstanceOf(AlertSlotMissingError);
		expect(mockFindByExternal).not.toHaveBeenCalled();
		expect(mockCreateWorkItem).not.toHaveBeenCalled();
	});
});
