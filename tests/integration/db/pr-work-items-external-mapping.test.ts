import { beforeEach, describe, expect, it } from 'vitest';
import {
	attachWorkItemId,
	claimExternalMapping,
	findByExternal,
	replaceWorkItemId,
} from '../../../src/db/repositories/prWorkItemsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

describe('prWorkItemsRepository — external mapping methods (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	describe('findByExternal', () => {
		it('returns null when no row matches', async () => {
			const result = await findByExternal('test-project', 'sentry', 'S1');
			expect(result).toBeNull();
		});

		it('returns { id, workItemId } when an exact match exists', async () => {
			const { rowId } = await claimExternalMapping('test-project', 'sentry', 'S1');
			await attachWorkItemId(rowId, 'trello-card-1');

			const result = await findByExternal('test-project', 'sentry', 'S1');
			expect(result).not.toBeNull();
			expect(result?.workItemId).toBe('trello-card-1');
			expect(result?.id).toBe(rowId);
		});
	});

	describe('claimExternalMapping', () => {
		it('inserts a new row when none exists and returns ownedHere=true with rowId', async () => {
			const result = await claimExternalMapping('test-project', 'sentry', 'S1');
			expect(result.ownedHere).toBe(true);
			expect(typeof result.rowId).toBe('string');

			// Verify the row was actually inserted with work_item_id=NULL
			const found = await findByExternal('test-project', 'sentry', 'S1');
			expect(found).not.toBeNull();
			expect(found?.workItemId).toBeNull();
		});

		it('returns ownedHere=false with existing row when conflict occurs', async () => {
			// Seed a row first by claiming and attaching
			const first = await claimExternalMapping('test-project', 'sentry', 'S1');
			await attachWorkItemId(first.rowId, 'card-existing');

			// Second claim should detect the conflict
			const second = await claimExternalMapping('test-project', 'sentry', 'S1');
			expect(second.ownedHere).toBe(false);
			if (!second.ownedHere) {
				expect(second.existing.workItemId).toBe('card-existing');
				expect(second.existing.id).toBe(first.rowId);
			}
		});

		it('is race-free under simulated concurrency: exactly one claim wins', async () => {
			const results = await Promise.all([
				claimExternalMapping('test-project', 'sentry', 'RACE1'),
				claimExternalMapping('test-project', 'sentry', 'RACE1'),
				claimExternalMapping('test-project', 'sentry', 'RACE1'),
				claimExternalMapping('test-project', 'sentry', 'RACE1'),
				claimExternalMapping('test-project', 'sentry', 'RACE1'),
			]);

			const owners = results.filter((r) => r.ownedHere);
			const nonOwners = results.filter((r) => !r.ownedHere);

			expect(owners).toHaveLength(1);
			expect(nonOwners).toHaveLength(4);

			// All non-owners must point at the same winning row
			const winnerId = owners[0].rowId;
			for (const n of nonOwners) {
				if (!n.ownedHere) {
					expect(n.existing.id).toBe(winnerId);
				}
			}
		});
	});

	describe('attachWorkItemId', () => {
		it('writes work_item_id into the claimed row', async () => {
			const { rowId } = await claimExternalMapping('test-project', 'sentry', 'S2');
			await attachWorkItemId(rowId, 'card-new');

			const found = await findByExternal('test-project', 'sentry', 'S2');
			expect(found?.workItemId).toBe('card-new');
		});
	});

	describe('replaceWorkItemId', () => {
		it('updates work_item_id when old value matches and returns true', async () => {
			const { rowId } = await claimExternalMapping('test-project', 'sentry', 'S3');
			await attachWorkItemId(rowId, 'card-old');

			const updated = await replaceWorkItemId(rowId, 'card-old', 'card-new');
			expect(updated).toBe(true);

			const found = await findByExternal('test-project', 'sentry', 'S3');
			expect(found?.workItemId).toBe('card-new');
		});

		it('returns false and leaves row unchanged when old value is stale', async () => {
			const { rowId } = await claimExternalMapping('test-project', 'sentry', 'S4');
			await attachWorkItemId(rowId, 'card-current');

			const updated = await replaceWorkItemId(rowId, 'card-stale', 'card-new');
			expect(updated).toBe(false);

			const found = await findByExternal('test-project', 'sentry', 'S4');
			expect(found?.workItemId).toBe('card-current');
		});
	});
});
