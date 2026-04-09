import { execFileSync } from 'node:child_process';

import { Command } from '@oclif/core';
// Bootstrap integrations so PM/SCM registries are populated before commands run.
// This is a no-op if already bootstrapped (idempotent guards inside).
import '../integrations/bootstrap.js';
import { withGitHubToken } from '../github/client.js';
import { withGitLabToken } from '../gitlab/client.js';
import { withJiraCredentials } from '../jira/client.js';
import { createPMProvider, withPMProvider } from '../pm/index.js';
import { withTrelloCredentials } from '../trello/client.js';
import type { ProjectConfig } from '../types/index.js';

/**
 * Detect the active SCM provider based on environment variables.
 * Checks CASCADE_SCM_PROVIDER (explicit, set by router) first,
 * then falls back to credential inference.
 */
export function detectSCMProvider(): 'github' | 'gitlab' {
	const explicit = process.env.CASCADE_SCM_PROVIDER;
	if (explicit === 'gitlab') return 'gitlab';
	if (explicit === 'github') return 'github';
	if (process.env.GITLAB_TOKEN_IMPLEMENTER) return 'gitlab';
	return 'github';
}

/**
 * Resolve repository owner/repo from flags, env vars, or git remote (in that order).
 * Supports both GitHub (owner/repo) and GitLab (group/subgroup/repo) patterns.
 */
export function resolveOwnerRepo(
	flagOwner?: string,
	flagRepo?: string,
): { owner: string; repo: string } {
	if (flagOwner && flagRepo) return { owner: flagOwner, repo: flagRepo };

	const envOwner = process.env.CASCADE_REPO_OWNER;
	const envRepo = process.env.CASCADE_REPO_NAME;
	if (envOwner && envRepo) return { owner: envOwner, repo: envRepo };

	// Fallback: detect from git remote
	const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();

	// Try GitLab pattern first (gitlab.com or custom host)
	const gitlabMatch = url.match(/gitlab[^/]*[/:](.+?)\/([^/]+?)(?:\.git)?$/);
	if (gitlabMatch) return { owner: gitlabMatch[1], repo: gitlabMatch[2] };

	// GitHub pattern
	const match = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
	if (!match) throw new Error(`Cannot detect owner/repo from git remote: ${url}`);
	return { owner: match[1], repo: match[2] };
}

/**
 * Resolve the full project path from git remote for GitLab.
 * GitLab uses path_with_namespace (e.g. "group/subgroup/repo").
 */
export function resolveProjectPath(): string {
	const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();
	// SSH: git@gitlab.com:appsome/bdgt.git → appsome/bdgt
	const sshMatch = url.match(/@[^:]+:(.+?)(?:\.git)?$/);
	if (sshMatch) return sshMatch[1];
	// HTTPS: https://oauth2:token@gitlab.com/appsome/bdgt.git → appsome/bdgt
	// Match path after the host (after ://...host/)
	const httpsMatch = url.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
	if (httpsMatch) return httpsMatch[1];
	throw new Error(`Cannot detect project path from git remote: ${url}`);
}

export abstract class CredentialScopedCommand extends Command {
	/** Subclasses implement this instead of run() */
	abstract execute(): Promise<void>;

	async run(): Promise<void> {
		const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN_IMPLEMENTER;
		const gitlabToken = process.env.GITLAB_TOKEN_IMPLEMENTER;
		const trelloApiKey = process.env.TRELLO_API_KEY;
		const trelloToken = process.env.TRELLO_TOKEN;
		const jiraEmail = process.env.JIRA_EMAIL;
		const jiraApiToken = process.env.JIRA_API_TOKEN;
		const jiraBaseUrl = process.env.JIRA_BASE_URL;

		let fn: () => Promise<void> = () => this.execute();

		if (gitlabToken) {
			const prev = fn;
			const host = process.env.GITLAB_HOST ?? 'https://gitlab.com';
			fn = () => withGitLabToken(gitlabToken, prev, host);
		}
		if (githubToken) {
			const prev = fn;
			fn = () => withGitHubToken(githubToken, prev);
		}
		if (trelloApiKey && trelloToken) {
			const prev = fn;
			fn = () => withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, prev);
		}
		if (jiraEmail && jiraApiToken && jiraBaseUrl) {
			const prev = fn;
			fn = () =>
				withJiraCredentials(
					{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
					prev,
				);
		}

		// Establish PM provider scope — prefer explicit env var, fall back to credential inference
		const explicitPmType = process.env.CASCADE_PM_TYPE as 'trello' | 'jira' | undefined;
		const pmType = explicitPmType ?? (jiraEmail && jiraApiToken && jiraBaseUrl ? 'jira' : 'trello');
		const jiraProjectKey = process.env.CASCADE_JIRA_PROJECT_KEY;
		const jiraStatuses = process.env.CASCADE_JIRA_STATUSES;

		const pmProject = {
			pm: { type: pmType },
			...(pmType === 'jira' && {
				jira: {
					projectKey: jiraProjectKey ?? '',
					baseUrl: jiraBaseUrl as string,
					statuses: jiraStatuses ? JSON.parse(jiraStatuses) : {},
				},
			}),
		} as ProjectConfig;
		const pmProvider = createPMProvider(pmProject);
		const prev = fn;
		fn = () => withPMProvider(pmProvider, prev);

		await fn();
	}
}
