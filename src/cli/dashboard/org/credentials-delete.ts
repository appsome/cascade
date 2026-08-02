import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { confirm } from '../_shared/confirm.js';

export default class OrgCredentialsDelete extends DashboardCommand {
	static override description = 'Delete an organization-scoped credential.';

	static override flags = {
		...DashboardCommand.baseFlags,
		key: Flags.string({
			description: 'Environment variable key to delete',
			required: true,
		}),
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(OrgCredentialsDelete);

		await confirm(`Delete organization credential ${flags.key}?`, flags.yes);

		try {
			await this.withSpinner('Deleting credential...', () =>
				this.client.organization.credentials.delete.mutate({
					envVarKey: flags.key,
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Deleted organization credential ${flags.key}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
