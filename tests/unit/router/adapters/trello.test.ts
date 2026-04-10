import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));
vi.mock('../../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
}));
vi.mock('../../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn(),
	resolveTrelloBotMemberId: vi.fn(),
}));
vi.mock('../../../../src/router/ackMessageGenerator.js', () => ({
	extractTrelloContext: vi.fn().mockReturnValue('Card: Test card'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting implementation...'),
}));
vi.mock('../../../../src/router/platformClients/index.js', () => ({
	resolveTrelloCredentials: vi.fn().mockResolvedValue({ apiKey: 'key', token: 'tok' }),
}));
vi.mock('../../../../src/utils/runLink.js', () => ({
	buildWorkItemRunsLink: vi.fn().mockReturnValue(null),
	getDashboardUrl: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn().mockImplementation((_creds: unknown, fn: () => unknown) => fn()),
	trelloClient: {
		getCard: vi.fn().mockResolvedValue({
			id: 'card1',
			name: 'Test card',
			desc: '',
			idList: 'list1',
			labels: [],
			url: 'https://trello.com/c/card1',
			shortUrl: 'https://trello.com/c/card1',
		}),
	},
}));
vi.mock('../../../../src/router/trello.js', () => ({
	isAgentLogFilename: vi.fn().mockReturnValue(false),
	isAgentLogAttachmentUploaded: vi.fn().mockReturnValue(false),
	isCardInTriggerList: vi.fn().mockReturnValue(false),
	isReadyToProcessLabelAdded: vi.fn().mockReturnValue(false),
	isSelfAuthoredTrelloComment: vi.fn().mockResolvedValue(false),
	checkCardHasRequiredLabel: vi.fn().mockResolvedValue(true),
}));

import { postTrelloAck } from '../../../../src/router/acknowledgments.js';
import { TrelloRouterAdapter } from '../../../../src/router/adapters/trello.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import { resolveTrelloCredentials } from '../../../../src/router/platformClients/index.js';
import { sendAcknowledgeReaction } from '../../../../src/router/reactions.js';
import {
	checkCardHasRequiredLabel,
	isCardInTriggerList,
	isSelfAuthoredTrelloComment,
} from '../../../../src/router/trello.js';
import { trelloClient } from '../../../../src/trello/client.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../../../src/utils/runLink.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'trello',
	trello: {
		boardId: 'board1',
		lists: {
			splitting: 'list-splitting',
			planning: 'list-planning',
			todo: 'list-todo',
			debug: 'list-debug',
		},
		labels: { readyToProcess: 'label-ready' },
	},
};

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: [mockProject],
		fullProjects: [{ id: 'p1' } as never],
	});
});

