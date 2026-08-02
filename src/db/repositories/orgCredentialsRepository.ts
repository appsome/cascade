import { and, eq, isNull } from 'drizzle-orm';
import { providerForEnvVarKey } from '../../config/credentialProviders.js';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import { orgCredentialSets, orgCredentials } from '../schema/index.js';
import { getOrCreateDefaultSet, writeSetCredential } from './orgCredentialSetsRepository.js';

// ============================================================================
// Organization-scoped credential storage (org_credentials table)
//
// Org credentials are the shared tier below project_credentials: projects
// inherit them at resolution time, and a project_credentials row with the
// same env_var_key overrides the org value. Values are encrypted with
// AAD = orgId (project credentials use AAD = projectId).
//
// Since migration 0063 the table has two tiers: flat base rows
// (set_id IS NULL — PM/alerting/custom keys) and named-set rows
// (set_id → org_credential_sets, engine + SCM providers). The functions here
// expose the EFFECTIVE org tier: base rows overlaid by the DEFAULT set's
// rows per provider. Named-set CRUD lives in orgCredentialSetsRepository.
// ============================================================================

async function defaultSetRows(
	orgId: string,
): Promise<{ envVarKey: string; value: string; name: string | null }[]> {
	const db = getDb();
	return db
		.select({
			envVarKey: orgCredentials.envVarKey,
			value: orgCredentials.value,
			name: orgCredentialSets.name,
		})
		.from(orgCredentials)
		.innerJoin(orgCredentialSets, eq(orgCredentials.setId, orgCredentialSets.id))
		.where(and(eq(orgCredentials.orgId, orgId), eq(orgCredentialSets.isDefault, true)));
}

/**
 * Resolve a single org credential by env var key from the effective org tier
 * (default set wins over a flat base row with the same key).
 * Returns the decrypted plaintext value, or null if not found.
 */
export async function resolveOrgCredential(
	orgId: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();

	const [setRow] = await db
		.select({ value: orgCredentials.value })
		.from(orgCredentials)
		.innerJoin(orgCredentialSets, eq(orgCredentials.setId, orgCredentialSets.id))
		.where(
			and(
				eq(orgCredentials.orgId, orgId),
				eq(orgCredentials.envVarKey, envVarKey),
				eq(orgCredentialSets.isDefault, true),
			),
		);
	if (setRow) return decryptCredential(setRow.value, orgId);

	const [row] = await db
		.select({ value: orgCredentials.value })
		.from(orgCredentials)
		.where(
			and(
				eq(orgCredentials.orgId, orgId),
				eq(orgCredentials.envVarKey, envVarKey),
				isNull(orgCredentials.setId),
			),
		);

	if (!row) return null;
	return decryptCredential(row.value, orgId);
}

/**
 * Resolve all effective org credentials as a flat env-var-key → value map
 * (base rows first, default-set rows overlaid).
 */
export async function resolveAllOrgCredentials(orgId: string): Promise<Record<string, string>> {
	const db = getDb();

	const baseRows = await db
		.select({ envVarKey: orgCredentials.envVarKey, value: orgCredentials.value })
		.from(orgCredentials)
		.where(and(eq(orgCredentials.orgId, orgId), isNull(orgCredentials.setId)));

	const setRows = await defaultSetRows(orgId);

	const result: Record<string, string> = {};
	for (const row of [...baseRows, ...setRows]) {
		result[row.envVarKey] = decryptCredential(row.value, orgId);
	}
	return result;
}

/**
 * Write (upsert) an org credential with automatic encryption.
 * Keys owned by a named-set provider (engines, GitHub/GitLab) are routed into
 * the provider's DEFAULT set so legacy callers (CLI, organization.credentials
 * tRPC) stay coherent with the named-set model — a flat base row for those
 * keys would be shadowed by the default set at resolution time.
 */
