import { z } from 'zod';
import { fetchClaudeSubscriptionLimits } from '../../anthropic/client.js';
import {
	listAllClaudeCodeCredentials,
	listProjectCredentials,
} from '../../db/repositories/credentialsRepository.js';
import { resolveOrgCredential } from '../../db/repositories/orgCredentialsRepository.js';
import { adminProcedure, protectedProcedure, router } from '../trpc.js';
import { assertOrgAdmin, resolveActorRole } from './_shared/orgRole.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

const CLAUDE_CODE_TOKEN_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';

export type ClaudeCodeLimitsScope = 'org' | 'project' | 'env';

export interface LimitsSource {
	scope: ClaudeCodeLimitsScope;
	projectId?: string;
	projectName?: string;
	token: string;
}

/**
 * Fetch usage limits for each source, preserving source attribution.
 * Sources whose token yields no limits data (API error, revoked token) come
 * back with `limits: null` so the UI can distinguish "no data" from "not
 * configured". The Anthropic client caches per token for 5 minutes, so
 * duplicate tokens across sources cost one HTTP call. Raw tokens never leave
 * the server — only the masked preview inside `limits`.
 */
async function fetchLimitsForSources<T extends LimitsSource>(sources: T[]) {
	return Promise.all(
		sources.map(async ({ token, ...source }) => ({
			...source,
			limits: await fetchClaudeSubscriptionLimits(token),
		})),
	);
}

export const claudeCodeLimitsRouter = router({
	/**
	 * Claude Code subscription usage for every credential source in the
	 * effective org: the org-level shared token, each project-level override,
	 * and the server's global env token. Org-admin gated — same audience as
	 * the organization credentials settings page.
	 */
	forOrg: adminProcedure.query(async ({ ctx }) => {
		assertOrgAdmin(await resolveActorRole(ctx));

		const sources: LimitsSource[] = [];

		const orgToken = await resolveOrgCredential(ctx.effectiveOrgId, CLAUDE_CODE_TOKEN_KEY);
		if (orgToken) sources.push({ scope: 'org', token: orgToken });

		const projectCredentials = await listAllClaudeCodeCredentials(ctx.effectiveOrgId);
		for (const cred of projectCredentials) {
			sources.push({
				scope: 'project',
				projectId: cred.projectId,
				projectName: cred.projectName,
				token: cred.value,
			});
		}

		const envToken = process.env[CLAUDE_CODE_TOKEN_KEY];
		if (envToken) sources.push({ scope: 'env', token: envToken });

		return fetchLimitsForSources(sources);
	}),

	/**
	 * Claude Code subscription usage for the credential candidates visible to
	 * one project: its own override (if set), the inherited org token (if set),
	 * and the server's global env token. `active` marks the credential-system
	 * winner (project override beats org; env is informational). Used by the
	 * project settings engine tab as a picker preview.
	 */
	forProject: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			// Project override — project rows only, deliberately NOT the inheriting
			// resolver: the point is contrasting the override with the org value.
			const projectRows = await listProjectCredentials(input.projectId);
			const projectToken = projectRows.find((r) => r.envVarKey === CLAUDE_CODE_TOKEN_KEY)?.value;

			const orgToken = await resolveOrgCredential(ctx.effectiveOrgId, CLAUDE_CODE_TOKEN_KEY);
			const envToken = process.env[CLAUDE_CODE_TOKEN_KEY];

			const sources: (LimitsSource & { active: boolean })[] = [];
			if (projectToken) {
				sources.push({
					scope: 'project',
					projectId: input.projectId,
					token: projectToken,
					active: true,
				});
			}
			if (orgToken) {
				sources.push({ scope: 'org', token: orgToken, active: !projectToken });
			}
			if (envToken) {
				sources.push({ scope: 'env', token: envToken, active: false });
			}

			return fetchLimitsForSources(sources);
		}),
});
