import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCoalesceWindowMs } from '../../../src/pm/coalesce-config.js';

describe('getCoalesceWindowMs', () => {
	const originalCoalesce = process.env.PM_COALESCE_WINDOW_MS;
	const originalLegacy = process.env.PM_CREATE_COALESCE_WINDOW_MS;

	beforeEach(() => {
		delete process.env.PM_COALESCE_WINDOW_MS;
		delete process.env.PM_CREATE_COALESCE_WINDOW_MS;
	});

	afterEach(() => {
		if (originalCoalesce === undefined) {
			delete process.env.PM_COALESCE_WINDOW_MS;
		} else {
			process.env.PM_COALESCE_WINDOW_MS = originalCoalesce;
		}
		if (originalLegacy === undefined) {
			delete process.env.PM_CREATE_COALESCE_WINDOW_MS;
		} else {
			process.env.PM_CREATE_COALESCE_WINDOW_MS = originalLegacy;
		}
	});

	it('returns the default 10_000 ms when neither env var is set', () => {
		expect(getCoalesceWindowMs()).toBe(10_000);
	});

	it('reads PM_COALESCE_WINDOW_MS when set', () => {
		process.env.PM_COALESCE_WINDOW_MS = '2500';
		expect(getCoalesceWindowMs()).toBe(2500);
	});

	it('falls back to legacy PM_CREATE_COALESCE_WINDOW_MS when PM_COALESCE_WINDOW_MS is unset', () => {
		process.env.PM_CREATE_COALESCE_WINDOW_MS = '7777';
		expect(getCoalesceWindowMs()).toBe(7777);
	});

	it('prefers PM_COALESCE_WINDOW_MS over the legacy fallback when both are set', () => {
		process.env.PM_COALESCE_WINDOW_MS = '1000';
		process.env.PM_CREATE_COALESCE_WINDOW_MS = '9999';
		expect(getCoalesceWindowMs()).toBe(1000);
	});

	it('treats 0 as a valid value to disable coalescing', () => {
		process.env.PM_COALESCE_WINDOW_MS = '0';
		expect(getCoalesceWindowMs()).toBe(0);
	});

	it('returns the default when value is non-numeric', () => {
		process.env.PM_COALESCE_WINDOW_MS = 'not-a-number';
		expect(getCoalesceWindowMs()).toBe(10_000);
	});

	it('returns the default when value is negative', () => {
		process.env.PM_COALESCE_WINDOW_MS = '-100';
		expect(getCoalesceWindowMs()).toBe(10_000);
	});

	it('returns the default when value is empty string', () => {
		process.env.PM_COALESCE_WINDOW_MS = '';
		expect(getCoalesceWindowMs()).toBe(10_000);
	});
});
