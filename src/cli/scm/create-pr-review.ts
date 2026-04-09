import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../backends/secretBuilder.js';
import { createPRReview } from '../../gadgets/github/core/createPRReview.js';
import { createPRReviewDef } from '../../gadgets/github/definitions.js';
import { createMRReview } from '../../gadgets/gitlab/core/createMRReview.js';
import { writeReviewSidecar } from '../../gadgets/session/core/sidecar.js';
import { REVIEW_SIDECAR_ENV_VAR } from '../../gadgets/sessionState.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { githubClient } from '../../github/client.js';
import { gitlabClient } from '../../gitlab/client.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

/**
 * Delete the GitHub ack/progress comment (best-effort).
 * Returns true if the comment was successfully deleted.
 */
async function deleteGitHubAckComment(owner: string, repo: string): Promise<boolean> {
	const ackCommentIdStr = process.env[GITHUB_ACK_COMMENT_ID_ENV_VAR];
	if (!ackCommentIdStr) return false;

	const ackCommentId = Number(ackCommentIdStr);
	if (!Number.isFinite(ackCommentId) || ackCommentId <= 0) return false;

	try {
		await githubClient.deletePRComment(owner, repo, ackCommentId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Delete the GitLab ack/progress note (best-effort).
 * Returns true if the note was successfully deleted.
 */
async function deleteGitLabAckNote(projectPath: string, mrIid: number): Promise<boolean> {
	const ackNoteIdStr = process.env[GITHUB_ACK_COMMENT_ID_ENV_VAR];
	if (!ackNoteIdStr) return false;

	const ackNoteId = Number(ackNoteIdStr);
	if (!Number.isFinite(ackNoteId) || ackNoteId <= 0) return false;

	try {
		await gitlabClient.deleteMRNote(projectPath, mrIid, ackNoteId);
		return true;
	} catch {
		return false;
	}
}

export default createCLICommand(createPRReviewDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		const mrIid = params.prNumber as number;

		const result = await createMRReview({
			projectPath,
			mrIid,
			event: params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
			body: params.body as string,
		});

		// Delete ack note (best-effort)
		const ackCommentDeleted = await deleteGitLabAckNote(projectPath, mrIid);

		writeReviewSidecar(
			process.env[REVIEW_SIDECAR_ENV_VAR],
			`${projectPath}!${mrIid}`,
			params.event as string,
			params.body as string,
			ackCommentDeleted,
		);

		return result;
	}

	const result = await createPRReview({
		owner: params.owner as string,
		repo: params.repo as string,
		prNumber: params.prNumber as number,
		event: params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
		body: params.body as string,
		comments: params.comments as Array<{ path: string; line?: number; body: string }> | undefined,
	});

	// Delete ack comment (best-effort)
	const ackCommentDeleted = await deleteGitHubAckComment(
		params.owner as string,
		params.repo as string,
	);

	writeReviewSidecar(
		process.env[REVIEW_SIDECAR_ENV_VAR],
		result.reviewUrl,
		params.event as string,
		params.body as string,
		ackCommentDeleted,
	);

	return result;
});
