import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class OrgCredentialsSet extends DashboardCommand {
	static override description =
		'Set an organization-scoped credential (upsert by env var key). Inherited by all projects; project credentials with the same key override it.';

	static override flags = {
		...DashboardCommand.baseFlags,
		key: Flags.string({
			description: 'Environment variable key (e.g. GITHUB_TOKEN_IMPLEMENTER)',
			required: true,
		}),
		value: Flags.string({ description: 'Credential value', required: true }),
		name: Flags.string({ description: 'Human-readable name for the credential' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(OrgCredentialsSet);

		try {
			await this.withSpinner('Setting credential...', () =>
				this.client.organization.credentials.set.mutate({
					envVarKey: flags.key,
					value: flags.value,
					name: flags.name,
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Set organization credential ${flags.key}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
