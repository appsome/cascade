/**
 * Trello ProviderWizardDefinition — the frontend half of the manifest
 * pattern. Registered via `./index.ts` at module load.
 *
 * `useProviderHooks` composes the existing Trello hooks
 * (`useTrelloDiscovery`, `useTrelloLabelCreation`,
 * `useTrelloCustomFieldCreation`) and exposes the mutations + handlers
 * the step adapters consume. This is where the per-provider React
 * wiring lives; `pm-wizard.tsx` no longer needs to call
 * `useTrelloDiscovery` directly (task 3 of this plan removes those
 * calls from the parent wizard).
 */

import { useState } from 'react';
import {
	useTrelloCustomFieldCreation,
	useTrelloDiscovery,
	useTrelloLabelCreation,
} from '../../pm-wizard-hooks.js';
import { TRELLO_LABEL_DEFAULTS } from '../../pm-wizard-trello-steps.js';
import type { ProviderWizardDefinition } from '../types.js';
import {
	TrelloBoardStepAdapter,
	TrelloCredentialsStepAdapter,
	TrelloFieldMappingStepAdapter,
} from './adapters.js';

function isCredentialsComplete(state: {
	trelloApiKey: string;
	trelloToken: string;
	verificationResult: unknown;
	isEditing: boolean;
	hasStoredCredentials: boolean;
}): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	return Boolean(state.trelloApiKey && state.trelloToken && state.verificationResult);
}

export const trelloProviderWizard: ProviderWizardDefinition = {
	id: 'trello',
	label: 'Trello',

	steps: [
		{
			id: 'credentials',
			title: 'Trello credentials',
			Component: TrelloCredentialsStepAdapter,
			isComplete: isCredentialsComplete,
		},
		{
			id: 'board',
			title: 'Board',
			Component: TrelloBoardStepAdapter,
			isComplete: (state) => Boolean(state.trelloBoardId),
		},
		{
			id: 'fields',
			title: 'Field mappings',
			Component: TrelloFieldMappingStepAdapter,
			isComplete: (state) => Object.keys(state.trelloListMappings).length > 0,
		},
	],

	// Shape mirrors the existing inline save body in `useSaveMutation`
	// (pm-wizard-hooks.ts). `saveMutation` still constructs the same shape
	// directly while the parent wizard owns the save flow; plan 006/5 will
	// consolidate save onto `def.buildIntegrationConfig` and remove the
	// per-provider if/else in `saveMutation`.
	buildIntegrationConfig: (state) => ({
		boardId: state.trelloBoardId,
		lists: state.trelloListMappings,
		labels: state.trelloLabelMappings,
		...(state.trelloCostFieldId ? { customFields: { cost: state.trelloCostFieldId } } : {}),
	}),

	isSetupComplete: (state) => {
		if (!state.trelloBoardId) return false;
		if (Object.keys(state.trelloListMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ state, dispatch, projectId, advanceToStep }) => {
		// Parent wizard previously called these at the top level; moved here so
		// pm-wizard.tsx no longer contains Trello-specific hook wiring.
		const discovery = useTrelloDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const labels = useTrelloLabelCreation(state, dispatch);
		const customField = useTrelloCustomFieldCreation(state, dispatch);

		// creatingSlot + creatingCostField are shared setter state between parent
		// components. For the manifest path we recreate them here; the Trello
		// wizard UI only renders while the manifest shell is mounted.
		const [creatingSlot, setCreatingSlot] = useState<string | null>(null);
		const [creatingCostField, setCreatingCostField] = useState(false);

		const onCreateLabel = (slot: string) => {
			const defaults = TRELLO_LABEL_DEFAULTS[slot];
			if (!defaults) return;
			setCreatingSlot(slot);
			labels.createLabelMutation.mutate(
				{ name: defaults.name, color: defaults.color, slot },
				{ onSettled: () => setCreatingSlot(null) },
			);
		};

		const onCreateAllMissingLabels = () => {
			const existingLabelNames = new Set(
				(state.trelloBoardDetails?.labels ?? []).map((l) => l.name.toLowerCase()),
			);
			const labelsToCreate = Object.entries(TRELLO_LABEL_DEFAULTS)
				.filter(([slot, { name }]) => {
					if (state.trelloLabelMappings[slot]) return false;
					return !existingLabelNames.has(name.toLowerCase());
				})
				.map(([slot, { name, color }]) => ({ slot, name, color }));
			if (labelsToCreate.length > 0) {
				setCreatingSlot('__batch__');
				labels.createMissingLabelsMutation.mutate(labelsToCreate, {
					onSettled: () => setCreatingSlot(null),
				});
			}
		};

		const onCreateCostField = () => {
			setCreatingCostField(true);
			customField.createCustomFieldMutation.mutate(undefined, {
				onSettled: () => setCreatingCostField(false),
			});
		};

		return {
			onBoardSelect: discovery.handleBoardSelect,
			boardsMutation: discovery.boardsMutation,
			boardDetailsMutation: discovery.boardDetailsMutation,
			onCreateLabel,
			onCreateAllMissingLabels,
			onCreateCostField,
			creatingSlot,
			creatingCostField,
		};
	},
};
