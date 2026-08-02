import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	CREDENTIAL_PROVIDERS,
	getCredentialProvider,
	providerForEnvVarKey,
} from '../../../src/config/credentialProviders.js';
import { getCredentialRoles } from '../../../src/config/integrationRoles.js';

describe('credentialProviders', () => {
	it('maps every provider key back to its provider', () => {
		for (const provider of CREDENTIAL_PROVIDERS) {
			for (const key of provider.envVarKeys) {
				expect(providerForEnvVarKey(key)).toBe(provider.id);
			}
		}
	});

	it('returns null for flat-tier keys (PM, alerting, custom)', () => {
		expect(providerForEnvVarKey('TRELLO_API_KEY')).toBeNull();
		expect(providerForEnvVarKey('LINEAR_API_KEY')).toBeNull();
		expect(providerForEnvVarKey('SENTRY_API_TOKEN')).toBeNull();
		expect(providerForEnvVarKey('EXTERNAL_WEBHOOK_PASSWORD_IMPLEMENTATION')).toBeNull();
		expect(providerForEnvVarKey('SOME_CUSTOM_KEY')).toBeNull();
	});

	it('only anthropic supports multi-select (rotation pool)', () => {
		expect(getCredentialProvider('anthropic')?.multiSelect).toBe(true);
		for (const provider of CREDENTIAL_PROVIDERS.filter((p) => p.id !== 'anthropic')) {
			expect(provider.multiSelect).toBe(false);
		}
	});

	it('github/gitlab keys track the credential-role registry', () => {
		expect(getCredentialProvider('github')?.envVarKeys).toEqual(
			getCredentialRoles('github').map((r) => r.envVarKey),
		);
		expect(getCredentialProvider('gitlab')?.envVarKeys).toEqual(
			getCredentialRoles('gitlab').map((r) => r.envVarKey),
		);
	});

	it('getCredentialProvider rejects unknown ids', () => {
		expect(getCredentialProvider('asana')).toBeNull();
	});

	// Hygiene: the migration's VALUES key→provider mapping must mirror this
	// module — a key added here but not in the backfill would strand existing
	// flat-tier rows outside the Default set.
	it('migration 0063 backfill covers every provider env var key', () => {
		const sql = readFileSync(
			join(process.cwd(), 'src/db/migrations/0063_named_org_credentials.sql'),
			'utf8',
		);
		for (const provider of CREDENTIAL_PROVIDERS) {
			for (const key of provider.envVarKeys) {
				expect(sql, `migration 0063 must map ${key} to provider ${provider.id}`).toContain(
					`('${key}'`,
				);
			}
		}
	});
});
