import { describe, expect, it } from 'vitest';
import {
	extractModelFamily,
	gatingBuckets,
	isBucketRelevantToModel,
} from '../../../src/anthropic/bucket-matching.js';
import type { UsageBucket } from '../../../src/anthropic/client.js';

function bucket(key: string, utilization = 50): UsageBucket {
	return { key, label: key, utilization, resetsAt: '2026-08-03T00:00:00Z' };
}

describe('extractModelFamily', () => {
	it('extracts every known family from real model ids', () => {
		expect(extractModelFamily('claude-fable-5')).toBe('fable');
		expect(extractModelFamily('claude-opus-4-8')).toBe('opus');
		expect(extractModelFamily('claude-opus-4-8[1m]')).toBe('opus');
		expect(extractModelFamily('claude-sonnet-4-5-20250929')).toBe('sonnet');
		expect(extractModelFamily('claude-sonnet-4-6[1m]')).toBe('sonnet');
		expect(extractModelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
	});

	it('handles provider-prefixed ids and case', () => {
		expect(extractModelFamily('anthropic:claude-opus-4-8')).toBe('opus');
		expect(extractModelFamily('Claude-Sonnet-4-6')).toBe('sonnet');
	});

	it('returns null for unrecognized ids', () => {
		expect(extractModelFamily('gpt-5.4')).toBeNull();
		expect(extractModelFamily('openrouter:google/gemini-3-flash-preview')).toBeNull();
		expect(extractModelFamily('')).toBeNull();
	});
});

describe('isBucketRelevantToModel', () => {
	it('global buckets gate every family — exact match only', () => {
		for (const family of ['opus', 'sonnet', 'haiku', 'fable'] as const) {
			expect(isBucketRelevantToModel('five_hour', family)).toBe(true);
			expect(isBucketRelevantToModel('seven_day', family)).toBe(true);
		}
		expect(isBucketRelevantToModel('five_hour', null)).toBe(true);
		expect(isBucketRelevantToModel('seven_day', null)).toBe(true);
	});

	it('model-class buckets gate only their family', () => {
		expect(isBucketRelevantToModel('seven_day_opus', 'opus')).toBe(true);
		expect(isBucketRelevantToModel('seven_day_opus', 'sonnet')).toBe(false);
		expect(isBucketRelevantToModel('seven_day_sonnet', 'sonnet')).toBe(true);
		expect(isBucketRelevantToModel('seven_day_sonnet', 'opus')).toBe(false);
	});

	it('an unknown future family bucket gates its family with zero code change', () => {
		expect(isBucketRelevantToModel('seven_day_fable', 'fable')).toBe(true);
		expect(isBucketRelevantToModel('seven_day_fable', 'sonnet')).toBe(false);
		expect(isBucketRelevantToModel('five_hour_fable', 'fable')).toBe(true);
	});

	it('seven_day_opus does NOT match via a seven_day prefix', () => {
		// The exactness of the global-bucket check is load-bearing: a prefix
		// check would make every family bucket gate every model.
		expect(isBucketRelevantToModel('seven_day_opus', 'fable')).toBe(false);
	});

	it('non-family buckets never gate', () => {
		for (const family of ['opus', 'sonnet', 'haiku', 'fable', null] as const) {
			expect(isBucketRelevantToModel('seven_day_oauth_apps', family)).toBe(false);
			expect(isBucketRelevantToModel('seven_day_cowork', family)).toBe(false);
			expect(isBucketRelevantToModel('iguana_necktie', family)).toBe(false);
			expect(isBucketRelevantToModel('mystery_window', family)).toBe(false);
		}
	});

	it('unrecognized model family gates on global buckets only', () => {
		expect(isBucketRelevantToModel('seven_day_opus', null)).toBe(false);
		expect(isBucketRelevantToModel('seven_day_sonnet', null)).toBe(false);
	});
});

describe('gatingBuckets', () => {
	const all = [
		bucket('five_hour', 10),
		bucket('seven_day', 20),
		bucket('seven_day_opus', 96),
		bucket('seven_day_sonnet', 40),
		bucket('seven_day_oauth_apps', 99),
		bucket('iguana_necktie', 99),
	];

	it('selects globals + matching family for a fable run (no fable bucket present)', () => {
		expect(gatingBuckets(all, 'claude-fable-5').map((b) => b.key)).toEqual([
			'five_hour',
			'seven_day',
		]);
	});

	it('selects globals + opus bucket for an opus run', () => {
		expect(gatingBuckets(all, 'claude-opus-4-8[1m]').map((b) => b.key)).toEqual([
			'five_hour',
			'seven_day',
			'seven_day_opus',
		]);
	});

	it('includes a future fable bucket for fable runs', () => {
		const withFable = [...all, bucket('seven_day_fable', 97)];
		expect(gatingBuckets(withFable, 'claude-fable-5').map((b) => b.key)).toEqual([
			'five_hour',
			'seven_day',
			'seven_day_fable',
		]);
	});
});
