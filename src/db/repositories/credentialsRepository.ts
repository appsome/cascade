import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getCredentialProvider, providerForEnvVarKey } from '../../config/credentialProviders.js';
import { logger } from '../../utils/logging.js';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import {
	orgCredentialSets,
	orgCredentials,
	projectCredentialSelections,
	projectCredentials,
	projectIntegrations,
	projects,
} from '../schema/index.js';

// ============================================================================
// Project-scoped credential resolution (reads from project_credentials table,
// falling back to the org_credentials tier — project values override org)
//
// Precedence per key since migration 0063:
//   project_credentials override
//     > project's SELECTED org credential set (lowest position wins)
//     > the provider's DEFAULT org set
//     > flat base-tier org row (set_id IS NULL)
// When a project HAS a selection for a provider, the default set is NOT
// consulted for that provider (an explicitly chosen set fully replaces it);
// keys the chosen set lacks still fall back to base-tier rows.
// ============================================================================

/**
 * Resolve a single credential for a project by env var key.
 * Reads from the project_credentials table using projectId as AAD for
 * decryption, then walks the org tiers (AAD = orgId) per the precedence
 * documented above.
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

	const [project] = await db
		.select({ id: projects.id, orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project) return null;

	const provider = providerForEnvVarKey(envVarKey);
	if (provider) {
		const [selection] = await db
			.select({ setId: projectCredentialSelections.setId })
			.from(projectCredentialSelections)
			.where(
				and(
					eq(projectCredentialSelections.projectId, projectId),
					eq(projectCredentialSelections.provider, provider),
				),
			)
			.orderBy(asc(projectCredentialSelections.position))
			.limit(1);

		if (selection) {
			const [setRow] = await db
				.select({ value: orgCredentials.value })
				.from(orgCredentials)
				.where(
					and(eq(orgCredentials.setId, selection.setId), eq(orgCredentials.envVarKey, envVarKey)),
				);
			if (setRow) return decryptCredential(setRow.value, project.orgId);
			// Selected set lacks the key — skip the default set (explicit choice
			// replaces it) and fall through to the base tier.
		} else {
			const [defaultRow] = await db
				.select({ value: orgCredentials.value })
				.from(orgCredentials)
				.innerJoin(orgCredentialSets, eq(orgCredentials.setId, orgCredentialSets.id))
				.where(
					and(
						eq(orgCredentials.orgId, project.orgId),
						eq(orgCredentials.envVarKey, envVarKey),
						eq(orgCredentialSets.isDefault, true),
					),
				);
			if (defaultRow) return decryptCredential(defaultRow.value, project.orgId);
		}
	}

	const [baseRow] = await db
		.select({ value: orgCredentials.value })
		.from(orgCredentials)
		.where(
			and(
				eq(orgCredentials.orgId, project.orgId),
				eq(orgCredentials.envVarKey, envVarKey),
				isNull(orgCredentials.setId),
			),
		);

	if (!baseRow) return null;
	return decryptCredential(baseRow.value, project.orgId);
}

/**
 * Resolve all credentials for a project as a flat env-var-key → value map,
 * per the precedence documented above. Each tier decrypts with its own AAD
 * (orgId vs projectId). Throws if the project does not exist.
 *
 * Hot path (runs at every worker spawn) — kept to 5 queries.
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

	const baseRows = await db
		.select({ envVarKey: orgCredentials.envVarKey, value: orgCredentials.value })
		.from(orgCredentials)
		.where(and(eq(orgCredentials.orgId, project.orgId), isNull(orgCredentials.setId)));

	const selectionRows = await db
		.select({
			provider: projectCredentialSelections.provider,
			position: projectCredentialSelections.position,
			envVarKey: orgCredentials.envVarKey,
			value: orgCredentials.value,
		})
		.from(projectCredentialSelections)
		.innerJoin(orgCredentials, eq(orgCredentials.setId, projectCredentialSelections.setId))
		.where(eq(projectCredentialSelections.projectId, projectId));

	const defaultRows = await db
		.select({
			provider: orgCredentialSets.provider,
			envVarKey: orgCredentials.envVarKey,
			value: orgCredentials.value,
		})
		.from(orgCredentials)
		.innerJoin(orgCredentialSets, eq(orgCredentials.setId, orgCredentialSets.id))
		.where(and(eq(orgCredentials.orgId, project.orgId), eq(orgCredentialSets.isDefault, true)));

	const rows = await db
		.select({ envVarKey: projectCredentials.envVarKey, value: projectCredentials.value })
		.from(projectCredentials)
		.where(eq(projectCredentials.projectId, projectId));

	// Per provider: winning selection = rows at the lowest selected position.
	const selectedProviders = new Set(selectionRows.map((r) => r.provider));
	const minPositionByProvider = new Map<string, number>();
	for (const r of selectionRows) {
		const current = minPositionByProvider.get(r.provider);
		if (current === undefined || r.position < current) {
			minPositionByProvider.set(r.provider, r.position);
		}
	}

	const result: Record<string, string> = {};
	for (const row of baseRows) {
		result[row.envVarKey] = decryptCredential(row.value, project.orgId);
	}
	for (const row of defaultRows) {
		if (selectedProviders.has(row.provider)) continue;
		result[row.envVarKey] = decryptCredential(row.value, project.orgId);
	}
	for (const row of selectionRows) {
		if (row.position !== minPositionByProvider.get(row.provider)) continue;
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
 *
 * Rows that fail to decrypt (master-key rotation, AAD mismatch) are skipped
 * with a warning instead of failing the whole query — one corrupted row must
 * not hide usage data for the healthy tokens.
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

	const result: { projectId: string; projectName: string; value: string }[] = [];
	for (const row of rows) {
		try {
			result.push({
				projectId: row.projectId,
				projectName: row.projectName,
				value: decryptCredential(row.value, row.projectId),
			});
		} catch (err) {
			logger.warn('Skipping undecryptable CLAUDE_CODE_OAUTH_TOKEN credential', {
				projectId: row.projectId,
				error: String(err),
			});
		}
	}
	return result;
}

/**
 * Read a single credential from the project tier ONLY — no org fallback.
 * Used where the project-vs-org distinction is the point (e.g. contrasting a
 * project override with the inherited org value). Returns null when the row
 * is absent or cannot be decrypted.
 */
