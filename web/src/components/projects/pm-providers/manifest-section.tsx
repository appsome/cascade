/**
 * Shell component for manifest-driven wizard rendering.
 *
 * Rendered by `pm-wizard.tsx` only when the active provider has a
 * registered `ProviderWizardDefinition`. Because the shell itself is
 * conditionally rendered, `def.useProviderHooks?.(ctx)` is called
 * unconditionally from inside — preserving React's rules-of-hooks
 * (the shell is either mounted or not; it never toggles hooks mid-life).
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
	readonly projectId: string | undefined;
	readonly advanceToStep: (step: number) => void;
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
	projectId,
	advanceToStep,
	stepIndex,
}: ManifestProviderWizardSectionProps): ReactElement | null {
	// Unconditional hook call: the shell is only mounted when `def` exists,
	// so the hook is always called on every render of the shell.
	const providerHooks = def.useProviderHooks?.({ state, dispatch, projectId, advanceToStep }) ?? {};
	const step = def.steps[stepIndex];
	if (!step) return null;
	return createElement(step.Component, { state, dispatch, providerHooks });
}
