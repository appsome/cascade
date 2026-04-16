/**
 * Sentry alerting integration — side-effect module that self-registers
 * into `integrationRegistry` at module load.
 *
 * Replaces the Sentry branch of the (now-deleted) `src/integrations/bootstrap.ts`.
 * Alerting integrations remain on the legacy `IntegrationModule`
 * registration pattern — the manifest pattern is PM-only (spec 006 scope).
 */

import { integrationRegistry } from '../integrations/registry.js';
import { SentryAlertingIntegration } from './alerting-integration.js';

if (!integrationRegistry.getOrNull('sentry')) {
	integrationRegistry.register(new SentryAlertingIntegration());
}
