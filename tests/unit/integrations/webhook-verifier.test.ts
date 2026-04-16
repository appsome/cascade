/**
 * Shared HMAC-SHA256 webhook-verifier factory for PM manifests.
 *
 * Manifests that use plain HMAC-SHA256 signatures (Linear, GitHub-style)
 * wire this factory into their `verifyWebhookSignature`. Providers with
 * unusual signing schemes (e.g. Trello, which signs `url + body`) keep
 * their bespoke verifier — this factory is for the common case.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeHmacSha256Verifier } from '../../../src/integrations/pm/_shared/webhook-verifier.js';

const SECRET = 'test-secret';
const BODY = '{"event":"test","payload":{}}';

function signBody(body: string, secret: string): string {
	return createHmac('sha256', secret).update(body).digest('hex');
}

describe('makeHmacSha256Verifier', () => {
	it('returns true for a valid signature (header without prefix)', () => {
		const verify = makeHmacSha256Verifier({ headerName: 'x-my-signature' });
		const sig = signBody(BODY, SECRET);
		expect(verify(BODY, { 'x-my-signature': sig }, SECRET)).toBe(true);
	});

	it('returns false when the body has been tampered with', () => {
		const verify = makeHmacSha256Verifier({ headerName: 'x-my-signature' });
		const sig = signBody(BODY, SECRET);
		expect(verify(`${BODY}tampered`, { 'x-my-signature': sig }, SECRET)).toBe(false);
	});

	it('returns false when the signature header is missing and a secret is set', () => {
		const verify = makeHmacSha256Verifier({ headerName: 'x-my-signature' });
		expect(verify(BODY, {}, SECRET)).toBe(false);
	});

	it('returns true (skip) when secret is null — opt-in HMAC', () => {
		// Matches existing router behavior: projects without a stored webhook
		// secret opt out of verification entirely. This preserves backward
		// compatibility for operators who haven't configured HMAC yet.
		const verify = makeHmacSha256Verifier({ headerName: 'x-my-signature' });
		expect(verify(BODY, {}, null)).toBe(true);
	});

	it('tolerates a configured header prefix (e.g. "sha256=")', () => {
		const verify = makeHmacSha256Verifier({
			headerName: 'x-hub-signature-256',
			headerPrefix: 'sha256=',
		});
		const sig = signBody(BODY, SECRET);
		expect(verify(BODY, { 'x-hub-signature-256': `sha256=${sig}` }, SECRET)).toBe(true);
	});
});
