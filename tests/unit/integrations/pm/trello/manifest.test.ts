/**
 * Trello manifest — conformance + Trello-specific behaviors.
 *
 * The shared conformance harness in tests/unit/integrations/pm-conformance.test.ts
 * already asserts every cross-cutting contract invariant against every
 * registered provider. This file adds Trello-specific behaviors the harness
 * can't express — particularly the HMAC-SHA1(body + callbackUrl) signing
 * scheme, which differs from the shared HMAC-SHA256 factory.
 */

import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PMProviderManifest } from '../../../../../src/integrations/pm/manifest.js';
import { getPMProvider } from '../../../../../src/integrations/pm/registry.js';
import type { CascadeJob } from '../../../../../src/router/queue.js';

let manifest: PMProviderManifest;

beforeAll(async () => {
	// Import for side-effect registration.
	await import('../../../../../src/integrations/pm/trello/index.js');
	const m = getPMProvider('trello');
	if (!m) throw new Error('trelloManifest was not registered');
	manifest = m;
});

describe('trelloManifest — identity', () => {
	it("id is 'trello'", () => {
		expect(manifest.id).toBe('trello');
	});

	it("category is 'pm'", () => {
		expect(manifest.category).toBe('pm');
	});

	it("webhookRoute is '/trello/webhook'", () => {
		expect(manifest.webhookRoute).toBe('/trello/webhook');
	});
});

describe('trelloManifest — credentialRoles', () => {
	it('includes api_key + token (required) and api_secret (optional)', () => {
		const byRole = Object.fromEntries(manifest.credentialRoles.map((r) => [r.role, r]));
		expect(byRole.api_key).toMatchObject({ role: 'api_key', envVarKey: 'TRELLO_API_KEY' });
		expect(byRole.api_key.optional).toBeFalsy();
		expect(byRole.token).toMatchObject({ role: 'token', envVarKey: 'TRELLO_TOKEN' });
		expect(byRole.token.optional).toBeFalsy();
		expect(byRole.api_secret).toMatchObject({
			role: 'api_secret',
			envVarKey: 'TRELLO_API_SECRET',
			optional: true,
		});
	});
});

describe('trelloManifest — verifyWebhookSignature', () => {
	const RAW_BODY = '{"model":{"id":"board-1"},"action":{"type":"updateCard"}}';
	const SECRET = 'trello-app-secret';
	const CALLBACK_URL = 'https://api.example.com/trello/webhook';

	function validSignature(body: string, url: string, secret: string): string {
		return createHmac('sha1', secret)
			.update(body + url, 'utf8')
			.digest('base64');
	}

	it('accepts a valid HMAC-SHA1(body + callbackUrl) signature', () => {
		const sig = validSignature(RAW_BODY, CALLBACK_URL, SECRET);
		const headers = {
			'x-trello-webhook': sig,
			host: 'api.example.com',
			'x-forwarded-proto': 'https',
		};
		expect(manifest.verifyWebhookSignature(RAW_BODY, headers, SECRET)).toBe(true);
	});

	it('rejects a tampered body', () => {
		const sig = validSignature(RAW_BODY, CALLBACK_URL, SECRET);
		const headers = {
			'x-trello-webhook': sig,
			host: 'api.example.com',
			'x-forwarded-proto': 'https',
		};
		expect(manifest.verifyWebhookSignature(`${RAW_BODY}tampered`, headers, SECRET)).toBe(false);
	});

	it('rejects when x-trello-webhook header is missing', () => {
		expect(manifest.verifyWebhookSignature(RAW_BODY, { host: 'api.example.com' }, SECRET)).toBe(
			false,
		);
	});

	it('returns true (opt-out) when secret is null', () => {
		expect(manifest.verifyWebhookSignature(RAW_BODY, {}, null)).toBe(true);
	});
});

describe('trelloManifest — extractProjectIdFromJob', () => {
	it("returns projectId for { type: 'trello', projectId }", async () => {
		const job = { type: 'trello', projectId: 'proj-1' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBe('proj-1');
	});

	it('returns null for a foreign job type', async () => {
		const job = { type: 'github', projectId: 'proj-1' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBeNull();
	});

	it('returns null for a Trello job missing projectId', async () => {
		const job = { type: 'trello' } as unknown as CascadeJob;
		expect(await manifest.extractProjectIdFromJob(job)).toBeNull();
	});
});

describe('trelloManifest — wiring', () => {
	it('platformClientFactory returns an object with postComment + deleteComment', () => {
		const client = manifest.platformClientFactory('proj-1');
		expect(typeof client.postComment).toBe('function');
		expect(typeof client.deleteComment).toBe('function');
	});

	it('routerAdapter.type is trello', () => {
		expect(manifest.routerAdapter.type).toBe('trello');
	});

	it('pmIntegration.type is trello', () => {
		expect(manifest.pmIntegration.type).toBe('trello');
	});

	it('triggerHandlers includes all trello built-in handlers', () => {
		// Mirrors src/triggers/trello/register.ts. If a new handler is added there,
		// this assertion forces the manifest to include it — which is the whole
		// point of the registry-driven approach.
		const names = manifest.triggerHandlers.map((h) => h.name);
		expect(names).toEqual(
			expect.arrayContaining([
				'trello-comment-mention',
				'trello-status-changed-splitting',
				'trello-status-changed-planning',
				'trello-status-changed-todo',
				'trello-status-changed-backlog',
				'trello-status-changed-merged',
				'ready-to-process-label-added',
			]),
		);
	});
});
