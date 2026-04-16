/**
 * Linear manifest — conformance + Linear-specific behaviors.
 *
 * Linear signs webhook bodies with HMAC-SHA256 hex in the `linear-signature`
 * header — no prefix. Shared `makeHmacSha256Verifier` factory covers it.
 */

import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PMProviderManifest } from '../../../../../src/integrations/pm/manifest.js';
import { getPMProvider } from '../../../../../src/integrations/pm/registry.js';
import type { CascadeJob } from '../../../../../src/router/queue.js';

let manifest: PMProviderManifest;

beforeAll(async () => {
	await import('../../../../../src/integrations/pm/linear/index.js');
	const m = getPMProvider('linear');
	if (!m) throw new Error('linearManifest was not registered');
	manifest = m;
});

describe('linearManifest — identity', () => {
	it("id is 'linear'", () => {
		expect(manifest.id).toBe('linear');
	});

	it("category is 'pm'", () => {
		expect(manifest.category).toBe('pm');
	});

	it("webhookRoute is '/linear/webhook'", () => {
		expect(manifest.webhookRoute).toBe('/linear/webhook');
	});
});

describe('linearManifest — credentialRoles', () => {
	it('exposes api_key (required) and webhook_secret (optional)', () => {
		const byRole = Object.fromEntries(manifest.credentialRoles.map((r) => [r.role, r]));
		expect(byRole.api_key).toMatchObject({ role: 'api_key', envVarKey: 'LINEAR_API_KEY' });
		expect(byRole.api_key.optional).toBeFalsy();
		expect(byRole.webhook_secret).toMatchObject({
			role: 'webhook_secret',
			envVarKey: 'LINEAR_WEBHOOK_SECRET',
			optional: true,
		});
	});
});

describe('linearManifest — verifyWebhookSignature', () => {
	const RAW_BODY = '{"action":"update","type":"Issue","data":{"id":"issue-1","stateId":"s-1"}}';
	const SECRET = 'linear-webhook-secret';

	function validSignature(body: string, secret: string): string {
		return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
	}

	it('accepts a valid HMAC-SHA256 hex signature in the linear-signature header', () => {
		const sig = validSignature(RAW_BODY, SECRET);
		expect(manifest.verifyWebhookSignature(RAW_BODY, { 'linear-signature': sig }, SECRET)).toBe(
			true,
		);
	});

	it('rejects a tampered body', () => {
		const sig = validSignature(RAW_BODY, SECRET);
		expect(
			manifest.verifyWebhookSignature(`${RAW_BODY}tampered`, { 'linear-signature': sig }, SECRET),
		).toBe(false);
	});

	it('rejects when the linear-signature header is missing', () => {
		expect(manifest.verifyWebhookSignature(RAW_BODY, {}, SECRET)).toBe(false);
	});

	it('returns true (opt-out) when secret is null', () => {
		expect(manifest.verifyWebhookSignature(RAW_BODY, {}, null)).toBe(true);
	});
});

describe('linearManifest — extractProjectIdFromJob', () => {
	it("returns projectId for { type: 'linear', projectId }", async () => {
		const job = { type: 'linear', projectId: 'proj-1' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBe('proj-1');
	});

	it('returns null for a foreign job type', async () => {
		const job = { type: 'github', projectId: 'proj-1' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBeNull();
	});

	it('returns null for a Linear job missing projectId', async () => {
		const job = { type: 'linear' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBeNull();
	});
});

describe('linearManifest — wiring', () => {
	it('platformClientFactory returns an object with postComment + deleteComment', () => {
		const client = manifest.platformClientFactory('proj-1');
		expect(typeof client.postComment).toBe('function');
		expect(typeof client.deleteComment).toBe('function');
	});

	it('routerAdapter.type is linear', () => {
		expect(manifest.routerAdapter.type).toBe('linear');
	});

	it('pmIntegration.type is linear', () => {
		expect(manifest.pmIntegration.type).toBe('linear');
	});

	it('triggerHandlers includes all linear built-in handlers', () => {
		const names = manifest.triggerHandlers.map((h) => h.name);
		expect(names).toEqual(
			expect.arrayContaining([
				'linear-comment-mention',
				'linear-status-changed',
				'linear-ready-to-process-label-added',
			]),
		);
	});
});
