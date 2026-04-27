/**
 * Alerting (Sentry) integration tab component.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { ProjectSecretField } from './project-secret-field.js';

// ============================================================================
// PM Container Picker
// ============================================================================

interface ContainerPickerProps {
	projectId: string;
	pmProvider: string;
	value: string;
	onChange: (id: string) => void;
}

/**
 * Maps a PM provider slug to its discovery capability that returns container-like items.
 * Trello → "boards", JIRA → "projects", Linear → "teams".
 * Falls back to undefined (disabling the fetch button) for unknown providers.
 */
function containerCapabilityForProvider(
	provider: string,
): 'boards' | 'projects' | 'teams' | undefined {
	const map: Record<string, 'boards' | 'projects' | 'teams'> = {
		trello: 'boards',
		jira: 'projects',
		linear: 'teams',
	};
	return map[provider];
}

function PMContainerPicker({ projectId, pmProvider, value, onChange }: ContainerPickerProps) {
	const capability = containerCapabilityForProvider(pmProvider);

	const containersMutation = useMutation({
		mutationFn: async () => {
			if (!capability) {
				throw new Error(`No container discovery capability mapped for provider "${pmProvider}"`);
			}
			return (await trpcClient.pm.discovery.discover.mutate({
				providerId: pmProvider,
				capability,
				args: {},
				projectId,
			})) as Array<{ id: string; name: string }>;
		},
	});

	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				<select
					id="sentry-results-container"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
				>
					<option value="">
						{containersMutation.isPending
							? 'Loading...'
							: containersMutation.data
								? '— Select a list —'
								: '— Click Fetch to load lists —'}
					</option>
					{containersMutation.data?.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</select>
				<button
					type="button"
					onClick={() => containersMutation.mutate()}
					disabled={containersMutation.isPending || !capability}
					title={!capability ? `No list-fetch support for provider "${pmProvider}"` : undefined}
					className="inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
				>
					{containersMutation.isPending ? 'Loading...' : 'Fetch Lists'}
				</button>
			</div>
			{containersMutation.isError && (
				<p className="text-xs text-destructive">{containersMutation.error.message}</p>
			)}
			<p className="text-xs text-muted-foreground">
				Or enter the ID manually:{' '}
				<input
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="container-id"
					className="ml-1 inline-block h-6 rounded border border-input bg-background px-2 text-xs"
				/>
			</p>
		</div>
	);
}

// ============================================================================
// Alerting Tab (Sentry)
// ============================================================================

interface AlertingTabProps {
	projectId: string;
	alertingIntegration?: Record<string, unknown>;
	/** PM provider slug (e.g. "trello", "jira", "linear") when a PM integration is configured. */
	pmProvider?: string;
}

