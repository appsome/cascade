---
id: 006
slug: pm-integration-plug-and-play
plan: 2
plan_slug: migrate-trello
level: plan
parent_spec: docs/specs/006-pm-integration-plug-and-play.md
depends_on: [1-infrastructure.md]
status: pending
---

# 006/2: Migrate Trello onto the PM provider manifest

> Part 2 of 5 in the 006-pm-integration-plug-and-play plan. See [parent spec](../../specs/006-pm-integration-plug-and-play.md).

## Summary

Trello becomes the first real provider on the new manifest. All Trello-specific registrations currently scattered across `bootstrap.ts`, `builtins.ts`, `extractProjectIdFromJob`, `pm-wizard.tsx`, and `integrationsDiscovery.ts` collapse into one backend Trello manifest plus one frontend Trello wizard definition. The conformance harness now exercises Trello alongside `TestProvider` — catching any drift at CI time.

Trello is chosen first because it has the smallest surface (no OAuth popup via our flow — token is pasted manually after the Trello-hosted authorization page; existing label-create and custom-field-create affordances are straightforward to port). JIRA and Linear follow in plans 006/3 and 006/4.

Operators see no change: the Trello wizard UX is identical, webhook URL is identical, persisted config shape is identical.

**Components delivered:**
- `src/integrations/pm/trello/index.ts` — re-exports the Trello manifest; registers itself at module load via a new `src/integrations/pm/index.ts` barrel that imports each provider's `index.ts`.
- `src/integrations/pm/trello/manifest.ts` — `PMProviderManifest` for Trello, wiring existing `TrelloIntegration`, `TrelloRouterAdapter`, Trello triggers, `TrelloPlatformClient`.
- `web/src/components/projects/pm-providers/trello/steps.tsx` — the three Trello wizard steps (credentials, board, field mapping).
- `web/src/components/projects/pm-providers/trello/wizard.ts` — `ProviderWizardDefinition` binding the steps + `buildIntegrationConfig` + `isSetupComplete`.
- `web/src/components/projects/pm-providers/trello/index.ts` — module-load registration via `registerProviderWizard`.
- `src/integrations/bootstrap.ts` — Trello branch deleted (manifest registry handles it).
- `src/triggers/builtins.ts` — Trello trigger registration branch deleted.
- `src/router/worker-env.ts` — Trello branch in `extractProjectIdFromJob` deleted; registry path handles it.
- `web/src/components/projects/pm-wizard.tsx` — Trello-specific rendering branch deleted; manifest path handles it.
- `src/api/routers/integrationsDiscovery.ts` — Trello-specific endpoints (`createTrelloLabel`, `createTrelloLabels`, `createTrelloCustomField`, etc.) either moved to `pm-discovery.ts` under a uniform per-provider shape, or remain with a deprecation comment if mid-migration needs them.

**Deferred to later plans in this spec:**
- JIRA migration (006/3)
- Linear migration (006/4)
- Legacy registration infrastructure deletion (006/5)

---

## Spec ACs satisfied by this plan

- **Spec AC #1** (drop-in provider folder) — **full for Trello**: Trello is now defined in exactly two folders (`src/integrations/pm/trello/`, `web/src/components/projects/pm-providers/trello/`). Editing Trello no longer requires touching any shared registry.
- **Spec AC #2** (harness exercises every registered provider) — **partial**: Trello now in the harness. JIRA + Linear still on legacy — they'll join in 006/3–006/4.
- **Spec AC #3** (zero regressions) — **full for Trello**: existing Trello parity tests stay green; Trello wizard, webhook, trigger, worker flow all behave identically.
- **Spec AC #4** (canonical cross-cutting logic) — **partial**: Trello adopts the shared `auth-headers`, `webhook-verifier`, `label-id-resolver`, `project-id-extractor` helpers. JIRA + Linear still have their own copies — canonical via manifest requirement, but not visible to operators until 006/5 removes their copies.
- **Spec AC #5** (wizard adapts from manifest registry) — **partial for Trello**: Trello wizard now renders via the manifest path.
- **Spec AC #6** (zero half-migrated states, each plan independently revertable) — **full**: Trello is entirely on the manifest; JIRA and Linear are entirely on legacy. No per-provider mixed state. Reverting this plan reverts Trello back to the legacy path cleanly.

