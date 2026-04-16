/**
 * Linear ProviderWizardDefinition.
 *
 * `useProviderHooks` composes the existing Linear hooks:
 * `useLinearDiscovery` (teams + details + projects) and
 * `useLinearLabelCreation` (single + batch label creation using the
 * LINEAR_LABEL_DEFAULTS slot map).
 *
 * `buildIntegrationConfig` mirrors the inline Linear save body.
 * Plan 006/5 will consolidate the save path onto the manifest's builder.
 */

import { useState } from 'react';
import { useLinearDiscovery, useLinearLabelCreation } from '../../pm-wizard-hooks.js';
import { LINEAR_LABEL_DEFAULTS } from '../../pm-wizard-linear-steps.js';
import { buildLinearIntegrationConfig } from '../../pm-wizard-state.js';
import type { ProviderWizardDefinition } from '../types.js';
import {
	LinearCredentialsStepAdapter,
	LinearFieldMappingStepAdapter,
	LinearTeamStepAdapter,
} from './adapters.js';

function isCredentialsComplete(state: {
	linearApiKey: string;
	verificationResult: unknown;
	isEditing: boolean;
	hasStoredCredentials: boolean;
}): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	return Boolean(state.linearApiKey && state.verificationResult);
}

export const linearProviderWizard: ProviderWizardDefinition = {
	id: 'linear',
	label: 'Linear',

	steps: [
		{
			id: 'credentials',
			title: 'Linear credentials',
			Component: LinearCredentialsStepAdapter,
			isComplete: isCredentialsComplete,
		},
		{
			id: 'team',
			title: 'Team',
			Component: LinearTeamStepAdapter,
			isComplete: (state) => Boolean(state.linearTeamId),
		},
		{
			id: 'fields',
			title: 'Field mappings',
			Component: LinearFieldMappingStepAdapter,
			isComplete: (state) => Object.keys(state.linearStatusMappings).length > 0,
		},
	],

	buildIntegrationConfig: buildLinearIntegrationConfig,

	isSetupComplete: (state) => {
		if (!state.linearTeamId) return false;
		if (Object.keys(state.linearStatusMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ state, dispatch, projectId, advanceToStep }) => {
		const discovery = useLinearDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const labels = useLinearLabelCreation(state, dispatch);

		const [creatingSlot, setCreatingSlot] = useState<string | null>(null);

		const onCreateLabel = (slot: string) => {
			const defaults = LINEAR_LABEL_DEFAULTS[slot];
			if (!defaults) return;
			setCreatingSlot(slot);
			labels.createLabelMutation.mutate(
				{ name: defaults.name, color: defaults.color, slot },
				{ onSettled: () => setCreatingSlot(null) },
			);
		};

		const onCreateAllMissingLabels = () => {
			const existingLabelNames = new Set(
				(state.linearTeamDetails?.labels ?? []).map((l) => l.name.toLowerCase()),
			);
			const labelsToCreate = Object.entries(LINEAR_LABEL_DEFAULTS)
				.filter(([slot, { name }]) => {
					if (state.linearLabels[slot]) return false;
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

		return {
			onTeamSelect: discovery.handleTeamSelect,
			linearTeamsMutation: discovery.linearTeamsMutation,
			linearDetailsMutation: discovery.linearDetailsMutation,
			linearProjectsMutation: discovery.linearProjectsMutation,
			onCreateLabel,
			onCreateAllMissingLabels,
			creatingSlot,
		};
	},
};
