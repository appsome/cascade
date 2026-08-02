import { describe, expect, it } from 'vitest';
import { appendExternalTriggerRequest } from '../../../../src/agents/prompts/index.js';

describe('appendExternalTriggerRequest', () => {
	it('appends the request payload for external-webhook runs', () => {
		const result = appendExternalTriggerRequest('Base task prompt.', {
			triggerType: 'external-webhook',
			triggerCommentBody: '{"message":"fix the login bug"}',
		});

		expect(result).toContain('Base task prompt.');
		expect(result).toContain('## External trigger request');
		expect(result).toContain('<external-request>');
		expect(result).toContain('{"message":"fix the login bug"}');
		expect(result).toContain('</external-request>');
	});

	it('is a no-op for manual runs even with a comment body', () => {
		const result = appendExternalTriggerRequest('Base task prompt.', {
			triggerType: 'manual',
			triggerCommentBody: 'some comment',
		});
		expect(result).toBe('Base task prompt.');
	});

	it('is a no-op for external-webhook runs without a body', () => {
		const result = appendExternalTriggerRequest('Base task prompt.', {
			triggerType: 'external-webhook',
		});
		expect(result).toBe('Base task prompt.');
	});
});
