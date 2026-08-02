import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import {
	orgCredentials,
	projectCredentials,
	projectIntegrations,
	projects,
} from '../schema/index.js';

// ============================================================================
// Project-scoped credential resolution (reads from project_credentials table,
// falling back to the org_credentials tier — project values override org)
// ============================================================================

/**
 * Resolve a single credential for a project by env var key.
 * Reads from the project_credentials table using projectId as AAD for
 * decryption. When the project has no row for the key, falls back to the
 * owning organization's org_credentials tier (AAD = orgId).
 */
export async function resolveProjectCredential(
	projectId: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();

	const [row] = await db
		.select({ value: projectCredentials.value })
		.from(projectCredentials)
		.where(
			and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.envVarKey, envVarKey)),
		);

	if (row) return decryptCredential(row.value, projectId);

	const [orgRow] = await db
		.select({ value: orgCredentials.value, orgId: orgCredentials.orgId })
		.from(orgCredentials)
		.innerJoin(projects, eq(projects.orgId, orgCredentials.orgId))
		.where(and(eq(projects.id, projectId), eq(orgCredentials.envVarKey, envVarKey)));

	if (!orgRow) return null;
	return decryptCredential(orgRow.value, orgRow.orgId);
}

/**
 * Resolve all credentials for a project as a flat env-var-key → value map.
 * Merges the owning organization's org_credentials tier first, then overlays
 * project_credentials rows so project values win on key collisions. Each tier
 * decrypts with its own AAD (orgId vs projectId).
 * Throws if the project does not exist.
 */
export async function resolveAllProjectCredentials(
	projectId: string,
): Promise<Record<string, string>> {
	const db = getDb();

	const [project] = await db
		.select({ id: projects.id, orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project) {
		throw new Error(`Project not found: ${projectId}`);
	}

	const orgRows = await db
		.select({ envVarKey: orgCredentials.envVarKey, value: orgCredentials.value })
		.from(orgCredentials)
		.where(eq(orgCredentials.orgId, project.orgId));

	const rows = await db
		.select({ envVarKey: projectCredentials.envVarKey, value: projectCredentials.value })
		.from(projectCredentials)
		.where(eq(projectCredentials.projectId, projectId));

	const result: Record<string, string> = {};
	for (const row of orgRows) {
		result[row.envVarKey] = decryptCredential(row.value, project.orgId);
	}
	for (const row of rows) {
		result[row.envVarKey] = decryptCredential(row.value, projectId);
	}
	return result;
}

/**
 * Upsert a row in project_credentials. Value must already be encrypted with
 * projectId as AAD (or plaintext if encryption is disabled).
 */
export async function upsertProjectCredential(
	projectId: string,
	envVarKey: string,
	value: string,
	name?: string | null,
): Promise<void> {
	const db = getDb();
	await db
		.insert(projectCredentials)
		.values({ projectId, envVarKey, value, name: name ?? null })
		.onConflictDoUpdate({
			target: [projectCredentials.projectId, projectCredentials.envVarKey],
			set: { value, name: name ?? null, updatedAt: new Date() },
		});
}

/**
 * Delete a row from project_credentials.
 */
export async function deleteProjectCredential(projectId: string, envVarKey: string): Promise<void> {
	const db = getDb();
	await db
		.delete(projectCredentials)
		.where(
			and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.envVarKey, envVarKey)),
		);
}

// ============================================================================
// Project-scoped credential CRUD helpers (public API — transparent encryption)
// ============================================================================

/**
 * Read a single project credential by env var key.
 * Returns the decrypted plaintext value, or null if not found.
 * Uses projectId as AAD for decryption.
 */
export async function getProjectCredential(
	projectId: string,
	envVarKey: string,
): Promise<string | null> {
	return resolveProjectCredential(projectId, envVarKey);
}

/**
 * Write (upsert) a project credential with automatic encryption.
 * The plaintext value is encrypted using projectId as AAD before storage.
 */
export async function writeProjectCredential(
	projectId: string,
	envVarKey: string,
	value: string,
	name?: string | null,
): Promise<void> {
	const encryptedValue = encryptCredential(value, projectId);
	await upsertProjectCredential(projectId, envVarKey, encryptedValue, name);
}

/**
 * List all project credentials as an array of decrypted key-value records.
 * Uses projectId as AAD for decryption.
 */
export async function listProjectCredentials(
	projectId: string,
): Promise<{ envVarKey: string; value: string; name: string | null }[]> {
	const db = getDb();

	const rows = await db
		.select({
			envVarKey: projectCredentials.envVarKey,
			value: projectCredentials.value,
			name: projectCredentials.name,
		})
		.from(projectCredentials)
		.where(eq(projectCredentials.projectId, projectId));

	return rows.map((row) => ({
		envVarKey: row.envVarKey,
		value: decryptCredential(row.value, projectId),
		name: row.name,
	}));
}

/**
 * List credential metadata (key + name) without reading or decrypting values.
 * Used as a fallback when decryption fails (missing/wrong master key).
 */
export async function listProjectCredentialsMeta(
	projectId: string,
): Promise<{ envVarKey: string; name: string | null }[]> {
	const db = getDb();
	return db
		.select({ envVarKey: projectCredentials.envVarKey, name: projectCredentials.name })
		.from(projectCredentials)
		.where(eq(projectCredentials.projectId, projectId));
}

// ============================================================================
// Cross-project credential queries
// ============================================================================

/**
 * List all project-level CLAUDE_CODE_OAUTH_TOKEN credentials across an org,
 * with the owning project's name for display attribution.
 * Returns decrypted values for use in server-side API calls only.
 * Never expose raw tokens to the client.
 */
export async function listAllClaudeCodeCredentials(
	orgId: string,
): Promise<{ projectId: string; projectName: string; value: string }[]> {
	const db = getDb();

	const rows = await db
		.select({
			projectId: projectCredentials.projectId,
			projectName: projects.name,
			value: projectCredentials.value,
		})
		.from(projectCredentials)
		.innerJoin(projects, eq(projectCredentials.projectId, projects.id))
		.where(
			and(eq(projects.orgId, orgId), eq(projectCredentials.envVarKey, 'CLAUDE_CODE_OAUTH_TOKEN')),
		);

	return rows.map((row) => ({
		projectId: row.projectId,
		projectName: row.projectName,
		value: decryptCredential(row.value, row.projectId),
	}));
}

// ============================================================================
// Integration metadata queries
// ============================================================================

/**
 * Get the provider for a project's integration in a specific category.
 */
export async function getIntegrationProvider(
	projectId: string,
	category: string,
): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ provider: projectIntegrations.provider })
		.from(projectIntegrations)
		.where(
			and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.category, category)),
		);

	return row?.provider ?? null;
}
