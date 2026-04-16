/**
 * JIRA PM provider manifest.
 *
 * Wires the existing JIRA implementation (JiraIntegration, JiraRouterAdapter,
 * JIRA triggers, JiraPlatformClient) into the PMProviderManifest contract.
 *
 * Signing: JIRA uses `HMAC-SHA256(body)` with `sha256=<hex>` in the
 * `X-Hub-Signature` header. This maps onto the shared
 * `makeHmacSha256Verifier` factory landed in plan 006/1.
 *
 * Labels: JIRA labels are free-form names — the JIRA API auto-creates
 * them on use. The shared `label-id-resolver` helper is NOT wired here;
 * it's UUID-only. No `createLabel` manifest hook either for the same
 * reason.
 */

import { JiraIntegration } from '../../../pm/jira/integration.js';
import { JiraRouterAdapter } from '../../../router/adapters/jira.js';
import { JiraPlatformClient } from '../../../router/platformClients/jira.js';
import { JiraCommentMentionTrigger } from '../../../triggers/jira/comment-mention.js';
import { JiraReadyToProcessLabelTrigger } from '../../../triggers/jira/label-added.js';
import { JiraStatusChangedTrigger } from '../../../triggers/jira/status-changed.js';
import { makeHmacSha256Verifier } from '../_shared/webhook-verifier.js';
import type { PMProviderManifest } from '../manifest.js';

const jiraIntegration = new JiraIntegration();

export const jiraManifest: PMProviderManifest = {
	id: 'jira',
	label: 'JIRA',
	category: 'pm',

	credentialRoles: [
		{ role: 'email', label: 'Email', envVarKey: 'JIRA_EMAIL' },
		{ role: 'api_token', label: 'API Token', envVarKey: 'JIRA_API_TOKEN' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'JIRA_WEBHOOK_SECRET',
			optional: true,
		},
	],

	webhookRoute: '/jira/webhook',
	verifyWebhookSignature: makeHmacSha256Verifier({
		headerName: 'x-hub-signature',
		headerPrefix: 'sha256=',
	}),

	routerAdapter: new JiraRouterAdapter(),

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== 'jira') return null;
		return d.projectId ?? null;
	},

	pmIntegration: jiraIntegration,

	triggerHandlers: [
		new JiraCommentMentionTrigger(),
		new JiraStatusChangedTrigger(),
		new JiraReadyToProcessLabelTrigger(),
	],

	platformClientFactory: (projectId) => new JiraPlatformClient(projectId),
};
