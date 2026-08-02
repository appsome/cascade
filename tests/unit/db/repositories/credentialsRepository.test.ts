import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	getIntegrationProvider,
	listProjectCredentialsMeta,
	resolveAllProjectCredentials,
	resolveProjectCredential,
} from '../../../../src/db/repositories/credentialsRepository.js';

describe('credentialsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withDoubleJoin: true });
	});

	describe('resolveProjectCredential', () => {
		it('returns decrypted value when found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'ghp_impl_token' }]);

			const result = await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('ghp_impl_token');
		});

		it('does not query the org tier when the project row exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'ghp_impl_token' }]);

			await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('falls back to the org credential when the project row is missing', async () => {
			// Project miss, then org join hit
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'org-shared-token', orgId: 'org-1' }]);

			const result = await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('org-shared-token');
			expect(mockDb.db.select).toHaveBeenCalledTimes(2);
		});

		it('returns null when neither project nor org row exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveProjectCredential('proj1', 'MISSING_KEY');
			expect(result).toBeNull();
		});

		it('uses projectId as AAD for decryption when CREDENTIAL_MASTER_KEY is set', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			// Import encryptCredential to produce a valid encrypted value
			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			const encryptedValue = encryptCredential('my-secret', 'proj1');
			mockDb.chain.where.mockResolvedValueOnce([{ value: encryptedValue }]);

			const result = await resolveProjectCredential('proj1', 'SOME_KEY');
			expect(result).toBe('my-secret');
		});

		it('uses orgId as AAD when decrypting an org-tier fallback value', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			const encryptedValue = encryptCredential('org-secret', 'org-1');
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([{ value: encryptedValue, orgId: 'org-1' }]);

			const result = await resolveProjectCredential('proj1', 'SOME_KEY');
			expect(result).toBe('org-secret');
		});
	});

	describe('resolveAllProjectCredentials', () => {
		it('returns all project credentials as key-value map', async () => {
			// First select: project existence check (now includes orgId)
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1', orgId: 'org-1' }]);
			// Second select: org_credentials rows (none)
			mockDb.chain.where.mockResolvedValueOnce([]);
			// Third select: project_credentials rows
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'ghp_impl' },
				{ envVarKey: 'TRELLO_API_KEY', value: 'trello-key' },
				{ envVarKey: 'OPENROUTER_API_KEY', value: 'or-key' },
			]);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				GITHUB_TOKEN_IMPLEMENTER: 'ghp_impl',
				TRELLO_API_KEY: 'trello-key',
				OPENROUTER_API_KEY: 'or-key',
			});
		});

		it('merges org credentials underneath project credentials (project wins)', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1', orgId: 'org-1' }]);
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'org-shared' },
				{ envVarKey: 'SENTRY_API_TOKEN', value: 'org-sentry' },
			]);
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'project-override' },
			]);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				GITHUB_TOKEN_IMPLEMENTER: 'project-override',
				SENTRY_API_TOKEN: 'org-sentry',
			});
		});

		it('decrypts each tier with its own AAD (orgId vs projectId)', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);
			const { encryptCredential } = await import('../../../../src/db/crypto.js');

			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1', orgId: 'org-1' }]);
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'ORG_ONLY_KEY', value: encryptCredential('org-value', 'org-1') },
			]);
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'PROJECT_KEY', value: encryptCredential('project-value', 'proj1') },
			]);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				ORG_ONLY_KEY: 'org-value',
				PROJECT_KEY: 'project-value',
			});
		});

		it('returns empty object when no credentials', async () => {
			// Project exists
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1', orgId: 'org-1' }]);
			// No org credentials
			mockDb.chain.where.mockResolvedValueOnce([]);
			// No project credentials
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({});
		});

		it('throws when project not found', async () => {
			// Project does not exist
			mockDb.chain.where.mockResolvedValueOnce([]);

			await expect(resolveAllProjectCredentials('nonexistent')).rejects.toThrow(
				'Project not found: nonexistent',
			);
		});

		it('issues three queries: project check, org_credentials, project_credentials', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1', orgId: 'org-1' }]);
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([{ envVarKey: 'KEY1', value: 'val1' }]);

			await resolveAllProjectCredentials('proj1');

			expect(mockDb.db.select).toHaveBeenCalledTimes(3);
		});
	});

	describe('listProjectCredentialsMeta', () => {
		it('returns envVarKey and name without value column', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', name: 'GH Token' },
				{ envVarKey: 'OPENROUTER_API_KEY', name: null },
			]);

			const result = await listProjectCredentialsMeta('proj1');

			expect(result).toEqual([
				{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', name: 'GH Token' },
				{ envVarKey: 'OPENROUTER_API_KEY', name: null },
			]);
		});

		it('returns empty array when no credentials exist', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listProjectCredentialsMeta('proj1');

			expect(result).toEqual([]);
		});
	});

	describe('getIntegrationProvider', () => {
		it('returns provider when integration is found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ provider: 'trello' }]);

			const result = await getIntegrationProvider('proj1', 'pm');

			expect(result).toBe('trello');
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when no integration found for category', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getIntegrationProvider('proj1', 'nonexistent');

			expect(result).toBeNull();
		});
	});
});
