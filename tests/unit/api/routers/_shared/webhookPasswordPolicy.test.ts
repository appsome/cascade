import { describe, expect, it } from 'vitest';
import {
	assertWebhookPasswordStrength,
	EXTERNAL_WEBHOOK_PASSWORD_MIN_LENGTH,
} from '../../../../../src/api/routers/_shared/webhookPasswordPolicy.js';

describe('assertWebhookPasswordStrength', () => {
	it('rejects short webhook passwords', () => {
		expect(() =>
			assertWebhookPasswordStrength('EXTERNAL_WEBHOOK_PASSWORD_IMPLEMENTATION', 'short'),
		).toThrow(/at least 16 characters/);
	});

	it('accepts webhook passwords at the minimum length', () => {
		expect(() =>
			assertWebhookPasswordStrength(
				'EXTERNAL_WEBHOOK_PASSWORD_IMPLEMENTATION',
				'x'.repeat(EXTERNAL_WEBHOOK_PASSWORD_MIN_LENGTH),
			),
		).not.toThrow();
	});

	it('ignores non-webhook credential keys entirely', () => {
		expect(() => assertWebhookPasswordStrength('GITHUB_TOKEN_IMPLEMENTER', 'x')).not.toThrow();
		expect(() => assertWebhookPasswordStrength('OPENROUTER_API_KEY', 'a')).not.toThrow();
	});
});
