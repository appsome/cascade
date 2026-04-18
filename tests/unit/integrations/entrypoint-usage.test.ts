/**
 * Entrypoint-usage invariant.
 *
 * Every process-entry file must import the single canonical registration
 * entrypoint (`src/integrations/entrypoint.ts`). Enforcing this at CI time
 * prevents the "forgot to register this provider here" class of bug that
 * shipped 4 times during Linear's rollout (#1097, #1118, #1131, #1134).
 *
 * Plan 5 of spec 009 escalates from "every process entry imports it" to
 * "no other file imports a provider barrel directly". This test covers the
 * former invariant.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * Process-entry files that instantiate a runtime surface (router, worker,
 * CLI bootstrap, dashboard). Each must side-effect-import the entrypoint
 * so every surface sees the same registered providers.
 */
const ENTRY_FILES = [
	'src/router/index.ts',
	'src/worker-entry.ts',
	'src/cli/bootstrap.ts',
	'src/dashboard.ts',
] as const;

/** Patterns that satisfy the invariant — any of these imports counts. */
const ENTRYPOINT_IMPORT_PATTERNS = [
	/import\s+['"]\.\.?(?:\/\.\.)*\/integrations\/entrypoint\.js['"]/,
	/import\s+.*from\s+['"]\.\.?(?:\/\.\.)*\/integrations\/entrypoint\.js['"]/,
];

describe('single-entrypoint invariant', () => {
	it.each(ENTRY_FILES)('%s imports src/integrations/entrypoint.ts', (relativePath) => {
		const absolutePath = resolve(PROJECT_ROOT, relativePath);
		const source = readFileSync(absolutePath, 'utf8');

		const matches = ENTRYPOINT_IMPORT_PATTERNS.some((pattern) => pattern.test(source));

		expect(
			matches,
			`Entry file ${relativePath} must import src/integrations/entrypoint.js. ` +
				`Missing this import was the root cause of Linear registration drift in ` +
				`#1097, #1118, #1131, #1134 — plan 009/1 task 5 guards the invariant.`,
		).toBe(true);
	});
});
