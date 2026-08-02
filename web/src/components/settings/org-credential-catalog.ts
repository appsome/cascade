/**
 * Grouped env-var-key catalog for the organization credentials page.
 * Integration keys derive from the backend credential-role registry
 * (single source of truth); engine/LLM keys come from ENGINE_SECRETS.
 */

import { ENGINE_SECRETS } from '@/components/projects/engine-secrets.js';
import { getCredentialRoles } from '../../../../src/config/integrationRoles.js';

export interface OrgCredentialCatalogEntry {
	envVarKey: string;
	label: string;
	description?: string;
	placeholder?: string;
}

export interface OrgCredentialCatalogSection {
	title: string;
	entries: OrgCredentialCatalogEntry[];
}

const PROVIDER_LABELS: Record<string, string> = {
	github: 'GitHub',
	gitlab: 'GitLab',
	trello: 'Trello',
	jira: 'JIRA',
	linear: 'Linear',
	sentry: 'Sentry',
};

function providerEntries(providers: string[]): OrgCredentialCatalogEntry[] {
	return providers.flatMap((provider) =>
		getCredentialRoles(provider).map((role) => ({
			envVarKey: role.envVarKey,
			label: `${PROVIDER_LABELS[provider] ?? provider} — ${role.label}`,
			description: role.optional ? 'Optional.' : undefined,
		})),
	);
}

export function buildOrgCredentialCatalog(): {
	sections: OrgCredentialCatalogSection[];
	knownKeys: Set<string>;
} {
	// 'gitlab' resolves to an empty role list until the GitLab integration is
	// present; the empty-section filter below keeps the UI clean either way.
	const sections: OrgCredentialCatalogSection[] = [
		{ title: 'Source Control', entries: providerEntries(['github', 'gitlab']) },
		{ title: 'Project Management', entries: providerEntries(['trello', 'jira', 'linear']) },
		{ title: 'Alerting', entries: providerEntries(['sentry']) },
		{
			title: 'Engines / LLM',
			entries: ENGINE_SECRETS.map((secret) => ({
				envVarKey: secret.envVarKey,
				label: secret.label,
				description: secret.description,
				placeholder: secret.placeholder,
			})),
		},
	].filter((section) => section.entries.length > 0);

	const knownKeys = new Set(
		sections.flatMap((section) => section.entries.map((entry) => entry.envVarKey)),
	);
	return { sections, knownKeys };
}
