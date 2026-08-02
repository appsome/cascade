import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

interface CloneProjectDialogProps {
	sourceProjectId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CloneProjectDialog({
	sourceProjectId,
	open,
	onOpenChange,
}: CloneProjectDialogProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState('');

	const newId = slugify(name);

	const cloneMutation = useMutation({
		mutationFn: (data: { sourceId: string; newId: string; newName: string }) =>
			trpcClient.projects.clone.mutate(data),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: trpc.projects.listFull.queryOptions().queryKey });
			queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryOptions().queryKey });
			toast.success('Project cloned!');
			onOpenChange(false);
			resetForm();
			navigate({ to: '/projects/$projectId/general', params: { projectId: result.id } });
		},
		onError: (err) => {
			toast.error('Failed to clone project', { description: err.message });
		},
	});

	function resetForm() {
		setName('');
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		cloneMutation.mutate({ sourceId: sourceProjectId, newId, newName: name });
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				onOpenChange(v);
				if (!v) resetForm();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Clone Project</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="clone-project-name">Name</Label>
						<Input
							id="clone-project-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Project Copy"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="clone-project-id">Project ID</Label>
						<Input
							id="clone-project-id"
							value={newId}
							readOnly
							className="bg-muted text-muted-foreground"
						/>
						<p className="text-xs text-muted-foreground">
							Auto-generated from the name. Used as a unique identifier.
						</p>
					</div>
					<p className="text-sm text-muted-foreground">
						All settings, integrations, credentials, agent configs, and trigger configs will be
						copied. The repository field will need to be configured separately after cloning.
					</p>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={cloneMutation.isPending || !newId}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{cloneMutation.isPending ? 'Cloning...' : 'Clone Project'}
						</button>
					</div>
					{cloneMutation.isError && (
						<p className="text-sm text-destructive">{cloneMutation.error.message}</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
