import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentExecutionContext } from '../../../../src/triggers/shared/agent-execution-types.js';

const {
	mockCheckBudgetExceeded,
	mockHandleAgentResultArtifacts,
	mockValidateIntegrations,
	mockFormatValidationErrors,
	mockLogger,
} = vi.hoisted(() => ({
	mockCheckBudgetExceeded: vi.fn(),
	mockHandleAgentResultArtifacts: vi.fn(),
	mockValidateIntegrations: vi.fn(),
	mockFormatValidationErrors: vi.fn().mockReturnValue('formatted validation error'),
	mockLogger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../src/triggers/shared/budget.js', () => ({
	checkBudgetExceeded: mockCheckBudgetExceeded,
}));

vi.mock('../../../../src/triggers/shared/agent-result-handler.js', () => ({
	handleAgentResultArtifacts: mockHandleAgentResultArtifacts,
}));

vi.mock('../../../../src/triggers/shared/integration-validation.js', () => ({
	validateIntegrations: mockValidateIntegrations,
	formatValidationErrors: mockFormatValidationErrors,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import {
	checkPreRunBudget,
	prepareAgentLifecycle,
	runPostAgentLifecycle,
	validateAgentExecution,
} from '../../../../src/triggers/shared/agent-execution-lifecycle.js';

function makeLifecycle() {
	return {
		prepareForAgent: vi.fn().mockResolvedValue(undefined),
		handleBudgetExceeded: vi.fn().mockResolvedValue(undefined),
		handleBudgetWarning: vi.fn().mockResolvedValue(undefined),
		cleanupProcessing: vi.fn().mockResolvedValue(undefined),
		handleSuccess: vi.fn().mockResolvedValue(undefined),
		handleFailure: vi.fn().mockResolvedValue(undefined),
	};
}

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
	return {
		result: { agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
		project: { id: 'project-1', pm: { type: 'trello' } } as AgentExecutionContext['project'],
		config: {} as AgentExecutionContext['config'],
		executionConfig: {},
		agentType: 'implementation',
		logLabel: 'Agent',
		lifecycle: makeLifecycle() as unknown as AgentExecutionContext['lifecycle'],
		lifecycleHooks: {},
		workItemId: 'card-1',
		agentInput: { workItemId: 'card-1' },
		...overrides,
	};
}

describe('agent execution lifecycle helper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockFormatValidationErrors.mockReturnValue('formatted validation error');
	});

	describe('validateAgentExecution', () => {
		it('returns true when validation passes', async () => {
			const context = makeContext();

			await expect(validateAgentExecution(context.result, context)).resolves.toBe(true);

			expect(mockValidateIntegrations).toHaveBeenCalledWith(
				'project-1',
				'implementation',
				context.project,
			);
			expect(context.lifecycle.handleFailure).not.toHaveBeenCalled();
		});

		it('formats, logs, notifies PM, and invokes onFailure for non-PM validation failures', async () => {
			mockValidateIntegrations.mockResolvedValueOnce({
				valid: false,
				errors: [{ category: 'scm', message: 'missing token' }],
			});
			const onFailure = vi.fn().mockResolvedValue(undefined);
			const context = makeContext({ executionConfig: { onFailure } });

			await expect(validateAgentExecution(context.result, context)).resolves.toBe(false);

			expect(mockFormatValidationErrors).toHaveBeenCalledWith({
				valid: false,
				errors: [{ category: 'scm', message: 'missing token' }],
			});
			expect(mockLogger.error).toHaveBeenCalledWith('Integration validation failed', {
				agentType: 'implementation',
				projectId: 'project-1',
				errors: [{ category: 'scm', message: 'missing token' }],
			});
			expect(context.lifecycle.handleFailure).toHaveBeenCalledWith(
				'card-1',
				'formatted validation error',
			);
			expect(onFailure).toHaveBeenCalledWith(context.result, {
				success: false,
				output: '',
				error: 'formatted validation error',
			});
		});

		it('skips PM notification when PM validation failed but still invokes onFailure', async () => {
			mockValidateIntegrations.mockResolvedValueOnce({
				valid: false,
				errors: [{ category: 'pm', message: 'missing PM integration' }],
			});
			const onFailure = vi.fn().mockResolvedValue(undefined);
			const context = makeContext({ executionConfig: { onFailure } });

			await expect(validateAgentExecution(context.result, context)).resolves.toBe(false);

			expect(context.lifecycle.handleFailure).not.toHaveBeenCalled();
			expect(onFailure).toHaveBeenCalledWith(context.result, {
				success: false,
				output: '',
				error: 'formatted validation error',
			});
		});
	});

	describe('checkPreRunBudget', () => {
		it('aborts and notifies lifecycle when budget is exceeded', async () => {
			const lifecycle = makeLifecycle();
			mockCheckBudgetExceeded.mockResolvedValueOnce({
				exceeded: true,
				currentCost: 10,
				budget: 7,
				remaining: 0,
			});

			await expect(
				checkPreRunBudget(
					'card-1',
					{ id: 'project-1' } as AgentExecutionContext['project'],
					lifecycle as unknown as AgentExecutionContext['lifecycle'],
				),
			).resolves.toEqual({ remainingBudgetUsd: undefined, abort: true });

			expect(mockLogger.warn).toHaveBeenCalledWith('Budget exceeded, agent not started', {
				workItemId: 'card-1',
				currentCost: 10,
				budget: 7,
			});
			expect(lifecycle.handleBudgetExceeded).toHaveBeenCalledWith('card-1', 10, 7);
		});

		it('returns remaining budget when under budget', async () => {
			mockCheckBudgetExceeded.mockResolvedValueOnce({
				exceeded: false,
				currentCost: 2,
				budget: 7,
				remaining: 5,
			});

			await expect(
				checkPreRunBudget(
					'card-1',
					{ id: 'project-1' } as AgentExecutionContext['project'],
					makeLifecycle() as unknown as AgentExecutionContext['lifecycle'],
				),
			).resolves.toEqual({ remainingBudgetUsd: 5, abort: false });
		});
	});

	describe('prepareAgentLifecycle', () => {
		it('calls prepareForAgent unless skipPrepareForAgent is set', async () => {
			const context = makeContext();

			await prepareAgentLifecycle(context);

			expect(context.lifecycle.prepareForAgent).toHaveBeenCalledWith('card-1', {});
		});

		it('does not call prepareForAgent when skipped', async () => {
			const context = makeContext({ executionConfig: { skipPrepareForAgent: true } });

			await prepareAgentLifecycle(context);

			expect(context.lifecycle.prepareForAgent).not.toHaveBeenCalled();
		});
	});

	describe('runPostAgentLifecycle', () => {
		it('runs artifacts, budget warning, cleanup, and success in order', async () => {
			mockCheckBudgetExceeded.mockResolvedValueOnce({
				exceeded: true,
				currentCost: 8,
				budget: 7,
				remaining: 0,
			});
			const lifecycle = makeLifecycle();
			const context = makeContext({
				lifecycle: lifecycle as unknown as AgentExecutionContext['lifecycle'],
			});

			await runPostAgentLifecycle(context, {
				success: true,
				output: '',
				prUrl: 'https://github.com/acme/app/pull/1',
				progressCommentId: 'progress-1',
			});

			expect(mockHandleAgentResultArtifacts).toHaveBeenCalledWith(
				'card-1',
				'implementation',
				expect.objectContaining({ success: true }),
				context.project,
			);
			expect(lifecycle.handleBudgetWarning).toHaveBeenCalledWith('card-1', 8, 7);
			expect(lifecycle.cleanupProcessing).toHaveBeenCalledWith('card-1');
			expect(lifecycle.handleSuccess).toHaveBeenCalledWith(
				'card-1',
				{},
				'https://github.com/acme/app/pull/1',
				'progress-1',
			);

			expect(mockHandleAgentResultArtifacts.mock.invocationCallOrder[0]).toBeLessThan(
				lifecycle.handleBudgetWarning.mock.invocationCallOrder[0],
			);
			expect(lifecycle.handleBudgetWarning.mock.invocationCallOrder[0]).toBeLessThan(
				lifecycle.cleanupProcessing.mock.invocationCallOrder[0],
			);
			expect(lifecycle.cleanupProcessing.mock.invocationCallOrder[0]).toBeLessThan(
				lifecycle.handleSuccess.mock.invocationCallOrder[0],
			);
		});

		it('honors skipPrepareForAgent, skipHandleFailure, and handleSuccessOnlyForAgentType', async () => {
			const context = makeContext({
				agentType: 'review',
				executionConfig: {
					skipPrepareForAgent: true,
					skipHandleFailure: true,
					handleSuccessOnlyForAgentType: 'implementation',
				},
			});

			await runPostAgentLifecycle(context, { success: false, output: '', error: 'failed' });

			expect(context.lifecycle.cleanupProcessing).not.toHaveBeenCalled();
			expect(context.lifecycle.handleSuccess).not.toHaveBeenCalled();
			expect(context.lifecycle.handleFailure).not.toHaveBeenCalled();
		});

		it('calls handleFailure for failed agents when failure handling is enabled', async () => {
			const context = makeContext();

			await runPostAgentLifecycle(context, { success: false, output: '', error: 'failed' });

			expect(context.lifecycle.handleFailure).toHaveBeenCalledWith('card-1', 'failed');
		});
	});
});
