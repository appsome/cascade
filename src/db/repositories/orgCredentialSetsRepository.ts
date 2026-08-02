import { and, asc, eq, sql } from 'drizzle-orm';
import { getCredentialProvider } from '../../config/credentialProviders.js';
import { logger } from '../../utils/logging.js';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import {
	orgCredentialSets,
	orgCredentials,
	projectCredentialSelections,
	projects,
} from '../schema/index.js';

// ============================================================================
// Named org credential sets (org_credential_sets table)
//
// One set = one named entry ("personal", "work") on a provider tab. Value
// rows live in org_credentials with set_id pointing at the set; encryption
// AAD stays orgId (same table + AAD as the flat base tier). Exactly one
// default set per (org, provider) — the fallback for projects without a
// project_credential_selections row.
// ============================================================================

export interface OrgCredentialSetSummary {
	id: number;
	provider: string;
	name: string;
	isDefault: boolean;
	keys: { envVarKey: string; value: string }[];
}

function assertValidProvider(provider: string): void {
	if (!getCredentialProvider(provider)) {
		throw new Error(`Unknown credential provider: ${provider}`);
	}
}

async function getSetOwned(orgId: string, setId: number) {
	const db = getDb();
	const [set] = await db
		.select({
			id: orgCredentialSets.id,
			provider: orgCredentialSets.provider,
			name: orgCredentialSets.name,
			isDefault: orgCredentialSets.isDefault,
		})
		.from(orgCredentialSets)
		.where(and(eq(orgCredentialSets.id, setId), eq(orgCredentialSets.orgId, orgId)));
	if (!set) throw new Error(`Credential set not found: ${setId}`);
	return set;
}

/**
 * Create a named credential set. When the (org, provider) pair has no default
 * yet, the new set becomes the default automatically (mirrors the migration
 * backfill so the org always has a sane no-selection fallback). Race-safe:
 * a concurrent default insert loses on the partial unique index and retries
 * as non-default.
 */
export async function createSet(
	orgId: string,
	provider: string,
	name: string,
	opts?: { isDefault?: boolean },
): Promise<number> {
	assertValidProvider(provider);
	const db = getDb();

	const [existingDefault] = await db
		.select({ id: orgCredentialSets.id })
		.from(orgCredentialSets)
		.where(
			and(
				eq(orgCredentialSets.orgId, orgId),
				eq(orgCredentialSets.provider, provider),
				eq(orgCredentialSets.isDefault, true),
			),
		);

	const wantDefault = opts?.isDefault ?? !existingDefault;
	try {
		const [row] = await db
			.insert(orgCredentialSets)
			.values({ orgId, provider, name, isDefault: wantDefault })
			.returning({ id: orgCredentialSets.id });
		return row.id;
	} catch (err) {
		// Lost the default race — retry as non-default. Name collisions rethrow.
		if (wantDefault && String(err).includes('uq_org_credential_sets_default')) {
			const [row] = await db
				.insert(orgCredentialSets)
				.values({ orgId, provider, name, isDefault: false })
				.returning({ id: orgCredentialSets.id });
			return row.id;
		}
		throw err;
	}
}

export async function renameSet(orgId: string, setId: number, name: string): Promise<void> {
	const db = getDb();
	await getSetOwned(orgId, setId);
	await db
		.update(orgCredentialSets)
		.set({ name, updatedAt: new Date() })
		.where(and(eq(orgCredentialSets.id, setId), eq(orgCredentialSets.orgId, orgId)));
}

/**
 * Delete a set. Blocked (returns the referencing projects) when any
 * project_credential_selections row points at it, unless force is set —
 * then the DB ON DELETE CASCADE removes value rows and selections.
 */
export async function deleteSet(
	orgId: string,
	setId: number,
	opts: { force: boolean },
): Promise<
	{ deleted: true } | { deleted: false; blockedBy: { projectId: string; projectName: string }[] }
