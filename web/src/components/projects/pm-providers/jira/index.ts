/**
 * JIRA frontend wizard — side-effect registration.
 */

import { registerProviderWizard } from '../registry.js';
import { jiraProviderWizard } from './wizard.js';

registerProviderWizard(jiraProviderWizard);

export { jiraProviderWizard };
