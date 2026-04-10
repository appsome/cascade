/**
 * TrelloRouterAdapter — platform-specific logic for the router-side
 * Trello webhook processing pipeline.
 *
 * Extracts the logic previously embedded in `router/trello.ts` into the
 * `RouterPlatformAdapter` interface so it can be driven by the generic
 * `processRouterWebhook()` function.
 */

import { trelloClient, withTrelloCredentials } from '../../trello/client.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../utils/runLink.js';
import { extractTrelloContext, generateAckMessage } from '../ackMessageGenerator.js';
import { postTrelloAck } from '../acknowledgments.js';
import { loadProjectConfig, type RouterProjectConfig } from '../config.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { resolveTrelloCredentials } from '../platformClients/index.js';
import type { CascadeJob, TrelloJob } from '../queue.js';
import { sendAcknowledgeReaction } from '../reactions.js';
import {
	checkCardHasRequiredLabel,
	isAgentLogAttachmentUploaded,
	isCardInTriggerList,
	isReadyToProcessLabelAdded,
	isSelfAuthoredTrelloComment,
} from '../trello.js';

export class TrelloRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'trello' as const;

	async parseWebhook(payload: unknown): Promise<ParsedWebhookEvent | null> {
		if (!payload || typeof payload !== 'object') return null;

		const p = payload as Record<string, unknown>;
		const action = p.action as Record<string, unknown> | undefined;
		const model = p.model as Record<string, unknown> | undefined;

		if (!action || !model) return null;

		const boardId = model.id as string;
		const actionType = action.type as string;
		const actionId = action.id as string | undefined;
		const data = action.data as Record<string, unknown> | undefined;

		const config = await loadProjectConfig();
		const project = config.projects.find((proj) => proj.trello?.boardId === boardId);
		if (!project) return null;

		const card = data?.card as Record<string, unknown> | undefined;
		const workItemId = card?.id as string | undefined;

		const isProcessable =
			isCardInTriggerList(actionType, data, project) ||
			isReadyToProcessLabelAdded(actionType, data, project) ||
			isAgentLogAttachmentUploaded(actionType, data, project) ||
			actionType === 'commentCard';

		if (!isProcessable) return null;

		return {
			projectIdentifier: boardId,
			eventType: actionType,
			workItemId,
			isCommentEvent: actionType === 'commentCard',
			actionId,
		};
	}

	isProcessableEvent(_event: ParsedWebhookEvent): boolean {
		// Filtering is already done in parseWebhook (returns null for non-processable)
		return true;
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		if (!event.isCommentEvent) return false;

		const config = await loadProjectConfig();
		const project = config.projects.find((p) => p.trello?.boardId === event.projectIdentifier);
		if (!project) return false;

		return isSelfAuthoredTrelloComment(payload, project.id);
	}

	sendReaction(event: ParsedWebhookEvent, payload: unknown): void {
		if (!event.isCommentEvent) return;
		void (async () => {
			try {
				const config = await loadProjectConfig();
				const project = config.projects.find((p) => p.trello?.boardId === event.projectIdentifier);
				if (!project) return;
				await sendAcknowledgeReaction('trello', project.id, payload);
			} catch (err) {
				logger.error('Trello reaction error', { error: String(err) });
			}
		})();
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const config = await loadProjectConfig();
		return config.projects.find((p) => p.trello?.boardId === event.projectIdentifier) ?? null;
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: label pre-filter requires branching over API result, fallback, and empty cases
	async resolveAllProjects(event: ParsedWebhookEvent): Promise<RouterProjectConfig[]> {
		const config = await loadProjectConfig();
		const candidates = config.projects.filter((p) => p.trello?.boardId === event.projectIdentifier);

		// When multiple projects share the same board and at least one uses a required-label
		// filter, fetch the card's labels from the Trello API now — before the dispatch loop —
		// so we route to the correct project immediately rather than relying on each
		// dispatchWithCredentials call to discover the mismatch.
		//
		// The Trello webhook payload does NOT include the card's current labels, so an explicit
		// API lookup is necessary for correct multi-project routing.
		if (event.workItemId && candidates.some((p) => p.trello?.requiredLabelId)) {
			for (const proj of candidates) {
				const creds = await resolveTrelloCredentials(proj.id);
				if (!creds) continue;

				try {
					const cardLabelIds = await withTrelloCredentials(creds, async () => {
						const card = await trelloClient.getCard(event.workItemId as string);
						return card.labels.map((l) => l.id);
					});

					// Return projects whose required label is present on the card.
					// Mark returned projects as pre-filtered so dispatchWithCredentials skips its
					// secondary label guard (avoiding a redundant getCard API call).
					const labelMatched = candidates.filter(
						(p) => p.trello?.requiredLabelId && cardLabelIds.includes(p.trello.requiredLabelId),
					);
					if (labelMatched.length > 0) {
						logger.info('Pre-filtered projects by card labels', {
							cardId: event.workItemId,
							matched: labelMatched.map((p) => p.id),
						});
						return labelMatched.map((p) => ({ ...p, _labelPreFiltered: true }));
					}

					// No label-specific match — fall back to projects without a required label (catch-all)
					const catchAll = candidates.filter((p) => !p.trello?.requiredLabelId);
					if (catchAll.length > 0) {
						logger.info('No label-matched project; falling back to catch-all projects', {
							cardId: event.workItemId,
							catchAll: catchAll.map((p) => p.id),
						});
						return catchAll.map((p) => ({ ...p, _labelPreFiltered: true }));
					}

					// Card has no label that matches any configured project — drop.
					logger.info('Card labels do not match any project requiredLabelId, skipping', {
						cardId: event.workItemId,
						cardLabelIds,
					});
					return [];
				} catch (err) {
					logger.warn(
						'Failed to look up card labels for project pre-filtering, falling back to all candidates',
						{ cardId: event.workItemId, error: String(err) },
					);
					break;
				}
			}
		}

		return candidates;
	}

	async dispatchWithCredentials(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		triggerRegistry: TriggerRegistry,
	): Promise<TriggerResult | null> {
		const config = await loadProjectConfig();
		const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
		if (!fullProject) {
			logger.info('No full project config for Trello webhook, skipping', {
				projectId: project.id,
			});
			return null;
		}

		const trelloCreds = await resolveTrelloCredentials(project.id);
		if (!trelloCreds) {
			logger.warn('Missing Trello credentials, cannot dispatch triggers', {
				projectId: project.id,
			});
			return null;
		}

		const ctx: TriggerContext = { project: fullProject, source: 'trello', payload };
		return withTrelloCredentials(trelloCreds, async () => {
			// Secondary label guard: ensures correctness when resolveAllProjects errored and
			// returned all candidates unfiltered. Skipped when _labelPreFiltered is set,
			// meaning resolveAllProjects already verified the label (avoids a duplicate getCard call).
			if (project.trello?.requiredLabelId && event.workItemId && !project._labelPreFiltered) {
				const hasLabel = await checkCardHasRequiredLabel(
					event.workItemId,
					project.trello.requiredLabelId,
				);
				if (!hasLabel) {
					logger.info('Card lacks required label, skipping dispatch', {
						cardId: event.workItemId,
						requiredLabelId: project.trello.requiredLabelId,
					});
					return null;
				}
			}
			return triggerRegistry.dispatch(ctx);
		});
	}

	async postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		_triggerResult?: TriggerResult,
	): Promise<AckResult | undefined> {
		if (!event.workItemId) return undefined;
		try {
			const context = extractTrelloContext(payload);
			let message = await generateAckMessage(agentType, context, project.id);

			// Append run link footer when enabled for this project
			const config = await loadProjectConfig();
			const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
			if (fullProject?.runLinksEnabled && event.workItemId) {
				const dashboardUrl = getDashboardUrl();
				if (dashboardUrl) {
					const link = buildWorkItemRunsLink({
						dashboardUrl,
						projectId: project.id,
						workItemId: event.workItemId,
					});
					if (link) message += link;
				}
			}

			const commentId = await postTrelloAck(project.id, event.workItemId, message);
			if (commentId) return { commentId, message };
			return undefined;
		} catch (err) {
			logger.warn('Trello ack comment failed (non-fatal)', {
				error: String(err),
				workItemId: event.workItemId,
			});
			return undefined;
		}
	}

	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
		ackResult?: AckResult,
	): CascadeJob {
		const job: TrelloJob = {
			type: 'trello',
			source: 'trello',
			payload,
			projectId: project.id,
			workItemId: event.workItemId ?? '',
			actionType: event.eventType,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
			ackCommentId: ackResult?.commentId as string | undefined,
		};
		return job;
	}
}
