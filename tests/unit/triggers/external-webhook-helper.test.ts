import { describe, expect, it } from 'vitest';
import { TRIGGER_EVENTS } from '../../../src/triggers/shared/events.js';
import {
	EXTERNAL_WEBHOOK_EVENT,
	externalWebhookCredentialKey,
	externalWebhookPath,
	isValidAgentTypeSlug,
} from '../../../src/triggers/shared/external-webhook.js';

const CREDENTIAL_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

describe('external webhook helpers', () => {
	it('event constant matches the canonical catalog', () => {
		expect(EXTERNAL_WEBHOOK_EVENT).toBe(TRIGGER_EVENTS.INTERNAL.EXTERNAL_WEBHOOK);
	});

	describe('externalWebhookCredentialKey', () => {
		it('maps simple agent types', () => {
			expect(externalWebhookCredentialKey('implementation')).toBe(
				'EXTERNAL_WEBHOOK_PASSWORD_IMPLEMENTATION',
			);
		});

		it('maps kebab-case agent types with underscores', () => {
			expect(externalWebhookCredentialKey('backlog-manager')).toBe(
				'EXTERNAL_WEBHOOK_PASSWORD_BACKLOG_MANAGER',
			);
			expect(externalWebhookCredentialKey('resolve-conflicts')).toBe(
				'EXTERNAL_WEBHOOK_PASSWORD_RESOLVE_CONFLICTS',
			);
		});

		it('always produces a valid project credential key', () => {
			for (const agent of [
				'implementation',
				'planning',
				'splitting',
				'backlog-manager',
				'review',
				'resolve-conflicts',
				'alerting',
			]) {
				expect(externalWebhookCredentialKey(agent)).toMatch(CREDENTIAL_KEY_RE);
			}
		});

		it('throws on invalid slugs', () => {
			expect(() => externalWebhookCredentialKey('Not-Valid')).toThrow();
			expect(() => externalWebhookCredentialKey('../etc')).toThrow();
			expect(() => externalWebhookCredentialKey('')).toThrow();
		});
	});

	describe('isValidAgentTypeSlug', () => {
		it('accepts lowercase kebab slugs', () => {
			expect(isValidAgentTypeSlug('implementation')).toBe(true);
			expect(isValidAgentTypeSlug('backlog-manager')).toBe(true);
		});

		it('rejects uppercase, traversal, empty, digit-leading, and overlong values', () => {
			expect(isValidAgentTypeSlug('Implementation')).toBe(false);
			expect(isValidAgentTypeSlug('../etc/passwd')).toBe(false);
			expect(isValidAgentTypeSlug('')).toBe(false);
			expect(isValidAgentTypeSlug('1agent')).toBe(false);
			expect(isValidAgentTypeSlug('a'.repeat(65))).toBe(false);
		});
	});

	it('builds the router path', () => {
		expect(externalWebhookPath('proj-1', 'implementation')).toBe(
			'/external/webhook/proj-1/implementation',
		);
	});
});