export async function getProjectOwnCredential(
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

	if (!row) return null;
	try {
		return decryptCredential(row.value, projectId);
	} catch (err) {
		logger.warn('Failed to decrypt project credential', {
			projectId,
			envVarKey,
			error: String(err),
		});
		return null;
	}
}

// ============================================================================
// Named credential set pools + project selections
// ============================================================================

export interface CredentialPoolMember {
	/** org_credential_sets.id, or null for the project-override / base-tier members. */
	setId: number | null;
	setName: string;
	position: number;
	source: 'project' | 'selection' | 'org-default' | 'org-base';
	/** Decrypted env var values present on this member (decrypt-tolerant). */
	values: Record<string, string>;
}

function decryptTolerant(
	values: { envVarKey: string; value: string }[],
	aad: string,
	context: Record<string, unknown>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const row of values) {
		try {
			result[row.envVarKey] = decryptCredential(row.value, aad);
		} catch (err) {
			logger.warn('Skipping undecryptable credential in pool member', {
				...context,
				envVarKey: row.envVarKey,
				error: String(err),
			});
		}
	}
	return result;
}

/**
 * Enumerate the ordered credential pool a project can draw from for a
 * provider — the engine-rotation entry point. A project-local override for
 * any of the provider's keys short-circuits to a one-member pool (rotation
 * is a between-org-sets concept; an explicit project credential pins it).
 */
