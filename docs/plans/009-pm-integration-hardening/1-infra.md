---
id: 009
slug: pm-integration-hardening
plan: 1
plan_slug: infra
level: plan
parent_spec: docs/specs/009-pm-integration-hardening.md
depends_on: []
status: pending
---

# 009/1: Infrastructure — Typed IDs, Manifest Contract Fields, Behavioral Harness, Fake Provider, Single Entrypoint

> Part 1 of 5 in the 009-pm-integration-hardening plan. See [parent spec](../../specs/009-pm-integration-hardening.md).

## Summary

This plan lands the **hardening primitives** as dormant/additive code. Nothing user-visible changes; no provider is migrated yet. The goal is to put every new contract surface in place so plans 2–4 can migrate providers onto it one at a time under conformance-harness supervision.

Concretely, plan 1 introduces:

- Branded ID types (`StateId`, `LabelId`, `ContainerId`) in the PM core.
- Three new fields on `PMProviderManifest`: `configSchema` (Zod), `discoveryCapabilities` (capability flags + `discover()` method), `wizardSpec` (declarative standard-step list).
- An in-memory `FakePMProvider` fixture under `tests/helpers/` implementing the full `PMProvider` interface with an in-memory store.
- An expanded conformance harness that runs a full-lifecycle scenario against every registered provider plus the fake, plus new behavioral assertions (config round-trip, `listWorkItems` shape, trigger self-hook filter, webhook verification accept/reject).
- A single canonical registration entrypoint (`src/integrations/entrypoint.ts`) re-exported and side-effect-imported by router, worker, CLI, dashboard API, and test setup. Legacy importers of `src/integrations/pm/index.ts` forward through the new entrypoint.
- A generic `pm.discover` tRPC endpoint that dispatches `providerId` + `capability` through the registry. Dormant until providers declare capabilities.
- A Biome rule banning direct assembly of provider auth headers outside `src/integrations/pm/_shared/auth-headers.ts`, plus a conformance-harness grep assertion backing the same invariant.

Because the manifest fields are optional in this plan and legacy providers do not declare them, the harness's new behavioral asserts run **only against the fake provider and any provider that has opted in** (none yet). This is deliberate — it lets plans 2/3/4 flip each provider on independently.

**Components delivered:**
- `src/pm/ids.ts` — branded types + parsers
- `src/pm/types.ts` — `PMProvider` interface extended with `discover?(capability, args)` and branded-ID parameter accepting signatures
- `src/integrations/pm/manifest.ts` — `configSchema?`, `discoveryCapabilities?`, `wizardSpec?` fields added
- `src/integrations/entrypoint.ts` — new single registration entrypoint
- `src/api/routers/pm-discovery.ts` — new `discover` procedure (generic)
- `tests/helpers/fakePMProvider.ts` — in-memory fake + lifecycle scenario harness
- `tests/unit/integrations/pm-conformance.test.ts` — expanded behavioral asserts + fake-provider lifecycle
- `tests/unit/integrations/auth-header-provenance.test.ts` — grep assertion
- `biome.json` — no-restricted-imports / no-restricted-syntax rule for auth-header assembly
- `tests/README.md` — documents the fake + lifecycle harness

**Deferred to later plans in this spec:**
- Per-provider adoption of `configSchema`, `discoveryCapabilities`, `wizardSpec` (plans 2/3/4)
- Deletion of legacy per-provider tRPC discovery endpoints (plan 5)
- Deletion of per-provider schemas from `src/config/schema.ts` (plan 5)
- Making the single entrypoint mandatory (plan 5 — grep assertion that no other file imports provider barrels directly)
- Final rewrite of `src/integrations/README.md` and root `CLAUDE.md` (plan 5)

---

## Spec ACs satisfied by this plan

