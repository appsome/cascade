import { z } from 'zod';
import { fetchClaudeSubscriptionLimits } from '../../anthropic/client.js';
import {
	getProjectOwnCredential,
	listAllClaudeCodeCredentials,
} from '../../db/repositories/credentialsRepository.js';
import { resolveOrgCredential } from '../../db/repositories/orgCredentialsRepository.js';
import { logger } from '../../utils/logging.js';
import { adminProcedure, protectedProcedure, router } from '../trpc.js';
import { assertOrgAdmin, resolveActorRole } from './_shared/orgRole.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

const CLAUDE_CODE_TOKEN_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';

// The server env token (process.env.CLAUDE_CODE_OAUTH_TOKEN) is deliberately
// NOT surfaced here: (a) this tRPC handler runs in the dashboard service while
// workers receive the ROUTER service's env — the dashboard's view of it can be
// wrong in both directions; (b) it is a host-level operator secret, and its
// usage/billing data must not be exposed to tenant org members. Operators who
// want its usage visible should store the token as an org credential instead —
// which is exactly what this feature is for.

export type ClaudeCodeLimitsScope = 'org' | 'project';

export interface LimitsSource {
	scope: ClaudeCodeLimitsScope;
	projectId?: string;
	projectName?: string;
	token: string;
}

/** Resolve the org token, treating decrypt failures as absent (never 500). */
async function safeResolveOrgToken(orgId: string): Promise<string | null> {
	try {
		return await resolveOrgCredential(orgId, CLAUDE_CODE_TOKEN_KEY);
	} catch (err) {
		logger.warn('Failed to resolve org CLAUDE_CODE_OAUTH_TOKEN', {
			orgId,
			error: String(err),
		});
		return null;
	}
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
	 * effective org: the org-level shared token and each project-level
	 * override. Org-admin gated — same audience as the organization
	 * credentials settings page.
	 */
	forOrg: adminProcedure.query(async ({ ctx }) => {
		assertOrgAdmin(await resolveActorRole(ctx));

		const sources: LimitsSource[] = [];

		const orgToken = await safeResolveOrgToken(ctx.effectiveOrgId);
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

		return fetchLimitsForSources(sources);
	}),

	/**
	 * Claude Code subscription usage for the credential candidates visible to
	 * one project: its own override (if set) and the inherited org token (if
	 * set). `active` marks the credential-system winner (project override
	 * beats org). Used by the project settings engine tab as a picker preview.
	 */
	forProject: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			// Project tier only, deliberately NOT the inheriting resolver: the
			// point is contrasting the override with the org value.
			const projectToken = await getProjectOwnCredential(input.projectId, CLAUDE_CODE_TOKEN_KEY);
			const orgToken = await safeResolveOrgToken(ctx.effectiveOrgId);

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

			return fetchLimitsForSources(sources);
		}),
});