---

## Depends On

- Plan 006/1 (infrastructure) — provides `PMProviderManifest`, `pmProviderRegistry`, conformance harness, generic wizard renderer, shared helpers.

---

## Detailed Task List (TDD)

### 1. Trello manifest

**Tests first** (`tests/unit/integrations/pm/trello/manifest.test.ts`):
- `trelloManifest — id is 'trello'`
- `trelloManifest — category is 'pm'`
- `trelloManifest — webhookRoute is '/trello/webhook'`
- `trelloManifest — credentialRoles includes api_key + token (both required) + api_secret (optional)` — matches existing Trello roles.
- `trelloManifest — verifyWebhookSignature delegates to makeHmacSha256Verifier with Trello's header name + prefix` — calls the shared factory, no bespoke code.
- `trelloManifest — extractProjectIdFromJob returns projectId for { type: 'trello', projectId }`, null otherwise.
- `trelloManifest — platformClientFactory returns a TrelloPlatformClient instance`.
- `trelloManifest — triggerHandlers contains exactly the handlers from src/triggers/trello/` — confirms every existing trigger is wired.

**Implementation** (`src/integrations/pm/trello/manifest.ts`):
- Import existing `TrelloIntegration`, `TrelloRouterAdapter`, Trello trigger handlers from `src/triggers/trello/`, `TrelloPlatformClient`.
- Import `parseTrelloPayload` and `verifyTrelloWebhookSignature` — rewrite the verifier to use `makeHmacSha256Verifier({ headerName: 'x-trello-webhook', headerPrefix: '' })`.
- Import `registerPMProvider` from the registry; call at module top level.
- Export the manifest for testing.

**Implementation** (`src/integrations/pm/trello/index.ts`):
- Single re-export: `export { trelloManifest } from './manifest.js';`.
- Top of file: `import './manifest.js';` to execute the `registerPMProvider(...)` side effect on module load.

**Implementation** (`src/integrations/pm/index.ts` — new barrel if not introduced by plan 006/1):
- `import './trello/index.js';` — imports each provider module so registrations run at app startup.
- This file is imported once from `src/router/index.ts` and `src/dashboard.ts` (and any other entry that needs PM providers) — replacing the current explicit `bootstrap.ts` calls.

### 2. Trello frontend wizard definition

**Tests first** (`tests/unit/web/trello-wizard-provider.test.ts`):
- `trelloProviderWizard — steps array has exactly 3 steps: credentials, board, fields`
- `trelloProviderWizard — buildIntegrationConfig returns the same shape as the legacy save path` — snapshot against a fixture wizard state; must match byte-for-byte.
- `trelloProviderWizard — isSetupComplete is false on empty state, true on well-configured state`.
- `trelloProviderWizard — registered in the frontend registry under id 'trello'` — verifies module-load registration.

**Implementation** (`web/src/components/projects/pm-providers/trello/`):
- `steps.tsx` — re-exports `TrelloCredentialsStep`, `TrelloBoardStep`, `TrelloFieldMappingStep` from the existing `pm-wizard-trello-steps.tsx` with no behavioral change. Future PRs can move the implementations physically into this folder; this plan just re-wires the references.
- `wizard.ts`:
  ```typescript
  import { TrelloCredentialsStep, TrelloBoardStep, TrelloFieldMappingStep } from './steps';
  export const trelloProviderWizard: ProviderWizardDefinition = {
    id: 'trello',
    label: 'Trello',
    steps: [
      { id: 'credentials', title: 'Trello credentials', Component: TrelloCredentialsStep, isComplete: (s) => Boolean(s.trelloApiKey && s.trelloToken && s.verificationResult) },
      { id: 'board',       title: 'Board',              Component: TrelloBoardStep,       isComplete: (s) => Boolean(s.trelloBoardId) },
      { id: 'fields',      title: 'Field mappings',     Component: TrelloFieldMappingStep, isComplete: (s) => Object.keys(s.trelloListMappings).length > 0 },
    ],
    buildIntegrationConfig: buildTrelloIntegrationConfig, // existing fn from pm-wizard-state
    isSetupComplete: (s) => wizard.steps.every(step => step.isComplete(s)),
  };
  ```
