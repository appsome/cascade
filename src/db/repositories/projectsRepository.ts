import { and, eq, sql } from 'drizzle-orm';
import { type EngineSettings, normalizeEngineSettings } from '../../config/engineSettings.js';
import { getDb } from '../client.js';
import { reEncryptCredential } from '../crypto.js';
import {
	agentConfigs,
	agentTriggerConfigs,
	projectCredentials,
	projectIntegrations,
	projects,
} from '../schema/index.js';

// ============================================================================
// Projects (full CRUD)
// ============================================================================

export async function listProjectsFull(orgId: string) {
	const db = getDb();
	return db.select().from(projects).where(eq(projects.orgId, orgId));
}

export async function listAllProjects() {
	const db = getDb();
	return db.select().from(projects).where(sql`1=1`);
}

export async function getProjectFull(projectId: string, orgId: string) {
	const db = getDb();
	const [row] = await db
		.select()
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
	return row ?? null;
}

export async function createProject(
	orgId: string,
	data: {
		id: string;
		name: string;
		repo?: string;
		baseBranch?: string;
		branchPrefix?: string;
		model?: string | null;
		maxIterations?: number | null;
		watchdogTimeoutMs?: number | null;
		workItemBudgetUsd?: string | null;
		agentEngine?: string | null;
		engineSettings?: EngineSettings | null;
		progressModel?: string | null;
		progressIntervalMinutes?: string | null;
		runLinksEnabled?: boolean;
		maxInFlightItems?: number | null;
		snapshotEnabled?: boolean | null;
		snapshotTtlMs?: number | null;
	},
) {
	const db = getDb();
	const { engineSettings, ...rest } = data;
	const [row] = await db
		.insert(projects)
		.values({
			id: rest.id,
			orgId,
			name: rest.name,
			repo: rest.repo ?? null,
			baseBranch: rest.baseBranch ?? 'main',
			branchPrefix: rest.branchPrefix ?? 'feature/',
			model: rest.model,
			maxIterations: rest.maxIterations,
			watchdogTimeoutMs: rest.watchdogTimeoutMs,
			workItemBudgetUsd: rest.workItemBudgetUsd,
			agentEngine: rest.agentEngine,
			progressModel: rest.progressModel,
			progressIntervalMinutes: rest.progressIntervalMinutes,
			runLinksEnabled: rest.runLinksEnabled ?? false,
			maxInFlightItems: rest.maxInFlightItems,
			snapshotEnabled: rest.snapshotEnabled,
			snapshotTtlMs: rest.snapshotTtlMs,
			...(engineSettings !== undefined
				? { agentEngineSettings: normalizeEngineSettings(engineSettings) }
				: {}),
		})
		.returning();
	return row;
}

export async function updateProject(
	projectId: string,
	orgId: string,
	updates: {
		name?: string;
		repo?: string;
		baseBranch?: string;
		branchPrefix?: string;
		model?: string | null;
		maxIterations?: number | null;
		watchdogTimeoutMs?: number | null;
		workItemBudgetUsd?: string | null;
		agentEngine?: string | null;
		engineSettings?: EngineSettings | null;
		progressModel?: string | null;
		progressIntervalMinutes?: string | null;
		runLinksEnabled?: boolean;
		maxInFlightItems?: number | null;
		snapshotEnabled?: boolean | null;
		snapshotTtlMs?: number | null;
	},
) {
	const db = getDb();
	const { engineSettings, ...rest } = updates;
	await db
		.update(projects)
		.set({
			...rest,
			...(engineSettings !== undefined
				? { agentEngineSettings: normalizeEngineSettings(engineSettings) }
				: {}),
			updatedAt: new Date(),
		})
		.where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
}

export async function deleteProject(projectId: string, orgId: string) {
	const db = getDb();
	await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
}

// ============================================================================
// Clone Project
// ============================================================================

/**
 * Clone a project: copy all settings, integrations, credentials (re-encrypted),
 * agent configs, and trigger configs into a new project row.
 *
 * The `repo` field is intentionally NOT copied — it has a unique DB constraint
 * and the user must configure it separately after cloning.
 */
