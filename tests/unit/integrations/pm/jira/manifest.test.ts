/**
 * JIRA manifest — conformance + JIRA-specific behaviors.
 *
 * JIRA's signing scheme is plain HMAC-SHA256 over the raw body with a
 * `sha256=` prefix, hex-encoded — this maps cleanly onto the shared
 * `makeHmacSha256Verifier` factory from plan 006/1.
 *
 * The shared conformance harness at tests/unit/integrations/pm-conformance.test.ts
 * already exercises every cross-cutting contract invariant against every
 * registered provider; this file adds JIRA-specific behaviors.
 */

import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PMProviderManifest } from '../../../../../src/integrations/pm/manifest.js';
import { getPMProvider } from '../../../../../src/integrations/pm/registry.js';
import type { CascadeJob } from '../../../../../src/router/queue.js';

let manifest: PMProviderManifest;

beforeAll(async () => {
	await import('../../../../../src/integrations/pm/jira/index.js');
	const m = getPMProvider('jira');
	if (!m) throw new Error('jiraManifest was not registered');
	manifest = m;
});

describe('jiraManifest — identity', () => {
	it("id is 'jira'", () => {
		expect(manifest.id).toBe('jira');
	});

	it("category is 'pm'", () => {
		expect(manifest.category).toBe('pm');
	});

	it("webhookRoute is '/jira/webhook'", () => {
		expect(manifest.webhookRoute).toBe('/jira/webhook');
	});
});

describe('jiraManifest — credentialRoles', () => {
	it('exposes email + api_token (required) and webhook_secret (optional)', () => {
		const byRole = Object.fromEntries(manifest.credentialRoles.map((r) => [r.role, r]));
		expect(byRole.email).toMatchObject({ role: 'email', envVarKey: 'JIRA_EMAIL' });
		expect(byRole.email.optional).toBeFalsy();
		expect(byRole.api_token).toMatchObject({ role: 'api_token', envVarKey: 'JIRA_API_TOKEN' });
		expect(byRole.api_token.optional).toBeFalsy();
		expect(byRole.webhook_secret).toMatchObject({
			role: 'webhook_secret',
			envVarKey: 'JIRA_WEBHOOK_SECRET',
			optional: true,
		});
	});

	it("does NOT include base_url as a credential role (it's an integration-config field)", () => {
		expect(manifest.credentialRoles.find((r) => r.role === 'base_url')).toBeUndefined();
	});
});

describe('jiraManifest — verifyWebhookSignature', () => {
	const RAW_BODY = '{"webhookEvent":"jira:issue_updated","issue":{"key":"PROJ-1"}}';
	const SECRET = 'jira-webhook-secret';

	function validSignature(body: string, secret: string): string {
		return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
	}

	it("accepts a valid signature of the form 'sha256=<hex>'", () => {
		const sig = `sha256=${validSignature(RAW_BODY, SECRET)}`;
		expect(manifest.verifyWebhookSignature(RAW_BODY, { 'x-hub-signature': sig }, SECRET)).toBe(
			true,
		);
	});

	it('rejects a tampered body', () => {
		const sig = `sha256=${validSignature(RAW_BODY, SECRET)}`;
		expect(
			manifest.verifyWebhookSignature(`${RAW_BODY}tampered`, { 'x-hub-signature': sig }, SECRET),
		).toBe(false);
	});

	it('rejects when the x-hub-signature header is missing', () => {
		expect(manifest.verifyWebhookSignature(RAW_BODY, {}, SECRET)).toBe(false);
	});

	it('returns true (opt-out) when secret is null', () => {
		expect(manifest.verifyWebhookSignature(RAW_BODY, {}, null)).toBe(true);
	});
});

describe('jiraManifest — extractProjectIdFromJob', () => {
	it("returns projectId for { type: 'jira', projectId }", async () => {
		const job = { type: 'jira', projectId: 'proj-1' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBe('proj-1');
	});

	it('returns null for a foreign job type', async () => {
		const job = { type: 'github', projectId: 'proj-1' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBeNull();
	});

	it('returns null for a JIRA job missing projectId', async () => {
		const job = { type: 'jira' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBeNull();
	});
});

describe('jiraManifest — wiring', () => {
	it('platformClientFactory returns an object with postComment + deleteComment', () => {
		const client = manifest.platformClientFactory('proj-1');
		expect(typeof client.postComment).toBe('function');
		expect(typeof client.deleteComment).toBe('function');
	});

	it('routerAdapter.type is jira', () => {
		expect(manifest.routerAdapter.type).toBe('jira');
	});

	it('pmIntegration.type is jira', () => {
		expect(manifest.pmIntegration.type).toBe('jira');
	});

	it('triggerHandlers includes all jira built-in handlers', () => {
		const names = manifest.triggerHandlers.map((h) => h.name);
		expect(names).toEqual(
			expect.arrayContaining([
				'jira-comment-mention',
				'jira-status-changed',
				'jira-ready-to-process-label-added',
			]),
		);
	});
});