- **Spec AC #1** (actionable conformance failures for new provider) — **partial** — harness machinery + fake fixture exist; migration plans 2/3/4 exercise them against real providers; plan 5 adds the final meta-assertion about shared-file edits.
- **Spec AC #3** (state/label name→ID is a compile error) — **partial** — the branded types + parsers ship here; provider adoption in plans 2/3/4 realises the compile-error property at call sites.
- **Spec AC #4** (second auth-header copy fails harness) — **partial** — the Biome rule + grep assertion ship here; per-provider verification lands with each migration.
- **Spec AC #5** (single registration entrypoint) — **partial** — the entrypoint file ships and all current importers forward through it; plan 5 makes it mandatory by deleting fallback imports.
- **Spec AC #6** (wizard standard steps from manifest) — **partial** — the `wizardSpec` type and generator scaffolding ship here, dormant until providers adopt it.
- **Spec AC #7** (unified discovery endpoint) — **partial** — the generic `pm.discover` endpoint ships here; providers declare capabilities in 2/3/4; legacy endpoints deleted in plan 5.
- **Spec AC #8** (lifecycle harness runs vs every provider + fake) — **partial** — harness + fake provider lifecycle ship here; each provider joins in its migration plan.
- **Spec AC #9** (config schema round-trip) — **partial** — round-trip asserter ships here; each provider opts in by declaring `configSchema` in its migration plan.

---

## Depends On

- Nothing in this spec (this is plan 1).
- Baseline state from spec 006 (manifest + registry + existing conformance harness).

---

## Detailed Task List (TDD)

### 1. Branded ID types

**Tests first** (`tests/unit/pm/ids.test.ts`):
- `parseStateId` — accepts non-empty string → returns branded `StateId`; rejects empty string → throws.
- `parseLabelId` — same contract for `LabelId`.
- `parseContainerId` — same contract for `ContainerId`.
- Type-level assertions (compile-time): `const s: StateId = 'raw'` is a TS error; `const s: StateId = parseStateId('raw')` compiles.

**Implementation** (`src/pm/ids.ts`):
- Export branded types: `type StateId = string & { readonly __brand: 'StateId' }` (and same for `LabelId`, `ContainerId`).
- Export parsers: `parseStateId(raw: string): StateId`, `parseLabelId(raw: string): LabelId`, `parseContainerId(raw: string): ContainerId`.
- Each parser validates non-empty, non-whitespace; throws `InvalidIdError` on failure.
- Export a `unwrap<T extends string>(id: T): string` helper for boundary crossings (DB, HTTP, logs).

### 2. Extend `PMProvider` interface for branded IDs

**Tests first** (`tests/unit/pm/types.test.ts`):
- Type-check assertion (tsc test via `tsd` or equivalent): passing a bare `string` where `StateId` is expected fails the compiler. Passing the output of `parseStateId(raw)` compiles.

**Implementation** (`src/pm/types.ts`):
- Change `moveWorkItem(id: string, destination: string)` → `moveWorkItem(id: string, destination: ContainerId)`.
- Change `createWorkItem(config: CreateWorkItemConfig)` → `config.containerId: ContainerId`, `config.labelIds?: LabelId[]`, `config.stateId?: StateId`.
- Add optional `discover?<K extends DiscoveryCapability>(capability: K, args: DiscoveryArgs<K>): Promise<DiscoveryResult<K>>` method.
- Legacy adapters continue to implement the method signatures; TypeScript's structural typing means they'll need to accept branded types. Because branded types are structurally `string`, legacy callers still compile — only the call sites that try to pass bare strings (after plans 2/3/4 migrations) will break.

### 3. Extend `PMProviderManifest`

**Tests first** (`tests/unit/integrations/manifest-fields.test.ts`):
- A manifest with only the existing fields remains valid (backward-compatible).
- A manifest with `configSchema` can be round-tripped: `configSchema.parse(configSchema.parse(raw))` is deep-equal to `configSchema.parse(raw)`.
- A manifest with `discoveryCapabilities` is type-checked against its `discover` method signature (compile-time).
- A manifest with `wizardSpec` is validated structurally (array of known step kinds).

