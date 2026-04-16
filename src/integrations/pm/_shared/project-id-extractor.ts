/**
 * Registry-driven replacement for the per-provider if-else chain in
 * `src/router/worker-env.ts::extractProjectIdFromJob`. Iterates every
 * registered manifest and returns the first non-null projectId.
 *
 * This lives here (not in `router/worker-env.ts`) so it can be unit-tested
 * without mocking the router. `worker-env.ts` consults this helper first
 * and falls through to its existing legacy branches for providers not yet
 * migrated onto the manifest registry.
 */

import type { CascadeJob } from '../../../router/queue.js';
import { listPMProviders } from '../registry.js';

export async function extractProjectIdFromJobViaRegistry(
	jobData: CascadeJob,
): Promise<string | null> {
	for (const manifest of listPMProviders()) {
		const id = await manifest.extractProjectIdFromJob(jobData);
		if (id !== null) return id;
	}
	return null;
}
