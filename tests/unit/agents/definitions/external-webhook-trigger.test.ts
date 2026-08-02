import { describe, expect, it } from 'vitest';
import {
	getBuiltinAgentTypes,
	loadBuiltinDefinition,
} from '../../../../src/agents/definitions/loader.js';
import { EXTERNAL_WEBHOOK_EVENT } from '../../../../src/triggers/shared/external-webhook.js';

const DECLARING_AGENTS = [
	'implementation',
	'planning',
	'splitting',
	'backlog-manager',
	'review',
	'resolve-conflicts',
	'alerting',
] as const;

describe('external webhook trigger declarations', () => {
	for (const agentType of DECLARING_AGENTS) {
		it(`${agentType} declares internal:external-webhook (opt-in, no params)`, () => {
			const definition = loadBuiltinDefinition(agentType);
			const trigger = definition.triggers?.find((t) => t.event === EXTERNAL_WEBHOOK_EVENT);

			expect(trigger).toBeDefined();
			expect(trigger?.defaultEnabled).toBe(false);
			expect(trigger?.parameters ?? []).toEqual([]);
			expect(trigger?.label).toBe('External Webhook');
		});
	}

	it('no other builtin agent declares it', () => {
		const declaring = new Set<string>(DECLARING_AGENTS);
		for (const agentType of getBuiltinAgentTypes()) {
			if (declaring.has(agentType)) continue;
			const definition = loadBuiltinDefinition(agentType);
			const trigger = definition.triggers?.find((t) => t.event === EXTERNAL_WEBHOOK_EVENT);
			expect(trigger, `${agentType} should not declare external-webhook`).toBeUndefined();
		}
	});
});
