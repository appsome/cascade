/**
 * SSR tests for LinearTeamStep — verify team + project selector rendering
 * and the new optional project-scope selector behavior.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LinearTeamStep } from '../../../web/src/components/projects/pm-wizard-linear-steps.js';
import type { WizardState } from '../../../web/src/components/projects/pm-wizard-state.js';

function makeState(overrides: Partial<WizardState> = {}): WizardState {
	return {
		provider: 'linear',
		linearApiKey: 'lin_api_test',
		linearTeamId: '',
		linearTeams: [
			{ id: 'team-1', name: 'Engineering', key: 'ENG' },
			{ id: 'team-2', name: 'Design', key: 'DES' },
		],
		linearTeamDetails: null,
		linearStatusMappings: {},
		linearLabels: {},
		linearProjectId: '',
		linearProjects: [],
		isEditing: false,
		hasStoredCredentials: false,
		...overrides,
	} as unknown as WizardState;
}

function pendingMutation(): {
	isPending: boolean;
	isError: boolean;
	error: null;
	mutate: () => void;
} {
	return { isPending: false, isError: false, error: null, mutate: vi.fn() };
}

function render(extra: Partial<WizardState> = {}): string {
	const state = makeState(extra);
	return renderToStaticMarkup(
		createElement(LinearTeamStep, {
			state,
			onTeamSelect: () => {},
			dispatch: () => {},
			// biome-ignore lint/suspicious/noExplicitAny: test stub for tanstack mutation object
			linearTeamsMutation: pendingMutation() as any,
			// biome-ignore lint/suspicious/noExplicitAny: test stub for tanstack mutation object
			linearDetailsMutation: pendingMutation() as any,
			// biome-ignore lint/suspicious/noExplicitAny: test stub for tanstack mutation object
			linearProjectsMutation: pendingMutation() as any,
		}),
	);
}

describe('LinearTeamStep — project selector', () => {
	it('does not render the Linear Project selector when no team is selected', () => {
		const html = render({ linearTeamId: '' });
		expect(html).not.toContain('Linear Project');
	});

	it('renders the Linear Project selector when a team is selected', () => {
		const html = render({
			linearTeamId: 'team-1',
			linearProjects: [
				{ id: 'P1', name: 'Alpha', icon: null, color: null },
				{ id: 'P2', name: 'Beta', icon: null, color: null },
			],
		});
		expect(html).toContain('Linear Project');
	});

	it('populates the selector options from state.linearProjects', () => {
		const html = render({
			linearTeamId: 'team-1',
			linearProjects: [
				{ id: 'P1', name: 'Alpha', icon: null, color: null },
				{ id: 'P2', name: 'Beta', icon: null, color: null },
			],
		});
		expect(html).toContain('Alpha');
		expect(html).toContain('Beta');
		expect(html).toContain('value="P1"');
		expect(html).toContain('value="P2"');
	});

	it('pre-selects the stored projectId when set', () => {
		const html = render({
			linearTeamId: 'team-1',
			linearProjectId: 'P2',
			linearProjects: [
				{ id: 'P1', name: 'Alpha', icon: null, color: null },
				{ id: 'P2', name: 'Beta', icon: null, color: null },
			],
		});
		// Native <select> renders the selected value on the select element
		expect(html).toMatch(/<select[^>]*>\s*<option value="">[^<]*<\/option>[\s\S]*value="P2"/);
	});

	it('helper copy makes the optional nature explicit', () => {
		const html = render({ linearTeamId: 'team-1' });
		expect(html.toLowerCase()).toContain('optional');
		// Mentions fallback behavior when empty
		expect(html.toLowerCase()).toMatch(/leave empty|all issues in this team/);
	});

	it('renders an empty placeholder option so the selector can be cleared', () => {
		const html = render({
			linearTeamId: 'team-1',
			linearProjectId: 'P1',
			linearProjects: [{ id: 'P1', name: 'Alpha', icon: null, color: null }],
		});
		// Placeholder <option value=""> allows clearing the selection.
		expect(html).toMatch(/<option value=""[^>]*>/);
	});
});
