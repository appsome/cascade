/**
 * Organization credentials page. Credentials set here are inherited by every
 * project in the organization; a project-level credential with the same env
 * var key overrides the org value for that project.
 */

import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { buildOrgCredentialCatalog } from '@/components/settings/org-credential-catalog.js';
import { OrgSecretField } from '@/components/settings/org-secret-field.js';
import { ClaudeUsageCard } from '@/components/shared/claude-usage-card.js';
import { Input } from '@/components/ui/input.js';
import { trpc } from '@/lib/trpc.js';
import { rootRoute } from '../__root.js';

/**
 * Claude Code subscription usage for every token source in the org: the
 * shared org credential, per-project overrides, and the server env token.
 * Hidden entirely when no source is configured.
 */
function ClaudeCodeUsageSection() {
	const limitsQuery = useQuery({
		...trpc.claudeCodeLimits.forOrg.queryOptions(),
		staleTime: 5 * 60 * 1000,
		retry: false,
	});

	const sources = limitsQuery.data ?? [];
	if (limitsQuery.isError || sources.length === 0) return null;

	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-lg font-semibold">Claude Code Usage</h2>
				<p className="text-sm text-muted-foreground">
					Subscription limits for each configured Claude Code OAuth token.
				</p>
			</div>
			<div className="space-y-3">
				{sources.map((source) => (
					<ClaudeUsageCard
						key={`${source.scope}-${source.projectId ?? 'shared'}`}
						source={source}
					/>
				))}
			</div>
		</section>
	);
}

const ENV_VAR_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function CustomCredentialSection({
	credentials,
	knownKeys,
}: {
	credentials: {
		envVarKey: string;
		name: string | null;
		isConfigured: boolean;
		maskedValue: string;
	}[];
	knownKeys: Set<string>;
}) {
	const [newKey, setNewKey] = useState('');
	const customCredentials = credentials.filter((c) => !knownKeys.has(c.envVarKey));
	const [pendingKeys, setPendingKeys] = useState<string[]>([]);

	const visiblePending = pendingKeys.filter(
		(key) => !customCredentials.some((c) => c.envVarKey === key),
	);
	const keyValid = ENV_VAR_KEY_PATTERN.test(newKey);

	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-lg font-semibold">Custom</h2>
				<p className="text-sm text-muted-foreground">
					Any other environment variable to share with every project in this organization.
				</p>
			</div>
			{customCredentials.map((credential) => (
				<OrgSecretField
					key={credential.envVarKey}
					envVarKey={credential.envVarKey}
					label={credential.name ?? credential.envVarKey}
					credential={credential}
				/>
			))}
			{visiblePending.map((key) => (
				<OrgSecretField key={key} envVarKey={key} label={key} />
			))}
			<div className="flex gap-2">
				<Input
					value={newKey}
					onChange={(e) => setNewKey(e.target.value.toUpperCase())}
					placeholder="ENV_VAR_NAME"
					className="flex-1 font-mono"
				/>
				<button
					type="button"
					onClick={() => {
						setPendingKeys((keys) => (keys.includes(newKey) ? keys : [...keys, newKey]));
						setNewKey('');
					}}
					disabled={!keyValid}
					className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50 shrink-0"
				>
					Add key
				</button>
			</div>
			{newKey && !keyValid && (
				<p className="text-xs text-destructive">
					Key must be UPPER_SNAKE_CASE (letters, digits, underscores; not starting with a digit).
				</p>
			)}
		</section>
	);
}

function OrgCredentialsPage() {
	const credentialsQuery = useQuery(trpc.organization.credentials.list.queryOptions());
	const { sections, knownKeys } = useMemo(buildOrgCredentialCatalog, []);
	const credentials = credentialsQuery.data ?? [];
	const byKey = new Map(credentials.map((c) => [c.envVarKey, c]));

	return (
		<div className="space-y-8 max-w-2xl">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Organization Credentials</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Shared by every project in this organization. A credential set on a project with the same
					key overrides the organization value for that project.
				</p>
			</div>

			{credentialsQuery.isError && (
				<p className="text-sm text-destructive">
					{credentialsQuery.error.message.includes('FORBIDDEN') ||
					credentialsQuery.error.message.includes('Admin')
						? 'Organization admin access is required to manage shared credentials.'
						: credentialsQuery.error.message}
				</p>
			)}

			{!credentialsQuery.isError &&
				sections.map((section) => (
					<section key={section.title} className="space-y-4">
						<h2 className="text-lg font-semibold">{section.title}</h2>
						{section.entries.map((entry) => (
							<OrgSecretField
								key={entry.envVarKey}
								envVarKey={entry.envVarKey}
								label={entry.label}
								description={entry.description}
								placeholder={entry.placeholder}
								credential={byKey.get(entry.envVarKey)}
							/>
						))}
					</section>
				))}

			{!credentialsQuery.isError && (
				<CustomCredentialSection credentials={credentials} knownKeys={knownKeys} />
			)}

			{!credentialsQuery.isError && <ClaudeCodeUsageSection />}
		</div>
	);
}

export const settingsCredentialsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/credentials',
	component: OrgCredentialsPage,
});
