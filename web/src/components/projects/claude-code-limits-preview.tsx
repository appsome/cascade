/**
 * Picker preview for the project engine tab: shows Claude Code subscription
 * usage for each credential candidate this project can use — its own override,
 * the inherited org token, and the server env token — with the active one
 * marked, so the operator can compare limits before choosing which token the
 * project should run on. Renders nothing when no candidate is configured.
 */

import { useQuery } from '@tanstack/react-query';
import { ClaudeUsageCard } from '@/components/shared/claude-usage-card.js';
import { trpc } from '@/lib/trpc.js';

export function ClaudeCodeLimitsPreview({ projectId }: { projectId: string }) {
	const limitsQuery = useQuery({
		...trpc.claudeCodeLimits.forProject.queryOptions({ projectId }),
		staleTime: 5 * 60 * 1000,
		retry: false,
	});

	const sources = limitsQuery.data ?? [];
	if (limitsQuery.isError || sources.length === 0) return null;

	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">
				Subscription usage per available token — the active one is what this project runs on.
			</p>
			{sources.map((source) => (
				<ClaudeUsageCard key={`${source.scope}-${source.projectId ?? 'shared'}`} source={source} />
			))}
		</div>
	);
}