export function AlertingTab({ projectId, alertingIntegration, pmProvider }: AlertingTabProps) {
	const queryClient = useQueryClient();

	const existingConfig = (alertingIntegration?.config as Record<string, unknown>) ?? {};
	const [organizationSlug, setOrganizationSlug] = useState(
		(existingConfig.organizationSlug as string) ?? '',
	);
	const [resultsContainerId, setResultsContainerId] = useState(
		(existingConfig.resultsContainerId as string) ?? '',
	);

	const [verifyResult, setVerifyResult] = useState<{
		id: string;
		name: string;
		slug: string;
	} | null>(null);
	const [verifyError, setVerifyError] = useState<string | null>(null);
	const [isVerifying, setIsVerifying] = useState(false);

	const callbackBaseUrl =
		API_URL ||
		(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

	const sentryWebhookUrl = callbackBaseUrl
		? `${callbackBaseUrl}/sentry/webhook/${projectId}`
		: `<YOUR_BASE_URL>/sentry/webhook/${projectId}`;

	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));
	const credentials = credentialsQuery.data ?? [];
	const apiTokenCred = credentials.find((c) => c.envVarKey === 'SENTRY_API_TOKEN');
	const webhookSecretCred = credentials.find((c) => c.envVarKey === 'SENTRY_WEBHOOK_SECRET');

	const handleVerify = async (rawToken: string) => {
		if (!rawToken) {
			setVerifyError('Enter the API token value to verify it');
			return;
		}
		if (!organizationSlug) {
			setVerifyError('Enter the organization slug to verify it');
			return;
		}
		setIsVerifying(true);
		setVerifyError(null);
		setVerifyResult(null);
		try {
			const result = await trpcClient.integrationsDiscovery.verifySentry.mutate({
				apiToken: rawToken,
				organizationSlug,
			});
			setVerifyResult(result);
		} catch (err) {
			setVerifyError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsVerifying(false);
		}
	};

	const saveMutation = useMutation({
		mutationFn: async () => {
			return trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'alerting',
				provider: 'sentry',
				config: {
					organizationSlug,
					...(resultsContainerId ? { resultsContainerId } : {}),
				},
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			return trpcClient.projects.integrations.delete.mutate({
				projectId,
				category: 'alerting',
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return (
		<div className="space-y-6">
			{/* Agent enablement info box */}
			<div className="flex gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
				<Info className="mt-0.5 h-4 w-4 shrink-0" />
				<div>
					<span className="font-medium">Enable the Alerting Agent</span> — After saving this
					integration, go to the <span className="font-medium">Agents</span> tab and enable the{' '}
					<span className="font-mono text-xs">alerting</span> agent type so Sentry alerts trigger
					investigation runs automatically.
				</div>
			</div>

			{/* Organization Slug */}
			<div className="space-y-2">
				<Label htmlFor="sentry-org-slug">Organization Slug</Label>
				<p className="text-xs text-muted-foreground">
					Your Sentry organization slug (found in your Sentry URL:{' '}
					<code>sentry.io/organizations/&lt;slug&gt;/</code>).
				</p>
				<Input
					id="sentry-org-slug"
					value={organizationSlug}
					onChange={(e) => setOrganizationSlug(e.target.value)}
					placeholder="my-organization"
				/>
			</div>

			<hr className="border-border" />

			{/* Investigation Results List */}
			<div className="space-y-2">
				<Label htmlFor="sentry-results-container">Investigation Results List</Label>
				<p className="text-xs text-muted-foreground">
					The PM list or status where the alerting agent creates investigation work items. Used as
					the target container when the agent creates bug fix cards.
				</p>
				{pmProvider ? (
					<PMContainerPicker
						projectId={projectId}
						pmProvider={pmProvider}
						value={resultsContainerId}
						onChange={setResultsContainerId}
					/>
				) : (
					<Input
						id="sentry-results-container"
						value={resultsContainerId}
						onChange={(e) => setResultsContainerId(e.target.value)}
						placeholder="List ID or status name (configure PM integration to use a picker)"
					/>
				)}
			</div>

			<hr className="border-border" />

			{/* Credentials */}
			<div className="space-y-4">
				<Label className="text-sm font-medium">Credentials</Label>
				<ProjectSecretField
					projectId={projectId}
					envVarKey="SENTRY_API_TOKEN"
					label="API Token"
					description="Sentry API token with org:read scope. Used to verify the integration and read issue details."
					placeholder="sntrys_..."
					credential={apiTokenCred}
					onVerify={handleVerify}
					isVerifying={isVerifying}
					verifyError={verifyError}
					verifiedLogin={verifyResult ? `${verifyResult.name} (${verifyResult.slug})` : null}
				/>
				<ProjectSecretField
					projectId={projectId}
					envVarKey="SENTRY_WEBHOOK_SECRET"
					label="Webhook Secret (optional)"
					description="Secret for verifying Sentry webhook payloads. Set the same value in your Sentry webhook configuration."
					placeholder="whsec_..."
					credential={webhookSecretCred}
				/>
			</div>

			<hr className="border-border" />

			{/* Sentry Webhook URL */}
			<div className="space-y-2">
				<Label>Sentry Webhook URL</Label>
				<p className="text-xs text-muted-foreground">
					Configure this URL in your Sentry project's webhook settings to receive alerts.
				</p>
				<div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
					<code className="flex-1 text-xs font-mono break-all">{sentryWebhookUrl}</code>
					<CopyButton text={sentryWebhookUrl} />
				</div>
			</div>

			<hr className="border-border" />

			{/* Save / Delete */}
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{saveMutation.isPending ? 'Saving...' : 'Save Integration'}
				</button>
				{saveMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{saveMutation.error.message}</span>
				)}
				{alertingIntegration && (
					<button
						type="button"
						onClick={() => deleteMutation.mutate()}
						disabled={deleteMutation.isPending}
						className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
					>
						<Trash2 className="h-4 w-4" />
						{deleteMutation.isPending ? 'Deleting...' : 'Delete Integration'}
					</button>
				)}
				{deleteMutation.isError && (
					<span className="text-sm text-destructive">{deleteMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}