> {
	const db = getDb();
	await getSetOwned(orgId, setId);

	if (!opts.force) {
		const blockedBy = await db
			.select({ projectId: projects.id, projectName: projects.name })
			.from(projectCredentialSelections)
			.innerJoin(projects, eq(projectCredentialSelections.projectId, projects.id))
			.where(eq(projectCredentialSelections.setId, setId));
		if (blockedBy.length > 0) {
			return { deleted: false, blockedBy };
		}
	}

	await db
		.delete(orgCredentialSets)
		.where(and(eq(orgCredentialSets.id, setId), eq(orgCredentialSets.orgId, orgId)));
	return { deleted: true };
}

/** Transactionally flip the default flag to the given set within its provider. */
export async function setDefaultSet(orgId: string, setId: number): Promise<void> {
	const db = getDb();
	const set = await getSetOwned(orgId, setId);
	await db.transaction(async (tx) => {
		await tx
			.update(orgCredentialSets)
			.set({ isDefault: false, updatedAt: new Date() })
			.where(
				and(
					eq(orgCredentialSets.orgId, orgId),
					eq(orgCredentialSets.provider, set.provider),
					eq(orgCredentialSets.isDefault, true),
				),
			);
		await tx
			.update(orgCredentialSets)
			.set({ isDefault: true, updatedAt: new Date() })
			.where(and(eq(orgCredentialSets.id, setId), eq(orgCredentialSets.orgId, orgId)));
	});
}

/**
 * List all sets for an org with decrypted key values (decrypt-tolerant:
 * undecryptable rows are skipped with a warning). Callers must mask values
 * before sending anything to a client.
 */
export async function listSets(orgId: string): Promise<OrgCredentialSetSummary[]> {
	const db = getDb();

	const sets = await db
		.select({
			id: orgCredentialSets.id,
			provider: orgCredentialSets.provider,
			name: orgCredentialSets.name,
			isDefault: orgCredentialSets.isDefault,
		})
		.from(orgCredentialSets)
		.where(eq(orgCredentialSets.orgId, orgId))
		.orderBy(asc(orgCredentialSets.provider), asc(orgCredentialSets.id));

	if (sets.length === 0) return [];

	const valueRows = await db
		.select({
			setId: orgCredentials.setId,
			envVarKey: orgCredentials.envVarKey,
			value: orgCredentials.value,
		})
		.from(orgCredentials)
		.where(and(eq(orgCredentials.orgId, orgId), sql`${orgCredentials.setId} IS NOT NULL`));

	const bySet = new Map<number, { envVarKey: string; value: string }[]>();
	for (const row of valueRows) {
		if (row.setId === null) continue;
		try {
			const decrypted = decryptCredential(row.value, orgId);
			const list = bySet.get(row.setId) ?? [];
			list.push({ envVarKey: row.envVarKey, value: decrypted });
			bySet.set(row.setId, list);
		} catch (err) {
			logger.warn('Skipping undecryptable org credential set value', {
				orgId,
				setId: row.setId,
				envVarKey: row.envVarKey,
				error: String(err),
			});
		}
	}

	return sets.map((set) => ({ ...set, keys: bySet.get(set.id) ?? [] }));
}

/**
 * Metadata-only variant (no decryption) — the fallback when the master key
 * is missing/wrong, mirroring listOrgCredentialsMeta.
 */
export async function listSetsMeta(
	orgId: string,
): Promise<Array<Omit<OrgCredentialSetSummary, 'keys'> & { keys: { envVarKey: string }[] }>> {
	const db = getDb();

	const sets = await db
		.select({
			id: orgCredentialSets.id,
			provider: orgCredentialSets.provider,
			name: orgCredentialSets.name,
			isDefault: orgCredentialSets.isDefault,
		})
		.from(orgCredentialSets)
		.where(eq(orgCredentialSets.orgId, orgId))
		.orderBy(asc(orgCredentialSets.provider), asc(orgCredentialSets.id));

	const valueRows = await db
		.select({ setId: orgCredentials.setId, envVarKey: orgCredentials.envVarKey })
		.from(orgCredentials)
		.where(and(eq(orgCredentials.orgId, orgId), sql`${orgCredentials.setId} IS NOT NULL`));

	const bySet = new Map<number, { envVarKey: string }[]>();
	for (const row of valueRows) {
		if (row.setId === null) continue;
		const list = bySet.get(row.setId) ?? [];
		list.push({ envVarKey: row.envVarKey });
		bySet.set(row.setId, list);
	}

	return sets.map((set) => ({ ...set, keys: bySet.get(set.id) ?? [] }));
}

