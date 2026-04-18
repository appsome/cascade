/**
 * TrelloPMProvider adapter accepts branded IDs at class-level method
 * signatures (plan 009/2 task 3).
 *
 * The PMProvider interface still types parameters as `string` — TypeScript
 * method bivariance lets the adapter declare tighter branded types
 * without breaking the `implements PMProvider` clause. Direct callers
 * that type their reference as `TrelloPMProvider` (e.g. these tests)
 * get compile-time enforcement; callers going through `PMProvider` keep
 * the legacy string contract.
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(async (_creds, fn) => fn()),
	trelloClient: {
		getCard: vi.fn(async () => ({
			id: 'card-1',
			name: 'Test',
			desc: '',
			url: 'https://trello.com/c/1',
			idList: 'list-1',
			labels: [],
		})),
		createCard: vi.fn(async (opts: { name: string; idList: string }) => ({
			id: 'card-new',
			name: opts.name,
			desc: '',
			url: 'https://trello.com/c/new',
			idList: opts.idList,
			labels: [],
		})),
		moveCard: vi.fn(),
		moveCardToList: vi.fn(),
		addLabelToCard: vi.fn(),
		updateCard: vi.fn(),
		getCardsInList: vi.fn(async () => []),
		getListCards: vi.fn(async () => []),
	},
}));

import type { ContainerId, LabelId } from '../../../../src/pm/ids.js';
import { parseContainerId, parseLabelId } from '../../../../src/pm/ids.js';
import { TrelloPMProvider } from '../../../../src/pm/trello/adapter.js';

const config = {
	boardId: 'board-1',
	lists: { backlog: 'list-backlog', todo: 'list-todo', done: 'list-done' },
	labels: { bug: 'label-bug', feature: 'label-feature' },
};

describe('TrelloPMProvider — branded ID narrowing', () => {
	it('moveWorkItem accepts a branded ContainerId', async () => {
		const adapter = new TrelloPMProvider(config);
		const id = parseContainerId('list-done');
		await expect(adapter.moveWorkItem('card-1', id)).resolves.toBeUndefined();
	});

	it('createWorkItem (CreateWorkItemConfig.containerId stays string for interface compat)', async () => {
		const adapter = new TrelloPMProvider(config);
		// TypeScript enforces object-property invariance even when method
		// params are bivariant, so createWorkItem keeps the interface's
		// string type for config.containerId. Narrowing happens inside the
		// adapter via parseContainerId at the boundary — see adapter doc.
		const item = await adapter.createWorkItem({
			containerId: 'list-backlog',
			title: 'New card',
		});
		expect(item.id).toBe('card-new');
	});

	it('listWorkItems accepts a branded ContainerId', async () => {
		const adapter = new TrelloPMProvider(config);
		const id = parseContainerId('list-backlog');
		const items = await adapter.listWorkItems(id);
		expect(Array.isArray(items)).toBe(true);
	});

	it('type-level: method params that CAN narrow DO narrow', () => {
		const adapter = new TrelloPMProvider(config);

		// moveWorkItem's destination narrows to ContainerId (method param
		// bivariance allows scalar narrowing below the interface type).
		type MoveParams = Parameters<typeof adapter.moveWorkItem>;
		expectTypeOf<MoveParams[1]>().toEqualTypeOf<ContainerId>();

		// addLabel / removeLabel narrow their label param to LabelId.
		type AddLabelParams = Parameters<typeof adapter.addLabel>;
		expectTypeOf<AddLabelParams[1]>().toEqualTypeOf<LabelId>();

		// listWorkItems narrows containerId to ContainerId | undefined.
		type ListParams = Parameters<typeof adapter.listWorkItems>;
		expectTypeOf<ListParams[0]>().toEqualTypeOf<ContainerId | undefined>();

		// createWorkItem stays on CreateWorkItemConfig (containerId: string)
		// because TypeScript enforces invariance on object-property types
		// even when method parameters are bivariant.
		type CreateParams = Parameters<typeof adapter.createWorkItem>;
		expectTypeOf<CreateParams[0]['containerId']>().toEqualTypeOf<string>();
	});
});

// Sanity: show that the parsers produce the correct branded types.
describe('parseContainerId / parseLabelId branded output', () => {
	it('parseContainerId returns a ContainerId', () => {
		const id = parseContainerId('list-1');
		expectTypeOf(id).toEqualTypeOf<ContainerId>();
	});

	it('parseLabelId returns a LabelId', () => {
		const id = parseLabelId('label-1');
		expectTypeOf(id).toEqualTypeOf<LabelId>();
	});
});
