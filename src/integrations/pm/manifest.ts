/**
 * PMProviderManifest — the single declarative contract for a PM provider.
 *
 * Historically, adding a PM provider required edits in ~10 cross-cutting
 * locations (router routes, adapter registry, trigger registry, credential
 * roles, job-dispatch extractor, wizard state union, wizard hooks, wizard
 * router, tRPC discovery endpoints). The Linear rollout surfaced this as
 * four separate silent bugs in production. A manifest collapses every
 * registration into one object per provider; a conformance harness
 * (tests/unit/integrations/pm-conformance.test.ts) asserts the contract
 * is fully implemented at CI time.
 *
 * A provider author writes ONE module that exports a `PMProviderManifest`
 * and side-effectfully calls `registerPMProvider(manifest)` at load time.
 * Nothing else in the codebase knows about that provider's existence.
 *
 * Frontend wizard definitions live in a parallel registry keyed by the
 * same `id` — see web/src/components/projects/pm-providers/.
 */

import type { PMIntegration } from '../../pm/integration.js';
import type { ParsedWebhookEvent, RouterPlatformAdapter } from '../../router/platform-adapter.js';
import type { PlatformCommentClient } from '../../router/platformClients/types.js';
import type { CascadeJob } from '../../router/queue.js';
import type { TriggerHandler } from '../../types/index.js';

// ParsedWebhookEvent is referenced transitively by RouterPlatformAdapter and
// isSelfAuthoredHook; re-exported so callers that want to type their hooks
// don't need to know the internal path.
export type { ParsedWebhookEvent };

/**
 * One credential the provider needs resolved at runtime. Mirrors the shape
 * already in use by `registerCredentialRoles()` in `src/config/integrationRoles.ts`.
 */
export interface CredentialRoleSpec {
	readonly role: string;
	readonly label: string;
	readonly envVarKey: string;
	/** When `true`, the role is not required for `hasIntegration()` to return true. */
	readonly optional?: boolean;
}

/**
 * A verifier asserts the webhook payload came from the provider. Returns
 * `true` when the request is authentic. Called with the raw body text (for
 * HMAC computation) and the parsed headers. `secret` is `null` when the
 * project has opted out of HMAC verification.
 */
export type WebhookVerifier = (
	rawBody: string,
	headers: Record<string, string | undefined>,
	secret: string | null,
) => boolean;

/**
 * Produces a platform client scoped to a project. The client posts
 * acknowledgment comments during router-side webhook handling; it is
 * distinct from the PMProvider used by agents (the adapter).
 */
export type PlatformClientFactory = (projectId: string) => PlatformCommentClient;

export interface PMProviderManifest {
	// ── Identity ────────────────────────────────────────────────────────
	readonly id: string;
	readonly label: string;
	readonly category: 'pm';

	// ── Credentials ─────────────────────────────────────────────────────
	readonly credentialRoles: readonly CredentialRoleSpec[];

	// ── Webhook ingestion ───────────────────────────────────────────────
	/**
	 * Conventionally `/${id}/webhook`. Enforced by the conformance harness.
	 * Operators manually configure this URL in each provider's UI.
	 */
	readonly webhookRoute: string;
	readonly verifyWebhookSignature: WebhookVerifier;

	// ── Router-side dispatch ────────────────────────────────────────────
	/**
	 * Includes `parseWebhook(raw)` which yields a ParsedWebhookEvent for
	 * router-side project resolution and trigger dispatch. Provider-domain
	 * parsing (PMWebhookEvent) lives on `pmIntegration.parseWebhookPayload`.
	 */
	readonly routerAdapter: RouterPlatformAdapter;

	/**
	 * Extract the CASCADE projectId from a job payload produced by this
	 * provider's router adapter. Returns `null` when the job belongs to a
	 * different provider. Forgetting to implement this case was the root
	 * cause of Linear workers spawning without credentials (see #1118).
	 */
	readonly extractProjectIdFromJob: (jobData: CascadeJob) => Promise<string | null>;

	// ── PM operations (agent-facing) ────────────────────────────────────
	readonly pmIntegration: PMIntegration;

	// ── Triggers ────────────────────────────────────────────────────────
	readonly triggerHandlers: readonly TriggerHandler[];

	// ── Router-side platform client (ack comments) ──────────────────────
	readonly platformClientFactory: PlatformClientFactory;

	// ── Optional provider-specific hooks ────────────────────────────────

	/**
	 * Returns `true` when the event was authored by the bot itself.
	 * Optional — providers without self-authored webhook events can omit.
	 * When omitted, `false` is assumed.
	 */
	readonly isSelfAuthoredHook?: (
		event: ParsedWebhookEvent,
		payload: unknown,
		projectId: string,
	) => Promise<boolean>;

	/**
	 * Create a single label on the provider (e.g. Trello board, Linear team).
	 * Manifests that support wizard-driven label creation implement this hook;
	 * others omit it and the generic `pm.discovery.createLabel` tRPC endpoint
	 * returns a 404 for that provider.
	 */
	readonly createLabel?: (
		containerId: string,
		name: string,
		color?: string,
	) => Promise<{ id: string; name: string; color: string }>;
}
