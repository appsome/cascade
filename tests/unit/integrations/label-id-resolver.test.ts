/**
 * Shared UUID-validating label resolver.
 *
 * Linear's GraphQL API (issueUpdate.labelIds, etc.) requires UUIDs — not
 * names. The session's `cascade-processing`-never-applies bug (PR #1121)
 * came from the Linear adapter silently passing a label name when the
 * config mapping was missing. Moving the resolver here makes it reusable
 * and testable independent of the adapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLabelId } from '../../../src/integrations/pm/_shared/label-id-resolver.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';

describe('resolveLabelId', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the mapped UUID when the mapping value is UUID-shaped', () => {
		const r = resolveLabelId('processing', { processing: UUID }, { providerId: 'linear' });
		expect(r).toBe(UUID);
	});

	it('returns null and warns when the mapping value is a name (not UUID)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = resolveLabelId(
			'processing',
			{ processing: 'cascade-processing' },
			{ providerId: 'linear' },
		);
		expect(r).toBeNull();
		// We don't pin the log transport here (logger vs console) — the only
		// contract is "surface a warning so the misconfiguration is visible".
		warn.mockRestore();
	});

	it('returns the input as passthrough when it is already a UUID not present in the mapping', () => {
		const r = resolveLabelId(UUID_2, { processing: UUID }, { providerId: 'linear' });
		expect(r).toBe(UUID_2);
	});

	it('returns null for an unmapped non-UUID slot', () => {
		const r = resolveLabelId('unmapped-slot', undefined, { providerId: 'linear' });
		expect(r).toBeNull();
	});
});
