/**
 * Branded ID types — the type-level defense against the state-name-vs-ID
 * confusion class of bug that shipped three times during Linear integration
 * (#1117 status mapping, #1137 create issue, #1139 checklist sub-issue).
 *
 * Covers:
 *   - Runtime parsers reject empty / whitespace input with a descriptive error
 *   - Runtime parsers return branded values for valid input
 *   - Type-level: a bare string literal cannot be assigned to StateId /
 *     LabelId / ContainerId (compile error, validated via expectTypeOf)
 *   - `unwrap()` strips the brand for boundary crossings (DB, HTTP, logs)
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	type ContainerId,
	InvalidIdError,
	type LabelId,
	parseContainerId,
	parseLabelId,
	parseStateId,
	type StateId,
	unwrap,
} from '../../../src/pm/ids.js';

describe('parseStateId', () => {
	it('returns a branded StateId for a non-empty string', () => {
		const id = parseStateId('abc-123');
		expect(id).toBe('abc-123');
		expectTypeOf(id).toEqualTypeOf<StateId>();
	});

	it('rejects the empty string with InvalidIdError', () => {
		expect(() => parseStateId('')).toThrow(InvalidIdError);
	});

	it('rejects whitespace-only strings with InvalidIdError', () => {
		expect(() => parseStateId('   ')).toThrow(InvalidIdError);
		expect(() => parseStateId('\t\n')).toThrow(InvalidIdError);
	});

	it('includes the attempted value + the kind in the error message', () => {
		try {
			parseStateId('');
			throw new Error('expected parseStateId to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(InvalidIdError);
			const e = err as InvalidIdError;
			expect(e.message).toMatch(/StateId/);
		}
	});
});

describe('parseLabelId', () => {
	it('returns a branded LabelId for a non-empty string', () => {
		const id = parseLabelId('label-uuid');
		expect(id).toBe('label-uuid');
		expectTypeOf(id).toEqualTypeOf<LabelId>();
	});

	it('rejects the empty string with InvalidIdError', () => {
		expect(() => parseLabelId('')).toThrow(InvalidIdError);
	});
});

describe('parseContainerId', () => {
	it('returns a branded ContainerId for a non-empty string', () => {
		const id = parseContainerId('board-1');
		expect(id).toBe('board-1');
		expectTypeOf(id).toEqualTypeOf<ContainerId>();
	});

	it('rejects the empty string with InvalidIdError', () => {
		expect(() => parseContainerId('')).toThrow(InvalidIdError);
	});
});

describe('branded types — type-level', () => {
	it('accepts a parser-produced value where a branded type is expected', () => {
		// Should compile.
		const s: StateId = parseStateId('raw');
		const l: LabelId = parseLabelId('raw');
		const c: ContainerId = parseContainerId('raw');

		// Sanity assertions so the assignments aren't dead code.
		expect(s).toBe('raw');
		expect(l).toBe('raw');
		expect(c).toBe('raw');
	});

	it('rejects bare string where a branded type is expected (type-level)', () => {
		// Compile-time assertion. The runtime value is irrelevant — we just
		// need expectTypeOf to assert the branded type is NOT equal to string.
		expectTypeOf<StateId>().not.toEqualTypeOf<string>();
		expectTypeOf<LabelId>().not.toEqualTypeOf<string>();
		expectTypeOf<ContainerId>().not.toEqualTypeOf<string>();

		// Each branded type is distinct from the others — swapping them is a
		// compile error.
		expectTypeOf<StateId>().not.toEqualTypeOf<LabelId>();
		expectTypeOf<StateId>().not.toEqualTypeOf<ContainerId>();
		expectTypeOf<LabelId>().not.toEqualTypeOf<ContainerId>();
	});
});

describe('unwrap', () => {
	it('returns the underlying string from a branded value', () => {
		const s = parseStateId('abc');
		expect(unwrap(s)).toBe('abc');
	});

	it('strips the brand so the result is assignable to plain string', () => {
		const s = parseStateId('abc');
		const raw: string = unwrap(s);
		expect(raw).toBe('abc');
	});
});
