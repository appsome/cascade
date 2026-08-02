import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	deleteOrgCredential,
	listOrgCredentials,
	listOrgCredentialsMeta,
	resolveAllOrgCredentials,
	resolveOrgCredential,
	writeOrgCredential,
} from '../../../../src/db/repositories/orgCredentialsRepository.js';

describe('orgCredentialsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true });
	});

	describe('resolveOrgCredential', () => {
		it('returns decrypted value when found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'org-shared-token' }]);

			const result = await resolveOrgCredential('org-1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('org-shared-token');
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveOrgCredential('org-1', 'MISSING_KEY');
			expect(result).toBeNull();
		});

		it('round-trips encryption with orgId as AAD when CREDENTIAL_MASTER_KEY is set', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			const encryptedValue = encryptCredential('org-secret', 'org-1');
			mockDb.chain.where.mockResolvedValueOnce([{ value: encryptedValue }]);

			const result = await resolveOrgCredential('org-1', 'SOME_KEY');
			expect(result).toBe('org-secret');
		});

		it('fails to decrypt a value encrypted with a different org AAD', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			const encryptedValue = encryptCredential('org-secret', 'other-org');
			mockDb.chain.where.mockResolvedValueOnce([{ value: encryptedValue }]);

			await expect(resolveOrgCredential('org-1', 'SOME_KEY')).rejects.toThrow();
		});
	});

	describe('resolveAllOrgCredentials', () => {
		it('returns all org credentials as key-value map', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'ghp_shared' },
				{ envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'oat-token' },
			]);

			const result = await resolveAllOrgCredentials('org-1');
			expect(result).toEqual({
				GITHUB_TOKEN_IMPLEMENTER: 'ghp_shared',
				CLAUDE_CODE_OAUTH_TOKEN: 'oat-token',
			});
		});

		it('returns empty object when no credentials', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveAllOrgCredentials('org-1');
			expect(result).toEqual({});
		});
	});

	describe('writeOrgCredential', () => {
		it('encrypts with orgId as AAD before upserting', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			await writeOrgCredential('org-1', 'SOME_KEY', 'plaintext-secret', 'Label');

			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			const inserted = mockDb.chain.values.mock.calls[0][0] as {
				orgId: string;
				envVarKey: string;
				value: string;
				name: string | null;
			};
			expect(inserted.orgId).toBe('org-1');
			expect(inserted.envVarKey).toBe('SOME_KEY');
			expect(inserted.name).toBe('Label');
			expect(inserted.value).not.toBe('plaintext-secret');

			const { decryptCredential } = await import('../../../../src/db/crypto.js');
			expect(decryptCredential(inserted.value, 'org-1')).toBe('plaintext-secret');
		});

		it('stores plaintext when no master key is configured', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', '');

			await writeOrgCredential('org-1', 'SOME_KEY', 'plaintext-secret');

			const inserted = mockDb.chain.values.mock.calls[0][0] as { value: string };
			expect(inserted.value).toBe('plaintext-secret');
		});
	});

	describe('listOrgCredentials', () => {
		it('returns decrypted rows', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'KEY_A', value: 'value-a', name: 'A' },
				{ envVarKey: 'KEY_B', value: 'value-b', name: null },
			]);

			const result = await listOrgCredentials('org-1');
			expect(result).toEqual([
				{ envVarKey: 'KEY_A', value: 'value-a', name: 'A' },
				{ envVarKey: 'KEY_B', value: 'value-b', name: null },
			]);
		});
	});

	describe('listOrgCredentialsMeta', () => {
		it('returns envVarKey and name without values', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'KEY_A', name: 'A' },
				{ envVarKey: 'KEY_B', name: null },
			]);

			const result = await listOrgCredentialsMeta('org-1');
			expect(result).toEqual([
				{ envVarKey: 'KEY_A', name: 'A' },
				{ envVarKey: 'KEY_B', name: null },
			]);
		});
	});

	describe('deleteOrgCredential', () => {
		it('issues a delete', async () => {
			await deleteOrgCredential('org-1', 'KEY_A');
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});
});
