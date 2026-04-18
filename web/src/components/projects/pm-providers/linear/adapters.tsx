/**
 * Step-component adapters for Linear.
 *
 * Bridges the generic renderer's `{ state, dispatch, providerHooks }`
 * props into the existing Linear step components' per-provider prop
 * shapes.
 */

import type { UseMutationResult } from '@tanstack/react-query';
import {
	LinearCredentialsStep,
	LinearFieldMappingStep,
	LinearTeamStep,
} from '../../pm-wizard-linear-steps.js';
import type { ProviderWizardStepProps } from '../types.js';

export interface LinearProviderHooks {
	readonly onTeamSelect: (id: string) => void;
	readonly linearTeamsMutation: UseMutationResult<unknown, Error, void, unknown>;
	readonly linearDetailsMutation: UseMutationResult<unknown, Error, string, unknown>;
	readonly linearProjectsMutation: UseMutationResult<unknown, Error, string, unknown>;
	readonly onCreateLabel: (slot: string) => void;
	readonly onCreateAllMissingLabels: () => void;
	readonly creatingSlot: string | null;
}

function asLinearHooks(providerHooks: Record<string, unknown> | undefined): LinearProviderHooks {
	return (providerHooks ?? {}) as unknown as LinearProviderHooks;
}

export function LinearCredentialsStepAdapter({ state, dispatch }: ProviderWizardStepProps) {
	return <LinearCredentialsStep state={state} dispatch={dispatch} />;
}

export function LinearTeamStepAdapter({ state, dispatch, providerHooks }: ProviderWizardStepProps) {
	const h = asLinearHooks(providerHooks);
	return (
		<LinearTeamStep
			state={state}
			onTeamSelect={h.onTeamSelect}
			dispatch={dispatch}
			linearTeamsMutation={h.linearTeamsMutation}
			linearDetailsMutation={h.linearDetailsMutation}
			linearProjectsMutation={h.linearProjectsMutation}
		/>
	);
}

export function LinearFieldMappingStepAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps) {
	const h = asLinearHooks(providerHooks);
	return (
		<LinearFieldMappingStep
			state={state}
			dispatch={dispatch}
			onCreateLabel={h.onCreateLabel}
			onCreateAllMissingLabels={h.onCreateAllMissingLabels}
			creatingSlot={h.creatingSlot}
		/>
	);
}
