/**
 * Shared HMAC-SHA256 webhook-verifier factory.
 *
 * Produces a `WebhookVerifier` (see manifest.ts) for the common case of
 * `signature = HMAC-SHA256(body, secret)` with the signature delivered in
 * a named header, optionally prefixed (e.g. `sha256=<hex>` for GitHub).
 *
 * Providers with unusual signing schemes (e.g. Trello signs
 * `callbackUrl + body`) implement their own verifier and don't use this
 * factory — it's for the common case only.
 *
 * Secret semantics match the existing router: when `secret === null` the
 * verifier returns `true`, meaning the project has opted out of HMAC
 * verification. Router layers above can still reject on other grounds.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookVerifier } from '../manifest.js';

export interface HmacVerifierOptions {
	/** Lowercase header name where the signature arrives (e.g. 'x-hub-signature-256'). */
	readonly headerName: string;
	/** Optional prefix to strip before hex comparison (e.g. 'sha256=' for GitHub). */
	readonly headerPrefix?: string;
}

export function makeHmacSha256Verifier(opts: HmacVerifierOptions): WebhookVerifier {
	const headerName = opts.headerName.toLowerCase();
	const prefix = opts.headerPrefix ?? '';

	return (rawBody, headers, secret) => {
		if (secret === null) return true; // opt-out

		// Case-insensitive header lookup — Node's http.IncomingHeaders lowercases
		// by default, but Hono and other adapters vary.
		const received = readHeader(headers, headerName);
		if (!received) return false;
		const stripped =
			prefix && received.startsWith(prefix) ? received.slice(prefix.length) : received;

		const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
		const expectedBuf = Buffer.from(expected, 'utf8');
		const receivedBuf = Buffer.from(stripped, 'utf8');
		if (expectedBuf.length !== receivedBuf.length) return false;
		return timingSafeEqual(expectedBuf, receivedBuf);
	};
}

function readHeader(
	headers: Record<string, string | undefined>,
	target: string,
): string | undefined {
	if (headers[target] !== undefined) return headers[target];
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === target) return headers[key];
	}
	return undefined;
}
