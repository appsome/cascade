/**
 * Trello PM provider — side-effect module that registers the manifest.
 *
 * Import this file once from `src/integrations/pm/index.ts` (the provider
 * barrel). The registration happens at module load; re-imports are a no-op
 * because Node caches modules.
 */

import { registerPMProvider } from '../registry.js';
import { trelloManifest } from './manifest.js';

registerPMProvider(trelloManifest);

export { trelloManifest };
