/**
 * Shared display for Claude Code subscription usage of one credential source.
 * Consumed by the org credentials settings page and the project engine tab
 * picker preview. Pure display — data comes from claudeCodeLimits.* queries.
 */

import { Badge } from '@/components/ui/badge.js';

export interface ClaudeUsageBucket {
	label: string;
	utilization: number;
	resetsAt: string;
}

export interface ClaudeUsageLimits {
	tokenMasked: string;
	buckets: ClaudeUsageBucket[];
	extraUsage: {
		isEnabled: boolean;
		monthlyLimit: number | null;
		usedCredits: number | null;
		utilization: number | null;
	} | null;
}

export interface ClaudeUsageSource {
	scope: 'org' | 'project';
	projectId?: string;
	projectName?: string;
	active?: boolean;
	limits: ClaudeUsageLimits | null;
}

function formatResetDate(resetsAt: string): string {
	if (!resetsAt) return '';
	try {
		const date = new Date(resetsAt);
		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	} catch {
		return resetsAt;
	}
}

function utilizationColor(pct: number): string {
	if (pct >= 90) return 'bg-red-500';
	if (pct >= 70) return 'bg-yellow-500';
	return 'bg-emerald-500';
}

export function sourceLabel(source: ClaudeUsageSource): string {
	if (source.scope === 'org') return 'Organization';
	return source.projectName ? `Project: ${source.projectName}` : 'This project';
}

export function ClaudeUsageCard({ source }: { source: ClaudeUsageSource }) {
	return (
		<div className="rounded-lg border border-border p-3 text-xs space-y-2">
			<div className="flex items-center gap-2">
				<span className="font-medium">{sourceLabel(source)}</span>
				{source.limits && (
					<Badge variant="secondary" className="font-mono text-[10px]">
						{source.limits.tokenMasked}
					</Badge>
				)}
				{source.active && (
					<Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400">
						active
					</Badge>
				)}
			</div>
			{!source.limits && (
				<p className="text-muted-foreground">
					Usage unavailable — token may be invalid or the usage API unreachable.
				</p>
			)}
			{source.limits?.buckets.length === 0 && (
				<p className="text-muted-foreground">No usage data</p>
			)}
			{source.limits?.buckets.map((bucket) => (
				<div key={bucket.label}>
					<div className="flex items-center justify-between text-muted-foreground mb-0.5">
						<span>{bucket.label}</span>
						<span>{bucket.utilization}%</span>
					</div>
					<div className="h-1.5 w-full rounded-full bg-muted">
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
			{source.limits?.extraUsage?.isEnabled && (
				<div className="pt-1 border-t border-border text-muted-foreground">
					Extra usage enabled
					{source.limits.extraUsage.usedCredits != null &&
						source.limits.extraUsage.monthlyLimit != null && (
							<span>
								{' '}
								&mdash; ${source.limits.extraUsage.usedCredits.toFixed(2)} / $
								{source.limits.extraUsage.monthlyLimit.toFixed(2)}
							</span>
						)}
				</div>
			)}
		</div>
	);
}