describe('TrelloRouterAdapter', () => {
	let adapter: TrelloRouterAdapter;

	beforeEach(() => {
		adapter = new TrelloRouterAdapter();
	});

	describe('parseWebhook', () => {
		it('returns null for invalid payload', async () => {
			const result = await adapter.parseWebhook(null);
			expect(result).toBeNull();
		});

		it('returns null when no matching project', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [], fullProjects: [] });
			const result = await adapter.parseWebhook({
				action: { type: 'commentCard', data: {} },
				model: { id: 'unknown-board' },
			});
			expect(result).toBeNull();
		});

		it('returns parsed event for commentCard action', async () => {
			vi.mocked(isCardInTriggerList).mockReturnValue(false);
			const result = await adapter.parseWebhook({
				action: { type: 'commentCard', data: { card: { id: 'card1' } } },
				model: { id: 'board1' },
			});
			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('commentCard');
			expect(result?.workItemId).toBe('card1');
			expect(result?.isCommentEvent).toBe(true);
		});

		it('returns null for non-processable action on matching project', async () => {
			vi.mocked(isCardInTriggerList).mockReturnValue(false);
			const result = await adapter.parseWebhook({
				action: { type: 'createCheckItem', data: {} },
				model: { id: 'board1' },
			});
			expect(result).toBeNull();
		});
	});

	describe('isProcessableEvent', () => {
		it('always returns true (filtering done in parseWebhook)', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					isCommentEvent: true,
				}),
			).toBe(true);
		});
	});

	describe('isSelfAuthored', () => {
		it('returns false for non-comment events', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'board1', eventType: 'updateCard', isCommentEvent: false },
				{},
			);
			expect(result).toBe(false);
		});

		it('delegates to isSelfAuthoredTrelloComment for comment events', async () => {
			vi.mocked(isSelfAuthoredTrelloComment).mockResolvedValue(true);
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{ action: { idMemberCreator: 'bot-id' } },
			);
			expect(result).toBe(true);
		});
	});

	describe('sendReaction', () => {
		it('does nothing for non-comment events', () => {
			adapter.sendReaction(
				{ projectIdentifier: 'board1', eventType: 'updateCard', isCommentEvent: false },
				{},
			);
			// No reaction should be dispatched
		});

		it('fires reaction for comment events', async () => {
			adapter.sendReaction(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{ action: { type: 'commentCard' } },
			);
			// Wait for the fire-and-forget async to complete
			await vi.waitFor(() => {
				expect(sendAcknowledgeReaction).toHaveBeenCalledWith('trello', 'p1', expect.any(Object));
			});
		});
	});

	describe('resolveProject', () => {
		it('returns project matching boardId', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'board1',
				eventType: 'commentCard',
				isCommentEvent: true,
			});
			expect(project?.id).toBe('p1');
		});

		it('returns null for unknown boardId', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'unknown-board',
				eventType: 'commentCard',
				isCommentEvent: true,
			});
			expect(project).toBeNull();
		});
	});

	describe('resolveAllProjects', () => {
		it('returns empty array for unknown boardId', async () => {
			const projects = await adapter.resolveAllProjects({
				projectIdentifier: 'unknown-board',
				eventType: 'updateCard',
				isCommentEvent: false,
			});
			expect(projects).toHaveLength(0);
		});

		it('returns single project when only one matches and no requiredLabelId', async () => {
			// No project has requiredLabelId, no label lookup needed
			const projects = await adapter.resolveAllProjects({
				projectIdentifier: 'board1',
				eventType: 'updateCard',
				isCommentEvent: false,
			});
			expect(projects).toHaveLength(1);
			expect(projects[0].id).toBe('p1');
			expect(trelloClient.getCard).not.toHaveBeenCalled();
		});

		it('pre-filters by card labels when multiple projects share a board', async () => {
			const projectCascade: RouterProjectConfig = {
				...mockProject,
				id: 'cascade',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-cascade' },
			};
			const projectBdgt: RouterProjectConfig = {
				...mockProject,
				id: 'bdgt',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-bdgt' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [projectCascade, projectBdgt],
				fullProjects: [{ id: 'cascade' } as never, { id: 'bdgt' } as never],
			});
			// Card only has the bdgt label
			vi.mocked(trelloClient.getCard).mockResolvedValueOnce({
				id: 'card1',
				name: 'Test card',
				desc: '',
				idList: 'list1',
				labels: [{ id: 'label-bdgt', name: 'project:bdgt', color: 'orange' }],
				url: 'https://trello.com/c/card1',
				shortUrl: 'https://trello.com/c/card1',
			});

			const projects = await adapter.resolveAllProjects({
				projectIdentifier: 'board1',
				eventType: 'updateCard',
				workItemId: 'card1',
				isCommentEvent: false,
			});
			// Only bdgt should be returned (cascade's label not on card)
			expect(projects).toHaveLength(1);
			expect(projects[0].id).toBe('bdgt');
		});

		it('returns catch-all projects when card has no label matching any project', async () => {
			const projectCascade: RouterProjectConfig = {
				...mockProject,
				id: 'cascade',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-cascade' },
			};
			const projectBdgt: RouterProjectConfig = {
				...mockProject,
				id: 'bdgt',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-bdgt' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [projectCascade, projectBdgt],
				fullProjects: [{ id: 'cascade' } as never, { id: 'bdgt' } as never],
			});
			// Card has no project-specific labels
			vi.mocked(trelloClient.getCard).mockResolvedValueOnce({
				id: 'card1',
				name: 'Test card',
				desc: '',
				idList: 'list1',
				labels: [],
				url: 'https://trello.com/c/card1',
				shortUrl: 'https://trello.com/c/card1',
			});

			const projects = await adapter.resolveAllProjects({
				projectIdentifier: 'board1',
				eventType: 'updateCard',
				workItemId: 'card1',
				isCommentEvent: false,
			});
			// No label match and no catch-all → empty
			expect(projects).toHaveLength(0);
		});

		it('returns catch-all project when card has no matching label but catch-all exists', async () => {
			const projectCatchAll: RouterProjectConfig = {
				...mockProject,
				id: 'catch-all',
				// no requiredLabelId
			};
			const projectBdgt: RouterProjectConfig = {
				...mockProject,
				id: 'bdgt',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-bdgt' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [projectCatchAll, projectBdgt],
				fullProjects: [{ id: 'catch-all' } as never, { id: 'bdgt' } as never],
			});
			// Card has no labels → no specific match → fall back to catch-all
			vi.mocked(trelloClient.getCard).mockResolvedValueOnce({
				id: 'card1',
				name: 'Test card',
				desc: '',
				idList: 'list1',
				labels: [],
				url: 'https://trello.com/c/card1',
				shortUrl: 'https://trello.com/c/card1',
			});

			const projects = await adapter.resolveAllProjects({
				projectIdentifier: 'board1',
				eventType: 'updateCard',
				workItemId: 'card1',
				isCommentEvent: false,
			});
			expect(projects).toHaveLength(1);
			expect(projects[0].id).toBe('catch-all');
		});

		it('falls back to all candidates when getCard API call fails', async () => {
			const projectCascade: RouterProjectConfig = {
				...mockProject,
				id: 'cascade',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-cascade' },
			};
			const projectBdgt: RouterProjectConfig = {
				...mockProject,
				id: 'bdgt',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-bdgt' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [projectCascade, projectBdgt],
				fullProjects: [{ id: 'cascade' } as never, { id: 'bdgt' } as never],
			});
			vi.mocked(trelloClient.getCard).mockRejectedValueOnce(new Error('API error'));

			const projects = await adapter.resolveAllProjects({
				projectIdentifier: 'board1',
				eventType: 'updateCard',
				workItemId: 'card1',
				isCommentEvent: false,
			});
			// Falls back to all candidates on API failure
			expect(projects).toHaveLength(2);
		});

		it('skips label lookup when workItemId is absent', async () => {
			const projectWithLabel: RouterProjectConfig = {
				...mockProject,
				id: 'p1',
				trello: { ...mockProject.trello!, requiredLabelId: 'label-cascade' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [projectWithLabel],
				fullProjects: [{ id: 'p1' } as never],
			});
			vi.mocked(trelloClient.getCard).mockClear();

			// No workItemId in event
			const projects = await adapter.resolveAllProjects({
				projectIdentifier: 'board1',
				eventType: 'addLabelToCard',
				isCommentEvent: false,
			});
			// Returns all candidates without label lookup
			expect(projects).toHaveLength(1);
			expect(trelloClient.getCard).not.toHaveBeenCalled();
		});
	});

	describe('dispatchWithCredentials', () => {
		it('dispatches to trigger registry', async () => {
			vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValue({
				agentType: 'implementation',
				agentInput: { workItemId: 'card1' },
			} as never);

			const result = await adapter.dispatchWithCredentials(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{},
				mockProject,
				mockTriggerRegistry,
			);
			expect(result?.agentType).toBe('implementation');
		});

		it('returns null when no full project found', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [mockProject],
				fullProjects: [],
			});

			const result = await adapter.dispatchWithCredentials(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{},
				mockProject,
				mockTriggerRegistry,
			);
			expect(result).toBeNull();
		});
	});

	describe('postAck', () => {
		it('posts ack and returns AckResult with commentId and message', async () => {
			vi.mocked(postTrelloAck).mockResolvedValue('comment-123');
			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					workItemId: 'card1',
					isCommentEvent: true,
				},
				{},
				mockProject,
				'implementation',
			);
			expect(ackResult?.commentId).toBe('comment-123');
			expect(ackResult?.message).toBe('Starting implementation...');
		});

		it('returns undefined when no workItemId', async () => {
			const ackResult = await adapter.postAck(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{},
				mockProject,
				'implementation',
			);
			expect(ackResult).toBeUndefined();
		});
	});

	describe('buildJob', () => {
		it('builds a trello job with correct fields', () => {
			const result = {
				agentType: 'implementation',
				agentInput: { workItemId: 'card1' },
			};
			const job = adapter.buildJob(
				{
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					workItemId: 'card1',
					isCommentEvent: true,
				},
				{ action: { type: 'commentCard' } },
				mockProject,
				result as never,
			);
			expect(job.type).toBe('trello');
			expect(job.source).toBe('trello');
			expect((job as { workItemId: string }).workItemId).toBe('card1');
			expect((job as { ackCommentId?: string }).ackCommentId).toBeUndefined();
		});

		it('includes ackCommentId in job when ackResult is provided', () => {
			const result = { agentType: 'implementation', agentInput: {} };
			const job = adapter.buildJob(
				{
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					workItemId: 'card1',
					isCommentEvent: true,
				},
				{},
				mockProject,
				result as never,
				{ commentId: 'trello-comment-abc', message: 'Starting...' },
			);
			expect((job as { ackCommentId?: string }).ackCommentId).toBe('trello-comment-abc');
		});
	});

	describe('dispatchWithCredentials - additional paths', () => {
		it('returns null when Trello credentials are missing', async () => {
			vi.mocked(resolveTrelloCredentials).mockResolvedValueOnce(null);

			const result = await adapter.dispatchWithCredentials(
				{ projectIdentifier: 'board1', eventType: 'commentCard', isCommentEvent: true },
				{},
				mockProject,
				mockTriggerRegistry,
			);
			expect(result).toBeNull();
			expect(mockTriggerRegistry.dispatch).not.toHaveBeenCalled();
		});

		it('dispatches when card has the required label', async () => {
			const projectWithLabel: RouterProjectConfig = {
				...mockProject,
				trello: { ...mockProject.trello!, requiredLabelId: 'label-required' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [projectWithLabel],
				fullProjects: [{ id: 'p1' } as never],
			});
			vi.mocked(checkCardHasRequiredLabel).mockResolvedValueOnce(true);
			vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValue({
				agentType: 'implementation',
				agentInput: { workItemId: 'card1' },
			} as never);

			const result = await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'board1',
					eventType: 'updateCard',
					workItemId: 'card1',
					isCommentEvent: false,
				},
				{},
				projectWithLabel,
				mockTriggerRegistry,
			);
			expect(checkCardHasRequiredLabel).toHaveBeenCalledWith('card1', 'label-required');
			expect(result?.agentType).toBe('implementation');
		});

		it('returns null and skips dispatch when card lacks required label', async () => {
			const projectWithLabel: RouterProjectConfig = {
				...mockProject,
				trello: { ...mockProject.trello!, requiredLabelId: 'label-required' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [projectWithLabel],
				fullProjects: [{ id: 'p1' } as never],
			});
			vi.mocked(checkCardHasRequiredLabel).mockResolvedValueOnce(false);
			vi.mocked(mockTriggerRegistry.dispatch).mockClear();

			const result = await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'board1',
					eventType: 'updateCard',
					workItemId: 'card1',
					isCommentEvent: false,
				},
				{},
				projectWithLabel,
				mockTriggerRegistry,
			);
			expect(checkCardHasRequiredLabel).toHaveBeenCalledWith('card1', 'label-required');
			expect(result).toBeNull();
			expect(mockTriggerRegistry.dispatch).not.toHaveBeenCalled();
		});

		it('does not call checkCardHasRequiredLabel when no requiredLabelId configured', async () => {
			vi.mocked(checkCardHasRequiredLabel).mockClear();
			vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValue({
				agentType: 'implementation',
				agentInput: {},
			} as never);

			await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'board1',
					eventType: 'updateCard',
					workItemId: 'card1',
					isCommentEvent: false,
				},
				{},
				mockProject, // no requiredLabelId
				mockTriggerRegistry,
			);
			expect(checkCardHasRequiredLabel).not.toHaveBeenCalled();
		});
	});

	describe('postAck - additional paths', () => {
		it('appends run link footer when runLinksEnabled and dashboardUrl available', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [mockProject],
				fullProjects: [{ id: 'p1', runLinksEnabled: true } as never],
			});
			vi.mocked(getDashboardUrl).mockReturnValue('https://dashboard.example.com');
			vi.mocked(buildWorkItemRunsLink).mockReturnValue(
				'\n[View runs](https://dashboard.example.com/runs)',
			);
			vi.mocked(postTrelloAck).mockResolvedValue('comment-with-link');

			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					workItemId: 'card1',
					isCommentEvent: true,
				},
				{},
				mockProject,
				'implementation',
			);
			expect(buildWorkItemRunsLink).toHaveBeenCalled();
			expect(ackResult?.message).toContain('[View runs]');
		});

		it('handles postTrelloAck error gracefully (returns undefined)', async () => {
			vi.mocked(postTrelloAck).mockRejectedValue(new Error('Trello API error'));
			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'board1',
					eventType: 'commentCard',
					workItemId: 'card1',
					isCommentEvent: true,
				},
				{},
				mockProject,
				'implementation',
			);
			expect(ackResult).toBeUndefined();
		});
	});

	describe('sendReaction - additional paths', () => {
		it('does nothing when no project found for boardId', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [], fullProjects: [] });
			adapter.sendReaction(
				{ projectIdentifier: 'unknown-board', eventType: 'commentCard', isCommentEvent: true },
				{},
			);
			await vi.waitFor(() => {
				expect(sendAcknowledgeReaction).not.toHaveBeenCalled();
			});
		});
	});
});
