/**
 * Per-source format helpers for the alert→PM materializer (spec 019).
 *
 * Each helper converts a provider-specific webhook payload into AlertHints
 * (title + descriptionMarkdown). New sources (PagerDuty, Datadog, etc.) add a
 * new export here; the materializer itself stays unchanged.
 */

import type {
	SentryAugmentedPayload,
	SentryIssueAlertPayload,
	SentryStackFrame,
} from '../../../sentry/types.js';
import type { AlertHints } from './types.js';

/** Build the PM card title and description body from a Sentry event_alert payload. */
export function formatSentryCardBody(augmented: SentryAugmentedPayload): AlertHints {
	const payload = augmented.payload as SentryIssueAlertPayload;
	const event = payload.data?.event;

	const alertTitle =
		payload.data?.issue_alert?.title ??
		payload.data?.triggered_rule ??
		event?.title ??
		'Issue Alert';

	const issueUrl = event?.web_url ?? event?.issue_url ?? '';
	const timestamp = event?.timestamp ?? '';
	const topFrame = findTopInAppFrame(event?.exception?.values?.[0]?.stacktrace?.frames);

	const lines: string[] = [];

	if (issueUrl) lines.push(`**Sentry issue:** ${issueUrl}`);
	if (timestamp) lines.push(`**First seen:** ${timestamp}`);

	const ruleName = payload.data?.issue_alert?.title ?? payload.data?.triggered_rule;
	if (ruleName) lines.push(`**Alert rule:** ${ruleName}`);

	if (topFrame) {
		const loc = [topFrame.filename, topFrame.function, topFrame.lineno].filter(Boolean).join(':');
		lines.push(`**Top frame:** \`${loc}\``);
	}

	return {
		title: `[Sentry] ${alertTitle}`,
		descriptionMarkdown: lines.join('\n'),
	};
}

function findTopInAppFrame(frames?: SentryStackFrame[]): SentryStackFrame | undefined {
	if (!frames?.length) return undefined;
	// Prefer the last in-app frame (top of the user call stack)
	for (let i = frames.length - 1; i >= 0; i--) {
		if (frames[i].in_app) return frames[i];
	}
	return frames[frames.length - 1];
}
