/**
 * Trello PM provider manifest.
 *
 * Wires the existing Trello implementation (TrelloIntegration, Trello
 * router adapter, Trello triggers, TrelloPlatformClient) into the
 * PMProviderManifest contract landed in plan 006/1.
 *
 * Signing: Trello uses HMAC-SHA1(rawBody + callbackUrl), NOT the shared
 * HMAC-SHA256 factory. The manifest wires the existing
 * `verifyTrelloSignature` helper from `src/webhook/signatureVerification.ts`
 * and reconstructs the callback URL from `host` + `x-forwarded-proto`
 * headers — consistent with how the router has always verified Trello
 * webhooks (`src/router/webhookVerification.ts`).
 */

import { TrelloIntegration } from '../../../pm/trello/integration.js';
import { TrelloRouterAdapter } from '../../../router/adapters/trello.js';
import { TrelloPlatformClient } from '../../../router/platformClients/trello.js';
import { buildTrelloCallbackUrl } from '../../../router/webhookVerification.js';
import { TrelloCommentMentionTrigger } from '../../../triggers/trello/comment-mention.js';
import { ReadyToProcessLabelTrigger } from '../../../triggers/trello/label-added.js';
import {
	TrelloStatusChangedBacklogTrigger,
	TrelloStatusChangedMergedTrigger,
	TrelloStatusChangedPlanningTrigger,
	TrelloStatusChangedSplittingTrigger,
	TrelloStatusChangedTodoTrigger,
} from '../../../triggers/trello/status-changed.js';
import { verifyTrelloSignature } from '../../../webhook/signatureVerification.js';
import type { PMProviderManifest, WebhookVerifier } from '../manifest.js';

const TRELLO_SIGNATURE_HEADER = 'x-trello-webhook';

const verifyTrelloWebhookSignatureViaManifest: WebhookVerifier = (rawBody, headers, secret) => {
	if (secret === null) return true; // opt-out matches existing router behavior

	const signature = readHeader(headers, TRELLO_SIGNATURE_HEADER);
	if (!signature) return false;

	const host = readHeader(headers, 'host');
	const proto = readHeader(headers, 'x-forwarded-proto');
	const callbackUrl = buildTrelloCallbackUrl(host, proto);

	return verifyTrelloSignature(rawBody, callbackUrl, signature, secret);
};

function readHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
	if (headers[name] !== undefined) return headers[name];
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === name) return headers[key];
	}
	return undefined;
}

const trelloIntegration = new TrelloIntegration();

export const trelloManifest: PMProviderManifest = {
	id: 'trello',
	label: 'Trello',
	category: 'pm',

	credentialRoles: [
		{ role: 'api_key', label: 'API Key', envVarKey: 'TRELLO_API_KEY' },
		{ role: 'token', label: 'Token', envVarKey: 'TRELLO_TOKEN' },
		{ role: 'api_secret', label: 'API Secret', envVarKey: 'TRELLO_API_SECRET', optional: true },
	],

	webhookRoute: '/trello/webhook',
	verifyWebhookSignature: verifyTrelloWebhookSignatureViaManifest,

	routerAdapter: new TrelloRouterAdapter(),

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== 'trello') return null;
		return d.projectId ?? null;
	},

	pmIntegration: trelloIntegration,

	triggerHandlers: [
		new TrelloCommentMentionTrigger(),
		TrelloStatusChangedSplittingTrigger,
		TrelloStatusChangedPlanningTrigger,
		TrelloStatusChangedTodoTrigger,
		TrelloStatusChangedBacklogTrigger,
		TrelloStatusChangedMergedTrigger,
		new ReadyToProcessLabelTrigger(),
	],

	platformClientFactory: (projectId) => new TrelloPlatformClient(projectId),
};
