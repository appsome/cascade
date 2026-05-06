import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import { prWorkItems } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

describe('pr_work_items external source columns (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	it('external_source and external_id columns exist and accept NULL', async () => {
		const db = getDb();
		const [row] = await db
			.insert(prWorkItems)
			.values({
				projectId: 'test-project',
				repoFullName: 'owner/repo',
				workItemId: 'card-1',
				// external_source and external_id intentionally omitted → NULL
			})
			.returning();

		expect(row.externalSource).toBeNull();
		expect(row.externalId).toBeNull();
	});

	it('partial UNIQUE index blocks duplicate (project_id, external_source, external_id)', async () => {
		const db = getDb();
		await db.insert(prWorkItems).values({
			projectId: 'test-project',
			externalSource: 'sentry',
			externalId: 'S1',
		});

		await expect(
			db.insert(prWorkItems).values({
				projectId: 'test-project',
				externalSource: 'sentry',
				externalId: 'S1',
			}),
		).rejects.toMatchObject({ cause: { code: '23505' } });
	});

	it('partial UNIQUE index allows multiple rows where external_source IS NULL', async () => {
		const db = getDb();
		await db.insert(prWorkItems).values({ projectId: 'test-project' });
		await db.insert(prWorkItems).values({ projectId: 'test-project' });
		await db.insert(prWorkItems).values({ projectId: 'test-project' });

		const rows = await db
			.select()
			.from(prWorkItems)
			.then((all) =>
				all.filter((r) => r.projectId === 'test-project' && r.externalSource === null),
			);
		expect(rows.length).toBeGreaterThanOrEqual(3);
	});

	it('partial UNIQUE index allows the same external_id across different projects', async () => {
		await seedProject({ id: 'project-2', repo: 'owner/repo2' });
		const db = getDb();
		await db
			.insert(prWorkItems)
			.values({ projectId: 'test-project', externalSource: 'sentry', externalId: 'S1' });
		await expect(
			db
				.insert(prWorkItems)
				.values({ projectId: 'project-2', externalSource: 'sentry', externalId: 'S1' }),
		).resolves.not.toThrow();
	});

	it('partial UNIQUE index allows the same external_id across different sources within a project', async () => {
		const db = getDb();
		await db
			.insert(prWorkItems)
			.values({ projectId: 'test-project', externalSource: 'sentry', externalId: 'S1' });
		await expect(
			db
				.insert(prWorkItems)
				.values({ projectId: 'test-project', externalSource: 'pagerduty', externalId: 'S1' }),
		).resolves.not.toThrow();
	});
});
