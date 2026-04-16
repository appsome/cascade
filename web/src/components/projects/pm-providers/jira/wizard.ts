/**
 * JIRA ProviderWizardDefinition.
 *
 * `useProviderHooks` composes the existing JIRA hooks:
 * `useJiraDiscovery` (project list + project details) and
 * `useJiraCustomFieldCreation` (the "Create Cost field" button).
 *
 * `buildIntegrationConfig` mirrors the inline JIRA save body in
 * `useSaveMutation`. Plan 006/5 will consolidate the save path onto
 * the manifest's builder.
 */

import { useState } from 'react';
import { useJiraCustomFieldCreation, useJiraDiscovery } from '../../pm-wizard-hooks.js';
import type { ProviderWizardDefinition } from '../types.js';
import {
	JiraCredentialsStepAdapter,
	JiraFieldMappingStepAdapter,
	JiraProjectStepAdapter,
} from './adapters.js';

function isCredentialsComplete(state: {
	jiraEmail: string;
	jiraApiToken: string;
	jiraBaseUrl: string;
	verificationResult: unknown;
	isEditing: boolean;
	hasStoredCredentials: boolean;
}): boolean {
	if (state.isEditing && state.hasStoredCredentials) return true;
	return Boolean(
		state.jiraEmail && state.jiraApiToken && state.jiraBaseUrl && state.verificationResult,
	);
}

export const jiraProviderWizard: ProviderWizardDefinition = {
	id: 'jira',
	label: 'JIRA',

	steps: [
		{
			id: 'credentials',
			title: 'JIRA credentials',
			Component: JiraCredentialsStepAdapter,
			isComplete: isCredentialsComplete,
		},
		{
			id: 'project',
			title: 'Project',
			Component: JiraProjectStepAdapter,
			isComplete: (state) => Boolean(state.jiraProjectKey),
		},
		{
			id: 'fields',
			title: 'Field mappings',
			Component: JiraFieldMappingStepAdapter,
			isComplete: (state) => Object.keys(state.jiraStatusMappings).length > 0,
		},
	],

	// Shape mirrors the existing inline save body in `useSaveMutation`.
	// Plan 006/5 will consolidate the save path onto this builder.
	buildIntegrationConfig: (state) => ({
		projectKey: state.jiraProjectKey,
		baseUrl: state.jiraBaseUrl,
		statuses: state.jiraStatusMappings,
		...(Object.keys(state.jiraIssueTypes).length > 0 ? { issueTypes: state.jiraIssueTypes } : {}),
		...(Object.keys(state.jiraLabels).length > 0 ? { labels: state.jiraLabels } : {}),
		...(state.jiraCostFieldId ? { customFields: { cost: state.jiraCostFieldId } } : {}),
	}),

	isSetupComplete: (state) => {
		if (!state.jiraProjectKey) return false;
		if (Object.keys(state.jiraStatusMappings).length === 0) return false;
		return isCredentialsComplete(state);
	},

	useProviderHooks: ({ state, dispatch, projectId, advanceToStep }) => {
		const discovery = useJiraDiscovery(state, dispatch, advanceToStep, projectId ?? '');
		const customField = useJiraCustomFieldCreation(state, dispatch);

		const [creatingCostField, setCreatingCostField] = useState(false);

		const onCreateCostField = () => {
			setCreatingCostField(true);
			customField.createJiraCustomFieldMutation.mutate(undefined, {
				onSettled: () => setCreatingCostField(false),
			});
		};

		return {
			onProjectSelect: discovery.handleProjectSelect,
			jiraProjectsMutation: discovery.jiraProjectsMutation,
			jiraDetailsMutation: discovery.jiraDetailsMutation,
			onCreateCostField,
			creatingCostField,
		};
	},
};
