/**
 * Grouped env-var-key catalog for the organization credentials page.
 * Named-set provider tabs (engines + GitHub/GitLab) derive from
 * CREDENTIAL_PROVIDERS; PM/alerting keys stay flat-tier and derive from the
 * backend credential-role registry (single source of truth).
 */

import { ENGINE_SECRETS } from '@/components/projects/engine-secrets.js';
import {
	CREDENTIAL_PROVIDERS,
	type CredentialProviderDef,
} from '../../../../src/config/credentialProviders.js';
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

export interface OrgCredentialProviderTab {
	provider: CredentialProviderDef;
	keyMeta: OrgCredentialCatalogEntry[];
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

/** Per-key display metadata for a named-set provider tab. */
function keyMetaForProvider(def: CredentialProviderDef): OrgCredentialCatalogEntry[] {
	if (def.id === 'github' || def.id === 'gitlab') {
		return getCredentialRoles(def.id).map((role) => ({
			envVarKey: role.envVarKey,
			label: role.label,
			description: role.optional ? 'Optional.' : undefined,
		}));
	}
	return def.envVarKeys.map((envVarKey) => {
		const secret = ENGINE_SECRETS.find((s) => s.envVarKey === envVarKey);
		return {
			envVarKey,
			label: secret?.label ?? envVarKey,
			description: secret?.description,
			placeholder: secret?.placeholder,
		};
	});
}

export function buildOrgCredentialCatalog(): {
	providerTabs: OrgCredentialProviderTab[];
	pmSection: OrgCredentialCatalogSection;
	alertingSection: OrgCredentialCatalogSection;
	knownKeys: Set<string>;
} {
	const providerTabs: OrgCredentialProviderTab[] = CREDENTIAL_PROVIDERS.map((provider) => ({
		provider,
		keyMeta: keyMetaForProvider(provider),
	})).filter((tab) => tab.keyMeta.length > 0);

	const pmSection: OrgCredentialCatalogSection = {
		title: 'Project Management',
		entries: providerEntries(['trello', 'jira', 'linear']),
	};
	const alertingSection: OrgCredentialCatalogSection = {
		title: 'Alerting',
		entries: providerEntries(['sentry']),
	};

	// knownKeys keeps EVERY catalogued key (named-set + flat) so the Custom
	// section's "anything else" filter stays unchanged.
	const knownKeys = new Set([
		...providerTabs.flatMap((tab) => tab.keyMeta.map((entry) => entry.envVarKey)),
		...pmSection.entries.map((entry) => entry.envVarKey),
		...alertingSection.entries.map((entry) => entry.envVarKey),
	]);
	return { providerTabs, pmSection, alertingSection, knownKeys };
}
