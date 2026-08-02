/**
 * Shared helpers for the external webhook trigger (TRIGGER_EVENTS.INTERNAL.EXTERNAL_WEBHOOK).
 *
 * External systems dispatch an agent by POSTing to the router at
 * `/external/webhook/:projectId/:agentType`, authenticated with a Bearer
 * password stored as a project credential. This module is deliberately
 * dependency-light: it is imported by the router endpoint AND by the web
 * bundle (value-import-from-src precedent: web/src/lib/trigger-agent-mapping.ts).
 */

import { TRIGGER_EVENTS } from './events.js';

export const EXTERNAL_WEBHOOK_EVENT = TRIGGER_EVENTS.INTERNAL.EXTERNAL_WEBHOOK;

const AGENT_TYPE_SLUG_RE = /^[a-z][a-z0-9-]*$/;

/** Agent type slugs are lowercase kebab identifiers (e.g. 'backlog-manager'). */
export function isValidAgentTypeSlug(agentType: string): boolean {
	return agentType.length <= 64 && AGENT_TYPE_SLUG_RE.test(agentType);
}

/**
 * The project_credentials env var key holding the webhook password for one
 * agent type, e.g. 'implementation' → 'EXTERNAL_WEBHOOK_PASSWORD_IMPLEMENTATION',
 * 'backlog-manager' → 'EXTERNAL_WEBHOOK_PASSWORD_BACKLOG_MANAGER'.
 * Always matches the credential key pattern /^[A-Z_][A-Z0-9_]*$/.
 */
export function externalWebhookCredentialKey(agentType: string): string {
	if (!isValidAgentTypeSlug(agentType)) {
		throw new Error(`Invalid agent type slug: ${agentType}`);
	}
	return `EXTERNAL_WEBHOOK_PASSWORD_${agentType.toUpperCase().replace(/-/g, '_')}`;
}

/** Router path for one project + agent's external webhook endpoint. */
export function externalWebhookPath(projectId: string, agentType: string): string {
	return `/external/webhook/${projectId}/${agentType}`;
}
