/**
 * Linear PM provider — side-effect module that registers the manifest.
 */

import { registerPMProvider } from '../registry.js';
import { linearManifest } from './manifest.js';

registerPMProvider(linearManifest);

export { linearManifest };
