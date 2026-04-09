import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc.js';

function formatNumber(n: number): string {
	return n.toLocaleString();
}

function formatResetDate(resetsAt: string): string {
	if (!resetsAt) return '';
	try {
		const date = new Date(resetsAt);
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	} catch {
		return resetsAt;
	}
}

/**
 * Displays Claude Code subscription limits for all unique tokens configured
 * across org projects. Shown only to superadmins; auto-hides when no data.
 */
export function ClaudeCodeLimitsSection() {
	const { data } = useQuery({
		...trpc.claudeCodeLimits.query.queryOptions(),
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	// Hide if no data returned (no tokens configured or API unavailable)
	if (!data || data.length === 0) {
		return null;
	}

	return (
		<div className="mt-1">
			<div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				Limits
			</div>
			<div className="flex flex-col gap-2 px-3 py-1">
				{data.map((limits, i) => {
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: tokenMasked is not guaranteed unique (tokens may share trailing 4 chars); index is safe here as list order is server-determined and stable
						<div key={i} className="rounded-md bg-sidebar-accent/30 p-2 text-xs">
							<div className="font-medium text-sidebar-foreground truncate mb-1">
								{limits.tokenMasked}
							</div>
							<div className="text-muted-foreground mb-0.5 capitalize">{limits.plan}</div>
							{limits.messagesLimit > 0 && (
								<div className="text-muted-foreground">
									Msgs: {formatNumber(limits.messagesUsed)} / {formatNumber(limits.messagesLimit)}
								</div>
							)}
							{limits.tokensLimit > 0 && (
								<div className="text-muted-foreground">
									Tokens: {formatNumber(limits.tokensUsed)} / {formatNumber(limits.tokensLimit)}
								</div>
							)}
							{limits.resetsAt && (
								<div className="text-muted-foreground">
									Resets {formatResetDate(limits.resetsAt)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
