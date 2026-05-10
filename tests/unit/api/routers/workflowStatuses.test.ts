import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../../../../src/agents/definitions/schema.js';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockResolveAgentDefinition,
	mockCreateCustomWorkflowStatusDefinition,
	mockDeleteCustomWorkflowStatusDefinition,
	mockGetCustomWorkflowStatusDefinition,
	mockListCustomWorkflowStatusDefinitions,
	mockUpdateCustomWorkflowStatusDefinition,
} = vi.hoisted(() => ({
	mockResolveAgentDefinition: vi.fn(),
	mockCreateCustomWorkflowStatusDefinition: vi.fn(),
	mockDeleteCustomWorkflowStatusDefinition: vi.fn(),
	mockGetCustomWorkflowStatusDefinition: vi.fn(),
	mockListCustomWorkflowStatusDefinitions: vi.fn(),
	mockUpdateCustomWorkflowStatusDefinition: vi.fn(),
}));

vi.mock('../../../../src/agents/definitions/loader.js', () => ({
	resolveAgentDefinition: mockResolveAgentDefinition,
}));

vi.mock('../../../../src/db/repositories/workflowStatusDefinitionsRepository.js', () => ({
	createCustomWorkflowStatusDefinition: mockCreateCustomWorkflowStatusDefinition,
	deleteCustomWorkflowStatusDefinition: mockDeleteCustomWorkflowStatusDefinition,
	getCustomWorkflowStatusDefinition: mockGetCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions: mockListCustomWorkflowStatusDefinitions,
	updateCustomWorkflowStatusDefinition: mockUpdateCustomWorkflowStatusDefinition,
}));

import { workflowStatusesRouter } from '../../../../src/api/routers/workflowStatuses.js';

const createCaller = createCallerFor(workflowStatusesRouter);
const user = createMockUser();
const superAdmin = createMockSuperAdmin();

function mockAgentDefinition(): AgentDefinition {
	return {
		identity: {
			emoji: 'P',
			label: 'PRD',
			roleHint: 'Writes PRDs',
			initialMessage: 'Writing PRD',
		},
		integrations: { required: ['pm'], optional: [] },
		capabilities: {
			required: ['fs:read', 'shell:exec', 'session:ctrl', 'pm:read', 'pm:write'],
			optional: [],
		},
		triggers: [],
		strategies: {},
		hint: 'Write a PRD.',
		prompts: { taskPrompt: 'Write a PRD for <%= it.workItemId %>.' },
		requiredContext: [],
	};
}

describe('workflowStatusesRouter', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockListCustomWorkflowStatusDefinitions.mockResolvedValue([]);
		mockGetCustomWorkflowStatusDefinition.mockResolvedValue(null);
		mockResolveAgentDefinition.mockResolvedValue(mockAgentDefinition());
	});

	it('lists builtin statuses and custom statuses', async () => {
		mockListCustomWorkflowStatusDefinitions.mockResolvedValue([
			{
				id: 1,
				key: 'prd',
				label: 'PRD',
				agentType: 'prd',
				sortOrder: 1000,
				createdAt: null,
				updatedAt: null,
			},
		]);

		const caller = createCaller({ user, effectiveOrgId: user.orgId });
		const result = await caller.list();

		expect(result[0]).toMatchObject({ key: 'backlog', isBuiltin: true });
		expect(result).toContainEqual({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
			isBuiltin: false,
		});
	});

	it('creates a custom workflow status', async () => {
		mockCreateCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
			createdAt: null,
			updatedAt: null,
		});

		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });
		await caller.create({ key: 'prd', label: 'PRD', agentType: 'prd', sortOrder: 1000 });

		expect(mockResolveAgentDefinition).toHaveBeenCalledWith('prd');
		expect(mockCreateCustomWorkflowStatusDefinition).toHaveBeenCalledWith({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
		});
	});

	it('rejects builtin key collisions', async () => {
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(
			caller.create({ key: 'todo', label: 'Todo override', agentType: 'prd' }),
			'CONFLICT',
		);
	});

	it('rejects unknown agent types', async () => {
		mockResolveAgentDefinition.mockRejectedValue(new Error('not found'));
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expectTRPCError(
			caller.create({ key: 'prd', label: 'PRD', agentType: 'missing-agent' }),
			'BAD_REQUEST',
		);
	});

	it('rejects mutation from non-superadmin users', async () => {
		const caller = createCaller({ user, effectiveOrgId: user.orgId });

		await expectTRPCError(caller.create({ key: 'prd', label: 'PRD' }), 'FORBIDDEN');
	});

	it('updates a custom workflow status', async () => {
		mockUpdateCustomWorkflowStatusDefinition.mockResolvedValue({
			id: 1,
			key: 'prd',
			label: 'Product Requirements',
			agentType: null,
			sortOrder: 1010,
			createdAt: null,
			updatedAt: null,
		});
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		const result = await caller.update({
			key: 'prd',
			label: 'Product Requirements',
			agentType: null,
			sortOrder: 1010,
		});

		expect(result.label).toBe('Product Requirements');
	});

	it('deletes a custom workflow status', async () => {
		mockDeleteCustomWorkflowStatusDefinition.mockResolvedValue(true);
		const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

		await expect(caller.delete({ key: 'prd' })).resolves.toEqual({ key: 'prd' });
	});
});
