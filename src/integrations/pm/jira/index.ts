/**
 * JIRA PM provider — side-effect module that registers the manifest.
 */

import { registerPMProvider } from '../registry.js';
import { jiraManifest } from './manifest.js';

registerPMProvider(jiraManifest);

export { jiraManifest };
