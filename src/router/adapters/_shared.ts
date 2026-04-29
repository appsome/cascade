/**
 * Shared helpers for router platform adapters.
 *
 * Spec 017 / plan 2: PM router adapters (Linear/Trello/JIRA) wrap their
 * `triggerRegistry.dispatch(ctx)` invocation in `withPMProvider` scope using
 * the helper below. Without it, `getPMProvider()` calls inside trigger
 * handlers — notably the pipeline-capacity gate at
 * `src/triggers/shared/pipeline-capacity-gate.ts` — throw, the gate fails
 * closed under spec 017's fail-closed policy, and Sentry captures under
 * tag `pipeline_capacity_gate_no_pm_provider`.
 *
 * Mirrors the GitHub router adapter's existing correct shape at
 * `src/router/adapters/github.ts:dispatchWithCredentials` which has wrapped
 * dispatch in PM-provider scope since spec 006.
 *
 * The helper does NOT establish credential scope — that's each adapter's
 * concern. PM-provider scope layers on TOP of the credential scope.
 */

import { withPMProvider } from '../../pm/context.js';
import { createPMProvider } from '../../pm/index.js';
import type { ProjectConfig } from '../../types/index.js';

/**
 * Wrap a dispatch callback in PM-provider AsyncLocalStorage scope so that
 * `getPMProvider()` succeeds inside trigger handlers downstream.
 *
 * Resolves the PMProvider via `createPMProvider(project)` (the legacy
 * compatibility adapter that delegates to the manifest registry's
 * `pmIntegration.createProvider(project)`) and runs `dispatch` inside
 * `withPMProvider(provider, dispatch)`.
 *
 * Returns whatever `dispatch` returns. Errors thrown by `dispatch`
 * propagate unchanged.
 */
export function withPMScopeForDispatch<T>(
	project: ProjectConfig,
	dispatch: () => Promise<T>,
): Promise<T> {
	const provider = createPMProvider(project);
	return withPMProvider(provider, dispatch);
}