- `index.ts` — `registerProviderWizard(trelloProviderWizard);`

### 3. Delete Trello-specific legacy registrations

**Tests first**:
- `tests/unit/integrations/bootstrap.test.ts — does not register Trello` — post-migration, Trello is not in the legacy bootstrap output.
- `tests/unit/triggers/builtins.test.ts — does not register Trello triggers via legacy path` — but `pmProviderRegistry.get('trello').triggerHandlers` contains them.
- `tests/unit/router/worker-env.test.ts — extractProjectIdFromJob routes Trello via registry, not a hardcoded branch`.

**Implementation**:
- `src/integrations/bootstrap.ts` — remove the Trello `if (!pmRegistry.getOrNull('trello')) pmRegistry.register(new TrelloIntegration())` block.
- `src/triggers/builtins.ts` — remove `registerTrelloTriggers(registry)` call.
- `src/router/worker-env.ts` — remove the `if (jobData.type === 'trello')` branch; the registry path handles it.
- `web/src/components/projects/pm-wizard.tsx` — remove the `state.provider === 'trello'` rendering branch; the manifest path handles it.

### 4. Consolidate Trello tRPC discovery endpoints

**Tests first** (`tests/unit/api/pm-discovery.test.ts`):
- `pm.discovery.createLabel — via registry for provider 'trello', creates label on board` — uses the shared endpoint instead of `createTrelloLabel`.
- `pm.discovery.createLabels — via registry for provider 'trello' batch creates labels`.

**Implementation** (`src/api/routers/pm-discovery.ts`):
- Add generic procedures: `createLabel({ projectId, providerId, name, color? })`, `createLabels({ projectId, providerId, labels })` — each dispatches to `manifest.createLabel` / `manifest.createLabels` hooks if present.
- Extend `PMProviderManifest` (in plan 006/1 — confirm the optional hooks exist; if not, add them here as a plan divergence).
- Trello-specific endpoints in `integrationsDiscovery.ts` can either be deleted (if the dashboard hook migrates in this plan) or deprecated with a comment pointing at the new endpoint.

> If the optional `createLabel`/`createLabels` hooks were not included in plan 006/1's `PMProviderManifest`, edit the spec destructively in place (via `/plan` divergence handling) to add them, and re-land the contract in 006/1 before proceeding.

### 5. Update the Trello dashboard hook

**Tests first** (`tests/unit/web/useTrelloLabelCreation.test.ts` — if a test exists; otherwise integration via existing tests):
- `useTrelloLabelCreation — calls pm.discovery.createLabel with providerId='trello'` — instead of `createTrelloLabel`.

**Implementation**:
- `web/src/components/projects/pm-wizard-hooks.ts::useTrelloLabelCreation` — change the `trpcClient.integrationsDiscovery.createTrelloLabel.mutate` call to `trpcClient.pm.discovery.createLabel.mutate({ providerId: 'trello', ... })`.
- Same for `createTrelloLabels` → `pm.discovery.createLabels`.

### 6. Conformance harness runs Trello

**Tests first**: this happens automatically — the existing `tests/unit/integrations/pm-conformance.test.ts` iterates `listPMProviders()` and now Trello is in that list.

