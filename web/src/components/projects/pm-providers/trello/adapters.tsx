/**
 * Step-component adapters for Trello.
 *
 * The generic wizard renderer passes `{ state, dispatch, providerHooks }`
 * to each step component. Trello's existing `TrelloCredentialsStep` /
 * `TrelloBoardStep` / `TrelloFieldMappingStep` expect provider-specific
 * prop shapes (onBoardSelect, boardsMutation, onCreateLabel, etc.) that
 * originate from Trello's React hooks. These thin adapters bridge the
 * generic renderer shape into the existing component shape — letting
 * the existing step implementations stay exactly as-is.
 *
 * The legacy path in `pm-wizard.tsx` continues to call the step
 * components directly with the old props until the Trello branch is
 * deleted in task 3 of this plan. Both paths share the same underlying
 * step components.
 */

import type { UseMutationResult } from '@tanstack/react-query';
import {
	TrelloBoardStep,
	TrelloCredentialsStep,
	TrelloFieldMappingStep,
} from '../../pm-wizard-trello-steps.js';
import type { ProviderWizardStepProps } from '../types.js';

// --- Type of the hooks composition produced by trelloProviderWizard.useProviderHooks ---

export interface TrelloProviderHooks {
	readonly onBoardSelect: (boardId: string) => void;
	readonly boardsMutation: UseMutationResult<unknown, Error, void, unknown>;
	readonly boardDetailsMutation: UseMutationResult<unknown, Error, string, unknown>;
	readonly onCreateLabel: (slot: string) => void;
	readonly onCreateAllMissingLabels: () => void;
	readonly onCreateCostField: () => void;
	readonly creatingSlot: string | null;
	readonly creatingCostField: boolean;
}

function asTrelloHooks(providerHooks: Record<string, unknown> | undefined): TrelloProviderHooks {
	return (providerHooks ?? {}) as unknown as TrelloProviderHooks;
}

export function TrelloCredentialsStepAdapter({ state, dispatch }: ProviderWizardStepProps) {
	return <TrelloCredentialsStep state={state} dispatch={dispatch} />;
}

export function TrelloBoardStepAdapter({ state, providerHooks }: ProviderWizardStepProps) {
	const h = asTrelloHooks(providerHooks);
	return (
		<TrelloBoardStep
			state={state}
			onBoardSelect={h.onBoardSelect}
			boardsMutation={h.boardsMutation}
			boardDetailsMutation={h.boardDetailsMutation}
		/>
	);
}

export function TrelloFieldMappingStepAdapter({
	state,
	dispatch,
	providerHooks,
}: ProviderWizardStepProps) {
	const h = asTrelloHooks(providerHooks);
	return (
		<TrelloFieldMappingStep
			state={state}
			dispatch={dispatch}
			onCreateLabel={h.onCreateLabel}
			onCreateAllMissingLabels={h.onCreateAllMissingLabels}
			onCreateCostField={h.onCreateCostField}
			creatingSlot={h.creatingSlot}
			creatingCostField={h.creatingCostField}
		/>
	);
}
