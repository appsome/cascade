/**
 * GitHub SCM integration — side-effect module that self-registers into
 * `integrationRegistry` at module load.
 *
 * Replaces the GitHub branch of the (now-deleted) `src/integrations/bootstrap.ts`.
 * SCM integrations remain on the legacy `IntegrationModule` registration
 * pattern — the manifest pattern is PM-only (spec 006 scope).
 */

import { integrationRegistry } from '../integrations/registry.js';
import { GitHubSCMIntegration } from './scm-integration.js';

if (!integrationRegistry.getOrNull('github')) {
	integrationRegistry.register(new GitHubSCMIntegration());
}
