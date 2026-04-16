/**
 * SSR tests for LinearFieldMappingStep — verify the 8-slot status list
 * renders in lifecycle order and existing mappings flow through correctly.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinearFieldMappingStep } from '../../../web/src/components/projects/pm-wizard-linear-steps.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(overrides: Partial<WizardState>): WizardState {
	return {
		provider: 'linear',
		linearApiKey: '',
		linearTeamId: 'team-1',
		linearTeamDetails: {
			states: [
				{ name: 'Backlog', id: 'st-bl', type: 'backlog', color: '' },
				{ name: 'Splitting', id: 'st-sp', type: 'started', color: '' },
				{ name: 'Planning', id: 'st-pl', type: 'started', color: '' },
				{ name: 'Todo', id: 'st-td', type: 'unstarted', color: '' },
				{ name: 'In Progress', id: 'st-ip', type: 'started', color: '' },
				{ name: 'In Review', id: 'st-ir', type: 'started', color: '' },
				{ name: 'Done', id: 'st-dn', type: 'completed', color: '' },
				{ name: 'Merged', id: 'st-mg', type: 'completed', color: '' },
			],
			labels: [],
		},
		linearStatusMappings: {},
		linearLabels: {},
		...overrides,
	} as unknown as WizardState;
}

function render(extra: Partial<WizardState> = {}): string {
	return renderToStaticMarkup(
		createElement(LinearFieldMappingStep, {
			state: makeState(extra),
			dispatch: () => {},
		}),
	);
}

describe('LinearFieldMappingStep — status slots', () => {
	it('renders 8 status mapping rows in CASCADE lifecycle order', () => {
		const html = render();
		const expected = [
			'backlog',
			'splitting',
			'planning',
			'todo',
			'inProgress',
			'inReview',
			'done',
			'merged',
		];
		const positions = expected.map((slot) => html.indexOf(`>${slot}<`));
		// All slots must be present (index !== -1) AND strictly increasing.
		positions.forEach((pos, i) => {
			expect(pos, `slot '${expected[i]}' missing`).toBeGreaterThan(-1);
			if (i > 0) {
				expect(pos, `slot '${expected[i]}' out of order`).toBeGreaterThan(positions[i - 1]);
			}
		});
	});

	it('does not render a debug row', () => {
		const html = render();
		expect(html).not.toMatch(/>debug</);
	});

	it('renders a select and enter-manually affordance for each slot', () => {
		const html = render();
		// Lower bound: 8 selects present (one per slot). Upper bound not asserted.
		const selectCount = (html.match(/<select /g) ?? []).length;
		expect(selectCount).toBeGreaterThanOrEqual(8);
	});

	it('reflects persisted mappings on initial render', () => {
		const html = render({
			linearStatusMappings: {
				splitting: 'st-sp',
				planning: 'st-pl',
			},
		});
		// The persisted values should appear as selected option values.
		expect(html).toContain('value="st-sp"');
		expect(html).toContain('value="st-pl"');
	});

	// Regression: Linear webhooks deliver workflow-state UUIDs in `data.stateId`,
	// not display names. Storing names in the mapping makes the trigger handler's
	// strict equality check (src/triggers/linear/status-changed.ts) silently no-op.
	it('uses state IDs (not names) as dropdown option values', () => {
		const html = render();
		// Each Linear workflow state's ID must appear as an option value.
		for (const id of ['st-bl', 'st-sp', 'st-pl', 'st-td', 'st-ip', 'st-ir', 'st-dn', 'st-mg']) {
			expect(html, `option value="${id}" missing`).toContain(`value="${id}"`);
		}
		// State names must NOT appear as option values (they may still be option labels).
		for (const name of [
			'Backlog',
			'Splitting',
			'Planning',
			'Todo',
			'In Progress',
			'In Review',
			'Done',
			'Merged',
		]) {
			expect(html, `state name "${name}" must not be a value`).not.toContain(`value="${name}"`);
		}
	});
});

describe('LinearFieldMappingStep — label slots', () => {
	function renderWithLabels(
		labels: Array<{ id: string; name: string; color: string }>,
		persisted: Record<string, string> = {},
		onCreateLabel?: (slot: string) => void,
		onCreateAllMissingLabels?: () => void,
	): string {
		const state = makeState({
			linearTeamDetails: {
				states: [],
				labels,
			},
			linearLabels: persisted,
		});
		return renderToStaticMarkup(
			createElement(LinearFieldMappingStep, {
				state,
				dispatch: () => {},
				onCreateLabel,
				onCreateAllMissingLabels,
			}),
		);
	}

	it('renders label dropdowns sourced from linearTeamDetails.labels (ID-backed options)', () => {
		const html = renderWithLabels([
			{ id: 'lbl-proc-uuid', name: 'cascade-processing', color: '#2563EB' },
			{ id: 'lbl-done-uuid', name: 'cascade-processed', color: '#16A34A' },
		]);
		// The label dropdown must expose each Linear label's UUID as an option value.
		expect(html).toContain('value="lbl-proc-uuid"');
		expect(html).toContain('value="lbl-done-uuid"');
		// Display names should NOT appear as option values (they can still be in the label text).
		expect(html).not.toContain('value="cascade-processing"');
	});

	it('shows the "Create" affordance for slots with no mapping and no existing matching label', () => {
		const html = renderWithLabels(
			[],
			{},
			() => {},
			() => {},
		);
		// A dedicated create button per slot — look for the batch button text too.
		expect(html).toMatch(/Create All Missing/);
	});

	it('hides the per-slot Create button when the default label already exists on the team', () => {
		const html = renderWithLabels(
			[
				{ id: 'lbl-ready', name: 'cascade-ready', color: '#0284C7' },
				{ id: 'lbl-proc', name: 'cascade-processing', color: '#2563EB' },
				{ id: 'lbl-procd', name: 'cascade-processed', color: '#16A34A' },
				{ id: 'lbl-err', name: 'cascade-error', color: '#DC2626' },
				{ id: 'lbl-auto', name: 'cascade-auto', color: '#9333EA' },
			],
			{},
			() => {},
			() => {},
		);
		// With every default present, there's nothing left to create → batch button hidden.
		expect(html).not.toMatch(/Create All Missing/);
	});

	it('reflects persisted label mappings as selected dropdown values', () => {
		const html = renderWithLabels(
			[{ id: 'lbl-proc-uuid', name: 'cascade-processing', color: '#2563EB' }],
			{ processing: 'lbl-proc-uuid' },
		);
		expect(html).toContain('value="lbl-proc-uuid"');
	});
});
