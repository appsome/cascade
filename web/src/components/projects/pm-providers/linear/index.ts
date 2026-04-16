/**
 * Linear frontend wizard — side-effect registration.
 */

import { registerProviderWizard } from '../registry.js';
import { linearProviderWizard } from './wizard.js';

registerProviderWizard(linearProviderWizard);

export { linearProviderWizard };
