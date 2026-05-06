/**
 * Generic alert→PM materializer (spec 019).
 *
 * `materializeAlertWorkItem` converts an (source, externalId, project, hints) tuple
 * into a real PM work-item id:
 *   1. Resolves the alerts container from project config. Throws AlertSlotMissingError if absent.
 *   2. Checks for an existing (project, source, externalId) mapping in pr_work_items.
 *      - Found + PM card healthy → return existing id.
 *      - Found + PM card 404 → lazy-heal: create fresh card, replace mapping, emit WARN.
 *   3. Atomically claims the mapping row via INSERT … ON CONFLICT DO NOTHING.
 *      - Claimed (ownedHere=true) → create PM card, apply label+move, attach id to row.
 *      - Lost to concurrent winner (ownedHere=false) → poll winner's row for work_item_id;
 *        throw MaterializationRetryExhausted if polling budget exhausted.
 *   4. PM errors propagate untouched so BullMQ retry semantics apply.
 */

import {
	attachWorkItemId,
	claimExternalMapping,
	findByExternal,
	replaceWorkItemId,
} from '../../../db/repositories/prWorkItemsRepository.js';
import {
	getAlertLabelId,
	getAlertsContainerId,
	getAlertsStatusDestination,
} from '../../../pm/config.js';
import { pmRegistry } from '../../../pm/registry.js';
import type { ProjectConfig } from '../../../types/index.js';
import { logger } from '../../../utils/logging.js';
import {
	type AlertHints,
	AlertSlotMissingError,
	type AlertSource,
	MaterializationRetryExhausted,
} from './types.js';

const POLL_MAX_ATTEMPTS = 8;
const POLL_DELAY_MS = 250;

function is404Error(err: unknown): boolean {
	return err instanceof Error && /\b404\b/.test(err.message);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function materializeAlertWorkItem(
	source: AlertSource,
	externalId: string,
	project: ProjectConfig,
	hints: AlertHints,
): Promise<string> {
	const containerId = getAlertsContainerId(project);
	if (!containerId) {
		throw new AlertSlotMissingError(project.id, project.pm?.type);
	}

	const provider = pmRegistry.createProvider(project);

	// Step 1: check for an existing mapping
	const existing = await findByExternal(project.id, source, externalId);
	if (existing?.workItemId) {
		// Verify the PM card is still alive
		try {
			await provider.getWorkItem(existing.workItemId);
			return existing.workItemId;
		} catch (err) {
			if (!is404Error(err)) throw err;
			// Lazy-heal: card was deleted — fall through to create path
			return await createAndAttach(project, source, externalId, containerId, hints, provider, {
				lazyHeal: { rowId: existing.id, oldWorkItemId: existing.workItemId },
			});
		}
	}

	// Step 2: atomically claim the mapping row
	const claim = await claimExternalMapping(project.id, source, externalId);

	if (claim.ownedHere) {
		return await createAndAttach(project, source, externalId, containerId, hints, provider, {
			lazyHeal: null,
			rowId: claim.rowId,
		});
	}

	// Lost to a concurrent winner — poll for its work_item_id
	if (claim.existing.workItemId) return claim.existing.workItemId;

	for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
		await sleep(POLL_DELAY_MS);
		const row = await findByExternal(project.id, source, externalId);
		if (row?.workItemId) return row.workItemId;
	}

	throw new MaterializationRetryExhausted(project.id, source, externalId);
}

type CreateOpts =
	| { lazyHeal: { rowId: string; oldWorkItemId: string }; rowId?: undefined }
	| { lazyHeal: null; rowId: string };

async function createAndAttach(
	project: ProjectConfig,
	source: AlertSource,
	externalId: string,
	containerId: string,
	hints: AlertHints,
	provider: ReturnType<typeof pmRegistry.createProvider>,
	opts: CreateOpts,
): Promise<string> {
	const newCard = await provider.createWorkItem({
		containerId,
		title: hints.title,
		description: hints.descriptionMarkdown,
		labels: [],
	});

	const labelId = getAlertLabelId(project);
	if (labelId) {
		await provider.addLabel(newCard.id, labelId);
	}

	const destination = getAlertsStatusDestination(project);
	if (destination) {
		await provider.moveWorkItem(newCard.id, destination);
	}

	if (opts.lazyHeal) {
		const replaced = await replaceWorkItemId(
			opts.lazyHeal.rowId,
			opts.lazyHeal.oldWorkItemId,
			newCard.id,
		);
		if (replaced) {
			logger.warn('[alert-materializer] orphan card detected', {
				projectId: project.id,
				source,
				externalId,
				prior: opts.lazyHeal.oldWorkItemId,
				replacement: newCard.id,
			});
		}
	} else {
		await attachWorkItemId(opts.rowId, newCard.id);
	}

	return newCard.id;
}