export async function resolveCredentialPool(
	projectId: string,
	provider: string,
): Promise<CredentialPoolMember[]> {
	const providerDef = getCredentialProvider(provider);
	if (!providerDef) {
		throw new Error(`Unknown credential provider: ${provider}`);
	}
	const db = getDb();

	const [project] = await db
		.select({ id: projects.id, orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project) {
		throw new Error(`Project not found: ${projectId}`);
	}

	const projRows = await db
		.select({ envVarKey: projectCredentials.envVarKey, value: projectCredentials.value })
		.from(projectCredentials)
		.where(
			and(
				eq(projectCredentials.projectId, projectId),
				inArray(projectCredentials.envVarKey, providerDef.envVarKeys),
			),
		);
	if (projRows.length > 0) {
		return [
			{
				setId: null,
				setName: 'Project override',
				position: 0,
				source: 'project',
				values: decryptTolerant(projRows, projectId, { projectId, provider }),
			},
		];
	}

	const selections = await db
		.select({
			setId: projectCredentialSelections.setId,
			position: projectCredentialSelections.position,
			setName: orgCredentialSets.name,
		})
		.from(projectCredentialSelections)
		.innerJoin(orgCredentialSets, eq(projectCredentialSelections.setId, orgCredentialSets.id))
		.where(
			and(
				eq(projectCredentialSelections.projectId, projectId),
				eq(projectCredentialSelections.provider, provider),
			),
		)
		.orderBy(asc(projectCredentialSelections.position));

	if (selections.length > 0) {
		const valueRows = await db
			.select({
				setId: orgCredentials.setId,
				envVarKey: orgCredentials.envVarKey,
				value: orgCredentials.value,
			})
			.from(orgCredentials)
			.where(
				inArray(
					orgCredentials.setId,
					selections.map((s) => s.setId),
				),
			);

		return selections.map((sel) => ({
			setId: sel.setId,
			setName: sel.setName,
			position: sel.position,
			source: 'selection' as const,
			values: decryptTolerant(
				valueRows.filter((v) => v.setId === sel.setId),
				project.orgId,
				{ projectId, provider, setId: sel.setId },
			),
		}));
	}

	const [defaultSet] = await db
		.select({ id: orgCredentialSets.id, name: orgCredentialSets.name })
		.from(orgCredentialSets)
		.where(
			and(
				eq(orgCredentialSets.orgId, project.orgId),
				eq(orgCredentialSets.provider, provider),
				eq(orgCredentialSets.isDefault, true),
			),
		);
	if (defaultSet) {
		const valueRows = await db
			.select({ envVarKey: orgCredentials.envVarKey, value: orgCredentials.value })
			.from(orgCredentials)
			.where(eq(orgCredentials.setId, defaultSet.id));
		return [
			{
				setId: defaultSet.id,
				setName: defaultSet.name,
				position: 0,
				source: 'org-default',
				values: decryptTolerant(valueRows, project.orgId, {
					projectId,
					provider,
					setId: defaultSet.id,
				}),
			},
		];
	}

	const baseRows = await db
		.select({ envVarKey: orgCredentials.envVarKey, value: orgCredentials.value })
		.from(orgCredentials)
		.where(
			and(
				eq(orgCredentials.orgId, project.orgId),
				isNull(orgCredentials.setId),
				inArray(orgCredentials.envVarKey, providerDef.envVarKeys),
			),
		);
	if (baseRows.length > 0) {
		return [
			{
				setId: null,
				setName: 'Organization',
				position: 0,
				source: 'org-base',
				values: decryptTolerant(baseRows, project.orgId, { projectId, provider }),
			},
		];
	}

	return [];
}

/** All of a project's set selections with display names, ordered by position. */
export async function listProjectCredentialSelections(
	projectId: string,
): Promise<{ provider: string; setId: number; setName: string; position: number }[]> {
	const db = getDb();
	return db
		.select({
			provider: projectCredentialSelections.provider,
			setId: projectCredentialSelections.setId,
			setName: orgCredentialSets.name,
			position: projectCredentialSelections.position,
		})
		.from(projectCredentialSelections)
		.innerJoin(orgCredentialSets, eq(projectCredentialSelections.setId, orgCredentialSets.id))
		.where(eq(projectCredentialSelections.projectId, projectId))
		.orderBy(asc(projectCredentialSelections.provider), asc(projectCredentialSelections.position));
}

/**
 * Replace a project's selections for one provider with the given ordered set
 * ids (positions 0..n). Empty array clears the selection (falls back to the
 * org default set). Validates every set belongs to the project's org and the
 * given provider, and enforces the provider's single-vs-multi select rule.
 */
export async function setProjectCredentialSelections(
	projectId: string,
	provider: string,
	setIds: number[],
): Promise<void> {
	const providerDef = getCredentialProvider(provider);
	if (!providerDef) {
		throw new Error(`Unknown credential provider: ${provider}`);
	}
	if (!providerDef.multiSelect && setIds.length > 1) {
		throw new Error(`Provider ${provider} supports a single credential selection`);
	}
	if (new Set(setIds).size !== setIds.length) {
		throw new Error('Duplicate credential set in selection');
	}

	const db = getDb();
	const [project] = await db
		.select({ id: projects.id, orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project) {
		throw new Error(`Project not found: ${projectId}`);
	}

	if (setIds.length > 0) {
		const owned = await db
			.select({ id: orgCredentialSets.id })
			.from(orgCredentialSets)
			.where(
				and(
					inArray(orgCredentialSets.id, setIds),
					eq(orgCredentialSets.orgId, project.orgId),
					eq(orgCredentialSets.provider, provider),
				),
			);
		if (owned.length !== setIds.length) {
			throw new Error('Credential set does not belong to this organization/provider');
		}
	}

	await db.transaction(async (tx) => {
		await tx
			.delete(projectCredentialSelections)
			.where(
				and(
					eq(projectCredentialSelections.projectId, projectId),
					eq(projectCredentialSelections.provider, provider),
				),
			);
		if (setIds.length > 0) {
			await tx
				.insert(projectCredentialSelections)
				.values(setIds.map((setId, position) => ({ projectId, provider, setId, position })));
		}
	});
}

/**
 * Every named Anthropic set in an org that has a configured Claude Code OAuth
 * token, with decrypted values (decrypt-tolerant). Server-side use only.
 */
export async function listAllNamedClaudeCodeTokens(
	orgId: string,
): Promise<{ setId: number; setName: string; isDefault: boolean; value: string }[]> {
	const db = getDb();

	const rows = await db
		.select({
			setId: orgCredentialSets.id,
			setName: orgCredentialSets.name,
			isDefault: orgCredentialSets.isDefault,
			value: orgCredentials.value,
		})
		.from(orgCredentials)
		.innerJoin(orgCredentialSets, eq(orgCredentials.setId, orgCredentialSets.id))
		.where(
			and(
				eq(orgCredentials.orgId, orgId),
				eq(orgCredentialSets.provider, 'anthropic'),
				eq(orgCredentials.envVarKey, 'CLAUDE_CODE_OAUTH_TOKEN'),
			),
		)
		.orderBy(asc(orgCredentialSets.id));

	const result: { setId: number; setName: string; isDefault: boolean; value: string }[] = [];
	for (const row of rows) {
		try {
			result.push({ ...row, value: decryptCredential(row.value, orgId) });
		} catch (err) {
			logger.warn('Skipping undecryptable named Claude Code token', {
				orgId,
				setId: row.setId,
				error: String(err),
			});
		}
	}
	return result;
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
