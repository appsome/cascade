import { TRPCError } from '@trpc/server';
import { isExternalWebhookPasswordKey } from '../../../triggers/shared/external-webhook.js';

export const EXTERNAL_WEBHOOK_PASSWORD_MIN_LENGTH = 16;

/**
 * External webhook passwords authenticate an unauthenticated internet-facing
 * endpoint that dispatches agents — a guessable password is remote agent
 * execution. Enforce a minimum length at every write path (project + org
 * credential mutations). Other credential keys are unaffected.
 */
export function assertWebhookPasswordStrength(envVarKey: string, value: string): void {
	if (!isExternalWebhookPasswordKey(envVarKey)) return;
	if (value.length < EXTERNAL_WEBHOOK_PASSWORD_MIN_LENGTH) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Webhook passwords must be at least ${EXTERNAL_WEBHOOK_PASSWORD_MIN_LENGTH} characters`,
		});
	}
}
