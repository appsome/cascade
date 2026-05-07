import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('no-synthetic-sentry-id (static)', () => {
	it('src/triggers/sentry/ contains no template or literal starting with sentry:issue:', () => {
		const alertingFile = resolve(
			import.meta.dirname,
			'../../../src/triggers/sentry/alerting-issue.ts',
		);
		const content = readFileSync(alertingFile, 'utf8');
		expect(content).not.toMatch(/sentry:issue:/);
	});
});
