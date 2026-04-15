import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	findProjectById: vi.fn(),
}));

// Mock config cache (imported transitively)
vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		invalidate: vi.fn(),
	},
}));

// Mock logger
vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { findProjectById, getIntegrationCredential } from '../../../src/config/provider.js';
import {
	LinearPlatformClient,
	resolveGitHubHeaders,
	resolveJiraCredentials,
	resolveTrelloCredentials,
	TrelloPlatformClient,
} from '../../../src/router/platformClients/index.js';
import { logger } from '../../../src/utils/logging.js';

const mockLogger = vi.mocked(logger);

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockFindProjectById = vi.mocked(findProjectById);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_CREDENTIALS: Record<string, string> = {
	'pm/api_key': 'trello-key',
	'pm/token': 'trello-token',
	'pm/email': 'bot@example.com',
	'pm/api_token': 'jira-api-token',
};

const LINEAR_API_KEY = 'lin_api_test123';

function mockLinearApiKey() {
	mockGetIntegrationCredential.mockImplementation(async (_projectId, category, _provider, role) => {
		if (category === 'pm' && role === 'api_key') return LINEAR_API_KEY;
		throw new Error(`Credential '${category}/${role}' not found`);
	});
}

function lastFetchAuth(): unknown {
	const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
	const init = call?.[1] as { headers?: Record<string, string> } | undefined;
	return init?.headers?.Authorization;
}

function lastFetchBody(): { query?: string; variables?: unknown } {
	const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
	const init = call?.[1] as { body?: string } | undefined;
	return init?.body ? JSON.parse(init.body) : {};
}

const MOCK_PROJECT_WITH_JIRA = {
	id: 'proj1',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	jira: {
		baseUrl: 'https://test.atlassian.net',
		projectKey: 'PROJ',
		statuses: {},
		labels: {},
	},
};

beforeEach(() => {
	mockFetch.mockReset();

	mockGetIntegrationCredential.mockImplementation(async (_projectId, category, _provider, role) => {
		const value = MOCK_CREDENTIALS[`${category}/${role}`];
		if (value) return value;
		throw new Error(`Credential '${category}/${role}' not found`);
	});
	mockFindProjectById.mockResolvedValue(MOCK_PROJECT_WITH_JIRA);
});

// ---------------------------------------------------------------------------
// resolveTrelloCredentials
// ---------------------------------------------------------------------------

describe('resolveTrelloCredentials', () => {
	it('returns apiKey and token on success', async () => {
		const result = await resolveTrelloCredentials('proj1');

		expect(result).not.toBeNull();
		expect(result?.apiKey).toBe('trello-key');
		expect(result?.token).toBe('trello-token');
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveTrelloCredentials('proj1');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveJiraCredentials
// ---------------------------------------------------------------------------

describe('resolveJiraCredentials', () => {
	it('returns email, apiToken, baseUrl, and pre-computed auth on success', async () => {
		const result = await resolveJiraCredentials('proj1');

		expect(result).not.toBeNull();
		expect(result?.email).toBe('bot@example.com');
		expect(result?.apiToken).toBe('jira-api-token');
		expect(result?.baseUrl).toBe('https://test.atlassian.net');
		// auth is base64 of email:apiToken
		const expected = Buffer.from('bot@example.com:jira-api-token').toString('base64');
		expect(result?.auth).toBe(expected);
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveJiraCredentials('proj1');

		expect(result).toBeNull();
	});

	it('returns null when project has no JIRA base URL', async () => {
		mockFindProjectById.mockResolvedValue({
			id: 'proj1',
			name: 'Test',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
		});

		const result = await resolveJiraCredentials('proj1');

		expect(result).toBeNull();
	});

	it('returns null when project is not found', async () => {
		mockFindProjectById.mockResolvedValue(undefined);

		const result = await resolveJiraCredentials('proj1');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveGitHubHeaders
// ---------------------------------------------------------------------------

describe('resolveGitHubHeaders', () => {
	it('returns standard GitHub API headers', () => {
		const headers = resolveGitHubHeaders('ghp_token');

		expect(headers).toEqual({
			Authorization: 'Bearer ghp_token',
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
		});
	});

	it('merges extra headers without overwriting standard ones', () => {
		const headers = resolveGitHubHeaders('ghp_token', { 'Content-Type': 'application/json' });

		expect(headers['Content-Type']).toBe('application/json');
		expect(headers.Authorization).toBe('Bearer ghp_token');
	});

	it('allows overriding standard headers with extra', () => {
		const headers = resolveGitHubHeaders('ghp_token', { Accept: 'text/plain' });

		expect(headers.Accept).toBe('text/plain');
	});
});

// ---------------------------------------------------------------------------
// TrelloPlatformClient
// ---------------------------------------------------------------------------

describe('TrelloPlatformClient', () => {
	beforeEach(() => {
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
	});

	describe('postComment', () => {
		it('posts a comment and returns the comment ID', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'comment-abc' }),
			});

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBe('comment-abc');
			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toContain('https://api.trello.com/1/cards/card1/actions/comments');
			expect(url).toContain('key=trello-key');
			expect(url).toContain('token=trello-token');
			expect(options.method).toBe('POST');
			expect(JSON.parse(options.body)).toEqual({ text: 'Hello' });
		});

		it('returns null when credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing Trello credentials'),
			);
		});

		it('returns null on API error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: async () => 'Unauthorized',
			});

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Trello comment failed'),
				401,
				'Unauthorized',
			);
		});

		it('returns null on network error', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network failure'));

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to post Trello comment'),
				expect.stringContaining('Network failure'),
			);
		});

		it('returns null when response has no id', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({}),
			});

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
		});
	});

	describe('deleteComment', () => {
		it('sends DELETE request to remove comment', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			const client = new TrelloPlatformClient('proj1');
			await client.deleteComment('card1', 'comment-abc');

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toContain('https://api.trello.com/1/cards/card1/actions/comment-abc/comments');
			expect(options.method).toBe('DELETE');
		});

		it('silently returns when credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

			const client = new TrelloPlatformClient('proj1');
			await client.deleteComment('card1', 'comment-abc');

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('catches fetch errors gracefully', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			const client = new TrelloPlatformClient('proj1');
			await client.deleteComment('card1', 'comment-abc');

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to delete Trello comment'),
				expect.any(String),
			);
		});
	});
});

