import { DashboardCommand } from '../_shared/base.js';

export default class OrgCredentialsList extends DashboardCommand {
	static override description = 'List organization-scoped credentials (values masked).';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(OrgCredentialsList);

		try {
			const creds = await this.client.organization.credentials.list.query();

			if (flags.json) {
				this.outputJson(creds);
				return;
			}

			if (creds.length === 0) {
				this.log('No organization credentials configured.');
				return;
			}

			this.outputTable(creds as unknown as Record<string, unknown>[], [
				{ key: 'envVarKey', header: 'Key' },
				{ key: 'name', header: 'Name' },
				{ key: 'maskedValue', header: 'Value (masked)' },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
