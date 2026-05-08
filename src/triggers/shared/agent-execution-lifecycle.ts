import type { AgentResult, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import type { AgentExecutionConfig, AgentExecutionContext } from './agent-execution-types.js';
import { handleAgentResultArtifacts } from './agent-result-handler.js';
import { checkBudgetExceeded } from './budget.js';
import {
	formatValidationErrors,
	type ValidationResult,
	validateIntegrations,
} from './integration-validation.js';

/**
 * Run integration validation before agent execution and notify the source when
 * validation fails.
 */
export async function validateAgentExecution(
	result: TriggerResult,
	context: Pick<AgentExecutionContext, 'agentType' | 'project' | 'lifecycle' | 'executionConfig'>,
): Promise<boolean> {
	const validation = await validateIntegrations(
		context.project.id,
		context.agentType,
		context.project,
	);
	if (validation.valid) return true;

	await notifyValidationFailure(
		result,
		validation,
		context.lifecycle,
		context.executionConfig,
		context.agentType,
		context.project.id,
	);
	return false;
}

/**
 * Check the budget before running an agent.
 * Returns the remaining budget if not exceeded, or null to signal the caller
 * should abort (budget exceeded and lifecycle notified).
 */
export async function checkPreRunBudget(
	workItemId: string,
	project: ProjectConfig,
	lifecycle: AgentExecutionContext['lifecycle'],
): Promise<{ remainingBudgetUsd: number | undefined; abort: boolean }> {
	const budgetCheck = await checkBudgetExceeded(workItemId, project);
	if (budgetCheck?.exceeded) {
		logger.warn('Budget exceeded, agent not started', {
			workItemId,
			currentCost: budgetCheck.currentCost,
			budget: budgetCheck.budget,
		});
		await lifecycle.handleBudgetExceeded(workItemId, budgetCheck.currentCost, budgetCheck.budget);
		return { remainingBudgetUsd: undefined, abort: true };
	}
	return { remainingBudgetUsd: budgetCheck?.remaining, abort: false };
}

/**
 * Prepare the PM lifecycle state before running an agent.
 */
export async function prepareAgentLifecycle(context: AgentExecutionContext): Promise<void> {
	if (context.workItemId && !context.executionConfig.skipPrepareForAgent) {
		await context.lifecycle.prepareForAgent(context.workItemId, context.lifecycleHooks);
	}
}

/**
 * Run post-agent lifecycle steps: artifact handling, budget warning, cleanup,
 * success/failure.
 */
export async function runPostAgentLifecycle(
	context: AgentExecutionContext,
	agentResult: AgentResult,
): Promise<void> {
	const workItemId = context.workItemId;
	if (!workItemId) return;

	const {
		skipPrepareForAgent = false,
		skipHandleFailure = false,
		handleSuccessOnlyForAgentType,
	} = context.executionConfig;

	await handleAgentResultArtifacts(workItemId, context.agentType, agentResult, context.project);

	const postBudgetCheck = await checkBudgetExceeded(workItemId, context.project);
	if (postBudgetCheck?.exceeded) {
		await context.lifecycle.handleBudgetWarning(
			workItemId,
			postBudgetCheck.currentCost,
			postBudgetCheck.budget,
		);
	}

	if (!skipPrepareForAgent) {
		await context.lifecycle.cleanupProcessing(workItemId);
	}

	const shouldCallHandleSuccess =
		agentResult.success &&
		(!handleSuccessOnlyForAgentType || context.agentType === handleSuccessOnlyForAgentType);

	if (shouldCallHandleSuccess) {
		await context.lifecycle.handleSuccess(
			workItemId,
			context.lifecycleHooks,
			agentResult.prUrl,
			agentResult.progressCommentId,
		);
	} else if (!agentResult.success && !skipHandleFailure) {
		await context.lifecycle.handleFailure(workItemId, agentResult.error);
	}
}

/**
 * Notify PM and GitHub when integration validation fails before the agent runs.
 */
async function notifyValidationFailure(
	result: TriggerResult,
	validation: ValidationResult,
	lifecycle: AgentExecutionContext['lifecycle'],
	executionConfig: AgentExecutionConfig,
	agentType: string,
	projectId: string,
): Promise<void> {
	const errorMessage = formatValidationErrors(validation);
	logger.error('Integration validation failed', {
		agentType,
		projectId,
		errors: validation.errors,
	});

	// Only notify via PM if PM validation passed (otherwise PM isn't configured)
	const pmFailed = validation.errors.some((e) => e.category === 'pm');
	if (result.workItemId && !pmFailed) {
		await lifecycle.handleFailure(result.workItemId, errorMessage);
	}

	// Call onFailure callback (for GitHub PR updates)
	if (executionConfig.onFailure) {
		await executionConfig.onFailure(result, { success: false, output: '', error: errorMessage });
	}
}
