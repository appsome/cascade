/**
 * Linear PM provider manifest.
 *
 * Wires the existing Linear implementation into the PMProviderManifest
 * contract. Linear signs webhook bodies with HMAC-SHA256 hex in the
 * `linear-signature` header — no prefix — so the shared
 * `makeHmacSha256Verifier` factory covers it directly.
 *
 * This plan (006/4) also migrates Linear's platform client + bot
 * identity resolver to the canonical `linearAuthHeader` helper and the
 * adapter's `resolveLabelId` to the shared `_shared/label-id-resolver`.
 * See the companion src/router/platformClients/linear.ts and
 * src/pm/linear/adapter.ts edits.
 */

import { LinearIntegration } from '../../../pm/linear/integration.js';
import { LinearRouterAdapter } from '../../../router/adapters/linear.js';
import { LinearPlatformClient } from '../../../router/platformClients/linear.js';
import { LinearCommentMentionTrigger } from '../../../triggers/linear/comment-mention.js';
import { LinearReadyToProcessLabelTrigger } from '../../../triggers/linear/label-added.js';
import { LinearStatusChangedTrigger } from '../../../triggers/linear/status-changed.js';
import { makeHmacSha256Verifier } from '../_shared/webhook-verifier.js';
import type { PMProviderManifest } from '../manifest.js';

const linearIntegration = new LinearIntegration();

export const linearManifest: PMProviderManifest = {
	id: 'linear',
	label: 'Linear',
	category: 'pm',

	credentialRoles: [
		{ role: 'api_key', label: 'API Key', envVarKey: 'LINEAR_API_KEY' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'LINEAR_WEBHOOK_SECRET',
			optional: true,
		},
	],

	webhookRoute: '/linear/webhook',
	verifyWebhookSignature: makeHmacSha256Verifier({
		headerName: 'linear-signature',
	}),

	routerAdapter: new LinearRouterAdapter(),

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== 'linear') return null;
		return d.projectId ?? null;
	},

	pmIntegration: linearIntegration,

	triggerHandlers: [
		new LinearCommentMentionTrigger(),
		new LinearStatusChangedTrigger(),
		new LinearReadyToProcessLabelTrigger(),
	],

	platformClientFactory: (projectId) => new LinearPlatformClient(projectId),
};
