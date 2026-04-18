import { z } from 'zod';
import { EngineSettingsSchema } from './engineSettings.js';

export const PROJECT_DEFAULTS = {
	model: 'openrouter:google/gemini-3-flash-preview',
	maxIterations: 50,
	watchdogTimeoutMs: 30 * 60 * 1000, // 30 min
	progressModel: 'openrouter:google/gemini-2.5-flash-lite',
	progressIntervalMinutes: 5,
	workItemBudgetUsd: 5,
	agentEngine: 'claude-code',
} as const;

const AgentEngineConfigSchema = z.object({
	default: z.string().default(PROJECT_DEFAULTS.agentEngine),
	overrides: z.record(z.string()).default({}),
});

/**
 * @deprecated — use `jiraConfigSchema` from
 * `src/integrations/pm/jira/config-schema.ts` (declared on
 * `jiraManifest.configSchema` as of plan 009/3). This inline copy
 * stays for backward compat until plan 5 routes `configMapper`
 * through the manifest registry and deletes this duplicate.
 */
const JiraConfigSchema = z.object({
	projectKey: z.string().min(1),
	baseUrl: z.string().url(),
	statuses: z.record(z.string()), // CASCADE status names → JIRA status IDs/names
	issueTypes: z.record(z.string()).optional(),
	customFields: z
		.object({
			cost: z.string().optional(),
		})
		.optional(),
	labels: z
		.object({
			processing: z.string().default('cascade-processing'),
			processed: z.string().default('cascade-processed'),
			error: z.string().default('cascade-error'),
			readyToProcess: z.string().default('cascade-ready'),
		})
		.optional(),
});

/**
 * @deprecated — use `linearConfigSchema` from
 * `src/integrations/pm/linear/config-schema.ts` (declared on
 * `linearManifest.configSchema` as of plan 009/4). This inline copy
 * stays for backward compat until plan 5 routes `configMapper`
 * through the manifest registry and deletes this duplicate.
 *
 * Specifically: plan 009/4 locks down the #1138 + #1142 bug class
 * where projectId was stripped by Zod at two different layers.
 * linearConfigSchema explicitly declares projectId as optional and
 * the conformance harness asserts round-trip identity.
 */
const LinearConfigSchema = z.object({
	teamId: z.string().min(1),
	/** Optional Linear Project (initiative) ID — when set, narrows scope within the team. */
	projectId: z.string().optional(),
	statuses: z.record(z.string()), // CASCADE status names → Linear state IDs
	labels: z
		.object({
			processing: z.string().optional(),
			processed: z.string().optional(),
			error: z.string().optional(),
			readyToProcess: z.string().optional(),
			auto: z.string().optional(),
		})
		.optional(),
	customFields: z
		.object({
			cost: z.string().optional(),
		})
		.optional(),
});

export const ProjectConfigSchema = z.object({
	id: z.string().min(1),
	orgId: z.string().min(1),
	name: z.string().min(1),
	repo: z
		.string()
		.regex(/^[^/]+\/[^/]+$/, 'Must be in format "owner/repo"')
		.optional(),
	baseBranch: z.string().default('main'),
	branchPrefix: z.string().default('feature/'),

	pm: z
		.object({
			type: z.enum(['trello', 'jira', 'linear']).default('trello'),
		})
		.default({ type: 'trello' }),

	/**
	 * @deprecated — use `trelloConfigSchema` from
	 * `src/integrations/pm/trello/config-schema.ts` (declared on
	 * `trelloManifest.configSchema` as of plan 009/2). This inline copy
	 * stays for backward compat until plan 5 routes `configMapper`
	 * through the manifest registry and deletes this duplicate.
	 */
	trello: z
		.object({
			boardId: z.string().min(1),
			lists: z.record(z.string()),
			labels: z.record(z.string()),
			customFields: z
				.object({
					cost: z.string().optional(),
				})
				.optional(),
		})
		.optional(),

	jira: JiraConfigSchema.optional(),

	linear: LinearConfigSchema.optional(),

	model: z.string().default(PROJECT_DEFAULTS.model),
	agentModels: z.record(z.string()).optional(),
	maxIterations: z.number().int().positive().default(PROJECT_DEFAULTS.maxIterations),
	watchdogTimeoutMs: z.number().int().positive().default(PROJECT_DEFAULTS.watchdogTimeoutMs), // 30 min max job duration
	progressModel: z.string().default(PROJECT_DEFAULTS.progressModel),
	progressIntervalMinutes: z.number().positive().default(PROJECT_DEFAULTS.progressIntervalMinutes),
	workItemBudgetUsd: z.number().positive().default(PROJECT_DEFAULTS.workItemBudgetUsd),
	agentEngine: AgentEngineConfigSchema.optional(),
	engineSettings: EngineSettingsSchema.optional(),
	/**
	 * Per-agent engine settings overrides keyed by agent type.
	 * Populated from agent_configs rows at config load time.
	 * Used by buildExecutionPlan() to merge into the execution plan's engineSettings.
	 */
	agentEngineSettings: z.record(z.string(), EngineSettingsSchema).optional(),
	runLinksEnabled: z.boolean().default(false),
	maxInFlightItems: z.number().int().positive().optional(),
	snapshotEnabled: z.boolean().optional(),
	snapshotTtlMs: z.number().int().positive().optional(),
});

export const CascadeConfigSchema = z.object({
	projects: z.array(ProjectConfigSchema).min(1),
});

export function validateConfig(config: unknown): z.infer<typeof CascadeConfigSchema> {
	return CascadeConfigSchema.parse(config);
}
