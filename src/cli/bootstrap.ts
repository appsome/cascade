/**
 * CLI bootstrap — invoked from `bin/cascade-tools.js` before oclif loads
 * any command, so that PM/SCM/alerting providers are registered before
 * any command's `.run()` calls `createPMProvider`.
 *
 * Mirrors `src/router/index.ts` and `src/worker-entry.ts`, which also go
 * through the single entrypoint. Plan 009/1 task 4 collapsed the per-surface
 * list of barrel imports into one file — see src/integrations/entrypoint.ts.
 *
 * Routed through this entry script (not `cli/base.ts`) so test files that
 * transitively import `cli/base.ts` don't trigger manifest evaluation
 * during integration test discovery.
 */
import '../integrations/entrypoint.js';
