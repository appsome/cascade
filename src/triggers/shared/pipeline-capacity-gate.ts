/**
 * Shared pipeline-capacity gate for PM `status-changed` triggers.
 *
 * `maxInFlightItems` is meant as a hard cap on the *active pipeline*
 * (TODO + IN_PROGRESS + IN_REVIEW). Without this gate, a human moving N
 * cards into the TODO column fires N implementation runs in parallel and
 * blows past the limit — see the regression on `ua-store` (2026-04-24)
 * where 3 implementations ran concurrently despite `maxInFlightItems: 1`.
 *
 * Currently only `implementation` is gated: of the agents reachable via PM
 * `status-changed` (see `STATUS_TO_AGENT`), it is the only one that consumes
 * a TODO/IN_PROGRESS/IN_REVIEW slot. `splitting` and `planning` use their own
 * dedicated columns; `backlog-manager` already has dedicated capacity gates
 * at its two chain sites (pr-merged, splitting auto-chain).
 */

import { getPMProvider } from '../../pm/context.js';
import type { PMProvider } from '../../pm/types.js';
import { captureException } from '../../sentry.js';
import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isActivePipelineOverCapacity } from './backlog-check.js';

const SLOT_CONSUMING_AGENTS: ReadonlySet<string> = new Set(['implementation']);

export async function shouldBlockForPipelineCapacity(args: {
	project: ProjectConfig;
	agentType: string;
	workItemId: string;
	source: string;
}): Promise<boolean> {
	if (!SLOT_CONSUMING_AGENTS.has(args.agentType)) return false;

	let provider: PMProvider;
	try {
		provider = getPMProvider();
	} catch (err) {
		// Spec 017 / plan 2: fail closed.
		//
		// Before plan 2, this branch logged WARN and returned `false` (allow)
		// because the PM router adapters dispatched outside PM-provider scope
		// — hitting this branch was the routine path for every PM
		// `status-changed` trigger. After plan 2 wraps every PM router adapter
		// in `withPMScopeForDispatch`, hitting this branch represents a real
		// AsyncLocalStorage scope leak that operators need to investigate.
		// Failing closed (block + error + Sentry) is preferable to silently
		// failing open and re-introducing the original incident class
		// (multiple concurrent implementation runs against a project pinned
		// to `maxInFlightItems: 1`).
		const error = err instanceof Error ? err : new Error(String(err));
		logger.error('pipeline-capacity-gate: PM provider unavailable, blocking run', {
			source: args.source,
			projectId: args.project.id,
			workItemId: args.workItemId,
			agentType: args.agentType,
			error: String(err),
		});
		captureException(error, {
			tags: { source: 'pipeline_capacity_gate_no_pm_provider' },
			extra: {
				projectId: args.project.id,
				workItemId: args.workItemId,
				agentType: args.agentType,
				triggerSource: args.source,
			},
		});
		return true;
	}

	const result = await isActivePipelineOverCapacity(args.project, provider, {
		excludeWorkItemId: args.workItemId,
	});

	if (result.overCapacity) {
		logger.info('pipeline-at-capacity: skipping status-changed trigger', {
			source: args.source,
			projectId: args.project.id,
			workItemId: args.workItemId,
			agentType: args.agentType,
			inFlightCount: result.inFlightCount,
			limit: result.limit,
		});
		return true;
	}
	return false;
}
