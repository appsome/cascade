# PM Integration Architecture

CASCADE's PM providers (Trello, JIRA, Linear, and any future Asana/GitLab/ClickUp) are built on a **provider manifest** pattern. One file describes the provider end-to-end; one registry iterates manifests; a conformance harness guarantees each manifest is complete.

This document is the canonical guide for adding a new PM provider.

> **Migration status (plan 006/5 pending — cleanup only):**
> **Trello: ✓ migrated** (006/2). **JIRA: ✓ migrated** (006/3). **Linear: ✓ migrated** (006/4). Every PM provider now registers through the manifest pattern; the shared conformance harness exercises all three alongside `TestProvider`. `src/integrations/bootstrap.ts` still registers all three in `pmRegistry` for backward compatibility with the ~dozen `pmRegistry.get(...)` call sites in webhook handlers, manual runners, and credential scoping. Plan 006/5 migrates those callers to `pmProviderRegistry.get(id)?.pmIntegration` and deletes the legacy registration paths atomically.

---

## Architecture in one picture

```
A new PM provider is ONE manifest backed by ONE provider folder + ONE wizard folder.

  src/integrations/pm/<provider>/
    index.ts          // registerPMProvider(<provider>Manifest) on module load
    manifest.ts       // the PMProviderManifest object
    client.ts         // provider API client (GraphQL, REST, etc.)
    adapter.ts        // PMProvider implementation
    router-adapter.ts // RouterPlatformAdapter implementation
    triggers/         // trigger handlers for webhook events
    webhook.ts        // parseWebhookPayload + (optional) custom signature verifier
    platform-client.ts// PlatformCommentClient (ack comments)

  web/src/components/projects/pm-providers/<provider>/
    index.ts          // registerProviderWizard(<provider>ProviderWizard) on module load
    wizard.ts         // ProviderWizardDefinition (steps, save transform, completion predicates)
    steps.tsx         // React components for each wizard step
```

Nothing outside those two folders needs to change when you add a provider. The registries are the only surface the rest of the codebase sees.

---

## The PMProviderManifest contract

See [`src/integrations/pm/manifest.ts`](./pm/manifest.ts) for the authoritative type. Summary:

