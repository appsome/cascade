import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDbClientModule, mockGetDb } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	getIntegrationProvider,
	getProjectOwnCredential,
	listAllClaudeCodeCredentials,
	listAllNamedClaudeCodeTokens,
	listProjectCredentialsMeta,
	resolveAllProjectCredentials,
	resolveCredentialPool,
	resolveProjectCredential,
} from '../../../../src/db/repositories/credentialsRepository.js';

/**
 * Local mock: every `.where()` pops the next queued result and returns a
 * THENABLE that also supports `.orderBy().limit()` (drizzle's builder is both
 * awaitable and chainable — the shared createMockDb helper can only model one
 * of the two, and the named-set resolution path needs both).
 */
function createQueueMockDb() {
	const queue: unknown[] = [];
	const where = vi.fn(() => {
		const result = queue.length > 0 ? queue.shift() : [];
		const promise = Promise.resolve(result);
		return {
			// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle query chains
			then: promise.then.bind(promise),
			catch: promise.catch.bind(promise),
			orderBy: vi.fn(() => ({
				limit: vi.fn(() => Promise.resolve(result)),
				// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle query chains
				then: promise.then.bind(promise),
			})),
		};
	});
	const innerJoin = vi.fn(
		(): Record<string, unknown> => ({
			where,
			innerJoin,
			orderBy: vi.fn(() => queue.shift() ?? []),
		}),
	);
	const from = vi.fn(() => ({ where, innerJoin }));
	const db = {
		select: vi.fn(() => ({ from })),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(() => ({ where })),
		transaction: vi.fn(),
	};
	mockGetDb.mockReturnValue(db as never);
	return {
		db,
		where,
		push: (...results: unknown[]) => queue.push(...results),
	};
}

