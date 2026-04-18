/**
 * Step-component adapters for JIRA.
 *
 * Bridges the generic renderer's `{ state, dispatch, providerHooks }`
 * props into the existing JIRA step components' per-provider prop
 * shapes. The step implementations stay unchanged; only the wrapping
 * signature is adapted.
 */

import type { UseMutationResult } from '@tanstack/react-query';
import {
	JiraCredentialsStep,
	JiraFieldMappingStep,
	JiraProjectStep,
} from '../../pm-wizard-jira-steps.js';
import type { ProviderWizardStepProps } from '../types.js';

export interface JiraProviderHooks {
	readonly onProjectSelect: (key: string) => void;
	readonly jiraProjectsMutation: UseMutationResult<unknown, Error, void, unknown>;
	readonly jiraDetailsMutation: UseMutationResult<unknown, Error, string, unknown>;
	readonly onCreateCostField: () => void;
	readonly creatingCostField: boolean;
}

function asJiraHooks(providerHooks: Record<string, unknown> | undefined): JiraProviderHooks {
	return (providerHooks ?? {}) as unknown as JiraProviderHooks;
}

export function JiraCredentialsStepAdapter({ state, dispatch }: ProviderWizardStepProps) {
	return <JiraCredentialsStep state={state} dispatch={dispatch} />;
}

export function JiraProjectStepAdapter({ state, providerHooks }: ProviderWizardStepProps) {
	const h = asJiraHooks(providerHooks);
	return (
		<JiraProjectStep
			state={state}
			onProjectSelect={h.onProjectSelect}
			jiraProjectsMutation={h.jiraProjectsMutation}
			jiraDetailsMutation={h.jiraDetailsMutation}
		/>
	);
}

export function JiraFieldMappingStepAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps) {
	const h = asJiraHooks(providerHooks);
	return (
		<JiraFieldMappingStep
			state={state}
			dispatch={dispatch}
			onCreateCostField={h.onCreateCostField}
			creatingCostField={h.creatingCostField}
		/>
	);
}