| Field | What it does |
|---|---|
| `id` | Stable slug (kebab/lowercase). Used as the webhook route segment, job type, and registry key. |
| `label` | Human-readable name shown in the dashboard provider-select. |
| `category` | Literal `'pm'`. |
| `credentialRoles` | List of credential slots (api_key, webhook_secret, etc.) with env-var keys + optional flag. |
| `webhookRoute` | Conventionally `/${id}/webhook`. Enforced by the conformance harness. |
| `verifyWebhookSignature` | `(rawBody, headers, secret) => boolean`. Use `makeHmacSha256Verifier` from `_shared/webhook-verifier.ts` unless your provider has a non-standard signing scheme. |
| `parseWebhookPayload` | `(raw) => ParsedWebhookEvent \| null`. Return `null` for unrecognized payloads. |
| `routerAdapter` | Your `RouterPlatformAdapter` implementation — handles parsing, dispatching, and ack. |
| `extractProjectIdFromJob` | `(jobData) => Promise<projectId \| null>`. **Must return `null` for jobs belonging to other providers.** Forgetting this invariant caused the Linear-worker-without-credentials bug (PR #1118). |
| `pmIntegration` | Your `PMIntegration` implementation — the agent-facing provider API. |
| `triggerHandlers` | Array of `TriggerHandler` instances for webhook events. |
| `platformClientFactory` | `(projectId) => PlatformCommentClient`. Used by the router to post ack comments; must pull auth headers from `_shared/auth-headers.ts`. |
| `isSelfAuthoredHook?` | Optional — returns `true` when the event was authored by CASCADE itself (for loop prevention). |
| `createLabel?` | Optional — enables the wizard's "Create label" button for this provider. |

---

## The ProviderWizardDefinition contract

See [`web/src/components/projects/pm-providers/types.ts`](../../web/src/components/projects/pm-providers/types.ts). Summary:

| Field | What it does |
|---|---|
| `id` | Must match the backend manifest `id`. |
| `label` | Shown in the provider-select dropdown. |
| `steps` | Array of `{ id, title, Component, isComplete }`. The generic wizard renders them in order. |
| `buildIntegrationConfig` | Transforms wizard state into the integration config payload sent at save time. |
| `isSetupComplete` | `(state) => boolean`. True when the wizard can be saved. |

---

## Shared helpers (consume these; don't fork)

Single-source-of-truth utilities live in `src/integrations/pm/_shared/`:

- **`auth-headers.ts`** — `linearAuthHeader`, `githubAuthHeader`, `jiraAuthHeader`. The session's `Bearer`-prefix bug (PR #1119) came from three divergent copies of the Linear builder. Use the shared function.
- **`webhook-verifier.ts`** — `makeHmacSha256Verifier({ headerName, headerPrefix? })` for the common case. Opt-out semantics (secret = `null` → always `true`) preserve existing router behavior.
- **`label-id-resolver.ts`** — `resolveLabelId(slot, mapping, ctx)` validates UUIDs before passing labelIds to APIs that require them (Linear). Returns `null` and logs a warn for misconfigurations.
- **`project-id-extractor.ts`** — `extractProjectIdFromJobViaRegistry(jobData)` iterates the registry. Used by `src/router/worker-env.ts` before its legacy branches.

---

## Conformance harness — what CI enforces

`tests/unit/integrations/pm-conformance.test.ts` iterates `listPMProviders()` and runs a shared test pack against every manifest:

- `id` is URL-safe kebab/lowercase
- `category` is `'pm'`
- `webhookRoute` follows the `/${id}/webhook` convention
- `routerAdapter.type === id`
- At least one required credential role
- Credential roles have unique `role` strings
- `extractProjectIdFromJob` returns `null` for foreign job types
- `extractProjectIdFromJob` returns the projectId for `{ type: id, projectId }`
- `triggerHandlers` have unique names
- `platformClientFactory(projectId)` returns an object with `postComment`, `deleteComment`, `updateComment`
- `parseWebhookPayload(unknownPayload)` returns `null` (not `undefined`, not throw)

A `TestProvider` fixture in `tests/helpers/testPMProvider.ts` is the minimal reference implementation — copy its shape when starting a new provider.

---

## Adding a new PM provider (step by step)

Steps (once plans 006/2–006/4 have migrated the built-ins):

1. **Create the backend folder** at `src/integrations/pm/<provider>/`. Implement `client.ts`, `adapter.ts`, `router-adapter.ts`, `triggers/*.ts`, `webhook.ts`, `platform-client.ts`. None of these files is imported by any file outside `src/integrations/pm/<provider>/`.

2. **Write the manifest** in `manifest.ts` exporting a `PMProviderManifest`. Wire the shared helpers: `auth-headers`, `makeHmacSha256Verifier` for the signature verifier, `resolveLabelId` if your provider rejects non-UUIDs.

3. **Register the manifest** in `index.ts` with a single `import './manifest.js';` side-effect module that calls `registerPMProvider(<provider>Manifest)` at the top of `manifest.ts`. Add one line to `src/integrations/pm/index.ts` that imports `./<provider>/index.js`.

4. **Create the frontend folder** at `web/src/components/projects/pm-providers/<provider>/`. Implement `steps.tsx` and `wizard.ts` (`ProviderWizardDefinition`). Register in `index.ts`.

5. **Run the conformance harness**: `npm run test tests/unit/integrations/pm-conformance.test.ts`. CI fails with a specific message for each missing or incorrect contract surface.

6. **Write provider-specific unit tests** in `tests/unit/pm/<provider>/` and `tests/unit/web/<provider>-*.test.ts`. The conformance harness covers contract invariants; you still need tests for your provider-specific logic (webhook parsing, field mappings, trigger dispatch).

That's it. No edits to `src/integrations/bootstrap.ts`, `src/triggers/builtins.ts`, `src/router/worker-env.ts::extractProjectIdFromJob`, `web/src/components/projects/pm-wizard.tsx`, or `src/api/routers/integrationsDiscovery.ts`.

---

## Non-PM integrations

SCM (GitHub) and alerting (Sentry) integrations retain their existing registration shape until a future spec decides whether the manifest pattern should extend. See `src/integrations/scm.ts` and `src/integrations/alerting.ts`.

---

## Legacy registration path (being deleted in plan 006/5)

> The content below describes how Trello, JIRA, and Linear register in builds that predate plans 006/2–006/4. Ignore this section when writing new code; it exists only for the migration window.

Before the manifest pattern, adding a provider required edits in ~10 locations:

- `src/integrations/bootstrap.ts` — manual PM integration + `integrationRegistry` registration
- `src/router/index.ts` — new `app.post('/<provider>/webhook', createWebhookHandler({...}))` block
- `src/router/adapters/<provider>.ts` — new adapter
- `src/router/webhookVerification.ts` — new verifier
- `src/webhook/webhookHandlers.ts` — new parse function
- `src/router/worker-env.ts::extractProjectIdFromJob` — new branch (easily forgotten → Linear worker-without-credentials bug)
- `src/triggers/<provider>/register.ts` + `src/triggers/builtins.ts` — manual trigger registration
- `src/config/integrationRoles.ts` — credential roles
- `web/src/components/projects/pm-wizard-<provider>-steps.tsx` — wizard step components
- `web/src/components/projects/pm-wizard-state.ts` — provider field union + reducer cases
- `web/src/components/projects/pm-wizard-hooks.ts` — discovery + label-creation hooks
- `web/src/components/projects/pm-wizard.tsx` — per-provider rendering branches
- `src/api/routers/integrationsDiscovery.ts` — per-provider tRPC endpoints

Plans 006/2–006/4 collapse each provider's scattered registrations into one manifest. Plan 006/5 deletes the legacy scaffolding once every provider has migrated.