/** All project selections referencing this org's sets, for usage display. */
export async function listSetUsage(
	orgId: string,
): Promise<{ setId: number; projectId: string; projectName: string }[]> {
	const db = getDb();
	return db
		.select({
			setId: projectCredentialSelections.setId,
			projectId: projects.id,
			projectName: projects.name,
		})
		.from(projectCredentialSelections)
		.innerJoin(orgCredentialSets, eq(projectCredentialSelections.setId, orgCredentialSets.id))
		.innerJoin(projects, eq(projectCredentialSelections.projectId, projects.id))
		.where(eq(orgCredentialSets.orgId, orgId));
}

/**
 * Upsert a value row inside a set. Validates the key belongs to the set's
 * provider. Encrypts with AAD = orgId (org-owned scope).
 */
export async function writeSetCredential(
	orgId: string,
	setId: number,
	envVarKey: string,
	value: string,
): Promise<void> {
	const db = getDb();
	const set = await getSetOwned(orgId, setId);
	const provider = getCredentialProvider(set.provider);
	if (!provider?.envVarKeys.includes(envVarKey)) {
		throw new Error(`Env var key ${envVarKey} is not valid for provider ${set.provider}`);
	}

	const encryptedValue = encryptCredential(value, orgId);
	await db
		.insert(orgCredentials)
		.values({ orgId, envVarKey, value: encryptedValue, setId })
		.onConflictDoUpdate({
			target: [orgCredentials.setId, orgCredentials.envVarKey],
			targetWhere: sql`set_id IS NOT NULL`,
			set: { value: encryptedValue, updatedAt: new Date() },
		});
}

export async function deleteSetCredential(
	orgId: string,
	setId: number,
	envVarKey: string,
): Promise<void> {
	const db = getDb();
	await getSetOwned(orgId, setId);
	await db
		.delete(orgCredentials)
		.where(and(eq(orgCredentials.setId, setId), eq(orgCredentials.envVarKey, envVarKey)));
}

/**
 * Find or create the default set for (org, provider). Race-safe: a concurrent
 * creator wins the unique index and we re-read.
 */
export async function getOrCreateDefaultSet(orgId: string, provider: string): Promise<number> {
	assertValidProvider(provider);
	const db = getDb();

	const [existing] = await db
		.select({ id: orgCredentialSets.id })
		.from(orgCredentialSets)
		.where(
			and(
				eq(orgCredentialSets.orgId, orgId),
				eq(orgCredentialSets.provider, provider),
				eq(orgCredentialSets.isDefault, true),
			),
		);
	if (existing) return existing.id;

	try {
		const [row] = await db
			.insert(orgCredentialSets)
			.values({ orgId, provider, name: 'Default', isDefault: true })
			.returning({ id: orgCredentialSets.id });
		return row.id;
	} catch {
		// Concurrent creation (default flag or 'Default' name unique) — re-read.
		const [after] = await db
			.select({ id: orgCredentialSets.id })
			.from(orgCredentialSets)
			.where(
				and(
					eq(orgCredentialSets.orgId, orgId),
					eq(orgCredentialSets.provider, provider),
					eq(orgCredentialSets.isDefault, true),
				),
			);
		if (after) return after.id;
		// A non-default set named 'Default' blocked the insert — promote it.
		const [named] = await db
			.select({ id: orgCredentialSets.id })
			.from(orgCredentialSets)
			.where(
				and(
					eq(orgCredentialSets.orgId, orgId),
					eq(orgCredentialSets.provider, provider),
					eq(orgCredentialSets.name, 'Default'),
				),
			);
		if (named) {
			await setDefaultSet(orgId, named.id);
			return named.id;
		}
		throw new Error(`Failed to create default credential set for ${provider}`);
	}
}
