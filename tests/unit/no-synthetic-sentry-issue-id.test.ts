/**
 * Repo-wide regression pin: no code path in src/ constructs the synthetic
 * sentry:issue: workItemId prefix that was removed in spec 019 plan 3.
 *
 * Plan 3 removed it from the trigger module; this test broadens the scope
 * to the entire src/ tree so any future regression is caught at CI time.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(import.meta.dirname, '../../src');

function collectTsFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const s = statSync(full);
		if (s.isDirectory()) {
			results.push(...collectTsFiles(full));
		} else if (s.isFile() && extname(entry) === '.ts' && !entry.endsWith('.test.ts')) {
			results.push(full);
		}
	}
	return results;
}

describe('no-synthetic-sentry-issue-id (repo-wide static)', () => {
	it('no .ts file under src/ contains the string literal sentry:issue:', () => {
		const files = collectTsFiles(SRC_ROOT);
		const offenders: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf8');
			if (content.includes('sentry:issue:')) {
				const lines = content.split('\n');
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].includes('sentry:issue:')) {
						offenders.push(`${file.replace(SRC_ROOT, 'src')}:${i + 1}`);
					}
				}
			}
		}
		expect(offenders, `Found 'sentry:issue:' in:\n${offenders.join('\n')}`).toHaveLength(0);
	});
});