export async function writeOrgCredential(
	orgId: string,
	envVarKey: string,
	value: string,
	name?: string | null,
): Promise<void> {
	const provider = providerForEnvVarKey(envVarKey);
	if (provider) {
		const setId = await getOrCreateDefaultSet(orgId, provider);
		await writeSetCredential(orgId, setId, envVarKey, value);
		return;
	}

	const db = getDb();
	const encryptedValue = encryptCredential(value, orgId);
	await db
		.insert(orgCredentials)
		.values({ orgId, envVarKey, value: encryptedValue, name: name ?? null })
		.onConflictDoUpdate({
			target: [orgCredentials.orgId, orgCredentials.envVarKey],
			targetWhere: isNull(orgCredentials.setId),
			set: { value: encryptedValue, name: name ?? null, updatedAt: new Date() },
		});
}

/**
 * List all effective org credentials as an array of decrypted key-value
 * records (base rows overlaid by default-set rows).
 */
export async function listOrgCredentials(
	orgId: string,
): Promise<{ envVarKey: string; value: string; name: string | null }[]> {
	const db = getDb();

	const baseRows = await db
		.select({
			envVarKey: orgCredentials.envVarKey,
			value: orgCredentials.value,
			name: orgCredentials.name,
		})
		.from(orgCredentials)
		.where(and(eq(orgCredentials.orgId, orgId), isNull(orgCredentials.setId)));

	const setRows = await defaultSetRows(orgId);

	const byKey = new Map<string, { envVarKey: string; value: string; name: string | null }>();
	for (const row of [...baseRows, ...setRows]) {
		byKey.set(row.envVarKey, row);
	}

	return [...byKey.values()].map((row) => ({
		envVarKey: row.envVarKey,
		value: decryptCredential(row.value, orgId),
		name: row.name,
	}));
}

/**
 * List effective org credential metadata (key + name) without decrypting.
 * Used as a fallback when decryption fails (missing/wrong master key).
 */
export async function listOrgCredentialsMeta(
	orgId: string,
): Promise<{ envVarKey: string; name: string | null }[]> {
	const db = getDb();

	const baseRows = await db
		.select({ envVarKey: orgCredentials.envVarKey, name: orgCredentials.name })
		.from(orgCredentials)
		.where(and(eq(orgCredentials.orgId, orgId), isNull(orgCredentials.setId)));

	const setRows = await db
		.select({ envVarKey: orgCredentials.envVarKey, name: orgCredentialSets.name })
		.from(orgCredentials)
		.innerJoin(orgCredentialSets, eq(orgCredentials.setId, orgCredentialSets.id))
		.where(and(eq(orgCredentials.orgId, orgId), eq(orgCredentialSets.isDefault, true)));

	const byKey = new Map<string, { envVarKey: string; name: string | null }>();
	for (const row of [...baseRows, ...setRows]) {
		byKey.set(row.envVarKey, row);
	}
	return [...byKey.values()];
}

/**
 * Delete an org credential from the effective tier: the default-set row when
 * the key lives in a named-set provider's default set, else the base row.
 */
export async function deleteOrgCredential(orgId: string, envVarKey: string): Promise<void> {
	const db = getDb();

	const [setRow] = await db
		.select({ id: orgCredentials.id })
		.from(orgCredentials)
		.innerJoin(orgCredentialSets, eq(orgCredentials.setId, orgCredentialSets.id))
		.where(
			and(
				eq(orgCredentials.orgId, orgId),
				eq(orgCredentials.envVarKey, envVarKey),
				eq(orgCredentialSets.isDefault, true),
			),
		);
	if (setRow) {
		await db.delete(orgCredentials).where(eq(orgCredentials.id, setRow.id));
		return;
	}

	await db
		.delete(orgCredentials)
		.where(
			and(
				eq(orgCredentials.orgId, orgId),
				eq(orgCredentials.envVarKey, envVarKey),
				isNull(orgCredentials.setId),
			),
		);
}
