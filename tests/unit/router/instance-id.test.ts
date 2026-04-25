import { describe, expect, it } from 'vitest';
import { resolveRouterInstanceId } from '../../../src/router/instance-id.js';

describe('resolveRouterInstanceId', () => {
	it('returns process.env.CASCADE_ROUTER_INSTANCE when set non-empty', () => {
		expect(
			resolveRouterInstanceId({ CASCADE_ROUTER_INSTANCE: 'cascade-router-prod' }, 'fallback-host'),
		).toBe('cascade-router-prod');
	});

	it('falls back to hostname when env is undefined', () => {
		expect(resolveRouterInstanceId({}, 'bauer-12345')).toBe('bauer-12345');
	});

	it('falls back to hostname when env is empty string', () => {
		expect(resolveRouterInstanceId({ CASCADE_ROUTER_INSTANCE: '' }, 'bauer-12345')).toBe(
			'bauer-12345',
		);
	});

	it('falls back to hostname when env is whitespace-only', () => {
		expect(resolveRouterInstanceId({ CASCADE_ROUTER_INSTANCE: '   ' }, 'bauer-12345')).toBe(
			'bauer-12345',
		);
	});

	it('trims whitespace from the env value when honoring it', () => {
		expect(
			resolveRouterInstanceId(
				{ CASCADE_ROUTER_INSTANCE: '  cascade-router-staging  ' },
				'fallback-host',
			),
		).toBe('cascade-router-staging');
	});

	it('throws when both env and hostname are empty (defensive)', () => {
		// Should never happen in practice — os.hostname() always returns
		// something — but a fail-loud guard is cheap and prevents a silent
		// mis-tagging if a future runtime ever returns '' from hostname().
		expect(() => resolveRouterInstanceId({}, '')).toThrow(/Cannot resolve router instance id/i);
	});

	it('rejects whitespace-only hostname', () => {
		expect(() => resolveRouterInstanceId({}, '   ')).toThrow(/Cannot resolve router instance id/i);
	});
});
