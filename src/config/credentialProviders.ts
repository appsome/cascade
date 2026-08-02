import { getCredentialRoles } from './integrationRoles.js';

/**
 * Credential providers that support multiple NAMED credential sets at the
 * organization level (org_credential_sets). Everything else (Trello, JIRA,
 * Linear, Sentry, custom keys) stays on the flat single-value org tier.
 *
 * This module is imported by both the backend (repositories, tRPC routers)
 * and the web bundle (org credentials tabs, project selectors) — keep it
 * dependency-light. Precedent: integrationRoles.ts.
 *
 * The VALUES key→provider mapping in migration 0063_named_org_credentials.sql
 * must mirror `envVarKeys` below — a hygiene test greps the SQL for every key.
 */
export type CredentialProviderId = 'anthropic' | 'openai' | 'openrouter' | 'github' | 'gitlab';

export interface CredentialProviderDef {
	id: CredentialProviderId;
	/** Tab label in the org credentials view. */
	label: string;
	/** Env var keys resolvable through named sets for this provider. */
	envVarKeys: string[];
	/**
	 * True when a project may select an ORDERED POOL of sets (rotation);
	 * false = single selection.
	 */
	multiSelect: boolean;
}

function scmKeys(provider: string): string[] {
	return getCredentialRoles(provider).map((r) => r.envVarKey);
}

export const CREDENTIAL_PROVIDERS: CredentialProviderDef[] = [
	{
		id: 'anthropic',
		label: 'Anthropic',
		envVarKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
		multiSelect: true,
	},
	{
		id: 'openai',
		label: 'OpenAI / Codex',
		envVarKeys: ['OPENAI_API_KEY', 'CODEX_AUTH_JSON'],
		multiSelect: false,
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		envVarKeys: ['OPENROUTER_API_KEY'],
		multiSelect: false,
	},
	{
		id: 'github',
		label: 'GitHub',
		envVarKeys: scmKeys('github'),
		multiSelect: false,
	},
	{
		id: 'gitlab',
		label: 'GitLab',
		envVarKeys: scmKeys('gitlab'),
		multiSelect: false,
	},
];

const providerByKey = new Map<string, CredentialProviderId>();
for (const provider of CREDENTIAL_PROVIDERS) {
	for (const key of provider.envVarKeys) {
		providerByKey.set(key, provider.id);
	}
}

/** Which named-set provider owns this env var key, or null for flat-tier keys. */
export function providerForEnvVarKey(envVarKey: string): CredentialProviderId | null {
	return providerByKey.get(envVarKey) ?? null;
}

export function getCredentialProvider(id: string): CredentialProviderDef | null {
	return CREDENTIAL_PROVIDERS.find((p) => p.id === id) ?? null;
}