**Implementation** (`src/integrations/pm/manifest.ts`):
- Add optional field `configSchema?: ZodSchema<TConfig>` (generic over the manifest's config type).
- Add optional field `discoveryCapabilities?: { teams?: true; boards?: true; labels?: true; states?: true; projects?: true; customFields?: true }`.
- Add optional field `wizardSpec?: WizardSpec` where `WizardSpec = { steps: Array<StandardStep | CustomStep> }` and `StandardStep = { kind: 'credentials' | 'container-pick' | 'status-mapping' | 'label-mapping' | 'webhook-url-display' | 'project-scope', id: string, config?: Record<string, unknown> }`.
- Export a `validateManifestAgainstSchema(manifest): void` helper used by the conformance harness.

### 4. Single registration entrypoint

**Tests first** (`tests/unit/integrations/entrypoint.test.ts`):
- Importing `src/integrations/entrypoint.js` (with registries reset via a test helper) results in all three PM providers, GitHub SCM, and Sentry alerting being registered.
- `listPMProviders()` returns `[trello, jira, linear]` after the import.
- Removing the entrypoint import from any runtime surface is caught by this plan's `entrypoint-usage.test.ts` (see next task).

**Implementation** (`src/integrations/entrypoint.ts`):
- New file. Imports `./pm/index.js`, `../github/register.js`, `../sentry/register.js` as side-effect modules.
- Exports `registerAllIntegrations()` as a no-op alias (for test resets that want explicit call semantics).
- Update `src/router/index.ts`, `src/worker-entry.ts`, `src/cli/bootstrap.ts`, `src/dashboard.ts` to import `../integrations/entrypoint.js` instead of `../integrations/pm/index.js` (plus their existing SCM/alerting side-effect imports).
- Leave `src/integrations/pm/index.ts` in place for now; it remains valid (plan 5 may rename or hide it).

### 5. Entrypoint usage test

**Tests first** (`tests/unit/integrations/entrypoint-usage.test.ts`):
- Grep-style assertion: every file matching `{router,worker-entry,cli/bootstrap,dashboard}.(ts|js)` in `src/` imports `src/integrations/entrypoint` (or forwards through a file that does). Fail with a specific message naming the offending file.

**Implementation**:
- Test reads the list of runtime-entry globs and asserts each file contains the expected import string. No production code changes here beyond the test file itself.

### 6. Fake PM provider fixture

**Tests first** (`tests/unit/integrations/pm-fake-lifecycle.test.ts`):
- Full scenario: create container (team/board/project) → create work item → list → move → add checklist → add checklist item → toggle checklist item → post comment → delete work item. Each step asserts on the in-memory state.
- Fake provider implements `discover('states')`, `discover('labels')`, `discover('containers')` and returns deterministic fixtures.
- Fake provider declares a `configSchema` round-trippable with known inputs.

**Implementation** (`tests/helpers/fakePMProvider.ts`):
- `createFakePMProvider(opts?)` returns a `PMProvider` + `PMProviderManifest` pair backed by in-memory maps.
- `createFakePMManifest()` returns a `PMProviderManifest` with `id: 'fake'`, full `configSchema`, all `discoveryCapabilities`, `wizardSpec` covering every standard step kind.
- Export `runLifecycleScenario(provider, containerId, config)` — a shared runner the conformance harness can call.

### 7. Expand conformance harness

**Tests first** — new test cases added to `tests/unit/integrations/pm-conformance.test.ts`:
- For each registered manifest with a `configSchema`: parse a fixture config, re-serialize, re-parse, assert deep-equal (round-trip identity).
- For each registered manifest with `discoveryCapabilities`: for every declared capability, assert the adapter's `discover(capability, ...)` returns an array of the expected shape (empty is OK if the adapter is not yet wired).
- For each manifest: execute `runLifecycleScenario` against the adapter and assert each step's shape (guarded behind `manifest.lifecycle?.enabled ?? false` to avoid breaking legacy providers; the fake provider and any migrated provider opt in).
- Trigger self-hook filter: for each manifest's `triggerHandlers`, dispatch an event authored by a known CASCADE persona and assert the handler returns `{ skipped: true }` or logs-and-drops.
- Webhook verification: each manifest with a `verifyWebhookSignature` must reject a payload with a tampered byte and accept the original. Uses a shared fixture.

**Implementation**:
- Extend the `describe('PM manifest conformance')` block with new `describe.each(listPMProviders())` variants.
- New case: fake provider joins the same suite (registered via a test-local helper that adds/removes the fake manifest from the registry per-test).

### 8. Auth-header provenance assertion

**Tests first** (`tests/unit/integrations/auth-header-provenance.test.ts`):
- Grep assertion: any occurrence of the patterns `Bearer ${` or `Authorization.*Basic ` outside `src/integrations/pm/_shared/auth-headers.ts` and its tests fails, naming the offending file.
- Accept-list for known-legitimate exceptions (e.g., GitHub-SDK-internal usage) is explicit and small; prefer refactoring to shared helpers over expanding the accept-list.

**Implementation**:
- Test uses `fast-glob` + file reads; no production code changes beyond moving any stragglers into `_shared/auth-headers.ts` if the grep trips on the current codebase. (Expected to pass clean given post-#1119 state.)

### 9. Biome rule

**Tests first**:
- Not a unit test — validated by running `npm run lint` after adding the rule.

**Implementation** (`biome.json`):
- Add a `linter.rules.suspicious.noRestrictedGlobals` (or equivalent) entry banning string literals `"Bearer "` and `"Authorization"` outside the `_shared/auth-headers` path. Use Biome's `noRestrictedSyntax` pattern if `noRestrictedGlobals` doesn't fit.
- If Biome cannot express the rule ergonomically, fall back to a custom ESLint check run alongside Biome (new `scripts/check-auth-headers.ts` invoked from `lint` script). Prefer the in-Biome solution if possible.

### 10. Generic `pm.discover` tRPC endpoint

**Tests first** (`tests/unit/api/pm-discovery.test.ts`):
- `pm.discover({ providerId: 'fake', capability: 'labels', args: { containerId: 'c1' } })` returns the fixture labels from the fake provider.
- `pm.discover` with unknown `providerId` returns a tRPC `NOT_FOUND`.
- `pm.discover` for a provider that doesn't declare the capability returns a tRPC `UNIMPLEMENTED` with a message pointing to the manifest.

**Implementation** (`src/api/routers/pm-discovery.ts`):
- Add `discover` procedure: input schema `{ providerId: z.string(), capability: z.enum([...]), args: z.record(z.unknown()) }`, output schema varies by capability (use a discriminated union keyed on `capability`).
- Resolve the provider via the registry, check `manifest.discoveryCapabilities[capability]`, call `adapter.discover(capability, args)`.
- Legacy per-provider endpoints in `src/api/routers/integrationsDiscovery.ts` remain for now — plan 5 deletes them after providers are migrated.

### 11. Wizard step generator scaffolding

**Tests first** (`tests/unit/web/wizard-generator.test.tsx`):
- Given a `wizardSpec` with `{ kind: 'credentials' }`, the generator renders the shared credentials step.
- Given `{ kind: 'status-mapping' }`, it renders the shared status mapping step.
- Unknown `kind` logs a warning and renders a placeholder; build does not fail.

**Implementation** (`web/src/components/projects/pm-providers/generator.tsx`):
- `renderStandardStep(step, providerHooks)` — switch over `step.kind`, return the corresponding existing step component (currently duplicated across provider wizards; plans 2/3/4 will replace per-provider copies with calls to this generator).
- Wire the generator into `manifest-section.tsx` as a fallback: if a provider's wizard declares standard steps, render them from the generator; custom steps still come from the provider folder.

### 12. Update `tests/README.md`

**Tests first** — N/A (documentation).

**Implementation** (`tests/README.md`):
- Add a "PM provider fixtures" section documenting `createFakePMProvider`, `runLifecycleScenario`, and how to run the conformance harness locally.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/pm/ids.test.ts` — 6 tests covering parsers + type-level assertions.
- [ ] `tests/unit/pm/types.test.ts` — 2 tsd-style type-check tests.
- [ ] `tests/unit/integrations/manifest-fields.test.ts` — ~6 tests covering optional fields, round-trip, structural validation.
- [ ] `tests/unit/integrations/entrypoint.test.ts` — 3 tests covering full registry load.
- [ ] `tests/unit/integrations/entrypoint-usage.test.ts` — 1 grep test across runtime entry points.
- [ ] `tests/unit/integrations/pm-fake-lifecycle.test.ts` — ~10 tests covering full lifecycle against the fake.
- [ ] `tests/unit/integrations/pm-conformance.test.ts` — extends existing harness with ~5 new behavioral assertion groups (round-trip, discovery shape, lifecycle, trigger self-hook filter, webhook verify accept/reject).
- [ ] `tests/unit/integrations/auth-header-provenance.test.ts` — 1 grep assertion.
- [ ] `tests/unit/api/pm-discovery.test.ts` — 3 tests covering the new generic `discover` procedure.
- [ ] `tests/unit/web/wizard-generator.test.tsx` — 3 tests for the step generator.

### Integration tests
- None specific to this plan — no DB or external service changes. Existing integration suite must still pass.

### Acceptance tests
- [ ] Plan AC #1: `npm run typecheck` passes with the new branded types in place.
- [ ] Plan AC #2: `npm run lint` passes with the new Biome rule.
- [ ] Plan AC #3: `npm test` passes including the new harness assertions against the fake provider.

---

## Acceptance Criteria (per-plan, testable)

1. `StateId`, `LabelId`, `ContainerId` are branded types exported from `src/pm/ids.ts`; assigning a bare `string` literal to any of them is a compile error; `parseXxx(raw)` returns a branded value and throws on empty input.
2. `PMProviderManifest` accepts optional `configSchema`, `discoveryCapabilities`, `wizardSpec` fields; existing manifests (Trello/JIRA/Linear today) compile unchanged.
3. `src/integrations/entrypoint.ts` exists and is imported by the router, worker, CLI bootstrap, and dashboard API; `tests/unit/integrations/entrypoint-usage.test.ts` passes.
4. `tests/helpers/fakePMProvider.ts` exports `createFakePMProvider`, `createFakePMManifest`, and `runLifecycleScenario`; the fake provider passes the full lifecycle scenario in-memory.
5. `tests/unit/integrations/pm-conformance.test.ts` runs the expanded behavioral asserts (config round-trip, discovery shape, lifecycle, trigger self-hook filter, webhook verify) against the fake provider and produces specific failure messages naming the missing contract when an assertion fails.
6. A new Biome rule (or equivalent) forbids `Bearer ${` / `Authorization` string assembly outside `src/integrations/pm/_shared/auth-headers.ts`; `npm run lint` passes with the current codebase.
7. `tests/unit/integrations/auth-header-provenance.test.ts` passes on the current codebase.
8. `pm.discover({ providerId: 'fake', capability, args })` works for every capability the fake provider declares.
9. `renderStandardStep` exists and renders the shared step component for every standard step `kind`; unknown `kind` values produce a warning placeholder, not a crash.
10. All new/modified code has corresponding tests.
11. `npm run build` passes.
12. `npm test` passes.
13. `npm run lint` passes.
14. `npm run typecheck` passes.
15. `tests/README.md` documents the fake provider fixture and the lifecycle scenario runner.

**Partial-state criterion**: After this plan merges, no provider has been migrated. Legacy per-provider tRPC endpoints and central Zod schemas remain in place. The new behavioral asserts run **only** against the fake provider. Plans 2/3/4 flip each real provider on.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `tests/README.md` | Add "PM provider fixtures" section (fake provider + lifecycle scenario). |
| `src/integrations/README.md` | Add a short note pointing to `entrypoint.ts` as the registration boundary; detailed revision in plan 5. |
| `CHANGELOG.md` | Entry: "feat(pm): add typed ID refs, fake PM provider fixture, behavioral conformance harness, single registration entrypoint, auth-header lint rule (dormant — no provider migrated yet)". |

---

## Out of Scope (this plan)

Deferred to later plans in this spec:
- Per-provider adoption of `configSchema`, `discoveryCapabilities`, `wizardSpec` (plans 2, 3, 4).
- Deletion of legacy per-provider tRPC discovery procedures in `src/api/routers/integrationsDiscovery.ts` (plan 5).
- Deletion of `LinearConfigSchema`, `JiraConfigSchema`, `TrelloConfigSchema` from `src/config/schema.ts` (plan 5).
- Enforcement that the single entrypoint is the *only* registration import path — today legacy direct imports still work (plan 5 adds the mandatory assertion).
- Final rewrite of `src/integrations/README.md` around hardened contracts (plan 5).
- Root `CLAUDE.md` update (plan 5).
- Forward-reference pointer in `docs/specs/006-...md` (plan 5).

Originally out of scope for the spec (repeated for clarity):
- Extending the manifest pattern to SCM (GitHub) or alerting (Sentry).
- Adding a new PM provider.
- Changing the agent-facing PM interface method names or trigger categories.
- Credential storage/encryption/resolution changes.
- Replacing Zod, tRPC, or Biome.
- Runtime-wrapped HTTP client for auth-header enforcement.
- Shipping the fake provider as a user-facing demo.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (branded IDs)
- [ ] AC #2 (manifest fields additive)
- [ ] AC #3 (single entrypoint)
- [ ] AC #4 (fake provider fixture)
- [ ] AC #5 (expanded conformance harness)
- [ ] AC #6 (biome rule)
- [ ] AC #7 (auth-header provenance test)
- [ ] AC #8 (generic pm.discover)
- [ ] AC #9 (wizard step generator)
- [ ] AC #10 (tests for all code)
- [ ] AC #11 (build)
- [ ] AC #12 (tests)
- [ ] AC #13 (lint)
- [ ] AC #14 (typecheck)
- [ ] AC #15 (docs)
