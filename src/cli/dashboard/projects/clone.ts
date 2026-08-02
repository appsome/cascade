import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsClone extends DashboardCommand {
	static override description =
		'Clone a project, copying all settings, integrations, credentials, agent configs, and trigger configs.';

	static override args = {
		sourceId: Args.string({ description: 'Source project ID to clone from', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'new-id': Flags.string({
			description: 'New project ID (lowercase letters, numbers, hyphens)',
			required: true,
		}),
		name: Flags.string({ description: 'New project name', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsClone);

		try {
			const result = await this.withSpinner('Cloning project...', () =>
				this.client.projects.clone.mutate({
					sourceId: args.sourceId,
					newId: flags['new-id'],
					newName: flags.name,
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(
				`Cloned project '${args.sourceId}' → '${result.id}' (${result.name}). Configure the repository field before using.`,
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}
