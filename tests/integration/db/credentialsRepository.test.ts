import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deleteProjectCredential,
	listProjectCredentialSelections,
	listProjectCredentials,
	resolveAllProjectCredentials,
	resolveCredentialPool,
	resolveProjectCredential,
	setProjectCredentialSelections,
	writeProjectCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import {
	createSet,
	deleteSet,
	listSets,
	setDefaultSet,
	writeSetCredential,
} from '../../../src/db/repositories/orgCredentialSetsRepository.js';
import {
	deleteOrgCredential,
	listOrgCredentials,
	writeOrgCredential,
} from '../../../src/db/repositories/orgCredentialsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

describe('credentialsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Project-scoped credential CRUD
	// =========================================================================

	describe('writeProjectCredential', () => {
		it('inserts a credential and it can be retrieved', async () => {
			await writeProjectCredential('test-project', 'MY_API_KEY', 'secret-123', 'My Key');

			const creds = await listProjectCredentials('test-project');
			expect(creds).toHaveLength(1);
			expect(creds[0].envVarKey).toBe('MY_API_KEY');
			expect(creds[0].value).toBe('secret-123');
			expect(creds[0].name).toBe('My Key');
		});

		it('upserts when key already exists', async () => {
			await writeProjectCredential('test-project', 'KEY', 'old-value');
			await writeProjectCredential('test-project', 'KEY', 'new-value');

			const creds = await listProjectCredentials('test-project');
			expect(creds).toHaveLength(1);
			expect(creds[0].value).toBe('new-value');
		});
	});

	describe('deleteProjectCredential', () => {
		it('removes the credential', async () => {
			await writeProjectCredential('test-project', 'TEMP', 'tmp');
			await deleteProjectCredential('test-project', 'TEMP');

			const creds = await listProjectCredentials('test-project');
			expect(creds.find((c) => c.envVarKey === 'TEMP')).toBeUndefined();
		});
	});

	describe('listProjectCredentials', () => {
		it('returns all credentials for the project', async () => {
			await writeProjectCredential('test-project', 'A', 'a');
			await writeProjectCredential('test-project', 'B', 'b');

			const creds = await listProjectCredentials('test-project');
			expect(creds).toHaveLength(2);
			expect(creds.map((c) => c.envVarKey).sort()).toEqual(['A', 'B']);
		});

		it('returns empty array for project with no credentials', async () => {
			const creds = await listProjectCredentials('test-project');
			expect(creds).toEqual([]);
		});
	});

	// =========================================================================
	// Project-scoped credential resolution
	// =========================================================================

	describe('resolveProjectCredential', () => {
		it('returns value when found', async () => {
			await writeProjectCredential('test-project', 'OPENROUTER_API_KEY', 'or-secret');

			const result = await resolveProjectCredential('test-project', 'OPENROUTER_API_KEY');
			expect(result).toBe('or-secret');
		});

		it('returns null when credential does not exist', async () => {
			const result = await resolveProjectCredential('test-project', 'MISSING_KEY');
			expect(result).toBeNull();
		});
	});

	describe('resolveAllProjectCredentials', () => {
		it('returns all credentials as key-value map', async () => {
			await writeProjectCredential('test-project', 'KEY_1', 'v1');
			await writeProjectCredential('test-project', 'KEY_2', 'v2');

			const result = await resolveAllProjectCredentials('test-project');
			expect(result).toEqual({ KEY_1: 'v1', KEY_2: 'v2' });
		});
	});

	// =========================================================================
	// Encryption
	// =========================================================================

	describe('with encryption', () => {
		it('round-trips through encrypt/decrypt transparently', async () => {
			// 64-char hex = 32-byte AES-256 key
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(64));

			await writeProjectCredential('test-project', 'ENC_KEY', 'plaintext-secret');

			const creds = await listProjectCredentials('test-project');
			const cred = creds.find((c) => c.envVarKey === 'ENC_KEY');
			expect(cred?.value).toBe('plaintext-secret'); // decrypted on read
		});
	});

	// =========================================================================
	// Org-tier inheritance (org_credentials)
	// =========================================================================

	describe('org credential inheritance', () => {
		it('org credential CRUD round-trips', async () => {
			await writeOrgCredential('test-org', 'ORG_KEY', 'org-value', 'Org Key');

			const creds = await listOrgCredentials('test-org');
			expect(creds).toHaveLength(1);
			expect(creds[0]).toEqual({ envVarKey: 'ORG_KEY', value: 'org-value', name: 'Org Key' });

			await deleteOrgCredential('test-org', 'ORG_KEY');
			expect(await listOrgCredentials('test-org')).toEqual([]);
		});

		it('project inherits an org-only credential', async () => {
			await writeOrgCredential('test-org', 'GITHUB_TOKEN_IMPLEMENTER', 'org-shared-token');

			const single = await resolveProjectCredential('test-project', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(single).toBe('org-shared-token');

			const all = await resolveAllProjectCredentials('test-project');
			expect(all.GITHUB_TOKEN_IMPLEMENTER).toBe('org-shared-token');
		});

		it('project credential with the same key overrides the org value', async () => {
			await writeOrgCredential('test-org', 'SHARED_KEY', 'org-value');
			await writeProjectCredential('test-project', 'SHARED_KEY', 'project-value');

			expect(await resolveProjectCredential('test-project', 'SHARED_KEY')).toBe('project-value');

			const all = await resolveAllProjectCredentials('test-project');
			expect(all.SHARED_KEY).toBe('project-value');
		});

		it('deleting the project override reverts to the org value', async () => {
			await writeOrgCredential('test-org', 'SHARED_KEY', 'org-value');
			await writeProjectCredential('test-project', 'SHARED_KEY', 'project-value');
			await deleteProjectCredential('test-project', 'SHARED_KEY');

			expect(await resolveProjectCredential('test-project', 'SHARED_KEY')).toBe('org-value');
		});

		it('inheritance decrypts each tier with its own AAD under encryption', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(64));

			await writeOrgCredential('test-org', 'ORG_ENC_KEY', 'org-secret');
			await writeProjectCredential('test-project', 'PROJECT_ENC_KEY', 'project-secret');

			const all = await resolveAllProjectCredentials('test-project');
			expect(all.ORG_ENC_KEY).toBe('org-secret');
			expect(all.PROJECT_ENC_KEY).toBe('project-secret');
		});
	});
});

