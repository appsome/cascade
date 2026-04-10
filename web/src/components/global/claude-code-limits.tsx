import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc.js';

function formatResetDate(resetsAt: string): string {
	if (!resetsAt) return '';
	try {
		const date = new Date(resetsAt);
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	} catch {
		return resetsAt;
	}
}

function utilizationColor(pct: number): string {
	if (pct >= 90) return 'bg-red-500';
	if (pct >= 70) return 'bg-yellow-500';
	return 'bg-emerald-500';
}

/**
 * Displays Claude Code subscription usage for all unique tokens configured
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
				Usage
			</div>
			<div className="flex flex-col gap-2 px-3 py-1">
				{data.map((limits, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: tokenMasked is not guaranteed unique (tokens may share trailing 4 chars); index is safe here as list order is server-determined and stable
					<div key={i} className="rounded-md bg-sidebar-accent/30 p-2 text-xs">
						<div className="font-medium text-sidebar-foreground truncate mb-1.5">
							{limits.tokenMasked}
						</div>
						{limits.buckets.length === 0 && (
							<div className="text-muted-foreground">No usage data</div>
						)}
						{limits.buckets.map((bucket) => (
							<div key={bucket.label} className="mb-1.5 last:mb-0">
								<div className="flex items-center justify-between text-muted-foreground mb-0.5">
									<span>{bucket.label}</span>
									<span>{bucket.utilization}%</span>
								</div>
								<div className="h-1.5 w-full rounded-full bg-sidebar-accent">
									<div
										className={`h-full rounded-full transition-all ${utilizationColor(bucket.utilization)}`}
										style={{ width: `${Math.min(bucket.utilization, 100)}%` }}
									/>
								</div>
								<div className="text-[10px] text-muted-foreground/70 mt-0.5">
									Resets {formatResetDate(bucket.resetsAt)}
								</div>
							</div>
						))}
						{limits.extraUsage?.isEnabled && (
							<div className="mt-1 pt-1 border-t border-sidebar-accent text-muted-foreground">
								Extra usage enabled
								{limits.extraUsage.usedCredits != null && limits.extraUsage.monthlyLimit != null && (
									<span>
										{' '}&mdash; ${limits.extraUsage.usedCredits.toFixed(2)} / ${limits.extraUsage.monthlyLimit.toFixed(2)}
									</span>
								)}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
