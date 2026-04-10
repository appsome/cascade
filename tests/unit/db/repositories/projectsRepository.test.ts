import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

const { mockReEncryptCredential } = vi.hoisted(() => ({
	mockReEncryptCredential: vi
		.fn()
		.mockImplementation((value: string, _oldAad: string, _newAad: string) => `re-enc:${value}`),
}));

vi.mock('../../../../src/db/crypto.js', () => ({
	reEncryptCredential: mockReEncryptCredential,
}));

import {
	cloneProject,
	createProject,
	deleteProject,
	getProjectFull,
	listAllProjects,
	listProjectsFull,
	updateProject,
} from '../../../../src/db/repositories/projectsRepository.js';

describe('projectsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true, withThenable: true });
	});

	describe('listProjectsFull', () => {
		it('queries projects by orgId', async () => {
			const projects = [{ id: 'p1', name: 'Project 1' }];
			mockDb.chain.where.mockResolvedValueOnce(projects);

			const result = await listProjectsFull('org-1');
			expect(result).toEqual(projects);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});
	});

	describe('listAllProjects', () => {
		it('queries all projects without filter', async () => {
			const projects = [
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			];
			mockDb.chain.where.mockResolvedValueOnce(projects);

			const result = await listAllProjects();
			expect(result).toEqual(projects);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.where).toHaveBeenCalledWith(expect.anything());
		});
	});

	describe('getProjectFull', () => {
		it('returns project when found with matching org', async () => {
			const project = { id: 'p1', orgId: 'org-1', name: 'Project 1' };
			mockDb.chain.where.mockResolvedValueOnce([project]);

			const result = await getProjectFull('p1', 'org-1');
			expect(result).toEqual(project);
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getProjectFull('missing', 'org-1');
			expect(result).toBeNull();
		});
	});

	describe('createProject', () => {
		it('inserts project and returns row', async () => {
			const newProject = { id: 'p1', orgId: 'org-1', name: 'New Project', repo: 'owner/repo' };
			mockDb.chain.returning.mockResolvedValueOnce([newProject]);

			const result = await createProject('org-1', {
				id: 'p1',
				name: 'New Project',
				repo: 'owner/repo',
			});

			expect(result).toEqual(newProject);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'p1',
					orgId: 'org-1',
					name: 'New Project',
					repo: 'owner/repo',
					baseBranch: 'main',
					branchPrefix: 'feature/',
				}),
			);
		});
	});

	describe('updateProject', () => {
		it('updates project with new values', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateProject('p1', 'org-1', { name: 'Updated', model: 'new-model' });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.name).toBe('Updated');
			expect(setArg.model).toBe('new-model');
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe('deleteProject', () => {
		it('deletes project by id and orgId', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteProject('p1', 'org-1');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});
});

describe('cloneProject', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;
	let mockTxInsertValues: ReturnType<typeof vi.fn>;
	let mockTxInsert: ReturnType<typeof vi.fn>;

	const sourceProject = {
		id: 'source-project',
		orgId: 'org-1',
		name: 'Source Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		model: 'gpt-4',
		maxIterations: 50,
		watchdogTimeoutMs: 1800000,
		workItemBudgetUsd: '5.00',
		agentEngine: 'claude-code',
		agentEngineSettings: null,
		progressModel: null,
		progressIntervalMinutes: null,
		runLinksEnabled: false,
		maxInFlightItems: null,
		snapshotEnabled: null,
		snapshotTtlMs: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true, withThenable: true });
		mockReEncryptCredential.mockClear();

		mockTxInsertValues = vi.fn().mockResolvedValue([]);
		mockTxInsert = vi.fn().mockReturnValue({ values: mockTxInsertValues });

		// Wire transaction to call fn with a mock tx
		(mockDb.db as unknown as Record<string, unknown>).transaction = vi
			.fn()
			.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
				fn({ insert: mockTxInsert }),
			);
	});

	it('clones project with all five record groups', async () => {
		const integrations = [
			{
				id: 1,
				projectId: 'source-project',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'abc' },
				triggers: {},
			},
		];
		const credentials = [
			{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'enc:v1:abc', name: 'GH Implementer' },
		];
		const agentConfigRows = [
			{
				id: 1,
				projectId: 'source-project',
				agentType: 'implementation',
				model: null,
				maxIterations: null,
				agentEngine: null,
				agentEngineSettings: null,
				maxConcurrency: null,
				systemPrompt: null,
				taskPrompt: null,
			},
		];
		const triggerConfigRows = [
			{
				id: 1,
				projectId: 'source-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: {},
			},
		];

		// Queue up 5 select results: source project + 4 parallel fetches
		mockDb.chain.where
			.mockResolvedValueOnce([sourceProject]) // source project fetch
			.mockResolvedValueOnce(integrations) // integrations
			.mockResolvedValueOnce(credentials) // credentials
			.mockResolvedValueOnce(agentConfigRows) // agentConfigs
			.mockResolvedValueOnce(triggerConfigRows); // triggerConfigs

		const result = await cloneProject('org-1', 'source-project', 'new-project', 'New Project');

		expect(result).toEqual({ id: 'new-project', name: 'New Project' });

		// Transaction should have been called
		expect(
			(mockDb.db as unknown as Record<string, ReturnType<typeof vi.fn>>).transaction,
		).toHaveBeenCalledTimes(1);

		// Should have 5 inserts: project + integrations + credentials + agentConfigs + triggerConfigs
		expect(mockTxInsert).toHaveBeenCalledTimes(5);

		// Verify project insert (no repo field)
		const projectInsertCall = mockTxInsertValues.mock.calls[0][0];
		expect(projectInsertCall.id).toBe('new-project');
		expect(projectInsertCall.name).toBe('New Project');
		expect(projectInsertCall.orgId).toBe('org-1');
		expect(projectInsertCall.repo).toBeNull();
		expect(projectInsertCall.baseBranch).toBe('main');

		// Verify credentials are re-encrypted
		const credInsertCall = mockTxInsertValues.mock.calls[2][0];
		expect(credInsertCall[0].projectId).toBe('new-project');
		expect(credInsertCall[0].envVarKey).toBe('GITHUB_TOKEN_IMPLEMENTER');
		expect(mockReEncryptCredential).toHaveBeenCalledWith(
			'enc:v1:abc',
			'source-project',
			'new-project',
		);

		// Verify integrations are cloned with new projectId
		const integrationInsertCall = mockTxInsertValues.mock.calls[1][0];
		expect(integrationInsertCall[0].projectId).toBe('new-project');
		expect(integrationInsertCall[0].category).toBe('pm');

		// Verify agentConfigs are cloned
		const agentInsertCall = mockTxInsertValues.mock.calls[3][0];
		expect(agentInsertCall[0].projectId).toBe('new-project');
		expect(agentInsertCall[0].agentType).toBe('implementation');

		// Verify triggerConfigs are cloned
		const triggerInsertCall = mockTxInsertValues.mock.calls[4][0];
		expect(triggerInsertCall[0].projectId).toBe('new-project');
		expect(triggerInsertCall[0].triggerEvent).toBe('pm:status-changed');
	});

	it('throws when source project not found', async () => {
		mockDb.chain.where.mockResolvedValueOnce([]); // empty result → not found

		await expect(cloneProject('org-1', 'missing-project', 'new-id', 'New')).rejects.toThrow(
			'Source project not found: missing-project',
		);

		// Transaction should not have been called
		expect(
			(mockDb.db as unknown as Record<string, ReturnType<typeof vi.fn>>).transaction,
		).not.toHaveBeenCalled();
	});

	it('skips triggerConfigs insert when source has none', async () => {
		mockDb.chain.where
			.mockResolvedValueOnce([sourceProject])
			.mockResolvedValueOnce([]) // no integrations
			.mockResolvedValueOnce([]) // no credentials
			.mockResolvedValueOnce([]) // no agentConfigs
			.mockResolvedValueOnce([]); // no triggerConfigs

		await cloneProject('org-1', 'source-project', 'new-project', 'New Project');

		// Only 1 insert: the project itself (all others have 0 items)
		expect(mockTxInsert).toHaveBeenCalledTimes(1);
		const projectInsertCall = mockTxInsertValues.mock.calls[0][0];
		expect(projectInsertCall.id).toBe('new-project');
	});
});
