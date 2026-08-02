/**
 * Named credential set list for one provider tab on the org credentials page:
 * a card per set plus an "Add entry" name input.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { OrgCredentialCatalogEntry } from '@/components/settings/org-credential-catalog.js';
import {
	OrgCredentialSetCard,
	type OrgCredentialSetView,
} from '@/components/settings/org-credential-set-card.js';
import type { ClaudeUsageSource } from '@/components/shared/claude-usage-card.js';
import { Input } from '@/components/ui/input.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

export function OrgCredentialSetList({
	provider,
	providerLabel,
	sets,
	keyMeta,
	usageBySetId,
}: {
	provider: string;
	providerLabel: string;
	sets: OrgCredentialSetView[];
	keyMeta: OrgCredentialCatalogEntry[];
	/** Claude usage sources keyed by setId (Anthropic tab only). */
	usageBySetId?: Map<number, ClaudeUsageSource>;
}) {
	const [newName, setNewName] = useState('');
	const queryClient = useQueryClient();

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.organization.credentialSets.create.mutate({
				provider: provider as never,
				name: newName.trim(),
			}),
		onSuccess: () => {
			setNewName('');
			queryClient.invalidateQueries({
				queryKey: trpc.organization.credentialSets.list.queryOptions().queryKey,
			});
		},
	});

	return (
		<div className="space-y-4">
			{sets.length === 0 && (
				<p className="text-sm text-muted-foreground">
					No {providerLabel} credentials yet. Add a named entry (e.g. “personal”, “work”) to get
					started.
				</p>
			)}
			{sets.map((set) => (
				<OrgCredentialSetCard
					key={set.id}
					set={set}
					keyMeta={keyMeta}
					usageSource={usageBySetId?.get(set.id)}
				/>
			))}
			<div className="flex gap-2">
				<Input
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
					placeholder='Entry name (e.g. "personal", "work")'
					className="flex-1"
				/>
				<button
					type="button"
					onClick={() => createMutation.mutate()}
					disabled={!newName.trim() || createMutation.isPending}
					className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50 shrink-0"
				>
					{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add entry'}
				</button>
			</div>
			{createMutation.isError && (
				<p className="text-xs text-destructive">{createMutation.error.message}</p>
			)}
		</div>
	);
}
