/**
 * Secret input for one env var key inside a named org credential set.
 * Write-only — shows masked metadata when configured, never exposes plaintext.
 * Sibling of OrgSecretField, targeting organization.credentialSets.setKey /
 * deleteKey instead of the flat-tier endpoints.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

export function OrgSetSecretField({
	setId,
	envVarKey,
	label,
	description,
	placeholder,
	maskedValue,
}: {
	setId: number;
	envVarKey: string;
	label: string;
	description?: string;
	placeholder?: string;
	/** Present when the key is configured on this set. */
	maskedValue?: string;
}) {
	const [value, setValue] = useState('');
	const [savedFeedback, setSavedFeedback] = useState(false);
	const queryClient = useQueryClient();

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.organization.credentialSets.list.queryOptions().queryKey,
		});
		queryClient.invalidateQueries({
			queryKey: trpc.claudeCodeLimits.forOrg.queryOptions().queryKey,
		});
	};

	const saveMutation = useMutation({
		mutationFn: () =>
			trpcClient.organization.credentialSets.setKey.mutate({ setId, envVarKey, value }),
		onSuccess: () => {
			setValue('');
			setSavedFeedback(true);
			setTimeout(() => setSavedFeedback(false), 3000);
			invalidate();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => trpcClient.organization.credentialSets.deleteKey.mutate({ setId, envVarKey }),
		onSuccess: invalidate,
	});

	const inputId = `org-set-secret-${setId}-${envVarKey}`;
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Label htmlFor={inputId}>{label}</Label>
				{maskedValue ? (
					<Badge variant="secondary" className="text-xs font-mono">
						{maskedValue}
					</Badge>
				) : (
					<Badge variant="outline" className="text-xs text-muted-foreground border-dashed">
						not configured
					</Badge>
				)}
			</div>
			{description && <p className="text-xs text-muted-foreground">{description}</p>}
			<div className="flex gap-2">
				<Input
					id={inputId}
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={maskedValue ? 'Enter new value to update...' : placeholder}
					autoComplete="off"
					className="flex-1"
				/>
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={!value || saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
				>
					{saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
				</button>
				{maskedValue && (
					<button
						type="button"
						onClick={() => deleteMutation.mutate()}
						disabled={deleteMutation.isPending}
						className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50 shrink-0"
						title="Delete this value"
					>
						{deleteMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Trash2 className="h-4 w-4" />
						)}
					</button>
				)}
			</div>
			{saveMutation.isError && (
				<p className="text-xs text-destructive">{saveMutation.error.message}</p>
			)}
			{deleteMutation.isError && (
				<p className="text-xs text-destructive">{deleteMutation.error.message}</p>
			)}
			{savedFeedback && (
				<div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
					<CheckCircle className="h-3.5 w-3.5" />
					Saved
				</div>
			)}
		</div>
	);
}
