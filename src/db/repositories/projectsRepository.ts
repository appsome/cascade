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
		setupTimeoutMs?: number | null;
		workerImage?: string | null;
		workerImageDigest?: string | null;
		workerImageStatus?: string | null;
		workerImageError?: string | null;
		workerDockerfile?: string | null;
		workerImageBuildHash?: string | null;
		workerImageBuildStatus?: string | null;
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
			setupTimeoutMs: rest.setupTimeoutMs,
			workerImage: rest.workerImage,
			workerImageDigest: rest.workerImageDigest,
			workerImageStatus: rest.workerImageStatus,
			workerImageError: rest.workerImageError,
			workerDockerfile: rest.workerDockerfile,
			workerImageBuildHash: rest.workerImageBuildHash,
			workerImageBuildStatus: rest.workerImageBuildStatus,
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
		setupTimeoutMs?: number | null;
		workerImage?: string | null;
		workerImageDigest?: string | null;
		workerImageStatus?: string | null;
		workerImageError?: string | null;
		workerDockerfile?: string | null;
		workerImageBuildHash?: string | null;
		workerImageBuildStatus?: string | null;
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

/**
 * Record the outcome of a router-side worker-image validation (spec 022 plan 3).
 *
 * Updates the project's `worker_image_*` columns from the `pending` state set by
 * the API mutation. The write is guarded by `worker_image = ref`: it only applies
 * when the project's current operator-set reference still equals the validated
 * `ref`. If the operator re-set or cleared the image after this job was enqueued,
 * the guard matches zero rows and the stale result is dropped (the newer
 * reference owns its own validation job). Returns whether a row was updated.
 *
 *   - `verified` → pins the immutable `digest`, clears `error`.
 *   - `failed`   → records the precise `error`, leaves `digest` null.
 *
 * Org scoping is intentionally absent: the caller is the trusted router consuming
 * a job it enqueued with an internal projectId, not a user request.
 */
export async function recordWorkerImageValidationResult(
	projectId: string,
	ref: string,
	result:
		| { status: 'verified'; digest: string; error: null }
		| { status: 'failed'; digest: null; error: string },
): Promise<boolean> {
	const db = getDb();
	const updated = await db
		.update(projects)
		.set({
			workerImageStatus: result.status,
			workerImageDigest: result.digest,
			workerImageError: result.error,
			updatedAt: new Date(),
		})
		.where(and(eq(projects.id, projectId), eq(projects.workerImage, ref)))
		.returning({ id: projects.id });
	return updated.length > 0;
}

/**
 * The minimal row the router-side worker-image build engine reads before it
 * touches Docker (spec 023 plan 3). `dockerfile` is the operator's extra-layer
 * content; `buildHash` is the persisted content-hash used to detect a supersede
 * (a newer set changed it); `workerImageStatus` + `workerImageDigest` together
 * tell the engine whether a last-good verified pin exists (the no-strand rule on
 * a failed rebuild). Returns `null` when the project no longer exists.
 */
export async function readWorkerImageBuildInputs(projectId: string): Promise<{
	dockerfile: string | null;
	buildHash: string | null;
	workerImageStatus: string | null;
	workerImageDigest: string | null;
} | null> {
	const db = getDb();
	const [row] = await db
		.select({
			dockerfile: projects.workerDockerfile,
			buildHash: projects.workerImageBuildHash,
			workerImageStatus: projects.workerImageStatus,
			workerImageDigest: projects.workerImageDigest,
		})
		.from(projects)
		.where(eq(projects.id, projectId));
	return row ?? null;
}

/**
 * Record the outcome of a router-side worker-image BUILD (spec 023 plan 3).
 *
 * A strict superset of {@link recordWorkerImageValidationResult}: the write is
 * guarded by `worker_image_build_hash = buildHash` so a superseded build's
 * result is dropped (the newer content owns its own build job). Returns whether
 * a row was updated. Three outcomes:
 *
 *   - `verified` → pins the immutable LOCAL image ID in `worker_image_digest`,
 *     flips `worker_image_status = verified`, clears `worker_image_error`, and
 *     resets `worker_image_build_status` to NULL (idle — the build finished).
 *   - `failed` + `keepActive: true` → **no-strand rule.** A rebuild failed while
 *     a last-good verified pin exists: leave `worker_image_status` /
 *     `worker_image_digest` untouched (the project keeps running on the old pin)
 *     and record ONLY the failed attempt (`worker_image_build_status = failed`)
 *     plus its reason.
 *   - `failed` + `keepActive: false` → a FIRST build failed with no prior
 *     verified image to preserve: flip `worker_image_status = failed`, null the
 *     digest, and record `worker_image_build_status = failed` + reason.
 *
 * Org scoping is intentionally absent: the caller is the trusted router
 * consuming a job it enqueued with an internal projectId, not a user request.
 */
export async function recordWorkerImageBuildResult(
	projectId: string,
	buildHash: string,
	result:
		| { status: 'verified'; digest: string; error: null }
		| { status: 'failed'; error: string; keepActive: boolean },
): Promise<boolean> {
	const db = getDb();
	const updated = await db
		.update(projects)
		.set(
			result.status === 'verified'
				? {
						workerImageStatus: 'verified',
						workerImageDigest: result.digest,
						workerImageError: null,
						workerImageBuildStatus: null,
						updatedAt: new Date(),
					}
				: result.keepActive
					? {
							// No-strand: keep the last-good verified pin + status; record
							// only the failed rebuild attempt so the project keeps running.
							workerImageBuildStatus: 'failed',
							workerImageError: result.error,
							updatedAt: new Date(),
						}
					: {
							// First build failure — no prior verified image to preserve.
							workerImageStatus: 'failed',
							workerImageDigest: null,
							workerImageBuildStatus: 'failed',
							workerImageError: result.error,
							updatedAt: new Date(),
						},
		)
		.where(and(eq(projects.id, projectId), eq(projects.workerImageBuildHash, buildHash)))
		.returning({ id: projects.id });
	return updated.length > 0;
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
