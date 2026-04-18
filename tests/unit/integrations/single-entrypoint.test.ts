/**
 * Single-entrypoint invariant — plan 009/5 task 3.
 *
 * Plan 009/1 introduced `src/integrations/entrypoint.ts` as the single
 * canonical place to register every PM / SCM / alerting integration.
 * Runtime surfaces (router / worker / CLI / dashboard) import THAT file.
 * This test enforces the stronger plan-5 invariant: NO file outside
 * entrypoint.ts + the PM barrel itself side-effect-imports a provider's
 * `index.js` directly. Tests may (and do) for isolation reasons — those
 * are excluded from this grep.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_ROOT = join(PROJECT_ROOT, 'src');

// Files allowed to side-effect-import a provider barrel. Everything else
// must go through src/integrations/entrypoint.ts.
const ALLOWED_DIRECT_IMPORTERS = new Set<string>([
	// The canonical entrypoint + the PM category barrel.
	'src/integrations/entrypoint.ts',
	'src/integrations/pm/index.ts',
]);

interface Offender {
	file: string;
	pattern: string;
}

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (entry === 'node_modules' || entry === 'dist') continue;
			walk(full, out);
		} else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
			out.push(full);
		}
	}
	return out;
}

describe('single-entrypoint invariant (plan 009/5 task 3)', () => {
	it('no src/ file outside entrypoint.ts / pm/index.ts imports pm/<provider>/index.js directly', () => {
		const files = walk(SRC_ROOT);
		const offenders: Offender[] = [];

		// Match `import '.../integrations/pm/<provider>/index[.js]'` where
		// <provider> is one of trello / jira / linear (the known real
		// providers; fake is tests-only).
		const pattern =
			/import\s+['"][^'"]*\/integrations\/pm\/(?:trello|jira|linear)\/index(\.js)?['"]/;

		for (const file of files) {
			const relativeToRoot = relative(PROJECT_ROOT, file).split(sep).join('/');
			if (ALLOWED_DIRECT_IMPORTERS.has(relativeToRoot)) continue;
			const source = readFileSync(file, 'utf8');
			if (pattern.test(source)) {
				offenders.push({ file: relativeToRoot, pattern: 'pm/<provider>/index' });
			}
		}

		if (offenders.length > 0) {
			const detail = offenders.map((o) => `  - ${o.file}`).join('\n');
			throw new Error(
				`Single-entrypoint invariant violated. Files other than src/integrations/entrypoint.ts ` +
					`and src/integrations/pm/index.ts must not side-effect-import provider barrels. ` +
					`Offenders:\n${detail}\n` +
					`Route registration through src/integrations/entrypoint.js instead — see plan 009/5.`,
			);
		}
		expect(offenders).toEqual([]);
	});

	it('no src/ file outside entrypoint.ts imports src/integrations/pm/index.js directly', () => {
		const files = walk(SRC_ROOT);
		const offenders: Offender[] = [];
		// The PM barrel itself is `pm/index.ts`. Allow imports FROM the
		// barrel (re-exports it into registry iteration) only from the
		// canonical entrypoint.
		const pattern = /import\s+['"][^'"]*\/integrations\/pm\/index(\.js)?['"]/;

		for (const file of files) {
			const relativeToRoot = relative(PROJECT_ROOT, file).split(sep).join('/');
			if (relativeToRoot === 'src/integrations/entrypoint.ts') continue;
			if (relativeToRoot === 'src/integrations/pm/index.ts') continue; // it's itself
			const source = readFileSync(file, 'utf8');
			if (pattern.test(source)) {
				offenders.push({ file: relativeToRoot, pattern: 'pm/index' });
			}
		}

		if (offenders.length > 0) {
			const detail = offenders.map((o) => `  - ${o.file}`).join('\n');
			throw new Error(
				`Single-entrypoint invariant violated. Only src/integrations/entrypoint.ts may ` +
					`import src/integrations/pm/index.js. Offenders:\n${detail}`,
			);
		}
		expect(offenders).toEqual([]);
	});
});
