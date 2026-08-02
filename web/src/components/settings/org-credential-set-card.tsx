/**
 * One named credential set on an org provider tab: header (inline rename,
 * default badge/toggle, usage count, delete with in-use confirmation) plus a
 * secret field per provider env var key, and an optional usage card
 * (Anthropic sets).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { OrgCredentialCatalogEntry } from '@/components/settings/org-credential-catalog.js';
import { OrgSetSecretField } from '@/components/settings/org-set-secret-field.js';
import { ClaudeUsageCard, type ClaudeUsageSource } from '@/components/shared/claude-usage-card.js';
import { Badge } from '@/components/ui/badge.js';
import { Input } from '@/components/ui/input.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

export interface OrgCredentialSetView {
	id: number;
	provider: string;
	name: string;
	isDefault: boolean;
	keys: { envVarKey: string; isConfigured: boolean; maskedValue: string }[];
	usage: { projectId: string; projectName: string }[];
}

export function OrgCredentialSetCard({
	set,
	keyMeta,
	usageSource,
}: {
	set: OrgCredentialSetView;
	keyMeta: OrgCredentialCatalogEntry[];
	/** Claude usage attribution for this set (Anthropic tabs only). */
	usageSource?: ClaudeUsageSource;
}) {
	const queryClient = useQueryClient();
	const [renaming, setRenaming] = useState(false);
	const [nameDraft, setNameDraft] = useState(set.name);
	const [blockedBy, setBlockedBy] = useState<{ projectId: string; projectName: string }[] | null>(
		null,
	);

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.organization.credentialSets.list.queryOptions().queryKey,
		});
		queryClient.invalidateQueries({
			queryKey: trpc.claudeCodeLimits.forOrg.queryOptions().queryKey,
		});
	};

	const renameMutation = useMutation({
		mutationFn: () =>
			trpcClient.organization.credentialSets.rename.mutate({ setId: set.id, name: nameDraft }),
		onSuccess: () => {
			setRenaming(false);
			invalidate();
		},
	});

	const setDefaultMutation = useMutation({
		mutationFn: () => trpcClient.organization.credentialSets.setDefault.mutate({ setId: set.id }),
		onSuccess: invalidate,
	});

	const deleteMutation = useMutation({
		mutationFn: (force: boolean) =>
			trpcClient.organization.credentialSets.delete.mutate({ setId: set.id, force }),
		onSuccess: (result) => {
			if (result.deleted) {
				setBlockedBy(null);
				invalidate();
			} else {
				setBlockedBy(result.blockedBy);
			}
		},
	});

	const maskedByKey = new Map(set.keys.map((k) => [k.envVarKey, k.maskedValue]));

	return (
		<div className="rounded-lg border border-border p-4 space-y-4">
			<div className="flex items-center gap-2">
				{renaming ? (
					<>
						<Input
							value={nameDraft}
							onChange={(e) => setNameDraft(e.target.value)}
							className="h-8 max-w-56"
							autoFocus
						/>
						<button
							type="button"
							onClick={() => renameMutation.mutate()}
							disabled={!nameDraft.trim() || renameMutation.isPending}
							className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
							title="Save name"
						>
							{renameMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Check className="h-4 w-4" />
							)}
						</button>
						<button
							type="button"
							onClick={() => {
								setRenaming(false);
								setNameDraft(set.name);
							}}
							className="p-1.5 text-muted-foreground hover:text-foreground"
							title="Cancel rename"
						>
							<X className="h-4 w-4" />
						</button>
					</>
				) : (
					<>
						<span className="font-medium">{set.name}</span>
						<button
							type="button"
							onClick={() => setRenaming(true)}
							className="p-1 text-muted-foreground hover:text-foreground"
							title="Rename"
						>
							<Pencil className="h-3.5 w-3.5" />
						</button>
					</>
				)}
				{set.isDefault ? (
					<Badge variant="secondary" className="text-xs">
						default
					</Badge>
				) : (
					<button
						type="button"
						onClick={() => setDefaultMutation.mutate()}
						disabled={setDefaultMutation.isPending}
						className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-50"
					>
						make default
					</button>
				)}
				{set.usage.length > 0 && (
					<Badge
						variant="outline"
						className="text-xs"
						title={set.usage.map((u) => u.projectName).join(', ')}
					>
						used by {set.usage.length} project{set.usage.length === 1 ? '' : 's'}
					</Badge>
				)}
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => deleteMutation.mutate(false)}
					disabled={deleteMutation.isPending}
					className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
					title="Delete entry"
				>
					{deleteMutation.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Trash2 className="h-4 w-4" />
					)}
				</button>
			</div>

			{blockedBy && (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-2">
					<p>
						In use by {blockedBy.map((p) => p.projectName).join(', ')}. Deleting removes it from
						those projects (they fall back to the default entry).
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => deleteMutation.mutate(true)}
							className="text-destructive font-medium hover:underline"
						>
							Delete anyway
						</button>
						<button
							type="button"
							onClick={() => setBlockedBy(null)}
							className="text-muted-foreground hover:underline"
						>
							Keep
						</button>
					</div>
				</div>
			)}

			{renameMutation.isError && (
				<p className="text-xs text-destructive">{renameMutation.error.message}</p>
			)}
			{deleteMutation.isError && (
				<p className="text-xs text-destructive">{deleteMutation.error.message}</p>
			)}

			{keyMeta.map((entry) => (
				<OrgSetSecretField
					key={entry.envVarKey}
					setId={set.id}
					envVarKey={entry.envVarKey}
					label={entry.label}
					description={entry.description}
					placeholder={entry.placeholder}
					maskedValue={maskedByKey.get(entry.envVarKey)}
				/>
			))}

			{usageSource && <ClaudeUsageCard source={usageSource} />}
		</div>
	);
}
