import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deleteProjectCredential,
	listProjectCredentials,
	resolveAllProjectCredentials,
	resolveProjectCredential,
	writeProjectCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
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