export async function cloneProject(
	orgId: string,
	sourceProjectId: string,
	newProjectId: string,
	newName: string,
): Promise<{ id: string; name: string }> {
	const db = getDb();

	// 1. Fetch source project row
	const [sourceProject] = await db
		.select()
		.from(projects)
		.where(and(eq(projects.id, sourceProjectId), eq(projects.orgId, orgId)));

	if (!sourceProject) {
		throw new Error(`Source project not found: ${sourceProjectId}`);
	}

	// 2. Fetch related tables in parallel
	const [integrations, credentials, agentConfigRows, triggerConfigRows] = await Promise.all([
		db.select().from(projectIntegrations).where(eq(projectIntegrations.projectId, sourceProjectId)),
		db
			.select({
				envVarKey: projectCredentials.envVarKey,
				value: projectCredentials.value,
				name: projectCredentials.name,
			})
			.from(projectCredentials)
			.where(eq(projectCredentials.projectId, sourceProjectId)),
		db.select().from(agentConfigs).where(eq(agentConfigs.projectId, sourceProjectId)),
		db.select().from(agentTriggerConfigs).where(eq(agentTriggerConfigs.projectId, sourceProjectId)),
	]);

	// 3. Run everything in a transaction
	await db.transaction(async (tx) => {
		// Insert new project row (repo excluded — unique constraint)
		await tx.insert(projects).values({
			id: newProjectId,
			orgId,
			name: newName,
			repo: null,
			baseBranch: sourceProject.baseBranch,
			branchPrefix: sourceProject.branchPrefix,
			model: sourceProject.model,
			maxIterations: sourceProject.maxIterations,
			watchdogTimeoutMs: sourceProject.watchdogTimeoutMs,
			workItemBudgetUsd: sourceProject.workItemBudgetUsd,
			agentEngine: sourceProject.agentEngine,
			agentEngineSettings: sourceProject.agentEngineSettings,
			progressModel: sourceProject.progressModel,
			progressIntervalMinutes: sourceProject.progressIntervalMinutes,
			runLinksEnabled: sourceProject.runLinksEnabled,
			maxInFlightItems: sourceProject.maxInFlightItems,
			snapshotEnabled: sourceProject.snapshotEnabled,
			snapshotTtlMs: sourceProject.snapshotTtlMs,
		});

		// Insert integrations
		if (integrations.length > 0) {
			await tx.insert(projectIntegrations).values(
				integrations.map((i) => ({
					projectId: newProjectId,
					category: i.category,
					provider: i.provider,
					config: i.config,
					triggers: i.triggers,
				})),
			);
		}

		// Insert credentials re-encrypted with new projectId as AAD
		if (credentials.length > 0) {
			await tx.insert(projectCredentials).values(
				credentials.map((c) => ({
					projectId: newProjectId,
					envVarKey: c.envVarKey,
					value: reEncryptCredential(c.value, sourceProjectId, newProjectId),
					name: c.name,
				})),
			);
		}

		// Insert agent configs
		if (agentConfigRows.length > 0) {
			await tx.insert(agentConfigs).values(
				agentConfigRows.map((a) => ({
					projectId: newProjectId,
					agentType: a.agentType,
					model: a.model,
					maxIterations: a.maxIterations,
					agentEngine: a.agentEngine,
					agentEngineSettings: a.agentEngineSettings,
					maxConcurrency: a.maxConcurrency,
					systemPrompt: a.systemPrompt,
					taskPrompt: a.taskPrompt,
				})),
			);
		}

		// Insert trigger configs
		if (triggerConfigRows.length > 0) {
			await tx.insert(agentTriggerConfigs).values(
				triggerConfigRows.map((t) => ({
					projectId: newProjectId,
					agentType: t.agentType,
					triggerEvent: t.triggerEvent,
					enabled: t.enabled,
					parameters: t.parameters,
				})),
			);
		}
	});

	return { id: newProjectId, name: newName };
}
