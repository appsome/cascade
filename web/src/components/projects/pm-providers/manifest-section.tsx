/**
 * Shell component for manifest-driven wizard rendering.
 *
 * Rendered by ManifestStepsSection in `pm-wizard.tsx`, which calls
 * `def.useProviderHooks?.()` exactly once and passes the result as a
 * prop. This component never calls useProviderHooks directly — doing so
 * would create N independent hook instances (one per step), each firing
 * Effect 2 on mount and producing an N× request storm.
 *
 * Each step's React component receives `{ state, dispatch, providerHooks }`
 * per `ProviderWizardStepProps`. Provider-specific adapters destructure
 * `providerHooks` into the shape the existing step components expect.
 */

import { createElement, type ReactElement } from 'react';
import type { WizardAction, WizardState } from '../pm-wizard-state.js';
import type { ProviderWizardDefinition } from './types.js';

export interface ManifestProviderWizardSectionProps {
	readonly def: ProviderWizardDefinition;
	readonly state: WizardState;
	readonly dispatch: React.Dispatch<WizardAction>;
	/** Resolved once by ManifestStepsSection and shared across all step instances. */
	readonly providerHooks: Record<string, unknown>;
	/**
	 * Which step index to render. Returned as an element ready to drop into
	 * the caller's `<WizardStep>` wrapper. Returns null for an out-of-range
	 * index — caller falls back.
	 */
	readonly stepIndex: number;
}

export function ManifestProviderWizardSection({
	def,
	state,
	dispatch,
	providerHooks,
	stepIndex,
}: ManifestProviderWizardSectionProps): ReactElement | null {
	const step = def.steps[stepIndex];
	if (!step) return null;
	return createElement(step.Component, { state, dispatch, providerHooks });
}
