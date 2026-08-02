/**
 * Project-side picker for which named org credential set(s) this project uses
 * for one provider. Single-select for github/gitlab/openai/openrouter; the
 * Anthropic provider is an ORDERED POOL editor (add/up/down/remove; position 0
 * is the primary) — the router rotates between pool entries by usage at
 * dispatch time.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.js';
import { Label } from '@/components/ui/label.js';
import { NativeSelect } from '@/components/ui/native-select.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

interface AvailableSet {
	id: number;
	name: string;
	isDefault: boolean;
	configuredKeys: string[];
}

export function ProjectCredentialSelector({
	projectId,
	provider,
	label,
}: {
	projectId: string;
	provider: string;
	/** Section label, e.g. "Anthropic credentials". */
	label: string;
}) {
	const queryClient = useQueryClient();
	const selectionsQuery = useQuery(
		trpc.projects.credentialSelections.list.queryOptions({ projectId }),
	);
	const availableQuery = useQuery(
		trpc.projects.credentialSelections.availableSets.queryOptions({ projectId }),
	);

	const providerSelections = selectionsQuery.data?.find((p) => p.provider === provider);
	const providerAvailable = availableQuery.data?.find((p) => p.provider === provider);
	const multiSelect = providerAvailable?.multiSelect ?? false;
	const availableSets: AvailableSet[] = providerAvailable?.sets ?? [];
	const selections = providerSelections?.selections ?? [];

	const [error, setError] = useState<string | null>(null);

	const setMutation = useMutation({
		mutationFn: (setIds: number[]) =>
			trpcClient.projects.credentialSelections.set.mutate({ projectId, provider, setIds }),
		onSuccess: () => {
			setError(null);
			queryClient.invalidateQueries({
				queryKey: trpc.projects.credentialSelections.list.queryOptions({ projectId }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.claudeCodeLimits.forProject.queryOptions({ projectId }).queryKey,
			});
		},
		onError: (err) => setError(err instanceof Error ? err.message : String(err)),
	});

	// No org sets exist for this provider — nothing to pick.
	if (availableSets.length === 0) return null;

	const selectedIds = selections.map((s) => s.setId);
	const unselected = availableSets.filter((s) => !selectedIds.includes(s.id));
	const defaultSet = availableSets.find((s) => s.isDefault);

	if (!multiSelect) {
		return (
			<div className="space-y-1.5">
				<Label className="text-sm">{label}</Label>
				<p className="text-xs text-muted-foreground">
					Which organization credential entry this project uses. Project overrides below always win.
				</p>
				<NativeSelect
					value={selections[0]?.setId != null ? String(selections[0].setId) : ''}
					onChange={(e) => {
						const value = e.target.value;
						setMutation.mutate(value === '' ? [] : [Number(value)]);
					}}
					disabled={setMutation.isPending}
					className="max-w-72"
				>
					<option value="">
						{defaultSet ? `Organization default (${defaultSet.name})` : 'Organization default'}
					</option>
					{availableSets.map((set) => (
						<option key={set.id} value={String(set.id)}>
							{set.name}
							{set.isDefault ? ' (default)' : ''}
						</option>
					))}
				</NativeSelect>
				{error && <p className="text-xs text-destructive">{error}</p>}
			</div>
		);
	}

	// Ordered pool editor (Anthropic).
	const move = (index: number, delta: number) => {
		const next = [...selectedIds];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		setMutation.mutate(next);
	};

	return (
		<div className="space-y-2">
			<Label className="text-sm">{label}</Label>
			<p className="text-xs text-muted-foreground">
				Credential pool for rotation: each run picks the least-utilized entry (per the run's model).
				When every entry is at the utilization threshold, runs suspend and auto-resume when a
				rate-limit window resets. Empty pool = organization default
				{defaultSet ? ` (${defaultSet.name})` : ''}.
			</p>
			{selections.map((selection, index) => (
				<div
					key={selection.setId}
					className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
				>
					<span className="font-medium">{selection.setName}</span>
					{index === 0 && (
						<Badge variant="secondary" className="text-xs">
							primary
						</Badge>
					)}
					<div className="flex-1" />
					<button
						type="button"
						onClick={() => move(index, -1)}
						disabled={index === 0 || setMutation.isPending}
						className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
						title="Move up"
					>
						<ArrowUp className="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={() => move(index, 1)}
						disabled={index === selections.length - 1 || setMutation.isPending}
						className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
						title="Move down"
					>
						<ArrowDown className="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={() => setMutation.mutate(selectedIds.filter((id) => id !== selection.setId))}
						disabled={setMutation.isPending}
						className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
						title="Remove from pool"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			))}
			{unselected.length > 0 && (
				<div className="flex items-center gap-2">
					<NativeSelect
						value=""
						onChange={(e) => {
							const value = e.target.value;
							if (value === '') return;
							setMutation.mutate([...selectedIds, Number(value)]);
						}}
						disabled={setMutation.isPending}
						className="max-w-72"
					>
						<option value="">Add entry to pool…</option>
						{unselected.map((set) => (
							<option key={set.id} value={String(set.id)}>
								{set.name}
								{set.isDefault ? ' (default)' : ''}
							</option>
						))}
					</NativeSelect>
					{setMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
				</div>
			)}
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}
