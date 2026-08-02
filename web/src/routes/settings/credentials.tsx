/**
 * Organization credentials page. Credentials set here are inherited by every
 * project in the organization; a project-level credential with the same env
 * var key overrides the org value for that project.
 *
 * Engine + SCM providers (Anthropic, OpenAI/Codex, OpenRouter, GitHub, GitLab)
 * support MULTIPLE named credential sets — one tab per provider. PM and
 * alerting providers stay single-value on the flat tier.
 */

import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
	buildOrgCredentialCatalog,
	type OrgCredentialCatalogSection,
} from '@/components/settings/org-credential-catalog.js';
import { OrgCredentialSetList } from '@/components/settings/org-credential-set-list.js';
import { OrgSecretField } from '@/components/settings/org-secret-field.js';
import { ClaudeUsageCard, type ClaudeUsageSource } from '@/components/shared/claude-usage-card.js';
import { Input } from '@/components/ui/input.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { trpc } from '@/lib/trpc.js';
import { rootRoute } from '../__root.js';

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
			<p className="text-sm text-muted-foreground">
				Any other environment variable to share with every project in this organization.
			</p>
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

function FlatSection({
	section,
	byKey,
}: {
	section: OrgCredentialCatalogSection;
	byKey: Map<
		string,
		{ envVarKey: string; name: string | null; isConfigured: boolean; maskedValue: string }
	>;
}) {
	return (
		<section className="space-y-4">
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
	);
}

/** Project-level Claude Code token overrides — shown under the Anthropic tab. */
function ProjectOverrideUsageSection({ sources }: { sources: ClaudeUsageSource[] }) {
	if (sources.length === 0) return null;
	return (
		<section className="space-y-3">
			<div>
				<h3 className="text-sm font-semibold">Project overrides</h3>
				<p className="text-xs text-muted-foreground">
					Projects with their own Claude Code OAuth token (overrides every org entry).
				</p>
			</div>
			{sources.map((source) => (
				<ClaudeUsageCard key={`project-${source.projectId}`} source={source} />
			))}
		</section>
	);
}

function OrgCredentialsPage() {
	const credentialsQuery = useQuery(trpc.organization.credentials.list.queryOptions());
	const setsQuery = useQuery(trpc.organization.credentialSets.list.queryOptions());
	const limitsQuery = useQuery({
		...trpc.claudeCodeLimits.forOrg.queryOptions(),
		staleTime: 5 * 60 * 1000,
		retry: false,
	});

	const { providerTabs, pmSection, alertingSection, knownKeys } = useMemo(
		buildOrgCredentialCatalog,
		[],
	);
	const credentials = credentialsQuery.data ?? [];
	const byKey = new Map(credentials.map((c) => [c.envVarKey, c]));
	const sets = setsQuery.data ?? [];

	const limitSources = (limitsQuery.data ?? []) as ClaudeUsageSource[];
	const usageBySetId = new Map(
		limitSources
			.filter((s) => s.scope === 'org' && s.setId != null)
			.map((s) => [s.setId as number, s]),
	);
	const projectOverrideSources = limitSources.filter((s) => s.scope === 'project');

	const isError = credentialsQuery.isError;

	return (
		<div className="space-y-8 max-w-2xl">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Organization Credentials</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Shared by every project in this organization. Engine and source-control providers support
					multiple named entries; projects pick which entry to use in their settings. A credential
					set on a project with the same key overrides the organization value for that project.
				</p>
			</div>

			{isError && (
				<p className="text-sm text-destructive">
					{credentialsQuery.error.message.includes('FORBIDDEN') ||
					credentialsQuery.error.message.includes('Admin')
						? 'Organization admin access is required to manage shared credentials.'
						: credentialsQuery.error.message}
				</p>
			)}

			{!isError && (
				<Tabs defaultValue={providerTabs[0]?.provider.id ?? 'pm'}>
					<TabsList className="flex-wrap">
						{providerTabs.map((tab) => (
							<TabsTrigger key={tab.provider.id} value={tab.provider.id}>
								{tab.provider.label}
							</TabsTrigger>
						))}
						<TabsTrigger value="pm">Project Management</TabsTrigger>
						<TabsTrigger value="alerting">Alerting</TabsTrigger>
						<TabsTrigger value="custom">Custom</TabsTrigger>
					</TabsList>

					{providerTabs.map((tab) => (
						<TabsContent key={tab.provider.id} value={tab.provider.id} className="space-y-6 pt-4">
							<OrgCredentialSetList
								provider={tab.provider.id}
								providerLabel={tab.provider.label}
								sets={sets.filter((s) => s.provider === tab.provider.id)}
								keyMeta={tab.keyMeta}
								usageBySetId={tab.provider.id === 'anthropic' ? usageBySetId : undefined}
							/>
							{tab.provider.id === 'anthropic' && (
								<ProjectOverrideUsageSection sources={projectOverrideSources} />
							)}
						</TabsContent>
					))}

					<TabsContent value="pm" className="pt-4">
						<FlatSection section={pmSection} byKey={byKey} />
					</TabsContent>
					<TabsContent value="alerting" className="pt-4">
						<FlatSection section={alertingSection} byKey={byKey} />
					</TabsContent>
					<TabsContent value="custom" className="pt-4">
						<CustomCredentialSection credentials={credentials} knownKeys={knownKeys} />
					</TabsContent>
				</Tabs>
			)}
		</div>
	);
}

export const settingsCredentialsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings/credentials',
	component: OrgCredentialsPage,
});
