/**
 * Tests for the post-plan-006/5 integration registration wiring.
 *
 * `src/integrations/bootstrap.ts` was deleted in plan 006/5. The new
 * registration topology is:
 *   - `src/integrations/pm/index.js` — imports each PM manifest barrel
 *     (trello/jira/linear), then mirrors listPMProviders() into
 *     integrationRegistry.
 *   - `src/github/register.js` — registers GitHubSCMIntegration.
 *   - `src/sentry/register.js` — registers SentryAlertingIntegration.
 *
 * This test file asserts the end state matches what the old bootstrap
 * produced: all 5 integrations in integrationRegistry, PM providers in
 * pmRegistry (now a delegate over pmProviderRegistry).
 *
 * Heavy DB / HTTP dependencies are mocked so the integration classes can be
 * instantiated without a live database.
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test so that
// vi.mock hoisting runs first.
// ---------------------------------------------------------------------------

vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn().mockResolvedValue('mock-cred'),
	getIntegrationCredentialOrNull: vi.fn().mockResolvedValue(null),
	loadProjectConfigByBoardId: vi.fn().mockResolvedValue(null),
	loadProjectConfigByJiraProjectKey: vi.fn().mockResolvedValue(null),
	findProjectById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
	trelloClient: {},
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
	jiraClient: {},
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn().mockResolvedValue(null),
	hasAlertingIntegration: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn().mockResolvedValue(null),
	deleteTrelloAck: vi.fn().mockResolvedValue(undefined),
	resolveTrelloBotMemberId: vi.fn().mockResolvedValue(null),
	postJiraAck: vi.fn().mockResolvedValue(null),
	deleteJiraAck: vi.fn().mockResolvedValue(undefined),
	resolveJiraBotAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/pm/trello/adapter.js', () => ({
	TrelloPMProvider: vi.fn().mockImplementation(() => ({ type: 'trello' })),
}));

vi.mock('../../../src/pm/jira/adapter.js', () => ({
	JiraPMProvider: vi.fn().mockImplementation(() => ({ type: 'jira' })),
}));

// ---------------------------------------------------------------------------
// Import the three side-effect registration modules (replacing the old
// bootstrap.ts) and the singletons they populate.
// ---------------------------------------------------------------------------

import '../../../src/integrations/pm/index.js';
import '../../../src/github/register.js';
import '../../../src/sentry/register.js';

import { integrationRegistry } from '../../../src/integrations/registry.js';
import { pmRegistry } from '../../../src/pm/registry.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration registration (post-006/5)', () => {
	// -------------------------------------------------------------------------
	// All 5 integrations registered in integrationRegistry
	// -------------------------------------------------------------------------
	describe('integrationRegistry after side-effect imports', () => {
		it('registers trello (PM) integration', () => {
			const integration = integrationRegistry.getOrNull('trello');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('trello');
			expect(integration?.category).toBe('pm');
		});

		it('registers jira (PM) integration', () => {
			const integration = integrationRegistry.getOrNull('jira');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('jira');
			expect(integration?.category).toBe('pm');
		});

		it('registers github (SCM) integration', () => {
			const integration = integrationRegistry.getOrNull('github');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('github');
			expect(integration?.category).toBe('scm');
		});

		it('registers sentry (alerting) integration', () => {
			const integration = integrationRegistry.getOrNull('sentry');
			expect(integration).not.toBeNull();
			expect(integration?.type).toBe('sentry');
			expect(integration?.category).toBe('alerting');
		});

		it('getByCategory returns PM integrations', () => {
			expect(integrationRegistry.getByCategory('pm').length).toBeGreaterThanOrEqual(2);
		});

		it('getByCategory returns SCM integrations', () => {
			expect(integrationRegistry.getByCategory('scm').length).toBeGreaterThanOrEqual(1);
		});

		it('getByCategory returns alerting integrations', () => {
			expect(integrationRegistry.getByCategory('alerting').length).toBeGreaterThanOrEqual(1);
		});
	});

	// -------------------------------------------------------------------------
	// PM integrations also reachable through the pmRegistry delegate
	// -------------------------------------------------------------------------
	describe('pmRegistry (now a delegate over pmProviderRegistry)', () => {
		it('exposes trello', () => {
			expect(pmRegistry.getOrNull('trello')).not.toBeNull();
		});

		it('exposes jira', () => {
			expect(pmRegistry.getOrNull('jira')).not.toBeNull();
		});

		it('exposes linear', () => {
			expect(pmRegistry.getOrNull('linear')).not.toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// Idempotency — importing the side-effect modules again must not throw
	// -------------------------------------------------------------------------
	describe('idempotency', () => {
		it('does not throw when the PM barrel is imported a second time', async () => {
			// Node ESM caches modules, so re-importing is a no-op. The loop
			// inside the barrel also guards each registerPMProvider call.
			await expect(import('../../../src/integrations/pm/index.js')).resolves.not.toThrow();
		});
	});
});
