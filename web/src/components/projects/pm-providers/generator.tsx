/**
 * Wizard step generator scaffolding (plan 009/1 task 11).
 *
 * The generator provides `renderStandardStep(step, ctx)` — a switch over
 * `StandardStep['kind']` that returns the shared step component for each
 * standard kind. Provider wizards consume this generator in plans 2/3/4
 * to stop re-implementing identical credentials / container-pick /
 * status-mapping / label-mapping / webhook-url-display UI.
 *
 * In plan 1, the generator is **dormant**: the switch returns a typed
 * placeholder for every known kind. Plans 2/3/4 swap each placeholder
 * for the provider-agnostic real component, then the per-provider
 * wizard folders delete their copies of the same UI.
 *
 * Unknown `kind` values don't crash the build — the generator logs a
 * console warning once per kind and returns a visible placeholder. This
 * matters during migration: a provider that hasn't finished moving a
 * step to the generator yet can declare it on `wizardSpec.steps` and
 * still render (as a warning banner) rather than crash the wizard.
 */

import type React from 'react';
import { createElement } from 'react';
import type {
	CustomStep,
	StandardStep,
	StandardStepKind,
} from '../../../../../src/integrations/pm/manifest.js';

export interface WizardStepRenderContext {
	readonly providerId: string;
	readonly providerHooks?: Record<string, unknown>;
}

const warnedKinds = new Set<string>();

function warnOnce(kind: string, providerId: string): void {
	const key = `${providerId}:${kind}`;
	if (warnedKinds.has(key)) return;
	warnedKinds.add(key);
	if (typeof console !== 'undefined') {
		console.warn(
			`[pm-wizard generator] Provider '${providerId}' declared step kind '${kind}' ` +
				`which is not yet generated — rendering placeholder. Migrate the step component ` +
				`into the generator (plan 009/{2,3,4}) to replace this banner.`,
		);
	}
}

function placeholder(kind: string, providerId: string): React.ReactElement {
	return createElement(
		'div',
		{
			'data-pm-wizard-placeholder': 'true',
			'data-provider-id': providerId,
			'data-step-kind': kind,
			style: {
				padding: '1rem',
				border: '1px dashed #aaa',
				borderRadius: '0.25rem',
				background: '#fafafa',
				color: '#666',
				fontSize: '0.85rem',
			},
		},
		`Standard step '${kind}' for provider '${providerId}' pending generator adoption (plan 009/2-4).`,
	);
}

/**
 * Public entry point: render a wizard step as declared on
 * `manifest.wizardSpec.steps`. For standard kinds, returns the generic
 * component placeholder (plans 2/3/4 swap in the real component). For
 * custom steps, returns a placeholder that names the provider component
 * to resolve through the provider-owned wizard folder.
 */
export function renderStandardStep(
	step: StandardStep | CustomStep,
	ctx: WizardStepRenderContext,
): React.ReactElement {
	if (step.kind === 'custom') {
		// Custom steps live in provider folders and are resolved via the
		// existing `ProviderWizardDefinition.steps` path, not by the
		// generator. The generator still emits a placeholder so a
		// manifest-only declaration of a custom step doesn't silently drop.
		return placeholder(`custom:${step.component}`, ctx.providerId);
	}

	const knownKinds: readonly StandardStepKind[] = [
		'credentials',
		'container-pick',
		'status-mapping',
		'label-mapping',
		'webhook-url-display',
		'project-scope',
	];

	if (!(knownKinds as readonly string[]).includes(step.kind)) {
		warnOnce(step.kind, ctx.providerId);
		return placeholder(step.kind, ctx.providerId);
	}

	// All known kinds fall through to the same placeholder in plan 1.
	// Plans 2/3/4 replace each case with the real shared component.
	return placeholder(step.kind, ctx.providerId);
}
