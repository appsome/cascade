/**
 * Glue that lets `pm-wizard.tsx` check the provider registry before
 * falling through to its legacy per-provider branches.
 *
 * Usage at each step render site in the wizard:
 *
 *   {renderManifestStep(state.provider, 0, state, dispatch) ?? (
 *     state.provider === 'trello' ? <TrelloCredentialsStep ... />
 *     : state.provider === 'linear' ? <LinearCredentialsStep ... />
 *     : <JiraCredentialsStep ... />
 *   )}
 *
 * Plan 006/1 ships this path dormant — no real provider is registered
 * yet, so every call returns null and the legacy chain renders exactly
 * as before. Each provider migration (006/2–006/4) registers its
 * wizard and starts using this path.
 */

import { createElement, type ReactElement } from 'react';
import type { WizardAction, WizardState } from '../pm-wizard-state.js';
import { getProviderWizard } from './registry.js';

export function renderManifestStep(
	providerId: string,
	stepIndex: number,
	state: WizardState,
	dispatch: React.Dispatch<WizardAction>,
	providerHooks?: Record<string, unknown>,
): ReactElement | null {
	const def = getProviderWizard(providerId);
	if (!def) return null;
	const step = def.steps[stepIndex];
	if (!step) return null;
	return createElement(step.Component, { state, dispatch, providerHooks });
}