describe('credentialsRepository', () => {
	let mock: ReturnType<typeof createQueueMockDb>;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createQueueMockDb();
	});

	describe('resolveProjectCredential', () => {
		it('returns decrypted value when found', async () => {
			mock.push([{ value: 'ghp_impl_token' }]);

			const result = await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('ghp_impl_token');
		});

		it('does not query the org tier when the project row exists', async () => {
			mock.push([{ value: 'ghp_impl_token' }]);

			await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(mock.db.select).toHaveBeenCalledTimes(1);
		});

		it('falls back to the default set for a named-set provider key', async () => {
			// project row miss → project lookup → no selection → default-set hit
			mock.push([], [{ id: 'proj1', orgId: 'org-1' }], [], [{ value: 'org-shared-token' }]);

			const result = await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('org-shared-token');
		});

		it('resolves the selected set (lowest position) over the default set', async () => {
			// project miss → project lookup → selection hit → set value row
			mock.push([], [{ id: 'proj1', orgId: 'org-1' }], [{ setId: 7 }], [{ value: 'work-token' }]);

			const result = await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('work-token');
		});

		it('selected set lacking the key falls back to base tier, not the default set', async () => {
			// project miss → project lookup → selection hit → set row MISS → base row
			mock.push(
				[],
				[{ id: 'proj1', orgId: 'org-1' }],
				[{ setId: 7 }],
				[],
				[{ value: 'base-token' }],
			);

			const result = await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('base-token');
		});

		it('non-provider keys skip the set tiers entirely (base row only)', async () => {
			// project miss → project lookup → base row (no selection/default queries)
			mock.push([], [{ id: 'proj1', orgId: 'org-1' }], [{ value: 'base-value' }]);

			const result = await resolveProjectCredential('proj1', 'SOME_KEY');
			expect(result).toBe('base-value');
			expect(mock.db.select).toHaveBeenCalledTimes(3);
		});

		it('returns null when neither project nor org row exists', async () => {
			mock.push([], [{ id: 'proj1', orgId: 'org-1' }], []);

			const result = await resolveProjectCredential('proj1', 'MISSING_KEY');
			expect(result).toBeNull();
		});

		it('uses projectId as AAD for decryption when CREDENTIAL_MASTER_KEY is set', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			mock.push([{ value: encryptCredential('my-secret', 'proj1') }]);

			const result = await resolveProjectCredential('proj1', 'SOME_KEY');
			expect(result).toBe('my-secret');
		});

		it('uses orgId as AAD when decrypting an org-tier fallback value', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			mock.push(
				[],
				[{ id: 'proj1', orgId: 'org-1' }],
				[{ value: encryptCredential('org-secret', 'org-1') }],
			);

			const result = await resolveProjectCredential('proj1', 'SOME_KEY');
			expect(result).toBe('org-secret');
		});
	});

	describe('resolveAllProjectCredentials', () => {
		// Query order: project lookup, base rows, selection rows, default rows,
		// project rows.
		it('returns all project credentials as key-value map', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[],
				[],
				[],
				[
					{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'ghp_impl' },
					{ envVarKey: 'TRELLO_API_KEY', value: 'trello-key' },
					{ envVarKey: 'OPENROUTER_API_KEY', value: 'or-key' },
				],
			);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				GITHUB_TOKEN_IMPLEMENTER: 'ghp_impl',
				TRELLO_API_KEY: 'trello-key',
				OPENROUTER_API_KEY: 'or-key',
			});
		});

		it('merges base org credentials underneath project credentials (project wins)', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[
					{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'org-shared' },
					{ envVarKey: 'SENTRY_API_TOKEN', value: 'org-sentry' },
				],
				[],
				[],
				[{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'project-override' }],
			);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				GITHUB_TOKEN_IMPLEMENTER: 'project-override',
				SENTRY_API_TOKEN: 'org-sentry',
			});
		});

		it('default-set rows apply only for providers WITHOUT a selection', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[],
				// selection for anthropic at position 0
				[
					{
						provider: 'anthropic',
						position: 0,
						envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN',
						value: 'selected-token',
					},
				],
				// default rows for anthropic AND github
				[
					{ provider: 'anthropic', envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'default-token' },
					{ provider: 'github', envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'default-gh' },
				],
				[],
			);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				CLAUDE_CODE_OAUTH_TOKEN: 'selected-token',
				GITHUB_TOKEN_IMPLEMENTER: 'default-gh',
			});
		});

		it('only the lowest-position selected set wins for a provider', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[],
				[
					{
						provider: 'anthropic',
						position: 1,
						envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN',
						value: 'secondary-token',
					},
					{
						provider: 'anthropic',
						position: 0,
						envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN',
						value: 'primary-token',
					},
				],
				[],
				[],
			);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'primary-token' });
		});

		it('decrypts each tier with its own AAD (orgId vs projectId)', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);
			const { encryptCredential } = await import('../../../../src/db/crypto.js');

			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[{ envVarKey: 'ORG_ONLY_KEY', value: encryptCredential('org-value', 'org-1') }],
				[],
				[],
				[{ envVarKey: 'PROJECT_KEY', value: encryptCredential('project-value', 'proj1') }],
			);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				ORG_ONLY_KEY: 'org-value',
				PROJECT_KEY: 'project-value',
			});
		});

		it('returns empty object when no credentials', async () => {
			mock.push([{ id: 'proj1', orgId: 'org-1' }], [], [], [], []);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({});
		});

		it('throws when project not found', async () => {
			mock.push([]);

			await expect(resolveAllProjectCredentials('nonexistent')).rejects.toThrow(
				'Project not found: nonexistent',
			);
		});

		it('issues five queries (hot path budget)', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[],
				[],
				[],
				[{ envVarKey: 'KEY1', value: 'val1' }],
			);

			await resolveAllProjectCredentials('proj1');

			expect(mock.db.select).toHaveBeenCalledTimes(5);
		});
	});

	describe('resolveCredentialPool', () => {
		it('project-local override short-circuits to a one-member pool', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[{ envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'proj-token' }],
			);

			const pool = await resolveCredentialPool('proj1', 'anthropic');
			expect(pool).toEqual([
				{
					setId: null,
					setName: 'Project override',
					position: 0,
					source: 'project',
					values: { CLAUDE_CODE_OAUTH_TOKEN: 'proj-token' },
				},
			]);
		});

		it('returns ordered selection members with their set values', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[], // no project override
				[
					{ setId: 1, position: 0, setName: 'personal' },
					{ setId: 2, position: 1, setName: 'work' },
				],
				[
					{ setId: 1, envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'tok-personal' },
					{ setId: 2, envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'tok-work' },
				],
			);

			const pool = await resolveCredentialPool('proj1', 'anthropic');
			expect(pool).toHaveLength(2);
			expect(pool[0]).toMatchObject({
				setId: 1,
				setName: 'personal',
				position: 0,
				source: 'selection',
				values: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-personal' },
			});
			expect(pool[1]).toMatchObject({
				setId: 2,
				setName: 'work',
				source: 'selection',
				values: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-work' },
			});
		});

		it('falls back to the default set when no selection exists', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[],
				[], // no selections
				[{ id: 5, name: 'Default' }],
				[{ envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'default-token' }],
			);

			const pool = await resolveCredentialPool('proj1', 'anthropic');
			expect(pool).toEqual([
				{
					setId: 5,
					setName: 'Default',
					position: 0,
					source: 'org-default',
					values: { CLAUDE_CODE_OAUTH_TOKEN: 'default-token' },
				},
			]);
		});

		it('falls back to base-tier rows when no sets exist at all', async () => {
			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[],
				[],
				[], // no default set
				[{ envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'base-token' }],
			);

			const pool = await resolveCredentialPool('proj1', 'anthropic');
			expect(pool).toEqual([
				{
					setId: null,
					setName: 'Organization',
					position: 0,
					source: 'org-base',
					values: { CLAUDE_CODE_OAUTH_TOKEN: 'base-token' },
				},
			]);
		});

		it('returns empty array when nothing is configured', async () => {
			mock.push([{ id: 'proj1', orgId: 'org-1' }], [], [], [], []);

			const pool = await resolveCredentialPool('proj1', 'anthropic');
			expect(pool).toEqual([]);
		});

		it('skips undecryptable member values instead of failing', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);
			const { encryptCredential } = await import('../../../../src/db/crypto.js');

			mock.push(
				[{ id: 'proj1', orgId: 'org-1' }],
				[],
				[{ setId: 1, position: 0, setName: 'personal' }],
				[
					{
						setId: 1,
						envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN',
						value: encryptCredential('good', 'org-1'),
					},
					{
						setId: 1,
						envVarKey: 'ANTHROPIC_API_KEY',
						value: encryptCredential('bad', 'wrong-aad'),
					},
				],
			);

			const pool = await resolveCredentialPool('proj1', 'anthropic');
			expect(pool[0].values).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'good' });
		});

		it('rejects unknown providers', async () => {
			await expect(resolveCredentialPool('proj1', 'asana')).rejects.toThrow(
				'Unknown credential provider',
			);
		});
	});

	describe('listProjectCredentialsMeta', () => {
		it('returns envVarKey and name without value column', async () => {
			mock.push([
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
			mock.push([]);

			const result = await listProjectCredentialsMeta('proj1');

			expect(result).toEqual([]);
		});
	});

	describe('getProjectOwnCredential', () => {
		it('returns the project-tier value without org fallback', async () => {
			mock.push([{ value: 'proj-token' }]);

			const result = await getProjectOwnCredential('proj1', 'CLAUDE_CODE_OAUTH_TOKEN');
			expect(result).toBe('proj-token');
			// Single query — never touches the org tier
			expect(mock.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when the project row is absent (no org fallback)', async () => {
			mock.push([]);

			const result = await getProjectOwnCredential('proj1', 'CLAUDE_CODE_OAUTH_TOKEN');
			expect(result).toBeNull();
			expect(mock.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null instead of throwing when decryption fails', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			// Encrypted with a different AAD — decryption with proj1 fails
			mock.push([{ value: encryptCredential('secret', 'other-project') }]);

			const result = await getProjectOwnCredential('proj1', 'CLAUDE_CODE_OAUTH_TOKEN');
			expect(result).toBeNull();
		});
	});

	describe('listAllClaudeCodeCredentials', () => {
		it('skips undecryptable rows instead of failing the whole query', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			mock.push([
				{
					projectId: 'proj-good',
					projectName: 'Good',
					value: encryptCredential('good-token', 'proj-good'),
				},
				{
					projectId: 'proj-bad',
					projectName: 'Bad',
					// Encrypted with the wrong AAD — decryption throws for proj-bad
					value: encryptCredential('bad-token', 'some-other-project'),
				},
			]);

			const result = await listAllClaudeCodeCredentials('org-1');
			expect(result).toEqual([
				{ projectId: 'proj-good', projectName: 'Good', value: 'good-token' },
			]);
		});
	});

	describe('listAllNamedClaudeCodeTokens', () => {
		it('returns decrypted named tokens and skips undecryptable rows', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);
			const { encryptCredential } = await import('../../../../src/db/crypto.js');

			mock.push([
				{
					setId: 1,
					setName: 'personal',
					isDefault: true,
					value: encryptCredential('tok-1', 'org-1'),
				},
				{
					setId: 2,
					setName: 'work',
					isDefault: false,
					value: encryptCredential('tok-2', 'wrong-aad'),
				},
			]);

			const result = await listAllNamedClaudeCodeTokens('org-1');
			expect(result).toEqual([{ setId: 1, setName: 'personal', isDefault: true, value: 'tok-1' }]);
		});
	});

	describe('getIntegrationProvider', () => {
		it('returns provider when integration is found', async () => {
			mock.push([{ provider: 'trello' }]);

			const result = await getIntegrationProvider('proj1', 'pm');

			expect(result).toBe('trello');
			expect(mock.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when no integration found for category', async () => {
			mock.push([]);

			const result = await getIntegrationProvider('proj1', 'nonexistent');

			expect(result).toBeNull();
		});
	});
});
