/**
 * Trello frontend wizard — side-effect module that registers the
 * wizard definition into `providerWizardRegistry` at module load.
 */

import { registerProviderWizard } from '../registry.js';
import { trelloProviderWizard } from './wizard.js';

registerProviderWizard(trelloProviderWizard);

export { trelloProviderWizard };