**Implementation**: no new test file; verify that registering `trelloManifest` during the test run (either via module import or explicit registration in the harness setup) makes the harness iterate Trello and green.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/integrations/pm/trello/manifest.test.ts`: ~8 tests
- [ ] `tests/unit/web/trello-wizard-provider.test.ts`: 4 tests
- [ ] `tests/unit/integrations/bootstrap.test.ts`: assertion update (Trello no longer registered via legacy path)
- [ ] `tests/unit/triggers/builtins.test.ts`: assertion update
- [ ] `tests/unit/router/worker-env.test.ts`: assertion update
- [ ] `tests/unit/api/pm-discovery.test.ts`: 2 new tests for generic `createLabel`/`createLabels` via registry
- [ ] Existing Trello tests (`tests/unit/pm/trello/*`, `tests/unit/router/adapters/trello.test.ts`, etc.) — all must stay green with **zero code changes**.

**Total: ~15 new tests + ~5 existing assertion updates.**

### Integration tests
- [ ] `tests/integration/trello-end-to-end.test.ts` (existing or new) — Trello webhook → trigger → agent dispatch roundtrip. Must pass through the manifest path.

### Acceptance tests
- Conformance harness exercises Trello and passes (per-plan AC #1).
- Every existing Trello unit + integration test passes without code changes (per-plan AC #3).

---

## Acceptance Criteria (per-plan, testable)

1. `pmProviderRegistry.get('trello')` returns the Trello manifest after module load.
2. `listPMProviders()` includes Trello; conformance harness runs and passes Trello-scoped tests.
3. **Every existing Trello unit and integration test passes** without modification to the test code. Behavioral parity verified.
4. `pm-wizard.tsx` no longer has a `state.provider === 'trello'` branch; Trello wizard renders via `getProviderWizard('trello')`.
5. `bootstrap.ts` no longer registers `TrelloIntegration`.
6. `builtins.ts` no longer calls `registerTrelloTriggers(registry)`.
7. `extractProjectIdFromJob` no longer has a Trello-specific branch; registry path handles Trello.
8. `pm.discovery.createLabel` and `pm.discovery.createLabels` handle Trello via the manifest; `createTrelloLabel` / `createTrelloLabels` are either removed from `integrationsDiscovery.ts` or retained with a deprecation comment pointing at `pm.discovery.*`.
9. Operator-facing dashboard wizard behavior for Trello is byte-for-byte identical to pre-plan (verified by SSR snapshot tests).
10. All new/modified code has tests.
11. `npm run build` passes.
12. `npm test` passes.
13. `npm run lint` passes.
14. `npm run typecheck` passes.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/integrations/README.md` | Update the transitional note to reflect Trello migrated ("Trello: ✓ migrated. JIRA and Linear still on legacy.") |
| `CHANGELOG.md` | Entry: "Internal: Trello migrated to PM provider manifest (no operator-visible change)" |

---

## Out of Scope (this plan)

- Migrating JIRA (plan 006/3).
- Migrating Linear (plan 006/4).
- Deleting legacy registration infrastructure — only Trello-specific branches are removed this plan. `bootstrap.ts`, `builtins.ts`, `extractProjectIdFromJob`, `pm-wizard.tsx` still contain JIRA and Linear branches.
- Moving Trello wizard component implementations physically into `pm-providers/trello/` — this plan only re-exports. Moves can happen later without spec scope.
- Removing the legacy `integrationsDiscovery` tRPC router — deferred to plan 006/5 when all three providers use `pm-discovery`.
- Spec-level out-of-scope items (SCM/alerting refactor, gadgets, runtime plugins).

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 Trello manifest registered
- [ ] AC #2 Conformance harness passes Trello
- [ ] AC #3 Existing Trello tests green unchanged
- [ ] AC #4 Wizard Trello branch removed
- [ ] AC #5 Bootstrap Trello registration removed
- [ ] AC #6 Builtins Trello registration removed
- [ ] AC #7 Extractor Trello branch removed
- [ ] AC #8 Trello tRPC endpoints consolidated into pm.discovery
- [ ] AC #9 Operator-facing Trello behavior unchanged
- [ ] AC #10 All new code has tests
- [ ] AC #11 Build passes
- [ ] AC #12 Tests pass
- [ ] AC #13 Lint passes
- [ ] AC #14 Typecheck passes
