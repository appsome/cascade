/**
 * Auth-header provenance assertion.
 *
 * Every Linear / JIRA / GitHub auth header must be assembled through a
 * single shared helper (`src/integrations/pm/_shared/auth-headers.ts`).
 * Three divergent copies of the Linear auth-header builder caused the
 * `Bearer ` prefix bug to ship twice (#1112 and #1119). This test
 * grep-asserts the invariant by scanning the src tree for suspicious
 * string patterns outside the shared helper.
 *
 * Plan 009/1 task 8 ships this test; task 9 adds a Biome lint rule
 * covering the same invariant so failures surface at `npm run lint` time
 * instead of just test time.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_ROOT = join(PROJECT_ROOT, 'src');
const SHARED_AUTH_HEADERS = join('src', 'integrations', 'pm', '_shared', 'auth-headers.ts');

/**
 * Files outside the shared helper where auth-header-like string assembly
 * is allowed. Must be SMALL and every entry must have a one-line justification.
 *
 * Spec 009 is PM-only in scope. Non-PM integrations (GitHub SCM, Sentry
 * alerting) and non-integration concerns (LLM API clients) keep their
 * direct Bearer assembly until a future spec extends the manifest pattern
 * to cover them. Each entry below must be either:
 *   (a) out of spec 009's PM scope, or
 *   (b) the shared helper itself (handled by the path-skip above).
 */
const ACCEPT_LIST: Array<{ path: string; reason: string }> = [
	{
		path: 'src/api/routers/integrationsDiscovery.ts',
		reason: 'Sentry verifyCredentials call — alerting integrations are out of spec 009 scope.',
	},
	{
		path: 'src/openrouter/client.ts',
		reason: 'OpenRouter LLM client — not a PM/SCM/alerting integration; outside spec 009 scope.',
	},
	{
		path: 'src/router/platformClients/credentials.ts',
		reason: 'resolveGitHubHeaders — SCM (GitHub) integration is out of spec 009 scope.',
	},
	{
		path: 'src/sentry/client.ts',
		reason: 'Sentry client auth — alerting integration is out of spec 009 scope.',
	},
];

// Patterns that suggest manual auth-header assembly:
//   - A template literal or string concatenation building `Bearer <token>`
//   - A header key `Authorization` being populated with a bearer-shaped value
// We intentionally accept mentions of the literal string 'Bearer' in
// comments/docs — the regex matches only assembly contexts.
const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
	{
		pattern: /['"`]Bearer\s+\$\{/,
		name: 'Bearer template literal',
	},
	{
		pattern: /['"`]Bearer\s*['"`]\s*\+/,
		name: 'Bearer string concatenation',
	},
];

function walkSrc(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (entry === 'node_modules' || entry === 'dist') continue;
			walkSrc(full, out);
		} else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
			out.push(full);
		}
	}
	return out;
}

interface Offender {
	file: string;
	matched: string;
	pattern: string;
}

function isSkipped(relativeToRoot: string): boolean {
	const sharedNorm = SHARED_AUTH_HEADERS.split(sep).join('/');
	if (relativeToRoot === sharedNorm) return true;
	return ACCEPT_LIST.some((e) => e.path === relativeToRoot);
}

function findOffendersInFile(absolutePath: string, relativeToRoot: string): Offender[] {
	const source = readFileSync(absolutePath, 'utf8');
	const hits: Offender[] = [];
	for (const { pattern, name } of SUSPICIOUS_PATTERNS) {
		const match = source.match(pattern);
		if (match) {
			hits.push({ file: relativeToRoot, matched: match[0], pattern: name });
		}
	}
	return hits;
}

function findOffenders(): Offender[] {
	const files = walkSrc(SRC_ROOT);
	const offenders: Offender[] = [];
	for (const file of files) {
		const relativeToRoot = relative(PROJECT_ROOT, file).split(sep).join('/');
		if (isSkipped(relativeToRoot)) continue;
		offenders.push(...findOffendersInFile(file, relativeToRoot));
	}
	return offenders;
}

describe('auth-header provenance', () => {
	it('no file outside _shared/auth-headers.ts assembles Bearer auth headers', () => {
		const offenders = findOffenders();
		if (offenders.length > 0) {
			const detail = offenders
				.map((o) => `  - ${o.file}: matched ${o.pattern} (${o.matched})`)
				.join('\n');
			throw new Error(
				`Auth-header provenance violated. ` +
					`Every Linear / JIRA / GitHub auth header must be assembled via ` +
					`src/integrations/pm/_shared/auth-headers.ts. Offenders:\n${detail}\n` +
					`Either move the assembly into the shared helper, or (with strong reason) ` +
					`add an entry to ACCEPT_LIST in this test file.`,
			);
		}
		expect(offenders).toEqual([]);
	});
});
