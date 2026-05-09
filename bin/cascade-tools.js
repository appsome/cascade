#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, run } from '@oclif/core';

// Bootstrap all integrations before oclif loads any command. The CLI
// runs commands lazily, and Spec 006/5 removed the legacy self-bootstrap
// path, so side-effect imports have to fire at the entry point.
// Without this, `cascade-tools pm <cmd>` throws `Unknown PM integration type`.
await import('../dist/cli/bootstrap.js');

// cascade-tools uses its own oclif config independent of package.json,
// which now points to the dashboard CLI (cascade binary).
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pjson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

pjson.oclif = {
	bin: 'cascade-tools',
	commands: {
		strategy: 'pattern',
		target: './dist/cli',
		globPatterns: ['**/*.js', '!**/dashboard/**', '!**/_shared/**', '!base.js', '!bootstrap.js'],
	},
	topicSeparator: ' ',
	// Explicit topic summaries. Without this block oclif borrows each topic's
	// description from its FIRST command (see node_modules/@oclif/core
	// /lib/config/config.js — the line `this._topics.set(name, { description:
	// c.summary || c.description, name })`). That made bare `cascade-tools
	// --help` show "pm  Add a checklist with items to a work item..." — a
	// specific gadget's description leaking into the topic line. Agents reading
	// bare --help to map the surface got a misleading frame (saw in 2026-05-09
	// prod corpus). One truthful sentence per topic.
	topics: {
		pm: {
			description:
				'Read and write PM work items, comments, and checklists across Trello/JIRA/Linear.',
		},
		scm: {
			description: 'Interact with GitHub PRs: create, review, comment, fetch diffs and CI logs.',
		},
		alerting: { description: 'Inspect Sentry alerting issues and events.' },
		session: { description: 'End the agent session. Exclusive terminal call.' },
		github: {
			description: 'Direct GitHub provider commands. Prefer the provider-agnostic `scm` topic.',
		},
		trello: {
			description: 'Direct Trello provider commands. Prefer the provider-agnostic `pm` topic.',
		},
	},
};

const config = await Config.load({ root, pjson });
try {
	await run(process.argv.slice(2), config);
} catch (err) {
	// oclif's `this.exit(code)` throws an ExitError. We've already emitted the
	// cascade-tools error envelope (stdout JSON + stderr prose) at that point;
	// propagating the ExitError to Node's default handler would spew a stack
	// trace that obscures our readable prose. Swallow ExitError quietly and
	// let the exit code stand. Anything else still propagates.
	const code =
		typeof err?.oclif?.exit === 'number' ? err.oclif.exit : err?.code === 'EEXIT' ? 1 : undefined;
	if (code !== undefined) {
		process.exit(code);
	}
	throw err;
}
