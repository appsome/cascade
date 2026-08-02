import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import { orgCredentials } from '../schema/index.js';

// ============================================================================
// Organization-scoped credential storage (org_credentials table)
//
// Org credentials are the shared tier below project_credentials: projects
// inherit them at resolution time, and a project_credentials row with the
// same env_var_key overrides the org value. Values are encrypted with
// AAD = orgId (project credentials use AAD = projectId).
// ============================================================================

/**
 * Resolve a single org credential by env var key.
 * Returns the decrypted plaintext value, or null if not found.
 */
export async function resolveOrgCredential(
	orgId: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();

	const [row] = await db
		.select({ value: orgCredentials.value })
		.from(orgCredentials)
		.where(and(eq(orgCredentials.orgId, orgId), eq(orgCredentials.envVarKey, envVarKey)));

	if (!row) return null;
	return decryptCredential(row.value, orgId);
}

/**
 * Resolve all org credentials as a flat env-var-key → value map.
 */
export async function resolveAllOrgCredentials(orgId: string): Promise<Record<string, string>> {
	const db = getDb();

	const rows = await db
		.select({ envVarKey: orgCredentials.envVarKey, value: orgCredentials.value })
		.from(orgCredentials)
		.where(eq(orgCredentials.orgId, orgId));

	const result: Record<string, string> = {};
	for (const row of rows) {
		result[row.envVarKey] = decryptCredential(row.value, orgId);
	}
	return result;
}

/**
 * Write (upsert) an org credential with automatic encryption.
 * The plaintext value is encrypted using orgId as AAD before storage.
 */
export async function writeOrgCredential(
	orgId: string,
	envVarKey: string,
	value: string,
	name?: string | null,
): Promise<void> {
	const db = getDb();
	const encryptedValue = encryptCredential(value, orgId);
	await db
		.insert(orgCredentials)
		.values({ orgId, envVarKey, value: encryptedValue, name: name ?? null })
		.onConflictDoUpdate({
			target: [orgCredentials.orgId, orgCredentials.envVarKey],
			set: { value: encryptedValue, name: name ?? null, updatedAt: new Date() },
		});
}

/**
 * List all org credentials as an array of decrypted key-value records.
 */
export async function listOrgCredentials(
	orgId: string,
): Promise<{ envVarKey: string; value: string; name: string | null }[]> {
	const db = getDb();

	const rows = await db
		.select({
			envVarKey: orgCredentials.envVarKey,
			value: orgCredentials.value,
			name: orgCredentials.name,
		})
		.from(orgCredentials)
		.where(eq(orgCredentials.orgId, orgId));

	return rows.map((row) => ({
		envVarKey: row.envVarKey,
		value: decryptCredential(row.value, orgId),
		name: row.name,
	}));
}

/**
 * List org credential metadata (key + name) without reading or decrypting values.
 * Used as a fallback when decryption fails (missing/wrong master key).
 */
export async function listOrgCredentialsMeta(
	orgId: string,
): Promise<{ envVarKey: string; name: string | null }[]> {
	const db = getDb();
	return db
		.select({ envVarKey: orgCredentials.envVarKey, name: orgCredentials.name })
		.from(orgCredentials)
		.where(eq(orgCredentials.orgId, orgId));
}

/**
 * Delete a row from org_credentials.
 */
export async function deleteOrgCredential(orgId: string, envVarKey: string): Promise<void> {
	const db = getDb();
	await db
		.delete(orgCredentials)
		.where(and(eq(orgCredentials.orgId, orgId), eq(orgCredentials.envVarKey, envVarKey)));
}