// =========================================================================
// Named credential sets (org_credential_sets) + project selections
// =========================================================================

describe('named credential sets (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	it('writeOrgCredential routes provider keys into the Default set', async () => {
		await writeOrgCredential('test-org', 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-default');

		const sets = await listSets('test-org');
		expect(sets).toHaveLength(1);
		expect(sets[0]).toMatchObject({ provider: 'anthropic', name: 'Default', isDefault: true });
		expect(sets[0].keys).toEqual([{ envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'tok-default' }]);

		// Effective org tier + project inheritance still resolve it.
		expect(await resolveProjectCredential('test-project', 'CLAUDE_CODE_OAUTH_TOKEN')).toBe(
			'tok-default',
		);
	});

	it('set-tier partial-index upsert updates in place (targetWhere on real Postgres)', async () => {
		const setId = await createSet('test-org', 'anthropic', 'personal');
		await writeSetCredential('test-org', setId, 'CLAUDE_CODE_OAUTH_TOKEN', 'v1');
		await writeSetCredential('test-org', setId, 'CLAUDE_CODE_OAUTH_TOKEN', 'v2');

		const sets = await listSets('test-org');
		const personal = sets.find((s) => s.id === setId);
		expect(personal?.keys).toEqual([{ envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'v2' }]);
	});

	it('base-tier and set-tier rows with the same key coexist (split unique indexes)', async () => {
		// Base tier only accepts non-provider keys via writeOrgCredential, so
		// exercise the index split with a provider key written directly per tier.
		const setId = await createSet('test-org', 'anthropic', 'personal');
		await writeSetCredential('test-org', setId, 'ANTHROPIC_API_KEY', 'set-value');
		await writeOrgCredential('test-org', 'MY_CUSTOM_KEY', 'base-value');

		const all = await resolveAllProjectCredentials('test-project');
		expect(all.MY_CUSTOM_KEY).toBe('base-value');
		expect(all.ANTHROPIC_API_KEY).toBe('set-value'); // first set auto-defaults
	});

	it('selection-aware resolution end-to-end: selected set beats default, clearing reverts', async () => {
		await writeOrgCredential('test-org', 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-default');
		const workSetId = await createSet('test-org', 'anthropic', 'work');
		await writeSetCredential('test-org', workSetId, 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-work');

		await setProjectCredentialSelections('test-project', 'anthropic', [workSetId]);
		expect(await resolveProjectCredential('test-project', 'CLAUDE_CODE_OAUTH_TOKEN')).toBe(
			'tok-work',
		);
		const all = await resolveAllProjectCredentials('test-project');
		expect(all.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-work');

		await setProjectCredentialSelections('test-project', 'anthropic', []);
		expect(await resolveProjectCredential('test-project', 'CLAUDE_CODE_OAUTH_TOKEN')).toBe(
			'tok-default',
		);
	});

	it('resolveCredentialPool returns the ordered pool with decrypted values', async () => {
		vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(64));
		await writeOrgCredential('test-org', 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-default');
		const workSetId = await createSet('test-org', 'anthropic', 'work');
		await writeSetCredential('test-org', workSetId, 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-work');
		const defaultSet = (await listSets('test-org')).find((s) => s.isDefault);

		await setProjectCredentialSelections('test-project', 'anthropic', [
			workSetId,
			defaultSet?.id as number,
		]);

		const pool = await resolveCredentialPool('test-project', 'anthropic');
		expect(pool.map((m) => [m.setName, m.position, m.values.CLAUDE_CODE_OAUTH_TOKEN])).toEqual([
			['work', 0, 'tok-work'],
			['Default', 1, 'tok-default'],
		]);
	});

	it('project override short-circuits the pool', async () => {
		await writeOrgCredential('test-org', 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-default');
		await writeProjectCredential('test-project', 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-project');

		const pool = await resolveCredentialPool('test-project', 'anthropic');
		expect(pool).toHaveLength(1);
		expect(pool[0]).toMatchObject({
			source: 'project',
			values: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-project' },
		});
	});

	it('deleteSet is blocked while referenced and force-delete cascades selections', async () => {
		const workSetId = await createSet('test-org', 'anthropic', 'work');
		await writeSetCredential('test-org', workSetId, 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-work');
		await setProjectCredentialSelections('test-project', 'anthropic', [workSetId]);

		const blocked = await deleteSet('test-org', workSetId, { force: false });
		expect(blocked.deleted).toBe(false);
		if (!blocked.deleted) {
			expect(blocked.blockedBy.map((p) => p.projectId)).toEqual(['test-project']);
		}

		const forced = await deleteSet('test-org', workSetId, { force: true });
		expect(forced.deleted).toBe(true);

		// Cascade removed the selection AND the set's value rows.
		expect(await listProjectCredentialSelections('test-project')).toEqual([]);
		expect((await listSets('test-org')).find((s) => s.id === workSetId)).toBeUndefined();
	});

	it('setDefaultSet flips the default within the provider', async () => {
		await writeOrgCredential('test-org', 'CLAUDE_CODE_OAUTH_TOKEN', 'tok-default'); // creates Default
		const workSetId = await createSet('test-org', 'anthropic', 'work');
		await setDefaultSet('test-org', workSetId);

		const sets = await listSets('test-org');
		expect(sets.find((s) => s.id === workSetId)?.isDefault).toBe(true);
		expect(sets.filter((s) => s.provider === 'anthropic' && s.isDefault)).toHaveLength(1);
	});

	it('rejects selections of sets from a different provider', async () => {
		const githubSetId = await createSet('test-org', 'github', 'bots');
		await expect(
			setProjectCredentialSelections('test-project', 'anthropic', [githubSetId]),
		).rejects.toThrow('does not belong');
	});
});
