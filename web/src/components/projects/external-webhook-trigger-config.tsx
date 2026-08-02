/**
 * Inline configuration block for the external webhook trigger, rendered under
 * the trigger row in the agent's Triggers tab when the trigger is enabled.
 * Shows the per-project-per-agent webhook URL (copy button + curl example)
 * and the password field (a project credential — org inheritance applies).
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { ProjectSecretField } from '@/components/projects/project-secret-field.js';
import { CopyButton } from '@/components/ui/copy-button.js';
import { Label } from '@/components/ui/label.js';
import { trpc } from '@/lib/trpc.js';
import {
	externalWebhookCredentialKey,
	externalWebhookPath,
} from '../../../../src/triggers/shared/external-webhook.js';

export function ExternalWebhookTriggerConfig({
	projectId,
	agentType,
	enabled,
}: {
	projectId: string;
	agentType: string;
	enabled: boolean;
}) {
	const publicUrlQuery = useQuery({
		...trpc.system.getPublicUrl.queryOptions(),
		enabled,
	});
	const credentialsQuery = useQuery({
		...trpc.projects.credentials.list.queryOptions({ projectId }),
		enabled,
	});

	if (!enabled) return null;

	// The URL must point at the ROUTER service, so API_URL (the dashboard API)
	// is deliberately not a fallback here. WEBHOOK_CALLBACK_BASE_URL is the
	// authoritative source; the dev-server origin swap covers local dev only.
	const devOrigin =
		typeof window !== 'undefined' && window.location.origin.includes(':5173')
			? window.location.origin.replace(':5173', ':3000')
			: '';
	const callbackBaseUrl = publicUrlQuery.data?.routerPublicUrl ?? devOrigin;
	const webhookUrl = `${callbackBaseUrl || '<YOUR_ROUTER_URL>'}${externalWebhookPath(projectId, agentType)}`;

	const credentialKey = externalWebhookCredentialKey(agentType);
	const credential = credentialsQuery.data?.find((c) => c.envVarKey === credentialKey);

	const curlExample = [
		`curl -X POST '${webhookUrl}' \\`,
		`  -H 'Authorization: Bearer <YOUR_PASSWORD>' \\`,
		`  -H 'Content-Type: application/json' \\`,
		`  -d '{"message": "Describe what the agent should do"}'`,
	].join('\n');

	return (
		<div className="ml-7 pl-3 border-l border-border space-y-3">
			<div className="space-y-1.5">
				<Label className="text-xs">Webhook URL</Label>
				<p className="text-xs text-muted-foreground">
					POST to this URL to dispatch the {agentType} agent. The request body reaches the agent as
					trigger context.
				</p>
				<div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
					<code className="flex-1 text-xs font-mono break-all">{webhookUrl}</code>
					<CopyButton text={webhookUrl} />
				</div>
			</div>

			<details className="text-xs">
				<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
					Example request
				</summary>
				<div className="mt-2 flex items-start gap-2 rounded-md border bg-muted px-3 py-2">
					<pre className="flex-1 font-mono whitespace-pre-wrap break-all">{curlExample}</pre>
					<CopyButton text={curlExample} />
				</div>
			</details>

			{!credential?.isConfigured && (
				<div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-500">
					<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
					Requests are rejected until a password is set.
				</div>
			)}

			<ProjectSecretField
				projectId={projectId}
				envVarKey={credentialKey}
				label="Webhook Password"
				description="Sent by callers as 'Authorization: Bearer <password>'. Required (minimum 16 characters) — requests are rejected until set."
				placeholder="Choose a strong password (16+ characters)..."
				credential={credential}
			/>
		</div>
	);
}
