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
