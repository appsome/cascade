/**
 * Tests for the consolidated PM-ack dispatch helper at
 * `src/router/pm-ack-dispatch.ts`. Replaces the parallel-path drift between
 * `src/router/adapters/github.ts:postPMAck` (which lacked the Linear branch
 * and silently skipped Linear-based projects) and
 * `src/triggers/shared/pm-ack.ts:postPMAckComment`. The new helper indexes
 * the manifest registry directly — no per-PM-type literal branching — so
 * adding a future provider to the registry is automatically reachable from
 * the dispatch path.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetPMProvider, mockCaptureException } = vi.hoisted(() => ({
	mockGetPMProvider: vi.fn(),
	mockCaptureException: vi.fn(),
}));

vi.mock('../../../src/integrations/pm/registry.js', () => ({
	getPMProvider: mockGetPMProvider,
	listPMProviders: () => [],
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: mockCaptureException,
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { dispatchPMAck } from '../../../src/router/pm-ack-dispatch.js';
import { logger } from '../../../src/utils/logging.js';

const mockLoggerError = vi.mocked(logger.error);
const mockLoggerWarn = vi.mocked(logger.warn);

function makeManifest(id: string, postCommentImpl: () => Promise<string | number | null>) {
	return {
		id,
		platformClientFactory: vi.fn(() => ({
			postComment: vi.fn(postCommentImpl),
			deleteComment: vi.fn(),
		})),
	};
}

describe('dispatchPMAck', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('Trello: invokes platformClientFactory(projectId).postComment(workItemId, message) and returns AckResult', async () => {
		const manifest = makeManifest('trello', async () => 'comment-trello-123');
		mockGetPMProvider.mockReturnValue(manifest);

		const result = await dispatchPMAck({
			projectId: 'proj-1',
			workItemId: 'card-abc',
			pmType: 'trello',
			message: 'Working on it',
			agentType: 'backlog-manager',
		});

		expect(mockGetPMProvider).toHaveBeenCalledWith('trello');
		expect(manifest.platformClientFactory).toHaveBeenCalledWith('proj-1');
		expect(result).toEqual({ commentId: 'comment-trello-123', message: 'Working on it' });
	});

	it('JIRA: same shape, returns the id from platformClientFactory', async () => {
		const manifest = makeManifest('jira', async () => 'jira-789');
		mockGetPMProvider.mockReturnValue(manifest);

		const result = await dispatchPMAck({
			projectId: 'proj-2',
			workItemId: 'PROJ-1',
			pmType: 'jira',
			message: 'Working on it',
		});

		expect(result).toEqual({ commentId: 'jira-789', message: 'Working on it' });
	});

	it('Linear: same shape (the failure mode A regression pin)', async () => {
		// This is the assertion that today's broken `postPMAck` in github.ts
		// fails for Linear-based projects. After consolidation, Linear is
		// reachable through the same dispatch path as Trello/JIRA.
		const manifest = makeManifest('linear', async () => 'linear-id-uuid');
		mockGetPMProvider.mockReturnValue(manifest);

		const result = await dispatchPMAck({
			projectId: 'ucho',
			workItemId: 'MNG-100',
			pmType: 'linear',
			message: 'On it',
			agentType: 'backlog-manager',
		});

		expect(result).toEqual({ commentId: 'linear-id-uuid', message: 'On it' });
	});

	it('returns undefined when platformClientFactory.postComment returns null', async () => {
		const manifest = makeManifest('trello', async () => null);
		mockGetPMProvider.mockReturnValue(manifest);

		const result = await dispatchPMAck({
			projectId: 'proj-1',
			workItemId: 'card-abc',
			pmType: 'trello',
			message: 'msg',
		});

		expect(result).toBeUndefined();
	});

	it('unknown pmType (not in registry): logs at ERROR, captures Sentry under tag pm_ack_unknown_pm_type, returns undefined', async () => {
		mockGetPMProvider.mockReturnValue(null); // not registered

		const result = await dispatchPMAck({
			projectId: 'proj-x',
			workItemId: 'item',
			pmType: 'asana',
			message: 'msg',
			agentType: 'backlog-manager',
		});

		expect(result).toBeUndefined();
		expect(mockLoggerError).toHaveBeenCalledWith(
			expect.stringMatching(/Unknown PM type for PM-focused agent ack/i),
			expect.objectContaining({ pmType: 'asana', agentType: 'backlog-manager' }),
		);
		expect(mockLoggerWarn).not.toHaveBeenCalled();
		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				tags: expect.objectContaining({ source: 'pm_ack_unknown_pm_type' }),
				extra: expect.objectContaining({ pmType: 'asana', agentType: 'backlog-manager' }),
			}),
		);
	});

	it('undefined pmType (project not configured): same Sentry-captured error path', async () => {
		mockGetPMProvider.mockReturnValue(null);

		const result = await dispatchPMAck({
			projectId: 'proj-x',
			workItemId: 'item',
			pmType: undefined,
			message: 'msg',
		});

		expect(result).toBeUndefined();
		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				tags: expect.objectContaining({ source: 'pm_ack_unknown_pm_type' }),
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// Static guard: no PM-type literal branching on the consolidated dispatch path.
//
// The structural invariant of plan 017/1: dispatch consumes the manifest
// registry directly. A future maintainer who adds `if (pmType === 'asana')`
// branch should fail this guard. Modeled on the trigger-event-consistency.ts
// pattern.
// ---------------------------------------------------------------------------

describe('PM-ack dispatch surface: no literal pm-type branching (regression guard)', () => {
	const root = join(__dirname, '..', '..', '..', 'src');

	const surfaces = [
		{ file: 'router/pm-ack-dispatch.ts', label: 'dispatchPMAck helper' },
		{ file: 'router/adapters/github.ts', label: 'GitHub router adapter postPMAck' },
		{ file: 'triggers/shared/pm-ack.ts', label: 'shared postPMAckComment' },
	];

	for (const { file, label } of surfaces) {
		it(`${file} does not branch on pmType literal strings (${label})`, () => {
			const path = join(root, file);
			const src = readFileSync(path, 'utf-8');

			// Match patterns like `pmType === 'trello'` / `pmType === "jira"` /
			// case-style comparisons. Whitelist comments so doc references can
			// still mention PM type names.
			const codeOnly = src
				.split('\n')
				.filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
				.join('\n');

			const violations: string[] = [];
			for (const pmType of ['trello', 'jira', 'linear']) {
				const re = new RegExp(`pmType\\s*===?\\s*['"\`]${pmType}['"\`]`, 'g');
				const matches = codeOnly.match(re);
				if (matches) violations.push(`pmType === '${pmType}' (${matches.length} occurrence(s))`);
			}

			expect(
				violations,
				`${file} contains pmType literal branching: ${violations.join(', ')}. ` +
					`The consolidated dispatch path must index the manifest registry, not branch on literal pm-type strings.`,
			).toEqual([]);
		});
	}
});