// ---------------------------------------------------------------------------
// LinearPlatformClient
// ---------------------------------------------------------------------------

describe('LinearPlatformClient', () => {
	beforeEach(() => {
		mockLinearApiKey();
	});

	describe('postComment', () => {
		it('sends bare API key (no Bearer prefix) — Linear personal API keys are not OAuth tokens', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: { commentCreate: { success: true, comment: { id: 'c-new' } } },
				}),
			});

			const client = new LinearPlatformClient('proj1');
			const id = await client.postComment('issue-uuid-1', 'hello');

			expect(id).toBe('c-new');
			expect(lastFetchAuth()).toBe(LINEAR_API_KEY);
			expect(lastFetchAuth()).not.toMatch(/^Bearer\s/);
		});

		it('posts the commentCreate mutation with issueId and body variables', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: { commentCreate: { success: true, comment: { id: 'c-1' } } },
				}),
			});

			const client = new LinearPlatformClient('proj1');
			await client.postComment('issue-uuid-2', 'Processing this issue');

			const body = lastFetchBody();
			expect(body.query).toContain('commentCreate');
			expect(body.variables).toEqual({
				issueId: 'issue-uuid-2',
				body: 'Processing this issue',
			});
		});

		it('logs the response body when Linear returns an HTTP error so the failure is diagnosable', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: async () => '{"error":"bad token"}',
			});

			const client = new LinearPlatformClient('proj1');
			const id = await client.postComment('issue-uuid-3', 'msg');

			expect(id).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to post Linear comment'),
				expect.stringContaining('bad token'),
			);
		});

		it('returns null without calling fetch when credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

			const client = new LinearPlatformClient('proj1');
			const id = await client.postComment('issue-uuid-4', 'msg');

			expect(id).toBeNull();
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe('deleteComment', () => {
		it('sends bare API key for delete', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: { commentDelete: { success: true } } }),
			});

			const client = new LinearPlatformClient('proj1');
			await client.deleteComment('issue-uuid-1', 'comment-abc');

			expect(lastFetchAuth()).toBe(LINEAR_API_KEY);
			expect(lastFetchAuth()).not.toMatch(/^Bearer\s/);
		});
	});

	describe('updateComment', () => {
		it('sends bare API key for update', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: { commentUpdate: { success: true } } }),
			});

			const client = new LinearPlatformClient('proj1');
			await client.updateComment('comment-abc', 'edited');

			expect(lastFetchAuth()).toBe(LINEAR_API_KEY);
			expect(lastFetchAuth()).not.toMatch(/^Bearer\s/);
		});
	});
});
