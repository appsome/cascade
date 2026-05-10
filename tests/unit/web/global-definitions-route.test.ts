import { describe, expect, it } from 'vitest';
import { AGENT_DEFINITIONS_TABS } from '../../../web/src/routes/global/definitions-tabs.js';

describe('global definitions route', () => {
	it('exposes the workflow statuses tab in the tab bar', () => {
		expect(AGENT_DEFINITIONS_TABS).toEqual(['definitions', 'partials', 'workflow-statuses']);
	});
});
